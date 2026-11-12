import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinQuality, loadCatalog, resolveRate, type CatalogCandidate, type InventoryModel } from '../src/catalog.js';
import type { Route } from '../src/settings.js';
import type { RateCard } from '../src/types.js';

const high = { variantID: 'high', effort: 'high', thinkingMode: null, thinkingBudgetTokens: null };
const low = { ...high, variantID: 'low', effort: 'low' };
const candidates = [
  { canonicalID: 'vendor/model', modelVersion: 'v1', reasoning: high },
  { canonicalID: 'vendor/model', modelVersion: 'v1', reasoning: low },
  { canonicalID: 'vendor/model', modelVersion: 'v1-q4', reasoning: high },
];
const score = { canonicalID: 'vendor/model', modelVersion: 'v1', testedReasoning: high, indexVersion: 'v5', value: 35, source: 'synthetic' };

test('joins a score only to the exact model version and tested effort', () => {
  const result = joinQuality(candidates, [score], 'v5');
  assert.equal(result[0].quality?.value, 35);
  assert.equal(result[1].quality, null);
  assert.equal(result[2].quality, null);
});

test('does not qualify unknown score, index, tested reasoning or mismatched methodology', () => {
  for (const quality of [{ ...score, value: null }, { ...score, indexVersion: null }, { ...score, testedReasoning: null }, { ...score, indexVersion: 'v4' }]) {
    assert.equal(joinQuality([candidates[0]], [quality], 'v5')[0].quality, null);
  }
});

test('does not choose between conflicting benchmark matches', () => {
  const result = joinQuality([candidates[0]], [score, { ...score, value: 36 }], 'v5');
  assert.equal(result[0].quality, null);
  assert.equal(result[0].qualityReason, 'ambiguous');
});

test('does not match malformed or non-finite source data', () => {
  for (const bad of [NaN, Infinity, -1]) assert.equal(joinQuality([candidates[0]], [{ ...score, value: bad }], 'v5')[0].quality, null);
  const malformed = { canonicalID: 'vendor/model', modelVersion: 'v1', reasoning: {} };
  assert.equal(joinQuality([malformed as unknown as typeof candidates[number]], [{ ...score, testedReasoning: {} } as never], 'v5')[0].quality, null);
});

const NOW = '2026-11-12T00:00:00Z';
const rate = (over: Partial<RateCard> = {}): RateCard => ({
  inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: '0.3', cacheWritePerMillion: '3.75', billing: 'metered_api',
  serviceTier: 'standard', interactive: true, conditions: [],
  evidence: { sourceURL: 'https://example.com/prices', checkedAt: '2026-11-01', kind: 'user_entered', verified: false }, ...over,
});
const route = (id: string, variant: string | null = null, r: RateCard = rate()): Route =>
  ({ providerID: 'p', id, variant, vendor: 'vendor', canonicalID: `vendor/${id}`, modelVersion: '1', rate: r });
const model = (id: string, over: Partial<InventoryModel> = {}): InventoryModel => ({
  providerID: 'p', id, name: id, enabled: true, status: 'active', variants: [],
  capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 200000, output: 8192 }, ...over,
});
const hostOf = (...models: InventoryModel[]) => ({ listModels: async () => models });
const candidate = (over: Partial<RateCard> = {}): CatalogCandidate => ({
  providerID: 'p', id: 'm', variant: null, vendor: 'vendor', canonicalID: 'vendor/m', modelVersion: '1', rate: rate(over),
  limit: { context: 200000, output: 8192 }, reasoning: null,
});
const price = (workload: Parameters<typeof resolveRate>[1], over: Partial<RateCard> = {}, now = NOW, options?: { maxEvidenceAgeDays?: number }) =>
  resolveRate(candidate(over), workload, now, options);

test('a candidate needs an exact provider, model and variant route; a variant without its own route is excluded', async () => {
  const snapshot = await loadCatalog(hostOf(model('m', { variants: ['high'] })), { routes: [route('m')] }, NOW);
  assert.deepEqual(snapshot.candidates.map(c => [c.id, c.variant]), [['m', null]]);
  assert.deepEqual(snapshot.excluded, [{ providerID: 'p', id: 'm', variant: 'high', reason: 'no_rate_recorded' }]);
  assert.deepEqual(snapshot.warnings, []);
});

