import { formatUsd, parseUsd } from './costs.js';

type Evidence = { kind: 'provider_gross_charge' | 'confirmed_not_dispatched'; reference: string };
type Reservation = { attemptID: string; runID: string; period: string; amount: string; actual: string | null; evidence: Evidence | null };
type Limit = { amount: string; revision: number };
type State = { revision: number; monthly: Limit | null; features: Record<string, Limit>; reservations: Reservation[] };
type Store = { get(key: string): Promise<unknown>; compareAndSet(key: string, expected: unknown, next: State): Promise<boolean> };
const key = 'budget-ledger/v1';
function identity(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('Invalid reservation identity'); }
function money(value: unknown): bigint { if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid USD amount'); return parseUsd(value); }
function periodAt(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid budget clock');
  let period: string; try { period = new Date(timestamp).toISOString().slice(0, 7); } catch { throw new Error('Invalid budget clock'); }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid budget clock');
  return period;
}
function evidence(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'kind,reference') return false;
  const e = value as Evidence; return ['provider_gross_charge', 'confirmed_not_dispatched'].includes(e.kind) && typeof e.reference === 'string' && !!e.reference.trim() && e.reference.length <= 512;
}
function limit(value: unknown): asserts value is Limit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid budget limit');
  const item = value as Limit; money(item.amount); if (!Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error('Invalid budget revision');
}
function validate(value: unknown): State {
  if (value === undefined) return { revision: 0, monthly: null, features: {}, reservations: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid budget ledger');
  const state = value as State;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !state.features || typeof state.features !== 'object' || Array.isArray(state.features) || !Array.isArray(state.reservations) || state.reservations.length > 10000) throw new Error('Invalid budget ledger');
  if (state.monthly !== null) limit(state.monthly);
  for (const [id, item] of Object.entries(state.features)) { identity(id); limit(item); }
  const ids = new Set<string>();
  for (const item of state.reservations) {
    if (!item || typeof item !== 'object') throw new Error('Invalid reservation ledger');
    identity(item.attemptID); identity(item.runID);
    if (ids.has(item.attemptID) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.period)) throw new Error('Invalid reservation ledger');
    ids.add(item.attemptID); money(item.amount);
    if (item.actual !== null) money(item.actual);
    if ((item.actual === null) !== (item.evidence === null) || (item.evidence !== null && (!evidence(item.evidence) || (item.evidence.kind === 'confirmed_not_dispatched' && money(item.actual) !== 0n)))) throw new Error('Invalid settlement evidence');
  }
  return structuredClone(state);
}

/** One host-wide ledger record keeps limits and reservations in the same atomic update. */
export class CasReservationLedger {
  constructor(private readonly storage: Store, private readonly now: () => number = Date.now) {
    if (typeof storage?.compareAndSet !== 'function') throw new Error('Atomic host storage required');
  }
  private async update<T>(change: (state: State) => T): Promise<T> {
    for (let attempt = 0; attempt < 32; attempt++) {
      const previous = await this.storage.get(key), state = validate(previous);
      if (state.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Budget revision exhausted');
      const result = change(state); state.revision++;
      const saved = await this.storage.compareAndSet(key, previous, state);
      if (saved === true) return result;
      if (saved !== false) throw new Error('Invalid compare-and-set response');
    }
    throw new Error('Budget contention; retry');
  }
  async snapshot() { return validate(await this.storage.get(key)); }
  async report(runID: string | null) {
    if (runID !== null) identity(runID);
    const state = await this.snapshot(), period = periodAt(this.now());
    const summarize = (items: Reservation[], maximum: Limit | null) => {
      let used = 0n, pending = 0n, pendingCount = 0;
      for (const item of items) { const amount = money(item.actual ?? item.amount); used += amount; if (item.actual === null) { pending += amount; pendingCount++; } }
      const cap = maximum ? money(maximum.amount) : null;
      return { committedUsd: formatUsd(used), pendingUsd: formatUsd(pending), pendingCount, remainingUsd: cap === null ? null : formatUsd(cap > used ? cap - used : 0n), overLimitUsd: cap === null ? null : formatUsd(used > cap ? used - cap : 0n) };
    };
    const feature = runID !== null && Object.hasOwn(state.features, runID) ? state.features[runID] : null;
    return { period, monthly: state.monthly, feature, monthlyUsage: summarize(state.reservations.filter(item => item.period === period || item.actual === null), state.monthly), featureUsage: runID === null ? null : summarize(state.reservations.filter(item => item.runID === runID), feature) };
  }
  setLimit(scope: 'monthly' | 'feature', runID: string | undefined, amount: string, revision: number): Promise<Limit> {
    if (scope === 'feature') identity(runID); else if (scope !== 'monthly' || runID !== undefined) throw new Error('Invalid budget scope');
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid budget revision');
    const normalized = formatUsd(money(amount));
    return this.update(state => {
      const previous = scope === 'monthly' ? state.monthly : Object.hasOwn(state.features, runID!) ? state.features[runID!] : undefined;
      if ((previous?.revision ?? 0) !== revision) throw new Error('Stale budget revision');
      const next = { amount: normalized, revision: revision + 1 };
      if (scope === 'monthly') state.monthly = next; else Object.defineProperty(state.features, runID!, { value: next, enumerable: true, configurable: true, writable: true });
      return next;
    });
  }
  reserve(request: { attemptID: string; runID: string; amount: string }): Promise<'created' | 'existing'> {
    if (!request || typeof request !== 'object' || Object.keys(request).sort().join(',') !== 'amount,attemptID,runID') throw new Error('Invalid reservation request');
    identity(request.attemptID); identity(request.runID); const amount = money(request.amount);
    return this.update(state => {
      const existing = state.reservations.find(item => item.attemptID === request.attemptID);
      if (existing) { if (existing.runID !== request.runID || money(existing.amount) !== amount) throw new Error('Reservation conflict'); return 'existing'; }
      const period = periodAt(this.now());
      const feature = Object.hasOwn(state.features, request.runID) ? state.features[request.runID] : undefined;
      if (!state.monthly || !feature) throw new Error('Budget limits are not configured');
      let monthUsed = 0n, featureUsed = 0n;
      for (const item of state.reservations) { const used = money(item.actual ?? item.amount); if (item.period === period || item.actual === null) monthUsed += used; if (item.runID === request.runID) featureUsed += used; }
      if (monthUsed + amount > money(state.monthly.amount) || featureUsed + amount > money(feature.amount)) throw new Error('Budget exceeded');
      if (state.reservations.length >= 10000) throw new Error('Budget ledger is full');
      state.reservations.push({ ...request, period, amount: formatUsd(amount), actual: null, evidence: null }); return 'created';
    });
  }
  reconcile(attemptID: string, actual: string, final: Evidence): Promise<void> {
    identity(attemptID); const amount = money(actual);
    if (!evidence(final) || (final.kind === 'confirmed_not_dispatched' && amount !== 0n)) throw new Error('Final settlement evidence required');
    return this.update(state => {
      const item = state.reservations.find(record => record.attemptID === attemptID);
      if (!item) throw new Error('Unknown reservation');
      if (item.actual !== null) { if (money(item.actual) !== amount || item.evidence?.kind !== final.kind || item.evidence.reference !== final.reference) throw new Error('Reconciliation conflict'); return; }
      item.actual = formatUsd(amount); item.evidence = { ...final };
    });
  }
}
