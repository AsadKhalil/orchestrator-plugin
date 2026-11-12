import { createHash } from 'node:crypto';
import { canonicalPlan, validatePlan, type Plan } from './plan.js';
import { createShellJob, attachShell, applyShellExit, markServiceReady, expireJob, canStartStep, validateShellJobs, type ShellJob, type StepOutcome } from './jobs.js';

type Clarification = { id: string; question: string; answer: string | null };
type Reviewer = { providerID: string; id: string; variant: string | null; vendor: string; modelVersion: string };
type Validation = { diffHash: string; commands: { command: string; exitCode: number }[] };
type Finding = { id: string; severity: 'blocking' | 'advisory'; description: string; evidence: string };
type ReviewTrack = { reviewer: Reviewer; contributingVendors: string[]; repairRounds: number; pending: { diffHash: string; validation: Validation } | null; reviews: { diffHash: string; validation: Validation; verdict: 'approve' | 'request_changes'; findings: Finding[] }[] };
/** Exactly the states of the design: no separate "approved" state; approval moves straight to implementation. */
export const runStates = ['clarifying', 'planning', 'awaiting_approval', 'implementing', 'validating', 'reviewing', 'repairing', 'ready_for_acceptance', 'accepted', 'needs_attention', 'cancelled'] as const;
export type RunState = typeof runStates[number];
const liveStates = ['clarifying', 'planning', 'awaiting_approval', 'implementing', 'validating', 'reviewing', 'repairing'] as const;
type LiveState = typeof liveStates[number];
const endedStates: readonly RunState[] = ['ready_for_acceptance', 'accepted', 'needs_attention', 'cancelled'];
const jobStates: readonly RunState[] = ['implementing', 'repairing', 'validating'];
/** `resumeState` is the checkpoint a user may resume from; null means the stop is final (for example the review limit). */
type Attention = { reason: string; resumeState: LiveState | null };
type Approval = { planHash: string; type: 'human' | 'autonomous' };
export type Run = {
  id: string; requirement: string; baseCommit: string; revision: number; stopRequested: boolean;
  createdAt: number; endedAt: number | null; state: RunState; attention: Attention | null; amendments: { planHash: string; reason: string }[];
  jobs: ShellJob[]; outcomes: StepOutcome[]; clarification: Clarification[]; plan: Plan | null; planHash: string | null; approval: Approval | null; review: ReviewTrack | null;
};

function requireText(value: string, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
}
function requireRevision(run: Run, revision: number, allowStopped = false) {
  if (!Number.isSafeInteger(revision) || run.revision !== revision) throw new Error('Stale run revision');
  if (run.stopRequested && !allowStopped) throw new Error('Stop requested');
}
function hashPlan(run: Run, plan: Plan): string {
  validatePlan(plan);
  if (run.clarification.some(q => q.answer === null) || JSON.stringify(run.clarification.map(q => [q.question, q.answer])) !== JSON.stringify(plan.questions.map(q => [q.question, q.answer]))) throw new Error('Plan questions do not match clarification');
  return createHash('sha256').update(JSON.stringify([run.requirement, run.baseCommit, run.clarification.map(q => [q.id, q.question, q.answer]),
    canonicalPlan(plan)])).digest('hex');
}

