import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
// The budget ledger falls back to a file under the data directory; keep tests away from a real one.
process.env.XDG_DATA_HOME = mkdtempSync(joinPath(osTmpdir(), 'fp-plugin-test-data-'));
const testDataHome = process.env.XDG_DATA_HOME;
process.on('exit', () => rmSync(testDataHome, { recursive: true, force: true }));
import assert from 'node:assert/strict';
import plugin from '../src/index.js';

function withSessionHook(ctx: any): any {
  ctx.session ??= {};
  ctx.session.hook ??= async () => ({ async dispose() {} });
  ctx.session.get ??= async () => ({});
  ctx.rpc ??= { async register() { return { async dispose() {} }; } };
  ctx.command ??= { async transform() { return { async dispose() {} }; } };
  ctx.tool ??= {};
  ctx.tool.hook ??= async () => ({ async dispose() {} });
  return ctx;
}

test('registers a deny-only hook scoped to owned sessions and disposes it', async () => {
  assert.equal(plugin.id, 'feature-pilot');
  let handler: ((event: any) => Promise<void>) | undefined;
  let disposed = false;
  const records = new Map<string, unknown>([['owned-session/ses-a', 'run-a'], ['owned-role/ses-a', 'planner']]);
  const ctx = {
    storage: { async get(key: string) { return records.get(key); }, async scan() { return { entries: [{ key: 'owned-session/ses-a', value: 'run-a' }] }; } },
    permission: { async hook(name: string, callback: (event: any) => Promise<void>) { assert.equal(name, 'evaluate'); handler = callback; return { async dispose() { disposed = true; } }; } },
  };
  const cleanup = await plugin.setup(withSessionHook(ctx) as never);
  assert.ok(handler);
  const allowedRead = { sessionID: 'ses-a', action: 'read', effect: 'ask' };
  await handler(allowedRead);
  assert.equal(allowedRead.effect, 'ask');
  const blocked = { sessionID: 'ses-a', action: 'shell', effect: 'allow' };
  await handler(blocked);
  assert.equal(blocked.effect, 'deny');
  const unrelated = { sessionID: 'other', action: 'shell', effect: 'allow' };
  await handler(unrelated);
  assert.equal(unrelated.effect, 'allow');
  assert.equal(typeof cleanup, 'function');
  await cleanup?.();
  assert.equal(disposed, true);
});

test('fails closed for unknown sessions during storage failure after startup', async () => {
  let handler: ((event: any) => Promise<void>) | undefined;
  let fail = false;
  const ctx = {
    storage: {
      async scan() { return { entries: [{ key: 'owned-session/ses-a', value: 'run-a' }] }; },
      async get(key: string) { if (fail) throw new Error('storage offline'); return key === 'owned-role/ses-a' ? 'planner' : undefined; },
    },
    permission: { async hook(_name: string, callback: (event: any) => Promise<void>) { handler = callback; return { async dispose() {} }; } },
  };
  await plugin.setup(withSessionHook(ctx) as never);
  fail = true;
  const unrelated = { sessionID: 'other', action: 'shell', effect: 'allow' };
  await assert.rejects(handler!(unrelated), /storage offline/);
  const owned = { sessionID: 'ses-a', action: 'shell', effect: 'allow' };
  await handler!(owned);
  assert.equal(owned.effect, 'deny');
});

test('fails startup rather than installing a partial hook if ownership scanning fails', async () => {
  let registered = false;
  const ctx = { storage: { async scan() { throw new Error('scan failed'); } }, permission: { async hook() { registered = true; } } };
  await assert.rejects(async () => plugin.setup(withSessionHook(ctx) as never), /scan failed/);
  assert.equal(registered, false);
});

test('rejects repeated pagination cursors', async () => {
  const ctx = { storage: { async scan({after}: {after?: string}) { return { entries: [], next: after === 'a' ? 'b' : 'a' }; } }, permission: { async hook() { throw new Error('must not register'); } } };
  await assert.rejects(async () => plugin.setup(withSessionHook(ctx) as never), /cursor/);
});

