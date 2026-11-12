import { formatUsd, parseUsd } from './costs.js';

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