/** Pure lifecycle records; durable storage and execution are separate host responsibilities. */
export function newRun(id: string, requirement: string, baseCommit: string, now: number = Date.now()): Run {
  requireText(id, 'Run ID'); requireText(requirement, 'Requirement'); requireText(baseCommit, 'Base commit');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock');
  return { id, requirement, baseCommit, revision: 0, stopRequested: false, createdAt: now, endedAt: null, state: 'planning', attention: null, amendments: [], jobs: [], outcomes: [], clarification: [], plan: null, planHash: null, approval: null, review: null };
}
/** Approved but nothing executed yet: the plan can still be revised, which clears the approval. */
const unstarted = (run: Run) => run.state === 'implementing' && !run.jobs.length && !run.outcomes.length;
function endedAt(run: Run, now: number): number { return run.endedAt ?? Math.max(now, run.createdAt); }
/** Persist the stop request first; this alone does not interrupt sessions or processes. */
export function requestStop(run: Run, revision: number): Run {
  requireRevision(run, revision, true); validateRun(run);
  if (run.state === 'accepted') throw new Error('Run is already accepted');
  if (run.stopRequested) return run;
  return { ...run, revision: run.revision + 1, stopRequested: true };
}
export function setPlan(run: Run, revision: number, plan: Plan): Run {
  requireRevision(run, revision); validateRun(run);
  if (!['planning', 'awaiting_approval'].includes(run.state) && !unstarted(run)) throw new Error('Clarification or run state blocks planning');
  validatePlan(plan);
  const copy = structuredClone(plan);
  return { ...run, revision: run.revision + 1, state: 'awaiting_approval', plan: copy, planHash: hashPlan(run, copy), approval: null, review: null };
}
/** Approval of the exact hash moves straight to implementation. `autonomous` is valid only when the caller holds a recorded policy authorization. */
export function approvePlan(run: Run, revision: number, planHash: string, approver: 'human' | 'autonomous' = 'human'): Run {
  requireRevision(run, revision);
  if (run.state !== 'awaiting_approval' || !run.plan || !run.planHash || run.planHash !== planHash || hashPlan(run, run.plan) !== planHash) throw new Error('Plan hash or state does not match approval');
  if (approver !== 'human' && approver !== 'autonomous') throw new Error('Invalid approver');
  return { ...run, revision: run.revision + 1, state: 'implementing', approval: { planHash, type: approver } };
}
/** Verifies that implementation is authorized for the exact stored plan; it does not change the run. */
export function beginImplementation(run: Run, revision: number): Run {
  requireRevision(run, revision);
  if (run.state !== 'implementing' || !run.plan || !run.planHash || !run.approval || run.approval.planHash !== run.planHash) throw new Error('Valid plan approval required');
  if (hashPlan(run, run.plan) !== run.planHash) throw new Error('Approved plan hash has changed');
  return run;
}
/** Implementation or a repair has finished; validation commands run next and their results go to `startReview`. */
export function beginValidation(run: Run, revision: number): Run {
  requireRevision(run, revision); validateRun(run);
  if (!['implementing', 'repairing'].includes(run.state) || !run.plan || !run.approval) throw new Error('Invalid state for validation');
  checkStepOutcomes(run);
  return { ...run, revision: run.revision + 1, state: 'validating' };
}
/** Work that needs a different approved scope returns to planning; the old plan hash and reason are kept for audit and the new plan needs its own approval. */
export function requestAmendment(run: Run, revision: number, reason: string): Run {
  requireRevision(run, revision); validateRun(run); requireText(reason, 'Amendment reason');
  if (!['implementing', 'repairing', 'validating'].includes(run.state) || !run.planHash) throw new Error('Invalid state for amendment');
  if (run.jobs.some(job => ['pending', 'running', 'ready', 'unknown'].includes(job.status))) throw new Error('Active or unresolved job blocks amendment');
  if (run.amendments.length >= 20) throw new Error('Too many plan amendments');
  return { ...run, revision: run.revision + 1, state: run.clarification.some(q => q.answer === null) ? 'clarifying' : 'planning', amendments: [...run.amendments, { planHash: run.planHash, reason }], jobs: [], outcomes: [], plan: null, planHash: null, approval: null, review: null };
}
/** Pause for a user decision, keeping the checkpoint to resume from. */
export function markNeedsAttention(run: Run, revision: number, reason: string, now: number = Date.now()): Run {
  requireRevision(run, revision, true); validateRun(run); requireText(reason, 'Reason');
  if (run.state === 'needs_attention') return run;
  if (!(liveStates as readonly string[]).includes(run.state)) throw new Error('Run is not active');
  return { ...run, revision: run.revision + 1, state: 'needs_attention', attention: { reason, resumeState: run.state as LiveState }, endedAt: endedAt(run, now) };
}
export function resumeRun(run: Run, revision: number): Run {
  requireRevision(run, revision); validateRun(run);
  if (run.state !== 'needs_attention' || !run.attention?.resumeState) throw new Error('Run cannot be resumed');
  return { ...run, revision: run.revision + 1, state: run.attention.resumeState, attention: null, endedAt: null };
}
/** Finish a requested stop: cancel when no owned job is unresolved, otherwise pause with the unconfirmed cleanup recorded. Artifacts are kept. */
export function finishStop(run: Run, revision: number, now: number = Date.now()): Run {
  requireRevision(run, revision, true); validateRun(run);
  if (!run.stopRequested) throw new Error('Stop was not requested');
  if (run.state === 'accepted' || run.state === 'cancelled') return run;
  if (run.jobs.some(job => ['pending', 'running', 'ready', 'unknown'].includes(job.status))) {
    return run.state === 'needs_attention' ? run : markNeedsAttention(run, revision, 'stop_cleanup_unconfirmed', now);
  }
  return { ...run, revision: run.revision + 1, state: 'cancelled', attention: null, endedAt: endedAt(run, now) };
}
export function updateRequirement(run: Run, revision: number, requirement: string): Run {
  requireRevision(run, revision); requireText(requirement, 'Requirement');
  if (run.jobs.length || run.outcomes.length) throw new Error('Execution history must be preserved before changing the requirement');
  return { ...run, requirement, revision: run.revision + 1, state: 'planning', clarification: [], plan: null, planHash: null, approval: null, review: null };
}


