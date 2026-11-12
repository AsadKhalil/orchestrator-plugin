import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRepository } from '../src/run-store.js';
import { savePlannerReply } from '../src/planner-handoff.js';

async function setup() {
  const records = new Map<string, unknown>();
  const repo = new RunRepository({ async get(k) { return structuredClone(records.get(k)); }, async set(k,v) { records.set(k, structuredClone(v)); } });
  const run = await repo.create('run', 'Feature', 'base');
  const model = { providerID: 'p', id: 'm', variant: 'high' };
  const reply = { type: 'assistant', id: 'msg_assistant', model, finish: 'stop', content: [{ type: 'text', text: JSON.stringify({ kind: 'questions', questions: [{ id: 'q', question: 'Which?' }] }) }] };
  const host = { async ownsPrompt() { return true; }, async roleForSession() { return 'planner'; }, async stageModels() { return { expected: model, current: model }; }, async readStage() { return { outcome: 'succeeded', messages: [{ type: 'user', id: 'msg_prompt', text: 'prompt' }, reply] }; } };
  return { repo, run, host, reply, input: { runID: 'run', revision: 0, sessionID: 'ses_1', promptID: 'msg_prompt' } };
}

test('persists a completed owned planner reply as a clarification', async () => {
  const { repo, host, input } = await setup();
  const result = await savePlannerReply(repo, host as never, input);
  assert.equal(result.state, 'clarifying'); assert.equal(result.clarification[0].question, 'Which?');
  assert.equal((await repo.get('run')).revision, 1);
  await assert.rejects(savePlannerReply(repo, host as never, input), /stale/i);
});

test('does not save unowned, mismatched, partial, ambiguous or malformed replies', async () => {
  for (const mode of ['unowned', 'model', 'incomplete', 'ambiguous', 'malformed']) {
    const { repo, host, reply, input } = await setup();
    if (mode === 'unowned') host.ownsPrompt = async () => false;
    if (mode === 'model') host.stageModels = async () => ({ expected: {providerID:'p',id:'m',variant:'high'}, current: {providerID:'p',id:'m',variant:'low'} });
    if (mode === 'incomplete') reply.finish = 'length';
    if (mode === 'ambiguous') host.readStage = async () => ({ outcome:'succeeded', messages:[{type:'user',id:'msg_prompt',text:'prompt'}, reply, reply] });
    if (mode === 'malformed') reply.content[0].text = 'not JSON';
    await assert.rejects(savePlannerReply(repo, host as never, input));
    assert.equal((await repo.get('run')).revision, 0);
  }
});

test('accepts completed read-only tool turns and rejects unsafe or incomplete turns', async () => {
  for (const mode of ['allowed', 'disallowed', 'running', 'wrong-model', 'extra-user']) {
    const { repo, host, reply, input } = await setup();
    const tool = { type: 'tool', name: mode === 'disallowed' ? 'shell' : 'read', state: { status: mode === 'running' ? 'running' : 'completed' } };
    const intermediate = { ...reply, id: 'msg_tool', finish: 'tool-calls', model: mode === 'wrong-model' ? { ...reply.model, id: 'other' } : reply.model, content: [tool] };
    host.readStage = async () => ({ outcome: 'succeeded', messages: [{ type: 'user', id: 'msg_prompt', text: 'prompt' }, intermediate as never, ...(mode === 'extra-user' ? [{ type: 'user', id: 'msg_other', text: 'other' }] : []), reply, { type: 'idle' } as never] });
    if (mode === 'allowed') assert.equal((await savePlannerReply(repo, host as never, input)).state, 'clarifying');
    else { await assert.rejects(savePlannerReply(repo, host as never, input)); assert.equal((await repo.get('run')).revision, 0); }
  }
});
