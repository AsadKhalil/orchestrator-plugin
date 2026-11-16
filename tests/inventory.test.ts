import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProjectModels } from '../src/inventory.js';
import { usdString } from '../src/costs.js';

test('returns project model routes without credentials or provider request settings', async () => {
  const calls: unknown[] = [];
  const data = [
    { providerID: 'first', id: 'm', name: 'M', enabled: true, status: 'active', variants: [{ id: 'high', settings: { apiKey: 'variant-secret' } }], capabilities: { input: ['text', 'image'], output: ['text'], tools: true }, settings: { apiKey: 'secret' }, limit: { context: 100, output: 10 } },
    { providerID: 'second', id: 'm', name: 'M', enabled: false, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, settings: { apiKey: 'secret2' }, limit: { context: 100, output: 10 } },
  ];
  const ctx = { location: { directory: '/repo' }, model: { async list(input: unknown) { calls.push(input); return { data }; } } };
  const result = await listProjectModels(ctx as never);
  assert.deepEqual(calls, [{ location: { directory: '/repo' } }]);
  assert.deepEqual(result.map(x => [x.providerID, x.id, x.variants, x.enabled]), [['first', 'm', ['high'], true], ['second', 'm', [], false]]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal('settings' in result[0], false);
});

test('propagates inventory failures rather than returning an empty catalog', async () => {
  const ctx = { location: { directory: '/repo' }, model: { async list() { throw new Error('host unavailable'); } } };
  await assert.rejects(listProjectModels(ctx as never), /host unavailable/);
});

test('refreshes inventory on each request instead of caching incomplete startup data', async () => {
  const model = { providerID: 'p', id: 'm', name: 'M', enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } };
  let ready = false;
  const ctx = { location: { directory: '/repo' }, model: { async list() { return { data: ready ? [model] : [] }; } } };
  assert.deepEqual(await listProjectModels(ctx as never), []);
  ready = true;
  assert.equal((await listProjectModels(ctx as never))[0].id, 'm');
});

test('a host price becomes a string, and anything doubtful becomes unknown', () => {
  for (const [value, text] of [[0.24, '0.24'], [0, '0'], [10, '10'], [0.1 + 0.2, '0.3'], [0.000001, '0.000001'], [1234.5, '1234.5']] as const) assert.equal(usdString(value), text);
  for (const value of [0.0000004, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e21, '0.24', null, undefined]) assert.equal(usdString(value), null);
});

const record = (extra: object) => ({ providerID: 'p', id: 'm', name: 'Model', enabled: true, status: 'active', variants: [{ id: 'high', settings: { apiKey: 'hidden' } }], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 }, headers: { authorization: 'secret' }, ...extra });
const host = (data: unknown[], seen: unknown[] = []) => ({ location: { directory: '/repo' }, model: { async list(input: unknown) { seen.push(input); return { data }; } } }) as never;

test('each model carries its base price as strings, and no secrets', async () => {
  const [one, tiers, none, bare] = await listProjectModels(host([
    record({ cost: [{ input: 0.15, output: 0.6, cache: { read: 0.003, write: 0 } }] }),
    record({ cost: [{ tier: { type: 'context', size: 200000 }, input: 2, output: 8, cache: { read: 0, write: 0 } }, { input: 1, output: 4, cache: { read: 0, write: 0 } }] }),
    record({ cost: [] }), record({}),
  ]));
  assert.deepEqual(one.cost, { inputPerMillion: '0.15', outputPerMillion: '0.6', cacheReadPerMillion: '0.003', tiered: false });
  assert.deepEqual(tiers.cost, { inputPerMillion: '1', outputPerMillion: '4', cacheReadPerMillion: '0', tiered: true });
  for (const model of [none, bare]) assert.deepEqual(model.cost, { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, tiered: false });
  assert.equal(/secret|hidden/.test(JSON.stringify([one, tiers, none, bare])), false);
});

test('decision models are asked for by type, and chat models as before', async () => {
  const seen: unknown[] = [];
  await listProjectModels(host([], seen)); await listProjectModels(host([], seen), 'decision');
  assert.deepEqual(seen, [{ location: { directory: '/repo' } }, { location: { directory: '/repo' }, types: ['decision'] }]);
});
