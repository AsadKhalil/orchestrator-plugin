// The checks every model choice goes through: well formed, not listed twice, and offered by the host now.

export type ModelChoice = { providerID: string; id: string; variant: string | null };
export type OfferedModel = { providerID: string; id: string; enabled: boolean; status: string; variants: readonly string[] };
const id = (choice: ModelChoice) => JSON.stringify([choice.providerID, choice.id, choice.variant]);

/** One list of model choices: every entry well formed, and none twice. */
export function validateChoices(value: unknown): ModelChoice[] {
  if (!Array.isArray(value)) throw new Error('Invalid role choices');
  const seen = new Set<string>();
  for (const choice of value) {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).sort().join(',') !== 'id,providerID,variant' || typeof choice.providerID !== 'string' || !choice.providerID.trim() || typeof choice.id !== 'string' || !choice.id.trim() || !(choice.variant === null || (typeof choice.variant === 'string' && choice.variant.trim()))) throw new Error('Invalid model choice');
    const identity = id(choice); if (seen.has(identity)) throw new Error('Duplicate model choice'); seen.add(identity);
  }
  return structuredClone(value);
}
/** The listed model a choice points at, when it can be used now: listed, enabled, not deprecated, and offering the chosen variant. */
export function offered<M extends OfferedModel>(models: readonly M[], choice: ModelChoice): M | undefined {
  const model = models.find(m => m.providerID === choice.providerID && m.id === choice.id);
  return model && model.enabled && model.status !== 'deprecated' && (choice.variant === null || model.variants.includes(choice.variant)) ? model : undefined;
}
