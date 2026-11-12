import type { RunRepository } from './run-store.js';
import type { createOpenCodeHost } from './host.js';
import { inspectPlannerTurn } from './planner-turn.js';

type Host = Pick<ReturnType<typeof createOpenCodeHost>, 'ownsSession' | 'interrupt'>;
type Store = { get(key: string): Promise<unknown> };
type Shell = { stop(input: { id: string; sessionID: string }): Promise<{ data: { status: string } }> };
/** Persist intent first; session interruption does not prove shell-process cleanup. */
export async function requestRunStop(repo: RunRepository, host: Host, store: Store, runID: string, revision: number, shell?: Shell) {
  const run = await repo.requestStop(runID, revision);
  const sessions = new Set(run.jobs.filter(job => ['pending', 'running', 'ready', 'unknown'].includes(job.status)).map(job => job.sessionID));
  let checkpoint: 'none' | 'complete' | 'incomplete' | 'unavailable' = 'none';
  try {
    const turn = await inspectPlannerTurn(store, runID);
    if (turn) {
      checkpoint = turn.phase === 'complete' ? 'complete' : 'incomplete';
      if (turn.phase !== 'complete' && turn.sessionID) sessions.add(turn.sessionID);
    }
  } catch { checkpoint = 'unavailable'; }
  const interruptions: { sessionID: string; status: 'requested' | 'not_interrupted' | 'not_owned' | 'unavailable' }[] = [];
  for (const sessionID of sessions) {
    try {
      if (!await host.ownsSession(sessionID, runID)) { interruptions.push({ sessionID, status: 'not_owned' }); continue; }
      const result = await host.interrupt(sessionID, runID);
      interruptions.push({ sessionID, status: result.interrupted ? 'requested' : 'not_interrupted' });
    } catch { interruptions.push({ sessionID, status: 'unavailable' }); }
  }
  const shells: { jobID: string; status: 'stopped' | 'not_owned' | 'unavailable' }[] = [];
  for (const job of run.jobs.filter(job => ['pending', 'running', 'ready', 'unknown'].includes(job.status))) {
    try {
      if (!await host.ownsSession(job.sessionID, runID)) { shells.push({ jobID: job.id, status: 'not_owned' }); continue; }
      if (!shell || !job.shellID) { shells.push({ jobID: job.id, status: 'unavailable' }); continue; }
      const result = await shell.stop({ id: job.shellID, sessionID: job.sessionID });
      if (!['killed', 'exited', 'timeout'].includes(result.data.status)) throw new Error('Shell did not stop');
      shells.push({ jobID: job.id, status: 'stopped' });
    } catch { shells.push({ jobID: job.id, status: 'unavailable' }); }
  }
  return { run, checkpoint, interruptions, shells, processCleanup: 'unverified' as const };
}
