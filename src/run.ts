import { createHash } from 'node:crypto';
import { canonicalPlan, validatePlan, type Plan } from './plan.js';
import { createShellJob, attachShell, applyShellExit, markServiceReady, expireJob, canStartStep, validateShellJobs, type ShellJob, type StepOutcome } from './jobs.js';

type Clarification = { id: string; question: string; answer: string | null };
type Reviewer = { providerID: string; id: string; variant: string | null; vendor: string; modelVersion: string };
type Validation = { diffHash: string; commands: { command: string; exitCode: number }[] };
type Finding = { id: string; severity: 'blocking' | 'advisory'; description: string; evidence: string };
type ReviewTrack = { reviewer: Reviewer; contributingVendors: string[]; repairRounds: number; pending: { diffHash: string; validation: Validation } | null; reviews: { diffHash: string; validation: Validation; verdict: 'approve' | 'request_changes'; findings: Finding[] }[] };
type Run = {
  id: string; requirement: string; baseCommit: string; revision: number; stopRequested: boolean;
  state: 'clarifying' | 'planning' | 'awaiting_approval' | 'approved' | 'implementing' | 'reviewing' | 'repairing' | 'needs_attention' | 'ready_for_acceptance' | 'accepted';
  jobs: ShellJob[]; outcomes: StepOutcome[]; clarification: Clarification[]; plan: Plan | null; planHash: string | null; approval: { planHash: string; type: 'human' } | null; review: ReviewTrack | null;
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
export function newRun(id: string, requirement: string, baseCommit: string): Run {
  requireText(id, 'Run ID'); requireText(requirement, 'Requirement'); requireText(baseCommit, 'Base commit');
  return { id, requirement, baseCommit, revision: 0, stopRequested: false, state: 'planning', jobs: [], outcomes: [], clarification: [], plan: null, planHash: null, approval: null, review: null };
}
/** Persist the stop request first; this alone does not interrupt sessions or processes. */
export function requestStop(run: Run, revision: number): Run {
  requireRevision(run, revision, true); validateRun(run);
  if (run.state === 'accepted') throw new Error('Run is already accepted');
  if (run.stopRequested) return run;
  return { ...run, revision: run.revision + 1, stopRequested: true };
}
export function setPlan(run: Run, revision: number, plan: Plan): Run {
  requireRevision(run, revision); validateRun(run);
  if (!['planning', 'awaiting_approval', 'approved'].includes(run.state)) throw new Error('Clarification or run state blocks planning');
  validatePlan(plan);
  const copy = structuredClone(plan);
  return { ...run, revision: run.revision + 1, state: 'awaiting_approval', plan: copy, planHash: hashPlan(run, copy), approval: null, review: null };
}
export function approvePlan(run: Run, revision: number, planHash: string): Run {
  requireRevision(run, revision);
  if (run.state !== 'awaiting_approval' || !run.plan || !run.planHash || run.planHash !== planHash || hashPlan(run, run.plan) !== planHash) throw new Error('Plan hash or state does not match approval');
  return { ...run, revision: run.revision + 1, state: 'approved', approval: { planHash, type: 'human' } };
}
export function beginImplementation(run: Run, revision: number): Run {
  requireRevision(run, revision);
  if (run.state !== 'approved' || !run.plan || !run.planHash || !run.approval || run.approval.planHash !== run.planHash) throw new Error('Valid plan approval required');
  if (hashPlan(run, run.plan) !== run.planHash) throw new Error('Approved plan hash has changed');
  return { ...run, revision: run.revision + 1, state: 'implementing' };
}
export function updateRequirement(run: Run, revision: number, requirement: string): Run {
  requireRevision(run, revision); requireText(requirement, 'Requirement');
  if (run.jobs.length || run.outcomes.length) throw new Error('Execution history must be preserved before changing the requirement');
  return { ...run, requirement, revision: run.revision + 1, state: 'planning', clarification: [], plan: null, planHash: null, approval: null, review: null };
}


function validateClarification(run: Run) {
  if (!Array.isArray(run.clarification) || run.clarification.length > 100) throw new Error('Invalid clarification');
  const ids = new Set<string>();
  for (const q of run.clarification) {
    if (!q || typeof q !== 'object') throw new Error('Invalid clarification question');
    requireText(q.id, 'Question ID'); requireText(q.question, 'Question');
    if (ids.has(q.id)) throw new Error('Duplicate question'); ids.add(q.id);
    if (q.answer !== null) requireText(q.answer, 'Question answer');
  }
  const pending = run.clarification.some(q => q.answer === null);
  if ((run.state === 'clarifying') !== pending) throw new Error('Clarification questions do not match state');
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
  if (!['clarifying', 'planning', 'awaiting_approval', 'approved'].includes(run.state) || !Array.isArray(answers) || !answers.length) throw new Error('Invalid clarification answer state');
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
  if (typeof run.stopRequested !== 'boolean' || !Number.isSafeInteger(run.revision) || run.revision < 0 || !['clarifying', 'planning', 'awaiting_approval', 'approved', 'implementing', 'reviewing', 'repairing', 'needs_attention', 'ready_for_acceptance', 'accepted'].includes(run.state)) throw new Error('Invalid run record');
  validateClarification(run);
  if (run.state === 'planning' || run.state === 'clarifying') {
    if (run.plan !== null || run.planHash !== null || run.approval !== null) throw new Error('Invalid planning record');
  } else {
    if (!run.plan || typeof run.planHash !== 'string' || hashPlan(run, run.plan) !== run.planHash) throw new Error('Invalid plan hash');
    if (run.state === 'awaiting_approval') {
      if (run.approval !== null) throw new Error('Invalid approval record');
    } else if (!run.approval || run.approval.type !== 'human' || run.approval.planHash !== run.planHash) throw new Error('Invalid approval record');
  }
  validateShellJobs(run.jobs, run.plan?.steps ?? []);
  if (!Array.isArray(run.outcomes) || run.outcomes.length > 1000) throw new Error('Invalid step outcomes');
  for (const outcome of run.outcomes) {
    if (!outcome || !run.plan?.steps.some(step => step.id === outcome.stepID && !step.execution)) throw new Error('Invalid step outcome');
    requireText(outcome.inputContentVersion, 'Outcome input content version'); requireText(outcome.contentVersion, 'Outcome content version'); requireText(outcome.evidence, 'Outcome evidence');
    const step = run.plan!.steps.find(item => item.id === outcome.stepID)!;
    if (step.resources && !step.resources.write.length && outcome.inputContentVersion !== outcome.contentVersion) throw new Error('Read-only step changed content');
  }
  validateReviewState(run);
  return structuredClone(run);
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
  for (const step of run.plan!.steps.filter(item => item.role === 'coder' && !item.execution && item.taskKind !== 'review')) {
    if (!run.outcomes.some(outcome => outcome.stepID === step.id)) throw new Error('Implementation step outcome is missing');
  }
}
function validateReviewState(run: Run) {
  const review = run.review;
  if (['clarifying', 'planning', 'awaiting_approval', 'approved', 'implementing'].includes(run.state)) {
    if (review !== null) throw new Error('Unexpected review state'); return;
  }
  checkStepOutcomes(run);
  if (!review || !Array.isArray(review.reviews) || !Number.isSafeInteger(review.repairRounds) || review.repairRounds < 0 || review.repairRounds > 2 || review.reviews.length > 3) throw new Error('Invalid review state');
  checkReviewer(review.reviewer, review.contributingVendors);
  for (const item of review.reviews) { requireText(item.diffHash, 'Diff hash'); checkValidation(item.validation, item.diffHash, run.plan!.validationCommands); checkFindings(item.findings); checkVerdict(item.verdict, item.findings); }
  if (review.pending) { requireText(review.pending.diffHash, 'Diff hash'); checkValidation(review.pending.validation, review.pending.diffHash, run.plan!.validationCommands); }
  if ((run.state === 'reviewing') !== !!review.pending) throw new Error('Invalid pending review');
  const blockers = review.reviews.at(-1)?.findings.some(f => f.severity === 'blocking');
  if (review.reviews.slice(0, -1).some(item => !item.findings.some(f => f.severity === 'blocking'))) throw new Error('Invalid review history');
  if (run.state === 'reviewing' && (review.reviews.length !== review.repairRounds || (review.reviews.length > 0 && !blockers))) throw new Error('Invalid review sequence');
  if (['ready_for_acceptance', 'accepted'].includes(run.state) && review.reviews.length !== review.repairRounds + 1) throw new Error('Invalid review sequence');
  if (run.state === 'repairing' && (!blockers || review.repairRounds !== review.reviews.length || review.repairRounds > 2)) throw new Error('Invalid repair state');
  if (run.state === 'needs_attention' && (!blockers || review.repairRounds !== 2 || review.reviews.length !== 3)) throw new Error('Invalid unresolved review');
  if (['ready_for_acceptance', 'accepted'].includes(run.state) && (!review.reviews.length || blockers)) throw new Error('Invalid completed review');
}
export function startReview(run: Run, revision: number, input: { planHash: string; diffHash: string; validation: Validation; reviewer: Reviewer; contributingVendors: string[]; budgetAvailable: boolean }): Run {
  requireRevision(run, revision); validateRun(run);
  if (!['implementing', 'repairing'].includes(run.state)) throw new Error('Invalid state for review');
  if (run.jobs.some(job => ['pending', 'running', 'ready', 'unknown'].includes(job.status))) throw new Error('Active or unresolved job blocks review');
  if (!run.plan || !run.planHash || !run.approval || input.planHash !== run.planHash || run.approval.planHash !== run.planHash || hashPlan(run, run.plan) !== run.planHash) throw new Error('Approved plan mismatch');
  requireText(input.diffHash, 'Diff hash');
  for (const step of run.plan.steps.filter(item => item.taskKind === 'validate' && item.execution)) {
    const job = [...run.jobs].reverse().find(item => item.stepID === step.id);
    if (!job || job.status !== 'succeeded' || job.contentVersion !== input.diffHash) throw new Error('Validation job is missing, failed or stale');
  }
  checkValidation(input.validation, input.diffHash, run.plan.validationCommands); checkReviewer(input.reviewer, input.contributingVendors);
  checkStepOutcomes(run);
  if (input.budgetAvailable !== true) throw new Error('Review budget unavailable');
  const previous = run.review;
  if (run.state === 'repairing' && (!previous || JSON.stringify([previous.reviewer.providerID, previous.reviewer.id, previous.reviewer.variant, previous.reviewer.vendor, previous.reviewer.modelVersion]) !== JSON.stringify([input.reviewer.providerID, input.reviewer.id, input.reviewer.variant, input.reviewer.vendor, input.reviewer.modelVersion]) || JSON.stringify(previous.contributingVendors) !== JSON.stringify(input.contributingVendors))) throw new Error('Reviewer or contributor policy changed');
  const review = previous ?? { reviewer: structuredClone(input.reviewer), contributingVendors: [...input.contributingVendors], repairRounds: 0, reviews: [], pending: null };
  return { ...run, revision: run.revision + 1, state: 'reviewing', review: { ...review, pending: { diffHash: input.diffHash, validation: structuredClone(input.validation) } } };
}
export function recordReview(run: Run, revision: number, result: { planHash: string; diffHash: string; verdict: 'approve' | 'request_changes'; findings: Finding[] }): Run {
  requireRevision(run, revision); validateRun(run);
  if (run.state !== 'reviewing' || !run.review?.pending || !run.plan || !run.planHash || result.planHash !== run.planHash || hashPlan(run, run.plan) !== run.planHash) throw new Error('Review state or plan mismatch');
  if (result.diffHash !== run.review.pending.diffHash) throw new Error('Review diff mismatch');
  checkFindings(result.findings); checkVerdict(result.verdict, result.findings);
  const reviews = [...run.review.reviews, { ...run.review.pending, verdict: result.verdict, findings: structuredClone(result.findings) }];
  const blocking = result.findings.some(f => f.severity === 'blocking');
  const repairRounds = run.review.repairRounds + (blocking && run.review.repairRounds < 2 ? 1 : 0);
  const state = !blocking ? 'ready_for_acceptance' : run.review.repairRounds < 2 ? 'repairing' : 'needs_attention';
  return { ...run, revision: run.revision + 1, state, review: { ...run.review, pending: null, repairRounds, reviews } };
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
  if (!step || step.execution || !canStartStep(step, run.jobs, outcome.inputContentVersion, run.outcomes)) throw new Error('Step is not runnable');
  const outcomes = [...run.outcomes, { stepID: outcome.stepID, inputContentVersion: outcome.inputContentVersion, contentVersion: outcome.contentVersion, evidence: outcome.evidence }];
  const next = { ...run, revision: run.revision + 1, outcomes }; validateRun(next); return next;
}

/** Job transitions record host observations; starting a process requires a separately authorized host executor. */
export function recordJobIntent(run: Run, revision: number, stepID: string, input: Parameters<typeof createShellJob>[1]): Run {
  requireRevision(run, revision); validateRun(run);
  if (!['implementing', 'repairing'].includes(run.state) || !run.plan) throw new Error('Invalid state for job');
  const step = run.plan.steps.find(item => item.id === stepID);
  if (!step?.execution || run.jobs.some(job => job.id === input.id) || !canStartStep(step, run.jobs, input.contentVersion, run.outcomes)) throw new Error('Job is not runnable');
  const jobs = [...run.jobs, createShellJob(step, input)]; validateShellJobs(jobs, run.plan.steps);
  return { ...run, revision: run.revision + 1, jobs };
}
function changeJob(run: Run, revision: number, id: string, update: (job: ShellJob) => ShellJob, allowStopped = false): Run {
  requireRevision(run, revision, allowStopped); validateRun(run);
  if (!['implementing', 'repairing'].includes(run.state) || !run.plan) throw new Error('Invalid state for job');
  const index = run.jobs.findIndex(job => job.id === id); if (index < 0) throw new Error('Job not found');
  const changed = update(run.jobs[index]); if (changed === run.jobs[index]) return run;
  const jobs = [...run.jobs]; jobs[index] = changed; validateShellJobs(jobs, run.plan.steps);
  return { ...run, revision: run.revision + 1, jobs };
}
export function recordJobHandle(run: Run, revision: number, id: string, result: unknown): Run { return changeJob(run, revision, id, job => attachShell(job, result)); }
export function recordJobExit(run: Run, revision: number, id: string, event: Parameters<typeof applyShellExit>[1]): Run { return changeJob(run, revision, id, job => applyShellExit(job, event), true); }
export function recordJobReady(run: Run, revision: number, id: string, probe: Parameters<typeof markServiceReady>[1]): Run { return changeJob(run, revision, id, job => markServiceReady(job, probe)); }
export function recordJobDeadline(run: Run, revision: number, id: string, now: number): Run { return changeJob(run, revision, id, job => expireJob(job, now), true); }
