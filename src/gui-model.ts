/** Pure view-model helpers for the Feature Pilot panel. No framework or host imports, so they run under node:test. */
import type { Route } from './settings.js';

export const autonomousNote = 'Approves its own plan and continues without waiting. Needs monthly and feature budgets with budget left.';
export const coderWarning = 'Turning this on lets the coder role edit files and run shell commands in a separate git worktree. The worktree is not a sandbox: shell commands run with your own account permissions and can reach files outside it. On OpenCode 2.2.7 a broad allow rule can override project deny rules, so only enable this in a disposable project. Off by default.';

// ---- Run states: the driver works in `active` states; the others wait for a person or are finished. ----
const active = ['planning', 'implementing', 'validating', 'reviewing', 'repairing'];
const waiting = ['clarifying', 'awaiting_approval', 'ready_for_acceptance', 'needs_attention'];
const terminal = ['accepted', 'cancelled'];
const labels: Record<string, string> = {
  clarifying: 'Waiting for your answers', planning: 'Planning', awaiting_approval: 'Waiting for plan approval', implementing: 'Implementing', validating: 'Validating',
  reviewing: 'Reviewing', repairing: 'Repairing', ready_for_acceptance: 'Ready for acceptance', accepted: 'Accepted', needs_attention: 'Needs attention', cancelled: 'Cancelled',
};
export const stateLabel = (state: string) => Object.hasOwn(labels, state) ? labels[state] : `Unknown state (${state})`;
export const isTerminal = (state: string) => terminal.includes(state);
export const isWaitingOnUser = (state: string) => waiting.includes(state);
/** Only known working states are polled, so an unrecognised state never causes endless requests. */
export const shouldPoll = (state: string) => active.includes(state);

