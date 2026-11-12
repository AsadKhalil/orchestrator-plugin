import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenRouterPrices, refreshOpenRouterPrices } from '../src/prices.js';
const now = '2026-01-10T00:00:00.000Z';
const payload = { data: [
  { id: 'vendor/model', pricing: { prompt: '0.000002', completion: '0.00001', request: '0' } },
  { id: 'vendor/tiered', pricing: { prompt: '0.000001', completion: '0.000002', overrides: [{ min_prompt_tokens: 100, prompt: '0.000003' }] } },
  { id: 'openrouter/auto', pricing: { prompt: '0', completion: '0' } },
  { id: 'vendor/unknown', pricing: { prompt: '-1', completion: '0' } },
] };
function store() { let value: unknown; return { async get() { return structuredClone(value); }, async set(v: unknown) { value = structuredClone(v); } }; }

test('normalizes per-token rates exactly and flags conditions and router prices', () => {
  const result = parseOpenRouterPrices(payload, now);
  assert.equal(result.models[0].inputPerMillionUsd, '2');
  assert.equal(result.models[0].outputPerMillionUsd, '10');
  assert.equal(result.models[1].conditional, true);
  assert.equal(result.models[2].dynamicRouter, true);
  assert.equal(result.models[2].inputPerMillionUsd, null);
  assert.equal(result.models[3].inputPerMillionUsd, null);
  assert.ok(result.models.every(m => m.usableForBudget === false));
});

test('rejects malformed and duplicate catalogs rather than replacing a good cache', async () => {
  const cache = store();
  await refreshOpenRouterPrices(cache, async () => new Response(JSON.stringify(payload)), now);
  const later = '2026-01-11T01:00:00.000Z';
  const result = await refreshOpenRouterPrices(cache, async () => new Response(JSON.stringify({ data: [payload.data[0], payload.data[0]] })), later);
  assert.equal(result.status, 'stale');
  assert.equal(result.snapshot.checkedAt, now);
  assert.equal(result.snapshot.models[0].inputPerMillionUsd, '2');
});

test('uses fresh cache without network and reports failure after seven days', async () => {
  const cache = store(); let calls = 0;
  await refreshOpenRouterPrices(cache, async () => { calls++; return new Response(JSON.stringify(payload)); }, now);
  const fresh = await refreshOpenRouterPrices(cache, async () => { calls++; return new Response('', { status: 429 }); }, '2026-01-10T12:00:00.000Z');
  assert.equal(fresh.status, 'fresh'); assert.equal(calls, 1);
  const stale = await refreshOpenRouterPrices(cache, async () => new Response('', { status: 429 }), '2026-01-11T12:00:00.000Z');
  assert.equal(stale.status, 'stale');
  await assert.rejects(refreshOpenRouterPrices(cache, async () => new Response('', { status: 429 }), '2026-01-18T00:00:00.000Z'), /unavailable/i);
});

test('rejects oversized responses and refuses an invalid cache', async () => {
  const cache = store();
  await assert.rejects(refreshOpenRouterPrices(cache, async () => new Response('x', { headers: { 'content-length': '9000000' } }), now), /unavailable/i);
  await cache.set({ checkedAt: now, models: [{ id: 'x', inputPerMillionUsd: '0' }] });
  await assert.rejects(refreshOpenRouterPrices(cache, async () => new Response('', { status: 429 }), now), /unavailable/i);
});
