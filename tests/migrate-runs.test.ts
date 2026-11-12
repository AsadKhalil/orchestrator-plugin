import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newRun } from '../src/run.js';
import { RunRepository } from '../src/run-store.js';
import { SqliteRunStore } from '../src/sqlite-run-store.js';
import { migrateRuns } from '../src/migrate-runs.js';

test('imports project drafts atomically, preserves the source, and detects conflicts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-migration-'));
  const store = new SqliteRunStore(join(dir, 'runs.sqlite'), '/project');
  const id = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
  const root = `project-runs/${encodeURIComponent('/project')}/runs/`;
  const data = new Map<string, unknown>([[root + id, newRun(id, 'Original', 'base')]]);
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async scan({ prefix }: { prefix: string }) { return { entries: [...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) }; } };
  const context = { location: { directory: '/project' }, storage } as never;
  try {
    assert.deepEqual(await migrateRuns(context, store), { inserted: 1, unchanged: 0 });
    assert.deepEqual(await migrateRuns(context, store), { inserted: 0, unchanged: 1 });
    assert.equal(data.size, 1);
    await new RunRepository(store).changeRequirement(id, 0, 'Changed');
    data.set(root + other, newRun(other, 'Second', 'base'));
    await assert.rejects(migrateRuns(context, store), /conflict/i);
    assert.equal((await store.list()).length, 1);
    assert.equal(data.size, 2);
    await assert.rejects(migrateRuns({ location: { directory: '/other' }, storage } as never, store), /project/i);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('does not import if source changes between scans', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fp-migration-'));
  const store = new SqliteRunStore(join(dir, 'runs.sqlite'), '/project');
  const id = '00000000-0000-4000-8000-000000000001', key = `project-runs/${encodeURIComponent('/project')}/runs/${id}`;
  let scans = 0;
  const storage = { async get() { return newRun(id, scans === 1 ? 'Before' : 'After', 'base'); }, async scan() { scans++; return { entries: [{ key }] }; } };
  try {
    await assert.rejects(migrateRuns({ location: { directory: '/project' }, storage } as never, store), /changed/i);
    assert.deepEqual(await store.list(), []);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
