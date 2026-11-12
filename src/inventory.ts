import type { Plugin } from '@opencode/plugin';

/** Project host records can contain credentials; return only explicit display fields. */
export async function listProjectModels(context: Pick<Plugin.Context, 'location' | 'model'>) {
  const result = await context.model.list({ location: { directory: context.location.directory } });
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
  }));
}
