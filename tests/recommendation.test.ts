import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, type InventoryModel, type Quality } from '../src/catalog.js';
import { recommendRoutes, type RecommendationInput } from '../src/recommendation.js';
import type { Route } from '../src/settings.js';

const NOW = '2026-11-12T12:00:00Z';
const evidence = (checkedAt = '2026-11-10T00:00:00Z') => ({ sourceURL: 'https://example.com/p', checkedAt, kind: 'user_entered' as const, verified: false });
const rate = (input: string, output: string, extra: Partial<Route['rate']> = {}) => ({ inputPerMillion: input, outputPerMillion: output, cacheReadPerMillion: null, cacheWritePerMillion: null, billing: 'metered_api' as const, serviceTier: 'standard', interactive: true, conditions: [], evidence: evidence(), ...extra });
const route = (id: string, vendor: string, r: Route['rate'], variant: string | null = null): Route => ({ providerID: 'p', id, variant, vendor, canonicalID: `canon-${id}`, modelVersion: '1', rate: r });
const model = (id: string, extra: Partial<InventoryModel> = {}): InventoryModel => ({ providerID: 'p', id, enabled: true, status: 'active', variants: [], limit: { context: 200_000, output: 16_000 }, capabilities: { input: ['text'], output: ['text'], tools: true }, ...extra });
const score = (id: string, value: number, source = 'my-notes', testedReasoning: Quality['testedReasoning'] = { variantID: null, effort: null, thinkingMode: null, thinkingBudgetTokens: null }): Quality => ({ canonicalID: `canon-${id}`, modelVersion: '1', testedReasoning, indexVersion: 'v1', value, source });

const routes = [route('cheap', 'cv', rate('1', '2')), route('dear', 'dv', rate('10', '20')), route('stale', 'sv', rate('0.5', '1', { evidence: evidence('2026-01-01T00:00:00Z') })), route('sub', 'uv', rate('0', '0', { billing: 'subscription' })), route('weak', 'wv', rate('0.1', '0.2'))];
const inventory = [model('cheap'), model('dear'), model('stale'), model('sub'), model('weak'), model('off', { enabled: false })];
const ref = (id: string) => ({ providerID: 'p', id, variant: null });
const base = (extra: Partial<RecommendationInput> = {}): RecommendationInput => ({
  role: 'coder', selected: ['cheap', 'dear', 'stale', 'sub', 'weak', 'off'].map(ref), minimumScore: 50, indexVersion: 'v1',
  scores: [score('cheap', 70), score('dear', 90), score('stale', 80), score('sub', 80), score('weak', 20)],
  workload: { inputTokens: 100_000, outputTokens: 10_000 }, remainingBudget: '5', maxOutputTokens: 8192, excludedVendors: [], needs: { image: false, tools: true }, now: NOW, ...extra,
});
const run = async (input: RecommendationInput) => recommendRoutes(await loadCatalog({ listModels: async () => inventory }, { routes }, NOW), inventory, input);
const reasons = (result: Awaited<ReturnType<typeof run>>, id: string) => result.excluded.find(item => item.id === id)?.reasons;

test('the cheapest eligible route wins and every other selected route says why it was excluded', async () => {
  const result = await run(base());
  assert.equal(result.selected?.id, 'cheap'); assert.deepEqual(result.alternatives.map(item => item.id), ['cheap', 'dear']);
  assert.equal(result.selected?.estimatedCash, '0.12'); // 100k in at $1/M + 10k out at $2/M
  assert.ok(reasons(result, 'weak')?.includes('quality_below_floor'));
  assert.ok(reasons(result, 'stale')?.includes('price_evidence_unavailable')); assert.ok(reasons(result, 'stale')?.includes('rate_rate_stale'));
  assert.ok(reasons(result, 'sub')?.includes('cost_unknown')); assert.ok(reasons(result, 'sub')?.includes('rate_billing_unbounded'));
  assert.deepEqual(reasons(result, 'off'), ['unavailable']);
  assert.ok(result.snapshotID.length === 64);
});

test('nothing is recommended without an exactly matching score, or when the budget cannot cover the worst case', async () => {
  const unscored = await run(base({ scores: [] })); assert.equal(unscored.selected, null); assert.ok(reasons(unscored, 'cheap')?.includes('quality_unknown'));
  const wrongConfig = await run(base({ scores: [score('cheap', 70, 'my-notes', { variantID: 'high', effort: null, thinkingMode: null, thinkingBudgetTokens: null })] }));
  assert.ok(reasons(wrongConfig, 'cheap')?.includes('quality_unknown'), 'a score tested at another configuration does not apply');
  const poor = await run(base({ remainingBudget: '0.2' })); // the estimate is $0.12 but the worst-case reservation is $0.216
   assert.equal(poor.selected, null); assert.ok(reasons(poor, 'cheap')?.includes('budget'), 'budget is checked against the worst-case reservation');
  const tight = await run(base({ remainingBudget: '0.00001' })); assert.equal(tight.alternatives.length, 0);
});

test('a reviewer never comes from a vendor that already contributed, and a selection is required', async () => {
  const reviewer = await run(base({ role: 'reviewer', excludedVendors: ['cv'] }));
  assert.equal(reviewer.selected?.id, 'dear'); assert.ok(reasons(reviewer, 'cheap')?.includes('vendor_conflict'));
  const none = await run(base({ selected: [ref('dear')] })); assert.deepEqual(none.alternatives.map(item => item.id), ['dear']); assert.equal(reasons(none, 'cheap'), undefined, 'unselected routes are not listed');
  const missing = await run(base({ selected: [ref('dear'), ref('ghost')] })); assert.equal(missing.excluded.some(item => item.id === 'ghost'), false);
});

test('Artificial Analysis scores are refused without recorded permission, and image or tool needs are enforced', async () => {
  await assert.rejects(run(base({ scores: [score('cheap', 70, 'Artificial Analysis Intelligence Index')] })), /benchmark_source_not_authorized/);
  const image = await run(base({ needs: { image: true, tools: true } })); assert.equal(image.selected, null); assert.ok(reasons(image, 'cheap')?.includes('image_required'));
  const tooBig = await run(base({ workload: { inputTokens: 500_000, outputTokens: 10_000 } })); assert.equal(tooBig.selected, null); assert.ok(reasons(tooBig, 'cheap')?.includes('limits'));
});
