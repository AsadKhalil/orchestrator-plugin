import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../src/host.js';

const models = async () => [
  { providerID: 'provider-a', id: 'model-a', enabled: true, status: 'active', variants: ['high'] },
  { providerID: 'other', id: 'review', enabled: true, status: 'active', variants: ['medium'] },
  { providerID: 'p', id: 'm', enabled: true, status: 'active', variants: [] },
];
const storage = { async set(_key: string, _value: string) {}, async get(_key: string): Promise<unknown> { return undefined; } };

test('creates a stage with its selected model before any prompt', async () => {
  const calls: unknown[] = [];
  const host = createHost({ session: {
    async create(input) { calls.push(input); return { id: 'owned-1' }; },
  }, storage, listModels: models });
  const id = await host.prepareStage({ runID: 'run-1', role: 'planner', model: { providerID: 'provider-a', id: 'model-a', variant: 'high' } });
  assert.equal(id, 'owned-1');
  assert.deepEqual(calls, [{ title: 'Feature Pilot: planner', model: { providerID: 'provider-a', id: 'model-a', variant: 'high' }, metadata: { featurePilotRunID: 'run-1', featurePilotRole: 'planner' }, permissions: [{ action: '*', resource: '*', effect: 'deny' }] }]);
});

test('rejects invalid model identity without creating a session', async () => {
  let called = false;
  const host = createHost({ session: { async create() { called = true; return { id: 'unexpected' }; } }, storage, listModels: models });
  await assert.rejects(host.prepareStage({ runID: 'run-1', role: 'coder', model: { providerID: '', id: 'model' } }), /model/);
  assert.equal(called, false);
});

test('OpenCode adapter forwards the stage to the plugin session API', async () => {
  const { createOpenCodeHost } = await import('../src/host.js');
  const calls: unknown[] = [];
  const context = { session: { async create(input: unknown) { calls.push(input); return { id: 'ses-owned' }; } }, storage, location: { directory: '/repo' }, model: { async list() { return { data: (await models()).map(m => ({...m, name: m.id, variants: m.variants.map(id => ({id})), capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } })) }; } } };
  const host = createOpenCodeHost(context as never);
  assert.equal(await host.prepareStage({ runID: 'run-2', role: 'reviewer', model: { providerID: 'other', id: 'review', variant: 'medium' } }), 'ses-owned');
  assert.deepEqual((calls[0] as { model: unknown }).model, { providerID: 'other', id: 'review', variant: 'medium' });
});

test('records session ownership durably and restores it in a new adapter', async () => {
  const records = new Map<string, unknown>();
  const storage = {
    async set(key: string, value: unknown) { records.set(key, value); },
    async get(key: string) { return records.get(key); },
  };
  const session = { async create() { return { id: 'owned-2' }; } };
  const stage = { runID: 'run-3', role: 'coder' as const, model: { providerID: 'p', id: 'm' } };
  const host = createHost({ session, storage, listModels: models });
  await host.prepareStage(stage);
  const restarted = createHost({ session, storage, listModels: models });
  assert.equal(await restarted.ownsSession('owned-2', 'run-3'), true);
  assert.equal(await restarted.ownsSession('owned-2', 'another-run'), false);
  assert.equal(await restarted.ownsSession('other-chat', 'run-3'), false);
});

test('does not report successful preparation if ownership cannot be saved', async () => {
  const host = createHost({
    listModels: models,
    session: { async create() { return { id: 'orphan' }; } },
    storage: { async set() { throw new Error('disk failure'); }, async get() { return undefined; } },
  });
  await assert.rejects(host.prepareStage({ runID: 'r', role: 'planner', model: { providerID: 'p', id: 'm' } }), /disk failure/);
});

test('interrupts only sessions owned by the specified run', async () => {
  const records = new Map<string, unknown>();
  const interruptions: unknown[] = [];
  const host = createHost({
    storage: { async set(k, v) { records.set(k, v); }, async get(k) { return records.get(k); } },
    listModels: models,
    session: {
      async create() { return { id: 'ses-owned' }; },
      async interrupt(input: unknown) { interruptions.push(input); return { interrupted: true }; },
    },
  });
  await host.prepareStage({ runID: 'r1', role: 'coder', model: { providerID: 'p', id: 'm' } });
  await assert.rejects(host.interrupt('ses-owned', 'r2'), /not owned/);
  await assert.rejects(host.interrupt('ses-other', 'r1'), /not owned/);
  assert.deepEqual(interruptions, []);
  assert.deepEqual(await host.interrupt('ses-owned', 'r1'), { interrupted: true });
  assert.deepEqual(interruptions, [{ sessionID: 'ses-owned', resume: false }]);
});