// ---- Attention ----
const explanations: Record<string, string> = {
  coder_not_enabled: 'Writing code is switched off. Turn on the coder in Spending & permissions (only in a disposable project), then resume.',
  shell_not_enabled: 'Running the validation commands needs the coder switched on in Spending & permissions. Turn it on, then resume.',
  shell_tool_unavailable: 'OpenCode did not offer a shell tool, so the validation commands could not run. Check this OpenCode setup, then resume.',
  no_independent_reviewer: 'No reviewer qualifies. The reviewer must come from a vendor that did not plan or write the code, and its route needs a saved rate. Select such a reviewer and add its route in Spending & permissions, then resume.',
  review_not_permitted: 'The review could not be started: the saved run did not accept the reviewer or the validation result. Check the reviewer selection, then resume.',
  review_limit_reached: 'The reviewer still found blocking problems after the allowed repair rounds. This is final: the run cannot be resumed. You can stop it.',
  review_state_invalid: 'The saved review record is inconsistent. Resume to try again; if it happens again, stop the run.',
  unsupported_step: 'The approved plan contains a command step that this version cannot run, so resuming will stop here again. Stop this run and start a new one.',
  budget_exhausted: 'The monthly or feature budget has no room for the next request. Raise a limit in Budget limits, then resume.',
  budget_unavailable: 'The monthly or feature budget has no room for the next request. Raise a limit in Budget limits, then resume.',
  validation_failed: 'One or more validation commands failed on the changes. Fix the cause (the changes are in the run’s worktree), then resume to validate again.',
  validation_stale: 'The files changed while validation was running, so its result no longer applies. Resume to validate again.',
  validation_unknown: 'Validation did not give a trustworthy result. Resume to try again.',
  validation_timed_out: 'Validation took too long and was stopped. Resume to try again.',
  validation_unavailable: 'Validation could not be run (for example the shell tool or the worktree failed). Check the setup, then resume.',
  stage_failed: 'A model or host step failed, or its result could not be confirmed. One common cause is the spending guard refusing a request because its worst-case price does not fit the monthly or feature limit, in which case nothing was sent: check Budget limits. Nothing is retried automatically. Resuming starts that step again; if the request had already reached the provider it may be charged again.',
  worktree_unavailable: 'The run’s Git worktree could not be created or did not match the baseline commit. Check that the project is a Git repository that still has that commit, then resume.',
  worktree_missing: 'The run’s worktree is missing, so its changes cannot be read or validated. Resume to try again; if it persists, stop the run and start a new one.',
  worktree_changed_since_validation: 'Files in the worktree changed after validation passed, so the pending review no longer matches what was validated. Undo the change in the worktree, or stop the run.',
  diff_too_large_to_review: 'The changes are too large for one review request. Reduce the change in the run’s worktree and resume, or stop the run and start a smaller feature.',
  no_route_for_planner: 'None of your selected planner models has a saved route with a rate. Add a route for one of them in Spending & permissions, then resume.',
  no_route_for_coder: 'None of your selected coder models has a saved route with a rate. Add a route for one of them in Spending & permissions, then resume.',
  no_coder_step: 'The plan has no coding step for the coder to run. Stop the run and start a new one.',
  worktree_link_outside: 'A file in the worktree is a link that leads outside it, so the changes cannot be read safely for review. Remove the link in the worktree, or stop the run.',
  step_dependencies_unmet: 'A plan step depends on earlier work that can no longer be recorded as done on the current files, so it cannot run. Nothing was spent. Stop the run, or amend the plan so each coding step only depends on the step just before it.',
  stop_requested: 'A stop was requested before the next request was sent, so nothing further was sent. The run is being cancelled.',
  run_changed: 'The run changed while a step was being prepared, so nothing was sent. Resume to continue from the current state.',
  coder_shares_reviewer_vendor: 'The selected coder is from the same vendor as the reviewer that already reviewed this run, which would void the independent review. Select a coder from another vendor, then resume.',
  text_file_treated_as_binary: 'A source or configuration file in the changes looks like binary to Git, so the reviewer would not see its content. Fix or remove the file in the run’s worktree, then resume.',
  review_evidence_too_large: 'The changes and their context are too large for one review request. Reduce the change in the run’s worktree and resume, or stop the run.',
  review_not_possible: 'The changes could not be prepared for review (for example the worktree could not be read). Check the run’s worktree, then resume.',
  drive_error: 'The run stopped because of an unexpected error (for example the budget ledger or storage). Check the setup, then resume.',
  planner_turn_active: 'A planning request for this run is still in progress. Wait for it to finish, then resume.',
  planner_session_unresolved: 'The planning session has not finished, or its outcome could not be read, so no second request was sent. Wait a moment, then resume. If the earlier session failed, resuming asks the planner again and may be charged again.',
  coder_turn_unresolved: 'An earlier coding request for this step may still be running, or its outcome could not be read, so no second request was sent (a second one would be charged again). Check the coding session in OpenCode; once it has finished or been stopped there, resume. If it failed, resuming asks the coder again and may be charged again.',
  reviewer_turn_unresolved: 'An earlier review request for this change may still be running, or its outcome could not be read, so no second request was sent (a second one would be charged again). Check the review session in OpenCode; once it has finished or been stopped there, resume. If it failed, resuming asks the reviewer again and may be charged again.',
  step_command_failed: 'A command step from the approved plan ended with a failing exit code. Look at the change in the run worktree, then amend the plan or resume to run the step again.',
  step_command_timed_out: 'A command step from the approved plan did not finish within its deadline. The command may still be running on this machine; check for it before resuming, because resuming runs the step again.',
  step_command_unknown: 'Whether a command step from the approved plan finished could not be established (the shell tool gave no usable result, or the run was stopped). Check the worktree before resuming, because resuming runs the step again.',
  stop_cleanup_unconfirmed: 'A stop was requested, but cleanup of background commands could not be confirmed. Check for leftover processes yourself.',
};
export const attentionTitle = (reason: string) => reason.replaceAll('_', ' ');
/** Plain-language meaning of an attention reason; unknown reasons keep the raw code so nothing is hidden. */
export function attentionExplanation(reason: string | null): string | null {
  if (reason === null) return null;
  return Object.hasOwn(explanations, reason) ? explanations[reason] : `The run stopped for a reason this panel does not know (${reason}). Check the run before resuming.`;
}
/** `review_limit_reached` is final. A run with no attention reason is not paused at all. */
export const canResume = (attention: string | null) => attention !== null && attention !== 'review_limit_reached';

