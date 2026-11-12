import { join, resolve } from 'node:path';
import { deliverRun, type DeliveryRecord } from './delivery.js';
import { getDelivery } from './delivery-settings.js';
import type { RunRepository } from './run-store.js';
import { worktreeKey } from './host-ports.js';
import { defaultExec, type Exec } from './worktree.js';

type Store = { get(key: string): Promise<unknown>; set(key: string, value: string): Promise<void> };
export type DeliverEnv = { directory: string; store: Store; repo: Pick<RunRepository, 'get'>; exec?: Exec };
export type Delivered = { status: 'exported' | 'delivered' | 'needs_attention' | 'refused'; reason: string | null; paths: string[]; branch: string | null; commit: string | null; prUrl: string | null; reusedPR: boolean | null };

export const deliveryRecordKey = (runID: string) => `run-delivery/${encodeURIComponent(runID)}`;
/** One delivery per run at a time: two clicks must not race each other into a second push or pull request. */
const inFlight = new Set<string>();
const empty: Delivered = { status: 'refused', reason: null, paths: [], branch: null, commit: null, prUrl: null, reusedPR: null };

function readRecord(raw: unknown): DeliveryRecord | null {
  if (raw === undefined) return null;
  const value = typeof raw === 'string' ? JSON.parse(raw) : null;
  if (!value || typeof value.branch !== 'string' || typeof value.commit !== 'string' || !(value.prUrl === null || typeof value.prUrl === 'string') || !['committed', 'delivered'].includes(value.phase)) throw new Error('Invalid delivery record');
  return value;
}

/**
 * Human-triggered delivery of one run. `local` writes a summary next to the project; `github` pushes this run's own branch and
 * opens a DRAFT pull request, and only for an accepted run in a project that enabled publication. Nothing is merged or deployed.
 */
export async function deliverDraft(env: DeliverEnv, id: string, revision: number, target: 'local' | 'github'): Promise<Delivered> {
  const run = await env.repo.get(id);
  if (run.revision !== revision) throw new Error('Stale run revision');
  if (inFlight.has(id)) throw new Error('A delivery for this run is already in progress');
  inFlight.add(id);
  try {
    if (target === 'local') {
      // Beside the run worktrees, not inside the project, so an export never shows up as an uncommitted change.
      const result = await deliverRun(run, { kind: 'local', directory: join(`${resolve(env.directory)}.feature-pilot`, 'exports') }, { exec: env.exec ?? defaultExec, worktree: env.directory, publicationEnabled: false, previous: null, record: async () => {} });
      return result.status === 'exported' ? { ...empty, status: 'exported', paths: result.paths } : { ...empty, status: 'refused', reason: result.status === 'refused' ? result.reason : 'Export failed' };
    }
    const settings = await getDelivery(env.store as never, env.directory);
    if (!settings.publicationEnabled || !settings.github) return { ...empty, reason: 'Publication is not enabled for this project' };
    if (run.state !== 'accepted') return { ...empty, reason: 'Accept the run before publishing it' };
    const worktree = await env.store.get(worktreeKey(run.id));
    if (typeof worktree !== 'string' || !worktree) return { ...empty, reason: 'This run has no worktree to publish from' };
    let previous: DeliveryRecord | null;
    try { previous = readRecord(await env.store.get(deliveryRecordKey(run.id))); } catch { return { ...empty, status: 'needs_attention', reason: 'The saved delivery record is unreadable; check the branch and pull request by hand' }; }
    const result = await deliverRun(run, { kind: 'github', ...settings.github }, { exec: env.exec ?? defaultExec, worktree, publicationEnabled: true, previous, record: async record => { await env.store.set(deliveryRecordKey(run.id), JSON.stringify(record)); } });
    if (result.status === 'delivered') return { ...empty, status: 'delivered', branch: result.branch, commit: result.commit, prUrl: result.prUrl, reusedPR: result.reusedPR };
    if (result.status === 'needs_attention') return { ...empty, status: 'needs_attention', reason: result.reason, branch: result.record?.branch ?? null, commit: result.record?.commit ?? null, prUrl: result.record?.prUrl ?? null };
    return { ...empty, status: 'refused', reason: result.status === 'refused' ? result.reason : 'Delivery failed' };
  } finally { inFlight.delete(id); }
}