test('rejects unavailable models and unsupported variants before session creation', async () => {
  let creates = 0;
  const ctx = { session: { async create() { creates++; return { id: 'owned' }; } }, storage,
    async listModels() { return [{ providerID: 'p', id: 'm', enabled: true, status: 'active', variants: ['high'] }]; },
  };
  const host = createHost(ctx);
  const stage = { runID: 'r', role: 'coder' as const, model: { providerID: 'p', id: 'm', variant: 'low' } };
  await assert.rejects(host.prepareStage(stage), /variant/i);
  await assert.rejects(host.prepareStage({ ...stage, model: { providerID: 'p', id: 'missing' } }), /unavailable/i);
  assert.equal(creates, 0);
  await host.prepareStage({ ...stage, model: { providerID: 'p', id: 'm', variant: 'high' } });
  assert.equal(creates, 1);
});

test('fails closed when inventory is disabled, inactive or unavailable', async () => {
  let creates = 0;
  let state: 'disabled' | 'inactive' | 'error' = 'disabled';
  const host = createHost({ storage, session: { async create() { creates++; return { id: 'owned' }; } }, async listModels() {
    if (state === 'error') throw new Error('inventory failure');
    return [{ providerID: 'p', id: 'm', enabled: state !== 'disabled', status: state === 'inactive' ? 'deprecated' : 'active', variants: [] }];
  } });
  const stage = { runID: 'r', role: 'coder' as const, model: { providerID: 'p', id: 'm' } };
  await assert.rejects(host.prepareStage(stage), /unavailable/);
  state = 'inactive';
  await assert.rejects(host.prepareStage(stage), /unavailable/);
  state = 'error';
  await assert.rejects(host.prepareStage(stage), /inventory failure/);
  assert.equal(creates, 0);
});

test('accepts enabled beta models when their requested variant exists', async () => {
  const host = createHost({ storage, session: { async create() { return { id: 'beta-session' }; } }, async listModels() { return [{ providerID: 'p', id: 'm', enabled: true, status: 'beta', variants: ['high'] }]; } });
  assert.equal(await host.prepareStage({ runID: 'r', role: 'coder', model: { providerID: 'p', id: 'm', variant: 'high' } }), 'beta-session');
});

test('persists a role for owned sessions and fails closed for legacy or malformed roles', async () => {
  const records = new Map<string, unknown>();
  const storage = { async set(k: string, v: string) { records.set(k, v); }, async get(k: string) { return records.get(k); } };
  const session = { async create() { return { id: 'ses-role' }; } };
  const host = createHost({ storage, session, listModels: models });
  await host.prepareStage({ runID: 'r', role: 'reviewer', model: { providerID: 'p', id: 'm' } });
  const restarted = createHost({ storage, session, listModels: models });
  assert.equal(await restarted.roleForSession('ses-role'), 'reviewer');
  assert.equal(await restarted.roleForSession('unrelated'), null);
  records.set('owned-role/ses-role', 'invalid');
  assert.equal(await restarted.roleForSession('ses-role'), 'unknown');
  records.delete('owned-role/ses-role');
  assert.equal(await restarted.roleForSession('ses-role'), 'unknown');
});

test('does not mark session owned if role persistence fails', async () => {
  const records = new Map<string, unknown>();
  const storage = { async set(k: string, v: string) { if (k.startsWith('owned-role/')) throw new Error('role storage failure'); records.set(k, v); }, async get(k: string) { return records.get(k); } };
  const host = createHost({ storage, session: { async create() { return { id: 'ses-failed' }; } }, listModels: models });
  await assert.rejects(host.prepareStage({ runID: 'r', role: 'planner', model: { providerID: 'p', id: 'm' } }), /role storage failure/);
  assert.equal(await host.ownsSession('ses-failed', 'r'), false);
});

test('reads a stage only for its owning run and returns the host outcome and messages', async () => {
  const records = new Map<string, unknown>();
  const calls: string[] = [];
  const messages = [{ id: 'msg-1', type: 'assistant', model: { providerID: 'p', id: 'm' }, content: [{ type: 'text', text: 'Done' }], finish: 'stop', tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1000, completed: 2000 } }];
  const host = createHost({ storage: { async set(k, v) { records.set(k, v); }, async get(k) { return records.get(k); } }, listModels: models,
    session: { async create() { return { id: 'owned' }; }, async get({ sessionID }) { calls.push(`get:${sessionID}`); return { outcome: 'succeeded' as const }; }, async context({ sessionID }) { calls.push(`context:${sessionID}`); return messages as never; } },
  });
  await host.prepareStage({ runID: 'run', role: 'planner', model: { providerID: 'p', id: 'm' } });
  await assert.rejects(host.readStage('owned', 'another'), /not owned/);
  await assert.rejects(host.readStage('another', 'run'), /not owned/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await host.readStage('owned', 'run'), { outcome: 'succeeded', messages });
  assert.deepEqual(calls, ['get:owned', 'context:owned']);
});

