import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, criterion } from './fixtures/plan-data.js';
import { RunRepository } from '../src/run-store.js';
import { advance, drive, StageRefused, type Ports } from '../src/orchestrator.js';

const memory = () => { const records = new Map<string, unknown>(); return { async get(k: string) { return structuredClone(records.get(k)); }, async set(k: string, v: unknown) { records.set(k, structuredClone(v)); } }; };
const plan = (steps: unknown[] = [step('Implement')]) => ({ steps: steps as never, acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'revert', validationCommands: ['test'] });
const reviewerPick = { reviewer: { providerID: 'p', id: 'rev', variant: null, vendor: 'review-vendor', modelVersion: '1' }, contributingVendors: ['planner-vendor', 'coder-vendor'] };

function setup(options: { verdicts?: ('approve' | 'request_changes')[]; validations?: ('passed' | 'failed')[]; steps?: unknown[]; reviewer?: typeof reviewerPick | null; budget?: () => boolean; codeFails?: boolean; codeRefused?: string } = {}) {
  const repo = new RunRepository(memory()), calls: string[] = [];
  let version = 0; const verdicts = [...(options.verdicts ?? ['approve'])], validations = [...(options.validations ?? [])];
  const ports: Ports = {
    plan: async run => { calls.push('plan'); return repo.setPlan(run.id, run.revision, plan(options.steps)); },
    prepareWorktree: async () => { calls.push('prepare'); },
    identity: async () => `tree:${version}`,
    code: async (_run, s) => { calls.push(s ? `code:${s.id}` : 'repair'); if (options.codeRefused) throw new StageRefused(options.codeRefused); if (options.codeFails) throw new Error('host failed'); version++; },
    validate: async () => { calls.push('validate'); const status = validations.shift() ?? 'passed'; return { status, commands: [{ command: 'test', exitCode: status === 'passed' ? 0 : 1 }] }; },
    reviewer: async () => options.reviewer === undefined ? reviewerPick : options.reviewer,
    review: async run => {
      calls.push('review'); const verdict = verdicts.shift() ?? 'approve';
      const findings = verdict === 'approve' ? [] : [{ id: `f${calls.length}`, severity: 'blocking' as const, description: 'Broken', evidence: 'It fails' }];
      return repo.recordReview(run.id, run.revision, { planHash: run.planHash!, diffHash: run.review!.pending!.diffHash, verdict, findings });
    },
    budgetAvailable: async () => options.budget ? options.budget() : true,
  };
  return { repo, ports, calls };
}
const approve = async (repo: RunRepository, id: string) => { const run = await repo.get(id); return repo.approve(id, run.revision, run.planHash!); };

test('supervised run plans, waits for approval, then implements, validates and reviews to ready_for_acceptance', async () => {
  const { repo, ports, calls } = setup(); await repo.create('r', 'Login', 'c0ffee');
  let run = await drive(repo, ports, 'r');
  assert.equal(run.state, 'awaiting_approval'); assert.deepEqual(calls, ['plan']);
  assert.equal((await advance(repo, ports, 'r')).progressed, false, 'waits for a person');
  await approve(repo, 'r');
  run = await drive(repo, ports, 'r');
  assert.equal(run.state, 'ready_for_acceptance'); assert.equal(run.approval?.type, 'human');
  assert.deepEqual(calls, ['plan', 'prepare', 'code:implement', 'validate', 'review']);
  assert.equal(run.outcomes.length, 1); assert.equal(run.outcomes[0].inputContentVersion, 'tree:0'); assert.equal(run.outcomes[0].contentVersion, 'tree:1');
  assert.equal(run.review?.reviews[0].diffHash, 'tree:1');
});

test('autonomous mode records an autonomous approval and runs straight through', async () => {
  const { repo, ports } = setup(); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'ready_for_acceptance'); assert.equal(run.approval?.type, 'autonomous');
});

test('blocking findings trigger repair rounds and a passing re-review ends the loop', async () => {
  const { repo, ports, calls } = setup({ verdicts: ['request_changes', 'request_changes', 'approve'] }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'ready_for_acceptance'); assert.equal(run.review?.reviews.length, 3); assert.equal(run.review?.repairRounds, 2);
  assert.equal(calls.filter(c => c === 'repair').length, 2); assert.equal(calls.filter(c => c === 'validate').length, 3, 'every repair is re-validated');
  assert.deepEqual(run.review?.reviews.map(r => r.diffHash), ['tree:1', 'tree:2', 'tree:3']);
});

test('unresolved blockers after the second repair stop at the review limit and are never reviewed again', async () => {
  const { repo, ports, calls } = setup({ verdicts: ['request_changes', 'request_changes', 'request_changes', 'approve'] }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'review_limit_reached'); assert.equal(run.attention?.resumeState, null);
  assert.equal(calls.filter(c => c === 'review').length, 3);
  const again = await drive(repo, ports, 'r'); assert.equal(again.revision, run.revision); assert.equal(calls.filter(c => c === 'review').length, 3);
});

