import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRelaySettings, saveRelaySettings, recordDecision, recentDecisions, modelName, USE_FOR_MAX, chatSwitch, setChatSwitch, waitingReplies, saveReplies, getUsage } from '../src/relay-store.js';

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
  assert.deepEqual(recent[0], { ...base, at: '2026-11-14T00:00:22.000Z', messageID: null, reply: null });
  assert.deepEqual([...db.map.keys()], ['relay/decisions']);
  assert.deepEqual(await recentDecisions({ async get() { return 'garbage'; } }), []);
  const { fit: _fit, ...older } = { ...base, at: 'earlier' };
  assert.deepEqual(await recentDecisions({ async get() { return [older, 'garbage', { at: 1 }, { ...base, at: 'later', extra: 'x', mode: 'other' }]; } }), [{ ...base, at: 'later', mode: null, messageID: null, reply: null }, { ...base, at: 'earlier', fit: null, messageID: null, reply: null }]);
});

test("a record keeps its message's id until what the reply took is read; other chats and records already filled are left alone", async () => {
  const db = store(), base = { sessionID: 'ses-1', kind: 'chat', mode: 'plan', confidence: 0.9, fit: null, model: 'p/m', ms: 150, costUsd: '0', note: null } as const;
  const took = {
    requests: 3, fresh: 5972, cached: 5672, costUsd: '0.011961', seconds: 0.6, model: 'p/m#high', total: { input: 5762, output: 15, reasoning: 0, cacheRead: 28572, cacheWrite: 300, costUsd: '0.057313' },
    prices: { inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: '0.3', cacheWritePerMillion: '3.75' }, pricesFrom: 'opencode' as const,
  }, other = { ...took, requests: 9 };
  await recordDecision(db, { ...base, at: 'one', messageID: 'msg-1' });
  await recordDecision(db, { ...base, at: 'two', messageID: 'msg-2' });
  await recordDecision(db, { ...base, at: 'three', sessionID: 'ses-2', messageID: 'msg-3' });
  await recordDecision(db, { ...base, at: 'four', kind: 'helper' });
  assert.deepEqual(await waitingReplies(db, 'ses-1'), ['msg-1', 'msg-2']);
  assert.deepEqual(await waitingReplies(db, 'ses-9'), []);
  await saveReplies(db, 'ses-1', new Map([['msg-1', took], ['msg-3', took]]));
  assert.deepEqual((await recentDecisions(db)).map(item => [item.at, item.messageID, item.reply]), [['four', null, null], ['three', 'msg-3', null], ['two', 'msg-2', null], ['one', 'msg-1', took]]);
  assert.deepEqual(await waitingReplies(db, 'ses-1'), ['msg-2']);
  await saveReplies(db, 'ses-1', new Map([['msg-1', other]]));
  assert.deepEqual((await recentDecisions(db))[3].reply, took, 'a reply that was read once is not replaced');
  assert.deepEqual(await recentDecisions({ async get() { return [{ ...base, at: 'x', messageID: 7, reply: { ...took, requests: 'many' } }, { ...base, at: 'y', messageID: 'msg-9', reply: { ...took, costUsd: null, seconds: null, extra: 1 } }]; } }),
    [{ ...base, at: 'y', messageID: 'msg-9', reply: { ...took, costUsd: null, seconds: null } }, { ...base, at: 'x', messageID: null, reply: null }], 'what cannot be read is unknown, and an unknown field is dropped');
  const { model: _model, total: _total, prices: _prices, pricesFrom: _from, ...older } = took;
  assert.deepEqual((await recentDecisions({ async get() { return [{ ...base, at: 'z', messageID: 'msg-8', reply: older }, { ...base, at: 'w', messageID: 'msg-7', reply: { ...took, total: { ...took.total, output: 'lots' }, prices: { ...took.prices, outputPerMillion: 15 }, pricesFrom: 'elsewhere' } }]; } })).map(item => item.reply),
    [{ ...took, total: null, prices: { ...took.prices, outputPerMillion: null }, pricesFrom: null }, { ...older, model: null, total: null, prices: null, pricesFrom: null }], 'a reply kept before 19 Nov 2026 has no model, totals or prices; totals with a count that is not a number are unknown');
});

const reply = {
  requests: 3, fresh: 5972, cached: 5672, costUsd: '0.011961', seconds: 0.6, model: 'p/m#high', total: { input: 5762, output: 15, reasoning: 0, cacheRead: 28572, cacheWrite: 300, costUsd: '0.057313' },
  prices: { inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: '0.3', cacheWritePerMillion: '3.75' } as Record<'inputPerMillion' | 'outputPerMillion' | 'cacheReadPerMillion' | 'cacheWritePerMillion', string | null>, pricesFrom: 'opencode' as 'opencode' | 'artificial-analysis' | null,
};
const placed = (at: string, messageID: string) => ({ at, sessionID: 'ses-1', kind: 'chat' as const, mode: 'execute' as const, confidence: 0.9, fit: null, model: 'p/m#high', ms: 150, costUsd: '0', note: null, messageID });

