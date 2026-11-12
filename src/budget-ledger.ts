import { CasReservationLedger } from './cas-ledger.js';
import { createLocalStore } from './local-ledger.js';

export type BudgetBackend = 'host' | 'local_file';
/** The budget authority in use. `ledger` is null when neither kind of atomic storage is available; every owned request is then refused. */
export type BudgetHandle = { ledger: CasReservationLedger | null; backend: BudgetBackend | null; close(): void };

const none: BudgetHandle = { ledger: null, backend: null, close() {} };

/** Host storage that can compare-and-set, when it has it. */
export function hostBudget(storage: unknown): BudgetHandle {
  return typeof (storage as { compareAndSet?: unknown })?.compareAndSet === 'function'
    ? { ledger: new CasReservationLedger(storage as never), backend: 'host', close() {} } : none;
}

/**
 * The host's own atomic storage is preferred. Without it, a local SQLite file under `root` stands in; without that too (no root, or
 * this runtime has no `node:sqlite`) there is no ledger and nothing may be spent. Spend recorded in one backend is not carried to the other.
 */
export async function openBudgetLedger(storage: unknown, root?: string, load?: () => Promise<{ DatabaseSync: never }>): Promise<BudgetHandle> {
  const host = hostBudget(storage);
  if (host.ledger || root === undefined) return host;
  try { await (load ?? (() => import('node:sqlite')))(); } catch { return none; }
  const store = createLocalStore(root, load as never);
  return { ledger: new CasReservationLedger(store as never), backend: 'local_file', close: () => store.close() };
}
