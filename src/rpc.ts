import { RelayRpc } from './contract.js';
export { RelayRpc } from './contract.js';
import type { Plugin } from '@opencode/plugin';
import { listProjectModels } from './inventory.js';
import { getRelaySettings, saveRelaySettings, recentDecisions, modelName, chatSwitch, setChatSwitch, getUsage, type RelaySettings, type RelayStore } from './relay-store.js';
import { checksStatus, describeError, linesFor, route } from './router.js';
import { decide } from './decider.js';
import { INDEX_SOURCE, indexFor, loadIndexTable } from './intelligence.js';
import { AA_CREDIT, AA_SOURCE, aaFor, getPriceKey, loadAaModels, setPriceKey } from './artificial-analysis.js';

const chatID = (input: unknown) => { const id = (input as { sessionID: string }).sessionID.trim(); if (!id) throw new Error('Name the chat'); return id; };

/** The panel's and the pill's calls. Relay's settings are one set for every project; only the model lists come from this project's host. */
export function registerRpc(context: Pick<Plugin.Context, 'rpc' | 'location' | 'model' | 'storage' | 'experimental'>, options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const relayStore = context.storage as unknown as RelayStore;
  // One fetch of the index at a time, shared by the calls that arrive while it runs.
  let indexLoad: ReturnType<typeof loadIndexTable> | undefined;
  const indexTable = () => indexLoad ??= loadIndexTable(context.storage as never, options.fetcher ?? fetch, (options.now ?? Date.now)()).finally(() => { indexLoad = undefined; });
  // The same for Artificial Analysis's list, which only a saved key may fetch.
  let aaLoad: ReturnType<typeof loadAaModels> | undefined;
  const aaModels = (key: string) => aaLoad ??= loadAaModels(context.storage, key, options.fetcher ?? fetch, (options.now ?? Date.now)()).finally(() => { aaLoad = undefined; });
  const relayView = async (settings: RelaySettings, chat: Awaited<ReturnType<typeof listProjectModels>>, deciders: Awaited<ReturnType<typeof listProjectModels>>) => ({ directory: context.location.directory, settings, decisions: await recentDecisions(relayStore), deciders, checks: checksStatus(settings, chat), priceKey: (await getPriceKey(relayStore)) !== null });
  return context.rpc.register(RelayRpc, guarded({
    listModels: async () => ({ directory: context.location.directory, models: await listProjectModels(context) }),
    // With a saved key the index is Artificial Analysis's own; without one, or when its list cannot be had, OpenRouter's copy of it.
    listIntelligence: async () => {
      const [key, chat, deciders] = await Promise.all([getPriceKey(relayStore), listProjectModels(context), listProjectModels(context, 'decision')]);
      const seen = new Set<string>(), models = [...chat, ...deciders].filter(model => { const name = `${model.providerID}/${model.id}`; return !seen.has(name) && !!seen.add(name); });
      const aa = key ? await aaModels(key) : null;
      if (aa?.models.length) {
        const scores = models.flatMap(model => { const hit = aaFor({ ...model, variant: null }, aa.models); return hit && hit.index !== null ? [{ providerID: model.providerID, id: model.id, index: hit.index, matched: hit.slug }] : []; });
        return { directory: context.location.directory, source: AA_SOURCE, fetchedAt: aa.fetchedAt, note: aa.note, scores };
      }
      const found = await indexTable();
      const scores = models.flatMap(model => { const hit = indexFor(model, found.table); return hit ? [{ providerID: model.providerID, id: model.id, index: hit.index, matched: hit.matched }] : []; });
      return { directory: context.location.directory, source: INDEX_SOURCE, fetchedAt: found.fetchedAt, note: [aa?.note, found.note].filter(Boolean).join('; ') || null, scores };
    },
    // Usage by model, for the panel and /relay-stats. Storage only, so the panel can ask every few seconds.
    getRelayUsage: async () => {
      const [usage, key] = await Promise.all([getUsage(relayStore), getPriceKey(relayStore)]);
      return { directory: context.location.directory, ...usage, credit: key !== null || usage.rows.some(row => row.pricesFrom === 'artificial-analysis') ? AA_CREDIT : null };
    },
    // The key is saved and the list loaded with it at once, so a refused key shows now. The key is never sent back.
    setPriceKey: async input => {
      await setPriceKey(context.storage, (input as { key: string | null }).key);
      const saved = await getPriceKey(relayStore);
      return { saved: saved !== null, note: saved === null ? null : (await aaModels(saved)).note };
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
