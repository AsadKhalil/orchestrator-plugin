import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPolicy, savePolicy } from '../src/settings.js';

const evidence = { sourceURL: 'https://example.com/pricing', checkedAt: '2026-11-12T00:00:00Z', kind: 'user_entered', verified: false };
const rate = (over: Record<string, unknown> = {}) => ({ inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: null, cacheWritePerMillion: '3.75', billing: 'metered_api', serviceTier: 'standard', interactive: true, conditions: [], evidence, ...over });
const route = (over: Record<string, unknown> = {}) => ({ providerID: 'p', id: 'm', variant: null, vendor: 'acme', canonicalID: 'acme-1', modelVersion: '2026-01', rate: rate(), ...over });
const store = () => { const records = new Map<string, unknown>(); return { records, async get(k: string) { return structuredClone(records.get(k)); }, async set(k: string, v: unknown) { records.set(k, structuredClone(v)); } }; };

test('a new project starts with no routes and a bounded output allowance', async () => {
  assert.deepEqual(await getPolicy(store(), '/repo'), { revision: 0, maxOutputTokens: 8192, coderEnabled: false, routes: [] });
});

test('saves normalised routes and bumps the revision', async () => {
  const s = store();
  const saved = await savePolicy(s, '/repo', 0, { maxOutputTokens: 4096, coderEnabled: false, routes: [route({ rate: rate({ inputPerMillion: '3.0', outputPerMillion: '15.50' }) })] });
  assert.equal(saved.revision, 1); assert.equal(saved.routes[0].rate.inputPerMillion, '3'); assert.equal(saved.routes[0].rate.outputPerMillion, '15.5');
  assert.deepEqual(await getPolicy(s, '/repo'), saved);
  assert.deepEqual(await getPolicy(s, '/other'), { revision: 0, maxOutputTokens: 8192, coderEnabled: false, routes: [] }, 'policy is per project');
});

test('stale revisions are rejected and leave the saved policy alone', async () => {
  const s = store(); await savePolicy(s, '/repo', 0, { maxOutputTokens: 4096, coderEnabled: false, routes: [] });
  await assert.rejects(savePolicy(s, '/repo', 0, { maxOutputTokens: 100, coderEnabled: false, routes: [] }), /stale/i);
  assert.equal((await getPolicy(s, '/repo')).maxOutputTokens, 4096);
  const cas = { ...s, async compareAndSet() { return false; } };
  await assert.rejects(savePolicy(cas, '/repo', 1, { maxOutputTokens: 100, coderEnabled: false, routes: [] }), /stale/i);
  await assert.rejects(savePolicy({ ...s, async compareAndSet() { return 'yes' as never; } }, '/repo', 1, { maxOutputTokens: 100, coderEnabled: false, routes: [] }), /compare-and-set/i);
});

test('rejects malformed rates, evidence, identities and allowances', async () => {
  const bad: [string, unknown][] = [
    ['float rate', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ inputPerMillion: 3 }) })] }],
    ['negative rate', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ outputPerMillion: '-1' }) })] }],
    ['too many decimals', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ outputPerMillion: '1.1234567890123' }) })] }],
    ['unknown billing', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ billing: 'free' }) })] }],
    ['http evidence', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ evidence: { ...evidence, sourceURL: 'http://example.com' } }) })] }],
    ['javascript evidence', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ evidence: { ...evidence, sourceURL: 'javascript:alert(1)' } }) })] }],
    ['bad date', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ evidence: { ...evidence, checkedAt: 'yesterday' } }) })] }],
    ['extra rate field', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ rate: rate({ apiKey: 'secret' }) })] }],
    ['extra route field', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ apiKey: 'secret' })] }],
    ['empty vendor', { maxOutputTokens: 1, coderEnabled: false, routes: [route({ vendor: ' ' })] }],
    ['duplicate route', { maxOutputTokens: 1, coderEnabled: false, routes: [route(), route()] }],
    ['non-boolean coder flag', { maxOutputTokens: 1, coderEnabled: 'yes', routes: [] }],
    ['zero allowance', { maxOutputTokens: 0, coderEnabled: false, routes: [] }],
    ['fractional allowance', { maxOutputTokens: 1.5, routes: [] }],
    ['not an object', null],
  ];
  for (const [name, input] of bad) await assert.rejects(savePolicy(store(), '/repo', 0, input), Error, name);
  const ok = await savePolicy(store(), '/repo', 0, { maxOutputTokens: 1, coderEnabled: false, routes: [route(), route({ variant: 'high' })] });
  assert.equal(ok.routes.length, 2, 'the same model with a different variant is a different route');
});

test('a corrupted stored policy fails closed instead of being trusted', async () => {
  const s = store(); s.records.set('policy/%2Frepo', { revision: 1, maxOutputTokens: 100, coderEnabled: false, routes: [route({ rate: rate({ billing: 'nonsense' }) })] });
  await assert.rejects(getPolicy(s, '/repo'), /invalid/i);
  s.records.set('policy/%2Frepo', { revision: -1, maxOutputTokens: 100, coderEnabled: false, routes: [] });
  await assert.rejects(getPolicy(s, '/repo'), /revision/i);
});
