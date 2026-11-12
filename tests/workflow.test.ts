import { step, criterion } from './fixtures/plan-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, setPlan, approvePlan, beginImplementation, beginValidation, recordStepOutcome, startReview, recordReview, acceptRun } from '../src/run.js';

const reviewer = { providerID: 'host', id: 'reviewer', variant: 'high', vendor: 'review-vendor', modelVersion: 'v1' };
const validation = (diffHash: string) => ({ diffHash, commands: [{ command: 'test', exitCode: 0 }] });
const blocking = [{ id: 'f1', severity: 'blocking' as const, description: 'Broken login', evidence: 'Login returns 500' }];
function running() { let run = newRun('r', 'Login', 'base'); run = setPlan(run, run.revision, { steps: [step('Implement')], acceptance: [criterion('Login works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] }); run = approvePlan(run, run.revision, run.planHash!); run = beginImplementation(run, run.revision); run = recordStepOutcome(run, run.revision, { stepID: 'implement', inputContentVersion: 'base', contentVersion: 'diff-1', evidence: 'implementation' }); return beginValidation(run, run.revision); }
function start(run: ReturnType<typeof running>, diffHash = 'diff-1', selected = reviewer) { if (run.state === 'repairing') run = beginValidation(run, run.revision); return startReview(run, run.revision, { planHash: run.planHash!, diffHash, validation: validation(diffHash), reviewer: selected, contributingVendors: ['planner-vendor', 'coder-vendor'], budgetAvailable: true }); }

test('two unsuccessful repairs terminate in needs_attention after three reviews', () => {
  let run = start(running());
  run = recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'diff-1', verdict: 'request_changes', findings: blocking });
  assert.equal(run.state, 'repairing');
  assert.equal(run.review!.repairRounds, 1);
  run = start(run, 'diff-2');
  run = recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'diff-2', verdict: 'request_changes', findings: blocking });
  assert.equal(run.review!.repairRounds, 2);
  run = start(run, 'diff-3');
  run = recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'diff-3', verdict: 'request_changes', findings: blocking });
  assert.equal(run.state, 'needs_attention');
  assert.equal(run.review!.reviews.length, 3);
  assert.throws(() => start(run, 'diff-4'), /state/i);
});

test('only passing validation and a review without blockers allow user acceptance', () => {
  let run = running();
  assert.throws(() => startReview(run, run.revision, { planHash: run.planHash!, diffHash: 'd', validation: { diffHash: 'd', commands: [] }, reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: true }), /validation/i);
  assert.throws(() => startReview(run, run.revision, { planHash: run.planHash!, diffHash: 'd', validation: { diffHash: 'd', commands: [{ command: 'test', exitCode: 1 }] }, reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: true }), /validation/i);
  run = start(run);
  run = recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'diff-1', verdict: 'approve', findings: [{ id: 'a', severity: 'advisory', description: 'Style', evidence: 'Optional' }] });
  assert.equal(run.state, 'ready_for_acceptance');
  assert.equal(acceptRun(run, run.revision).state, 'accepted');
});

test('pins reviewer, verifies plan and diff identities, and requires budget', () => {
  let run = running();
  assert.throws(() => startReview(run, run.revision, { planHash: 'wrong', diffHash: 'd', validation: validation('d'), reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: true }), /plan/i);
  assert.throws(() => startReview(run, run.revision, { planHash: run.planHash!, diffHash: 'd', validation: validation('other'), reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: true }), /validation/i);
  assert.throws(() => startReview(run, run.revision, { planHash: run.planHash!, diffHash: 'd', validation: validation('d'), reviewer, contributingVendors: ['review-vendor'], budgetAvailable: true }), /vendor/i);
  assert.throws(() => startReview(run, run.revision, { planHash: run.planHash!, diffHash: 'd', validation: validation('d'), reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: false }), /budget/i);
  run = start(run);
  assert.throws(() => recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'different', verdict: 'approve', findings: [] }), /diff/i);
  run = recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'diff-1', verdict: 'request_changes', findings: blocking });
  assert.throws(() => start(run, 'diff-2', { ...reviewer, id: 'replacement' }), /reviewer/i);
  assert.throws(() => recordReview(run, run.revision - 1, { planHash: run.planHash!, diffHash: 'diff-1', verdict: 'approve', findings: [] }), /revision/i);
});

