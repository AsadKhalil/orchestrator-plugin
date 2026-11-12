import { parseUsd } from './costs.js';
import { joinQuality, type Quality, type Reasoning } from './catalog.js';
import { getSelections } from './settings.js';
import { listProjectModels } from './inventory.js';
import type { Plugin } from '@opencode/plugin';

type Ref = { providerID: string; id: string; variant: string | null };
type Candidate = Ref & {
  vendor: string | null; enabled: boolean; input: readonly string[]; tools: boolean;
  context: number; output: number; latencyMode: 'interactive' | 'batch';
  canonicalID: string; modelVersion: string; reasoning: Reasoning | null;
  estimatedCash: string | null; reservationGross: string | null;
  priceEvidence: { providerID: string; id: string; variant: string | null; source: string; quotedAt: string; validUntil: string; upperBound: boolean } | null;
};
type Policy = {
  role: 'planner' | 'coder' | 'reviewer'; selected: readonly Ref[]; minimumScore: number;
  indexVersion: string; authorizedSources: readonly string[]; excludedVendors: readonly string[];
  remainingBudget: string; asOf: string; authorizedPriceSources: readonly string[];
  needs: { image: boolean; tools: boolean; context: number; output: number; latencyMode: 'interactive' | 'batch' };
};

/** Source authorization and evidence provenance must be verified before use with real data. */
export function recommend<T extends Candidate>(candidates: readonly T[], policy: Policy, scores: readonly Quality[]) {
  if (!Number.isFinite(policy.minimumScore) || policy.minimumScore < 0 || !policy.indexVersion.trim()
    || !Number.isSafeInteger(policy.needs.context) || policy.needs.context < 0
    || !Number.isSafeInteger(policy.needs.output) || policy.needs.output < 0) throw new Error('Invalid selection policy');
  const now = Date.parse(policy.asOf);
  if (!Number.isFinite(now) || new Date(now).toISOString() !== policy.asOf || !Array.isArray(policy.authorizedPriceSources)) throw new Error('Invalid price policy');
  const budget = parseUsd(policy.remainingBudget);
  type Matched = T & { quality: Quality | null; qualityReason: 'ambiguous' | 'unmatched' | null };
  const eligible: { candidate: Matched; cash: bigint }[] = [];
  const excluded: { id: string; providerID: string; variant: string | null; reasons: string[] }[] = [];
  for (const candidate of joinQuality(candidates, scores, policy.indexVersion)) {
    const reasons: string[] = [];
    if (!policy.selected.some(ref => ref.id === candidate.id && ref.providerID === candidate.providerID && ref.variant === candidate.variant)) reasons.push('not_selected');
    if (candidate.enabled !== true) reasons.push('unavailable');
    if (!candidate.reasoning || candidate.variant !== candidate.reasoning.variantID) reasons.push('variant_mismatch');
    if (policy.needs.image && !candidate.input?.includes('image')) reasons.push('image_required');
    if (policy.needs.tools && candidate.tools !== true) reasons.push('tools_required');
    if (!Number.isSafeInteger(candidate.context) || candidate.context < policy.needs.context || !Number.isSafeInteger(candidate.output) || candidate.output < policy.needs.output) reasons.push('limits');
    if (candidate.latencyMode !== policy.needs.latencyMode) reasons.push('latency_mode');
    if (policy.role === 'reviewer' && (!candidate.vendor || policy.excludedVendors.includes(candidate.vendor))) reasons.push('vendor_conflict');
    const q = candidate.quality;
    if (!q || typeof q.value !== 'number' || !Number.isFinite(q.value) || q.value < 0 || q.indexVersion !== policy.indexVersion || !policy.authorizedSources.includes(q.source)) reasons.push('quality_unknown');
    else if (q.value < policy.minimumScore) reasons.push('quality_below_floor');
    const price = candidate.priceEvidence;
    const quoted = price ? Date.parse(price.quotedAt) : NaN, expires = price ? Date.parse(price.validUntil) : NaN;
    if (!price || price.providerID !== candidate.providerID || price.id !== candidate.id || price.variant !== candidate.variant || !policy.authorizedPriceSources.includes(price.source) || price.upperBound !== true || !Number.isFinite(quoted) || !Number.isFinite(expires) || new Date(quoted).toISOString() !== price.quotedAt || new Date(expires).toISOString() !== price.validUntil || quoted > now || now - quoted > 7 * 24 * 60 * 60 * 1000 || expires <= now || expires <= quoted) reasons.push('price_evidence_unavailable');
    let cash: bigint | undefined;
    try {
      if (candidate.estimatedCash === null || candidate.reservationGross === null) throw new Error('Unknown cost');
      cash = parseUsd(candidate.estimatedCash);
      const gross = parseUsd(candidate.reservationGross);
      if (cash > gross) reasons.push('inconsistent_cost');
      if (gross > budget) reasons.push('budget');
    } catch { reasons.push('cost_unknown'); }
    if (reasons.length || cash === undefined) excluded.push({ id: candidate.id, providerID: candidate.providerID, variant: candidate.variant, reasons });
    else eligible.push({ candidate, cash });
  }
  eligible.sort((a, b) => a.cash < b.cash ? -1 : a.cash > b.cash ? 1 :
    (b.candidate.quality!.value! - a.candidate.quality!.value!) ||
    a.candidate.providerID.localeCompare(b.candidate.providerID) || a.candidate.id.localeCompare(b.candidate.id) ||
    (a.candidate.variant ?? '').localeCompare(b.candidate.variant ?? ''));
  return { selected: eligible[0]?.candidate ?? null, alternatives: eligible.map(x => x.candidate), excluded };
}

/** Uses the saved role allowlist and fresh host inventory; price and benchmark provenance still require verification. */
export async function recommendForProject<T extends Candidate>(context: Pick<Plugin.Context, 'storage' | 'location' | 'model'>, candidates: readonly T[], policy: Omit<Policy, 'selected'>, scores: readonly Quality[]) {
  const [settings, inventory] = await Promise.all([getSelections(context.storage, context.location.directory), listProjectModels(context)]);
  const current = candidates.map(candidate => {
    const model = inventory.find(m => m.providerID === candidate.providerID && m.id === candidate.id);
    const available = !!model && model.enabled && model.status !== 'deprecated' && (candidate.variant === null || model.variants.includes(candidate.variant));
    return { ...candidate, enabled: candidate.enabled && available,
      input: candidate.input.filter(input => model?.capabilities.input.includes(input)),
      tools: candidate.tools && !!model?.capabilities.tools,
      context: Math.min(candidate.context, model?.limit.context ?? 0), output: Math.min(candidate.output, model?.limit.output ?? 0) };
  });
  return { ...recommend(current, { ...policy, selected: settings.roles[policy.role] }, scores), selectionRevision: settings.revision };
}
