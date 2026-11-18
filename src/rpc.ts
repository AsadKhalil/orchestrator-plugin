import { RelayRpc } from './contract.js';
export { RelayRpc } from './contract.js';
import type { Plugin } from '@opencode/plugin';
import { listProjectModels } from './inventory.js';
import { getRelaySettings, saveRelaySettings, recentDecisions, modelName, chatSwitch, setChatSwitch, type RelaySettings, type RelayStore } from './relay-store.js';
import { checksStatus, describeError, linesFor, route } from './router.js';
import { decide } from './decider.js';
import { INDEX_SOURCE, indexFor, loadIndexTable } from './intelligence.js';

const chatID = (input: unknown) => { const id = (input as { sessionID: string }).sessionID.trim(); if (!id) throw new Error('Name the chat'); return id; };

/** The panel's and the pill's calls. Relay's settings are one set for every project; only the model lists come from this project's host. */
export function registerRpc(context: Pick<Plugin.Context, 'rpc' | 'location' | 'model' | 'storage' | 'experimental'>, options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const relayStore = context.storage as unknown as RelayStore;
  // One fetch of the index at a time, shared by the calls that arrive while it runs.
  let indexLoad: ReturnType<typeof loadIndexTable> | undefined;
  const indexTable = () => indexLoad ??= loadIndexTable(context.storage as never, options.fetcher ?? fetch, (options.now ?? Date.now)()).finally(() => { indexLoad = undefined; });
  const relayView = async (settings: RelaySettings, chat: Awaited<ReturnType<typeof listProjectModels>>, deciders: Awaited<ReturnType<typeof listProjectModels>>) => ({ directory: context.location.directory, settings, decisions: await recentDecisions(relayStore), deciders, checks: checksStatus(settings, chat) });
  return context.rpc.register(RelayRpc, guarded({
    listModels: async () => ({ directory: context.location.directory, models: await listProjectModels(context) }),
    listIntelligence: async () => {
      const [found, chat, deciders] = await Promise.all([indexTable(), listProjectModels(context), listProjectModels(context, 'decision')]);
      const seen = new Set<string>();
      const scores = [...chat, ...deciders].flatMap(model => {
        const key = `${model.providerID}/${model.id}`, hit = seen.has(key) ? null : indexFor(model, found.table);
        seen.add(key);
        return hit ? [{ providerID: model.providerID, id: model.id, index: hit.index, matched: hit.matched }] : [];
      });
      return { directory: context.location.directory, source: INDEX_SOURCE, fetchedAt: found.fetchedAt, note: found.note, scores };
    },
    getRelay: async () => {
      const [settings, chat, deciders] = await Promise.all([getRelaySettings(relayStore), listProjectModels(context), listProjectModels(context, 'decision')]);
      return relayView(settings, chat, deciders);
    },
    saveRelay: async input => {
      const { revision, ...next } = input as { revision: number; modes: unknown; decider: unknown };
      const [chat, deciders] = await Promise.all([listProjectModels(context), listProjectModels(context, 'decision')]);
      return relayView(await saveRelaySettings(relayStore, revision, next, chat, deciders), chat, deciders);
    },
    // The pill: one chat's switch, that chat's newest record, and whether Relay can switch anything at all.
    getRelayChat: async input => {
      const sessionID = chatID(input);
      const [on, decisions, settings] = await Promise.all([chatSwitch(relayStore, sessionID), recentDecisions(relayStore), getRelaySettings(relayStore)]);
      return { on, last: decisions.find(item => item.sessionID === sessionID) ?? null, decider: settings.decider !== null };
    },
    getRelayDecisions: async () => ({ directory: context.location.directory, decisions: await recentDecisions(relayStore) }),
    setRelayChat: async input => {
      const sessionID = chatID(input), on = (input as { on: boolean }).on;
      await setChatSwitch(relayStore, sessionID, on);
      return { on };
    },
    testDecider: async input => {
      const text = (input as { text: string }).text;
      if (!text.trim()) throw new Error('Type a sample message');
      const [settings, models] = await Promise.all([getRelaySettings(relayStore), listProjectModels(context)]);
      // The same path as /relay with nothing attached and no chat: the lines asked about and the pick come from the router.
      const attachment = { needsImage: false, tokens: 0 };
      const answer = await decide({ decisions: request => context.experimental.generate.decisions(request as never) }, settings.decider, { kind: 'chat', text, agent: null, files: [], images: 0, lines: linesFor(settings, models, attachment) });
      const result = route(answer, settings, models, attachment, null);
      return { directory: context.location.directory, mode: result.mode, confidence: answer.kind === 'answer' ? answer.confidence : null, model: result.switch ? modelName(result.model) : null, fit: result.switch ? result.fit : null, ms: answer.ms, costUsd: answer.kind === 'answer' ? answer.costUsd : null, note: result.note };
    },
  }));
}

type Call = { error: (type: 'rejected', message: string, data: unknown) => unknown };
/** A handler that throws reaches the client as "RPC call failed" in the real host; return its message as the declared 'rejected' error so the panel can show it. */
function guarded<H>(handlers: H): H {
  return Object.fromEntries(Object.entries(handlers as Record<string, (input: unknown, call: Call) => Promise<unknown>>).map(([name, handler]) => [name, async (input: unknown, call: Call) => {
    try { return await handler(input, call); } catch (error) { return call.error('rejected', describeError(error, 'The request failed.').slice(0, 500), {}); }
  }])) as H;
}