function validateClarification(run: Run, mode: RunState = run.state) {
  if (!Array.isArray(run.clarification) || run.clarification.length > 100) throw new Error('Invalid clarification');
  const ids = new Set<string>();
  for (const q of run.clarification) {
    if (!q || typeof q !== 'object') throw new Error('Invalid clarification question');
    requireText(q.id, 'Question ID'); requireText(q.question, 'Question');
    if (ids.has(q.id)) throw new Error('Duplicate question'); ids.add(q.id);
    if (q.answer !== null) requireText(q.answer, 'Question answer');
  }
  const pending = run.clarification.some(q => q.answer === null);
  // A cancelled run keeps whatever questions it had; a paused run is checked against the state it will resume to.
  if (mode !== 'cancelled' && (mode === 'clarifying') !== pending) throw new Error('Clarification questions do not match state');
}
export function askQuestions(run: Run, revision: number, questions: { id: string; question: string }[]): Run {
  requireRevision(run, revision); validateRun(run);
  if (run.state !== 'planning' || !Array.isArray(questions) || !questions.length) throw new Error('Invalid clarification request');
  const clarification = [...run.clarification, ...questions.map(q => ({ id: q?.id, question: q?.question, answer: null }))];
  const next: Run = { ...run, revision: run.revision + 1, state: 'clarifying', clarification };
  validateClarification(next); return structuredClone(next);
}
export function answerQuestions(run: Run, revision: number, answers: { id: string; answer: string }[]): Run {
  requireRevision(run, revision); validateRun(run);
  if (!['clarifying', 'planning', 'awaiting_approval'].includes(run.state) && !unstarted(run) || !Array.isArray(answers) || !answers.length) throw new Error('Invalid clarification answer state');
  const seen = new Set<string>();
  for (const answer of answers) {
    if (!answer || typeof answer !== 'object') throw new Error('Invalid question answer');
    requireText(answer.id, 'Question ID'); requireText(answer.answer, 'Question answer');
    if (seen.has(answer.id) || !run.clarification.some(q => q.id === answer.id)) throw new Error('Unknown or duplicate question'); seen.add(answer.id);
  }
  const clarification = run.clarification.map(q => ({ ...q, answer: answers.find(a => a.id === q.id)?.answer ?? q.answer }));
  const next: Run = { ...run, revision: run.revision + 1, state: clarification.some(q => q.answer === null) ? 'clarifying' : 'planning', clarification, plan: null, planHash: null, approval: null, review: null };
  validateClarification(next); return structuredClone(next);
}