test('a failing validation pauses with a resumable checkpoint instead of reviewing', async () => {
  const { repo, ports, calls } = setup({ validations: ['failed', 'passed'] }); await repo.create('r', 'Login', 'c0ffee');
  let run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'validation_failed'); assert.equal(run.attention?.resumeState, 'validating');
  assert.ok(!calls.includes('review'));
  run = await repo.resume('r', run.revision);
  run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'ready_for_acceptance');
});

test('a failed coder stage pauses once and is never retried automatically', async () => {
  const { repo, ports, calls } = setup({ codeFails: true }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'stage_failed'); assert.equal(run.attention?.resumeState, 'implementing');
  await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(calls.filter(c => c === 'code:implement').length, 1);
});

test('an exhausted budget pauses before any paid stage is dispatched', async () => {
  const { repo, ports, calls } = setup({ budget: () => false }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r');
  assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'budget_exhausted'); assert.deepEqual(calls, []);
});

test('review is refused when no independent reviewer exists or the reviewer shares a vendor with the work', async () => {
  const none = setup({ reviewer: null }); await none.repo.create('r', 'Login', 'c0ffee');
  assert.equal((await drive(none.repo, none.ports, 'r', { autonomous: true })).attention?.reason, 'no_independent_reviewer');
  const same = setup({ reviewer: { ...reviewerPick, reviewer: { ...reviewerPick.reviewer, vendor: 'coder-vendor' } } }); await same.repo.create('r', 'Login', 'c0ffee');
  const run = await drive(same.repo, same.ports, 'r', { autonomous: true });
  assert.equal(run.attention?.reason, 'review_not_permitted'); assert.ok(!same.calls.includes('review'));
});

test('a stop request cancels without dispatching further stages and keeps the artifacts', async () => {
  const { repo, ports, calls } = setup(); await repo.create('r', 'Login', 'c0ffee');
  await drive(repo, ports, 'r'); const approved = await approve(repo, 'r');
  await repo.requestStop('r', approved.revision);
  const run = await drive(repo, ports, 'r');
  assert.equal(run.state, 'cancelled'); assert.deepEqual(calls, ['plan']); assert.ok(run.planHash);
});

test('plans with shell-job steps pause as unsupported rather than skipping them', async () => {
  const serve = { ...step('Serve', 'serve'), taskKind: 'validate' as const, inference: false, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
  const { repo, ports, calls } = setup({ steps: [step('Implement'), serve] }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.attention?.reason, 'unsupported_step'); assert.ok(!calls.includes('code:implement'));
});

test('a stage refused for a stated reason pauses with that reason', async () => {
  const { repo, ports } = setup({ codeRefused: 'coder_not_enabled' }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'coder_not_enabled'); assert.equal(run.attention?.resumeState, 'implementing');
});

test('a stop requested while a stage is in flight cancels the run instead of stranding it', async () => {
  const { repo, ports } = setup(); await repo.create('r', 'Login', 'c0ffee');
  ports.code = async run => { await repo.requestStop(run.id, (await repo.get(run.id)).revision); throw new Error('session interrupted'); };
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'cancelled'); assert.equal(run.stopRequested, true); assert.ok(run.planHash);
});

test('a stop on a run ready for acceptance cancels it, because accepting is refused once a stop is requested', async () => {
  const { repo, ports } = setup(); await repo.create('r', 'Login', 'c0ffee');
  const ready = await drive(repo, ports, 'r', { autonomous: true }); assert.equal(ready.state, 'ready_for_acceptance');
  await repo.requestStop('r', ready.revision);
  await assert.rejects(repo.accept('r', (await repo.get('r')).revision), /stop/i);
  const run = await drive(repo, ports, 'r'); assert.equal(run.state, 'cancelled'); assert.ok(run.planHash);
});

test('a step whose dependencies cannot be satisfied is refused before the coder is paid, not after', async () => {
  const a = step('A', 'a'), b = { ...step('B', 'b'), dependsOn: ['a'] }, c = { ...step('C', 'c'), dependsOn: ['a', 'b'] };
  const { repo, ports, calls } = setup({ steps: [a, b, c] }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  // c needs a's outcome on the current content, but b already changed it: running the coder could never be recorded.
  assert.equal(run.attention?.reason, 'step_dependencies_unmet');
  assert.deepEqual(calls.filter(call => call.startsWith('code:')), ['code:a', 'code:b'], 'the third coder turn was never dispatched');
});

test('a coder step that depends on a step nobody runs is refused before spending', async () => {
  const design = { ...step('Design', 'design'), role: 'planner' as const, taskKind: 'design' as const }, build = { ...step('Build', 'build'), dependsOn: ['design'] };
  const { repo, ports, calls } = setup({ steps: [design, build] }); await repo.create('r', 'Login', 'c0ffee');
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.attention?.reason, 'step_dependencies_unmet'); assert.equal(calls.filter(call => call.startsWith('code')).length, 0);
});

