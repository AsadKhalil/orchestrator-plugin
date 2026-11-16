import type { Plugin } from '@opencode/plugin';
import { usdString } from './costs.js';

/** USD for one million tokens, as the host lists it. `null` is unknown; `'0'` can mean free or not listed. */
export type ModelCostView = { inputPerMillion: string | null; outputPerMillion: string | null; cacheReadPerMillion: string | null; tiered: boolean };
export type ListedModel = { providerID: string; id: string; name: string; enabled: boolean; status: string; variants: string[]; capabilities: { input: string[]; output: string[]; tools: boolean }; limit: { context: number; output: number }; cost: ModelCostView };

/** The base price is the first entry without a tier, or the first entry when every one has a tier. */
function costView(cost: unknown): ModelCostView {
  const entries = Array.isArray(cost) ? cost as { tier?: unknown; input?: unknown; output?: unknown; cache?: { read?: unknown } }[] : [];
  const base = entries.find(entry => entry?.tier === undefined) ?? entries[0];
  return { inputPerMillion: usdString(base?.input), outputPerMillion: usdString(base?.output), cacheReadPerMillion: usdString(base?.cache?.read), tiered: entries.length > 1 };
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
