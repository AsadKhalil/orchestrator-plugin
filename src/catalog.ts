import { createHash } from 'node:crypto';
import { formatUsd, parseUsd } from './costs.js';
import type { Route } from './settings.js';
import type { RateCard, RouteRef } from './types.js';

export type Reasoning = {
  variantID: string | null;
  effort: string | null;
  thinkingMode: string | null;
  thinkingBudgetTokens: number | null;
};
type Identity = { canonicalID: string; modelVersion: string };
type Candidate = Identity & { reasoning: Reasoning | null };
export type Quality = Identity & {
  testedReasoning: Reasoning | null;
  indexVersion: string | null;
  value: number | null;
  source: string;
};

function validReasoning(value: Reasoning | null): value is Reasoning {
  if (!value || typeof value !== 'object') return false;
  const isOptionalText = (v: unknown) => v === null || (typeof v === 'string' && v.trim().length > 0);
  return isOptionalText(value.variantID) && isOptionalText(value.effort) && isOptionalText(value.thinkingMode)
    && (value.thinkingBudgetTokens === null || (Number.isSafeInteger(value.thinkingBudgetTokens) && value.thinkingBudgetTokens >= 0));
}

function sameReasoning(a: Reasoning | null, b: Reasoning | null): boolean {
  return validReasoning(a) && validReasoning(b) && a.variantID === b.variantID && a.effort === b.effort
    && a.thinkingMode === b.thinkingMode && a.thinkingBudgetTokens === b.thinkingBudgetTokens;
}

/** Exact matches only. The caller must independently authorize and verify the score source. */
export function joinQuality<T extends Candidate>(candidates: readonly T[], scores: readonly Quality[], indexVersion: string) {
  if (!indexVersion.trim()) throw new Error('Benchmark version is required');
  return candidates.map(candidate => {
    const matches = scores.filter(score =>
      candidate.canonicalID.length > 0 && candidate.modelVersion.length > 0 &&
      score.canonicalID === candidate.canonicalID && score.modelVersion === candidate.modelVersion &&
      score.indexVersion === indexVersion && typeof score.source === 'string' && score.source.trim().length > 0 &&
      typeof score.value === 'number' && Number.isFinite(score.value) && score.value >= 0 &&
      sameReasoning(candidate.reasoning, score.testedReasoning));
    return { ...candidate, quality: matches.length === 1 ? matches[0] : null,
      qualityReason: matches.length > 1 ? 'ambiguous' as const : matches.length === 0 ? 'unmatched' as const : null };
  });
}

export type ExclusionReason = 'no_rate_recorded' | 'unavailable' | 'billing_unbounded' | 'rate_conditions' | 'rate_stale' | 'rate_incomplete';
/** The `listProjectModels` shape; `name` and `capabilities` are accepted but not read here. */
export type InventoryModel = {
  providerID: string; id: string; enabled: boolean; status: string; variants: readonly string[];
  limit: { context: number; output: number };
  name?: string; capabilities?: { input: readonly string[]; output: readonly string[]; tools: boolean };
};
/** One runnable route: a host model/variant that the policy has a recorded rate for. */
export type CatalogCandidate = RouteRef & {
  vendor: string; canonicalID: string; modelVersion: string; rate: RateCard;
  limit: { context: number; output: number }; reasoning: Reasoning | null;
};
export type CatalogSnapshot = {
  id: string; createdAt: string; candidates: CatalogCandidate[]; warnings: string[];
  excluded: { providerID: string; id: string; variant: string | null; reason: ExclusionReason }[];
};

const routeKey = (providerID: string, id: string, variant: string | null) => JSON.stringify([providerID, id, variant]);
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Plain code-unit order (locale-independent), with the default variant before the named ones. */
const byRoute = (a: RouteRef, b: RouteRef) =>
  byKey(JSON.stringify([a.providerID, a.id, a.variant !== null, a.variant]), JSON.stringify([b.providerID, b.id, b.variant !== null, b.variant]));
/** JSON with object keys sorted, so equal values always hash equally. */
const canonical = (value: unknown) => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => byKey(a, b))) : v);

/**
 * Joins the host's runnable models with the policy's recorded rates by exact (provider, model, variant).
 * A route the host does not offer is a warning, never a candidate; a host route with no recorded rate is excluded, never guessed.
 */
