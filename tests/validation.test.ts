import { step, criterion } from './fixtures/plan-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, setPlan, approvePlan, beginImplementation, beginValidation, recordStepOutcome } from '../src/run.js';
import { runApprovedValidation, normalizeShellResult } from '../src/validation.js';

function approved() { let r = newRun('r', 'feature', 'base'); r = setPlan(r, r.revision, { steps: [step('work')], acceptance: [criterion('works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test', 'lint'] }); r = approvePlan(r, r.revision, r.planHash!); r = beginImplementation(r, r.revision); r = recordStepOutcome(r, r.revision, { stepID: 'work', inputContentVersion: 'base', contentVersion: 'v1', evidence: 'work' }); return beginValidation(r, r.revision); }
const result = (exit: number, output = 'ok') => ({ output: { output, truncated: false, exit, status: 'completed' }, metadata: { status: 'completed', truncated: false, exit } });

test('accepts only consistent completed native shell results', () => {
  assert.deepEqual(normalizeShellResult(result(0)), { status: 'passed', exitCode: 0, output: 'ok', truncated: false });
  assert.equal(normalizeShellResult(result(7)).status, 'failed');
  assert.equal(normalizeShellResult({ output: { output: '', truncated: false, exit: 0, status: 'running' }, metadata: { status: 'running', truncated: false, exit: 0 } }).status, 'unknown');
  assert.equal(normalizeShellResult({ ...result(0), metadata: { status: 'completed', truncated: false, exit: 1 } }).status, 'unknown');
  assert.equal(normalizeShellResult({ output: { output: '', truncated: false, exit: 0, status: 'completed' } }).status, 'unknown');
});

test('runs only plan commands, ties results to a stable diff and stops on failure', async () => {
  const calls: string[] = [];
  const report = await runApprovedValidation(approved(), { diffHash: 'diff', timeoutMs: 1000, async currentDiff() { return 'diff'; }, async execute(command) { calls.push(command); return result(command === 'test' ? 0 : 1); } });
  assert.deepEqual(calls, ['test', 'lint']);
  assert.equal(report.status, 'failed');
  assert.equal(report.commands[1].exitCode, 1);
  assert.equal(report.diffHash, 'diff');
});

test('rejects unapproved state or plan mutation before launching a command', async () => {
  const r = approved(); r.plan!.validationCommands[0] = 'evil'; let calls = 0;
  await assert.rejects(runApprovedValidation(r, { diffHash: 'd', timeoutMs: 1000, async currentDiff() { return 'd'; }, async execute() { calls++; return result(0); } }), /plan/i);
  assert.equal(calls, 0);
});

test('stops on diff drift or ambiguous and timed-out commands without launching later commands', async () => {
  let checks = 0, calls = 0;
  const drift = await runApprovedValidation(approved(), { diffHash: 'd', timeoutMs: 1000, async currentDiff() { return ++checks === 1 ? 'd' : 'changed'; }, async execute() { calls++; return result(0); } });
  assert.equal(drift.status, 'stale'); assert.equal(calls, 1);
  calls = 0;
  const unknown = await runApprovedValidation(approved(), { diffHash: 'd', timeoutMs: 1000, async currentDiff() { return 'd'; }, async execute() { calls++; return {}; } });
  assert.equal(unknown.status, 'unknown'); assert.equal(calls, 1);
  calls = 0;
  const timed = await runApprovedValidation(approved(), { diffHash: 'd', timeoutMs: 10, async currentDiff() { return 'd'; }, async execute(_command, signal) { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); } });
  assert.equal(timed.status, 'timed_out'); assert.equal(calls, 1);
});

test('returns a passing report only after all approved commands finish on the same diff', async () => {
  const report = await runApprovedValidation(approved(), { diffHash: 'd', timeoutMs: 1000, async currentDiff() { return 'd'; }, async execute(command) { return result(0, command); } });
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.commands.map(c => [c.command, c.exitCode]), [['test', 0], ['lint', 0]]);
  const large = normalizeShellResult(result(0, 'x'.repeat(20_000)));
  assert.equal(Buffer.byteLength(large.output), 16_384);
  assert.equal(large.truncated, true);
});