/** Validate persisted lifecycle records before using them in another transition. */
export function validateRun(value: unknown): Run {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run record');
  const run = value as Run;
  requireText(run.id, 'Run ID'); requireText(run.requirement, 'Requirement'); requireText(run.baseCommit, 'Base commit');
  if (typeof run.stopRequested !== 'boolean' || !Number.isSafeInteger(run.revision) || run.revision < 0 || !(runStates as readonly string[]).includes(run.state)) throw new Error('Invalid run record');
  if (!Number.isSafeInteger(run.createdAt) || run.createdAt < 0 || !(run.endedAt === null || (Number.isSafeInteger(run.endedAt) && run.endedAt >= run.createdAt)) || endedStates.includes(run.state) !== (run.endedAt !== null)) throw new Error('Invalid run record');
  const attention = run.attention;
  if ((run.state === 'needs_attention') !== (attention !== null)) throw new Error('Invalid attention record');
  if (attention) { requireText(attention.reason, 'Attention reason'); if (!(attention.resumeState === null || (liveStates as readonly string[]).includes(attention.resumeState))) throw new Error('Invalid attention record'); }
  if (run.state === 'cancelled' && !run.stopRequested) throw new Error('Invalid cancelled record');
  if (!Array.isArray(run.amendments) || run.amendments.length > 20 || run.amendments.some(a => !a || typeof a.planHash !== 'string' || !a.planHash || typeof a.reason !== 'string' || !a.reason.trim())) throw new Error('Invalid amendment history');
  // The state whose invariants apply: a paused run is checked against the checkpoint it will resume to.
  const mode: RunState = attention?.resumeState ?? run.state;
  validateClarification(run, mode);
  if (run.state === 'cancelled') {
    if (run.plan === null) { if (run.planHash !== null || run.approval !== null) throw new Error('Invalid planning record'); }
    else if (typeof run.planHash !== 'string' || hashPlan(run, run.plan) !== run.planHash || (run.approval !== null && !validApproval(run))) throw new Error('Invalid plan hash');
  } else if (mode === 'planning' || mode === 'clarifying') {
    if (run.plan !== null || run.planHash !== null || run.approval !== null) throw new Error('Invalid planning record');
  } else {
    if (!run.plan || typeof run.planHash !== 'string' || hashPlan(run, run.plan) !== run.planHash) throw new Error('Invalid plan hash');
    if (mode === 'awaiting_approval') {
      if (run.approval !== null) throw new Error('Invalid approval record');
    } else if (!run.approval || !validApproval(run)) throw new Error('Invalid approval record');
  }
  validateShellJobs(run.jobs, run.plan?.steps ?? []);
  if (!Array.isArray(run.outcomes) || run.outcomes.length > 1000) throw new Error('Invalid step outcomes');
  for (const outcome of run.outcomes) {
    // A one-shot command step is awaited in the foreground and completes by outcome; only a service (or a step with a job) needs the job path.
    if (!outcome || !run.plan?.steps.some(step => step.id === outcome.stepID && (!step.execution || step.execution.kind === 'command')) || run.jobs.some(job => job.stepID === outcome.stepID)) throw new Error('Invalid step outcome');
    requireText(outcome.inputContentVersion, 'Outcome input content version'); requireText(outcome.contentVersion, 'Outcome content version'); requireText(outcome.evidence, 'Outcome evidence');
    const step = run.plan!.steps.find(item => item.id === outcome.stepID)!;
    if (step.resources && !step.resources.write.length && outcome.inputContentVersion !== outcome.contentVersion) throw new Error('Read-only step changed content');
  }
  validateReviewState(run);
  return structuredClone(run);
}

