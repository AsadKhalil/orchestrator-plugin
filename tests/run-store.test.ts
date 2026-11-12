import { step, criterion } from './fixtures/plan-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRepository, createRunRepository } from '../src/run-store.js';

function memoryStore() {
  const records = new Map<string, unknown>();
  return { records, async get(key: string) { return structuredClone(records.get(key)); }, async set(key: string, value: unknown) { await new Promise(r => setTimeout(r, 2)); records.set(key, structuredClone(value)); } };
}
const plan = { steps: [step('Implement')], acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'Revert changes', validationCommands: ['test'] };

test('uses host compare-and-set and rechecks the revision after a competing write', async () => {
  const data = new Map<string, unknown>(); let forceConflict = false, fallbackWrites = 0;
  const storage = {
    async get(key: string) { return structuredClone(data.get(key)); },
    async set() { fallbackWrites++; throw Error('unsafe fallback'); },
    async compareAndSet(key: string, expected: unknown, value: unknown) {
      if (forceConflict) { forceConflict = false; const old = data.get(key) as any; data.set(key, { ...old, revision: old.revision + 1, requirement: 'Concurrent update' }); return false; }
      if (JSON.stringify(data.get(key)) !== JSON.stringify(expected)) return false;
      data.set(key, structuredClone(value)); return true;
    },
  };
  const repo = createRunRepository({ storage } as never, 'project/');
  await repo.create('r', 'Original', 'base'); forceConflict = true;
  await assert.rejects(repo.changeRequirement('r', 0, 'Lost update'), /stale|revision/i);
  assert.equal((await repo.get('r')).requirement, 'Concurrent update');
  assert.equal(fallbackWrites, 0);
  assert.ok(data.has('project/runs/r'));
});

test('saves and restores an approved plan across repository instances', async () => {
  const store = memoryStore();
  const first = new RunRepository(store);
  await first.create('r', 'Requirement', 'base');
  const planned = await first.setPlan('r', 0, plan);
  const approved = await first.approve('r', planned.revision, planned.planHash!);
  const restarted = new RunRepository(store);
  assert.deepEqual(await restarted.get('r'), approved);
  assert.equal((await restarted.begin('r', approved.revision)).state, 'implementing');
});

test('serializes competing updates sharing a store and rejects duplicate creation', async () => {
  const store = memoryStore();
  const first = new RunRepository(store), second = new RunRepository(store);
  await first.create('r', 'Requirement', 'base');
  await assert.rejects(second.create('r', 'Other', 'base'), /exists/i);
  const result = await Promise.allSettled([first.setPlan('r', 0, plan), second.setPlan('r', 0, { ...plan, steps: [step('Alternative')] })]);
  assert.deepEqual(result.map(x => x.status), ['fulfilled', 'rejected']);
});

test('fails closed when the persisted plan is modified', async () => {
  const store = memoryStore();
  const repo = new RunRepository(store);
  await repo.create('r', 'Requirement', 'base');
  const planned = await repo.setPlan('r', 0, plan);
  await repo.approve('r', planned.revision, planned.planHash!);
  const saved = store.records.get('runs/r') as any;
  saved.plan.steps.push(step('Injected'));
  await assert.rejects(repo.get('r'), /hash/i);
});

