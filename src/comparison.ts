import { formatUsd, parseUsd } from './costs.js';
import type { Run } from './run.js';
import type { UsageRecord } from './types.js';

type Usage = { id: string; at: string; providerID: string; route: string; grossUsd: string | null };
type Credit = { id: string; providerID: string; route: string; amountUsd: string; startsAt: string; expiresAt: string; claimed: boolean; eligibility: 'eligible' | 'ineligible' | 'unknown'; balance: 'verified' | 'unverified' };
type Subscription = { feeUsd: string; credits: readonly Credit[]; nativeOverageUsd: string | null; independentReviewUsd: string | null };

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Invalid timestamp');
  return parsed;
}
function identity(value: string): void { if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid identity'); }

/** Uses supplied period charges and remaining balances; it does not query a billing account. */
export function compareCosts(input: { period: { from: string; to: string }; usage: readonly Usage[]; subscription: Subscription; operatingUsd: string }) {
  const from = instant(input.period.from), to = instant(input.period.to);
  if (from >= to) throw new Error('Invalid period');
  const operating = parseUsd(input.operatingUsd), fee = parseUsd(input.subscription.feeUsd);
  const ids = new Set<string>();
  const credits = input.subscription.credits.map(c => {
    identity(c.id); identity(c.providerID); identity(c.route);
    if (ids.has(c.id) || !['eligible', 'ineligible', 'unknown'].includes(c.eligibility) || !['verified', 'unverified'].includes(c.balance) || typeof c.claimed !== 'boolean') throw new Error('Invalid credit');
    ids.add(c.id);
    const start = instant(c.startsAt), expiry = instant(c.expiresAt), remaining = parseUsd(c.amountUsd);
    if (start >= expiry) throw new Error('Invalid credit interval');
    return { ...c, start, expiry, remaining };
  }).sort((a, b) => a.expiry - b.expiry || a.id.localeCompare(b.id));
  ids.clear();
  const records = input.usage.map(u => {
    identity(u.id); identity(u.providerID); identity(u.route);
    if (ids.has(u.id)) throw new Error('Duplicate usage');
    ids.add(u.id);
    return { ...u, timestamp: instant(u.at), amount: u.grossUsd === null ? null : parseUsd(u.grossUsd) };
  }).sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  let gross = 0n, applied = 0n, unverified = 0n, unknown = 0;
  for (const record of records) {
    if (record.timestamp < from || record.timestamp >= to) continue;
    if (record.amount === null) {
      unknown++;
      // An unknown charge may have consumed every eligible shared credit.
      for (const credit of credits) if (credit.claimed && credit.eligibility === 'eligible' && credit.providerID === record.providerID && credit.route === record.route && record.timestamp >= credit.start && record.timestamp < credit.expiry) credit.remaining = 0n;
      continue;
    }
    gross += record.amount;
    let uncovered = record.amount;
    for (const credit of credits) {
      if (!credit.claimed || credit.eligibility !== 'eligible' || credit.providerID !== record.providerID || credit.route !== record.route || record.timestamp < credit.start || record.timestamp >= credit.expiry) continue;
      const use = uncovered < credit.remaining ? uncovered : credit.remaining;
      credit.remaining -= use; uncovered -= use; applied += use;
      if (credit.balance === 'unverified') unverified += use;
      if (uncovered === 0n) break;
    }
  }
  const overage = input.subscription.nativeOverageUsd === null ? null : parseUsd(input.subscription.nativeOverageUsd);
  const review = input.subscription.independentReviewUsd === null ? null : parseUsd(input.subscription.independentReviewUsd);
  return {
    apiOnly: { knownUsd: formatUsd(gross + operating), unknownCount: unknown },
    keepSubscription: { knownUsd: formatUsd(fee + gross - applied + operating), incrementalKnownUsd: formatUsd(gross - applied + operating), creditAppliedUsd: formatUsd(applied), unverifiedCreditUsd: formatUsd(unverified), unknownCount: unknown },
    nativeSubscription: { totalUsd: overage === null || review === null ? null : formatUsd(fee + overage + review + operating) },
  };
}

/** Manual same-period scenarios; inputs are estimates, not a statement of billing or equivalent service. */
export function compareMonthlyScenario(input: { apiUsd: string; feeUsd: string; nativeOverageUsd: string; independentReviewUsd: string }) {
  const api = parseUsd(input.apiUsd), fee = parseUsd(input.feeUsd);
  const native = fee + parseUsd(input.nativeOverageUsd) + parseUsd(input.independentReviewUsd);
  return { apiOnlyUsd: formatUsd(api), keepSubscriptionTotalUsd: formatUsd(fee + api), keepSubscriptionIncrementalUsd: formatUsd(api), nativeSubscriptionUsd: formatUsd(native) };
}

/** Highest revision per attempt, so streamed or corrected records count once and a late correction keeps its original timestamp. */
function latestAttempts(records: readonly UsageRecord[]): UsageRecord[] {
  const latest = new Map<string, UsageRecord>();
  for (const u of records) {
    identity(u.attemptID); identity(u.runID); identity(u.providerID); instant(u.startedAt);
    if (!Number.isSafeInteger(u.revision) || u.revision < 0 || !['metered_api', 'subscription', 'local'].includes(u.billing)) throw new Error('Invalid usage record');
    if (u.grossUsd !== null) parseUsd(u.grossUsd);
    const previous = latest.get(u.attemptID);
    if (previous && (previous.startedAt !== u.startedAt || previous.runID !== u.runID)) throw new Error('Usage identity conflict');
    if (previous && previous.revision === u.revision && (previous.grossUsd !== u.grossUsd || previous.billing !== u.billing)) throw new Error('Usage replay conflict');
    if (!previous || u.revision > previous.revision) latest.set(u.attemptID, u);
  }
  return [...latest.values()];
}

export type RunMetrics = {
  runs: number; accepted: number; completed: number; unresolved: number; inProgress: number;
  repairRounds: number; elapsedMs: number;
  /** Gross spend of every attempt of these runs inside the period (failed, repair and auxiliary included). Unknown amounts are counted, never zero. */
  spend: { knownUsd: string; unknownCount: number };
  /** Total known spend of all counted runs divided by accepted runs, rounded up at 12 places; null (undefined) when nothing was accepted. */
  costPerAcceptedUsd: string | null;
  /** True when some spend is unknown, so every total above is a lower bound. */
  partial: boolean;
};

/**
 * Counts runs created in [from, to) and the attempts of those runs that started in [from, to). ponytail: an attempt that starts after `to`
 * is not counted, so pick a period that ends after the runs have settled.
 */
export function summarizeRuns(runs: readonly Run[], usage: readonly UsageRecord[], period: { from: string; to: string }): RunMetrics {
  const from = instant(period.from), to = instant(period.to);
  if (from >= to) throw new Error('Invalid period');
  const ids = new Set<string>();
  for (const r of runs) { identity(r.id); if (ids.has(r.id)) throw new Error('Duplicate run'); ids.add(r.id); }
  const counted = runs.filter(r => Number.isFinite(r.createdAt) && r.createdAt >= from && r.createdAt < to);
  const countedIDs = new Set(counted.map(r => r.id));
  let accepted = 0, completed = 0, unresolved = 0, repairRounds = 0, elapsedMs = 0;
  for (const r of counted) {
    if (r.state === 'accepted') accepted++;
    if (r.state === 'accepted' || r.state === 'ready_for_acceptance') completed++;
    else if (r.state === 'needs_attention' || r.state === 'cancelled') unresolved++;
    repairRounds += r.review?.repairRounds ?? 0;
    if (r.endedAt !== null) { if (r.endedAt < r.createdAt) throw new Error('Invalid run time'); elapsedMs += r.endedAt - r.createdAt; }
  }
  let known = 0n, unknownCount = 0;
  for (const u of latestAttempts(usage)) {
    const at = Date.parse(u.startedAt);
    if (!countedIDs.has(u.runID) || at < from || at >= to) continue;
    if (u.grossUsd === null) unknownCount++; else known += parseUsd(u.grossUsd);
  }
  return {
    runs: counted.length, accepted, completed, unresolved, inProgress: counted.length - completed - unresolved, repairRounds, elapsedMs,
    spend: { knownUsd: formatUsd(known), unknownCount },
    costPerAcceptedUsd: accepted === 0 ? null : formatUsd((known + BigInt(accepted) - 1n) / BigInt(accepted)),
    partial: unknownCount > 0,
  };
}

/**
 * Converts only metered API attempts into the priced `usage` that `compareCosts` expects. Subscription and local attempts are returned as
 * counts: their allowance consumption is unknown, not free, and is never turned into invented dollars.
 */
export function meteredUsageForComparison(records: readonly UsageRecord[]): { usage: Usage[]; nonMetered: { subscription: number; local: number } } {
  const usage: Usage[] = [];
  const nonMetered = { subscription: 0, local: 0 };
  for (const u of latestAttempts(records)) {
    if (u.billing === 'metered_api') usage.push({ id: u.attemptID, at: u.startedAt, providerID: u.providerID, route: 'api', grossUsd: u.grossUsd });
    else nonMetered[u.billing]++;
  }
  return { usage, nonMetered };
}