test('a route for one variant never prices the default variant, and carries exact reasoning and host limits', async () => {
  const snapshot = await loadCatalog(hostOf(model('m', { variants: ['high'], limit: { context: 1000, output: 100 } })), { routes: [route('m', 'high')] }, NOW);
  assert.equal(snapshot.candidates.length, 1);
  const [only] = snapshot.candidates;
  assert.deepEqual({ variant: only.variant, vendor: only.vendor, canonicalID: only.canonicalID, modelVersion: only.modelVersion, limit: only.limit },
    { variant: 'high', vendor: 'vendor', canonicalID: 'vendor/m', modelVersion: '1', limit: { context: 1000, output: 100 } });
  assert.deepEqual(only.reasoning, { variantID: 'high', effort: null, thinkingMode: null, thinkingBudgetTokens: null });
  assert.deepEqual(snapshot.excluded, [{ providerID: 'p', id: 'm', variant: null, reason: 'no_rate_recorded' }]);
});

test('the default variant has null reasoning and a catalog candidate joins a benchmark by its exact variant', async () => {
  const snapshot = await loadCatalog(hostOf(model('m', { variants: ['high'] })), { routes: [route('m'), route('m', 'high')] }, NOW);
  const [base, withHigh] = snapshot.candidates;
  assert.equal(base.reasoning, null);
  const result = joinQuality([base, withHigh], [{ canonicalID: 'vendor/m', modelVersion: '1', testedReasoning: high, indexVersion: 'v5', value: 7, source: 'synthetic' }], 'v5');
  assert.equal(result[0].quality, null);
  assert.equal(result[1].quality, null, 'a bare variant name does not claim a tested effort');
  const tested = { ...withHigh, reasoning: high };
  assert.equal(joinQuality([tested], [{ canonicalID: 'vendor/m', modelVersion: '1', testedReasoning: high, indexVersion: 'v5', value: 7, source: 'synthetic' }], 'v5')[0].quality?.value, 7);
});

test('disabled and deprecated models are unavailable, even for their variants', async () => {
  const snapshot = await loadCatalog(hostOf(
    model('off', { enabled: false, variants: ['high'] }), model('old', { status: 'deprecated' }), model('fresh', { variants: ['high'] }),
  ), { routes: [route('off'), route('off', 'high'), route('old'), route('fresh', 'high')] }, NOW);
  assert.deepEqual(snapshot.candidates.map(c => [c.id, c.variant]), [['fresh', 'high']]);
  assert.deepEqual(snapshot.excluded.map(e => [e.id, e.variant, e.reason]), [
    ['fresh', null, 'no_rate_recorded'], ['off', null, 'unavailable'], ['off', 'high', 'unavailable'], ['old', null, 'unavailable'],
  ]);
  assert.deepEqual(snapshot.warnings, []);
});

test('a model with no policy route is excluded, not guessed', async () => {
  const snapshot = await loadCatalog(hostOf(model('unpriced')), { routes: [] }, NOW);
  assert.deepEqual(snapshot.candidates, []);
  assert.deepEqual(snapshot.excluded, [{ providerID: 'p', id: 'unpriced', variant: null, reason: 'no_rate_recorded' }]);
});

test('a policy route with no host model is a warning and never a candidate', async () => {
  const snapshot = await loadCatalog(hostOf(model('m')), { routes: [route('m'), route('gone'), route('m', 'xhigh')] }, NOW);
  assert.deepEqual(snapshot.candidates.map(c => c.id), ['m']);
  assert.deepEqual(snapshot.warnings, ['route_without_host_model:p/gone', 'route_without_host_model:p/m#xhigh']);
  assert.deepEqual(snapshot.excluded, []);
});

test('an unmatched provider is not matched on model id alone', async () => {
  const other = { ...route('m'), providerID: 'other' };
  const snapshot = await loadCatalog(hostOf(model('m')), { routes: [other] }, NOW);
  assert.deepEqual(snapshot.candidates, []);
  assert.deepEqual(snapshot.warnings, ['route_without_host_model:other/m']);
  assert.equal(snapshot.excluded[0].reason, 'no_rate_recorded');
});