test('serializes different wrappers over the same backend in this runtime', async () => {
  const backend = memoryStore();
  const wrap = () => ({ get: (key: string) => backend.get(key), set: (key: string, value: unknown) => backend.set(key, value) });
  const one = new RunRepository(wrap()), two = new RunRepository(wrap());
  await one.create('r', 'Requirement', 'base');
  const results = await Promise.allSettled([one.setPlan('r', 0, plan), two.setPlan('r', 0, { ...plan, steps: [step('Other')] })]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
});

test('persists bounded review state and refuses altered review history', async () => {
  const store = memoryStore(), repo = new RunRepository(store);
  let run = await repo.create('r', 'Requirement', 'base');
  run = await repo.setPlan('r', run.revision, plan);
  run = await repo.approve('r', run.revision, run.planHash!);
  run = await repo.begin('r', run.revision);
  run = await repo.recordStepOutcome('r', run.revision, { stepID: 'implement', inputContentVersion: 'base', contentVersion: 'diff', evidence: 'implementation' });
  run = await repo.startReview('r', run.revision, { planHash: run.planHash!, diffHash: 'diff', validation: { diffHash: 'diff', commands: [{ command: 'test', exitCode: 0 }] }, reviewer: { providerID: 'p', id: 'm', variant: null, vendor: 'review', modelVersion: 'v1' }, contributingVendors: ['coder'], budgetAvailable: true });
  run = await repo.applyReviewerOutput('r', run.revision, JSON.stringify({ planHash: run.planHash!, diffHash: 'diff', verdict: 'approve', findings: [] }));
  assert.equal((await new RunRepository(store).get('r')).state, 'ready_for_acceptance');
  const saved = store.records.get('runs/r') as any;
  const outcomes = saved.outcomes; saved.outcomes = [];
  await assert.rejects(repo.get('r'), /outcome/i); saved.outcomes = outcomes;
  saved.review.repairRounds = 2;
  await assert.rejects(repo.accept('r', run.revision), /review/i);
});

test('persists native job intent, handle and deduplicated exit inside the run', async () => {
  const store = memoryStore(), repo = new RunRepository(store);
  const testStep = { ...step('Run tests', 'tests'), taskKind: 'validate' as const, inference: false, resources: { read: ['src'], write: [] }, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
  let run = await repo.create('jobs', 'Requirement', 'base');
  run = await repo.setPlan('jobs', run.revision, { ...plan, steps: [testStep] });
  run = await repo.approve('jobs', run.revision, run.planHash!); run = await repo.begin('jobs', run.revision);
  run = await repo.recordJobIntent('jobs', run.revision, 'tests', { id: 'job', sessionID: 'ses_1', contentVersion: 'v1', now: 1000 });
  run = await repo.recordJobHandle('jobs', run.revision, 'job', { output: { status: 'running', shellID: 'sh_1' }, metadata: { status: 'running', shellID: 'sh_1' } });
  const event = { eventID: 'event', shellID: 'sh_1', status: 'exited' as const, exit: 0, completedAt: 1500, currentContentVersion: 'v1' };
  run = await repo.recordJobExit('jobs', run.revision, 'job', event);
  assert.equal(run.jobs[0].status, 'succeeded');
  const restored = await new RunRepository(store).get('jobs'); assert.deepEqual(restored.jobs, run.jobs);
  const replay = await repo.recordJobExit('jobs', restored.revision, 'job', event);
  assert.equal(replay.revision, restored.revision);
});

test('rejects tampered persisted job completion evidence', async () => {
  const store = memoryStore(), repo = new RunRepository(store);
  const testStep = { ...step('Run tests', 'tests'), taskKind: 'validate' as const, inference: false, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
  let run = await repo.create('tamper', 'Requirement', 'base');
  run = await repo.setPlan('tamper', run.revision, { ...plan, steps: [testStep] });
  run = await repo.approve('tamper', run.revision, run.planHash!); run = await repo.begin('tamper', run.revision);
  run = await repo.recordJobIntent('tamper', run.revision, 'tests', { id: 'job', sessionID: 'ses_1', contentVersion: 'v1', now: 1000 });
  run = await repo.recordJobHandle('tamper', run.revision, 'job', { output: { status: 'running', shellID: 'sh_1' }, metadata: { status: 'running', shellID: 'sh_1' } });
  run = await repo.recordJobExit('tamper', run.revision, 'job', { eventID: 'event', shellID: 'sh_1', status: 'exited', exit: 7, completedAt: 1500, currentContentVersion: 'v1' });
  const saved = store.records.get('runs/tamper') as any; saved.jobs[0].status = 'succeeded'; saved.jobs[0].exitCode = 0;
  await assert.rejects(repo.get('tamper'), /job|event/i);
});

test('review cannot proceed while an approved validation job is missing or failed', async () => {
  const store = memoryStore(), repo = new RunRepository(store);
  const testStep = { ...step('Run tests', 'tests'), taskKind: 'validate' as const, inference: false, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
  let run = await repo.create('blocked', 'Requirement', 'base');
  run = await repo.setPlan('blocked', run.revision, { ...plan, steps: [testStep] }); run = await repo.approve('blocked', run.revision, run.planHash!); run = await repo.begin('blocked', run.revision);
  const review = { planHash: run.planHash!, diffHash: 'v1', validation: { diffHash: 'v1', commands: [{ command: 'test', exitCode: 0 }] }, reviewer: { providerID: 'p', id: 'm', variant: null, vendor: 'review', modelVersion: 'v1' }, contributingVendors: ['coder'], budgetAvailable: true };
  await assert.rejects(repo.startReview('blocked', run.revision, review), /validation job/i);
  run = await repo.recordJobIntent('blocked', run.revision, 'tests', { id: 'job', sessionID: 'ses_1', contentVersion: 'v1', now: 1000 });
  run = await repo.recordJobHandle('blocked', run.revision, 'job', { output: { status: 'running', shellID: 'sh_1' }, metadata: { status: 'running', shellID: 'sh_1' } });
  run = await repo.recordJobExit('blocked', run.revision, 'job', { eventID: 'event', shellID: 'sh_1', status: 'exited', exit: 7, completedAt: 1500, currentContentVersion: 'v1' });
  await assert.rejects(repo.startReview('blocked', run.revision, review), /validation job/i);
});

test('persists ordinary step outcomes and gates dependent jobs by content version', async () => {
  const store = memoryStore(), repo = new RunRepository(store);
  const implement = step('Implement', 'implement');
  const verify = { ...step('Test', 'test'), dependsOn: ['implement'], taskKind: 'validate' as const, inference: false, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
  let run = await repo.create('deps', 'Requirement', 'base');
  run = await repo.setPlan('deps', run.revision, { ...plan, steps: [implement, verify] });
  run = await repo.approve('deps', run.revision, run.planHash!); run = await repo.begin('deps', run.revision);
  const job = { id: 'job', sessionID: 'ses_1', contentVersion: 'v1', now: 1000 };
  await assert.rejects(repo.recordJobIntent('deps', run.revision, 'test', job), /runnable/i);
  run = await repo.recordStepOutcome('deps', run.revision, { stepID: 'implement', inputContentVersion: 'v0', contentVersion: 'v1', evidence: 'Implementation completed' });
  const restored = await new RunRepository(store).get('deps'); assert.deepEqual(restored.outcomes, run.outcomes);
  await assert.rejects(repo.recordJobIntent('deps', run.revision, 'test', { ...job, contentVersion: 'v2' }), /runnable/i);
  await assert.rejects(repo.recordStepOutcome('deps', run.revision, { stepID: 'test', inputContentVersion: 'v1', contentVersion: 'v1', evidence: 'claimed' }), /runnable/i);
  run = await repo.recordJobIntent('deps', run.revision, 'test', job);
  assert.equal(run.jobs[0].status, 'pending');
  const saved = store.records.get('runs/deps') as any; saved.outcomes[0].stepID = 'test';
  await assert.rejects(repo.get('deps'), /outcome/i);
});

test('tracks a writing step input and output versions and prevents read-only changes', async () => {
  const repo = new RunRepository(memoryStore());
  const first = { ...step('Read', 'read'), resources: { read: ['src'], write: [] as string[] } };
  const write = { ...step('Write', 'write'), dependsOn: ['read'], resources: { read: ['src'], write: ['src'] } };
  let run = await repo.create('versions', 'Requirement', 'base');
  run = await repo.setPlan('versions', run.revision, { ...plan, steps: [first, write] });
  run = await repo.approve('versions', run.revision, run.planHash!); run = await repo.begin('versions', run.revision);
  await assert.rejects(repo.recordStepOutcome('versions', run.revision, { stepID: 'read', inputContentVersion: 'v1', contentVersion: 'v2', evidence: 'read' }), /read-only/i);
  run = await repo.recordStepOutcome('versions', run.revision, { stepID: 'read', inputContentVersion: 'v1', contentVersion: 'v1', evidence: 'read' });
  await assert.rejects(repo.recordStepOutcome('versions', run.revision, { stepID: 'write', inputContentVersion: 'v2', contentVersion: 'v3', evidence: 'changed' }), /runnable/i);
  run = await repo.recordStepOutcome('versions', run.revision, { stepID: 'write', inputContentVersion: 'v1', contentVersion: 'v2', evidence: 'changed' });
  assert.equal(run.outcomes.at(-1)?.contentVersion, 'v2');
});

test('a stop request persists, blocks further work and allows late job exits', async () => {
  const store = memoryStore(), repo = new RunRepository(store);
  const testStep = { ...step('Run tests', 'tests'), taskKind: 'validate' as const, inference: false, execution: { kind: 'command' as const, command: 'test', deadlineMs: 1000, readyProbe: null } };
  let run = await repo.create('stop', 'Requirement', 'base'); run = await repo.setPlan('stop', run.revision, { ...plan, steps: [testStep] });
  run = await repo.approve('stop', run.revision, run.planHash!); run = await repo.begin('stop', run.revision);
  run = await repo.recordJobIntent('stop', run.revision, 'tests', { id: 'job', sessionID: 'ses_1', contentVersion: 'v1', now: 1000 });
  run = await repo.recordJobHandle('stop', run.revision, 'job', { output: { status: 'running', shellID: 'sh_1' }, metadata: { status: 'running', shellID: 'sh_1' } });
  const before = run; run = await repo.requestStop('stop', run.revision);
  assert.equal(run.stopRequested, true); assert.equal(run.jobs[0].status, 'running'); assert.equal(run.planHash, before.planHash);
  assert.equal((await new RunRepository(store).get('stop')).stopRequested, true);
  await assert.rejects(repo.recordJobIntent('stop', run.revision, 'tests', { id: 'other', sessionID: 'ses_1', contentVersion: 'v1', now: 1000 }), /stop requested/i);
  await assert.rejects(repo.begin('stop', run.revision), /stop requested/i);
  assert.equal((await repo.requestStop('stop', run.revision)).revision, run.revision);
  run = await repo.recordJobExit('stop', run.revision, 'job', { eventID:'exit', shellID:'sh_1', status:'killed', completedAt:1500, currentContentVersion:'v1' });
  assert.equal(run.jobs[0].status, 'cancelled'); assert.equal(run.stopRequested, true);
  await assert.rejects(repo.startReview('stop', run.revision, {planHash:run.planHash!,diffHash:'v1',validation:{diffHash:'v1',commands:[{command:'test',exitCode:0}]},reviewer:{providerID:'p',id:'m',variant:null,vendor:'review',modelVersion:'v1'},contributingVendors:['coder'],budgetAvailable:true}), /stop requested/i);
});
