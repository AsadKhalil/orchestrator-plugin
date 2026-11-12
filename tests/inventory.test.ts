import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProjectModels } from '../src/inventory.js';

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