test('each reply is added once to the totals of its model and effort', async () => {
  const db = store(), at = Date.parse('2026-11-19T09:00:00Z');
  for (const id of ['msg-1', 'msg-2', 'msg-3']) await recordDecision(db, placed(id, id));
  assert.deepEqual(await getUsage(db), { since: null, rows: [] }, 'nothing counted yet');
  await saveReplies(db, 'ses-1', new Map([['msg-1', reply]]), at);
  await saveReplies(db, 'ses-1', new Map([['msg-1', reply]]), at + 1000);
  await saveReplies(db, 'ses-1', new Map([['msg-2', reply], ['msg-3', { ...reply, model: 'p/n', requests: 1 }]]), at + 2000);
  const usage = await getUsage(db);
  assert.deepEqual([usage.since, usage.rows.map(row => [row.model, row.messages, row.requests])], ['2026-11-19T09:00:00.000Z', [['p/m#high', 2, 6], ['p/n', 1, 1]]], 'a reply that was kept once is not counted again');
  assert.deepEqual(usage.rows[0], {
    model: 'p/m#high', messages: 2, requests: 6, input: 11524, output: 30, reasoning: 0, cacheRead: 57144, cacheWrite: 600, openCodeUsd: '0.114626',
    byPrice: { input: '0.034572', output: '0.00045', cacheRead: '0.0171432', cacheWrite: '0.00225' }, prices: reply.prices, pricesFrom: 'opencode',
  });
  assert.deepEqual(usage.rows[1].byPrice, { input: '0.017286', output: '0.000225', cacheRead: '0.0085716', cacheWrite: '0.001125' }, '5,762 in at $3, 15 out at $15, 28,572 from cache at $0.30 and 300 to cache at $3.75 for a million');
});

test('a reply with no price adds tokens and no cost by price', async () => {
  const db = store(), unlisted = { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, cacheWritePerMillion: null };
  for (const id of ['msg-1', 'msg-2']) await recordDecision(db, placed(id, id));
  await saveReplies(db, 'ses-1', new Map([['msg-1', { ...reply, model: 'claude-agent/sonnet', total: { ...reply.total, costUsd: '0' }, prices: unlisted, pricesFrom: null }]]));
  await saveReplies(db, 'ses-1', new Map([['msg-2', { ...reply, prices: { ...reply.prices, cacheWritePerMillion: null } }]]));
  const [claude, priced] = [(await getUsage(db)).rows.find(row => row.model === 'claude-agent/sonnet')!, (await getUsage(db)).rows.find(row => row.model === 'p/m#high')!];
  assert.deepEqual([claude.input, claude.openCodeUsd, claude.byPrice, claude.pricesFrom], [5762, '0', { input: null, output: null, cacheRead: null, cacheWrite: null }, null]);
  assert.deepEqual(priced.byPrice, { input: '0.017286', output: '0.000225', cacheRead: '0.0085716', cacheWrite: null }, 'a kind with no price has no cost by price');
});

test('totals that cannot be read start again', async () => {
  assert.deepEqual(await getUsage({ async get() { return 'garbage'; } }), { since: null, rows: [] });
  const good = { model: 'p/m', messages: 1, requests: 2, input: 3, output: 4, reasoning: 0, cacheRead: 5, cacheWrite: 6, openCodeUsd: '0.1', byPrice: { input: null, output: null, cacheRead: null, cacheWrite: null }, prices: null, pricesFrom: null };
  assert.deepEqual(await getUsage({ async get() { return { since: '2026-11-19T09:00:00.000Z', rows: [good, { ...good, model: 'p/x', requests: 'x' }, 'odd', { ...good, model: 'p/y', byPrice: { input: 7 } }] }; } }),
    { since: '2026-11-19T09:00:00.000Z', rows: [good, { ...good, model: 'p/y' }] }, 'a row with a count that is not a number is left out; a cost that is not an amount is unknown');
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

test("an unknown cost leaves OpenCode's total as it was, and a row priced by Artificial Analysis once keeps its mark", async () => {
  const db = store(), api = { inputPerMillion: '2', outputPerMillion: '10', cacheReadPerMillion: '0.1', cacheWritePerMillion: '2.5' };
  for (const id of ['msg-1', 'msg-2', 'msg-3']) await recordDecision(db, placed(id, id));
  await saveReplies(db, 'ses-1', new Map([['msg-1', { ...reply, total: { ...reply.total, costUsd: '1' }, prices: api, pricesFrom: 'artificial-analysis' as const }]]));
  await saveReplies(db, 'ses-1', new Map([['msg-2', { ...reply, total: { ...reply.total, costUsd: null } }]]));
  await saveReplies(db, 'ses-1', new Map([['msg-3', { ...reply, total: { ...reply.total, costUsd: '2' }, prices: null, pricesFrom: null }]]));
  const [row] = (await getUsage(db)).rows;
  assert.deepEqual([row.messages, row.openCodeUsd, row.pricesFrom, row.prices], [3, '3', 'artificial-analysis', reply.prices], 'the unknown cost adds nothing; the mark stays; the last prices that were known stay');
});

test('a reply still waiting is kept, and counted, when twenty newer records come before its chat goes idle', async () => {
  const db = store();
  await recordDecision(db, placed('first', 'msg-old'));
  for (let i = 0; i < 25; i++) await recordDecision(db, { ...placed(`helper-${i}`, 'x'), kind: 'helper', messageID: null });
  const recent = await recentDecisions(db);
  assert.deepEqual([recent.length, recent.some(item => item.messageID === 'msg-old'), await waitingReplies(db, 'ses-1')], [20, false, ['msg-old']], 'Recent choices shows twenty; the waiting record is kept behind them');
  await saveReplies(db, 'ses-1', new Map([['msg-old', reply]]));
  assert.deepEqual((await getUsage(db)).rows.map(row => [row.model, row.messages]), [['p/m#high', 1]]);
  for (let i = 0; i < 60; i++) await recordDecision(db, placed(`wait-${i}`, `msg-${i}`));
  assert.equal((await waitingReplies(db, 'ses-1')).length, 50, 'at most thirty older waiting records stay behind the twenty newest');
});
