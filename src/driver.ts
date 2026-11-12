import { drive, type Ports } from './orchestrator.js';
import type { RunRepository } from './run-store.js';
import type { createOpenCodeHost } from './host.js';
import { requestRunStop } from './stop.js';

type Host = Pick<ReturnType<typeof createOpenCodeHost>, 'ownsSession' | 'interrupt'>;
export type DriverDeps = {
  repo: RunRepository; ports: Ports & { activeSessions(runID: string): string[]; abort?(runID: string): void }; host: Host; store: { get(key: string): Promise<unknown> };
  /** Called when a drive ends by throwing (for example a stale revision); the run keeps its last persisted state. */
  onError?: (runID: string, error: unknown) => void;
};

/** Runs each run at most once at a time, in the background, so a panel call returns immediately and polls the run record. */
export function createDriver(deps: DriverDeps) {
  const active = new Map<string, Promise<void>>();
  const driver = {
    isActive: (runID: string) => active.has(runID),
    start(runID: string, autonomous = false): boolean {
      if (active.has(runID)) return false;
      const job = drive(deps.repo, deps.ports, runID, { autonomous }).then(() => undefined, async error => {
        deps.onError?.(runID, error);
        // An unexpected failure (ledger contention, storage) must leave a visible reason, not a run that looks live but is not driven.
        try {
          const run = await deps.repo.get(runID);
          if (['planning', 'implementing', 'validating', 'reviewing', 'repairing'].includes(run.state)) await (run.stopRequested ? deps.repo.finishStop(runID, run.revision) : deps.repo.needsAttention(runID, run.revision, 'drive_error'));
        } catch { /* nothing more can be recorded */ }
      }).finally(() => active.delete(runID));
      active.set(runID, job); return true;
    },
    /** Persist the stop first, interrupt stages in flight, then let the driver finish the cancellation. */
    async stop(runID: string, revision: number) {
      const result = await requestRunStop(deps.repo, deps.host, deps.store, runID, revision);
      for (const sessionID of deps.ports.activeSessions(runID)) { try { await deps.host.interrupt(sessionID, runID); } catch { /* the stage ends or is paused on its own */ } }
      deps.ports.abort?.(runID); // ends a validation wait now instead of at its deadline
      driver.start(runID);
      return result.run;
    },
    async idle() { await Promise.all([...active.values()]); },
  };
  return driver;
}
