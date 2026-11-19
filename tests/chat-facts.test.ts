import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatFacts, replyOf } from '../src/chat-facts.js';

// Messages shaped as OpenCode 2.3.0 gives them from `session.context` (read on an isolated host with a mock model, 18 Nov 2026).
const user = (id: string, created: number) => ({ id, type: 'user', time: { created }, text: 'never read' });
const answer = (id: string, model: string, created: number, tokens: { input: number; read?: number; write?: number; output?: number } | null, extra: object = {}) => ({
  id, type: 'assistant', agent: 'build', finish: 'stop', cost: 0.022676, model: { id: model, providerID: 'p', variant: 'default' },
  time: { created, firstToken: created + 584, streamed: created + 599, completed: created + 698 },
  ...(tokens ? { tokens: { input: tokens.input, output: tokens.output ?? 5, reasoning: 0, cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 } } } : {}), ...extra,
});
const idle = (created: number) => ({ id: `idle-${created}`, type: 'idle', time: { created } });

test("what a reply took: the first request's tokens read new and from cache, its cost, the wait for the first word, and the number of requests", () => {
  const messages = [
    user('m1', 1000), answer('a1', 'big', 1047, { input: 11313 }), idle(1800),
    user('m2', 2000), answer('a2', 'big', 2020, { input: 5672, read: 5672, write: 300 }, { cost: 0.0119612 }), answer('a3', 'big', 3000, { input: 40, read: 11400 }), answer('a4', 'big', 4000, { input: 50, read: 11500 }), idle(5000),
  ];
  const alone = { input: 11313, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, costUsd: '0.022676' };
  assert.deepEqual(replyOf(messages, 'm1'), { requests: 1, fresh: 11313, cached: 0, costUsd: '0.022676', seconds: 0.6, model: 'p/big', total: alone, prices: null, pricesFrom: null });
  assert.deepEqual(replyOf(messages, 'm2'), { requests: 3, fresh: 5972, cached: 5672, costUsd: '0.011961', seconds: 0.6, model: 'p/big', total: { input: 5762, output: 15, reasoning: 0, cacheRead: 28572, cacheWrite: 300, costUsd: '0.057313' }, prices: null, pricesFrom: null },
    'tokens written to the cache were read new; the whole reply adds up all three requests');
});

test('a reply names the model and effort that answered, and keeps the prices the model list gives for the size of its first request', () => {
  const base = { inputPerMillion: '0.1', outputPerMillion: '0.5', cacheReadPerMillion: '0.01', cacheWritePerMillion: '0.125' }, above = { inputPerMillion: '0.5', outputPerMillion: '2.5', cacheReadPerMillion: '0.05', cacheWritePerMillion: '0.625' };
  const models = [{ providerID: 'p', id: 'big', cost: { ...base, tiered: true, steps: [{ above: 100_000, ...above }] } }];
  const reading = (read: number) => [user('m1', 1000), answer('a1', 'big', 1047, { input: 900, read, write: 50, output: 120 }, { model: { id: 'big', providerID: 'p', variant: 'low' } }), answer('a2', 'big', 2000, { input: 30, read: read + 1000 }, { tokens: { input: 30, output: 40, reasoning: 25, cache: { read: read + 1000, write: 0 } } })];
  const under = replyOf(reading(99_000), 'm1', models);
  assert.deepEqual([under?.model, under?.prices, under?.pricesFrom, under?.total], ['p/big#low', base, 'opencode', { input: 930, output: 160, reasoning: 25, cacheRead: 199_000, cacheWrite: 50, costUsd: '0.045352' }], 'the first request read 99,950 tokens: the base prices');
  assert.deepEqual(replyOf(reading(99_100), 'm1', models)?.prices, above, 'the first request read 100,050 tokens: the prices above 100,000');
  assert.equal(replyOf(reading(99_000), 'm1', [])?.prices, null, 'a model the list does not have');
  assert.equal(replyOf(reading(99_000), 'm1')?.prices, null, 'no list');
  const unpriced = { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, cacheWritePerMillion: null };
  assert.deepEqual(replyOf(reading(99_000), 'm1', [{ providerID: 'p', id: 'big', cost: { ...unpriced, tiered: false, steps: [] } }])?.prices, unpriced, 'a model listed with no price, as Claude through a subscription login');
  const stopped = [...reading(99_000), answer('a3', 'big', 3000, null, { cost: undefined })];
  assert.deepEqual([replyOf(stopped, 'm1')?.requests, replyOf(stopped, 'm1')?.total?.costUsd], [3, null], 'a request with no cost leaves the cost of the whole reply unknown');
});

