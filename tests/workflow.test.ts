import { step, criterion } from './fixtures/plan-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, setPlan, approvePlan, beginImplementation, recordStepOutcome, startReview, recordReview, acceptRun } from '../src/run.js';

const reviewer = { providerID: 'host', id: 'reviewer', variant: 'high', vendor: 'review-vendor', modelVersion: 'v1' };
const validation = (diffHash: string) => ({ diffHash, commands: [{ command: 'test', exitCode: 0 }] });
const blocking = [{ id: 'f1', severity: 'blocking' as const, description: 'Broken login', evidence: 'Login returns 500' }];
function running() { let run = newRun('r', 'Login', 'base'); run = setPlan(run, run.revision, { steps: [step('Implement')], acceptance: [criterion('Login works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] }); run = approvePlan(run, run.revision, run.planHash!); run = beginImplementation(run, run.revision); return recordStepOutcome(run, run.revision, { stepID: 'implement', inputContentVersion: 'base', contentVersion: 'diff-1', evidence: 'implementation' }); }
function start(run: ReturnType<typeof running>, diffHash = 'diff-1', selected = reviewer) { return startReview(run, run.revision, { planHash: run.planHash!, diffHash, validation: validation(diffHash), reviewer: selected, contributingVendors: ['planner-vendor', 'coder-vendor'], budgetAvailable: true }); }

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
  run = recordStepOutcome(run, run.revision, { stepID: 'work', inputContentVersion: 'base', contentVersion: 'd', evidence: 'work' });
  const base = { planHash: run.planHash!, diffHash: 'd', reviewer, contributingVendors: ['coder'], budgetAvailable: true };
  assert.throws(() => startReview(run, run.revision, { ...base, validation: { diffHash: 'd', commands: [{ command: 'test', exitCode: 0 }, { command: 'test', exitCode: 0 }] } }), /validation/i);
  assert.equal(startReview(run, run.revision, { ...base, validation: { diffHash: 'd', commands: [{ command: 'lint', exitCode: 0 }, { command: 'test', exitCode: 0 }] } }).state, 'reviewing');
});

test('review cannot start until each planned coder step has an outcome', () => {
  let run = newRun('missing-work', 'Feature', 'base');
  run = setPlan(run, run.revision, { steps: [step('First', 'first'), step('Second', 'second')], acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] });
  run = approvePlan(run, run.revision, run.planHash!); run = beginImplementation(run, run.revision);
  const input = { planHash: run.planHash!, diffHash: 'd', validation: validation('d'), reviewer, contributingVendors: ['coder-vendor'], budgetAvailable: true };
  assert.throws(() => startReview(run, run.revision, input), /outcome/i);
  run = recordStepOutcome(run, run.revision, { stepID: 'first', inputContentVersion: 'base', contentVersion: 'v1', evidence: 'completed first' });
  assert.throws(() => startReview(run, run.revision, input), /outcome/i);
  run = recordStepOutcome(run, run.revision, { stepID: 'second', inputContentVersion: 'v1', contentVersion: 'd', evidence: 'completed second' });
  assert.equal(startReview(run, run.revision, input).state, 'reviewing');
});
