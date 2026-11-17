import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import plugin from '../src/index.js';

/** A host that keeps what the plugin adds as commands. The host runs the callback again whenever it rebuilds its commands, so the fake runs it twice. */
function commandHost(records: Map<string, unknown>, options: { rpcFails?: boolean } = {}) {
  const added: any[] = [], prompts: unknown[] = [], hooks: { name: string; handler: (event: any) => Promise<void> }[] = [], asked: any[] = []; let disposed = 0;
  const sessionHooks: { name: string; handler: (event: any) => Promise<void>; disposed: boolean }[] = [];
  const ctx = {
    location: { directory: '/project' },
    storage: { async get(key: string) { return records.get(key); }, async set(key: string, value: unknown) { records.set(key, value); } },
    command: { async transform(callback: (editor: { add(definition: unknown): void }) => void) { for (const list of [[], added]) callback({ add(definition) { list.push(definition); } }); return { async dispose() { disposed++; } }; } },
    tool: { async hook(name: string, handler: (event: any) => Promise<void>) { hooks.push({ name, handler }); return { async dispose() { disposed++; } }; } },
    rpc: { async register() { if (options.rpcFails) throw new Error('RPC failed'); return { async dispose() { disposed++; } }; } },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'M', enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } }] }; } },
    experimental: { generate: { async decisions(request: unknown) { asked.push(request); return { answers: [{ type: 'choice', name: 'mode', choice: 'review', probabilities: [], confidence: 0.95 }], cost: 0 }; } } },
    session: {
      async get() { return {}; },
      async prompt(input: unknown) { prompts.push(input); },
      async hook(name: string, handler: (event: any) => Promise<void>) { const entry = { name, handler, disposed: false }; sessionHooks.push(entry); return { async dispose() { entry.disposed = true; } }; },
    },
  };
  return { ctx, added, prompts, hooks, asked, sessionHooks, disposed: () => disposed };
}

test('registers /relay, the helper hook, the switch hook and the panel calls once, and disposes them', async () => {
  const host = commandHost(new Map());
  const cleanup = await plugin.setup(host.ctx as never);
  assert.deepEqual(host.added.map(command => [command.name, typeof command.description, typeof command.execute]), [['relay', 'string', 'function']]);
  assert.deepEqual(host.hooks.map(hook => hook.name), ['execute.before']);
  assert.equal(host.sessionHooks.filter(hook => hook.name === 'prompt').length, 1, 'one prompt hook for the switch');
  await cleanup?.();
  assert.equal(host.disposed(), 3, 'the command, the helper hook and the panel calls');
  assert.equal(host.sessionHooks.every(hook => hook.disposed), true);
});

test('when the panel calls cannot be registered, start-up fails and leaves no command or hook behind', async () => {
  const host = commandHost(new Map(), { rpcFails: true });
  await assert.rejects(async () => plugin.setup(host.ctx as never), /RPC failed/);
  assert.equal(host.disposed(), 2, 'the command and the helper hook are removed');
  assert.equal(host.sessionHooks.every(hook => hook.disposed), true, 'the switch hook is removed');
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

test('/relay as registered sends the message once, marked as placed, and records it', async () => {
  const records = new Map<string, unknown>(), host = commandHost(records);
  await plugin.setup(host.ctx as never);
  await host.added[0].execute({ sessionID: 'ses-b', prompt: { text: 'hi' }, delivery: 'queue' });
  assert.deepEqual(host.prompts, [{ text: 'hi', sessionID: 'ses-b', delivery: 'queue', metadata: { relay: 'sent' } }]);
  assert.deepEqual((records.get('relay/decisions') as any[]).map(item => [item.kind, item.sessionID, item.mode, item.note]), [['chat', 'ses-b', null, 'no decider chosen']]);
});

test('the plugin id, the RPC id and the package name are one name: relay-opencode', async () => {
  // OpenCode keeps each plugin's saved settings under its id, so a new name loses everyone's settings (the rename from feature-pilot did, 17 Nov 2026).
  const { RelayRpc } = await import('../src/contract.js');
  const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { name: string };
  assert.deepEqual([plugin.id, RelayRpc.id, name], ['relay-opencode', 'relay-opencode', 'relay-opencode']);
});
