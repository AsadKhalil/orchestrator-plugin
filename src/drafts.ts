import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { Plugin } from '@opencode/plugin';
import { exportRunPreview } from './delivery.js';
import { createRunRepository, type RunRepository } from './run-store.js';

const git = promisify(execFile);
type Context = Pick<Plugin.Context, 'storage' | 'location'>;
const prefix = (directory: string) => `project-runs/${encodeURIComponent(directory)}/`;
function repository(context: Context) {
  const root = prefix(context.location.directory);
  return createRunRepository(context, root);
}
const summary = (run: Awaited<ReturnType<RunRepository['get']>>) => ({ id: run.id, requirement: run.requirement, baseCommit: run.baseCommit, revision: run.revision, state: run.state, planHash: run.planHash });

/** Capture HEAD as a baseline; this does not snapshot uncommitted files or start a model. */
export async function createDraft(context: Context, requirement: string) {
  if (typeof requirement !== 'string' || !requirement.trim() || requirement.length > 10_000) throw new Error('Feature requirement is required and must be at most 10000 characters');
  const { stdout } = await git('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: context.location.directory, timeout: 5000, maxBuffer: 1024, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) });
  const baseCommit = stdout.trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseCommit)) throw new Error('Could not resolve Git baseline');
  return summary(await repository(context).create(randomUUID(), requirement, baseCommit));
}

/** Project-scoped summaries only; invalid or excessive stored records fail closed. */
export async function listDrafts(context: Context) {
  const root = prefix(context.location.directory) + 'runs/';
  let after: string | undefined; const cursors = new Set<string>(); const ids = new Set<string>();
  do {
    const page = await context.storage.scan({ prefix: root, after });
    if (!Array.isArray(page.entries)) throw new Error('Invalid run scan');
    for (const entry of page.entries) {
      if (typeof entry.key !== 'string' || !entry.key.startsWith(root) || ids.size >= 100) throw new Error('Invalid or excessive run records');
      const id = decodeURIComponent(entry.key.slice(root.length));
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid run identity');
      if (entry.key !== root + encodeURIComponent(id) || ids.has(id)) throw new Error('Invalid or duplicate run identity');
      ids.add(id);
    }
    if (page.next !== undefined && (typeof page.next !== 'string' || !page.next || cursors.has(page.next))) throw new Error('Invalid run cursor');
    if (page.next) cursors.add(page.next); after = page.next;
  } while (after);
  const repo = repository(context);
  return Promise.all([...ids].map(async id => summary(await repo.get(id))));
}

function detail(run: Awaited<ReturnType<RunRepository['get']>>) {
  return { ...summary(run), clarification: run.clarification, planJson: run.plan === null ? null : JSON.stringify(run.plan, null, 2) };
}
export async function getDraft(context: Context, id: string) { return detail(await repository(context).get(id)); }
export async function answerDraft(context: Context, id: string, revision: number, answers: { id: string; answer: string }[]) { return detail(await repository(context).answerQuestions(id, revision, answers)); }
export async function approveDraft(context: Context, id: string, revision: number, planHash: string) { return detail(await repository(context).approve(id, revision, planHash)); }

export async function exportDraft(context: Context, id: string, revision: number) { const run = await repository(context).get(id); if (run.revision !== revision) throw new Error('Stale run revision'); return exportRunPreview(run); }
