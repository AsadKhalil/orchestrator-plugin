import { step, criterion } from './fixtures/plan-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, setPlan, approvePlan, beginImplementation, updateRequirement } from '../src/run.js';

const draft = () => newRun('run-1', 'Add login', 'abc123');
const plan = { steps: [step('Add form'), step('Test login')], acceptance: [criterion('User can sign in')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] };

test('requires approval of the exact plan revision before implementation', () => {
  const planned = setPlan(draft(), 0, plan);
  assert.equal(planned.state, 'awaiting_approval');
  assert.throws(() => beginImplementation(planned, planned.revision), /approval/i);
  assert.throws(() => approvePlan(planned, planned.revision, 'incorrect'), /hash/i);
  const approved = approvePlan(planned, planned.revision, planned.planHash!);
  assert.equal(beginImplementation(approved, approved.revision).state, 'implementing');
});

test('rejects unanswered material questions and stale revisions', () => {
  assert.throws(() => setPlan(draft(), 0, { ...plan, questions: [{ question: 'Provider?', answer: '' }] }), /question/i);
  const planned = setPlan(draft(), 0, plan);
  assert.throws(() => approvePlan(planned, 0, planned.planHash!), /revision/i);
});

test('changing the plan or requirement invalidates previous approval', () => {
  const initial = setPlan(draft(), 0, plan);
  const approved = approvePlan(initial, initial.revision, initial.planHash!);
  const changed = setPlan(approved, approved.revision, { ...plan, steps: [step('Different work')] });
  assert.equal(changed.approval, null);
  assert.notEqual(changed.planHash, approved.planHash);
  const requirement = updateRequirement(approved, approved.revision, 'Add passkeys');
  assert.equal(requirement.approval, null);
  assert.equal(requirement.planHash, null);
  assert.throws(() => beginImplementation(requirement, requirement.revision), /approval/i);
});

test('detects modifications to an approved artifact', () => {
  const initial = setPlan(draft(), 0, plan);
  const approved = approvePlan(initial, initial.revision, initial.planHash!);
  approved.plan!.steps.push(step('Unapproved step'));
  assert.throws(() => beginImplementation(approved, approved.revision), /hash/i);
});

test('binds approval to the requirement, answers and base commit', () => {
  const planned = setPlan(draft(), 0, plan);
  const approved = approvePlan(planned, planned.revision, planned.planHash!);
  assert.throws(() => beginImplementation({ ...approved, baseCommit: 'different' }, approved.revision), /hash/i);
  assert.throws(() => beginImplementation({ ...approved, requirement: 'Different requirement' }, approved.revision), /hash/i);
  assert.throws(() => beginImplementation({ ...approved, plan: { ...approved.plan!, questions: [{ question: 'Which login?', answer: 'Other' }] } }, approved.revision), /question|hash/i);
});

test('does not allow a caller to mutate the stored plan through its original object', () => {
  const original = { steps: [step('Do work')], acceptance: [criterion('Done')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] };
  const planned = setPlan(draft(), 0, original);
  original.steps.push(step('Unapproved'));
  assert.deepEqual(planned.plan?.steps, [step('Do work')]);
});

test('requires distinct validation commands and binds them into approval', () => {
  assert.throws(() => setPlan(draft(), 0, { ...plan, areas: ['src'], rollback: 'Revert changes', validationCommands: [] }), /validation/i);
  assert.throws(() => setPlan(draft(), 0, { ...plan, areas: ['src'], rollback: 'Revert changes', validationCommands: ['test', 'test'] }), /duplicate/i);
  const planned = setPlan(draft(), 0, plan);
  const approved = approvePlan(planned, planned.revision, planned.planHash!);
  approved.plan!.validationCommands[0] = 'different';
  assert.throws(() => beginImplementation(approved, approved.revision), /hash/i);
});
