import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, setPlan, approvePlan, beginImplementation } from '../src/run.js';
import { step, criterion } from './fixtures/plan-data.js';
const make = () => ({ steps: [step('First', 'a'), { ...step('Second', 'b'), dependsOn: ['a'] }], acceptance: [criterion('Works', 'c')], questions: [], validationCommands: ['test'], areas: ['src'], rollback: 'Revert changes' });

test('accepts a structured dependency graph and binds resource details to approval', () => {
  const r = newRun('r', 'Feature', 'base'); const p = setPlan(r, r.revision, make());
  const approved = approvePlan(p, p.revision, p.planHash!);
  const modified = structuredClone(approved); modified.plan!.steps[0].resources = { read: ['src'], write: ['other'] };
  assert.throws(() => beginImplementation(modified, modified.revision), /hash/i);
});

test('rejects cycles, unknown dependencies, duplicated identities and invalid service probes', () => {
  const r = newRun('r', 'Feature', 'base');
  const cycle = make(); cycle.steps[0].dependsOn = ['b'];
  assert.throws(() => setPlan(r, 0, cycle), /cycle/i);
  const unknown = make(); unknown.steps[0].dependsOn = ['missing'];
  assert.throws(() => setPlan(r, 0, unknown), /depend/i);
  const duplicate = make(); duplicate.steps[1].id = 'a';
  assert.throws(() => setPlan(r, 0, duplicate), /duplicate/i);
  const invalid = make(); (invalid.steps[0] as any).execution = { kind: 'service', command: 'serve', deadlineMs: 1000, readyProbe: null };
  assert.throws(() => setPlan(r, 0, invalid), /probe/i);
});

test('rejects unknown fields and model inference for process-status steps', () => {
  const r = newRun('r', 'Feature', 'base');
  const extra = make(); (extra.steps[0] as any).unreviewed = 'hidden';
  assert.throws(() => setPlan(r, 0, extra), /invalid/i);
  const status = make(); (status.steps[0] as any).taskKind = 'process_status';
  assert.throws(() => setPlan(r, 0, status), /inference/i);
});

test('read-only roles cannot declare source writes and service steps need bounded probes', () => {
  const r = newRun('r', 'Feature', 'base');
  const write = make(); (write.steps[0] as any).role = 'reviewer'; (write.steps[0] as any).resources = { read: ['src'], write: ['src'] };
  assert.throws(() => setPlan(r, 0, write), /read.only|write/i);
  const valid = make(); (valid.steps[1] as any).execution = { kind: 'service', command: 'start', deadlineMs: 5000, readyProbe: { command: 'health', deadlineMs: 1000 } };
  assert.equal(setPlan(r, 0, valid).state, 'awaiting_approval');
  (valid.steps[1] as any).execution.readyProbe.deadlineMs = 0;
  assert.throws(() => setPlan(r, 0, valid), /deadline/i);
});

test('approval hash is stable across object property ordering', () => {
  const r = newRun('r', 'Feature', 'base');
  const one = make(), two = make();
  two.steps[0] = Object.fromEntries(Object.entries(two.steps[0]).reverse()) as typeof two.steps[0];
  assert.equal(setPlan(r, 0, one).planHash, setPlan(r, 0, two).planHash);
});
