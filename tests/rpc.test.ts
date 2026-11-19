import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRpc, RelayRpc } from '../src/rpc.js';
import { recordDecision, saveReplies } from '../src/relay-store.js';
import { AA_CREDIT, AA_LIST_URL, AA_SOURCE } from '../src/artificial-analysis.js';

/** What the real host does with a handler: it supplies the typed-error factory, and the client sees a returned error as a rejected call (a thrown one only as "RPC call failed"). */
class HostError extends Error { constructor(readonly type: string, message: string, readonly data: unknown) { super(message); } }
function asClient(handlers: unknown): any {
  const call = { signal: new AbortController().signal, error: (type: string, message: string, data: unknown) => new HostError(type, message, data) };
  return Object.fromEntries(Object.entries(handlers as Record<string, (input: unknown, call: unknown) => Promise<unknown>>).map(([name, handler]) => [name, async (input: unknown) => {
    const result = await handler(input, call); if (result instanceof HostError) throw result; return result;
  }]));
}

/** The real host refuses an output that does not fit the method's declared schema. This checks the shape keywords the contract uses and lists what does not fit. */
function fits(schema: any, value: unknown, path = 'output'): string[] {
  if (schema.anyOf) return schema.anyOf.some((option: unknown) => fits(option, value, path).length === 0) ? [] : [`${path}: fits no option`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: not one of ${schema.enum.join(', ')}`];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : schema.type === 'integer' && Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type && type !== schema.type) return [`${path}: ${type}, not ${schema.type}`];
  if (type === 'array') return (value as unknown[]).flatMap((item, index) => fits(schema.items ?? {}, item, `${path}[${index}]`));
  if (type !== 'object') return [];
  const properties = schema.properties ?? {}, object = value as Record<string, unknown>;
  return [
    ...(schema.required ?? []).filter((key: string) => !(key in object)).map((key: string) => `${path}.${key}: missing`),
    ...Object.keys(object).filter(key => schema.additionalProperties === false && !(key in properties)).map(key => `${path}.${key}: not declared`),
    ...Object.entries(object).flatMap(([key, item]) => properties[key] ? fits(properties[key], item, `${path}.${key}`) : []),
  ];
}

test('registers a read-only inventory endpoint that does not return provider secrets', async () => {
  let handler: (() => Promise<unknown>) | undefined;
  const ctx = {
    location: { directory: '/repo' },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'Model', enabled: true, status: 'active', variants: [{ id: 'high', settings: { apiKey: 'hidden' } }], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 }, settings: { apiKey: 'secret' } }] }; } },
    rpc: { async register(_definition: unknown, handlers: { listModels: () => Promise<unknown> }) { handler = (asClient(handlers) as { listModels: () => Promise<unknown> }).listModels; return { async dispose() {} }; } },
  };
  await registerRpc(ctx as never);
  assert.ok(handler);
  const result = await handler();
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('hidden'), false);
  assert.equal((result as any).directory, '/repo');
  assert.equal((result as any).models[0].id, 'm');
  assert.deepEqual((result as any).models[0].cost, { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, cacheWritePerMillion: null, tiered: false, steps: [] });
  assert.deepEqual(fits(RelayRpc.methods.listModels.output, result), [], 'the real host refuses an output its contract does not declare');
});


test('a refusal reaches the client as the declared rejected error with its message, not as a thrown handler error', async () => {
  let handlers: any;
  await registerRpc({ location: { directory: '/repo' }, storage: { async get() { return undefined; }, async set() {} }, model: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } } as never);
  await assert.rejects(handlers.setRelayChat({ sessionID: '  ', on: true }), { type: 'rejected', message: 'Name the chat' });
  await assert.rejects(handlers.testDecider({ text: ' ' }), { type: 'rejected', message: 'Type a sample message' });
  // Every method must declare the error, or the real host would drop the message and the panel could not explain a refusal.
  const missing = Object.entries(RelayRpc.methods).filter(([, method]) => !(method as { errors?: Record<string, unknown> }).errors?.rejected).map(([name]) => name);
  assert.deepEqual(missing, []);
});

// ---- Relay: the settings every project shares, and the panel's test box ----
const relayHigh = { providerID: 'p', id: 'm', variant: 'high' }, relayDeep = { providerID: 'p', id: 'deep', variant: null }, relayJudge = { providerID: 'd', id: 'judge', variant: null };
const noModes = { plan: [], execute: [], review: [] };
const picked = (name: string, value: unknown, confidence: number) => ({ type: 'choice', name, choice: value, probabilities: [], confidence });
/** Two project folders on one host: plugin storage is shared, the chat models are p/m (effort high) and p/deep, and the only decision model is d/judge. */
function relayHost(fetcher: typeof fetch = (async () => { throw new Error('no network in tests'); }) as typeof fetch) {
  const data = new Map<string, unknown>(), requests: any[] = []; let lists = 0;
  let reply: unknown = { answers: [picked('mode', 'review', 0.97)], cost: 0 };
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async set(key: string, value: unknown) { data.set(key, structuredClone(value)); }, async remove(key: string) { data.delete(key); } };
  const listed = (providerID: string, id: string, variants: string[] = []) => ({ providerID, id, name: id, enabled: true, status: 'active', variants: variants.map(variant => ({ id: variant })), capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 1000, output: 10 }, cost: [{ input: 0.24, output: 0, cache: { read: 0, write: 0 } }], headers: { authorization: 'secret' } });
  const connect = async (directory: string) => {
    let handlers: any;
    await registerRpc({
      location: { directory }, storage, session: {},
      model: { async list(input: { types?: string[] }) { lists++; return { data: input.types?.includes('decision') ? [listed('d', 'judge')] : [listed('p', 'm', ['high']), listed('p', 'deep')] }; } },
      experimental: { generate: { async decisions(request: unknown) { requests.push(request); return reply; } } },
      rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } },
    } as never, { fetcher });
    return handlers;
  };
  return { storage, requests, connect, answer(next: unknown) { reply = next; }, lists: () => lists };
}

test('getRelay and saveRelay keep one set of settings for every project, and fit what they declare', async () => {
  const host = relayHost(), one = await host.connect('/one'), two = await host.connect('/two');
  const input = { revision: 0, modes: { ...noModes, review: [{ ...relayHigh, useFor: ' checks  for mistakes ' }, relayDeep] }, decider: relayJudge };
  assert.deepEqual(fits(RelayRpc.methods.saveRelay.input, input), [], 'what the panel sends fits the declared input');
  const saved = await one.saveRelay(input);
  assert.equal(saved.settings.revision, 1);
  assert.deepEqual(saved.settings.modes.review, [{ ...relayHigh, useFor: 'checks for mistakes' }, { ...relayDeep, useFor: '' }]);
  await recordDecision(host.storage, { at: '2026-11-14T00:00:00.000Z', sessionID: 'ses-1', kind: 'chat', mode: 'review', confidence: 0.97, fit: null, model: 'p/m#high', ms: 150, costUsd: '0', note: null });
  const seen = await two.getRelay({});
  assert.equal(seen.directory, '/two');
  assert.deepEqual(seen.settings, saved.settings);
  assert.deepEqual(seen.deciders.map((model: { providerID: string; id: string; cost: { inputPerMillion: string } }) => `${model.providerID}/${model.id} ${model.cost.inputPerMillion}`), ['d/judge 0.24']);
  assert.deepEqual([seen.checks, seen.decisions.length, seen.decisions[0].model], [{ active: true, note: null }, 1, 'p/m#high']);
  assert.equal(JSON.stringify(seen).includes('secret'), false);
  assert.deepEqual([fits(RelayRpc.methods.getRelay.output, seen), fits(RelayRpc.methods.saveRelay.output, saved)], [[], []]);
  await assert.rejects(one.saveRelay({ revision: 0, modes: noModes, decider: null }), { type: 'rejected', message: /stale/i });
  await assert.rejects(one.saveRelay({ revision: 1, modes: noModes, decider: relayHigh }), { type: 'rejected', message: /decision model/i });
  await assert.rejects(one.saveRelay({ revision: 1, modes: { ...noModes, plan: [{ ...relayHigh, useFor: 'x'.repeat(201) }] }, decider: relayJudge }), { type: 'rejected', message: /at most 200 characters/ });
  const cleared = await two.saveRelay({ revision: 1, modes: noModes, decider: null });
  assert.deepEqual([cleared.settings.revision, cleared.checks], [2, { active: false, note: 'no decider chosen' }]);
});

test('a record that says what its reply took fits what the panel and the pill declare', async () => {
  const host = relayHost(), one = await host.connect('/one'), took = {
    requests: 3, fresh: 5972, cached: 5672, costUsd: '0.011961', seconds: 0.6, model: 'p/m#high', total: { input: 5762, output: 15, reasoning: 0, cacheRead: 28572, cacheWrite: 300, costUsd: '0.057313' },
    prices: { inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: '0.3', cacheWritePerMillion: null }, pricesFrom: 'opencode' as const,
  };
  await recordDecision(host.storage, { at: '2026-11-18T00:00:00.000Z', sessionID: 'ses-1', kind: 'chat', mode: 'execute', confidence: 0.9, fit: 0.8, model: 'p/m#high', ms: 150, costUsd: '0', note: null, messageID: 'msg-1' });
  await saveReplies(host.storage, 'ses-1', new Map([['msg-1', took]]));
  const recent = await one.getRelayDecisions({}), pill = await one.getRelayChat({ sessionID: 'ses-1' }), all = await one.getRelay({});
  assert.deepEqual([recent.decisions[0].reply, pill.last.reply, all.decisions[0].messageID], [took, took, 'msg-1']);
  assert.deepEqual([fits(RelayRpc.methods.getRelayDecisions.output, recent), fits(RelayRpc.methods.getRelayChat.output, pill), fits(RelayRpc.methods.getRelay.output, all)], [[], [], []]);
});

test("getRelayChat and setRelayChat read and turn one chat's switch, give that chat's last choice, and fit what they declare", async () => {
  const host = relayHost(), one = await host.connect('/one');
  const off = await one.getRelayChat({ sessionID: 'ses-1' });
  assert.deepEqual(off, { on: false, last: null, decider: false });
  const input = { sessionID: 'ses-1', on: true };
  assert.deepEqual(fits(RelayRpc.methods.setRelayChat.input, input), [], 'what the pill sends fits the declared input');
  const set = await one.setRelayChat(input);
  assert.deepEqual(set, { on: true });
  await recordDecision(host.storage, { at: '2026-11-16T00:00:01.000Z', sessionID: 'ses-1', kind: 'chat', mode: 'review', confidence: 0.9, fit: null, model: 'p/m#high', ms: 150, costUsd: '0', note: null });
  await recordDecision(host.storage, { at: '2026-11-16T00:00:02.000Z', sessionID: 'ses-2', kind: 'chat', mode: 'plan', confidence: 0.9, fit: null, model: 'p/deep', ms: 150, costUsd: '0', note: null });
  const seen = await (await host.connect('/two')).getRelayChat({ sessionID: 'ses-1' });
  assert.deepEqual([seen.on, seen.last?.sessionID, seen.last?.model], [true, 'ses-1', 'p/m#high'], "this chat's newest record, read from any project folder");
  assert.deepEqual([fits(RelayRpc.methods.getRelayChat.output, seen), fits(RelayRpc.methods.getRelayChat.output, off), fits(RelayRpc.methods.setRelayChat.output, set)], [[], [], []]);
  assert.deepEqual(await one.setRelayChat({ sessionID: 'ses-1', on: false }), { on: false });
  assert.equal((await one.getRelayChat({ sessionID: 'ses-1' })).on, false);
  await assert.rejects(one.setRelayChat({ sessionID: '  ', on: true }), { type: 'rejected', message: /chat/i });
  await one.saveRelay({ revision: 0, modes: noModes, decider: relayJudge });
  assert.equal((await one.getRelayChat({ sessionID: 'ses-1' })).decider, true, 'the pill learns that a decider is chosen, so it can stop warning');
});

test('getRelayDecisions gives the newest 20 records, newest first, from storage alone, and fits what it declares', async () => {
  const host = relayHost(), one = await host.connect('/one');
  for (let i = 1; i <= 22; i++) await recordDecision(host.storage, { at: `2026-11-16T00:00:${String(i).padStart(2, '0')}.000Z`, sessionID: `ses-${i}`, kind: i % 2 ? 'chat' : 'helper', mode: 'plan', confidence: 0.9, fit: null, model: 'p/deep', ms: 150, costUsd: '0', note: null });
  const before = host.lists(), result = await one.getRelayDecisions({});
  assert.deepEqual(result.decisions.map((item: { sessionID: string }) => item.sessionID), Array.from({ length: 20 }, (_, i) => `ses-${22 - i}`));
  assert.equal(result.directory, '/one');
  assert.equal(host.lists(), before, 'no model list is read: the panel asks for this every few seconds');
  assert.deepEqual(fits(RelayRpc.methods.getRelayDecisions.output, result), []);
});

test('testDecider asks the chosen decider once and reports what Relay would do', async () => {
  const host = relayHost(), one = await host.connect('/one');
  await one.saveRelay({ revision: 0, modes: { ...noModes, review: [{ ...relayHigh, useFor: 'checks for mistakes' }, relayDeep] }, decider: relayJudge });
  host.answer({ answers: [picked('mode', 'review', 0.97), picked('review_line', '1', 0.8)], cost: 0 });
  const sure = await one.testDecider({ text: 'check my diff' });
  assert.deepEqual({ ...sure, ms: 0 }, { directory: '/one', mode: 'review', confidence: 0.97, model: 'p/m#high', fit: 0.8, ms: 0, costUsd: '0', note: null });
  assert.deepEqual(fits(RelayRpc.methods.testDecider.output, sure), []);
  assert.equal(host.requests.length, 1);
  assert.deepEqual(host.requests[0].model, { providerID: 'd', id: 'judge' });
  assert.deepEqual(host.requests[0].questions.map((question: { name: string }) => question.name), ['mode', 'review_line']);
  assert.equal(/p\/m|deep|0\.24/.test(JSON.stringify(host.requests[0])), false, 'the decider is never told a model name or a price');
  host.answer({ answers: [picked('mode', 'execute', 0.4)], cost: 0 });
  const unsure = await one.testDecider({ text: 'hmm' });
  assert.deepEqual({ ...unsure, ms: 0 }, { directory: '/one', mode: 'plan', confidence: 0.4, model: null, fit: null, ms: 0, costUsd: '0', note: 'not sure, so Plan; no model chosen for Plan' });
  host.answer({ answers: [] });
  const silent = await one.testDecider({ text: 'hello' });
  assert.deepEqual({ ...silent, ms: 0 }, { directory: '/one', mode: null, confidence: null, model: null, fit: null, ms: 0, costUsd: null, note: "the decider's answer could not be read" });
  assert.deepEqual([fits(RelayRpc.methods.testDecider.output, unsure), fits(RelayRpc.methods.testDecider.output, silent)], [[], []]);
  await assert.rejects(one.testDecider({ text: '  ' }), { type: 'rejected', message: /sample message/i });
  assert.equal(host.requests.length, 3);
  assert.deepEqual((await one.getRelay({})).decisions, [], 'a try in the test box is not recorded');
});

test('the index comes from one public list fetched at most once a day, and an older copy stands in when a fetch fails', async () => {
  const records = new Map<string, unknown>(), model = (providerID: string, id: string, name: string) => ({ providerID, id, name, enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } });
  const scored = (id: string, index: number) => ({ id, benchmarks: { artificial_analysis: { intelligence_index: index } } });
  let reply = () => new Response(JSON.stringify({ data: [scored('anthropic/claude-sonnet-5.5', 54.5), scored('z-ai/glm-5.3', 61)] })), fetched = 0, now = Date.parse('2026-11-18T08:00:00Z'), handlers: any;
  const ctx = {
    location: { directory: '/repo' },
    storage: { async get(key: string) { return structuredClone(records.get(key)); }, async set(key: string, value: unknown) { records.set(key, structuredClone(value)); } },
    model: { async list(input: { types?: string[] }) { return { data: input.types?.[0] === 'decision' ? [model('d', 'judge', 'Judge')] : [model('claude-agent', 'sonnet', 'Sonnet 5.5'), model('ollama-cloud', 'glm-5.3', 'GLM-5.3'), model('local', 'llama', 'Llama Local')] }; } },
    rpc: { async register(_definition: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } },
  };
  await registerRpc(ctx as never, { fetcher: (async () => { fetched++; return reply(); }) as typeof fetch, now: () => now });
  const first = await handlers.listIntelligence({});
  assert.deepEqual(first.scores, [{ providerID: 'claude-agent', id: 'sonnet', index: 54.5, matched: 'anthropic/claude-sonnet-5.5' }, { providerID: 'ollama-cloud', id: 'glm-5.3', index: 61, matched: 'z-ai/glm-5.3' }]);
  assert.deepEqual([first.directory, first.fetchedAt, first.note, fetched], ['/repo', '2026-11-18T08:00:00.000Z', null, 1]);
  assert.match(first.source, /Artificial Analysis/);
  assert.deepEqual(fits(RelayRpc.methods.listIntelligence.output, first), []);
  now += 23 * 3600_000;
  await handlers.listIntelligence({});
  assert.equal(fetched, 1, 'a copy under a day old is used as it is');
  now += 2 * 3600_000; reply = () => new Response('busy', { status: 503 });
  const stale = await handlers.listIntelligence({});
  assert.deepEqual([fetched, stale.scores.length, stale.fetchedAt, stale.note], [2, 2, '2026-11-18T08:00:00.000Z', 'could not refresh the index: OpenRouter answered 503']);
  records.clear();
  const none = await handlers.listIntelligence({});
  assert.deepEqual([none.scores, none.fetchedAt, none.note], [[], null, 'could not load the index: OpenRouter answered 503']);
  assert.deepEqual(fits(RelayRpc.methods.listIntelligence.output, none), []);
});

// ---- Usage by model, and the Artificial Analysis key ----
const KEY = 'aa_test_key_0123456789';
const aaPage = (models: { slug: string; name: string; creator: string; index: number }[]) => ({ tier: 'free', pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false }, data: models.map(model => ({
  slug: model.slug, name: model.name, release_date: '2026-09-28', model_creator: { name: model.creator }, evaluations: { artificial_analysis_intelligence_index: model.index },
  pricing: { price_1m_input_tokens: 2, price_1m_output_tokens: 10, price_1m_cache_hit_tokens: 0.1, price_1m_cache_write_tokens: 2.5 },
})) });

test('usage by model and the price key fit what they declare, and no call returns the key', async () => {
  const asked: { url: string; key: string | null }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => { asked.push({ url, key: new Headers(init?.headers).get('x-api-key') }); return new Response(JSON.stringify(aaPage([{ slug: 'm', name: 'M', creator: 'P', index: 40 }]))); }) as unknown as typeof fetch;
  const host = relayHost(fetcher), one = await host.connect('/one');
  const took = { requests: 3, fresh: 5972, cached: 5672, costUsd: '0.011961', seconds: 0.6, model: 'p/m#high', total: { input: 5762, output: 15, reasoning: 0, cacheRead: 28572, cacheWrite: 300, costUsd: '0.057313' }, prices: { inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: '0.3', cacheWritePerMillion: '3.75' }, pricesFrom: 'opencode' as const };
  await recordDecision(host.storage, { at: '2026-11-19T00:00:00.000Z', sessionID: 'ses-1', kind: 'chat', mode: 'execute', confidence: 0.9, fit: 0.8, model: 'p/m#high', ms: 150, costUsd: '0', note: null, messageID: 'msg-1' });
  await saveReplies(host.storage, 'ses-1', new Map([['msg-1', took]]));
  const usage = await one.getRelayUsage({});
  assert.deepEqual([usage.directory, usage.rows.map((row: { model: string; requests: number }) => [row.model, row.requests]), usage.credit], ['/one', [['p/m#high', 3]], null]);
  assert.deepEqual([fits(RelayRpc.methods.getRelayUsage.output, usage), fits(RelayRpc.methods.setPriceKey.input, { key: KEY }), fits(RelayRpc.methods.setPriceKey.input, { key: null })], [[], [], []]);
  const saved = await one.setPriceKey({ key: KEY });
  assert.deepEqual([saved, asked], [{ saved: true, note: null }, [{ url: `${AA_LIST_URL}?page=1`, key: KEY }]], 'the list is loaded once with the new key, from Artificial Analysis only');
  const relay = await one.getRelay({}), again = await one.getRelayUsage({});
  assert.deepEqual([relay.priceKey, again.credit, fits(RelayRpc.methods.getRelay.output, relay), fits(RelayRpc.methods.setPriceKey.output, saved)], [true, AA_CREDIT, [], []]);
  for (const output of [relay, again, saved, await one.getRelayDecisions({}), await one.getRelayChat({ sessionID: 'ses-1' }), await one.listIntelligence({})]) assert.equal(JSON.stringify(output).includes(KEY), false);
  await assert.rejects(one.setPriceKey({ key: 'has a space' }), { type: 'rejected', message: /does not look like/ });
  assert.deepEqual(await one.setPriceKey({ key: null }), { saved: false, note: null });
  assert.equal((await one.getRelay({})).priceKey, false);
});

test("with a saved key the index is Artificial Analysis's; when it refuses the key, OpenRouter's with a note, and the key never goes to OpenRouter", async () => {
  const records = new Map<string, unknown>([['relay/aa-key', KEY]]), headers: { url: string; key: string | null }[] = [];
  const model = (providerID: string, id: string, name: string) => ({ providerID, id, name, enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } });
  let aaStatus = 200, handlers: any;
  const fetcher = (async (url: string, init?: RequestInit) => {
    headers.push({ url, key: new Headers(init?.headers).get('x-api-key') });
    if (url.startsWith(AA_LIST_URL)) return new Response(JSON.stringify(aaPage([{ slug: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (Max)', creator: 'Anthropic', index: 50 }, { slug: 'glm-5-3', name: 'GLM-5.3', creator: 'Z AI', index: 30 }])), { status: aaStatus });
    return new Response(JSON.stringify({ data: [{ id: 'z-ai/glm-5.3', benchmarks: { artificial_analysis: { intelligence_index: 61 } } }] }));
  }) as unknown as typeof fetch;
  await registerRpc({
    location: { directory: '/repo' },
    storage: { async get(key: string) { return structuredClone(records.get(key)); }, async set(key: string, value: unknown) { records.set(key, structuredClone(value)); }, async remove(key: string) { records.delete(key); } },
    model: { async list(input: { types?: string[] }) { return { data: input.types?.[0] === 'decision' ? [] : [model('claude-agent', 'sonnet', 'Sonnet'), model('ollama-cloud', 'glm-5.3', 'GLM-5.3'), model('local', 'llama', 'Llama Local')] }; } },
    rpc: { async register(_definition: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } },
  } as never, { fetcher, now: () => Date.parse('2026-11-19T08:00:00Z') });
  const fromAa = await handlers.listIntelligence({});
  assert.deepEqual([fromAa.source, fromAa.note, fromAa.scores], [AA_SOURCE, null, [{ providerID: 'claude-agent', id: 'sonnet', index: 50, matched: 'claude-sonnet-5-5' }, { providerID: 'ollama-cloud', id: 'glm-5.3', index: 30, matched: 'glm-5-3' }]]);
  assert.deepEqual(fits(RelayRpc.methods.listIntelligence.output, fromAa), []);
  records.delete('relay/aa-models'); aaStatus = 401;
  const fallback = await handlers.listIntelligence({});
  assert.deepEqual([fallback.source.includes('OpenRouter'), fallback.note, fallback.scores.map((score: { id: string; index: number }) => [score.id, score.index])], [true, 'could not load the list from Artificial Analysis: the key was refused', [['glm-5.3', 61]]]);
  assert.deepEqual(headers.filter(asked => !asked.url.startsWith(AA_LIST_URL)).map(asked => asked.key), [null], 'OpenRouter is asked without the key');
  assert.equal(headers.filter(asked => asked.url.startsWith(AA_LIST_URL)).every(asked => asked.key === KEY), true);
});
