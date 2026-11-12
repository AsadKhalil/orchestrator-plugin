import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCosts, meteredUsageForComparison, summarizeRuns } from '../src/comparison.js';
import { newRun, type Run } from '../src/run.js';
import type { UsageRecord } from '../src/types.js';

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

const T = Date.parse('2026-01-10T00:00:00.000Z');
function run(id: string, state: Run['state'], createdAt = T, endedAt: number | null = null, repairRounds = 0): Run {
  return { ...newRun(id, 'fixture requirement', 'base', createdAt), state, endedAt, review: repairRounds ? { repairRounds } as NonNullable<Run['review']> : null };
}
function attempt(attemptID: string, runID: string, grossUsd: string | null, startedAt = '2026-01-10T01:00:00.000Z', revision = 0, billing: UsageRecord['billing'] = 'metered_api', providerID = 'openai'): UsageRecord {
  return { attemptID, revision, startedAt, grossUsd, creditUsd: null, cashUsd: null, provenance: 'provider_reported', providerID, modelID: 'm', effort: null, role: 'coder', projectID: 'p', runID, stage: 'implement', sessionID: 's', messageID: null, inputTokens: null, outputTokens: null, reasoningTokens: null, billedOutputTokens: null, reasoningIncludedInOutput: null, serviceTier: null, billing };
}

test('cost per accepted feature is undefined, not zero, when nothing was accepted', () => {
  const m = summarizeRuns([run('r1', 'needs_attention'), run('r2', 'cancelled')], [attempt('a', 'r1', '5')], period);
  assert.equal(m.costPerAcceptedUsd, null);
  assert.deepEqual(m.spend, { knownUsd: '5', unknownCount: 0 });
  assert.equal(m.accepted, 0);
});

test('failed, repair and auxiliary attempts stay in the cost of the accepted features', () => {
  const runs = [run('ok', 'accepted', T, T + 60_000, 1), run('bad', 'needs_attention', T, T + 30_000, 2), run('live', 'reviewing'), run('ready', 'ready_for_acceptance', T, T + 5)];
  const usage = [attempt('1', 'ok', '3'), attempt('2', 'ok', '1.5', undefined, 0, 'metered_api', 'anthropic'), attempt('3', 'bad', '5'), attempt('4', 'ready', '0.5'), attempt('5', 'stranger', '99')];
  assert.deepEqual(summarizeRuns(runs, usage, period), {
    runs: 4, accepted: 1, completed: 2, unresolved: 1, inProgress: 1, repairRounds: 3, elapsedMs: 90_005,
    spend: { knownUsd: '10', unknownCount: 0 }, costPerAcceptedUsd: '10', partial: false,
  });
});

test('unknown amounts mark the totals partial and are never treated as zero', () => {
  const m = summarizeRuns([run('a', 'accepted'), run('b', 'accepted')], [attempt('1', 'a', '2'), attempt('2', 'b', null)], period);
  assert.deepEqual(m.spend, { knownUsd: '2', unknownCount: 1 });
  assert.equal(m.partial, true);
  assert.equal(m.costPerAcceptedUsd, '1');
});

test('cost per accepted divides exactly and rounds up at 12 places', () => {
  const runs = [run('a', 'accepted'), run('b', 'accepted'), run('c', 'accepted')];
  assert.equal(summarizeRuns(runs, [attempt('1', 'a', '1')], period).costPerAcceptedUsd, '0.333333333334');
});

test('period is half open: attempts and runs at the end instant are excluded, at the start included', () => {
  const runs = [run('in', 'accepted', Date.parse(period.from)), run('out', 'accepted', Date.parse(period.to)), run('before', 'accepted', Date.parse(period.from) - 1)];
  const usage = [attempt('1', 'in', '1', period.from), attempt('2', 'in', '2', period.to), attempt('3', 'in', '4', '2025-12-31T23:59:59.999Z'), attempt('4', 'out', '8', period.from)];
  const m = summarizeRuns(runs, usage, period);
  assert.equal(m.runs, 1);
  assert.equal(m.spend.knownUsd, '1');
  assert.throws(() => summarizeRuns(runs, usage, { ...period, to: period.from }));
});

test('duplicate usage revisions count once at the highest revision; conflicting replays are rejected', () => {
  const runs = [run('a', 'accepted')];
  const usage = [attempt('1', 'a', '1', undefined, 0), attempt('1', 'a', '2', undefined, 1), attempt('1', 'a', '2', undefined, 1)];
  assert.equal(summarizeRuns(runs, usage, period).spend.knownUsd, '2');
  assert.equal(summarizeRuns(runs, [...usage].reverse(), period).spend.knownUsd, '2');
  assert.throws(() => summarizeRuns(runs, [attempt('1', 'a', '1'), attempt('1', 'a', '2')], period), /replay/);
  assert.throws(() => summarizeRuns(runs, [attempt('1', 'a', '1'), attempt('1', 'a', '1', '2026-01-11T00:00:00.000Z', 1)], period), /identity/);
  assert.throws(() => summarizeRuns([run('a', 'accepted'), run('a', 'accepted')], [], period), /Duplicate/);
});

test('only metered API usage becomes dollars; subscription and local attempts are counted, not priced', () => {
  const records = [
    attempt('o', 'r', '60', '2026-01-05T00:00:00.000Z', 0, 'metered_api', 'openai'),
    attempt('a', 'r', '20', '2026-01-06T00:00:00.000Z', 0, 'metered_api', 'anthropic'),
    attempt('x', 'r', '10', '2026-01-07T00:00:00.000Z', 0, 'metered_api', 'other'),
    attempt('s', 'r', null, '2026-01-08T00:00:00.000Z', 0, 'subscription', 'anthropic'),
    attempt('l', 'r', '0', '2026-01-08T00:00:00.000Z', 0, 'local', 'ollama'),
    attempt('u', 'r', null, '2026-01-09T00:00:00.000Z', 0, 'metered_api', 'openai'),
    attempt('x', 'r', '10', '2026-01-07T00:00:00.000Z', 0, 'metered_api', 'other'),
  ];
  const { usage, nonMetered } = meteredUsageForComparison(records);
  assert.deepEqual(nonMetered, { subscription: 1, local: 1 });
  assert.deepEqual(usage.map(u => [u.id, u.providerID, u.route, u.grossUsd]), [['o', 'openai', 'api', '60'], ['a', 'anthropic', 'api', '20'], ['x', 'other', 'api', '10'], ['u', 'openai', 'api', null]]);
  const result = compareCosts({ period, usage, subscription, operatingUsd: '0' });
  assert.deepEqual(result.apiOnly, { knownUsd: '90', unknownCount: 1 });
  assert.equal(result.keepSubscription.knownUsd, '130');
});

test('the plan example: $60 + $20 + $10 gross is $90 API-only and $130 with a $100 subscription covering $60', () => {
  const { usage } = meteredUsageForComparison([
    attempt('o', 'r', '60', '2026-01-05T00:00:00.000Z', 0, 'metered_api', 'openai'),
    attempt('a', 'r', '20', '2026-01-06T00:00:00.000Z', 0, 'metered_api', 'anthropic'),
    attempt('x', 'r', '10', '2026-01-07T00:00:00.000Z', 0, 'metered_api', 'other'),
  ]);
  const result = compareCosts({ period, usage, subscription, operatingUsd: '0' });
  assert.equal(result.apiOnly.knownUsd, '90');
  assert.equal(result.keepSubscription.knownUsd, '130');
  assert.equal(result.keepSubscription.incrementalKnownUsd, '30');
});
