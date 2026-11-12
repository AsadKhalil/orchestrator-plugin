const SCALE = 1_000_000_000_000n;
const MILLION = 1_000_000n;

type TokenCostInput = {
  inputTokens: number;
  billedOutputTokens: number;
  inputRatePerMillion: string;
  outputRatePerMillion: string;
};

export function parseUsd(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value)) throw new Error('Invalid USD amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
}

function tokenCount(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid token count');
  return BigInt(value);
}

export function formatUsd(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** Conservative estimate for rates per million tokens; output must already include billed reasoning. */
export function estimateTokenCost(input: TokenCostInput): string {
  const units = tokenCount(input.inputTokens) * parseUsd(input.inputRatePerMillion)
    + tokenCount(input.billedOutputTokens) * parseUsd(input.outputRatePerMillion);
  return formatUsd((units + MILLION - 1n) / MILLION);
}

type Reservation = { attemptID: string; runID: string; amount: string; actual: string | null };
type LedgerStore = { get(): Promise<unknown>; set(value: Reservation[]): Promise<void> };
type Limits = { monthly: string; feature: string };

// shortcut: this serializes only this loaded module; add host-wide transactions before enforcing budgets.
let ledgerQueue: Promise<void> = Promise.resolve();

/** Serializes access in this loaded module and one budget period. */
export class ReservationLedger {
  constructor(private readonly store: LedgerStore) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = ledgerQueue.then(fn);
    ledgerQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<Reservation[]> {
    const value = await this.store.get();
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('Invalid reservation ledger');
    const ids = new Set<string>();
    return value.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid reservation ledger');
      const r = item as Record<string, unknown>;
      if (typeof r.attemptID !== 'string' || !r.attemptID.trim() || ids.has(r.attemptID) || typeof r.runID !== 'string' || !r.runID.trim() || typeof r.amount !== 'string' || (r.actual !== null && typeof r.actual !== 'string')) throw new Error('Invalid reservation ledger');
      ids.add(r.attemptID);
      parseUsd(r.amount);
      if (typeof r.actual === 'string') parseUsd(r.actual);
      return { attemptID: r.attemptID, runID: r.runID, amount: r.amount, actual: r.actual as string | null };
    });
  }

  snapshot(): Promise<Reservation[]> { return this.serialize(() => this.read()); }

  reserve(request: { attemptID: string; runID: string; amount: string }, limits: Limits): Promise<'created' | 'existing'> {
    return this.serialize(async () => {
      if (!request.attemptID.trim() || !request.runID.trim()) throw new Error('Invalid reservation identity');
      const amount = parseUsd(request.amount);
      const monthly = parseUsd(limits.monthly);
      const feature = parseUsd(limits.feature);
      const records = await this.read();
      const existing = records.find(item => item.attemptID === request.attemptID);
      if (existing) {
        if (existing.runID !== request.runID || parseUsd(existing.amount) !== amount) throw new Error('Reservation conflict');
        return 'existing';
      }
      let monthUsed = 0n;
      let featureUsed = 0n;
      for (const record of records) {
        const charged = parseUsd(record.actual ?? record.amount);
        monthUsed += charged;
        if (record.runID === request.runID) featureUsed += charged;
      }
      if (monthUsed + amount > monthly || featureUsed + amount > feature) throw new Error('Budget exceeded');
      records.push({ ...request, amount: formatUsd(amount), actual: null });
      await this.store.set(records);
      return 'created';
    });
  }

  reconcile(attemptID: string, actual: string): Promise<void> {
    return this.serialize(async () => {
      const amount = parseUsd(actual);
      const records = await this.read();
      const record = records.find(item => item.attemptID === attemptID);
      if (!record) throw new Error('Unknown reservation');
      if (record.actual !== null) {
        if (parseUsd(record.actual) !== amount) throw new Error('Reconciliation conflict');
        return;
      }
      record.actual = formatUsd(amount);
      await this.store.set(records);
    });
  }
}
