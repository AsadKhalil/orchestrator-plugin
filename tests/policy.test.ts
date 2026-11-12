import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/policy.js';

const make = (id: string, overrides = {}) => ({ canonicalID: `vendor/${id}`, modelVersion: 'v1', reasoning: { variantID: 'high', effort: 'high', thinkingMode: null, thinkingBudgetTokens: null }, providerID: 'host', id, variant: 'high', vendor: `vendor-${id}`, enabled: true, input: ['text', 'image'], tools: true, context: 1000, output: 100, latencyMode: 'interactive' as const, quality: { value: 35, indexVersion: 'v5', source: 'synthetic' }, estimatedCash: '0.2', reservationGross: '0.5', priceEvidence: { providerID: 'host', id, variant: 'high', source: 'synthetic-price', quotedAt: '2026-01-01T00:00:00.000Z', validUntil: '2026-01-02T00:00:00.000Z', upperBound: true }, ...overrides });
const policy = { role: 'coder' as const, selected: [{ providerID: 'host', id: 'a', variant: 'high' }, { providerID: 'host', id: 'b', variant: 'high' }], minimumScore: 25, indexVersion: 'v5', authorizedSources: ['synthetic'], excludedVendors: [] as string[], remainingBudget: '1', asOf: '2026-01-01T12:00:00.000Z', authorizedPriceSources: ['synthetic-price'], needs: { image: false, tools: true, context: 500, output: 50, latencyMode: 'interactive' as const } };

function recommendWithFixtures(candidates: ReturnType<typeof make>[], selection: typeof policy | (Omit<typeof policy, 'role'> & { role: 'reviewer' })) {
  const scores = candidates.flatMap(c => c.quality ? [{ ...c.quality, canonicalID: c.canonicalID, modelVersion: c.modelVersion, testedReasoning: c.reasoning }] : []);
  return recommend(candidates, selection, scores);
}

test('chooses the lowest estimated cost among selected qualifying options', () => {
  const result = recommendWithFixtures([make('a', { estimatedCash: '0.3' }), make('b', { estimatedCash: '0.1' }), make('c', { estimatedCash: '0.01' })], policy);
  assert.equal(result.selected?.id, 'b');
  assert.ok(result.excluded.find(x => x.id === 'c')?.reasons.includes('not_selected'));
});

test('excludes unscored, insufficient, unpriced and incompatible options', () => {
  const result = recommendWithFixtures([make('a', { quality: { value: 24, indexVersion: 'v5', source: 'synthetic' } }), make('b', { input: ['text'], estimatedCash: null })], { ...policy, needs: { ...policy.needs, image: true } });
  assert.equal(result.selected, null);
  assert.ok(result.excluded.find(x => x.id === 'a')?.reasons.includes('quality_below_floor'));
  assert.ok(result.excluded.find(x => x.id === 'b')?.reasons.includes('image_required'));
  assert.ok(result.excluded.find(x => x.id === 'b')?.reasons.includes('cost_unknown'));
});

test('reviewer cannot use a contributing vendor even through a different provider', () => {
  const result = recommendWithFixtures([make('a', { vendor: 'vendor-planner' }), make('b')], { ...policy, role: 'reviewer', excludedVendors: ['vendor-planner', 'vendor-b'] });
  assert.equal(result.selected, null);
  assert.ok(result.excluded.every(x => x.reasons.includes('vendor_conflict')));
});

test('does not use batch pricing for interactive tasks or gross reservations beyond budget', () => {
  const result = recommendWithFixtures([make('a', { latencyMode: 'batch' }), make('b', { reservationGross: '1.1' })], policy);
  assert.equal(result.selected, null);
  assert.ok(result.excluded[0].reasons.includes('latency_mode'));
  assert.ok(result.excluded[1].reasons.includes('budget'));
});

test('rejects unknown or unauthorized quality and does not turn unknown price into zero', () => {
  const result = recommendWithFixtures([
    make('a', { quality: null, estimatedCash: '0.01' }),
    make('b', { quality: { value: 40, indexVersion: 'v5', source: 'unapproved' }, estimatedCash: null }),
  ], policy);
  assert.equal(result.selected, null);
  assert.ok(result.excluded[0].reasons.includes('quality_unknown'));
  assert.ok(result.excluded[1].reasons.includes('quality_unknown'));
  assert.ok(result.excluded[1].reasons.includes('cost_unknown'));
});

test('does not trust an attached high-effort score for a low-effort candidate', () => {
  const low = { ...make('a'), variant: 'low', canonicalID: 'vendor/model', modelVersion: 'v1', reasoning: { variantID: 'low', effort: 'low', thinkingMode: null, thinkingBudgetTokens: null } };
  const score = { canonicalID: 'vendor/model', modelVersion: 'v1', testedReasoning: { variantID: 'high', effort: 'high', thinkingMode: null, thinkingBudgetTokens: null }, indexVersion: 'v5', value: 50, source: 'synthetic' };
  const selected = [{ providerID: 'host', id: 'a', variant: 'low' }];
  const result = recommend([low], { ...policy, selected }, [score]);
  assert.equal(result.selected, null);
  assert.ok(result.excluded[0].reasons.includes('quality_unknown'));
});