export async function loadCatalog(host: { listModels(): Promise<readonly InventoryModel[]> }, policy: { routes: readonly Route[] }, now: string): Promise<CatalogSnapshot> {
  const routes = new Map(policy.routes.map(r => [routeKey(r.providerID, r.id, r.variant), r]));
  const hostRoutes = new Set<string>();
  const hostModels = new Set<string>();
  const candidates: CatalogCandidate[] = [];
  const excluded: CatalogSnapshot['excluded'] = [];
  for (const model of await host.listModels()) {
    hostModels.add(JSON.stringify([model.providerID, model.id]));
    for (const variant of [null, ...new Set(model.variants)]) {
      const key = routeKey(model.providerID, model.id, variant);
      if (hostRoutes.has(key)) continue;
      hostRoutes.add(key);
      const route = routes.get(key);
      if (!model.enabled || model.status === 'deprecated') { excluded.push({ providerID: model.providerID, id: model.id, variant, reason: 'unavailable' }); continue; }
      if (!route) { excluded.push({ providerID: model.providerID, id: model.id, variant, reason: 'no_rate_recorded' }); continue; }
      candidates.push({
        providerID: model.providerID, id: model.id, variant, vendor: route.vendor, canonicalID: route.canonicalID, modelVersion: route.modelVersion,
        rate: structuredClone(route.rate), limit: { context: model.limit.context, output: model.limit.output },
        reasoning: variant === null ? null : { variantID: variant, effort: null, thinkingMode: null, thinkingBudgetTokens: null },
      });
    }
  }
  const warnings = policy.routes.filter(r => !hostRoutes.has(routeKey(r.providerID, r.id, r.variant)))
    .map(r => `route_without_host_model:${r.providerID}/${r.id}${hostModels.has(JSON.stringify([r.providerID, r.id])) ? `#${r.variant}` : ''}`).sort(byKey);
  candidates.sort(byRoute);
  excluded.sort(byRoute);
  return { id: createHash('sha256').update(canonical(candidates)).digest('hex'), createdAt: now, candidates, warnings, excluded };
}

export type Workload = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
export type RateResult = { ok: true; usd: string; rate: RateCard; basis: string[] } | { ok: false; reason: ExclusionReason };

const DAY_MS = 86_400_000;
const MILLION = 1_000_000n;
// Date-only values are UTC; date-times must carry an offset so the instant is unambiguous.
const ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

function tokens(value: number | undefined): bigint {
  if (value === undefined) return 0n;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid workload');
  return BigInt(value);
}

/** Prices a workload at the candidate's recorded rate, rounding the total up to the 12th decimal; excludes rather than guesses. */
export function resolveRate(candidate: CatalogCandidate, workload: Workload, now: string, options: { maxEvidenceAgeDays?: number } = {}): RateResult {
  const input = tokens(workload.inputTokens), output = tokens(workload.outputTokens);
  const cacheRead = tokens(workload.cacheReadTokens), cacheWrite = tokens(workload.cacheWriteTokens);
  const maxAgeDays = options.maxEvidenceAgeDays ?? 45;
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new Error('Invalid evidence age limit');
  const nowMs = Date.parse(now);
  if (!ISO.test(now) || Number.isNaN(nowMs)) throw new Error('Invalid time');
  const rate = candidate.rate;
  if (rate.billing !== 'metered_api') return { ok: false, reason: 'billing_unbounded' };
  if (rate.conditions.length > 0) return { ok: false, reason: 'rate_conditions' };
  const checkedMs = ISO.test(rate.evidence.checkedAt) ? Date.parse(rate.evidence.checkedAt) : NaN;
  if (Number.isNaN(checkedMs) || checkedMs > nowMs || nowMs - checkedMs > maxAgeDays * DAY_MS) return { ok: false, reason: 'rate_stale' };
  if ((cacheRead > 0n && rate.cacheReadPerMillion === null) || (cacheWrite > 0n && rate.cacheWritePerMillion === null)) return { ok: false, reason: 'rate_incomplete' };
  let units: bigint;
  try {
    units = input * parseUsd(rate.inputPerMillion) + output * parseUsd(rate.outputPerMillion)
      + cacheRead * (rate.cacheReadPerMillion === null ? 0n : parseUsd(rate.cacheReadPerMillion))
      + cacheWrite * (rate.cacheWritePerMillion === null ? 0n : parseUsd(rate.cacheWritePerMillion));
  } catch { return { ok: false, reason: 'rate_incomplete' }; }
  return {
    ok: true, usd: formatUsd((units + MILLION - 1n) / MILLION), rate,
    basis: [`evidence:${rate.evidence.kind}`, `verified:${rate.evidence.verified}`, `checkedAt:${rate.evidence.checkedAt}`, `source:${rate.evidence.sourceURL}`, `serviceTier:${rate.serviceTier}`],
  };
}
