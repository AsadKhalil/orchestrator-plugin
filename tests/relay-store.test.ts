import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRelaySettings, saveRelaySettings, recordDecision, recentDecisions, modelName, USE_FOR_MAX, chatSwitch, setChatSwitch } from '../src/relay-store.js';

function store() { const map = new Map<string, unknown>(); return { map, async get(k: string) { return structuredClone(map.get(k)); }, async set(k: string, v: unknown) { await new Promise(r => setTimeout(r, 2)); map.set(k, structuredClone(v)); } }; }
const chat = [{ providerID: 'p', id: 'm', enabled: true, status: 'active', variants: ['high'] }];
const deciders = [{ providerID: 'd', id: 'judge', enabled: true, status: 'active', variants: [] }];
const high = { providerID: 'p', id: 'm', variant: 'high' }, judge = { providerID: 'd', id: 'judge', variant: null };
const plain = { ...high, useFor: '' };
const empty = { plan: [], execute: [], review: [] };

test('settings start empty, are one set for all projects, and reject a stale revision', async () => {
  const db = store();
  assert.deepEqual(await getRelaySettings(db), { revision: 0, modes: empty, decider: null });
  const saved = await saveRelaySettings(db, 0, { modes: { ...empty, review: [high] }, decider: judge }, chat, deciders);
  assert.deepEqual(saved, { revision: 1, modes: { ...empty, review: [plain] }, decider: judge });
  assert.deepEqual(await getRelaySettings(db), saved);
  assert.deepEqual([...db.map.keys()], ['relay/settings']);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: null }, chat, deciders), /stale/i);
});

test('each choice carries its "use it for" line: white space collapsed, optional, and at most 200 characters', async () => {
  const db = store();
  assert.equal(USE_FOR_MAX, 200);
  const saved = await saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, useFor: '  hard   design\n work ' }, { ...high, variant: null }] }, decider: null }, chat, deciders);
  assert.deepEqual(saved.modes.plan, [{ ...high, useFor: 'hard design work' }, { ...high, variant: null, useFor: '' }]);
  const longest = await saveRelaySettings(db, 1, { modes: { ...empty, plan: [{ ...high, useFor: ` ${'x'.repeat(200)} ` }] }, decider: null }, chat, deciders);
  assert.equal(longest.modes.plan[0].useFor, 'x'.repeat(200));
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [{ ...high, useFor: 'x'.repeat(201) }] }, decider: null }, chat, deciders), /at most 200 characters/);
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [{ ...high, useFor: 5 }] }, decider: null }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [{ ...high, note: 'x' }] }, decider: null }, chat, deciders), /invalid/i);
  assert.equal((await getRelaySettings(db)).revision, 2);
});

test('only an offered chat model can be chosen for a mode, and only a decision model can decide', async () => {
  const db = store();
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, id: 'gone' }] }, decider: null }, chat, deciders), /unavailable/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, variant: 'ultra' }] }, decider: null }, chat, deciders), /unavailable/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [high, high] }, decider: null }, chat, deciders), /duplicate/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, useFor: 'one thing' }, { ...high, useFor: 'another' }] }, decider: null }, chat, deciders), /duplicate/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, extra: [] }, decider: null }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { plan: [], execute: [] }, decider: null }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: null, extra: 1 }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: high }, chat, deciders), /decision model/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: { ...judge, useFor: 'x' } }, chat, deciders), /invalid/i);
  assert.equal(db.map.size, 0);
});

test('a choice that is no longer offered stays until the person removes it, and its line may still change', async () => {
  const db = store();
  await saveRelaySettings(db, 0, { modes: { ...empty, plan: [high] }, decider: judge }, chat, deciders);
  const kept = await saveRelaySettings(db, 1, { modes: { ...empty, plan: [{ ...high, useFor: 'small fixes' }] }, decider: judge }, [], []);
  assert.deepEqual([kept.revision, kept.modes.plan, kept.decider], [2, [{ ...high, useFor: 'small fixes' }], judge]);
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [high], review: [high] }, decider: judge }, [], []), /unavailable/i, 'kept in Plan does not make it new-able in Review');
});

test('with compare-and-set, a write that lost the race is stale and nothing falls back to set', async () => {
  const db = store(); let fallback = false;
  const storage = { ...db, async set() { fallback = true; }, async compareAndSet() { return false; } };
  await assert.rejects(saveRelaySettings(storage, 0, { modes: empty, decider: null }, chat, deciders), /stale/i);
  assert.equal(fallback, false);
  const seen: unknown[] = [];
  const atomic = { ...db, async set() { fallback = true; }, async compareAndSet(key: string, expected: unknown, value: unknown) { seen.push([key, expected]); db.map.set(key, value); return true; } };
  assert.equal((await saveRelaySettings(atomic, 0, { modes: empty, decider: null }, chat, deciders)).revision, 1);
  assert.deepEqual([seen, fallback], [[['relay/settings', undefined]], false]);
});

test('stored settings that cannot be read are an error, not an empty set', async () => {
  for (const damaged of ['garbage', { revision: -1, modes: empty, decider: null }, { revision: 1, modes: { plan: [] }, decider: null }, { revision: 1, modes: empty }])
    await assert.rejects(getRelaySettings({ async get() { return damaged; } }), /invalid/i);
});

test('the last 20 decisions are kept, newest first, and what cannot be read is left out', async () => {
  const db = store(), base = { sessionID: 'ses-1', kind: 'chat', mode: 'plan', confidence: 0.9, fit: 0.8, model: 'p/m', ms: 150, costUsd: '0', note: null } as const;
  for (let i = 0; i < 23; i++) await recordDecision(db, { ...base, at: `2026-11-14T00:00:${String(i).padStart(2, '0')}.000Z` });
  const recent = await recentDecisions(db);
  assert.deepEqual([recent.length, recent[0].at, recent[19].at], [20, '2026-11-14T00:00:22.000Z', '2026-11-14T00:00:03.000Z']);
  assert.deepEqual(recent[0], { ...base, at: '2026-11-14T00:00:22.000Z' });
  assert.deepEqual([...db.map.keys()], ['relay/decisions']);
  assert.deepEqual(await recentDecisions({ async get() { return 'garbage'; } }), []);
  const { fit: _fit, ...older } = { ...base, at: 'earlier' };
  assert.deepEqual(await recentDecisions({ async get() { return [older, 'garbage', { at: 1 }, { ...base, at: 'later', extra: 'x', mode: 'other' }]; } }), [{ ...base, at: 'later', mode: null }, { ...base, at: 'earlier', fit: null }]);
});

test("a chat's switch starts off, turns on and off, is per chat, and anything but true reads as off", async () => {
  const db = store();
  assert.equal(await chatSwitch(db, 'ses-1'), false);
  await setChatSwitch(db, 'ses-1', true);
  assert.deepEqual([await chatSwitch(db, 'ses-1'), await chatSwitch(db, 'ses-2')], [true, false]);
  await setChatSwitch(db, 'ses-1', false);
  assert.equal(await chatSwitch(db, 'ses-1'), false);
  await setChatSwitch(db, 'a/b', true);
  assert.deepEqual([...db.map.keys()], ['relay/on/ses-1', 'relay/on/a%2Fb']);
  for (const odd of ['true', 1, {}, null]) assert.equal(await chatSwitch({ async get() { return odd; } }, 'x'), false, JSON.stringify(odd));
});

test('model names', () => { assert.equal(modelName(high), 'p/m#high'); assert.equal(modelName(judge), 'd/judge'); assert.equal(modelName(plain), 'p/m#high'); });