export type RunSummary = { state: string; planHash: string | null; attention: string | null; stopRequested: boolean };
export type Actions = { run: boolean; runAutonomously: boolean; stop: boolean; accept: boolean; resume: boolean; approve: boolean; export: boolean };
/**
 * Which controls apply. A run with a stop requested accepts no further decisions (the backend refuses them); the driver then cancels it.
 */
export function availableActions(run: RunSummary): Actions {
  const none = { run: false, runAutonomously: false, stop: false, accept: false, resume: false, approve: false, export: true };
  if (run.stopRequested) return none;
  const state = run.state, working = active.includes(state), approvable = state === 'awaiting_approval' && run.planHash !== null;
  return {
    run: working, runAutonomously: working || approvable,
    stop: working || waiting.includes(state),
    accept: state === 'ready_for_acceptance', resume: state === 'needs_attention' && canResume(run.attention), approve: approvable, export: true,
  };
}

export const verdictLabel = (verdict: string) => verdict === 'approve' ? 'Approved' : verdict === 'request_changes' ? 'Changes requested' : verdict;
/** One line for lists: whitespace collapsed, cut by code points so an emoji is never split. */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const chars = Array.from(flat);
  return chars.length <= max ? flat : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}
/** The backend's own message when there is one, so a person sees why a call was refused. */
/** Where the spending limits live. The local file is weaker than host storage, and the panel must say so. */
export function budgetBackendNote(backend: 'host' | 'local_file' | null): string {
  if (backend === 'host') return 'Budgets are kept in OpenCode’s own atomic storage.';
  if (backend === 'local_file') return 'Budgets are kept in a local file on this computer, not in OpenCode’s own storage. They are shared by every OpenCode window, but any program running as you can edit that file, and spend recorded here is not carried over if OpenCode later offers atomic storage.';
  return 'No atomic budget storage is available here, so no paid request can be allowed and runs cannot reach a model.';
}
export function describeError(error: unknown, fallback: string): string {
  const message = typeof error === 'string' ? error : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
  return message.trim() ? message : fallback;
}
export function runActionError(error: unknown): string {
  const message = describeError(error, 'The action failed.');
  return /stale/i.test(message) ? `${message}. The run changed, so its latest state is being reloaded.` : message;
}

// ---- Spending & permissions form ----
export const billingModes = ['metered_api', 'subscription', 'local'] as const;
export const evidenceKinds = ['official', 'catalog', 'provider_reported', 'user_entered'] as const;
/** Everything is text while editing; `interactive`, `conditions` and `verified` have no inputs and are kept exactly as saved. */
export type RouteDraft = {
  providerID: string; id: string; variant: string; vendor: string; canonicalID: string; modelVersion: string;
  input: string; output: string; cacheRead: string; cacheWrite: string; billing: string; serviceTier: string; kind: string; sourceURL: string; checkedAt: string;
  interactive: boolean; conditions: string[]; verified: boolean;
};
/** No rate, billing mode or evidence kind is pre-filled: the person must supply and choose them. */
export const emptyRoute = (): RouteDraft => ({
  providerID: '', id: '', variant: '', vendor: '', canonicalID: '', modelVersion: '', input: '', output: '', cacheRead: '', cacheWrite: '',
  billing: '', serviceTier: '', kind: '', sourceURL: '', checkedAt: '', interactive: true, conditions: [], verified: false,
});