test('loads all ownership pages and denies actions for records with unknown roles', async () => {
  let handler: ((event: any) => Promise<void>) | undefined;
  const pages: unknown[] = [];
  const ctx = {
    storage: {
      async scan(options: { after?: string }) { pages.push(options.after ?? null); return options.after ? { entries: [{ key: 'owned-session/ses-b', value: 'run-b' }] } : { entries: [{ key: 'owned-session/ses-a', value: 'run-a' }], next: 'cursor-1' }; },
      async get(key: string) { return key.endsWith('ses-a') ? 'planner' : undefined; },
    },
    permission: { async hook(_name: string, callback: (event: any) => Promise<void>) { handler = callback; return { async dispose() {} }; } },
  };
  await plugin.setup(withSessionHook(ctx) as never);
  assert.deepEqual(pages, [null, 'cursor-1']);
  const legacy = { sessionID: 'ses-b', action: 'read', effect: 'allow' };
  await handler!(legacy);
  assert.equal(legacy.effect, 'deny');
});

test('new stages enter the same permission cache before preparation returns', async () => {
  const { createRuntime } = await import('../src/index.js');
  let handler: ((event: any) => Promise<void>) | undefined;
  const records = new Map<string, unknown>([['model-selections/%2Frepo', { revision: 1, roles: { planner: [{ providerID: 'p', id: 'm', variant: null }], coder: [], reviewer: [] } }]]);
  const ctx = {
    location: { directory: '/repo' },
    storage: { async scan() { return { entries: [] }; }, async get(k: string) { return records.get(k); }, async set(k: string, v: unknown) { records.set(k, v); } },
    permission: { async hook(_n: string, cb: (event: any) => Promise<void>) { handler = cb; return { async dispose() {} }; } },
    session: { async create() { return { id: 'new-session' }; } },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'M', enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } }] }; } },
  };
  const runtime = await createRuntime(withSessionHook(ctx) as never);
  const id = await runtime.host.prepareStage({ runID: 'r', role: 'planner', model: { providerID: 'p', id: 'm' } });
  const event = { sessionID: id, action: 'shell', effect: 'allow' };
  await handler!(event);
  assert.equal(event.effect, 'deny');
  await runtime.dispose();
});

test('refuses every owned request kind without an atomic budget ledger and leaves other sessions untouched', async () => {
  let modelHook: ((event: any) => Promise<void>) | undefined;
  const ctx = {
    storage: { async scan() { return { entries: [{ key: 'owned-session/ses-a', value: 'run-a' }] }; }, async get(key: string) { return key === 'owned-role/ses-a' ? 'planner' : undefined; } },
    permission: { async hook() { return { async dispose() {} }; } },
    session: { async hook(name: string, callback: (event: any) => Promise<void>) { if (name === 'experimental.model.resolve') modelHook = callback; else assert.ok(['retry', 'prompt'].includes(name), `unexpected session hook ${name}`); return { async dispose() {} }; } },
  };
  const cleanup = await plugin.setup(withSessionHook(ctx) as never);
  assert.ok(modelHook);
  for (const kind of ['primary', 'title', 'compaction', 'generate']) await assert.rejects(modelHook({sessionID:'ses-a',kind}), /spending/i);
  await assert.doesNotReject(modelHook({sessionID:'unrelated',kind:'primary'}));
  await cleanup?.();
});

test('removes the permission hook when request-guard registration fails', async () => {
  let disposed = false;
  const ctx = { storage: { async scan() { return { entries: [] }; } },
    permission: { async hook() { return { async dispose() { disposed = true; } }; } },
    session: { async hook() { throw new Error('guard unavailable'); } },
  };
  await assert.rejects(async () => plugin.setup(ctx as never), /guard unavailable/);
  assert.equal(disposed, true);
});

test('rolls back permission and request hooks if inventory RPC registration fails', async () => {
  const disposed: string[] = [];
  const ctx = { storage: { async scan() { return { entries: [] }; } },
    permission: { async hook() { return { async dispose() { disposed.push('permission'); } }; } },
    session: { async hook() { return { async dispose() { disposed.push('request'); } }; } },
    rpc: { async register() { throw new Error('RPC failed'); } },
  };
  await assert.rejects(async () => plugin.setup(withSessionHook(ctx) as never), /RPC failed/);
  assert.deepEqual(disposed.sort(), ['permission', 'request', 'request', 'request'], 'the spend guard, retry and switch hooks are all removed');
});

