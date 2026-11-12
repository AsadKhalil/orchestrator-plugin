import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCosts } from '../src/comparison.js';

const period = { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' };
const usage = [
  { id: 'a', at: '2026-01-05T00:00:00.000Z', providerID: 'openai', route: 'api', grossUsd: '60' },
  { id: 'b', at: '2026-01-06T00:00:00.000Z', providerID: 'anthropic', route: 'api', grossUsd: '20' },
  { id: 'c', at: '2026-01-07T00:00:00.000Z', providerID: 'other', route: 'api', grossUsd: '10' },
];
const subscription = { feeUsd: '100', credits: [{ id: 'credit', providerID: 'openai', route: 'api', amountUsd: '60', startsAt: period.from, expiresAt: period.to, claimed: true, eligibility: 'eligible' as const, balance: 'unverified' as const }], nativeOverageUsd: null, independentReviewUsd: '5' };

test('compares a fee plus uncovered usage rather than subtracting a credit from the fee', () => {
  const result = compareCosts({ period, usage, subscription, operatingUsd: '0' });
  assert.equal(result.apiOnly.knownUsd, '90');
  assert.equal(result.keepSubscription.knownUsd, '130');
  assert.equal(result.keepSubscription.incrementalKnownUsd, '30');
  assert.equal(result.keepSubscription.creditAppliedUsd, '60');
  assert.equal(result.keepSubscription.unverifiedCreditUsd, '60');
  assert.equal(result.nativeSubscription.totalUsd, null);
});

test('credits apply only to matching provider, route and time; unclaimed and ineligible credit never applies', () => {
  const credits = [
    { ...subscription.credits[0], amountUsd: '25', startsAt: '2026-01-06T00:00:00.000Z' },
    { ...subscription.credits[0], id: 'unclaimed', claimed: false },
    { ...subscription.credits[0], id: 'wrong-route', route: 'subscription' },
    { ...subscription.credits[0], id: 'ineligible', eligibility: 'ineligible' as const },
  ];
  const result = compareCosts({ period, usage, subscription: { ...subscription, credits }, operatingUsd: '2' });
  assert.equal(result.apiOnly.knownUsd, '92');
  assert.equal(result.keepSubscription.creditAppliedUsd, '0');
  assert.equal(result.keepSubscription.knownUsd, '192');
});

test('allocates only remaining partial-cycle credit, expires it, and keeps unknown amounts partial', () => {
  const credits = [{ ...subscription.credits[0], amountUsd: '20', expiresAt: '2026-01-06T00:00:00.000Z', balance: 'verified' as const }];
  const result = compareCosts({ period, usage: [...usage, { ...usage[1], id: 'd', grossUsd: null }], subscription: { ...subscription, credits, nativeOverageUsd: '3' }, operatingUsd: '2' });
  assert.equal(result.apiOnly.knownUsd, '92');
  assert.equal(result.apiOnly.unknownCount, 1);
  assert.equal(result.keepSubscription.knownUsd, '172');
  assert.equal(result.keepSubscription.unknownCount, 1);
  assert.equal(result.nativeSubscription.totalUsd, '110');
});

test('rejects duplicate usage or credit identities and invalid periods', () => {
  assert.throws(() => compareCosts({ period, usage: [...usage, usage[0]], subscription, operatingUsd: '0' }));
  assert.throws(() => compareCosts({ period, usage, subscription: { ...subscription, credits: [subscription.credits[0], subscription.credits[0]] }, operatingUsd: '0' }));
  assert.throws(() => compareCosts({ period: { ...period, to: period.from }, usage, subscription, operatingUsd: '0' }));
});

test('does not assume a credit remains after an earlier unknown charge could consume it', () => {
  const earlyUnknown = { ...usage[0], id: 'unknown', at: '2026-01-02T00:00:00.000Z', grossUsd: null };
  const result = compareCosts({ period, usage: [earlyUnknown, ...usage], subscription, operatingUsd: '0' });
  assert.equal(result.keepSubscription.creditAppliedUsd, '0');
  assert.equal(result.keepSubscription.unknownCount, 1);
});

test('manual scenarios compare replacement and incremental costs without treating a subscription fee as credit', async () => {
  const { compareMonthlyScenario } = await import('../src/comparison.js');
  assert.deepEqual(compareMonthlyScenario({ apiUsd: '30.125', feeUsd: '100', nativeOverageUsd: '5', independentReviewUsd: '10' }), {
    apiOnlyUsd: '30.125', keepSubscriptionTotalUsd: '130.125', keepSubscriptionIncrementalUsd: '30.125', nativeSubscriptionUsd: '115',
  });
  assert.throws(() => compareMonthlyScenario({ apiUsd: '', feeUsd: '100', nativeOverageUsd: '0', independentReviewUsd: '0' }), /invalid/i);
});
