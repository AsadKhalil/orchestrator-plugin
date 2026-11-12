import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSelections, saveSelections } from '../src/settings.js';

const model = { providerID: 'p', id: 'm', enabled: true, status: 'active', variants: ['high'] };
const high = { providerID: 'p', id: 'm', variant: 'high' };
const empty = { planner: [], coder: [], reviewer: [] };
function store() { const map = new Map<string, unknown>(); return { map, async get(k: string) { return structuredClone(map.get(k)); }, async set(k: string, v: unknown) { await new Promise(r => setTimeout(r, 2)); map.set(k, structuredClone(v)); } }; }

test('saves selected model variants independently by role and project', async () => {
  const db = store();
  assert.deepEqual(await getSelections(db, '/one'), { revision: 0, roles: empty });
  const saved = await saveSelections(db, '/one', 0, { ...empty, planner: [high], coder: [{ ...high, variant: null }] }, [model]);
  assert.equal(saved.revision, 1);
  assert.deepEqual((await getSelections(db, '/one')).roles.planner, [high]);
  assert.deepEqual(await getSelections(db, '/two'), { revision: 0, roles: empty });
  await assert.rejects(saveSelections(db, '/one', 0, empty, [model]), /stale/i);
});

test('rejects unconnected models, unavailable variants, duplicates and invalid roles', async () => {
  const db = store();
  await assert.rejects(saveSelections(db, '/one', 0, { ...empty, coder: [{ ...high, providerID: 'other' }] }, [model]), /unavailable/i);
  await assert.rejects(saveSelections(db, '/one', 0, { ...empty, coder: [{ ...high, variant: 'ultra' }] }, [model]), /unavailable/i);
  await assert.rejects(saveSelections(db, '/one', 0, { ...empty, coder: [high, high] }, [model]), /duplicate/i);
  await assert.rejects(saveSelections(db, '/one', 0, { ...empty, extra: [high] } as never, [model]), /invalid/i);
  assert.equal(db.map.size, 0);
});

test('keeps an unavailable existing choice visible until the user removes it', async () => {
  const db = store();
  await saveSelections(db, '/one', 0, { ...empty, planner: [high] }, [model]);
  const saved = await saveSelections(db, '/one', 1, { ...empty, planner: [high] }, []);
  assert.deepEqual(saved.roles.planner, [high]);
  await assert.rejects(saveSelections(db, '/one', 2, { ...empty, coder: [high] }, []), /unavailable/i);
  assert.deepEqual((await saveSelections(db, '/one', 2, empty, [])).roles, empty);
});

test('rejects simultaneous writes based on the same revision', async () => {
  const db = store();
  const wrap = () => ({ get: (key: string) => db.get(key), set: (key: string, value: unknown) => db.set(key, value) });
  const results = await Promise.allSettled([saveSelections(wrap(), '/one', 0, { ...empty, planner: [high] }, [model]), saveSelections(wrap(), '/one', 0, { ...empty, coder: [high] }, [model])]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
});

test('uses atomic compare-and-set and rejects an intervening update', async () => {
  const db = store(); let fallback = false;
  const storage = { ...db, async set() { fallback = true; }, async compareAndSet(key: string, _previous: unknown, _next: unknown) { db.map.set(key, { revision: 1, roles: { ...empty, coder: [high] } }); return false; } };
  await assert.rejects(saveSelections(storage, '/one', 0, { ...empty, planner: [high] }, [model]), /stale/i);
  assert.deepEqual((await getSelections(storage, '/one')).roles.coder, [high]);
  assert.equal(fallback, false);
});