test('rejects a candidate whose selected variant contradicts its reasoning configuration', () => {
  const candidate = { ...make('a'), variant: 'low' };
  const selected = [{ providerID: 'host', id: 'a', variant: 'low' }];
  const result = recommendWithFixtures([candidate], { ...policy, selected });
  assert.equal(result.selected, null);
  assert.ok(result.excluded[0].reasons.includes('variant_mismatch'));
});

test('project recommendations read the role allowlist and current host availability', async () => {
  const { recommendForProject } = await import('../src/policy.js');
  const { saveSelections } = await import('../src/settings.js');
  const records = new Map<string, unknown>();
  const storage = { async get(key: string) { return records.get(key); }, async set(key: string, value: unknown) { records.set(key, value); } };
  let available = ['a', 'b', 'c'];
  const context = { storage, location: { directory: '/project' }, model: { async list() { return { data: available.map(id => ({ providerID: 'host', id, name: id, enabled: true, status: 'active', variants: [{ id: 'high' }], capabilities: { input: ['text', 'image'], output: ['text'], tools: true }, limit: { context: 1000, output: 100 } })) }; } } };
  const choices = { planner: [], coder: [{ providerID: 'host', id: 'a', variant: 'high' }], reviewer: [] };
  await saveSelections(storage, '/project', 0, choices, [{ providerID: 'host', id: 'a', enabled: true, status: 'active', variants: ['high'] }]);
  const candidates = [make('a', { estimatedCash: '0.3' }), make('b', { estimatedCash: '0.1' }), make('c', { estimatedCash: '0.01' })];
  const scores = candidates.map(c => ({ ...c.quality, canonicalID: c.canonicalID, modelVersion: c.modelVersion, testedReasoning: c.reasoning }));
  const result = await recommendForProject(context as never, candidates, policy, scores);
  assert.equal(result.selected?.id, 'a');
  assert.equal(result.selectionRevision, 1);
  assert.ok(result.excluded.find(x => x.id === 'c')?.reasons.includes('not_selected'));
  const noVision = { ...context, model: { async list() { return { data: [{ providerID: 'host', id: 'a', name: 'a', enabled: true, status: 'active', variants: [{ id: 'high' }], capabilities: { input: ['text'], output: ['text'], tools: false }, limit: { context: 100, output: 10 } }] }; } } };
  const incompatible = await recommendForProject(noVision as never, candidates, { ...policy, needs: { ...policy.needs, image: true } }, scores);
  assert.ok(incompatible.excluded.find(x => x.id === 'a')?.reasons.includes('image_required'));
  assert.ok(incompatible.excluded.find(x => x.id === 'a')?.reasons.includes('tools_required'));
  assert.ok(incompatible.excluded.find(x => x.id === 'a')?.reasons.includes('limits'));
  available = ['b', 'c'];
  const disconnected = await recommendForProject(context as never, candidates, policy, scores);
  assert.equal(disconnected.selected, null);
  assert.ok(disconnected.excluded.find(x => x.id === 'a')?.reasons.includes('unavailable'));
  const reviewer = await recommendForProject(context as never, candidates, { ...policy, role: 'reviewer' }, scores);
  assert.equal(reviewer.selected, null);
});

test('rejects stale, mismatched and unbounded price evidence', () => {
  const a = make('a');
  for (const patch of [
    { validUntil: '2026-01-01T12:00:00.000Z' },
    { quotedAt: '2026-01-01T13:00:00.000Z' },
    { providerID: 'another-route' }, { id: 'another-model' }, { variant: 'low' },
    { source: 'unapproved' }, { upperBound: false },
  ]) {
    const candidate = { ...a, priceEvidence: { ...a.priceEvidence, ...patch } };
    const result = recommendWithFixtures([candidate], policy);
    assert.equal(result.selected, null);
    assert.ok(result.excluded[0].reasons.includes('price_evidence_unavailable'));
  }
  const missing = recommendWithFixtures([{ ...a, priceEvidence: null } as never], policy);
  assert.ok(missing.excluded[0].reasons.includes('price_evidence_unavailable'));
});

test('rejects price quotes older than seven days even when their declared expiry is later', () => {
  const candidate = make('a', { priceEvidence: { ...make('a').priceEvidence, validUntil: '2026-01-20T00:00:00.000Z' } });
  assert.equal(recommendWithFixtures([candidate], { ...policy, asOf: '2026-01-08T00:00:00.000Z' }).selected?.id, 'a');
  const stale = recommendWithFixtures([candidate], { ...policy, asOf: '2026-01-08T00:00:00.001Z' });
  assert.equal(stale.selected, null);
  assert.ok(stale.excluded[0].reasons.includes('price_evidence_unavailable'));
});

test('does not accept cash estimates above the gross reservation', () => {
  const result = recommendWithFixtures([make('a', { estimatedCash: '0.6', reservationGross: '0.5' })], policy);
  assert.equal(result.selected, null);
  assert.ok(result.excluded[0].reasons.includes('inconsistent_cost'));
});
