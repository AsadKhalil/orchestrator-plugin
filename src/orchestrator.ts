import type { Run } from './run.js';
import type { RunRepository } from './run-store.js';
import type { PlanStep } from './plan.js';
import { canStartStep } from './jobs.js';

/** A port refuses a stage for a stated reason (for example a capability the operator has not enabled); the run pauses with it. */
export class StageRefused extends Error {
  constructor(readonly reason: string) { super(`Stage refused: ${reason}`); this.name = 'StageRefused'; }
}
export type ReviewerPin = { providerID: string; id: string; variant: string | null; vendor: string; modelVersion: string };
export type ValidationReport = { status: 'passed' | 'failed' | 'unknown' | 'timed_out' | 'stale'; commands: { command: string; exitCode: number | null }[] };

/**
 * Everything that touches the host. The driver only decides what happens next from the persisted run, so a restarted process
 * resumes from storage. The planner, coder and reviewer turns each record a checkpoint before anything is sent; on resume a
 * finished earlier turn is reused, an unreadable or still-running one pauses the run, and only a failed or provably unsent one is
 * asked again. The spend ledger bounds the cost of that remaining case but does not prevent it.
 */
export type Ports = {
  /** Run one approved one-shot command step to completion and report how it ended. Omitted when the host cannot run commands. */
  runCommand?(run: Run, step: PlanStep): Promise<{ status: 'passed' | 'failed' | 'timed_out' | 'unknown'; exitCode: number | null }>;
  /** Run one planning turn; the run leaves `planning` (to `clarifying` or `awaiting_approval`) when its output is stored. */
  plan(run: Run): Promise<Run>;
  /** Create (or find) the isolated worktree at `run.baseCommit`. Must be idempotent. */
  prepareWorktree(run: Run): Promise<void>;
  /** Content identity of the run's worktree right now. */
  identity(run: Run): Promise<string>;
  /** One coder turn in the worktree: a planned step, or `null` for a repair round driven by the blocking findings in `run.review`. */
  code(run: Run, step: PlanStep | null): Promise<void>;
  /** Run the approved validation commands through the host shell tool against the given identity. */
  validate(run: Run, identity: string): Promise<ValidationReport>;
  /** The pinned independent reviewer and the vendors that contributed to the work, or null when none qualifies. */
  reviewer(run: Run): Promise<{ reviewer: ReviewerPin; contributingVendors: string[] } | null>;
  /** Optional early check that the diff can be reviewed at all (size, links, hidden content), so a refusal lands while the run can still be amended. */
  reviewable?(run: Run): Promise<void>;
  /** Run the pending review turn; returns the run after the verdict is recorded. */
  review(run: Run): Promise<Run>;
  /** Whether the next paid stage may be dispatched. */
  budgetAvailable(run: Run): Promise<boolean>;
};
export type Options = { autonomous?: boolean; maxTicks?: number };

const waiting = ['clarifying', 'awaiting_approval', 'ready_for_acceptance', 'accepted', 'cancelled', 'needs_attention'];
const isCoderStep = (step: PlanStep) => step.role === 'coder' && !step.execution && step.taskKind !== 'review';
/** A one-shot command is awaited in the foreground. A service (or any command run by another role) would need an owned background shell, which the host gate forbids. */
const isCommandStep = (step: PlanStep) => step.role === 'coder' && step.execution?.kind === 'command';

