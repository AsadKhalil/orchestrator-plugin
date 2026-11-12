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