test('runtime refuses to prepare a model outside the saved role selection', async () => {
  const { createRuntime } = await import('../src/index.js');
  const records = new Map<string, unknown>();
  let creates = 0;
  const ctx = { location: { directory: '/repo' }, storage: { async scan() { return { entries: [] }; }, async get(k: string) { return records.get(k); }, async set(k: string, v: unknown) { records.set(k, v); } }, permission: { async hook() { return { async dispose() {} }; } }, session: { async create() { creates++; return { id: 'owned' }; } }, model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'M', enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } }] }; } } };
  const runtime = await createRuntime(withSessionHook(ctx) as never);
  const stage = { runID: 'r', role: 'planner' as const, model: { providerID: 'p', id: 'm' } };
  await assert.rejects(runtime.host.prepareStage(stage), /not selected/i);
  assert.equal(creates, 0);
  records.set('model-selections/%2Frepo', { revision: 1, roles: { planner: [{ providerID: 'p', id: 'm', variant: null }], coder: [], reviewer: [] } });
  await runtime.host.prepareStage(stage);
  await assert.rejects(runtime.host.prepareStage({ ...stage, role: 'reviewer' }), /not selected/i);
  assert.equal(creates, 1);
  await runtime.dispose();
});

test('prompt dispatch rejects model overrides and removed selections before contacting the host', async () => {
  const { createRuntime } = await import('../src/index.js');
  const records = new Map<string, unknown>();
  const choice = { providerID: 'p', id: 'm', variant: null };
  records.set('model-selections/%2Frepo', { revision: 1, roles: { planner: [choice, { ...choice, id: 'other' }], coder: [], reviewer: [] } });
  let currentModel = { providerID: 'p', id: 'm' };
  let sends = 0;
  const ctx = { location: { directory: '/repo' }, storage: { async scan() { return { entries: [] }; }, async get(k: string) { return records.get(k); }, async set(k: string, v: unknown) { records.set(k, v); } }, permission: { async hook() { return { async dispose() {} }; } }, session: { async create() { return { id: 'ses_owned' }; }, async get() { return { model: currentModel }; }, async prompt() { sends++; return {}; } }, model: { async list() { return { data: ['m', 'other'].map(id => ({ providerID: 'p', id, name: id, enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } })) }; } } };
  const runtime = await createRuntime(withSessionHook(ctx) as never);
  await runtime.host.prepareStage({ runID: 'r', role: 'planner', model: currentModel });
  currentModel = { providerID: 'p', id: 'other' };
  await assert.rejects(runtime.host.submitStagePrompt('ses_owned', 'r', 'msg_1', 'hello'), /model changed/i);
  currentModel = { providerID: 'p', id: 'm' };
  records.set('model-selections/%2Frepo', { revision: 2, roles: { planner: [], coder: [], reviewer: [] } });
  await assert.rejects(runtime.host.submitStagePrompt('ses_owned', 'r', 'msg_2', 'hello'), /not selected/i);
  assert.equal(sends, 0);
  records.set('model-selections/%2Frepo', { revision: 3, roles: { planner: [choice], coder: [], reviewer: [] } });
  await runtime.host.submitStagePrompt('ses_owned', 'r', 'msg_3', 'hello');
  assert.equal(sends, 1);
  await runtime.dispose();
});

test('finds sessions created after another runtime initialized using host metadata', async () => {
  const { createRuntime } = await import('../src/index.js');
  const records = new Map<string, unknown>([['model-selections/%2Frepo', { revision: 1, roles: { planner: [{ providerID: 'p', id: 'm', variant: null }], coder: [], reviewer: [] } }]]);
  const sessions = new Map<string, unknown>(); const permissions: ((event:any)=>Promise<void>)[] = [], requests: ((event:any)=>Promise<void>)[] = [];
  const ctx = { location: { directory: '/repo' }, storage: { async scan() { return { entries: [] }; }, async get(k:string) { return records.get(k); }, async set(k:string,v:unknown) { records.set(k,v); } },
    permission: { async hook(_n:string, cb:(e:any)=>Promise<void>) { permissions.push(cb); return { async dispose() {} }; } },
    session: { async hook(n:string, cb:(e:any)=>Promise<void>) { if (n === 'experimental.model.resolve') requests.push(cb); return { async dispose() {} }; }, async get({sessionID}:{sessionID:string}) { return sessions.get(sessionID) ?? {}; }, async create(input:any) { sessions.set('ses_owned', {metadata:input.metadata}); return {id:'ses_owned'}; } },
    model: { async list() { return { data: [{ providerID:'p', id:'m', name:'M', enabled:true, status:'active', variants:[], capabilities:{input:['text'],output:['text'],tools:true}, limit:{context:100,output:10} }] }; } },
    rpc: { async register() { return { async dispose() {} }; } },
  };
  const first = await createRuntime(withSessionHook(ctx) as never), second = await createRuntime(ctx as never);
  await second.host.prepareStage({runID:'run',role:'planner',model:{providerID:'p',id:'m'}});
  const owned = {sessionID:'ses_owned', action:'shell', effect:'allow'}; await permissions[0](owned); assert.equal(owned.effect,'deny');
  await assert.rejects(requests[0]({sessionID:'ses_owned',kind:'primary'}), /spending/i);
  const ordinary = {sessionID:'ses_ordinary', action:'shell', effect:'allow'}; await permissions[0](ordinary); assert.equal(ordinary.effect,'allow');
  await assert.doesNotReject(requests[0]({sessionID:'ses_ordinary',kind:'primary'}));
  await first.dispose(); await second.dispose();
});