function validApproval(run: Run): boolean {
  return !!run.approval && (run.approval.type === 'human' || run.approval.type === 'autonomous') && run.approval.planHash === run.planHash;
}
function checkValidation(validation: Validation, diffHash: string, approvedCommands: readonly string[]) {
  if (!validation || validation.diffHash !== diffHash || !Array.isArray(validation.commands) || !validation.commands.length || validation.commands.length !== approvedCommands.length || new Set(validation.commands.map(c => c?.command)).size !== approvedCommands.length || validation.commands.some(c => !c || typeof c.command !== 'string' || !approvedCommands.includes(c.command) || c.exitCode !== 0)) throw new Error('Passing validation for this diff is required');
}
function checkReviewer(reviewer: Reviewer, vendors: string[]) {
  if (!reviewer || typeof reviewer !== 'object') throw new Error('Invalid reviewer');
  for (const value of [reviewer.providerID, reviewer.id, reviewer.vendor, reviewer.modelVersion]) requireText(value, 'Reviewer');
  if (!(reviewer.variant === null || (typeof reviewer.variant === 'string' && reviewer.variant.trim()))) throw new Error('Invalid reviewer variant');
  if (!Array.isArray(vendors) || !vendors.length || vendors.some(v => typeof v !== 'string' || !v.trim())) throw new Error('Contributing vendors required');
  if (vendors.includes(reviewer.vendor)) throw new Error('Reviewer vendor conflicts with contributors');
}
function checkFindings(findings: Finding[]) {
  if (!Array.isArray(findings)) throw new Error('Invalid findings');
  const ids = new Set<string>();
  for (const f of findings) {
    if (!f || !['blocking', 'advisory'].includes(f.severity)) throw new Error('Invalid finding');
    for (const value of [f.id, f.description, f.evidence]) requireText(value, 'Finding');
    if (ids.has(f.id)) throw new Error('Duplicate finding'); ids.add(f.id);
  }
}
function checkVerdict(verdict: 'approve' | 'request_changes', findings: Finding[]) {
  const blocking = findings.some(f => f.severity === 'blocking');
  if ((verdict !== 'approve' && verdict !== 'request_changes') || (verdict === 'approve' && blocking) || (verdict === 'request_changes' && !blocking)) throw new Error('Review verdict does not match findings');
}
function checkStepOutcomes(run: Run) {
  // Implementation work must be done before validation. A `validate`-kind execution step is judged at review time (startReview) by its job or
  // foreground outcome; any other command step needs its outcome unless a job covers it.
  for (const step of run.plan!.steps.filter(item => item.role === 'coder' && (!item.execution || (item.execution.kind === 'command' && item.taskKind !== 'validate' && !run.jobs.some(job => job.stepID === item.id))) && item.taskKind !== 'review')) {
    if (!run.outcomes.some(outcome => outcome.stepID === step.id)) throw new Error('Implementation step outcome is missing');
  }
}
function validateReviewState(run: Run) {
  const review = run.review;
  const mode: RunState = run.attention?.resumeState ?? run.state;
  const structural = (r: ReviewTrack) => {
    if (!Array.isArray(r.reviews) || !Number.isSafeInteger(r.repairRounds) || r.repairRounds < 0 || r.repairRounds > 2 || r.reviews.length > 3) throw new Error('Invalid review state');
    checkReviewer(r.reviewer, r.contributingVendors);
    for (const item of r.reviews) { requireText(item.diffHash, 'Diff hash'); checkValidation(item.validation, item.diffHash, run.plan!.validationCommands); checkFindings(item.findings); checkVerdict(item.verdict, item.findings); }
    if (r.pending) { requireText(r.pending.diffHash, 'Diff hash'); checkValidation(r.pending.validation, r.pending.diffHash, run.plan!.validationCommands); }
  };
  if (run.state === 'cancelled') { if (review) structural(review); return; }
  if (['clarifying', 'planning', 'awaiting_approval', 'implementing'].includes(mode)) {
    if (review !== null) throw new Error('Unexpected review state'); return;
  }
  checkStepOutcomes(run);
  if (mode === 'validating' && review === null) return;
  if (!review) throw new Error('Invalid review state');
  structural(review);
  if ((mode === 'reviewing') !== !!review.pending) throw new Error('Invalid pending review');
  const blockers = review.reviews.at(-1)?.findings.some(f => f.severity === 'blocking');
  if (review.reviews.slice(0, -1).some(item => !item.findings.some(f => f.severity === 'blocking'))) throw new Error('Invalid review history');
  if (mode === 'reviewing' && (review.reviews.length !== review.repairRounds || (review.reviews.length > 0 && !blockers))) throw new Error('Invalid review sequence');
  if (['ready_for_acceptance', 'accepted'].includes(mode) && review.reviews.length !== review.repairRounds + 1) throw new Error('Invalid review sequence');
  if ((mode === 'repairing' || mode === 'validating') && (!blockers || review.repairRounds !== review.reviews.length || review.repairRounds > 2)) throw new Error('Invalid repair state');
  if (mode === 'needs_attention' && (!blockers || review.repairRounds !== 2 || review.reviews.length !== 3)) throw new Error('Invalid unresolved review');
  if (['ready_for_acceptance', 'accepted'].includes(mode) && (!review.reviews.length || blockers)) throw new Error('Invalid completed review');
}
export function startReview(run: Run, revision: number, input: { planHash: string; diffHash: string; validation: Validation; reviewer: Reviewer; contributingVendors: string[]; budgetAvailable: boolean }): Run {
  requireRevision(run, revision); validateRun(run);
  if (run.state !== 'validating') throw new Error('Invalid state for review');
  if (run.jobs.some(job => ['pending', 'running', 'ready', 'unknown'].includes(job.status))) throw new Error('Active or unresolved job blocks review');
  if (!run.plan || !run.planHash || !run.approval || input.planHash !== run.planHash || run.approval.planHash !== run.planHash || hashPlan(run, run.plan) !== run.planHash) throw new Error('Approved plan mismatch');
  requireText(input.diffHash, 'Diff hash');
  for (const step of run.plan.steps.filter(item => item.taskKind === 'validate' && item.execution)) {
    const job = [...run.jobs].reverse().find(item => item.stepID === step.id), outcome = [...run.outcomes].reverse().find(item => item.stepID === step.id);
    // A foreground command step completes by outcome; either way the evidence must be for exactly the content being reviewed.
    const current = job ? job.status === 'succeeded' && job.contentVersion === input.diffHash : step.execution!.kind === 'command' && outcome !== undefined && outcome.contentVersion === input.diffHash;
    if (!current) throw new Error('Validation job is missing, failed or stale');
  }
  checkValidation(input.validation, input.diffHash, run.plan.validationCommands); checkReviewer(input.reviewer, input.contributingVendors);
  checkStepOutcomes(run);
  if (input.budgetAvailable !== true) throw new Error('Review budget unavailable');
  const previous = run.review;
  if (previous && (JSON.stringify([previous.reviewer.providerID, previous.reviewer.id, previous.reviewer.variant, previous.reviewer.vendor, previous.reviewer.modelVersion]) !== JSON.stringify([input.reviewer.providerID, input.reviewer.id, input.reviewer.variant, input.reviewer.vendor, input.reviewer.modelVersion]) || JSON.stringify(previous.contributingVendors) !== JSON.stringify(input.contributingVendors))) throw new Error('Reviewer or contributor policy changed');
  const review = previous ?? { reviewer: structuredClone(input.reviewer), contributingVendors: [...input.contributingVendors], repairRounds: 0, reviews: [], pending: null };
  return { ...run, revision: run.revision + 1, state: 'reviewing', review: { ...review, pending: { diffHash: input.diffHash, validation: structuredClone(input.validation) } } };
}
export function recordReview(run: Run, revision: number, result: { planHash: string; diffHash: string; verdict: 'approve' | 'request_changes'; findings: Finding[] }, now: number = Date.now()): Run {
  requireRevision(run, revision); validateRun(run);
  if (run.state !== 'reviewing' || !run.review?.pending || !run.plan || !run.planHash || result.planHash !== run.planHash || hashPlan(run, run.plan) !== run.planHash) throw new Error('Review state or plan mismatch');
  if (result.diffHash !== run.review.pending.diffHash) throw new Error('Review diff mismatch');
  checkFindings(result.findings); checkVerdict(result.verdict, result.findings);
  const reviews = [...run.review.reviews, { ...run.review.pending, verdict: result.verdict, findings: structuredClone(result.findings) }];
  const blocking = result.findings.some(f => f.severity === 'blocking');
  const repairRounds = run.review.repairRounds + (blocking && run.review.repairRounds < 2 ? 1 : 0);
  const state = !blocking ? 'ready_for_acceptance' : run.review.repairRounds < 2 ? 'repairing' : 'needs_attention';
  // The review limit is final: unresolved blockers are reported, never resumed into a fourth review.
  const done = state === 'repairing' ? {} : { endedAt: endedAt(run, now) };
  const attention = state === 'needs_attention' ? { reason: 'review_limit_reached', resumeState: null } : null;
  return { ...run, ...done, attention, revision: run.revision + 1, state, review: { ...run.review, pending: null, repairRounds, reviews } };
}
export function acceptRun(run: Run, revision: number): Run {
  requireRevision(run, revision); validateRun(run);
  if (run.state !== 'ready_for_acceptance') throw new Error('Run is not ready for acceptance');
  return { ...run, revision: run.revision + 1, state: 'accepted' };
}