test('snapshot ids are deterministic, order independent, and change with any rate or identity', async () => {
  const models = [model('a', { variants: ['high'] }), model('b')];
  const routes = [route('a'), route('a', 'high'), route('b')];
  const first = await loadCatalog(hostOf(...models), { routes }, NOW);
  const again = await loadCatalog(hostOf(...[...models].reverse()), { routes: [...routes].reverse() }, '2026-11-13T00:00:00Z');
  assert.match(first.id, /^[0-9a-f]{64}$/);
  assert.equal(again.id, first.id);
  assert.deepEqual(again.candidates, first.candidates);
  assert.equal(first.createdAt, NOW);
  const reordered = routes.map(r => ({ ...r, rate: Object.fromEntries(Object.entries(r.rate).reverse()) as unknown as RateCard }));
  assert.equal((await loadCatalog(hostOf(...models), { routes: reordered }, NOW)).id, first.id);
  const changed = [routes[0], routes[1], route('b', null, rate({ outputPerMillion: '15.000001' }))];
  assert.notEqual((await loadCatalog(hostOf(...models), { routes: changed }, NOW)).id, first.id);
  const reevidenced = [routes[0], routes[1], route('b', null, rate({ evidence: { ...rate().evidence, checkedAt: '2026-11-02' } }))];
  assert.notEqual((await loadCatalog(hostOf(...models), { routes: reevidenced }, NOW)).id, first.id);
  assert.notEqual((await loadCatalog(hostOf(...models), { routes: [routes[0], routes[2]] }, NOW)).id, first.id);
});

test('a snapshot does not alias the policy rates', async () => {
  const routes = [route('m')];
  const snapshot = await loadCatalog(hostOf(model('m')), { routes }, NOW);
  snapshot.candidates[0].rate.inputPerMillion = '999';
  assert.equal(routes[0].rate.inputPerMillion, '3');
});

test('resolveRate is exact: 200000 input at $3/M plus 8192 output at $15/M is 0.72288', () => {
  const result = price({ inputTokens: 200000, outputTokens: 8192 });
  assert.equal(result.ok && result.usd, '0.72288');
  assert.ok(result.ok && result.basis.includes('evidence:user_entered') && result.basis.includes('checkedAt:2026-11-01'));
  assert.equal(result.ok && result.rate.inputPerMillion, '3');
  assert.equal((price({ inputTokens: 0, outputTokens: 0 }) as { usd: string }).usd, '0');
});

test('resolveRate prices cache reads and writes at their own rates', () => {
  const result = price({ inputTokens: 200000, outputTokens: 8192, cacheReadTokens: 1_000_000, cacheWriteTokens: 2_000_000 });
  assert.equal(result.ok && result.usd, '8.52288'); // 0.72288 + 1M x $0.30/M + 2M x $3.75/M
});

test('resolveRate rounds the total up at the 12th decimal and never down', () => {
  const tiny = { inputPerMillion: '0.0000005' };
  assert.equal((price({ inputTokens: 1, outputTokens: 0 }, tiny) as { usd: string }).usd, '0.000000000001'); // 5e-13 -> 1e-12
  assert.equal((price({ inputTokens: 3, outputTokens: 0 }, tiny) as { usd: string }).usd, '0.000000000002'); // 1.5e-12 -> 2e-12
  assert.equal((price({ inputTokens: 2, outputTokens: 0 }, tiny) as { usd: string }).usd, '0.000000000001'); // exactly 1e-12
  assert.equal((price({ inputTokens: 1, outputTokens: 1 }, { inputPerMillion: '0.0000004', outputPerMillion: '0.0000004' }) as { usd: string }).usd, '0.000000000001');
});

test('resolveRate is exact for very large token counts', () => {
  const big = Number.MAX_SAFE_INTEGER;
  const result = price({ inputTokens: big, outputTokens: 0 }, { inputPerMillion: '3' });
  assert.equal(result.ok && result.usd, '27021597764.222973'); // 9007199254740991 x 3 / 1e6, exact where a float would round
});

