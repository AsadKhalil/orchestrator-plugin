import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readObservedUsage } from '../src/host-usage.js';

test('aggregates only owned sessions in the active project and never returns message text', async () => {
  const calls: string[] = [];
  const ctx = { location: { directory: '/repo' }, storage: {
    async scan() { return { entries: [{ key: 'owned-session/ses_1', value: 'run-1' }, { key: 'owned-session/ses_2', value: 'run-2' }] }; },
    async get(k: string) { return k === 'owned-role/ses_1' ? 'coder' : 'planner'; },
  }, session: {
    async get({sessionID}: {sessionID:string}) { calls.push(sessionID); return { location: { directory: sessionID === 'ses_1' ? '/repo' : '/other' } }; },
    async context() { return [
      { type: 'user', id: 'msg_user', content: 'secret prompt' },
      { type: 'assistant', id: 'msg_1', model: { providerID: 'p', id: 'm', variant: 'high' }, time: { created: Date.parse('2026-01-02T12:00:00Z') }, cost: 0.12, content: [{ type: 'text', text: 'secret code' }] },
      { type: 'assistant', id: 'msg_2', model: { providerID: 'p', id: 'm' }, time: { created: Date.parse('2026-01-03T12:00:00Z') }, cost: 0 },
    ]; },
  } };
  const value = await readObservedUsage(ctx as never, '2026-01', 'UTC');
  assert.equal(value.summary.total.attempts, 2);
  assert.equal(value.summary.total.gross.knownUsd, '0.12');
  assert.equal(value.summary.total.gross.unknownCount, 1);
  assert.equal(value.summary.total.cash.unknownCount, 2);
  assert.deepEqual(value.summary.breakdown.effort.map(row => [row.key, row.gross.knownUsd, row.gross.unknownCount]), [['(not reported)', '0', 1], ['high', '0.12', 0]]);
  assert.equal(value.coverage.complete, false);
  assert.deepEqual(calls, ['ses_1', 'ses_2']);
  assert.equal(JSON.stringify(value).includes('secret'), false);
});

test('reports unavailable sessions and rejects invalid month or timezone without calling a model', async () => {
  let requests = 0;
  const ctx = { location: { directory: '/repo' }, storage: { async scan() { return { entries: [{key:'owned-session/ses_missing',value:'r'}] }; }, async get() { return 'coder'; } }, session: { async get() { requests++; throw Error('deleted'); }, async context() { throw Error('unexpected'); } } };
  const result = await readObservedUsage(ctx as never, '2026-01', 'UTC');
  assert.equal(result.coverage.unavailableSessions, 1);
  assert.equal(result.coverage.complete, false);
  await assert.rejects(readObservedUsage(ctx as never, 'bad', 'UTC'));
  await assert.rejects(readObservedUsage(ctx as never, '2026-01', 'Bad/Timezone'));
  assert.equal(requests, 1);
});

test('does not turn invalid, zero, or unsupported precision host cost into free usage', async () => {
  const ctx = { location: { directory: '/repo' }, storage: { async scan() { return { entries: [{key:'owned-session/ses_1',value:'r'}] }; }, async get() { return 'planner'; } }, session: { async get() { return { location: { directory: '/repo' } }; }, async context() { return [0, 1e-13, NaN].map((cost,i) => ({ type:'assistant', id:`msg_${i}`, model:{providerID:'p',id:'m'}, time:{created:Date.parse('2026-01-01T00:00:00Z')}, cost })); } } };
  const result = await readObservedUsage(ctx as never, '2026-01', 'UTC');
  assert.equal(result.summary.total.gross.knownUsd, '0');
  assert.equal(result.summary.total.gross.unknownCount, 3);
});

test('limits scanned sessions and marks the report truncated', async () => {
  let examined = 0;
  const ctx = { location: { directory: '/repo' }, storage: { async scan() { return { entries: Array.from({length: 101}, (_, i) => ({key: `owned-session/ses_${i}`, value: 'r'})) }; }, async get() { return 'coder'; } }, session: { async get() { examined++; return { location: { directory: '/other' } }; }, async context() { throw Error('unexpected'); } } };
  const result = await readObservedUsage(ctx as never, '2026-01', 'UTC');
  assert.equal(examined, 100);
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.coverage.complete, false);
});
