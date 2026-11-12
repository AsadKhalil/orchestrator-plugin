import { step, criterion } from './fixtures/plan-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, askQuestions, answerQuestions, setPlan, approvePlan, beginImplementation, validateRun } from '../src/run.js';
import { RunRepository } from '../src/run-store.js';
const plan = { steps: [step('Build')], acceptance: [criterion('Works')], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'], questions: [{ question: 'Who can log in?', answer: 'Staff' }, { question: 'Which provider?', answer: 'Email' }] };

test('material questions block planning until answered and bind answers to the plan', () => {
  let run = newRun('r', 'Login', 'base');
  run = askQuestions(run, run.revision, [{ id: 'q1', question: 'Who can log in?' }, { id: 'q2', question: 'Which provider?' }]);
  assert.equal(run.state, 'clarifying');
  assert.throws(() => setPlan(run, run.revision, plan), /question|clarif/i);
  run = answerQuestions(run, run.revision, [{ id: 'q1', answer: 'Staff' }]);
  assert.equal(run.state, 'clarifying');
  assert.throws(() => answerQuestions(run, run.revision, [{ id: 'unknown', answer: 'x' }]), /question/i);
  run = answerQuestions(run, run.revision, [{ id: 'q2', answer: 'Email' }]);
  assert.equal(run.state, 'planning');
  assert.throws(() => setPlan(run, run.revision, { ...plan, questions: [] }), /question/i);
  run = setPlan(run, run.revision, plan);
  run = approvePlan(run, run.revision, run.planHash!);
  const changed = answerQuestions(run, run.revision, [{ id: 'q2', answer: 'Passkeys' }]);
  assert.equal(changed.state, 'planning'); assert.equal(changed.approval, null);
  assert.throws(() => beginImplementation(changed, changed.revision), /approval/i);
});

test('rejects duplicate, empty, stale or tampered clarification records', () => {
  let run = newRun('r', 'Feature', 'base');
  assert.throws(() => askQuestions(run, run.revision, [{ id: 'q', question: 'A' }, { id: 'q', question: 'B' }]), /duplicate/i);
  run = askQuestions(run, run.revision, [{ id: 'q', question: 'A' }]);
  assert.throws(() => answerQuestions(run, 0, [{ id: 'q', answer: 'x' }]), /revision/i);
  assert.throws(() => answerQuestions(run, run.revision, [{ id: 'q', answer: ' ' }]), /answer/i);
  assert.throws(() => validateRun({ ...run, state: 'planning' }), /question|clarif/i);
});

test('persists pending questions and answers across repository instances', async () => {
  const data = new Map<string, unknown>();
  const store = { async get(k: string) { return structuredClone(data.get(k)); }, async set(k: string, v: unknown) { data.set(k, structuredClone(v)); } };
  const one = new RunRepository(store); let run = await one.create('r', 'Feature', 'base');
  run = await one.askQuestions('r', run.revision, [{ id: 'q', question: 'Which?' }]);
  const two = new RunRepository(store); assert.equal((await two.get('r')).state, 'clarifying');
  run = await two.answerQuestions('r', run.revision, [{ id: 'q', answer: 'One' }]);
  assert.deepEqual((await one.get('r')).clarification, [{ id: 'q', question: 'Which?', answer: 'One' }]);
});
