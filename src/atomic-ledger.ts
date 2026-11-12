import { DatabaseSync } from 'node:sqlite';
import { formatUsd, parseUsd } from './costs.js';

type Evidence = { kind: 'provider_gross_charge' | 'confirmed_not_dispatched'; reference: string };
type Reservation = { attemptID: string; runID: string; period: string; amount: string; actual: string | null; evidence: Evidence | null };
function identity(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('Invalid reservation identity');
}
function validEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'kind,reference') return false;
  const e = value as Evidence; return ['provider_gross_charge', 'confirmed_not_dispatched'].includes(e.kind) && typeof e.reference === 'string' && !!e.reference.trim() && e.reference.length <= 512;
}
function money(value: string): bigint {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid USD amount');
  return parseUsd(value);
}

/** Transactional local ledger; the caller must supply a private, host-wide database path; limit changes require separate authorization by the caller. */
export class AtomicReservationLedger {
  private db: DatabaseSync;
  constructor(path: string, private readonly now: () => number = Date.now) {
    identity(path);
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS reservations (attempt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, period TEXT NOT NULL, amount TEXT NOT NULL, actual TEXT); CREATE TABLE IF NOT EXISTS limits (scope TEXT PRIMARY KEY, amount TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS settlement_evidence (attempt_id TEXT PRIMARY KEY, kind TEXT NOT NULL, reference TEXT NOT NULL)');
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private read(): Reservation[] {
    const rows = this.db.prepare('SELECT r.attempt_id, r.run_id, r.period, r.amount, r.actual, e.kind AS evidence_kind, e.reference AS evidence_reference FROM reservations r LEFT JOIN settlement_evidence e ON e.attempt_id = r.attempt_id').all();
    return rows.map(row => {
      identity(row.attempt_id); identity(row.run_id);
      if (typeof row.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period) || typeof row.amount !== 'string' || !(row.actual === null || typeof row.actual === 'string')) throw new Error('Invalid reservation ledger');
      money(row.amount); if (row.actual !== null) money(row.actual);
      const evidence = row.evidence_kind === null && row.evidence_reference === null ? null : { kind: row.evidence_kind, reference: row.evidence_reference };
      if ((row.actual === null) !== (evidence === null) || (evidence !== null && (!validEvidence(evidence) || (evidence.kind === 'confirmed_not_dispatched' && money(row.actual as string) !== 0n)))) throw new Error('Invalid settlement evidence');
      return { attemptID: row.attempt_id, runID: row.run_id, period: row.period, amount: row.amount, actual: row.actual, evidence: evidence as Evidence | null };
    });
  }
  snapshot(): Reservation[] { return this.read(); }
  private limitKey(scope: 'monthly' | 'feature', runID?: string): string {
    if (scope === 'monthly' && runID === undefined) return 'monthly';
    if (scope === 'feature') { identity(runID); return JSON.stringify(['feature', runID]); }
    throw new Error('Invalid budget scope');
  }
  getLimit(scope: 'monthly' | 'feature', runID?: string): { amount: string; revision: number } | null {
    const row = this.db.prepare('SELECT amount, revision FROM limits WHERE scope = ?').get(this.limitKey(scope, runID));
    if (!row) return null;
    if (typeof row.amount !== 'string' || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Invalid budget limit');
    money(row.amount); return { amount: row.amount, revision: row.revision };
  }
  setLimit(scope: 'monthly' | 'feature', runID: string | undefined, amount: string, expectedRevision: number): { amount: string; revision: number } {
    const key = this.limitKey(scope, runID), normalized = formatUsd(money(amount));
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid budget revision');
    return this.transaction(() => {
      const previous = this.getLimit(scope, runID);
      if ((previous?.revision ?? 0) !== expectedRevision) throw new Error('Stale budget revision');
      const revision = expectedRevision + 1;
      this.db.prepare('INSERT INTO limits (scope, amount, revision) VALUES (?, ?, ?) ON CONFLICT(scope) DO UPDATE SET amount=excluded.amount, revision=excluded.revision').run(key, normalized, revision);
      return { amount: normalized, revision };
    });
  }
  reserve(request: { attemptID: string; runID: string; amount: string }): 'created' | 'existing' {
    if (!request || typeof request !== 'object' || Object.keys(request).sort().join(',') !== 'amount,attemptID,runID') throw new Error('Invalid reservation request');
    identity(request.attemptID); identity(request.runID);
    const amount = money(request.amount);
    return this.transaction(() => {
      const records = this.read(), existing = records.find(item => item.attemptID === request.attemptID);
      if (existing) {
        if (existing.runID !== request.runID || money(existing.amount) !== amount) throw new Error('Reservation conflict');
        return 'existing';
      }
      const timestamp = this.now();
      if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid budget clock');
      let period: string; try { period = new Date(timestamp).toISOString().slice(0, 7); } catch { throw new Error('Invalid budget clock'); }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid budget clock');
      const monthLimit = this.getLimit('monthly'), featureLimit = this.getLimit('feature', request.runID);
      if (!monthLimit || !featureLimit) throw new Error('Budget limits are not configured');
      const monthly = money(monthLimit.amount), feature = money(featureLimit.amount);
      let monthUsed = 0n, featureUsed = 0n;
      for (const record of records) {
        const used = money(record.actual ?? record.amount);
        if (record.period === period || record.actual === null) monthUsed += used;
        if (record.runID === request.runID) featureUsed += used;
      }
      if (monthUsed + amount > monthly || featureUsed + amount > feature) throw new Error('Budget exceeded');
      this.db.prepare('INSERT INTO reservations (attempt_id, run_id, period, amount, actual) VALUES (?, ?, ?, ?, NULL)').run(request.attemptID, request.runID, period, formatUsd(amount));
      return 'created';
    });
  }
  reconcile(attemptID: string, actual: string, evidence: Evidence): void {
    identity(attemptID); const amount = money(actual);
    if (!validEvidence(evidence) || (evidence.kind === 'confirmed_not_dispatched' && amount !== 0n)) throw new Error('Final settlement evidence required');
    this.transaction(() => {
      const record = this.read().find(item => item.attemptID === attemptID);
      if (!record) throw new Error('Unknown reservation');
      if (record.actual !== null) { if (money(record.actual) !== amount || record.evidence?.kind !== evidence.kind || record.evidence.reference !== evidence.reference) throw new Error('Reconciliation conflict'); return; }
      this.db.prepare('UPDATE reservations SET actual = ? WHERE attempt_id = ?').run(formatUsd(amount), attemptID);
      this.db.prepare('INSERT INTO settlement_evidence (attempt_id, kind, reference) VALUES (?, ?, ?)').run(attemptID, evidence.kind, evidence.reference);
    });
  }
}