/** Decimal USD with at most 12 whole digits and 12 decimals; returns the form the backend stores (no leading or trailing zeros), else null. */
export function parseUsdInput(text: string): string | null {
  const value = text.trim();
  if (!/^[0-9]{1,12}(\.[0-9]{1,12})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.'), cleaned = fraction.replace(/0+$/, '');
  return `${whole.replace(/^0+(?=[0-9])/, '')}${cleaned ? `.${cleaned}` : ''}`;
}
/** A whole number from 1 to 10,000,000, the backend's range for the output cap. */
export function parseTokenLimit(text: string): number | null {
  const value = text.trim();
  if (!/^[0-9]{1,8}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 10_000_000 ? n : null;
}
/** A calendar date, or a date-time that carries Z or an offset (the rate catalog treats a time without one as stale). Plain Date.parse would accept 2026-02-30. */
export function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])], date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)) return false;
  return !Number.isNaN(Date.parse(text));
}
/** Human-readable problems; an empty list means the route can be sent. */
export function validateRouteDraft(route: RouteDraft): string[] {
  const problems: string[] = [];
  const required: [string, string, number][] = [[route.providerID, 'Provider ID', 200], [route.id, 'Model ID', 200], [route.vendor, 'Vendor', 200], [route.canonicalID, 'Canonical model ID', 200], [route.modelVersion, 'Model version', 200], [route.serviceTier, 'Service tier', 100]];
  for (const [value, name, max] of required) { if (!value.trim()) problems.push(`${name} is required.`); else if (value.length > max) problems.push(`${name} must be at most ${max} characters.`); }
  if (route.variant.length > 200) problems.push('Variant must be at most 200 characters.');
  for (const [value, name] of [[route.input, 'Input rate'], [route.output, 'Output rate']] as const) if (parseUsdInput(value) === null) problems.push(`${name} must be a decimal USD amount such as 3 or 0.075 (up to 12 decimals, no signs or exponents).`);
  for (const [value, name] of [[route.cacheRead, 'Cache read rate'], [route.cacheWrite, 'Cache write rate']] as const) if (value.trim() && parseUsdInput(value) === null) problems.push(`${name} must be empty or a decimal USD amount such as 0.3.`);
  if (!(billingModes as readonly string[]).includes(route.billing)) problems.push('Choose a billing mode.');
  if (!(evidenceKinds as readonly string[]).includes(route.kind)) problems.push('Choose an evidence kind.');
  const url = route.sourceURL.trim();
  let https = false; try { https = url.startsWith('https://') && new URL(url).protocol === 'https:' && url.length <= 2000; } catch { /* reported below */ }
  if (!https) problems.push('Rate source must be a full https:// URL.');
  if (!isIsoDate(route.checkedAt.trim())) problems.push('Checked date must be an ISO date such as 2026-11-12 or a date-time with Z or an offset such as 2026-11-12T09:30:00Z.');
  return problems;
}
export function policyProblems(maxOutputTokens: string, routes: readonly RouteDraft[]): string[] {
  const problems = parseTokenLimit(maxOutputTokens) === null ? ['Max output tokens must be a whole number from 1 to 10,000,000.'] : [];
  const seen = new Set<string>();
  routes.forEach((route, index) => {
    problems.push(...validateRouteDraft(route).map(problem => `Route ${index + 1}: ${problem}`));
    const identity = JSON.stringify([route.providerID.trim(), route.id.trim(), route.variant.trim() || null]);
    if (route.providerID.trim() && route.id.trim() && seen.has(identity)) problems.push(`Route ${index + 1}: another route already has this provider, model and variant.`);
    seen.add(identity);
  });
  return problems;
}
export const routeFromPolicy = (route: Route): RouteDraft => ({
  providerID: route.providerID, id: route.id, variant: route.variant ?? '', vendor: route.vendor, canonicalID: route.canonicalID, modelVersion: route.modelVersion,
  input: route.rate.inputPerMillion, output: route.rate.outputPerMillion, cacheRead: route.rate.cacheReadPerMillion ?? '', cacheWrite: route.rate.cacheWritePerMillion ?? '',
  billing: route.rate.billing, serviceTier: route.rate.serviceTier, kind: route.rate.evidence.kind, sourceURL: route.rate.evidence.sourceURL, checkedAt: route.rate.evidence.checkedAt,
  interactive: route.rate.interactive, conditions: [...route.rate.conditions], verified: route.rate.evidence.verified,
});
/** Call only after validation; an invalid value is passed through unchanged so the backend refuses it, never silently altered. */
export function routeToPolicy(route: RouteDraft): Route {
  const usd = (value: string) => parseUsdInput(value) ?? value, optional = (value: string) => value.trim() ? usd(value) : null;
  return {
    providerID: route.providerID.trim(), id: route.id.trim(), variant: route.variant.trim() || null, vendor: route.vendor.trim(), canonicalID: route.canonicalID.trim(), modelVersion: route.modelVersion.trim(),
    rate: {
      inputPerMillion: usd(route.input), outputPerMillion: usd(route.output), cacheReadPerMillion: optional(route.cacheRead), cacheWritePerMillion: optional(route.cacheWrite),
      billing: route.billing as Route['rate']['billing'], serviceTier: route.serviceTier.trim(), interactive: route.interactive, conditions: [...route.conditions],
      evidence: { sourceURL: route.sourceURL.trim(), checkedAt: route.checkedAt.trim(), kind: route.kind as Route['rate']['evidence']['kind'], verified: route.verified },
    },
  };
}