/** Records supplied step evidence; it is not verified host evidence or authorization to dispatch. */
export function recordStepOutcome(run: Run, revision: number, outcome: StepOutcome): Run {
  requireRevision(run, revision); validateRun(run);
  if (!['implementing', 'repairing'].includes(run.state) || !run.plan || !outcome || typeof outcome !== 'object') throw new Error('Invalid outcome state');
  requireText(outcome.inputContentVersion, 'Outcome input content version'); requireText(outcome.contentVersion, 'Outcome content version'); requireText(outcome.evidence, 'Outcome evidence');
  const step = run.plan.steps.find(item => item.id === outcome.stepID);
  if (!step || (step.execution && step.execution.kind !== 'command') || run.jobs.some(job => job.stepID === step.id) || !canStartStep(step, run.jobs, outcome.inputContentVersion, run.outcomes)) throw new Error('Step is not runnable');
  const outcomes = [...run.outcomes, { stepID: outcome.stepID, inputContentVersion: outcome.inputContentVersion, contentVersion: outcome.contentVersion, evidence: outcome.evidence }];
  const next = { ...run, revision: run.revision + 1, outcomes }; validateRun(next); return next;
}

/** Job transitions record host observations; starting a process requires a separately authorized host executor. */
const jobPhase = (run: Run) => jobStates.includes(run.attention?.resumeState ?? run.state);
export function recordJobIntent(run: Run, revision: number, stepID: string, input: Parameters<typeof createShellJob>[1]): Run {
  requireRevision(run, revision); validateRun(run);
  if (run.state === 'needs_attention' || !jobPhase(run) || !run.plan) throw new Error('Invalid state for job');
  const step = run.plan.steps.find(item => item.id === stepID);
  if (!step?.execution || run.jobs.some(job => job.id === input.id) || run.outcomes.some(item => item.stepID === stepID) || !canStartStep(step, run.jobs, input.contentVersion, run.outcomes)) throw new Error('Job is not runnable');
  const jobs = [...run.jobs, createShellJob(step, input)]; validateShellJobs(jobs, run.plan.steps);
  return { ...run, revision: run.revision + 1, jobs };
}
function changeJob(run: Run, revision: number, id: string, update: (job: ShellJob) => ShellJob, allowStopped = false): Run {
  requireRevision(run, revision, allowStopped); validateRun(run);
  if (!jobPhase(run) || !run.plan) throw new Error('Invalid state for job');
  const index = run.jobs.findIndex(job => job.id === id); if (index < 0) throw new Error('Job not found');
  const changed = update(run.jobs[index]); if (changed === run.jobs[index]) return run;
  const jobs = [...run.jobs]; jobs[index] = changed; validateShellJobs(jobs, run.plan.steps);
  return { ...run, revision: run.revision + 1, jobs };
}
export function recordJobHandle(run: Run, revision: number, id: string, result: unknown): Run { return changeJob(run, revision, id, job => attachShell(job, result)); }
export function recordJobExit(run: Run, revision: number, id: string, event: Parameters<typeof applyShellExit>[1]): Run { return changeJob(run, revision, id, job => applyShellExit(job, event), true); }
export function recordJobReady(run: Run, revision: number, id: string, probe: Parameters<typeof markServiceReady>[1]): Run { return changeJob(run, revision, id, job => markServiceReady(job, probe)); }
export function recordJobDeadline(run: Run, revision: number, id: string, now: number): Run { return changeJob(run, revision, id, job => expireJob(job, now), true); }
