import type { Quality } from './catalog.js';

/**
 * Where quality scores may come from. Artificial Analysis data is only for the user's own key and internal use; nothing built on
 * it may drive a public recommendation until the owner records written permission. Scores the user enters themselves are always fine.
 */
export type BenchmarkPermission = { artificialAnalysis: boolean };
export const noPermission: BenchmarkPermission = { artificialAnalysis: false };

const isArtificialAnalysis = (source: string) => /artificial[\s_-]*analysis/i.test(source);

export function authorizeScores(scores: readonly Quality[], permission: BenchmarkPermission = noPermission):
  { ok: true; scores: readonly Quality[] } | { ok: false; reason: 'benchmark_source_not_authorized' } {
  if (!permission.artificialAnalysis && scores.some(score => isArtificialAnalysis(score.source))) return { ok: false, reason: 'benchmark_source_not_authorized' };
  return { ok: true, scores };
}