test('an early review check that refuses pauses the run while it is still validating, before any reviewer is paid', async () => {
  const { repo, ports, calls } = setup(); await repo.create('r', 'Login', 'c0ffee');
  ports.reviewable = async () => { throw new StageRefused('diff_too_large_to_review'); };
  const run = await drive(repo, ports, 'r', { autonomous: true });
  assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'diff_too_large_to_review'); assert.equal(run.attention?.resumeState, 'validating');
  assert.ok(!calls.includes('review'));
});

const migrate = { ...step('Migrate', 'migrate'), inference: false, dependsOn: ['implement'], execution: { kind: 'command' as const, command: 'npm run migrate', deadlineMs: 1000, readyProbe: null } };
const wire = { ...step('Wire up', 'wire-up'), dependsOn: ['migrate'] };

test('a one-shot command step runs in the foreground between coder steps, is recorded as an outcome without a model turn', async () => {
  const { repo, ports, calls } = setup({ steps: [step('Implement'), migrate, wire], });
  ports.runCommand = async (_run, s) => { calls.push(`command:${s.id}`); return { status: 'passed', exitCode: 0 }; };
  await repo.create('r', 'Login', 'c0ffee'); await drive(repo, ports, 'r'); await approve(repo, 'r');
  const run = await drive(repo, ports, 'r');
  assert.deepEqual(calls.filter(item => /^(code|command)/.test(item)), ['code:implement', 'command:migrate', 'code:wire-up']);
  assert.equal(run.state, 'ready_for_acceptance'); assert.deepEqual(run.jobs, [], 'no background job record exists for a foreground command');
  assert.match(run.outcomes.find(item => item.stepID === 'migrate')!.evidence, /exited 0/);
});

test('a command step that fails, times out or cannot be read pauses with its own reason and runs again only on resume', async () => {
  for (const [status, reason] of [['failed', 'step_command_failed'], ['timed_out', 'step_command_timed_out'], ['unknown', 'step_command_unknown']] as const) {
    const { repo, ports, calls } = setup({ steps: [step('Implement'), migrate, wire] });
    let outcome: 'passed' | typeof status = status;
    ports.runCommand = async (_run, s) => { calls.push(`command:${s.id}`); return { status: outcome, exitCode: outcome === 'passed' ? 0 : null }; };
    await repo.create('r', 'Login', 'c0ffee'); await drive(repo, ports, 'r'); await approve(repo, 'r');
    let run = await drive(repo, ports, 'r');
    assert.equal(run.attention?.reason, reason, status); assert.ok(!calls.includes('code:wire-up'), 'later steps wait for the command');
    assert.equal(calls.filter(item => item === 'command:migrate').length, 1);
    outcome = 'passed'; run = await repo.resume('r', run.revision); run = await drive(repo, ports, 'r');
    assert.equal(run.state, 'ready_for_acceptance', JSON.stringify(run.attention)); assert.equal(calls.filter(item => item === 'command:migrate').length, 2); assert.equal(calls.filter(item => item === 'code:implement').length, 1, 'the finished coder step is not repeated');
  }
});

test('services and commands owned by another role still pause as unsupported before anything is paid for, even with a command runner', async () => {
  const service = { ...migrate, id: 'serve', execution: { kind: 'service' as const, command: 'npm start', deadlineMs: 1000, readyProbe: { command: 'curl localhost', deadlineMs: 1000 } } };
  const reviewerCommand = { ...migrate, id: 'check', role: 'reviewer' as const, resources: { read: ['src'], write: [] as string[] } };
  for (const odd of [service, reviewerCommand]) {
    const { repo, ports, calls } = setup({ steps: [step('Implement'), odd] });
    ports.runCommand = async () => { calls.push('command'); return { status: 'passed', exitCode: 0 }; };
    await repo.create('r', 'Login', 'c0ffee');
    const run = await drive(repo, ports, 'r', { autonomous: true });
    assert.equal(run.attention?.reason, 'unsupported_step', odd.id); assert.ok(!calls.includes('code:implement') && !calls.includes('command'));
  }
});

test('a validate-kind command step must have run on exactly the content that is reviewed', async () => {
  const check = { ...migrate, id: 'check', taskKind: 'validate' as const };
  for (const [steps, expected] of [[[step('Implement'), check], 'ready_for_acceptance'], [[step('Implement'), check, { ...step('Wire up', 'wire-up'), dependsOn: ['check'] }], 'review_not_permitted']] as const) {
    const { repo, ports } = setup({ steps: [...steps] });
    ports.runCommand = async () => ({ status: 'passed', exitCode: 0 });
    await repo.create('r', 'Login', 'c0ffee'); await drive(repo, ports, 'r'); await approve(repo, 'r');
    const run = await drive(repo, ports, 'r');
    assert.equal(run.state === 'ready_for_acceptance' ? run.state : run.attention?.reason, expected, 'content changed after the validation step makes it stale');
  }
});