test('a reply that cannot be read yet, or at all, is null', () => {
  assert.equal(replyOf([user('m1', 1000)], 'm1'), null, 'no answer yet');
  assert.equal(replyOf([user('m1', 1000), answer('a1', 'big', 1047, { input: 10 })], 'other'), null, 'the message is not in the chat');
  assert.equal(replyOf([user('m1', 1000), answer('a1', 'big', 1047, null)], 'm1'), null, 'an answer with no token counts, as after a stop');
  assert.equal(replyOf([user('m1', 1000), user('m2', 1500), answer('a1', 'big', 1600, { input: 10 })], 'm1'), null, 'the answer belongs to the next message');
  for (const odd of [null, 'text', [null, 7, {}]]) assert.equal(replyOf(odd as never, 'm1'), null);
  assert.deepEqual(replyOf([user('m1', 1000), answer('a1', 'big', 1047, { input: 10 }, { cost: undefined, time: { created: 1047 } })], 'm1'), { requests: 1, fresh: 10, cached: 0, costUsd: null, seconds: null, model: 'p/big', total: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, costUsd: null }, prices: null, pricesFrom: null }, 'no cost and no first word reported');
});

test("a chat's size is what its latest answer read and wrote, and each model's latest answer is kept with its age", () => {
  const messages = [
    user('m1', 1000), answer('a1', 'big', 1047, { input: 11313 }),
    user('m2', 60_000), answer('a2', 'small', 60_020, { input: 300, read: 11300, write: 200, output: 40 }),
    user('m3', 120_000), answer('a3', 'big', 120_020, { input: 900, read: 11313, output: 60 }),
  ];
  assert.deepEqual(chatFacts(messages, 200_000), { tokens: 12273, answered: [{ providerID: 'p', id: 'big', tokens: 12273, agoMs: 79_980 }, { providerID: 'p', id: 'small', tokens: 11840, agoMs: 139_980 }] });
});

test("an answer's age runs from the start of its request, so a long answer does not make the cache look younger", () => {
  // Anthropic counts a cache's lifetime from the start of the request that wrote or read it; the time the answer takes counts against it.
  const fourMinutes = [user('m1', 900), answer('a1', 'big', 1000, { input: 9000 }, { time: { created: 1000, firstToken: 2000, completed: 241_000 } })];
  assert.equal(chatFacts(fourMinutes, 311_000).answered[0].agoMs, 310_000, 'over five minutes since the request began, though the answer ended 70 seconds ago');
  const noStart = [user('m1', 900), answer('a1', 'big', 1000, { input: 9000 }, { time: { completed: 241_000 } })];
  assert.equal(chatFacts(noStart, 311_000).answered[0].agoMs, 70_000, 'with no start time, the end is used');
});

test('a new chat and a chat that was just compacted have nothing to lose; an answer still running and a failed compaction change nothing', () => {
  assert.deepEqual(chatFacts([], 5000), { tokens: 0, answered: [] });
  const before = [user('m1', 1000), answer('a1', 'big', 1047, { input: 11313 })], kept = chatFacts(before, 5000);
  assert.deepEqual(kept, { tokens: 11318, answered: [{ providerID: 'p', id: 'big', tokens: 11318, agoMs: 3953 }] });
  assert.deepEqual(chatFacts([...before, { id: 'c1', type: 'compaction', status: 'completed', time: { created: 3000 } }], 5000), { tokens: 0, answered: [] });
  assert.deepEqual(chatFacts([...before, { id: 'c1', type: 'compaction', status: 'failed', time: { created: 3000 }, tokens: { input: 18946, output: 10, reasoning: 0, cache: { read: 6299, write: 0 } } }], 5000), kept);
  assert.deepEqual(chatFacts([...before, { ...answer('x1', 'small', 4020, { input: 99_999 }), type: 'compaction', status: 'failed' }], 5000), kept, 'an entry that is not an answer is never read as one, whatever it carries');
  // After a compaction that completed, the host lists the chat from the compaction's own entry on, and that entry has counts of its own (2.3.0, 18 Nov 2026).
  const compacted = [{ id: 'c1', type: 'compaction', status: 'completed', reason: 'manual', time: { created: 3000 }, model: { id: 'big', providerID: 'p', variant: 'default' }, cost: 0.008281, tokens: { input: 495, output: 5, reasoning: 0, cache: { read: 31005, write: 0 } } }, idle(3100)];
  assert.deepEqual(chatFacts(compacted, 5000), { tokens: 0, answered: [] });
  assert.deepEqual(chatFacts([...compacted, user('m2', 4000), answer('a2', 'big', 4020, { input: 4000 })], 5000), { tokens: 4005, answered: [{ providerID: 'p', id: 'big', tokens: 4005, agoMs: 980 }] }, 'the next answer gives the new size');
  assert.deepEqual(chatFacts([...before, user('m2', 4000), answer('a2', 'small', 4020, { input: 99_999 }, { time: { created: 4020 } })], 5000), kept, 'not completed yet');
  assert.deepEqual(chatFacts([...before, null, 7, {}] as never, 5000), kept);
});
