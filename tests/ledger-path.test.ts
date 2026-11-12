import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareLedgerPath } from '../src/ledger-path.js';
import { AtomicReservationLedger } from '../src/atomic-ledger.js';

test('prepares a stable private ledger path and reopens existing data', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fp-private-'));
  try {
    const path = await prepareLedgerPath(root);
    assert.equal((await lstat(join(root, 'feature-pilot'))).mode & 0o777, 0o700);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    const db = new AtomicReservationLedger(path); db.setLimit('monthly', undefined, '1', 0); db.close();
    assert.equal(await prepareLedgerPath(root), path);
    const reopened = new AtomicReservationLedger(path); assert.equal(reopened.getLimit('monthly')?.amount, '1'); reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects symlinks and unsafe permissions without overwriting existing files', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fp-private-'));
  try {
    const target = join(root, 'target'); await writeFile(target, 'preserve');
    await symlink(target, join(root, 'feature-pilot'));
    await assert.rejects(prepareLedgerPath(root), /unsafe/i);
    await rm(join(root, 'feature-pilot')); await mkdir(join(root, 'feature-pilot'), { mode: 0o700 });
    await symlink(target, join(root, 'feature-pilot', 'ledger.sqlite'));
    await assert.rejects(prepareLedgerPath(root));
    await rm(join(root, 'feature-pilot', 'ledger.sqlite'));
    await chmod(join(root, 'feature-pilot'), 0o755);
    await assert.rejects(prepareLedgerPath(root), /unsafe/i);
    await chmod(root, 0o777);
    await assert.rejects(prepareLedgerPath(root), /unsafe/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
