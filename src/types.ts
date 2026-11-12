/** Domain types shared by the policy, spending, workflow and delivery modules. Host-specific types stay in host.ts. */

export type Role = 'planner' | 'coder' | 'reviewer';
/** A nonnegative decimal USD amount, parsed with `parseUsd` (12 decimal places); never a float. */
export type Usd = string;
export type ModelRef = { providerID: string; id: string; variant?: string };
/** A model route exactly as the user selects it; `variant` null means the default reasoning configuration. */
export type RouteRef = { providerID: string; id: string; variant: string | null };

export type Evidence = { sourceURL: string; checkedAt: string; kind: 'official' | 'catalog' | 'provider_reported' | 'user_entered'; verified: boolean };
export type BillingRoute = 'metered_api' | 'subscription' | 'local';

/** Per-million-token rates for one route. Conditions (long context, time of day, batch) are kept as text, never silently merged. */
export type RateCard = {
  inputPerMillion: Usd; outputPerMillion: Usd; cacheReadPerMillion: Usd | null; cacheWritePerMillion: Usd | null;
  billing: BillingRoute; serviceTier: string; interactive: boolean; conditions: string[]; evidence: Evidence;
};

/**
 * One billed (or possibly billed) model request. `aggregateUsage` consumes the first group of fields; the rest let reports
 * attribute spend to a run and a stage. Unknown amounts and counts are null, never zero.
 */
export type UsageRecord = {
  attemptID: string; revision: number; startedAt: string;
  grossUsd: Usd | null; creditUsd: Usd | null; cashUsd: Usd | null; provenance: 'estimated' | 'provider_reported';
  providerID: string; modelID: string; effort: string | null; role: string; projectID: string;
  runID: string; stage: string; sessionID: string; messageID: string | null;
  inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null;
  /** Total billed output; true when `reasoningTokens` are already inside `outputTokens` so they are never added twice. */
  billedOutputTokens: number | null; reasoningIncludedInOutput: boolean | null;
  serviceTier: string | null; billing: BillingRoute;
};

/** Where completed work goes. The default is a local export; a GitHub destination must be explicitly authorized per project. */
export type Destination =
  | { kind: 'local'; directory: string }
  | { kind: 'github'; remote: string; remoteURL: string; baseBranch: string; branchPrefix: string };