test('the runtime serving a run worktree judges its coder by the project settings, not by settings for the worktree directory', async () => {
  // Observed on a real 2.2.7 host: the coder session lives in <project>.feature-pilot/<run>, the host runs the plugin once per directory, and that
  // instance found no selections or policy under its own directory, so the guard refused the coder's model and shell actions were denied.
  const { createRuntime } = await import('../src/index.js');
  const project = joinPath(osTmpdir(), 'wt-project'), worktree = joinPath(osTmpdir(), 'wt-project.feature-pilot', 'run-1');
  const records = new Map<string, unknown>([
    ['model-selections/' + encodeURIComponent(project), { revision: 1, roles: { planner: [], coder: [{ providerID: 'p', id: 'm', variant: null }], reviewer: [] } }],
    ['policy/' + encodeURIComponent(project), { revision: 1, maxOutputTokens: 4000, coderEnabled: true, routes: [] }],
  ]);
  const sessions = new Map<string, unknown>();
  const hooks = { permissions: [] as ((event: any) => Promise<void>)[], requests: [] as ((event: any) => Promise<void>)[] };
  const contextFor = (directory: string, into: typeof hooks) => ({ location: { directory }, storage: { async scan() { return { entries: [] }; }, async get(k: string) { return records.get(k); }, async set(k: string, v: unknown) { records.set(k, v); } },
    permission: { async hook(_n: string, cb: (e: any) => Promise<void>) { into.permissions.push(cb); return { async dispose() {} }; } },
    session: { async hook(n: string, cb: (e: any) => Promise<void>) { if (n === 'experimental.model.resolve') into.requests.push(cb); return { async dispose() {} }; }, async get({ sessionID }: { sessionID: string }) { return sessions.get(sessionID) ?? {}; }, async create(input: any) { sessions.set('ses_coder', { metadata: input.metadata }); return { id: 'ses_coder' }; } },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'M', enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } }] }; } },
    rpc: { async register() { return { async dispose() {} }; } },
  });
  const projectHooks = structuredClone(hooks), worktreeHooks = structuredClone(hooks);
  const projectRuntime = await createRuntime(withSessionHook(contextFor(project, projectHooks)) as never), worktreeRuntime = await createRuntime(withSessionHook(contextFor(worktree, worktreeHooks)) as never);
  try {
    await projectRuntime.host.prepareStage({ runID: 'run', role: 'coder', model: { providerID: 'p', id: 'm' }, work: { directory: worktree, allow: ['shell'] } });
    const shell = { sessionID: 'ses_coder', action: 'shell', effect: 'allow' }; await worktreeHooks.permissions[0](shell);
    assert.equal(shell.effect, 'allow', 'the project enabled its coder, so the worktree instance must let it run shell commands');
    const web = { sessionID: 'ses_coder', action: 'webfetch', effect: 'allow' }; await worktreeHooks.permissions[0](web);
    assert.equal(web.effect, 'deny', 'the coder profile still excludes everything else');
    // The host reports a model with no variant requested as "default". Whatever else refuses the request, it must not be the selection check.
    await assert.rejects(worktreeHooks.requests[0]({ sessionID: 'ses_coder', kind: 'primary', model: { providerID: 'p', id: 'm', variant: 'default' } }), (error: Error) => /spending/i.test(error.message) && !/not selected/i.test(error.message));
  } finally { await projectRuntime.dispose(); await worktreeRuntime.dispose(); }
});