test('submits and waits only on a session owned by the run', async () => {
  const records = new Map<string, unknown>();
  const calls: unknown[] = [];
  const host = createHost({ storage: { async set(k, v) { records.set(k, v); }, async get(k) { return records.get(k); } }, listModels: models,
    session: { async create() { return { id: 'owned' }; }, async prompt(input) { calls.push(input); return { id: 'queued' }; }, async wait(input) { calls.push(input); } },
  });
  await host.prepareStage({ runID: 'run', role: 'planner', model: { providerID: 'p', id: 'm' } });
  await assert.rejects(host.submitStagePrompt('owned', 'wrong', 'msg_attempt-1', 'hello'), /not owned/);
  await assert.rejects(host.waitStage('other', 'run'), /not owned/);
  await assert.rejects(host.submitStagePrompt('owned', 'run', 'invalid-id', 'hello'), /prompt/);
  await assert.rejects(host.submitStagePrompt('owned', 'run', '', 'hello'), /prompt/);
  await assert.rejects(host.submitStagePrompt('owned', 'run', 'msg_attempt-1', '  '), /prompt/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await host.submitStagePrompt('owned', 'run', 'msg_attempt-1', 'hello'), { id: 'queued' });
  await host.waitStage('owned', 'run');
  assert.deepEqual(calls, [{ sessionID: 'owned', id: 'msg_attempt-1', text: 'hello', delivery: 'queue' }, { sessionID: 'owned' }]);
});

test('records prompt intent before dispatch and refuses reuse, including after adapter restart', async () => {
  const records = new Map<string, unknown>();
  let sends = 0;
  const storage = { async set(k: string, v: string) { records.set(k, v); }, async get(k: string) { return records.get(k); } };
  const session = { async create() { return { id: 'owned' }; }, async prompt() { sends++; return {}; } };
  const host = createHost({ storage, session, listModels: models });
  await host.prepareStage({ runID: 'run', role: 'planner', model: { providerID: 'p', id: 'm' } });
  await host.submitStagePrompt('owned', 'run', 'msg_unique', 'private source text');
  const restarted = createHost({ storage, session, listModels: models });
  assert.equal(await restarted.ownsPrompt('owned', 'run', 'msg_unique', 'private source text'), true);
  assert.equal(await restarted.ownsPrompt('owned', 'run', 'msg_unique', 'different text'), false);
  assert.equal(await restarted.ownsPrompt('owned', 'other', 'msg_unique', 'private source text'), false);
  await assert.rejects(restarted.submitStagePrompt('owned', 'run', 'msg_unique', 'different text'), /already recorded/);
  await assert.rejects(restarted.submitStagePrompt('owned', 'run', 'msg_unique', 'private source text'), /already recorded/);
  assert.equal(sends, 1);
  assert.equal(JSON.stringify([...records.values()]).includes('private source text'), false);
});

test('does not dispatch when recording intent fails and serializes competing prompt IDs in one store', async () => {
  let sends = 0;
  const records = new Map<string, unknown>([['owned-session/owned', 'run']]);
  const storage = { async set(k: string, v: string) { if (k.includes('failure')) throw new Error('disk failure'); await new Promise(resolve => setTimeout(resolve, 2)); records.set(k, v); }, async get(k: string) { return records.get(k); } };
  const session = { async create() { return { id: 'owned' }; }, async prompt() { sends++; return {}; } };
  const one = createHost({ storage, session, listModels: models });
  const two = createHost({ storage, session, listModels: models });
  await assert.rejects(one.submitStagePrompt('owned', 'run', 'msg_failure', 'hello'), /disk failure/);
  assert.equal(sends, 0);
  const results = await Promise.allSettled([one.submitStagePrompt('owned', 'run', 'msg_race', 'hello'), two.submitStagePrompt('owned', 'run', 'msg_race', 'hello')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(sends, 1);
});

test('serializes prompt intents across different storage wrappers in this runtime', async () => {
  const records = new Map<string, unknown>([['owned-session/owned', 'run']]);
  const wrap = () => ({ async get(k: string) { await new Promise(r => setTimeout(r, 2)); return records.get(k); }, async set(k: string, v: string) { await new Promise(r => setTimeout(r, 2)); records.set(k, v); } });
  let sends = 0;
  const session = { async create() { return { id: 'owned' }; }, async prompt() { sends++; return {}; } };
  const one = createHost({ storage: wrap(), session, listModels: models }), two = createHost({ storage: wrap(), session, listModels: models });
  const results = await Promise.allSettled([one.submitStagePrompt('owned', 'run', 'msg_race', 'hello'), two.submitStagePrompt('owned', 'run', 'msg_race', 'hello')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(sends, 1);
});

test('uses atomic prompt claims and never dispatches after a competing claim', async () => {
  const records = new Map<string, unknown>([['owned-session/owned', 'run']]); let sends = 0, fallback = 0;
  const storage = { async get(key: string) { return records.get(key); }, async set() { fallback++; }, async compareAndSet(key: string, _expected: undefined, _value: string) { records.set(key, 'claimed by another process'); return false; } };
  const host = createHost({ storage, listModels: models, session: { async create() { return { id: 'owned' }; }, async prompt() { sends++; } } });
  await assert.rejects(host.submitStagePrompt('owned', 'run', 'msg_claim', 'hello'), /already recorded/i);
  assert.equal(sends, 0); assert.equal(fallback, 0);
});