// ---- Reservations: settling a reserved amount needs the provider's own record, never a host estimate ----
export const reservationWarning = "Only the provider's own charge record, or proof that nothing was sent, may release a reservation. Host-computed cost estimates never do. Until settled, a reservation counts at its worst case against your budgets.";
export const settleKinds = ['provider_gross_charge', 'confirmed_not_dispatched'] as const;
export type SettleKind = typeof settleKinds[number];
export const evidenceLabel = (kind: string | null) => kind === null ? 'none' : kind === 'provider_gross_charge' ? 'Provider’s own charge record' : kind === 'confirmed_not_dispatched' ? 'Confirmed never sent' : kind;
export type SettleDraft = { kind: string; actualUsd: string; reference: string };
/** Nothing is pre-chosen: the person states which kind of evidence they hold. */
export const emptySettle = (): SettleDraft => ({ kind: '', actualUsd: '', reference: '' });
export function settleProblems(draft: SettleDraft): string[] {
  const problems: string[] = [];
  if (!(settleKinds as readonly string[]).includes(draft.kind)) problems.push('Choose what you are settling with.');
  else if (draft.kind === 'provider_gross_charge' && parseUsdInput(draft.actualUsd) === null) problems.push('The provider’s charge must be a decimal USD amount such as 0.0123 (up to 12 decimals, no signs or exponents).');
  if (!draft.reference.trim()) problems.push('A reference is required: the provider’s charge or record id, or what shows nothing was sent.');
  else if (draft.reference.length > 512) problems.push('The reference must be at most 512 characters.');
  return problems;
}
/** Call only after validation. A never-sent settlement is always 0, whatever the amount box holds. */
export const settleRequest = (runID: string, attemptID: string, draft: SettleDraft) => ({
  runID, attemptID, kind: draft.kind as SettleKind, actualUsd: draft.kind === 'confirmed_not_dispatched' ? '0' : parseUsdInput(draft.actualUsd) ?? draft.actualUsd, reference: draft.reference.trim(),
});

