import type { Plugin } from '@opencode/plugin';
import { usdString } from './costs.js';

/** The prices that apply once a chat is over `above` tokens. */
export type PriceStep = { above: number; inputPerMillion: string | null; outputPerMillion: string | null; cacheReadPerMillion: string | null; cacheWritePerMillion: string | null };
/** USD for one million tokens, as the host lists it. `null` is unknown; `'0'` can mean free or not listed. `steps` are the prices for longer chats, smallest first. */
export type ModelCostView = Omit<PriceStep, 'above'> & { tiered: boolean; steps: PriceStep[] };
export type ListedModel = { providerID: string; id: string; name: string; enabled: boolean; status: string; variants: string[]; capabilities: { input: string[]; output: string[]; tools: boolean }; limit: { context: number; output: number }; cost: ModelCostView };

/** The base price is the first entry without a tier, or the first entry when every one has a tier. */
type CostEntry = { tier?: { type?: unknown; size?: unknown }; input?: unknown; output?: unknown; cache?: { read?: unknown; write?: unknown } };
const prices = (entry: CostEntry | undefined) => ({ inputPerMillion: usdString(entry?.input), outputPerMillion: usdString(entry?.output), cacheReadPerMillion: usdString(entry?.cache?.read), cacheWritePerMillion: usdString(entry?.cache?.write) });
function costView(cost: unknown): ModelCostView {
  const entries = Array.isArray(cost) ? cost as CostEntry[] : [];
  const base = entries.find(entry => entry?.tier === undefined) ?? entries[0];
  // The host prices a request by the size of its context: the largest step below it, else the base price (2.3.0).
  const steps = entries.flatMap(entry => { const size = entry?.tier?.type === 'context' ? entry.tier.size : null; return typeof size === 'number' && size > 0 ? [{ above: size, ...prices(entry) }] : []; }).sort((a, b) => a.above - b.above);
  return { ...prices(base), tiered: entries.length > 1, steps };
}

/** Project host records can contain credentials; return only explicit display fields. Without a type the host lists chat models. */
export async function listProjectModels(context: Pick<Plugin.Context, 'location' | 'model'>, type?: 'chat' | 'decision'): Promise<ListedModel[]> {
  const result = await context.model.list({ location: { directory: context.location.directory }, ...(type ? { types: [type] } : {}) });
  return result.data.map(model => ({
    providerID: model.providerID,
    id: model.id,
    name: model.name,
    enabled: model.enabled,
    status: model.status,
    variants: model.variants.map(variant => variant.id),
    capabilities: {
      input: [...model.capabilities.input],
      output: [...model.capabilities.output],
      tools: model.capabilities.tools,
    },
    limit: { context: model.limit.context, output: model.limit.output },
    cost: costView(model.cost),
  }));
}
