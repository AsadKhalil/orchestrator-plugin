import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Run } from './run.js';
import type { RunRepository } from './run-store.js';
import type { createOpenCodeHost } from './host.js';
import { StageRefused, type Ports } from './orchestrator.js';
import { coderPrompt, reviewerPrompt } from './prompts.js';
import { abandonPlannerTurn, inspectPlannerTurn, reconcilePlannerTurn, startPlannerTurn } from './planner-turn.js';
import { saveReviewerReply } from './planner-handoff.js';
import { runApprovedValidation, runCommandOnce } from './validation.js';
import { coderProfile } from './permissions.js';
import { contentIdentity, createGitWorktree, snapshotDiff, verifyBaselineWorktree } from './worktree.js';
import type { ModelChoice, Policy, Roles, Route } from './settings.js';

type StageHost = Pick<ReturnType<typeof createOpenCodeHost>, 'prepareStage' | 'submitStagePrompt' | 'waitStage' | 'readStage' | 'ownsPrompt' | 'roleForSession' | 'stageModels' | 'interrupt' | 'ownsSession'>;
type Store = { get(key: string): Promise<unknown>; set(key: string, value: string): Promise<void>; compareAndSet?(key: string, expected: unknown, value: string): Promise<boolean> };
type Tool = { id: string; execute(input: { command: string }, context: unknown): Promise<unknown> };
type Prompt = { instructions: string; data: string };

// A file git calls binary hides its content from the reviewer, and a coder can make any file look binary (a NUL byte, a .gitattributes entry).
// Binary-looking source or config is therefore refused; real binary assets are listed to the reviewer as not shown.
const TEXT_LIKE = /.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|cs|php|sh|ps1|bat|cmd|json|ya?ml|toml|md|html?|css|sql|c|h|cpp|hpp|swift|lua|pl)$/i;
// patch + context + prompt overhead must stay under the 1,000,000-byte evidence cap in reviewerPrompt, even after JSON escaping.
const MAX_PATCH_BYTES = 500_000, MAX_CONTEXT_CHARS = 300_000;
export const worktreeKey = (runID: string) => `run-worktree/${encodeURIComponent(runID)}`;
export const contributorsKey = (runID: string) => `run-contributors/${encodeURIComponent(runID)}`;
type Turn = { sessionID: string; promptID: string; inputHash: string; phase: 'dispatching' | 'submitted' | 'complete' | 'abandoned' };
const turnKey = (runID: string, role: 'coder' | 'reviewer') => `stage-turn/${encodeURIComponent(runID)}/${role}`;
/** Literal reasons so each one is listed and explained: an earlier request for this stage may still be running or unreadable. */
const unresolved = (role: 'coder' | 'reviewer'): never => { if (role === 'coder') throw new StageRefused('coder_turn_unresolved'); throw new StageRefused('reviewer_turn_unresolved'); };
const ref = (route: Pick<Route, 'providerID' | 'id' | 'variant'>) => ({ providerID: route.providerID, id: route.id, ...(route.variant !== null ? { variant: route.variant } : {}) });
const find = (routes: readonly Route[], choice: ModelChoice) => routes.find(route => route.providerID === choice.providerID && route.id === choice.id && route.variant === choice.variant);

/** The user's order is the preference order; only routes with a recorded rate qualify. */
export function chooseRoutes(roles: Roles, routes: readonly Route[]): { planner: Route; coder: Route } | { missing: 'planner' | 'coder' } {
  const first = (choices: readonly ModelChoice[]) => choices.map(choice => find(routes, choice)).find((route): route is Route => route !== undefined);
  const planner = first(roles.planner); if (!planner) return { missing: 'planner' };
  const coder = first(roles.coder); if (!coder) return { missing: 'coder' };
  return { planner, coder };
}
/** The reviewer must come from a vendor that took no part in planning or coding. */
export function chooseReviewer(roles: Roles, routes: readonly Route[], contributors: readonly string[]): Route | null {
  if (!contributors.length) return null; // independence cannot be shown without knowing who contributed
  return roles.reviewer.map(choice => find(routes, choice)).find((route): route is Route => route !== undefined && !contributors.includes(route.vendor)) ?? null;
}

export type PortsEnv = {
  repo: RunRepository; host: StageHost; store: Store; projectDir: string;
  roles(): Promise<Roles>; policy(): Promise<Pick<Policy, 'routes' | 'coderEnabled'>>;
  /** The host's registered tools (`context.tool.list`); only `shell` is used, exactly as the verified validation fixture does. */
  tools(): Promise<readonly Tool[]>;
  budget(run: Run): Promise<boolean>;
  validationTimeoutMs?: number;
};