// ---- Route recommendations: a cost estimate over scores the person enters; nothing is saved or switched ----
export const recommendationNote = 'Scores are entered by you and are not verified. A score whose source is Artificial Analysis is refused unless permission is recorded. A recommendation is an estimate, not a bill, and nothing is saved or switched automatically.';
export const recommendRoles = ['planner', 'coder', 'reviewer'] as const;
export type ScoreDraft = { canonicalID: string; modelVersion: string; variant: string; value: string; source: string };
export const emptyScore = (): ScoreDraft => ({ canonicalID: '', modelVersion: '', variant: '', value: '', source: '' });
export type RecommendDraft = { role: string; minimumScore: string; indexVersion: string; scores: ScoreDraft[]; inputTokens: string; outputTokens: string; remainingBudget: string; image: boolean; tools: boolean };
export const emptyRecommendDraft = (): RecommendDraft => ({ role: 'planner', minimumScore: '', indexVersion: '', scores: [], inputTokens: '', outputTokens: '', remainingBudget: '', image: false, tools: false });

/** A plain non-negative decimal (no sign or exponent), as a finite number; scores are not money, so a float is fine. */
export function parseScoreValue(text: string): number | null {
  const value = text.trim();
  return /^[0-9]{1,12}(\.[0-9]{1,12})?$/.test(value) ? Number(value) : null;
}
export function recommendProblems(draft: RecommendDraft): string[] {
  const problems: string[] = [];
  if (!(recommendRoles as readonly string[]).includes(draft.role)) problems.push('Choose a role.');
  if (parseScoreValue(draft.minimumScore) === null) problems.push('Minimum score must be a number, 0 or more, written with digits only (for example 55 or 62.5).');
  if (!draft.indexVersion.trim()) problems.push('Benchmark index version is required.'); else if (draft.indexVersion.length > 200) problems.push('Benchmark index version must be at most 200 characters.');
  const seen = new Set<string>();
  draft.scores.forEach((score, index) => {
    const label = `Score ${index + 1}`;
    for (const [value, name] of [[score.canonicalID, 'Canonical model ID'], [score.modelVersion, 'Model version'], [score.source, 'Source']] as const) { if (!value.trim()) problems.push(`${label}: ${name} is required.`); else if (value.length > 200) problems.push(`${label}: ${name} must be at most 200 characters.`); }
    if (score.variant.length > 200) problems.push(`${label}: Tested variant must be at most 200 characters.`);
    if (parseScoreValue(score.value) === null) problems.push(`${label}: Value must be a number, 0 or more, written with digits only.`);
    const identity = JSON.stringify([score.canonicalID.trim(), score.modelVersion.trim(), score.variant.trim()]);
    if (score.canonicalID.trim() && score.modelVersion.trim() && seen.has(identity)) problems.push(`${label}: another score row has the same model, version and tested variant, which would make the match ambiguous.`);
    seen.add(identity);
  });
  if (parseTokenLimit(draft.inputTokens) === null) problems.push('Input tokens must be a whole number from 1 to 10,000,000.');
  if (parseTokenLimit(draft.outputTokens) === null) problems.push('Output tokens must be a whole number from 1 to 10,000,000.');
  if (parseUsdInput(draft.remainingBudget) === null) problems.push('Remaining budget must be a decimal USD amount such as 5 or 0.75 (up to 12 decimals, no signs or exponents).');
  return problems;
}
export type RecommendRequest = {
  role: 'planner' | 'coder' | 'reviewer'; runID: string | null; minimumScore: number; indexVersion: string;
  scores: { canonicalID: string; modelVersion: string; testedReasoning: { variantID: string | null; effort: null; thinkingMode: null; thinkingBudgetTokens: null }; indexVersion: string; value: number; source: string }[];
  workload: { inputTokens: number; outputTokens: number }; remainingBudget: string; needs: { image: boolean; tools: boolean };
};
/**
 * The request in the contract's shape, or null when the draft has problems. A blank tested variant means the default configuration
 * (all-null reasoning). Each score carries the form's index version, which the backend requires to match exactly. Only the reviewer
 * role uses a run, to exclude vendors that already worked on it.
 */