/** Perform at most one persisted transition. `progressed` is false when the run is waiting for a person or finished. */
export async function advance(repo: RunRepository, ports: Ports, runID: string, options: Options = {}): Promise<{ run: Run; progressed: boolean }> {
  const run = await repo.get(runID);
  const stay = (): { run: Run; progressed: boolean } => ({ run, progressed: false });
  // Re-read first: a stop requested while a stage was in flight turns its failure into a cancellation, not a pause on a stopped run.
  const pause = async (reason: string) => {
    const current = await repo.get(run.id);
    if (current.stopRequested) return { run: await repo.finishStop(current.id, current.revision), progressed: true };
    return { run: await repo.needsAttention(current.id, current.revision, reason), progressed: true };
  };
  const guarded = async (work: () => Promise<Run>) => {
    // A failed or ambiguous stage is never retried automatically: the user resumes, and stage checkpoints decide what is safe.
    try { return { run: await work(), progressed: true }; } catch (error) { return pause(error instanceof StageRefused ? error.reason : 'stage_failed'); }
  };

  // A stop at ready_for_acceptance also cancels: accepting is refused once a stop is requested, so leaving it would strand the run.
  if (run.stopRequested && run.state !== 'accepted' && run.state !== 'cancelled') return { run: await repo.finishStop(run.id, run.revision), progressed: true };
  if (run.state === 'awaiting_approval' && options.autonomous && run.planHash) return { run: await repo.approve(run.id, run.revision, run.planHash, 'autonomous'), progressed: true };
  if (waiting.includes(run.state)) return stay();

  if (run.state === 'planning') {
    if (!await ports.budgetAvailable(run)) return pause('budget_exhausted');
    return guarded(() => ports.plan(run));
  }

  if (run.state === 'implementing') {
    const steps = run.plan?.steps ?? [];
    // Decided before any model turn is paid for: a plan we cannot finish is not started.
    if (steps.some(step => step.execution && (!isCommandStep(step) || !ports.runCommand))) return pause('unsupported_step');
    const next = steps.find(step => (isCoderStep(step) || isCommandStep(step)) && !run.outcomes.some(outcome => outcome.stepID === step.id));
    if (!next) return { run: await repo.beginValidation(run.id, run.revision), progressed: true };
    if (!isCommandStep(next) && !await ports.budgetAvailable(run)) return pause('budget_exhausted'); // a command spends no model money
    return guarded(async () => {
      await ports.prepareWorktree(run);
      const before = await ports.identity(run);
      // Recording the outcome needs the step's dependencies satisfied on the current content; learn that now, not after paying for the turn.
      if (!canStartStep(next, run.jobs, before, run.outcomes)) throw new StageRefused('step_dependencies_unmet');
      let evidence = `Coder turn completed for step ${next.id}`;
      if (isCommandStep(next)) {
        // Only the exit status is kept: command output can hold secrets and the command itself is already part of the approved plan.
        const result = await ports.runCommand!(run, next);
        if (result.status === 'timed_out') throw new StageRefused('step_command_timed_out');
        if (result.status === 'failed') throw new StageRefused('step_command_failed');
        if (result.status !== 'passed') throw new StageRefused('step_command_unknown');
        evidence = `Command step ${next.id} exited 0 within ${next.execution!.deadlineMs} ms`;
      } else await ports.code(run, next);
      const after = await ports.identity(run);
      return repo.recordStepOutcome(run.id, run.revision, { stepID: next.id, inputContentVersion: before, contentVersion: after, evidence });
    });
  }

  if (run.state === 'repairing') {
    if (!await ports.budgetAvailable(run)) return pause('budget_exhausted');
    return guarded(async () => { await ports.code(run, null); return repo.beginValidation(run.id, run.revision); });
  }

  if (run.state === 'validating') {
    let identity: string, report: ValidationReport;
    try { identity = await ports.identity(run); report = await ports.validate(run, identity); } catch (error) { return pause(error instanceof StageRefused ? error.reason : 'validation_unavailable'); }
    if (report.status !== 'passed') return pause(`validation_${report.status}`);
    const picked = await ports.reviewer(run);
    if (!picked) return pause('no_independent_reviewer');
    if (ports.reviewable) { try { await ports.reviewable(run); } catch (error) { return pause(error instanceof StageRefused ? error.reason : 'review_not_possible'); } }
    if (!await ports.budgetAvailable(run)) return pause('budget_exhausted');
    const validation = { diffHash: identity, commands: report.commands.map(item => ({ command: item.command, exitCode: item.exitCode ?? -1 })) };
    // The run record enforces reviewer independence and plan/diff/validation identity; a refusal pauses instead of crashing the driver.
    try { return { run: await repo.startReview(run.id, run.revision, { planHash: run.planHash!, diffHash: identity, validation, reviewer: picked.reviewer, contributingVendors: picked.contributingVendors, budgetAvailable: true }), progressed: true }; }
    catch { return pause('review_not_permitted'); }
  }

  // reviewing
  if (!run.review?.pending) return pause('review_state_invalid');
  return guarded(() => ports.review(run));
}

/** Advance until the run waits for a person, finishes, or `maxTicks` transitions have run. */
export async function drive(repo: RunRepository, ports: Ports, runID: string, options: Options = {}): Promise<Run> {
  const limit = options.maxTicks ?? 200;
  for (let tick = 0; tick < limit; tick++) {
    const step = await advance(repo, ports, runID, options);
    if (!step.progressed) return step.run;
  }
  return repo.get(runID);
}
