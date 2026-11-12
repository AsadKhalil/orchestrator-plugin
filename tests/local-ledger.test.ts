import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CasReservationLedger } from '../src/cas-ledger.js';
import { hostBudget, openBudgetLedger } from '../src/budget-ledger.js';
import { createLocalStore, defaultLedgerRoot, prepareLocalLedgerPath } from '../src/local-ledger.js';

const run = promisify(execFile);
const temp = () => mkdtemp(join(tmpdir(), 'fp-local-ledger-'));
async function withRoot(body: (root: string) => Promise<void>) { const root = await temp(); try { await body(root); } finally { await rm(root, { recursive: true, force: true }); } }

test('the ledger file follows the XDG data directory, else the home directory, and ignores a relative override', () => {
  const abs = join(tmpdir(), 'xdg-data');
  assert.equal(defaultLedgerRoot({ XDG_DATA_HOME: abs }, '/home/u'), join(abs, 'opencode'));
  assert.equal(defaultLedgerRoot({ XDG_DATA_HOME: 'relative/dir' }, '/home/u'), join('/home/u', '.local', 'share', 'opencode'));
  assert.equal(defaultLedgerRoot({}, '/home/u'), join('/home/u', '.local', 'share', 'opencode'));
});

test('the local store compares and sets atomically and keeps its data across a reopen', async () => withRoot(async root => {
  const store = createLocalStore(root);
  try {
    assert.equal(await store.get('k'), undefined);
    assert.equal(await store.compareAndSet('k', undefined, { n: 1 }), true);
    assert.equal(await store.compareAndSet('k', undefined, { n: 2 }), false, 'a writer that saw nothing loses once a value exists');
    assert.equal(await store.compareAndSet('k', { n: 9 }, { n: 3 }), false, 'a stale expectation loses');
    assert.equal(await store.compareAndSet('k', { n: 1 }, { n: 4 }), true);
    assert.deepEqual(await store.get('k'), { n: 4 });
  } finally { store.close(); }
  const again = createLocalStore(root);
  try { assert.deepEqual(await again.get('k'), { n: 4 }); } finally { again.close(); }
}));

test('a corrupt record fails closed instead of reading as an empty ledger', async () => withRoot(async root => {
  const path = await prepareLocalLedgerPath(root);
  const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path);
  db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO kv VALUES ('k', '{not json')"); db.close();
  const store = createLocalStore(root);
  try { await assert.rejects(store.get('k')); await assert.rejects(store.compareAndSet('k', undefined, {})); } finally { store.close(); }
}));

test('a failed open is retried next time, not remembered', async () => withRoot(async root => {
  let calls = 0;
  const store = createLocalStore(root, async () => { if (++calls === 1) throw new Error('sqlite unavailable'); return import('node:sqlite') as never; });
  try {
    await assert.rejects(store.get('k'), /sqlite unavailable/);
    assert.equal(await store.get('k'), undefined);
  } finally { store.close(); }
}));

test('a ledger directory that is a link is refused', async t => withRoot(async root => {
  const elsewhere = join(root, 'elsewhere'), data = join(root, 'data');
  await mkdir(elsewhere); await mkdir(data);
  try { await symlink(elsewhere, join(data, 'feature-pilot'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.skip('this platform or account cannot create links'); return; }
  await assert.rejects(prepareLocalLedgerPath(data), /Unsafe ledger/);
  assert.equal(existsSync(join(elsewhere, 'ledger.sqlite')), false, 'nothing was created behind the link');
}));

test('budgets are enforced across separate processes sharing the file: only what fits is reserved', async () => withRoot(async root => {
  const parent = createLocalStore(root), ledger = new CasReservationLedger(parent as never);
  await ledger.setLimit('monthly', undefined, '1.00', 0); await ledger.setLimit('feature', 'run-1', '0.50', 0); parent.close();
  // Six processes make 15 one-cent attempts each (90) against a 50-cent feature limit, so exactly 50 may succeed.
  const worker = join(import.meta.dirname, 'fixtures', 'ledger-worker.ts');
  const created = await Promise.all(Array.from({ length: 6 }, (_, index) => run(process.execPath, ['--import', 'tsx', worker, root, 'run-1', `p${index}`, '0.01', '15'], { timeout: 120_000 }).then(result => Number(result.stdout.trim()))));
  assert.equal(created.reduce((sum, value) => sum + value, 0), 50, `created per process: ${created.join(', ')}`);
  const after = createLocalStore(root);
  try { assert.equal((await new CasReservationLedger(after as never).report('run-1')).featureUsage?.committedUsd, '0.5'); } finally { after.close(); }
}));

test('the ledger runs end to end on the local store: limits, reservation, refusal, settlement, and a reopen', async () => withRoot(async root => {
  const store = createLocalStore(root), ledger = new CasReservationLedger(store as never);
  try {
    await assert.rejects(ledger.reserve({ attemptID: 'a', runID: 'run-1', amount: '0.10' }), /not configured/);
    await ledger.setLimit('monthly', undefined, '0.50', 0); await ledger.setLimit('feature', 'run-1', '0.25', 0);
    await assert.rejects(ledger.setLimit('monthly', undefined, '9', 0), /Stale/);
    assert.equal(await ledger.reserve({ attemptID: 'a', runID: 'run-1', amount: '0.20' }), 'created');
    assert.equal(await ledger.reserve({ attemptID: 'a', runID: 'run-1', amount: '0.20' }), 'existing');
    await assert.rejects(ledger.reserve({ attemptID: 'b', runID: 'run-1', amount: '0.10' }), /Budget exceeded/);
    await ledger.reconcile('a', '0.05', { kind: 'provider_gross_charge', reference: 'synthetic' });
    assert.equal(await ledger.reserve({ attemptID: 'b', runID: 'run-1', amount: '0.10' }), 'created');
  } finally { store.close(); }
  const again = createLocalStore(root);
  try { assert.equal((await new CasReservationLedger(again as never).report('run-1')).featureUsage?.pendingCount, 1); } finally { again.close(); }
}));

test('the budget authority is the host storage when it can compare-and-set, else the local file, else nothing', async () => withRoot(async root => {
  const atomic = { async get() { return undefined; }, async compareAndSet() { return true; } };
  assert.equal((await openBudgetLedger(atomic, root)).backend, 'host');
  assert.equal(hostBudget({ async get() {} }).backend, null);
  assert.equal((await openBudgetLedger({ async get() {} })).backend, null, 'no file location means no ledger');
  const local = await openBudgetLedger({ async get() {} }, root);
  try { assert.equal(local.backend, 'local_file'); assert.ok(local.ledger); } finally { local.close(); }
  assert.equal(existsSync(join(root, 'feature-pilot')), false, 'nothing is written until a budget is first used');
  const noSqlite = await openBudgetLedger({ async get() {} }, root, async () => { throw new Error('no node:sqlite'); });
  assert.deepEqual([noSqlite.backend, noSqlite.ledger], [null, null], 'a runtime without SQLite stays fail-closed');
}));