test('fails closed for an uncached session when host session lookup fails', async () => {
  const { createRuntime } = await import('../src/index.js'); let request: (e:any)=>Promise<void> = async()=>{};
  const ctx = { storage:{async scan(){return {entries:[]};},async get(){return undefined;}}, permission:{async hook(){return {async dispose(){}};}}, session:{async get(){throw Error('host lookup unavailable');},async hook(n:string, cb:(e:any)=>Promise<void>){if(n==='experimental.model.resolve')request=cb;return {async dispose(){}};}},rpc:{async register(){return {async dispose(){}};}} };
  const runtime=await createRuntime(withSessionHook(ctx) as never);
  await assert.rejects(request({sessionID:'ses_unknown',kind:'primary'}),/lookup unavailable/);
  await runtime.dispose();
});

test('recognizes late ownership even when the session metadata was removed', async () => {
  const { createRuntime } = await import('../src/index.js'); const records = new Map<string, unknown>();
  let permission: (e:any)=>Promise<void> = async()=>{}, request: (e:any)=>Promise<void> = async()=>{};
  const ctx = { storage:{async scan(){return {entries:[]};},async get(k:string){return records.get(k);}},
    permission:{async hook(_n:string, cb:(e:any)=>Promise<void>){permission=cb;return {async dispose(){}};}},
    session:{async get(){return {metadata:{}};},async hook(n:string, cb:(e:any)=>Promise<void>){if(n==='experimental.model.resolve')request=cb;return {async dispose(){}};}},rpc:{async register(){return {async dispose(){}};}} };
  const runtime=await createRuntime(withSessionHook(ctx) as never);
  records.set('owned-session/ses_late','run'); records.set('owned-role/ses_late','planner');
  const event={sessionID:'ses_late',action:'shell',effect:'allow'};await permission(event);assert.equal(event.effect,'deny');
  await assert.rejects(request({sessionID:'ses_late',kind:'primary'}),/spending/i);
  await runtime.dispose();
});

test('uses marked metadata when ownership storage is unavailable', async () => {
  const { createRuntime } = await import('../src/index.js'); let request: (e:any)=>Promise<void> = async()=>{};
  const ctx={storage:{async scan(){return {entries:[]};},async get(){throw Error('storage offline');}},permission:{async hook(){return {async dispose(){}};}},
    session:{async get({sessionID}:{sessionID:string}){return sessionID==='ses_marked'?{metadata:{featurePilotRunID:'r',featurePilotRole:'planner'}}:{};},async hook(n:string,cb:(e:any)=>Promise<void>){if(n==='experimental.model.resolve')request=cb;return {async dispose(){}};}},rpc:{async register(){return {async dispose(){}};}}};
  const runtime=await createRuntime(withSessionHook(ctx) as never);
  await assert.rejects(request({sessionID:'ses_marked',kind:'primary'}),/spending/i);
  await assert.rejects(request({sessionID:'ses_unknown',kind:'primary'}),/storage offline/i);
  await runtime.dispose();
});

// ---- Relay: the /relay command as the plugin registers it ----
/** A host that keeps what the plugin adds as commands. The host runs the callback again whenever it rebuilds its commands, so the fake runs it twice. */
function commandHost(records: Map<string, unknown>) {
  const added: any[] = [], prompts: unknown[] = [], hooks: { name: string; handler: (event: any) => Promise<void> }[] = [], asked: any[] = []; let disposed = 0;
  const sessionHooks: { name: string; handler: (event: any) => Promise<void>; disposed: boolean }[] = [];
  const ctx = withSessionHook({
    location: { directory: '/project' },
    storage: { async get(key: string) { return records.get(key); }, async set(key: string, value: unknown) { records.set(key, value); }, async scan() { return { entries: [...records].filter(([key]) => key.startsWith('owned-session/')).map(([key, value]) => ({ key, value })) }; } },
    permission: { async hook() { return { async dispose() {} }; } },
    command: { async transform(callback: (editor: { add(definition: unknown): void }) => void) { for (const list of [[], added]) callback({ add(definition) { list.push(definition); } }); return { async dispose() { disposed++; } }; } },
    tool: { async hook(name: string, handler: (event: any) => Promise<void>) { hooks.push({ name, handler }); return { async dispose() { disposed++; } }; } },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'M', enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } }] }; } },
    experimental: { generate: { async decisions(request: unknown) { asked.push(request); return { answers: [{ type: 'choice', name: 'mode', choice: 'review', probabilities: [], confidence: 0.95 }], cost: 0 }; } } },
    session: {
      async prompt(input: unknown) { prompts.push(input); },
      async hook(name: string, handler: (event: any) => Promise<void>) { const entry = { name, handler, disposed: false }; sessionHooks.push(entry); return { async dispose() { entry.disposed = true; } }; },
    },
  });
  return { ctx, added, prompts, hooks, asked, sessionHooks, disposed: () => disposed };
}

