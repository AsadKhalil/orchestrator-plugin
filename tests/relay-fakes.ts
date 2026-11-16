import { decide, type DecisionsRequest } from '../src/decider.js';
import type { RelayDeps } from '../src/relay-command.js';
import type { Mode, RelaySettings } from '../src/relay-store.js';

// One fake host for the /relay command and the helper hook. It behaves like the real one where the tests depend on it:
// it keeps the chat's agent and model and changes them on a switch, it reports "no effort" as `default`, and a chat that is busy stays busy until its time is up.

type Picked = { choice: string; confidence: number };
export type FakeReply = Picked & { lines?: Partial<Record<Mode, Picked>> };
type Step = 'owned' | 'get' | 'wait' | 'switchAgent' | 'switchModel' | 'put' | 'remove' | 'prompt' | 'models' | 'storageGet' | 'storageSet';
export type FakeOptions = {
  /** Default: plan [p/plan], execute [p/exec#high], review [p/review], no lines, decider d/judge. */
  settings?: Partial<RelaySettings>;
  /** Default: agent `plan`, model p/usual. */
  chat?: { agent?: string; model?: { providerID: string; id: string; variant?: string } };
  /** Default: execute at 0.98. `never` does not answer. */
  decision?: FakeReply | Error | 'never' | ((request: DecisionsRequest) => FakeReply);
  /** The decider's time limit in this fake; default 5000. */
  decideMs?: number;
  owned?: boolean; busyMs?: number; waitMs?: number; sizeMs?: number; readMs?: number;
  /** A file's size by its address; default 2048 bytes. `never` does not answer. */
  sizes?: Record<string, number | null | Error | 'never'>;
  fail?: Partial<Record<Step, Error>>;
};

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
export const entry = (id: string, variant: string | null = null, useFor = '') => ({ providerID: 'p', id, variant, useFor });
const listed = (id: string, input: string[], variants: string[], context: number) => ({ providerID: 'p', id, name: id, enabled: true, status: 'active', variants, capabilities: { input, output: ['text'], tools: true }, limit: { context, output: 1000 }, cost: { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, tiered: false } });
/** The chat models on offer: all take text; `p/eyes` also takes pictures; `p/small` has a context window of 1,000 tokens. */
export const fakeModels = [listed('plan', ['text'], [], 100_000), listed('exec', ['text'], ['high'], 100_000), listed('review', ['text'], [], 100_000), listed('usual', ['text'], [], 100_000), listed('eyes', ['text', 'image'], [], 100_000), listed('small', ['text'], [], 1000)];

export function fakeRelay(options: FakeOptions = {}) {
  const calls: { name: string; input: unknown }[] = [], data = new Map<string, unknown>();
  const settings: RelaySettings = { revision: 1, modes: { plan: [entry('plan')], execute: [entry('exec', 'high')], review: [entry('review')] }, decider: { providerID: 'd', id: 'judge', variant: null }, ...options.settings };
  data.set('relay/settings', settings);
  const chat: { agent: string; model: { providerID: string; id: string; variant?: string } } = { agent: options.chat?.agent ?? 'plan', model: options.chat?.model ?? { providerID: 'p', id: 'usual', variant: 'default' } };
  const idleAt = Date.now() + (options.busyMs ?? 0);
  /** Every call is listed, a failing one included. */
  const step = <T>(name: Step, input: unknown, work: () => T): T => { calls.push({ name, input }); const failure = options.fail?.[name]; if (failure) throw failure; return work(); };
  const decisions = async (request: DecisionsRequest): Promise<unknown> => {
    calls.push({ name: 'decisions', input: request });
    const decision = options.decision ?? { choice: 'execute', confidence: 0.98 };
    if (decision instanceof Error) throw decision;
    if (decision === 'never') return new Promise(() => undefined);
    const reply = typeof decision === 'function' ? decision(request) : decision;
    const choice = (name: string, picked: Picked) => ({ type: 'choice', name, choice: picked.choice, probabilities: [], confidence: picked.confidence });
    return { answers: [choice('mode', reply), ...Object.entries(reply.lines ?? {}).map(([mode, picked]) => choice(`${mode}_line`, picked))], cost: 0, tokens: { input: 418, output: 38 } };
  };
  const deps: RelayDeps = {
    session: {
      async get(input: { sessionID: string }) { return step('get', input, () => ({ id: input.sessionID, agent: chat.agent, model: { ...chat.model } })); },
      async wait(input: unknown) { step('wait', input, () => undefined); const left = idleAt - Date.now(); if (left > 0) await sleep(left); calls.push({ name: 'idle', input }); },
      async switchAgent(input: { agent: string }) { step('switchAgent', input, () => { chat.agent = input.agent; }); },
      async switchModel(input: { model: { providerID: string; id: string; variant?: string } }) { step('switchModel', input, () => { chat.model = { variant: 'default', ...input.model }; }); },
      async prompt(input: unknown) { step('prompt', input, () => undefined); },
      instructions: { entry: { async put(input: unknown) { step('put', input, () => undefined); }, async remove(input: unknown) { step('remove', input, () => undefined); } } },
    } as never,
    store: {
      async get(key: string) { return step('storageGet', key, () => structuredClone(data.get(key))); },
      async set(key: string, value: unknown) { step('storageSet', key, () => { data.set(key, structuredClone(value)); }); },
    },
    chatModels: async () => step('models', undefined, () => fakeModels),
    decide: (decider, input) => decide({ decisions }, decider, input, options.decideMs),
    owned: async sessionID => step('owned', sessionID, () => options.owned ?? false),
    fileSize: async uri => {
      calls.push({ name: 'size', input: uri });
      const size = options.sizes?.[uri];
      if (size instanceof Error) throw size;
      return size === 'never' ? new Promise<number | null>(() => undefined) : size === undefined ? 2048 : size;
    },
    waitMs: options.waitMs, sizeMs: options.sizeMs, readMs: options.readMs,
  };
  return { deps, calls, data, chat };
}
