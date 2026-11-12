import { randomUUID } from 'node:crypto';
import { estimateTokenCost, formatUsd, parseUsd } from './costs.js';
import type { Route } from './settings.js';
import type { RateCard } from './types.js';

type Maybe<T> = T | Promise<T>;
export type Role = 'planner' | 'coder' | 'reviewer' | 'unknown';
export type ModelLimit = { context: number; output: number };
export type SpendLedger = { reserve(request: { attemptID: string; runID: string; amount: string }): Maybe<'created' | 'existing'> };
export type RequestEvent = { sessionID: string; kind: 'primary' | 'compaction' | 'title' | 'generate'; model: { providerID: string; id: string; variant?: string | null } };

/** A request was refused before dispatch. `code` is stable for UI and tests; the message is safe to show. */
export class SpendDenied extends Error {
  constructor(readonly code: string, message: string) { super(`Feature Pilot spending controls: ${message}`); this.name = 'SpendDenied'; }
}

/**
 * Worst-case price of one request, reserved before dispatch. The host hook carries no token counts, so every bound is a ceiling:
 * the whole context window as input at the dearest input-side rate (a cache miss, or a cache write when that costs more) plus the
 * model's full output limit, which already covers billed reasoning. The user's output allowance (`maxOutputTokens`) is NOT used here:
 * nothing sets it as the request's output cap, so reserving only that much could under-reserve. It remains the basis for estimates. Rates with unmodelled conditions or non-metered billing cannot be bounded.
 */
export function requestCeiling(rate: RateCard, limit: ModelLimit, maxOutputTokens: number): { amount: string; inputTokens: number; outputTokens: number } {
  if (rate.billing !== 'metered_api') throw new SpendDenied('billing_unbounded', 'This route is not metered API billing, so a dollar budget cannot bound it');
  if (rate.conditions.length > 0) throw new SpendDenied('rate_conditions', 'This rate has conditions the budget cannot bound (long context, tiers, batch)');
  if (![limit.context, limit.output, maxOutputTokens].every(n => Number.isSafeInteger(n) && n > 0)) throw new SpendDenied('limit_unknown', 'Model token limits are unknown');
  const outputTokens = limit.output, inputTokens = limit.context;
  const plain = parseUsd(rate.inputPerMillion), write = rate.cacheWritePerMillion === null ? 0n : parseUsd(rate.cacheWritePerMillion);
  const amount = estimateTokenCost({ inputTokens, billedOutputTokens: outputTokens, inputRatePerMillion: formatUsd(write > plain ? write : plain), outputRatePerMillion: rate.outputPerMillion });
  return { amount, inputTokens, outputTokens };
}

export type GuardDeps = {
  roleFor(sessionID: string): Promise<Role | null>;
  runFor(sessionID: string): Promise<string | null>;
  routes(): Promise<{ maxOutputTokens: number; routes: readonly Route[] }>;
  limitFor(model: RequestEvent['model']): Promise<ModelLimit | null>;
  /** Whether the user selected this exact route for the role. */
  selected(role: Exclude<Role, 'unknown'>, model: RequestEvent['model']): Promise<boolean>;
  /** The authoritative ledger, or null when no atomic one is available (then every owned request is refused). */
  ledger(): SpendLedger | null;
  newID?: () => string;
};

/** The `experimental.model.resolve` handler. Sessions this plugin does not own pass untouched; every owned request reserves or is refused. */
export function createSpendGuard(deps: GuardDeps) {
  return async (event: RequestEvent): Promise<void> => {
    const role = await deps.roleFor(event.sessionID);
    if (role === null) return;
    if (role === 'unknown') throw new SpendDenied('unknown_role', 'Feature Pilot session has no recognised role');
    if (!event.model?.providerID || !event.model.id) throw new SpendDenied('invalid_request', 'The request names no model');
    const runID = await deps.runFor(event.sessionID);
    if (!runID) throw new SpendDenied('unknown_run', 'Feature Pilot session is not attached to a run');
    if (!await deps.selected(role, event.model)) throw new SpendDenied('model_not_selected', 'This model is not selected for the role');
    const ledger = deps.ledger();
    if (!ledger) throw new SpendDenied('ledger_unavailable', 'No atomic budget ledger is available on this host, so paid requests are refused');
    const variant = event.model.variant ?? null, { maxOutputTokens, routes } = await deps.routes();
    const route = routes.find(r => r.providerID === event.model.providerID && r.id === event.model.id && r.variant === variant);
    if (!route) throw new SpendDenied('rate_unknown', 'No rate card is recorded for this model route');
    const limit = await deps.limitFor(event.model);
    if (!limit) throw new SpendDenied('limit_unknown', 'Model token limits are unknown');
    const { amount } = requestCeiling(route.rate, limit, maxOutputTokens);
    try { await ledger.reserve({ attemptID: `${event.sessionID}:${(deps.newID ?? randomUUID)()}`, runID, amount }); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Budget exceeded') throw new SpendDenied('budget_exceeded', 'Not enough budget for the worst case of this request');
      if (message === 'Budget limits are not configured') throw new SpendDenied('budget_unset', 'Set monthly and feature budgets before running');
      throw new SpendDenied('ledger_error', 'The budget ledger could not record this request');
    }
  };
}

/** Cheap pre-check before a paid stage: both budgets must be configured and have something left. The per-request reservation still decides. */
export async function budgetOpen(ledger: { report(runID: string): Promise<{ monthly: unknown; feature: unknown; monthlyUsage: { remainingUsd: string | null }; featureUsage: { remainingUsd: string | null } | null }> } | null, runID: string): Promise<boolean> {
  if (!ledger) return false;
  const report = await ledger.report(runID);
  const left = (usage: { remainingUsd: string | null } | null) => usage?.remainingUsd != null && parseUsd(usage.remainingUsd) > 0n;
  return report.monthly !== null && report.feature !== null && left(report.monthlyUsage) && left(report.featureUsage);
}

/** The `retry` handler: owned sessions get at most `max` retries; the decision can only become stricter. */
export function createRetryGuard(roleFor: GuardDeps['roleFor'], max = 2) {
  return async (event: { sessionID: string; attempt: number; decision: { retry: boolean } }): Promise<void> => {
    if (!event.decision.retry || await roleFor(event.sessionID) === null) return;
    // ponytail: attempt numbering (0- or 1-based) is not documented by the host; refusing at `>= max` allows at most `max` retries either way.
    if (!Number.isSafeInteger(event.attempt) || event.attempt >= max) event.decision = { retry: false } as never;
  };
}