test('registers /relay, the helper hook and the switch hook once and disposes them', async () => {
  const host = commandHost(new Map());
  const cleanup = await plugin.setup(host.ctx as never);
  assert.deepEqual(host.added.map(command => [command.name, typeof command.description, typeof command.execute]), [['relay', 'string', 'function']]);
  assert.deepEqual(host.hooks.map(hook => hook.name), ['execute.before']);
  assert.equal(host.sessionHooks.filter(hook => hook.name === 'prompt').length, 1, 'one prompt hook for the switch');
  await cleanup?.();
  assert.equal(host.disposed(), 2);
  assert.equal(host.sessionHooks.every(hook => hook.disposed), true);
});

test('the switch hook as registered places a message in a chat whose switch is on, and leaves other chats alone', async () => {
  const records = new Map<string, unknown>([['relay/settings', { revision: 1, modes: { plan: [], execute: [], review: [{ providerID: 'p', id: 'm', variant: null, useFor: '' }] }, decider: { providerID: 'd', id: 'judge', variant: null } }], ['relay/on/ses-b', true]]), host = commandHost(records);
  await plugin.setup(host.ctx as never);
  const prompt = host.sessionHooks.find(hook => hook.name === 'prompt')!;
  await prompt.handler({ sessionID: 'ses-c', messageID: 'm1', delivery: 'steer', prompt: { text: 'Check the diff for mistakes.' } });
  assert.equal(host.asked.length, 0, 'switch off: no decider request');
  await prompt.handler({ sessionID: 'ses-b', messageID: 'm2', delivery: 'steer', prompt: { text: 'Check the diff for mistakes.' } });
  assert.equal(host.asked.length, 1);
  await new Promise(done => setTimeout(done, 20));   // the record is written after the hook returns
  assert.deepEqual((records.get('relay/decisions') as any[]).map(item => [item.kind, item.sessionID, item.mode]), [['chat', 'ses-b', 'review']]);
  assert.deepEqual(host.prompts, [], 'the hook never sends');
});

test('the helper hook as registered asks the host\'s decision call and gives a checking helper the Review model', async () => {
  const records = new Map<string, unknown>([['relay/settings', { revision: 1, modes: { plan: [], execute: [], review: [{ providerID: 'p', id: 'm', variant: null, useFor: '' }] }, decider: { providerID: 'd', id: 'judge', variant: null } }]]), host = commandHost(records);
  await plugin.setup(host.ctx as never);
  const event = { tool: 'subagent', sessionID: 'ses-b', input: { agent: 'general', prompt: 'Check the diff for mistakes.' } as { agent: string; prompt: string; model?: string } };
  await host.hooks[0].handler(event);
  assert.equal(event.input.model, 'p/m');
  assert.deepEqual(host.asked.map(request => request.model), [{ providerID: 'd', id: 'judge' }]);
  assert.deepEqual((records.get('relay/decisions') as any[]).map(item => [item.kind, item.sessionID, item.mode, item.model]), [['helper', 'ses-b', 'review', 'p/m']]);
});

test('/relay as registered refuses a chat that a run created, and sends a normal chat\'s message once and records it', async () => {
  const records = new Map<string, unknown>([['owned-session/ses-a', 'run-a'], ['owned-role/ses-a', 'planner']]), host = commandHost(records);
  await plugin.setup(host.ctx as never);
  const relay = host.added[0];
  await assert.rejects(relay.execute({ sessionID: 'ses-a', prompt: { text: 'hi' }, delivery: 'steer' }), /does not work in a chat that a Relay run created/);
  await relay.execute({ sessionID: 'ses-b', prompt: { text: 'hi' }, delivery: 'queue' });
  assert.deepEqual(host.prompts, [{ text: 'hi', sessionID: 'ses-b', delivery: 'queue', metadata: { relay: 'sent' } }]);
  assert.deepEqual((records.get('relay/decisions') as any[]).map(item => [item.kind, item.sessionID, item.mode, item.note]), [['chat', 'ses-b', null, 'no decider chosen']]);
});