export function buildRecommendRequest(draft: RecommendDraft, openRunID: string | null): RecommendRequest | null {
  if (recommendProblems(draft).length) return null;
  const indexVersion = draft.indexVersion.trim();
  return {
    role: draft.role as RecommendRequest['role'], runID: draft.role === 'reviewer' ? openRunID : null, minimumScore: parseScoreValue(draft.minimumScore)!, indexVersion,
    scores: draft.scores.map(score => ({
      canonicalID: score.canonicalID.trim(), modelVersion: score.modelVersion.trim(),
      testedReasoning: { variantID: score.variant.trim() || null, effort: null, thinkingMode: null, thinkingBudgetTokens: null },
      indexVersion, value: parseScoreValue(score.value)!, source: score.source.trim(),
    })),
    workload: { inputTokens: parseTokenLimit(draft.inputTokens)!, outputTokens: parseTokenLimit(draft.outputTokens)! },
    remainingBudget: parseUsdInput(draft.remainingBudget)!, needs: { image: draft.image, tools: draft.tools },
  };
}
const exclusions: Record<string, string> = {
  not_selected: 'It is not in your saved selection for this role.',
  unavailable: 'The host does not offer this model right now (it is disabled or deprecated).',
  variant_mismatch: 'Its effort variant does not match the configuration its score was tested at.',
  image_required: 'You need image input, but this model does not accept images.',
  tools_required: 'You need tool use, but this model does not support tools.',
  limits: 'The model’s context or output limit is smaller than the workload you entered.',
  latency_mode: 'Its recorded rate is a batch rate, but an interactive request is needed.',
  vendor_conflict: 'A reviewer must come from a vendor that did not work on the run, and this vendor did (or its vendor is unknown).',
  quality_unknown: 'No single score you entered matches this route exactly (canonical model ID, model version, tested variant and index version), or the score’s source is not authorized.',
  quality_below_floor: 'Its score is below your minimum score.',
  price_evidence_unavailable: 'Its price evidence is missing, from a source that is not accepted, dated in the future, or was checked more than 7 days ago. Re-check the provider’s price and update the route.',
  inconsistent_cost: 'The estimated cost came out higher than the worst-case reservation, so the figures cannot be trusted.',
  budget: 'The worst-case reservation for one request is more than the remaining budget you entered.',
  cost_unknown: 'Its cost could not be worked out because a rate or limit is missing or unusable.',
  no_rate_recorded: 'No rate is recorded for this route. Add one in Spending & permissions.',
  billing_unbounded: 'The route is not metered API billing, so a dollar budget cannot bound it.',
  rate_conditions: 'Its rate has conditions (such as long-context tiers or batch pricing) that the estimate cannot model.',
  rate_stale: 'Its rate was checked more than 7 days ago, or its checked date is in the future. Re-check the provider’s price and update the route.',
  rate_incomplete: 'Its rate is missing a price this workload needs, or holds an unusable value.',
};
/** Reasons the rate check can add, which the recommender prefixes with `rate_`. */
const rateReasons = ['no_rate_recorded', 'unavailable', 'billing_unbounded', 'rate_conditions', 'rate_stale', 'rate_incomplete'];
/** Plain-language reason for an excluded route. Unknown codes keep the raw text so nothing is hidden. */
export function exclusionExplanation(reason: string): string {
  const key = Object.hasOwn(exclusions, reason) ? reason : reason.startsWith('rate_') && rateReasons.includes(reason.slice(5)) ? reason.slice(5) : '';
  return key ? exclusions[key] : `Excluded for a reason this panel does not know (${reason}).`;
}
/** The backend's own message; a refused benchmark source gets one extra sentence after it. */
export function recommendError(error: unknown): string {
  const message = describeError(error, 'The recommendation could not be calculated.');
  return message === 'benchmark_source_not_authorized' ? `${message}: a score whose source is Artificial Analysis is refused until written permission is recorded. Remove it or enter a source you are allowed to use.` : message;
}