/** Host-backed ports. Capabilities that grant a model write or shell access stay off until the operator enables the coder. */
export function createHostPorts(env: PortsEnv): Ports & { activeSessions(runID: string): string[]; abort(runID: string): void } {
  const active = new Map<string, Set<string>>(), shellSessions = new Map<string, string>(), validations = new Map<string, AbortController>();
  const directoryOf = async (run: Run) => { const value = await env.store.get(worktreeKey(run.id)); if (typeof value !== 'string' || !value) throw new StageRefused('worktree_missing'); return value; };
  const contributors = async (runID: string): Promise<string[]> => { const raw = await env.store.get(contributorsKey(runID)); if (raw === undefined) return []; try { const value = JSON.parse(String(raw)); if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value; } catch { /* fall through */ } throw new Error('Invalid contributor record'); };
  const contributed = async (runID: string, vendor: string) => { const list = await contributors(runID); if (!list.includes(vendor)) await env.store.set(contributorsKey(runID), JSON.stringify([...list, vendor])); };
  const usable = async () => { const picked = chooseRoutes(await env.roles(), (await env.policy()).routes); if ('missing' in picked) throw new StageRefused(`no_route_for_${picked.missing}`); return picked; };
  const requireCoder = async (reason: string) => { if (!(await env.policy()).coderEnabled) throw new StageRefused(reason); };

  // A turn is recorded before anything is sent, so a crash after a paid prompt is reconciled on resume instead of paid for again.
  const readTurn = async (runID: string, role: 'coder' | 'reviewer'): Promise<Turn | null> => {
    const raw = await env.store.get(turnKey(runID, role));
    if (raw === undefined) return null;
    try { const value = JSON.parse(String(raw)); if (value && typeof value.sessionID === 'string' && typeof value.promptID === 'string' && typeof value.inputHash === 'string' && ['dispatching', 'submitted', 'complete', 'abandoned'].includes(value.phase)) return value; } catch { /* unreadable */ }
    return unresolved(role);
  };
  const writeTurn = (runID: string, role: 'coder' | 'reviewer', turn: Turn) => env.store.set(turnKey(runID, role), JSON.stringify(turn));
  const finishTurn = async (runID: string, role: 'coder' | 'reviewer', phase: 'complete' | 'abandoned') => { const turn = await readTurn(runID, role); if (turn) await writeTurn(runID, role, { ...turn, phase }); };

  async function runStage(run: Run, role: 'coder' | 'reviewer', model: ReturnType<typeof ref>, prompt: Prompt, work?: { directory: string; allow: readonly string[] }) {
    const text = `${prompt.instructions}\n\nFeature data (JSON):\n${prompt.data}`, inputHash = createHash('sha256').update(text).digest('hex');
    const earlier = await readTurn(run.id, role);
    if (earlier && earlier.inputHash === inputHash && (earlier.phase === 'dispatching' || earlier.phase === 'submitted')) {
      // Same request as an unfinished earlier turn: look at that session; never send a second paid prompt on a guess.
      let outcome: string | undefined, sent = false;
      try { outcome = (await env.host.readStage(earlier.sessionID, run.id)).outcome; sent = await env.host.ownsPrompt(earlier.sessionID, run.id, earlier.promptID, text); } catch { return unresolved(role); }
      if (outcome === 'succeeded' && sent) return { sessionID: earlier.sessionID, promptID: earlier.promptID };
      if (outcome === 'failed' || outcome === 'interrupted' || (!sent && earlier.phase === 'dispatching' && outcome === undefined)) await writeTurn(run.id, role, { ...earlier, phase: 'abandoned' });
      else return unresolved(role);
    }
    const sessionID = await env.host.prepareStage({ runID: run.id, role, model, ...(work ? { work } : {}) });
    const promptID = `msg_${randomUUID()}`, sessions = active.get(run.id) ?? new Set<string>();
    active.set(run.id, sessions.add(sessionID));
    const turn: Turn = { sessionID, promptID, inputHash, phase: 'dispatching' };
    await writeTurn(run.id, role, turn);
    try {
      // A stop (or any change) during session preparation must not still send a paid prompt.
      const current = await env.repo.get(run.id);
      if (current.stopRequested || current.revision !== run.revision) { await writeTurn(run.id, role, { ...turn, phase: 'abandoned' }); throw new StageRefused(current.stopRequested ? 'stop_requested' : 'run_changed'); }
      await env.host.submitStagePrompt(sessionID, run.id, promptID, text);
      await writeTurn(run.id, role, { ...turn, phase: 'submitted' });
      await env.host.waitStage(sessionID, run.id);
    } finally { sessions.delete(sessionID); if (!sessions.size) active.delete(run.id); }
    return { sessionID, promptID };
  }

  /** A stop must end the wait at once; the signal is also handed to the host tool, which may or may not honour it. */
  function stoppable(run: Run, directory: string) {
    const stop = new AbortController(); validations.set(run.id, stop);
    const execute = (command: string, signal: AbortSignal) => {
      const stopped = new Promise<never>((_, reject) => { if (stop.signal.aborted) reject(new Error('Stopped')); stop.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }); });
      return Promise.race([shell(run, directory, command, AbortSignal.any([signal, stop.signal])), stopped]);
    };
    return { execute, release: () => { validations.delete(run.id); } };
  }

  /** A session exists only to give the host shell tool its working directory and permission; no prompt is ever sent to it. */
  async function shell(run: Run, directory: string, command: string, signal: AbortSignal): Promise<unknown> {
    const tool = (await env.tools()).find(item => item.id === 'shell');
    if (!tool) throw new StageRefused('shell_tool_unavailable');
    let sessionID = shellSessions.get(run.id);
    if (!sessionID) { sessionID = await env.host.prepareStage({ runID: run.id, role: 'coder', model: ref((await usable()).coder), work: { directory, allow: ['shell'] } }); shellSessions.set(run.id, sessionID); }
    return tool.execute({ command }, { sessionID, agent: 'build', messageID: `msg_${randomUUID()}`, id: `call_${randomUUID()}`, signal, progress: async () => {} });
  }

  async function reviewContext(directory: string, files: readonly string[]) {
    const root = await realpath(resolve(directory)), context: { path: string; content: string }[] = []; let total = 0;
    for (const name of files.filter(Boolean).slice(0, 20)) {
      const path = resolve(root, name);
      if (relative(root, path).startsWith('..') || !path.startsWith(root + sep)) continue; // never read outside the worktree
      try {
        // The coder can write here, so a link must not be able to pull a file from outside into a prompt sent to another vendor.
        if (!(await lstat(path)).isFile()) continue;
        const real = await realpath(path); if (!real.startsWith(root + sep)) continue;
        const content = await readFile(real, 'utf8'); if (content.length > 40_000 || total + content.length > MAX_CONTEXT_CHARS) continue; total += content.length; context.push({ path: name, content }); } catch { /* unreadable or deleted: the diff still shows it */ }
    }
    return context;
  }

  /** The checks that must hold before a diff can be reviewed; shared by the early check and the review itself. */
  async function inspect(run: Run) {
    const directory = await directoryOf(run);
    const snapshot = await snapshotDiff(directory, run.baseCommit, { maxPatchBytes: MAX_PATCH_BYTES }).catch(error => { throw error instanceof Error && /leads outside/.test(error.message) ? new StageRefused('worktree_link_outside') : error; });
    if (snapshot.truncated) throw new StageRefused('diff_too_large_to_review');
    if (snapshot.binaryFiles.some(name => TEXT_LIKE.test(name))) throw new StageRefused('text_file_treated_as_binary');
    return { directory, snapshot };
  }

  return {
    activeSessions: runID => [...(active.get(runID) ?? [])],
    abort: runID => { validations.get(runID)?.abort(); },
    async plan(run) {
      const { planner } = await usable();
      await contributed(run.id, planner.vendor);
      // A turn whose prompt may have been sent is reconciled from the host's own record first, never blindly replayed. Only when that
      // turn is provably unusable (nothing was sent, it failed, or its reply cannot be applied) does a user's Resume ask the planner again.
      const turn = await inspectPlannerTurn(env.store, run.id);
      if (turn && turn.phase !== 'complete') {
        if (turn.phase === 'dispatching' || turn.phase === 'submitted') {
          let result: Awaited<ReturnType<typeof reconcilePlannerTurn>> | null = null;
          try { result = await reconcilePlannerTurn(env.repo, env.host, env.store, run.id); } catch { /* the reply could not be applied */ }
          if (result?.status === 'recovered') return result.run;
          if (result?.status === 'complete') return env.repo.get(run.id);
          if (result?.status === 'needs_attention' && (result.reason === 'turn_active' || result.reason === 'session_unresolved')) throw new StageRefused(`planner_${result.reason}`);
        }
        await abandonPlannerTurn(env.store, run.id);
      }
      return startPlannerTurn(env.repo, env.host, env.store, { runID: run.id, revision: run.revision, model: ref(planner) });
    },
    async prepareWorktree(run) {
      if (typeof await env.store.get(worktreeKey(run.id)) === 'string') return;
      let directory: string;
      try { ({ directory } = await createGitWorktree(env.projectDir, run.id, run.baseCommit)); await verifyBaselineWorktree(directory, run.baseCommit); }
      catch { throw new StageRefused('worktree_unavailable'); }
      await env.store.set(worktreeKey(run.id), directory);
    },
    async identity(run) { return contentIdentity(await directoryOf(run)); },
    async code(run, step) {
      await requireCoder('coder_not_enabled');
      const { coder } = await usable(), directory = await directoryOf(run);
      // Independence is rechecked on every repair: a coder from the reviewer's vendor would void the review already recorded.
      if (run.review && run.review.reviewer.vendor === coder.vendor) throw new StageRefused('coder_shares_reviewer_vendor');
      const stepID = step?.id ?? [...(run.plan?.steps ?? [])].reverse().find(item => item.role === 'coder' && !item.execution && item.taskKind !== 'review')?.id;
      if (!stepID) throw new StageRefused('no_coder_step');
      await contributed(run.id, coder.vendor);
      const { sessionID } = await runStage(run, 'coder', ref(coder), coderPrompt(run, stepID), { directory, allow: coderProfile.allowedActions });
      if ((await env.host.readStage(sessionID, run.id)).outcome !== 'succeeded') { await finishTurn(run.id, 'coder', 'abandoned'); throw new Error('Coder session did not complete'); }
      await finishTurn(run.id, 'coder', 'complete');
    },
    async runCommand(run, step) {
      await requireCoder('shell_not_enabled');
      if (!(await env.tools()).some(item => item.id === 'shell')) throw new StageRefused('shell_tool_unavailable');
      if (step.execution?.kind !== 'command') throw new StageRefused('unsupported_step');
      const directory = await directoryOf(run), guard = stoppable(run, directory);
      try { const result = await runCommandOnce(step.execution.command, step.execution.deadlineMs, guard.execute); return { status: result.status, exitCode: result.exitCode }; }
      finally { guard.release(); }
    },
    async validate(run, identity) {
      await requireCoder('shell_not_enabled');
      if (!(await env.tools()).some(item => item.id === 'shell')) throw new StageRefused('shell_tool_unavailable'); // runApprovedValidation would hide this as 'unknown'
      const directory = await directoryOf(run), guard = stoppable(run, directory);
      let report: Awaited<ReturnType<typeof runApprovedValidation>>;
      try { report = await runApprovedValidation(run, { diffHash: identity, timeoutMs: env.validationTimeoutMs ?? 600_000, currentDiff: () => contentIdentity(directory), execute: guard.execute }); }
      finally { guard.release(); }
      return { status: report.status, commands: report.commands.map(item => ({ command: item.command, exitCode: item.exitCode })) };
    },
    async reviewer(run) {
      if (run.review) return { reviewer: run.review.reviewer, contributingVendors: run.review.contributingVendors };
      const vendors = await contributors(run.id), route = chooseReviewer(await env.roles(), (await env.policy()).routes, vendors);
      return route ? { reviewer: { providerID: route.providerID, id: route.id, variant: route.variant, vendor: route.vendor, modelVersion: route.modelVersion }, contributingVendors: vendors } : null;
    },
    async reviewable(run) { await inspect(run); },
    async review(run) {
      const pending = run.review?.pending; if (!pending) throw new Error('No pending review');
      const { directory, snapshot } = await inspect(run);
      if (snapshot.identity !== pending.diffHash) throw new StageRefused('worktree_changed_since_validation');
      const notShown = snapshot.binaryFiles.length ? `

Binary files not shown to you (${snapshot.binaryFiles.length}): ${snapshot.binaryFiles.slice(0, 50).join(', ')}` : '';
      let prompt: ReturnType<typeof reviewerPrompt>;
      try { prompt = reviewerPrompt(run, { diffHash: pending.diffHash, diff: snapshot.patch + notShown, context: await reviewContext(directory, snapshot.files.filter(name => !snapshot.binaryFiles.includes(name))) }); }
      catch (error) { throw error instanceof Error && /too large/i.test(error.message) ? new StageRefused('review_evidence_too_large') : error; }
      const { sessionID, promptID } = await runStage(run, 'reviewer', ref(run.review!.reviewer), prompt);
      try { const updated = await saveReviewerReply(env.repo, env.host, { runID: run.id, revision: run.revision, sessionID, promptID }); await finishTurn(run.id, 'reviewer', 'complete'); return updated; }
      catch (error) { await finishTurn(run.id, 'reviewer', 'abandoned'); throw error; } // an unusable reply must not be reused on resume
    },
    budgetAvailable: run => env.budget(run),
  };
}
