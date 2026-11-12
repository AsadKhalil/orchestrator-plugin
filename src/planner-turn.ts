import { randomUUID } from 'node:crypto';
import type { RunRepository } from './run-store.js';
import type { createOpenCodeHost } from './host.js';
import { plannerPrompt } from './prompts.js';
import { savePlannerReply } from './planner-handoff.js';

type Host = Pick<ReturnType<typeof createOpenCodeHost>, 'prepareStage' | 'submitStagePrompt' | 'waitStage' | 'ownsPrompt' | 'roleForSession' | 'stageModels' | 'readStage'>;
type Store = { get(key: string): Promise<unknown>; set(key: string, value: string): Promise<void>; compareAndSet?(key: string, expected: unknown, value: string): Promise<boolean> };
type Checkpoint = { runID: string; revision: number; phase: 'creating' | 'prepared' | 'dispatching' | 'submitted' | 'complete'; sessionID: string | null; promptID: string | null };
const key = (runID: string) => `planner-turn/${encodeURIComponent(runID)}`;
// shortcut: this queue is process-local; use host-wide transactions before enabling dispatch.
let queue: Promise<void> = Promise.resolve();
const active = new Set<string>();
function serial<T>(fn: () => Promise<T>): Promise<T> { const next = queue.then(fn); queue = next.then(() => undefined, () => undefined); return next; }
function parse(value: unknown, runID: string): Checkpoint | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error('Invalid planner checkpoint');
  let item: Checkpoint; try { item = JSON.parse(value); } catch { throw new Error('Invalid planner checkpoint'); }
  if (!item || item.runID !== runID || !Number.isSafeInteger(item.revision) || item.revision < 0 || !['creating', 'prepared', 'dispatching', 'submitted', 'complete'].includes(item.phase) || !(item.sessionID === null || typeof item.sessionID === 'string' && !!item.sessionID.trim()) || !(item.promptID === null || typeof item.promptID === 'string' && item.promptID.startsWith('msg_'))) throw new Error('Invalid planner checkpoint');
  if (item.phase === 'creating' ? item.sessionID !== null || item.promptID !== null : !item.sessionID || !item.promptID) throw new Error('Invalid planner checkpoint');
  return item;
}
export async function inspectPlannerTurn(store: Pick<Store, 'get'>, runID: string) { return parse(await store.get(key(runID)), runID); }
async function replace(store: Store, storageKey: string, expected: unknown, next: Checkpoint) {
  const value = JSON.stringify(next);
  if (typeof store.compareAndSet === 'function') {
    const updated = await store.compareAndSet(storageKey, expected, value);
    if (updated === false) throw new Error('Planner checkpoint changed; reconciliation required');
    if (updated !== true) throw new Error('Invalid compare-and-set response');
  } else await store.set(storageKey, value);
  return value;
}

/** Experimental one-shot planner turn; incomplete checkpoints require reconciliation, never automatic replay. */
export async function startPlannerTurn(repo: RunRepository, host: Host, store: Store, input: { runID: string; revision: number; model: { providerID: string; id: string; variant?: string } }) {
  const run = await repo.get(input.runID);
  if (run.revision !== input.revision) throw new Error('Stale planning revision');
  const prompt = plannerPrompt(run), storageKey = key(input.runID);
  let checkpoint: Checkpoint = { runID: input.runID, revision: input.revision, phase: 'creating', sessionID: null, promptID: null };
  let saved: unknown;
  await serial(async () => {
    const previous = await store.get(storageKey), prior = parse(previous, input.runID);
    if (prior && (prior.phase !== 'complete' || prior.revision >= input.revision)) throw new Error('Planner turn requires reconciliation');
    saved = await replace(store, storageKey, previous, checkpoint);
    active.add(storageKey);
  });
  try {
  const sessionID = await host.prepareStage({ runID: input.runID, role: 'planner', model: input.model });
  const promptID = `msg_${randomUUID()}`;
  checkpoint = { ...checkpoint, sessionID, promptID, phase: 'prepared' }; saved = await replace(store, storageKey, saved, checkpoint);
  checkpoint = { ...checkpoint, phase: 'dispatching' }; saved = await replace(store, storageKey, saved, checkpoint);
  const latest = await repo.get(input.runID);
  if (latest.revision !== input.revision || latest.stopRequested || latest.state !== 'planning') throw new Error('Planning changed before dispatch');
  await host.submitStagePrompt(sessionID, input.runID, promptID, `${prompt.instructions}\n\nFeature data (JSON):\n${prompt.data}`);
  checkpoint = { ...checkpoint, phase: 'submitted' }; saved = await replace(store, storageKey, saved, checkpoint);
  await host.waitStage(sessionID, input.runID);
  const updated = await savePlannerReply(repo, host, { runID: input.runID, revision: input.revision, sessionID, promptID });
  checkpoint = { ...checkpoint, phase: 'complete' }; await replace(store, storageKey, saved, checkpoint);
  return updated;
  } finally { active.delete(storageKey); }
}

/** Reconcile an existing session without creating, prompting, or waiting on it. */
export async function reconcilePlannerTurn(repo: RunRepository, host: Host, store: Store, runID: string) {
  return serial(async () => {
    if (active.has(key(runID))) return { status: 'needs_attention' as const, reason: 'turn_active' };
    const raw = await store.get(key(runID)), checkpoint = parse(raw, runID);
    if (!checkpoint) throw new Error('Planner checkpoint not found');
    if (checkpoint.phase === 'complete') return { status: 'complete' as const };
    if (!['dispatching', 'submitted'].includes(checkpoint.phase) || !checkpoint.sessionID || !checkpoint.promptID) return { status: 'needs_attention' as const, reason: 'dispatch_not_confirmed' };
    const run = await repo.get(runID);
    if (run.revision !== checkpoint.revision || run.state !== 'planning') return { status: 'needs_attention' as const, reason: 'run_changed' };
    const result = await host.readStage(checkpoint.sessionID, runID);
    if (result.outcome !== 'succeeded') return { status: 'needs_attention' as const, reason: result.outcome === 'failed' || result.outcome === 'interrupted' ? 'session_failed' : 'session_unresolved' };
    const updated = await savePlannerReply(repo, host, { runID, revision: checkpoint.revision, sessionID: checkpoint.sessionID, promptID: checkpoint.promptID });
    await replace(store, key(runID), raw, { ...checkpoint, phase: 'complete' });
    return { status: 'recovered' as const, run: updated };
  });
}
