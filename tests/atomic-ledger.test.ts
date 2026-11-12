import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { AtomicReservationLedger } from '../src/atomic-ledger.js';
const exec = promisify(execFile);

test('competing independent processes cannot spend the same budget', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-ledger-')), path = join(dir, 'ledger.sqlite');
  try {
    const ledger = new AtomicReservationLedger(path); ledger.setLimit('monthly', undefined, '1', 0); for (let i = 0; i < 5; i++) ledger.setLimit('feature', `attempt-${i}`, '1', 0); ledger.close();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => exec(process.execPath, ['--import', 'tsx', 'tests/fixtures/atomic-ledger/worker.ts', path, `attempt-${i}`])));
    assert.equal(results.filter(r => r.stdout.trim() === 'reserved').length, 1);
    assert.equal(results.filter(r => r.stdout.trim() === 'exceeded').length, 4);
    const check = new AtomicReservationLedger(path); assert.equal(check.snapshot().length, 1); check.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('keeps feature spending across months and reconciles only once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-ledger-')), path = join(dir, 'ledger.sqlite');
  try {
    let now = Date.parse('2026-01-31T23:59:59.999Z');
    const ledger = new AtomicReservationLedger(path, () => now);
    ledger.setLimit('monthly', undefined, '1', 0); ledger.setLimit('feature', 'r', '1', 0);
    const first = { attemptID: 'a', runID: 'r', amount: '0.8' };
    assert.equal(ledger.reserve(first), 'created');
    assert.equal(ledger.reserve(first), 'existing');
    now = Date.parse('2026-02-01T00:00:00.000Z');
    assert.throws(() => ledger.reserve({ ...first, attemptID: 'b', amount: '0.3' }), /budget/i);
    ledger.reconcile('a', '0.5', { kind:'provider_gross_charge', reference:'invoice-line-a' }); ledger.reconcile('a', '0.50', { kind:'provider_gross_charge', reference:'invoice-line-a' });
    assert.throws(() => ledger.reconcile('a', '0.4', { kind:'provider_gross_charge', reference:'invoice-line-a' }), /conflict/i);
    assert.equal(ledger.reserve({ ...first, attemptID: 'b', amount: '0.5' }), 'created');
    ledger.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('recovers after a process dies before or after committing a reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-ledger-crash-')), path = join(dir, 'ledger.sqlite');
  try {
    const initial = new AtomicReservationLedger(path); initial.setLimit('monthly', undefined, '1', 0); initial.setLimit('feature', 'run', '1', 0); initial.setLimit('feature', 'other', '1', 0); initial.close();
    for (const point of ['before-commit', 'after-commit']) {
      const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/atomic-ledger/crash-worker.ts', path, point], { stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        const ready = await Promise.race([once(child.stdout!, 'data'), once(child, 'exit').then(() => { throw new Error('Worker exited early'); }), new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('Worker timed out')), 5000); t.unref(); })]);
        assert.match(String(ready[0]), /READY/);
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
        const check = new AtomicReservationLedger(path, () => Date.parse('2026-01-01T12:00:00Z'));
        const records = check.snapshot();
        assert.deepEqual(records.map(row => row.attemptID), point === 'before-commit' ? [] : ['committed']);
        if (point === 'after-commit') assert.throws(() => check.reserve({ attemptID: 'other', runID: 'other', amount: '0.3' }), /budget/i);
        check.close();
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('requires durable limits and applies the latest revision across connections', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-ledger-limits-')), path = join(dir, 'ledger.sqlite');
  try {
    const first = new AtomicReservationLedger(path), second = new AtomicReservationLedger(path);
    const request = { attemptID: 'a', runID: 'r', amount: '0.6' };
    assert.throws(() => first.reserve(request), /not configured/i);
    assert.deepEqual(first.setLimit('monthly', undefined, '1', 0), { amount: '1', revision: 1 });
    assert.throws(() => first.reserve(request), /not configured/i);
    second.setLimit('feature', 'r', '1', 0);
    first.reserve(request);
    assert.deepEqual(second.setLimit('monthly', undefined, '0.7', 1), { amount: '0.7', revision: 2 });
    assert.throws(() => first.setLimit('monthly', undefined, '2', 1), /stale/i);
    assert.throws(() => first.reserve({ ...request, attemptID: 'b', amount: '0.2' }), /budget/i);
    assert.equal(first.snapshot().length, 1);
    first.close(); second.close();
    const reopened = new AtomicReservationLedger(path);
    assert.deepEqual(reopened.getLimit('monthly'), { amount: '0.7', revision: 2 });
    assert.deepEqual(reopened.getLimit('feature', 'r'), { amount: '1', revision: 1 }); reopened.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('derives the UTC budget month and carries unresolved reservations over month boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-ledger-month-')), path = join(dir, 'ledger.sqlite');
  let now = Date.parse('2026-01-31T23:59:59.999Z');
  try {
    const ledger = new AtomicReservationLedger(path, () => now);
    ledger.setLimit('monthly', undefined, '1', 0); ledger.setLimit('feature', 'one', '1', 0); ledger.setLimit('feature', 'two', '1', 0);
    const first = { attemptID: 'a', runID: 'one', amount: '0.8' };
    ledger.reserve(first); now = Date.parse('2026-02-01T00:00:00.000Z');
    assert.equal(ledger.reserve(first), 'existing');
    assert.throws(() => ledger.reserve({ attemptID: 'b', runID: 'two', amount: '0.3' }), /budget/i);
    assert.throws(() => ledger.reserve({ attemptID: 'b', runID: 'two', amount: '0.3', period: '2099-01' } as never), /request/i);
    ledger.reconcile('a', '0.8', { kind:'provider_gross_charge', reference:'invoice-line-a' });
    assert.equal(ledger.reserve({ attemptID: 'b', runID: 'two', amount: '0.3' }), 'created');
    assert.deepEqual(ledger.snapshot().map(item => item.period), ['2026-01', '2026-02']); ledger.close();
    const bad = new AtomicReservationLedger(path, () => NaN);
    assert.throws(() => bad.reserve({ attemptID: 'c', runID: 'two', amount: '0.1' }), /clock/i); bad.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('retains reservations until explicit final evidence is supplied and rejects conflicting evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-ledger-evidence-')), path = join(dir, 'ledger.sqlite');
  try {
    const ledger = new AtomicReservationLedger(path); ledger.setLimit('monthly', undefined, '1', 0); ledger.setLimit('feature', 'r', '1', 0);
    ledger.reserve({ attemptID:'a', runID:'r', amount:'0.8' });
    assert.throws(() => ledger.reconcile('a', '0', undefined as never), /evidence/i);
    assert.throws(() => ledger.reconcile('a', '0.1', {kind:'confirmed_not_dispatched',reference:'local-intent'}), /evidence/i);
    assert.throws(() => ledger.reconcile('a', '0.1', {kind:'estimated',reference:'estimate'} as never), /evidence/i);
    assert.equal(ledger.snapshot()[0].actual, null);
    assert.throws(() => ledger.reserve({attemptID:'b',runID:'r',amount:'0.3'}), /budget/i);
    ledger.reconcile('a', '0', {kind:'confirmed_not_dispatched',reference:'local-intent'});
    assert.throws(() => ledger.reconcile('a', '0', {kind:'confirmed_not_dispatched',reference:'other-intent'}), /conflict/i);
    assert.deepEqual(ledger.snapshot()[0].evidence, {kind:'confirmed_not_dispatched',reference:'local-intent'});
    assert.equal(ledger.reserve({attemptID:'b',runID:'r',amount:'0.3'}),'created'); ledger.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('fails closed on older settled records without evidence', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'fp-ledger-legacy-')), path = join(dir, 'ledger.sqlite');
  try {
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE reservations (attempt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, period TEXT NOT NULL, amount TEXT NOT NULL, actual TEXT); INSERT INTO reservations VALUES ('a','r','2026-01','0.8','0.1')"); old.close();
    const ledger = new AtomicReservationLedger(path);
    assert.throws(() => ledger.snapshot(), /evidence/i); ledger.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});
