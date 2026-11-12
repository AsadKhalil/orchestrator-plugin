import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShellJob, attachShell, applyShellExit, markServiceReady, expireJob, canStartStep } from '../src/jobs.js';
import { step } from './fixtures/plan-data.js';
const commandStep = { ...step('Test', 'test'), taskKind: 'validate' as const, inference: false, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
const serviceStep = { ...step('Serve', 'serve'), resources: { read: [] as string[], write: [] as string[] }, taskKind: 'browser_check' as const, inference: false, execution: { kind: 'service' as const, command: 'serve', deadlineMs: 1000, readyProbe: { command: 'health', deadlineMs: 100 } } };
const input = { id: 'job-1', sessionID: 'ses_1', contentVersion: 'version-1', now: 1000 };
const result = { output: { status: 'running', shellID: 'sh_123' }, metadata: { status: 'running', shellID: 'sh_123' } };

test('requires a matching native shell handle and deduplicates completion events', () => {
  let job = createShellJob(commandStep, input);
  assert.equal(job.status, 'pending');
  assert.throws(() => attachShell(job, { output: { status: 'running', shellID: 'sh_123' }, metadata: { status: 'running', shellID: 'sh_other' } }), /handle/i);
  job = attachShell(job, result);
  const event = { eventID: 'event-1', shellID: 'sh_123', status: 'exited' as const, exit: 0, completedAt: 1500, currentContentVersion: 'version-1' };
  const done = applyShellExit(job, event);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(applyShellExit(done, event), done);
  assert.throws(() => applyShellExit(done, { ...event, exit: 1 }), /conflict/i);
});

test('never releases dependent work on stale results or ambiguous timeout', () => {
  const pending = createShellJob(commandStep, input);
  const job = attachShell(pending, result);
  const stale = applyShellExit(job, { eventID: 'e', shellID: 'sh_123', status: 'exited', exit: 0, completedAt: 1500, currentContentVersion: 'version-2' });
  assert.equal(stale.status, 'unknown');
  const next = { ...step('Next', 'next'), dependsOn: ['test'] };
  assert.equal(canStartStep(next, [stale], 'version-2'), false);
  const expired = expireJob(job, 2001);
  assert.equal(expired.status, 'unknown');
  assert.equal(expired.reason, 'deadline_unconfirmed');
});

test('a service is ready only after a successful probe and fails if it exits', () => {
  let job = attachShell(createShellJob(serviceStep, input), result);
  assert.throws(() => markServiceReady(job, { running: true, exitCode: 1, checkedAt: 1050, contentVersion: 'version-1' }), /probe/i);
  job = markServiceReady(job, { running: true, exitCode: 0, checkedAt: 1050, contentVersion: 'version-1' });
  assert.equal(job.status, 'ready');
  const dependent = { ...step('Browser', 'browser'), dependsOn: ['serve'], resources: { read: ['ui'], write: [] as string[] } };
  assert.equal(canStartStep(dependent, [job], 'version-1'), true);
  job = applyShellExit(job, { eventID: 'ended', shellID: 'sh_123', status: 'exited', exit: 0, completedAt: 1500, currentContentVersion: 'version-1' });
  assert.equal(job.status, 'failed');
  assert.equal(canStartStep(dependent, [job], 'version-1'), false);
});

test('serializes unknown or writing resources while allowing declared read-only work', () => {
  const running = attachShell(createShellJob({ ...commandStep, resources: { read: ['src'], write: [] } }, input), result);
  assert.equal(canStartStep({ ...step('Read', 'read'), resources: { read: ['docs'], write: [] } }, [running], 'version-1'), true);
  assert.equal(canStartStep(step('Unknown', 'unknown'), [running], 'version-1'), false);
  assert.equal(canStartStep({ ...step('Write', 'write'), resources: { read: [], write: ['src'] } }, [running], 'version-1'), false);
});

test('does not accept a late completion or readiness probe as on-time success', () => {
  const command = attachShell(createShellJob(commandStep, input), result);
  assert.equal(applyShellExit(command, { eventID: 'late', shellID: 'sh_123', status: 'exited', exit: 0, completedAt: 2001, currentContentVersion: 'version-1' }).status, 'timed_out');
  const service = attachShell(createShellJob(serviceStep, input), result);
  assert.throws(() => markServiceReady(service, { running: true, exitCode: 0, checkedAt: 1101, contentVersion: 'version-1' }), /probe/i);
});
