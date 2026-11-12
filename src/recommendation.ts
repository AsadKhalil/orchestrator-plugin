import { authorizeScores } from './benchmarks.js';
import type { CatalogSnapshot, ExclusionReason, InventoryModel, Quality, Workload } from './catalog.js';
import { recommend } from './policy.js';
import { requestCeiling, SpendDenied } from './spending.js';
import { resolveRate } from './catalog.js';
import type { RouteRef } from './types.js';

type PolicyArg = Parameters<typeof recommend>[1];
const DAY_MS = 86_400_000;
const PRICE_SOURCES = ['official', 'catalog', 'provider_reported', 'user_entered'];
const defaultReasoning = { variantID: null, effort: null, thinkingMode: null, thinkingBudgetTokens: null };
const routeKey = (ref: RouteRef) => JSON.stringify([ref.providerID, ref.id, ref.variant]);

export type RecommendationInput = {
  role: PolicyArg['role']; selected: readonly RouteRef[]; minimumScore: number; indexVersion: string;
  /** Scores the user entered or is authorized to use; an Artificial Analysis source without recorded permission is refused. */
  scores: readonly Quality[]; workload: Workload; remainingBudget: string; maxOutputTokens: number;
  /** Vendors that already contributed to the run; only meaningful for the reviewer. */
  excludedVendors: readonly string[]; needs: { image: boolean; tools: boolean }; now: string; maxRateAgeDays?: number;
};

/**
 * Ranks the user's selected, rated routes for one role by estimated cost (ties: higher score). Nothing is guessed: a route with a
 * stale, conditional, partial or non-metered rate, or without an exactly matching score, is listed as excluded with its reasons.
 * The default variant is matched against a score only if that score states it was tested at the default configuration.
 */
export function recommendRoutes(snapshot: CatalogSnapshot, inventory: readonly InventoryModel[], input: RecommendationInput) {
  const authorized = authorizeScores(input.scores);
  if (!authorized.ok) throw new Error(authorized.reason);
  const asOf = new Date(Date.parse(input.now)).toISOString(), maxAge = input.maxRateAgeDays ?? 7; // the ranking itself refuses price evidence older than 7 days, so a longer window here would only mislabel the reason
  const rateReasons = new Map<string, ExclusionReason>();
  // Only the user's selection for this role is ranked; the rest of the host catalogue is not an exclusion worth listing.
  const candidates = snapshot.candidates.filter(item => input.selected.some(ref => routeKey(ref) === routeKey(item))).map(item => {
    const model = inventory.find(entry => entry.providerID === item.providerID && entry.id === item.id);
    const priced = resolveRate(item, input.workload, asOf, { maxEvidenceAgeDays: maxAge });
    if (!priced.ok) rateReasons.set(routeKey(item), priced.reason);
    let reservationGross: string | null = null;
    try { reservationGross = requestCeiling(item.rate, item.limit, input.maxOutputTokens).amount; } catch (error) { if (!(error instanceof SpendDenied)) throw error; }
    const checked = Date.parse(item.rate.evidence.checkedAt);
    const quotedAt = Number.isNaN(checked) ? null : new Date(checked).toISOString();
    return {
      providerID: item.providerID, id: item.id, variant: item.variant, vendor: item.vendor, enabled: model?.enabled === true && model.status !== 'deprecated',
      input: model?.capabilities?.input ? [...model.capabilities.input] : ['text'], tools: model?.capabilities?.tools === true,
      context: item.limit.context, output: item.limit.output, latencyMode: item.rate.interactive ? 'interactive' as const : 'batch' as const,
      canonicalID: item.canonicalID, modelVersion: item.modelVersion, reasoning: item.reasoning ?? defaultReasoning,
      estimatedCash: priced.ok ? priced.usd : null, reservationGross,
      priceEvidence: quotedAt === null ? null : { providerID: item.providerID, id: item.id, variant: item.variant, source: item.rate.evidence.kind, quotedAt, validUntil: new Date(checked + maxAge * DAY_MS).toISOString(), upperBound: true },
      priceVerified: item.rate.evidence.verified,
    };
  });
  const result = recommend(candidates, {
    role: input.role, selected: input.selected, minimumScore: input.minimumScore, indexVersion: input.indexVersion,
    authorizedSources: [...new Set(authorized.scores.map(score => score.source))], excludedVendors: input.excludedVendors,
    remainingBudget: input.remainingBudget, asOf, authorizedPriceSources: PRICE_SOURCES,
    needs: { image: input.needs.image, tools: input.needs.tools, context: input.workload.inputTokens, output: Math.min(input.workload.outputTokens, input.maxOutputTokens), latencyMode: 'interactive' },
  }, authorized.scores);
  const excluded = [...result.excluded.map(item => ({ ...item, reasons: [...item.reasons, ...(rateReasons.has(routeKey(item)) ? [`rate_${rateReasons.get(routeKey(item))}`] : [])] })),
    ...snapshot.excluded.filter(item => input.selected.some(ref => routeKey(ref) === routeKey(item))).map(item => ({ providerID: item.providerID, id: item.id, variant: item.variant, reasons: [item.reason] }))];
  return { snapshotID: snapshot.id, selected: result.selected, alternatives: result.alternatives, excluded };
}