test('review verdict must match its blocking findings', () => {
  const run = start(running());
  assert.throws(() => recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'diff-1', verdict: 'approve', findings: blocking }), /verdict/i);
  assert.throws(() => recordReview(run, run.revision, { planHash: run.planHash!, diffHash: 'diff-1', verdict: 'request_changes', findings: [] }), /verdict/i);
});

test('review requires exactly the approved validation commands and invalidates altered commands', () => {
  const run = running();
  const base = { planHash: run.planHash!, diffHash: 'd', reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: true };
  assert.throws(() => startReview(run, run.revision, { ...base, validation: { diffHash: 'd', commands: [{ command: 'echo success', exitCode: 0 }] } }), /validation/i);
  assert.throws(() => startReview(run, run.revision, { ...base, validation: { diffHash: 'd', commands: [{ command: 'test', exitCode: 0 }, { command: 'echo extra', exitCode: 0 }] } }), /validation/i);
  const tampered = structuredClone(run); tampered.plan!.validationCommands = ['echo success'];
  assert.throws(() => startReview(tampered, tampered.revision, { ...base, validation: { diffHash: 'd', commands: [{ command: 'echo success', exitCode: 0 }] } }), /plan/i);
});

test('requires every approved command exactly once, regardless of result order', () => {
  let run = newRun('r2', 'Feature', 'base');
  run = setPlan(run, run.revision, { steps: [step('Work')], acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test', 'lint'] });
  run = approvePlan(run, run.revision, run.planHash!); run = beginImplementation(run, run.revision);
  run = recordStepOutcome(run, run.revision, { stepID: 'work', inputContentVersion: 'base', contentVersion: 'd', evidence: 'work' }); run = beginValidation(run, run.revision);
  const base = { planHash: run.planHash!, diffHash: 'd', reviewer, contributingVendors: ['coder'], budgetAvailable: true };
  assert.throws(() => startReview(run, run.revision, { ...base, validation: { diffHash: 'd', commands: [{ command: 'test', exitCode: 0 }, { command: 'test', exitCode: 0 }] } }), /validation/i);
  assert.equal(startReview(run, run.revision, { ...base, validation: { diffHash: 'd', commands: [{ command: 'lint', exitCode: 0 }, { command: 'test', exitCode: 0 }] } }).state, 'reviewing');
});

test('review cannot start until each planned coder step has an outcome', () => {
  let run = newRun('missing-work', 'Feature', 'base');
  run = setPlan(run, run.revision, { steps: [step('First', 'first'), step('Second', 'second')], acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] });
  run = approvePlan(run, run.revision, run.planHash!); run = beginImplementation(run, run.revision);
  const input = { planHash: run.planHash!, diffHash: 'd', validation: validation('d'), reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: true };
  assert.throws(() => beginValidation(run, run.revision), /outcome/i);
  run = recordStepOutcome(run, run.revision, { stepID: 'first', inputContentVersion: 'base', contentVersion: 'v1', evidence: 'completed first' });
  assert.throws(() => beginValidation(run, run.revision), /outcome/i);
  assert.throws(() => startReview(run, run.revision, input), /state/i);
  run = recordStepOutcome(run, run.revision, { stepID: 'second', inputContentVersion: 'v1', contentVersion: 'd', evidence: 'completed second' });
  assert.equal(startReview(beginValidation(run, run.revision), run.revision + 1, input).state, 'reviewing');
});

import { requestStop, finishStop, markNeedsAttention, resumeRun, requestAmendment, runStates, validateRun, recordJobIntent, recordJobHandle, recordJobExit } from '../src/run.js';

test('the persisted states are exactly the designed lifecycle', () => {
  assert.deepEqual([...runStates].sort(), ['accepted', 'awaiting_approval', 'cancelled', 'clarifying', 'implementing', 'needs_attention', 'planning', 'ready_for_acceptance', 'repairing', 'reviewing', 'validating'].sort());
  assert.throws(() => validateRun({ ...running(), state: 'approved' }), /invalid/i);
});

test('approval is recorded as human or autonomous and only for the exact hash', () => {
  let run = newRun('a', 'Login', 'base', 1000);
  run = setPlan(run, run.revision, { steps: [step('Implement')], acceptance: [criterion('Login works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] });
  assert.throws(() => approvePlan(run, run.revision, run.planHash!, 'robot' as never), /approver/i);
  assert.throws(() => approvePlan(run, run.revision, 'other-hash', 'autonomous'), /hash/i);
  const autonomous = approvePlan(run, run.revision, run.planHash!, 'autonomous');
  assert.equal(autonomous.state, 'implementing'); assert.equal(autonomous.approval?.type, 'autonomous');
});

test('a plan can be revised before work starts but never once execution history exists', () => {
  const started = running(); // has a recorded outcome and is validating
  assert.throws(() => setPlan(started, started.revision, { steps: [step('Other')], acceptance: [criterion('x')], questions: [], areas: ['src'], rollback: 'Revert', validationCommands: ['test'] }), /blocks planning/i);
});

test('scope expansion returns to planning, keeps the audit trail and needs a new approval', () => {
  const before = running();
  const back = requestAmendment(before, before.revision, 'needs a database migration');
  assert.equal(back.state, 'planning'); assert.equal(back.plan, null); assert.equal(back.approval, null); assert.equal(back.review, null);
  assert.deepEqual(back.amendments, [{ planHash: before.planHash, reason: 'needs a database migration' }]);
  assert.throws(() => requestAmendment(newRun('n', 'x', 'base'), 0, 'why'), /state/i);
  assert.throws(() => requestAmendment(before, before.revision, ' '), /reason/i);
});

test('stop finishes as cancelled once no owned job is unresolved, and keeps the artifacts', () => {
  let run = running();
  assert.throws(() => finishStop(run, run.revision), /not requested/i);
  run = requestStop(run, run.revision);
  const done = finishStop(run, run.revision, run.createdAt + 5);
  assert.equal(done.state, 'cancelled'); assert.equal(done.endedAt, run.createdAt + 5);
  assert.equal(done.planHash, run.planHash); assert.equal(done.outcomes.length, 1);
  assert.equal(validateRun(done).state, 'cancelled');
  assert.equal(finishStop(done, done.revision), done);
});

test('stop with a job whose process is unconfirmed pauses instead of claiming cancellation', () => {
  const testStep = { ...step('Run tests', 'tests'), taskKind: 'validate' as const, inference: false, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
  let run = newRun('s', 'Feature', 'base', 1);
  run = setPlan(run, run.revision, { steps: [testStep], acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'Revert', validationCommands: ['test'] });
  run = approvePlan(run, run.revision, run.planHash!);
  run = recordJobIntent(run, run.revision, 'tests', { id: 'job', sessionID: 'ses_1', contentVersion: 'v1', now: 10 });
  run = recordJobHandle(run, run.revision, 'job', { output: { status: 'running', shellID: 'sh_1' }, metadata: { status: 'running', shellID: 'sh_1' } });
  run = requestStop(run, run.revision);
  const paused = finishStop(run, run.revision, 50);
  assert.equal(paused.state, 'needs_attention'); assert.equal(paused.attention?.reason, 'stop_cleanup_unconfirmed');
  assert.throws(() => resumeRun(paused, paused.revision), /stop|resum/i);
  const exited = recordJobExit(paused, paused.revision, 'job', { eventID: 'e', shellID: 'sh_1', status: 'killed', completedAt: 60, currentContentVersion: 'v1' });
  assert.equal(finishStop(exited, exited.revision, 70).state, 'cancelled');
});

test('a paused run keeps its checkpoint and resumes to it; the review limit is final', () => {
  const run = running();
  const paused = markNeedsAttention(run, run.revision, 'budget_exhausted', run.createdAt + 1);
  assert.equal(paused.state, 'needs_attention'); assert.equal(paused.attention?.resumeState, 'validating'); assert.ok(paused.endedAt !== null);
  const resumed = resumeRun(paused, paused.revision);
  assert.equal(resumed.state, 'validating'); assert.equal(resumed.attention, null); assert.equal(resumed.endedAt, null);
  let limit = start(running());
  for (const diff of ['diff-1', 'diff-2', 'diff-3']) { limit = recordReview(limit, limit.revision, { planHash: limit.planHash!, diffHash: diff, verdict: 'request_changes', findings: blocking }); if (diff !== 'diff-3') limit = start(limit, `diff-${Number(diff.slice(-1)) + 1}`); }
  assert.equal(limit.state, 'needs_attention'); assert.equal(limit.attention?.reason, 'review_limit_reached'); assert.equal(limit.attention?.resumeState, null);
  assert.throws(() => resumeRun(limit, limit.revision), /resum/i);
});
