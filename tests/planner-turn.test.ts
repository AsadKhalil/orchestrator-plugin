import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRepository } from '../src/run-store.js';
import { inspectPlannerTurn, startPlannerTurn } from '../src/planner-turn.js';

async function setup() {
  const records = new Map<string, unknown>();
  const store = { async get(k: string) { return records.get(k); }, async set(k: string, v: string) { records.set(k, v); } };
  const repo = new RunRepository({ async get(k) { return structuredClone(records.get(k)); }, async set(k,v) { records.set(k, structuredClone(v)); } });
  await repo.create('run', 'Feature', 'base');
  let sent = 0, promptID = '', promptText = ''; const model = { providerID: 'p', id: 'm' };
  const host = {
    async prepareStage() { return 'ses_1'; }, async submitStagePrompt(_s: string, _r: string, id: string, text: string) { sent++; promptID = id; promptText = text; }, async waitStage() {},
    async ownsPrompt(_s: string, _r: string, id: string, text: string) { return promptID === id && promptText === text; }, async roleForSession() { return 'planner'; }, async stageModels() { return { expected: model, current: model }; },
    async readStage() { return { outcome:'succeeded', messages:[{type:'user',id:promptID,text:promptText},{type:'assistant',id:'msg_response',model,finish:'stop',content:[{type:'text',text:'{"kind":"questions","questions":[{"id":"q","question":"Which?"}]}'}]}] }; },
  };
  return { repo, store, host, sent: () => sent, input: { runID:'run',revision:0,model } };
}

test('checkpoints the planner turn and saves its structured response', async () => {
  const {repo, store, host, input, sent} = await setup();
  const result = await startPlannerTurn(repo, host as never, store, input);
  assert.equal(result.state, 'clarifying'); assert.equal(sent(), 1);
  const checkpoint = await inspectPlannerTurn(store, 'run'); assert.equal(checkpoint?.phase, 'complete'); assert.ok(checkpoint?.sessionID && checkpoint.promptID);
  await assert.rejects(startPlannerTurn(repo, host as never, store, input), /stale/i);
});

test('does not blindly replay an interrupted or concurrent turn', async () => {
  const {repo, store, host, input, sent} = await setup();
  host.waitStage = async () => { throw new Error('lost connection'); };
  const outcomes = await Promise.allSettled([startPlannerTurn(repo, host as never, store, input), startPlannerTurn(repo, host as never, store, input)]);
  assert.ok(outcomes.every(result => result.status === 'rejected')); assert.equal(sent(), 1);
  assert.equal((await inspectPlannerTurn(store, 'run'))?.phase, 'submitted');
  await assert.rejects(startPlannerTurn(repo, host as never, store, input), /reconciliation/i);
  assert.equal(sent(), 1); assert.equal((await repo.get('run')).revision, 0);
});

test('reconciles a completed session without resending its prompt', async () => {
  const { reconcilePlannerTurn } = await import('../src/planner-turn.js');
  const { repo, store, host, input, sent } = await setup();
  host.waitStage = async () => { throw new Error('connection lost'); };
  await assert.rejects(startPlannerTurn(repo, host as never, store, input), /lost/);
  const result = await reconcilePlannerTurn(repo, host as never, store, 'run');
  assert.equal(result.status, 'recovered'); assert.equal((await repo.get('run')).state, 'clarifying');
  assert.equal((await inspectPlannerTurn(store, 'run'))?.phase, 'complete'); assert.equal(sent(), 1);
  assert.equal((await reconcilePlannerTurn(repo, host as never, store, 'run')).status, 'complete'); assert.equal(sent(), 1);
});

test('leaves unresolved or changed turns for attention without replay', async () => {
  const { reconcilePlannerTurn } = await import('../src/planner-turn.js');
  const { repo, store, host, input, sent } = await setup();
  host.waitStage = async () => { throw new Error('connection lost'); };
  await assert.rejects(startPlannerTurn(repo, host as never, store, input));
  const read = host.readStage;
  host.readStage = async () => ({ outcome: undefined, messages: [] }) as never;
  assert.deepEqual(await reconcilePlannerTurn(repo, host as never, store, 'run'), { status: 'needs_attention', reason: 'session_unresolved' });
  host.readStage = read;
  await repo.changeRequirement('run', 0, 'Changed requirement');
  assert.deepEqual(await reconcilePlannerTurn(repo, host as never, store, 'run'), { status: 'needs_attention', reason: 'run_changed' });
  assert.equal(sent(), 1);
});

test('does not reconcile a turn while its dispatch is still active', async () => {
  const { reconcilePlannerTurn } = await import('../src/planner-turn.js');
  const { repo, store, host, input, sent } = await setup();
  let resume!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  host.waitStage = () => new Promise<void>(resolve => { resume = resolve; started(); });
  const running = startPlannerTurn(repo, host as never, store, input); await entered;
  assert.deepEqual(await reconcilePlannerTurn(repo, host as never, store, 'run'), { status: 'needs_attention', reason: 'turn_active' });
  resume(); assert.equal((await running).state, 'clarifying'); assert.equal(sent(), 1);
});

test('does not submit a planner prompt if stop is requested during session preparation', async () => {
  const {repo, store, host, input, sent} = await setup();
  host.prepareStage = async () => { await repo.requestStop('run', 0); return 'ses_1'; };
  await assert.rejects(startPlannerTurn(repo, host as never, store, input), /changed before dispatch/i);
  assert.equal(sent(), 0); assert.equal((await repo.get('run')).stopRequested, true);
  assert.equal((await inspectPlannerTurn(store, 'run'))?.phase, 'dispatching');
});

test('stops before dispatch if another host changes the checkpoint', async () => {
  const { repo, store, host, input, sent } = await setup(); let claims = 0;
  const atomic = { ...store, async compareAndSet(key: string, expected: unknown, value: string) {
    claims++;
    if (claims === 2) { await store.set(key, JSON.stringify({ runID: 'run', revision: 0, phase: 'creating', sessionID: null, promptID: null, marker: 'competitor' })); return false; }
    if (await store.get(key) !== expected) return false;
    await store.set(key, value); return true;
  } };
  await assert.rejects(startPlannerTurn(repo, host as never, atomic, input), /checkpoint changed/i);
  assert.equal(sent(), 0); assert.match(String(await store.get('planner-turn/run')), /competitor/);
});