test('resolveRate refuses what is not a bounded, current, unconditional metered price', () => {
  const w = { inputTokens: 1, outputTokens: 1 };
  assert.deepEqual(price(w, { billing: 'subscription' }), { ok: false, reason: 'billing_unbounded' });
  assert.deepEqual(price(w, { billing: 'local' }), { ok: false, reason: 'billing_unbounded' });
  assert.deepEqual(price(w, { conditions: ['long context over 200k'] }), { ok: false, reason: 'rate_conditions' });
  assert.deepEqual(price(w, { evidence: { ...rate().evidence, checkedAt: '2026-09-01' } }), { ok: false, reason: 'rate_stale' });
  assert.deepEqual(price({ ...w, cacheReadTokens: 1 }, { cacheReadPerMillion: null }), { ok: false, reason: 'rate_incomplete' });
  assert.deepEqual(price({ ...w, cacheWriteTokens: 1 }, { cacheWritePerMillion: null }), { ok: false, reason: 'rate_incomplete' });
  const noCache = price({ ...w, cacheReadTokens: 0, cacheWriteTokens: 0 }, { cacheReadPerMillion: null, cacheWritePerMillion: null });
  assert.equal(noCache.ok && noCache.usd, '0.000018', 'null cache rates only matter when cache tokens are used');
  assert.deepEqual(price(w, { inputPerMillion: '1e3' }), { ok: false, reason: 'rate_incomplete' });
});

test('resolveRate evidence age: 45 days is allowed, 46 is stale, future and unparsable dates are stale', () => {
  const w = { inputTokens: 1, outputTokens: 1 };
  const at = (checkedAt: string, now = NOW, options?: { maxEvidenceAgeDays?: number }) =>
    price(w, { evidence: { ...rate().evidence, checkedAt } }, now, options);
  assert.equal(at('2026-09-28').ok, true);
  assert.deepEqual(at('2026-09-27'), { ok: false, reason: 'rate_stale' });
  assert.equal(at('2026-09-27T00:00:00Z').ok, false);
  assert.equal(at('2026-09-28T00:00:00Z').ok, true);
  assert.deepEqual(at('2026-11-12T00:00:01Z'), { ok: false, reason: 'rate_stale' });
  assert.deepEqual(at('2026-11-13'), { ok: false, reason: 'rate_stale' });
  assert.equal(at('2026-11-12T00:00:00Z').ok, true);
  for (const bad of ['', 'yesterday', '2026-13-45', '11/01/2026', '2026-11-01T00:00:00', '1', 'Nov 1 2026']) assert.deepEqual(at(bad), { ok: false, reason: 'rate_stale' }, bad);
  assert.deepEqual(at('2026-11-01', NOW, { maxEvidenceAgeDays: 5 }), { ok: false, reason: 'rate_stale' });
  assert.equal(at('2026-11-01', NOW, { maxEvidenceAgeDays: 11 }).ok, true);
  assert.equal(at('2026-11-01', NOW, { maxEvidenceAgeDays: 10 }).ok, false);
});

test('resolveRate throws on invalid workloads, limits or time rather than pricing them', () => {
  for (const bad of [1.5, -1, NaN, Infinity, 2 ** 53]) {
    assert.throws(() => price({ inputTokens: bad, outputTokens: 1 }), /Invalid workload/);
    assert.throws(() => price({ inputTokens: 1, outputTokens: bad }), /Invalid workload/);
    assert.throws(() => price({ inputTokens: 1, outputTokens: 1, cacheReadTokens: bad }), /Invalid workload/);
    assert.throws(() => price({ inputTokens: 1, outputTokens: 1, cacheWriteTokens: bad }), /Invalid workload/);
  }
  assert.throws(() => price({ inputTokens: 1, outputTokens: 1 }, {}, 'not a time'), /Invalid time/);
  assert.throws(() => price({ inputTokens: 1, outputTokens: 1 }, {}, NOW, { maxEvidenceAgeDays: -1 }), /Invalid evidence age limit/);
});