// ---- Delivery: local export and draft pull requests ----
export const publishWarning = 'Publishing pushes a new branch named after this run to the remote you authorized and opens a DRAFT pull request. It never merges, never force-pushes and never deploys. The GitHub CLI (gh) must already be signed in on this machine. Dollar amounts are not published. Off by default.';
/** Only a run the person has accepted can be published; this is also enforced by the backend. */
export const canPublish = (state: string) => state === 'accepted';
export type DeliveryDraft = { publicationEnabled: boolean; remote: string; remoteURL: string; baseBranch: string; branchPrefix: string };
export const emptyDelivery = (): DeliveryDraft => ({ publicationEnabled: false, remote: 'origin', remoteURL: '', baseBranch: 'main', branchPrefix: 'feature-pilot/' });
type DeliverySettingsView = { publicationEnabled: boolean; github: { remote: string; remoteURL: string; baseBranch: string; branchPrefix: string } | null };
export const deliveryFromSettings = (settings: DeliverySettingsView): DeliveryDraft => ({ publicationEnabled: settings.publicationEnabled, ...(settings.github ?? emptyDelivery()) });
const plainName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !/\.\.|\/\/|\/\.|[./]$|\.lock$/.test(name);
/** Mirrors the backend's checks so the person sees the problem before saving; the backend still decides. */
export function deliveryProblems(draft: DeliveryDraft): string[] {
  const problems: string[] = [];
  if (!draft.publicationEnabled && !draft.remoteURL.trim()) return problems; // nothing to authorize
  if (!plainName(draft.remote.trim())) problems.push('Remote must be a plain name such as origin.');
  if (!plainName(draft.baseBranch.trim())) problems.push('Base branch must be a plain name such as main.');
  if (!draft.branchPrefix.endsWith('/') || !plainName(`${draft.branchPrefix}x`)) problems.push('Branch prefix must be a plain name ending in /, such as feature-pilot/.');
  const url = draft.remoteURL.trim();
  if (!url) problems.push('Remote URL is required.');
  else if (url.length > 2000 || /\s/.test(url)) problems.push('Remote URL must be a single line.');
  else if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(url)) problems.push('Remote URL must not contain credentials; git and gh keep those.');
  return problems;
}
/** Call only after validation. An empty destination with publication off clears the saved destination. */
export const deliveryRequest = (draft: DeliveryDraft, revision: number) => ({
  revision, publicationEnabled: draft.publicationEnabled,
  github: !draft.publicationEnabled && !draft.remoteURL.trim() ? null : { remote: draft.remote.trim(), remoteURL: draft.remoteURL.trim(), baseBranch: draft.baseBranch.trim(), branchPrefix: draft.branchPrefix },
});
type DeliveredView = { status: string; reason: string | null; paths: string[]; branch: string | null; commit: string | null; prUrl: string | null; reusedPR: boolean | null };
/** One sentence for the person; `needs_attention` always says to look at the branch and pull request by hand before retrying. */
export function deliveryOutcome(result: DeliveredView): string {
  if (result.status === 'exported') return `Exported ${result.paths.length} file${result.paths.length === 1 ? '' : 's'}: ${result.paths.join(', ')}`;
  if (result.status === 'delivered') return `${result.reusedPR ? 'Draft pull request already existed' : 'Draft pull request opened'}: ${result.prUrl ?? '(no link)'} (branch ${result.branch ?? '?'}). Nothing was merged.`;
  if (result.status === 'needs_attention') return `Needs your attention: ${result.reason ?? 'unknown'}.${result.branch ? ` Branch ${result.branch}${result.commit ? ` at ${result.commit.slice(0, 12)}` : ''}${result.prUrl ? `, pull request ${result.prUrl}` : ''}.` : ''} Check the branch and pull request on the remote before trying again; nothing is retried automatically.`;
  return `Not delivered: ${result.reason ?? 'refused'}.`;
}
