# OpenCode Feature Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task after approval. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes no implementation, paid model calls, or publication by itself.

**Goal:** Build one OpenCode Desktop plugin that chooses qualified models dynamically, carries a feature through clarification, planning, implementation and bounded independent review, and compares measured workflow costs with subscriptions.

**Architecture:** Reuse OpenCode's agent sessions and tool execution; implement a fixed feature lifecycle, recommendation policy and cost ledger inside one plugin. The desktop panel talks to its server entry through the host's typed RPC and stores durable state through plugin storage. Model/provider integrations remain OpenCode's responsibility.

**Tech Stack:** TypeScript, OpenCode Desktop and `@opencode/plugin` pinned to 2.2.7, Solid with host UI components, the host Vite GUI preset, Node built-ins and `node:test` through `tsx`. Use the host schema/RPC facilities; do not add an agent framework, separate database, HTTP backend or model gateway.

**Spec:** [Design brief](./opencode-feature-pilot-design.md). This document records the original plan; see the README and implementation progress for the current prototype and outstanding gates.

## Global constraints

- No hardcoded model assignment to any workflow stage; users may pin a role to one model or permit routing within their selected list.
- Exactly three workflow roles: planner, coder and reviewer. Initial problem expansion and clarification belong to the planner role; reasoning effort is an independent selection dimension.
- A user-selected allowed-model list for each role is mandatory. One model fixes that role; multiple models allow routing only inside that list. Owned helpers and auxiliary calls inherit it; new releases are unselected until the user adds them.
- Initial concurrency is one active model task per feature and one owned background shell job; one writer per worktree. Concurrent model work during tests is read-only unless the tested content is isolated in an immutable snapshot.
- Target OpenCode Desktop and `@opencode/plugin` **2.2.7**, pinned together.
- Supervised mode is the default.
- Quality floors, feature/monthly dollar budgets, and a maximum output allowance are required onboarding settings, not guessed values.
- Initial review plus at most **two repair rounds**, hence at most **three review passes**.
- Retry a transient provider failure at most **two** times, honoring Retry-After.
- Default completion is a local diff.
- No full-access setting removes the planner/reviewer source-edit restriction.
- No hosted backend in the initial release.
- Refresh cache after 24 hours; data older than seven days is excluded from unattended selection pending refresh or an explicit recorded override.
- Benchmark reuse permission is a public-release dependency; personal API keys do not automatically resolve it.
- API-only, subscription-plus-plugin and native-subscription comparisons remain separate.

## Review focus

1. A read-only agent uses shell, a child agent or MCP to write anyway: role restrictions must cover all exposed routes. Owned by Tasks 1 and 6.
2. A score belongs to another model version, benchmark version or local quantization: exclude unsupported joins instead of manufacturing confidence. Owned by Tasks 2 and 4.
3. Replayed usage, concurrent windows or expiring shared credits undercount spend: count once and reserve conservatively. Owned by Tasks 3 and 8.
4. A crash occurs after a model/tool/PR side effect but before checkpoint completion: reconcile rather than replay blindly. Owned by Tasks 5, 6 and 9.
5. A changed plan, missing test evidence or exhausted review budget is reported as success: invalidate approval or stop with unresolved findings. Owned by Tasks 5 and 6.
6. A background completion is duplicated, belongs to an older code version, or a service is merely spawned: do not release dependent tasks or report readiness. Owned by Tasks 1, 5 and 6.
7. A helper, host compaction fallback or new release uses a model the user did not select: enforce the owning role's allowed list on every paid request. Owned by Tasks 1, 3 and 4.

## Scope and execution order

Implement Tasks 1–6 first to prove the complete workflow, then complete the panel, comparison and delivery in Tasks 7–10. Fixtures may exercise every path before external data rights or paid credentials exist. The product is not complete with recommendations alone; all four feature stages and the cost comparison are required.

Task 1 is a feasibility gate. If the real host cannot enforce required behavior, do not compensate with prompts or silently fork the app. Describe the smallest missing host capability and update this plan. Benchmark rights and actual live benchmarking are separate release gates, not reasons to invent scores or claim savings.

No repository currently exists in this workspace. The file paths below are relative to the future plugin repository; they are proposed files, not claims about existing code. Repository creation and dependency installation happen only during approved implementation.

## File map

| Files | Responsibility |
|---|---|
| `package.json`, lockfile, `tsconfig.json`, `vite.config.ts` | Pinned plugin package, exports, build/test commands |
| `src/index.ts`, `src/host.ts` | Plugin registration; narrow integration with host sessions, permissions, storage, events and worktrees |
| `src/types.ts`, `src/rpc.ts` | Shared domain records and validated desktop/server contract |
| `src/catalog.ts`, `src/benchmarks.ts`, `src/prices.ts` | Available models, permitted scores, dated endpoint rates and normalization |
| `src/policy.ts` | Capability/quality filtering, cost ranking and explanation |
| `src/costs.ts` | Decimal money arithmetic, usage ledger, reservations and subscription scenarios |
| `src/run.ts`, `src/prompts.ts` | Fixed feature workflow, canonical artifacts, approval and stage prompts |
| `src/gui.tsx` | Host desktop panel, configuration and accessible controls |
| `src/delivery.ts` | Export and explicitly authorized draft PR delivery |
| `tests/*.test.ts`, `tests/fixtures/` | Deterministic routing, workflow, safety and money cases |
| `scripts/smoke-host.ts`, `scripts/check-prices.ts`, `scripts/measure-workflow.ts` | Host compatibility, official-price verification and reproducible evaluation |
| `docs/data-sources.md`, `docs/compatibility.md`, `docs/measurements.md`, `README.md`, `LICENSE`, `.github/workflows/ci.yml` | Evidence, install/use instructions, limitations and CI |

Start with these boundaries; split a large file only when its implemented responsibilities justify it. Do not create provider classes or a generic workflow language.

## Shared records and interface conventions

Define these domain types once in `src/types.ts`; host-specific types stay in `src/host.ts`.

- `Role = "planner" | "coder" | "reviewer"`; `clarifying` and `planning` are separate phases of the planner role, not additional model classes.
- `ModelRef = { providerID: string; id: string; variant?: string }` identifies the actual route/variant; `canonicalID` and originating `vendor` are separate fields in a candidate.
- `ReasoningConfig = { variantID: string | null; effort: string | null; thinkingMode: string | null; thinkingBudgetTokens: number | null; evidence: Evidence }` records resolved provider controls, not a guessed cross-vendor scale. Candidates also carry billing route (`metered_api`, `subscription`, `local`) and service tier separately.
- `Usd = string` is a nonnegative decimal USD amount; parse it to bigint at 12 decimal places for arithmetic. Reject excess unsupported precision rather than round a positive rate to zero. JSON persistence keeps decimal strings; round only for presentation and conservative reservations.
- `Evidence = { sourceURL: string; checkedAt: string; kind: "official" | "catalog" | "provider_reported" | "user_entered"; verified: boolean }`.
- `Quality = { source: "aa" | "openrouter-aa"; value: number; indexVersion: string | null; modelVersion: string; testedReasoning: ReasoningConfig | null; observedAt: string; evidence: Evidence }`. Unknown tested effort cannot certify an arbitrary variant against a mandatory score floor.
- `Candidate` contains `ref`, `canonicalID`, `vendor`, connected/auth-route status, text/image/tool/control capabilities with unknown allowed, context/output limits, `quality: Quality | null`, and a conditional `RateCard` with evidence. `RateCard` preserves billing unit and conditions, not only a blended price.
- `TaskKind = "clarify" | "research" | "design" | "implement" | "debug" | "validate" | "visual_inspect" | "browser_check" | "review" | "summarize" | "process_status"`; these classify steps, not new agent roles or fixed models. `TaskNeed` contains role, task kind, whether inference is needed, estimated prompt tokens, configured maximum output tokens, required input modalities/tools/control protocol, expected tool/image units, applicable task-evidence requirements, and latency mode (`interactive` or `batch`). Pure tool/status operations skip model selection. `SelectionPolicy` contains role quality floors, accepted benchmark version, allowed providers, per-role selected model references and optional variant subsets, budget, exclusions and credited balances. Version user selections and record the revision in each run. Define these fields explicitly; never accept arbitrary unvalidated JSON.
- Task-specific evidence records contain task/benchmark ID, metric and version, exact model/effort/harness, sample count when known, date and source. Keep them separate from `Quality`; missing observations remain unknown, not a fabricated score derived from AA. A task-specific threshold is optional, but must be enforced if configured.
- `Recommendation = { selected: ModelRef | null; alternatives: RankedCandidate[]; excluded: { ref: ModelRef; reasons: string[] }[]; priceSnapshotID: string; qualitySnapshotID: string }`; each ranked candidate includes estimated gross/cash USD, evidence and uncertainty.
- `Requirement` contains original input, expanded brief, applicable scenario checklist, acceptance-criterion IDs and answered/open questions. `Plan` contains requirement hash, base commit, ordered steps, affected paths/areas, step capabilities, test commands, expected evidence and rollback. Each step has a stable ID, owning role/task kind, dependency IDs, declared read/write resources, inference requirement, completion condition, and approved command/probe deadlines where relevant. Validate acyclic dependencies and serialize unknown resource effects. Store canonical serialized content and SHA-256 hashes.
- `Job` contains run/step ID, host session/tool/process identifiers verified in Task 1, command/probe identity, worktree and tested content version, dependencies/resources, deadline, log/artifact references, last observed event and status. Status is `pending`, `running`, `ready` (service only), `succeeded`, `failed`, `cancelled`, `timed_out`, or `unknown`. Store jobs and step outcomes inside `Run`; this is fixed workflow bookkeeping, not a general scheduler service.
- `Run` contains ID/revision, project/worktree/session IDs, state/reason, canonical requirement/plan, approval record, stage selections, validation artifacts, findings, repair count, timestamps and acceptance record. The states are exactly those listed in the spec.
- `Finding` contains stable ID, criterion ID or concrete defect rationale, severity, file/line where applicable, evidence and requested correction. `Review` contains plan/diff hashes, findings and verdict. `Validation` contains command/job ID, argv/cwd, exit code, tested content version, output-artifact reference and timestamps. Keep the main source version distinct from any immutable validation worktree.
- `Usage` contains a stable attempt ID, run/stage/session/request/message IDs, route/variant, resolved reasoning controls, service tier, UTC request-start timestamp, visible output/reasoning/billed-output counts with unknown allowed, tool units, gross/cash cost and evidence. Record whether reasoning is already included in output totals. `Ledger` contains deduplicated usage, reservations and provider/route-specific credit allocations. `Subscription` contains fee, billing cycle, claim/eligibility status, dated source and eligible credit rules. `Comparison` contains distinct gross/cash scenarios, estimates and explicit unknowns. Reporting settings include a validated IANA timezone, initially the device timezone, independently of the persisted budget window.

## Task 1: Prove the host contract and package loading

**Files:** package/build files; `src/index.ts`, `src/host.ts`, initial `src/types.ts`, initial `src/gui.tsx`; `tests/host.test.ts`; `scripts/smoke-host.ts`; `docs/compatibility.md`.

**Produces:** `createHost(ctx): Host`; `Host.startStage(input): Promise<{sessionID:string}>`, `Host.readStage(sessionID): Promise<StageSnapshot>`, `Host.interrupt(sessionID): Promise<void>`, `Host.subscribe(onEvent): () => void`, `Host.get/set` durable JSON operations, model inventory, VCS snapshot and host worktree operations. `StageInput` includes run ID, role, model reference, prompt/artifacts, permission profile and output cap. `StageSnapshot` includes completion/question/error state, response, usage and host IDs. Keep this adapter narrow and tied to 2.2.7.

- [ ] Write failing contract tests for cross-provider stage selection, owned-session-only changes and complete planner/reviewer deny policies. Verify that the first stage inference uses its explicitly selected model and reasoning variant even when an unrelated normal chat has a different model selected. Example assertion: `assert.equal(await fixture.attempt("planner", "shell", "touch forbidden"), "denied")`; repeat for edit, child spawn and side-effecting MCP. Reject unsupported effort levels before dispatch; inspect the resolved outbound control in the test endpoint.
- [ ] Run `npm test -- tests/host.test.ts`; confirm failures are missing behavior, not a broken harness.
- [ ] Pin 2.2.7 and package server `.` plus desktop `./gui-experimental` exports. Use the documented GUI Vite preset; create scripts `typecheck`, `test`, `build`, `smoke:host` and `measure`.
- [ ] Implement the adapter using host `session.create`, `switchModel`, `switchAgent`, `prompt`, `context`, `wait`, `interrupt`, session-scoped permissions, events/storage, and worktree/VCS APIs. Do not use the same-provider-only model-resolve hook for cross-provider switching. Do not mutate unrelated sessions or global defaults.
- [ ] Scope prompt/system/context hooks to owned session IDs. Test that all paid request kinds, retries and transport paths can be observed and vetoed/reserved before execution; explicitly check auxiliary title/compaction calls. Record any limitation. Native host permission decisions must remain authoritative.
- [ ] Verify native background shell/subagent handles, completion events, service readiness probes, output retention, cancellation and reconnect on 2.2.7. Prove which notifications trigger model turns and how to avoid duplicate continuation while accounting for every paid wake-up. Verify owned-process cleanup separately from session interruption. Add only verified job operations to `Host`; if the host cannot support an essential operation, fail the feasibility gate rather than inventing a custom process runtime. Confirm that auxiliary model selection/fallback can be constrained to the owning role's allowed list without changing unrelated sessions.
- [ ] **Host capability gate (2.2.7):** The plugin context exposes `shell.hook` but no documented shell inspect/remove operation. A session interrupt did not stop an idle session's background shell in the isolated probe. The external client's `shell.get`/`shell.remove` removed one synthetic running shell, but the plugin has no verified authenticated route to that API. Before enabling owned background jobs, obtain a host-supported, ownership-checkable shell status and stop operation in plugin context (or a documented authenticated host client in context); verify output retention, descendants, permissions and race behavior. Until then keep process cleanup unconfirmed and do not enable background execution. See `docs/compatibility.md`.
- [ ] Run `npm run typecheck && npm test -- tests/host.test.ts && npm run build`. Install the packed package in a disposable 2.2.7 desktop profile; run `npm run smoke:host` against a local deterministic test endpoint and toy repo. Prove panel load, permissions, model switching, usage capture, cancellation and reconnect. A mocked adapter alone is not a pass.
- [ ] Save exact host/package/platform results in `docs/compatibility.md`. Commit: `feat: establish tested OpenCode desktop integration`.

## Task 2: Load model identities, benchmarks and official prices

**Files:** `src/catalog.ts`, `src/benchmarks.ts`, `src/prices.ts`, `src/types.ts`; `scripts/check-prices.ts`; `tests/catalog.test.ts`, synthetic fixtures; `docs/data-sources.md`.

**Consumes:** host inventory. **Produces:** `loadCatalog(host, settings, now): Promise<CatalogSnapshot>`, `joinQuality(candidates, scores): Candidate[]`, `resolveRate(candidate, workload, now): RateResult`. `CatalogSnapshot` contains candidates, immutable snapshot IDs, source metadata and warnings; `RateResult` is a validated rate schedule or explicit exclusion reason.

- [ ] Add failing tests for exact canonical identity/variant joins, unknown benchmark version, null score, unscored local quantization, missing vision, bad rate units, expired data and cached data after HTTP 429. Assert a missing score stays `null` and cannot become zero. Assert a failure does not replace the last good rate with zero. A max-effort benchmark must not attach to a low-effort candidate; retain unknown tested reasoning explicitly. Resolve custom variant names from actual settings and exclude unsupported effort/toggle/budget combinations.
- [ ] Run `npm test -- tests/catalog.test.ts`; verify expected failures.
- [ ] Read enabled connected models from OpenCode. Enrich only needed fields; preserve provider-specific capabilities and prices. Implement bounded cached fetches for permitted AA v2 and OpenRouter score formats, pagination, source/version retention, 24-hour refresh and seven-day stale cutoff. Refresh after account/inventory changes and on explicit refresh; startup refreshes an expired cache. Load external data before host reload/recomputation. Unknown index version is display-only unless a verified source snapshot establishes it; a score threshold cannot silently span versions.
- [ ] Test a newly discovered model through unavailable, awaiting-benchmark and eligible states without changing a hardcoded model list. Known catalog entries absent from host inventory remain non-runnable. Test refresh failures, provider removal and local models not installed. A refresh must not replace the active model or pinned reviewer; future stage selections record their new snapshot.
- [ ] Keep catalog eligibility distinct from user selection: newly available models remain unselected. Preserve separate modality/host-transport support and task evidence, including unknown evidence. Do not relabel a general intelligence score as a vision/debugging/security result.
- [ ] Implement validated price normalization for OpenRouter and direct OpenAI/Anthropic/Gemini/DeepSeek source formats. Keep conditions such as time-of-day, long context, cache operations and batch separate. `scripts/check-prices.ts` compares proposed updates with official sources and emits a reviewable delta; no blind LLM-driven overwrite of rates. Additional providers may use clearly labelled catalog rates.
- [ ] Document the selected source's allowed use and attribution. Until rights are established, use synthetic benchmark fixtures and return `benchmark_source_not_authorized` for public AA-backed selection. No shared AA key or copied dataset in the package. User secrets use host credential integration where supported, otherwise server-process environment references; no GUI/local-storage keys.
- [ ] Run `npm test -- tests/catalog.test.ts && npm run typecheck`; verify recorded source links manually. Commit: `feat: add sourced model and benchmark catalog`.

## Task 3: Enforce spending reservations and collect usage

**Files:** `src/costs.ts`, `src/host.ts`, `src/types.ts`; `tests/costs.test.ts`.

**Produces:** `estimateCost(need, rate, credits): CostEstimate`, `reserve(ledger, attemptID, limits, estimate): ReservationResult`, `recordUsage(ledger, usage): Ledger`, `reconcileReservation(ledger, attemptID, actual): Ledger`. `CostEstimate` includes gross, cash, upper-bound status and assumptions. Use serialized host-side updates for shared reservations; persisted attempt IDs make accounting replay-safe.

- [ ] Add failing assertions: 10,000 input tokens at $2/M plus 10,000 output at $10/M costs exactly `"0.12"`; replaying one usage event keeps that amount; expired credits cover zero; another provider's credit cannot apply; simultaneous reservations cannot both consume the last available budget. A manually entered or shared credit balance must not reduce a hard gross-cost reservation. Add tier/cache/image/reasoning cases and a timeout with potentially billed work. With billed output 10,000 including 9,000 reasoning tokens, output charged at $10/M is `"0.10"`, never `"0.19"`. A subscription route's zero reported API cost must not be labelled free/unlimited.
- [ ] Run `npm test -- tests/costs.test.ts`; confirm failures.
- [ ] Implement decimal arithmetic and route/cycle-specific credit allocation. Keep gross usage, applied credit and incremental cash distinct. Conservative estimation uses cache miss unless eligibility is evidenced, reserves retries/auxiliary calls, and counts unsuccessful feature attempts. Reserve gross metered cost unless a provider-backed exclusive credit reservation is available; user-entered or shared balances inform labelled estimates only. A recent balance check alone does not prevent other applications from spending it.
- [ ] Use the verified host hooks from Task 1 to guard every paid request belonging to a run, including vision children, compaction and retries. Bound output, tool loops and retries. No dispatch on insufficient budget. Do not release an ambiguous in-flight reservation until reconciled. Refuse unattended hard-budget operation on routes whose billing cannot be defensibly bounded.
- [ ] Assert repeated process-status/probe events create no plugin-generated inference requests. Count native notification-triggered model turns when they occur, plus diagnostic and summary calls. Enforce role selections before all such requests; a zero-cost tool wait does not make shell/cloud resource usage universally free.
- [ ] Persist ledger entries with price snapshot IDs and cost provenance. Reconcile provider-reported costs where available; otherwise show estimates. This ledger covers this host's plugin activity, not global provider spending.
- [ ] Run `npm test -- tests/costs.test.ts && npm run typecheck`. Commit: `feat: track usage and guard feature spending`.

## Task 4: Recommend models for the actual task

**Files:** `src/policy.ts`, `src/types.ts`; `tests/policy.test.ts`.

**Consumes:** candidates/rates and pure cost estimation from Task 3. **Produces:** `inferNeeds(requirement, planStep, attachments): TaskNeed`, `recommend(candidates, need, policy, ledger, now): Recommendation`.

- [ ] Write failing tests using synthetic scores 30 and 50: cheaper qualifying model wins; score 24 fails a configured test floor of 25; missing score fails; image interpretation excludes text-only models; capture-only does not require vision; reviewer excludes planner/coder vendors even through different hosts; batch-only discount fails interactive eligibility. These numbers are fixtures, not shipped defaults.
- [ ] Test one-model role lists as fixed selection; multi-model lists as bounded choice; excluded cheap models never win; no eligible vision model pauses without escaping the list; new catalog releases stay unselected. Helpers inherit their owner's list. Reviewer independence covers all materially contributing planner/coder vendors, including visual/diagnostic helpers. Also test unsupported host attachment transport and missing required task-specific evidence.
- [ ] Cover fixed model/fixed effort, fixed model/automatic permitted effort, and automatic choice across selected models/variants. Workflow state determines the role; a validated step determines capabilities. A model/effort pair can qualify for multiple roles without creating permanent planner/coder labels. Display sorting must not modify routing or selection policy.
- [ ] Run `npm test -- tests/policy.test.ts`; confirm failures.
- [ ] Infer initial clarify/plan requirements from text/attachments and read-only tool needs. Later steps use the structured approved plan. A model may propose extra capabilities, but the plugin validates them against actual tools and connected routes. Ask material task questions; never ask users to classify every shell call.
- [ ] Separate task kind, model capability and tool operation. Existing grep/read/probe/known-command execution requires no extra classification model. Use the planner's structured task description for cases needing judgment; preserve uncertainty and ask only material questions. A high general score never substitutes for a missing image/control protocol or required task-specific evidence.
- [ ] Filter capabilities, limits, allowed sources, score versions/floors/tested reasoning, vendor diversity and budget before ranking. Rank eligible model-and-effort configurations by estimated incremental cash cost, then score, known latency, canonical ID and variant ID. Include gross cost, expected usage assumptions, exclusions and unknowns. Do not invent an effort-to-price multiplier or always run low before escalating. Where effort-specific usage history is unavailable, show a conservative range/output reservation. Fail with no qualified candidate rather than relaxing a constraint.
- [ ] Select once per stage, preserve the reviewer model and reasoning configuration across repairs, and account for handoff/cache costs. Permit a same-model planner/coder result when it is the cheapest eligible outcome. A coder effort escalation reruns selection/budget checks and keeps the same repair counter. Local unscored execution requires a visible user override and does not count as intelligence-qualified routing.
- [ ] Run `npm test -- tests/policy.test.ts && npm run typecheck`. Commit: `feat: recommend qualified models by task cost`.

## Task 5: Clarify, plan and approve immutable artifacts

**Files:** `src/run.ts`, `src/prompts.ts`, `src/types.ts`; `tests/planning.test.ts`.

**Consumes:** `Host`, recommendation and ledger APIs. **Produces:** `startRun(input): Promise<Run>`, `answerQuestions(runID, revision, answers): Promise<Run>`, `approvePlan(runID, revision, planHash): Promise<Run>`, `advanceRun(runID, revision): Promise<Run>`. `StartInput` contains project ID, original requirement, settings and chosen baseline. Canonical artifacts live in host storage.

- [ ] Write failing tests for no source edits during clarification/planning, material unanswered questions blocking both modes, changing a plan invalidating approval, approving the wrong hash/revision, autonomous policy authorization, and reopening a saved plan after restart.
- [ ] Run `npm test -- tests/planning.test.ts`; confirm failures.
- [ ] Implement requirements expansion and plan prompts with criterion IDs, relevant security/scaling/observability/testing and SEO/AEO/GEO applicability. The model returns validated structured artifacts; malformed results receive at most one bounded schema-correction request, charged normally, then pause.
- [ ] Validate step dependencies, resource declarations, completion conditions, command deadlines and service readiness probes. Unknown resource effects imply sequential execution. Include background behavior in the approved plan; spawning a process does not satisfy its step. Native schema support is optional; successful validated output is required.
- [ ] Save original requirement, expanded brief, answers, baseline and canonical plan before presenting approval. Hash canonical content. Supervised progression needs a matching approval; autonomous progression needs an explicit mode record plus valid policy/budget. Plan changes always generate a new hash.
- [ ] Implement revision-checked transitions and write-ahead checkpoints before host side effects. On reconnect, inspect recorded host session IDs before dispatching anything. Ambiguous in-flight work becomes `needs_attention`, preserving artifacts and costs. Other plugin sessions remain untouched.
- [ ] Run `npm test -- tests/planning.test.ts && npm run typecheck`. Commit: `feat: add clarification and approved-plan handoff`.

## Task 6: Implement, validate and complete bounded review

**Files:** `src/run.ts`, `src/prompts.ts`, `src/host.ts`; `tests/workflow.test.ts`; toy backend/UI fixtures.

**Consumes:** approved `Run`; Task 1 execution and worktree capabilities. **Produces:** complete `advanceRun` plus `stopRun(runID, revision): Promise<Run>` and `acceptRun(runID, revision): Promise<Run>`. Add `Host.runValidation(worktree, approvedCommand): Promise<Validation>` through the verified host permission/execution path; never raw-execute reviewer text.

- [ ] Add failing scenarios: approved plan reaches only its coder; scope expansion returns to planning; screenshot interpretation selects an eligible child model without changing the coder globally; failing/missing tests block readiness; a reviewer cannot edit/spawn around permissions; review is pinned; two unsuccessful repairs end in `needs_attention` after three total reviews; exhausted budget never passes; stop preserves the diff.
- [ ] Run `npm test -- tests/workflow.test.ts`; confirm failures.
- [ ] Create the host worktree from the saved baseline. Reject unexpected baseline drift and preserve dirty original checkouts. Pass exact canonical artifacts to each stage; prompts alone never authorize edits. Record full diff identity including newly created files and required connected source context.
- [ ] Execute approved test commands with captured exit codes/artifacts through host permissions. Keep validation evidence independent from a coder's claim that tests passed. Read-only review consumes evidence; it does not gain general shell access. If a test requires new privileges or services, ask/pause rather than invent results.
- [ ] Add background-job cases to `tests/workflow.test.ts`: independent read-only work proceeds during tests; dependent edits wait; stale content-version results cannot satisfy validation; duplicate completion advances once; a dev server must pass its probe; premature service exit blocks dependents; deadline/stop confirms owned cleanup; reconnect never blindly replays an ambiguous command. Unknown resources serialize work. If edits overlap validation, require a verified immutable validation worktree; keep one writer per worktree.
- [ ] Implement the step/job records inside `src/run.ts` with verified host events and bounded status probes, not an LLM polling loop. Start only steps with satisfied dependencies, compatible resources, permissions and reservations. Default to one active model task and one owned background shell job per feature. A service occupies that shell slot; a foreground browser check can use the ready service. If nothing independent is runnable, wait. Do not promise continued operation after the owning service stops or after a required desktop browser becomes unavailable.
- [ ] Add bounded debugging: retain reproduction/logs/content version, distinguish environment/auth/quota failures from code defects, and allow one read-only diagnostic helper per repair round. Every coder fix after validation/review failure consumes the existing shared two-repair budget. Diagnostics and effort escalation never reset it; approval-changing scope returns to planning. Only the main coder writes helper-proposed fixes.
- [ ] Validate reviewer output against the plan/diff hashes. Separate blocking evidence from advisory style suggestions. Send only actionable fixes to the coder. Limit repair/review/schema/transport loops separately and charge all calls. A replaced unavailable reviewer pauses and records the change.
- [ ] Implement capability escalation via a bounded owned host subtask, including image interpretation. Capturing an image remains a tool operation. An absent suitable model produces a clear unresolved requirement. Disable arbitrary model-created delegation; all owned children retain the role policy and accounting.
- [ ] Persist state and session IDs around every transition. Tests cover crash after edits, after test execution and after review, ensuring no blind replay. `ready_for_acceptance` requires passing validation and reviewer approval; only `acceptRun` records user acceptance.
- [ ] Run `npm test -- tests/workflow.test.ts && npm run typecheck` and the disposable-host integration scenario. Commit: `feat: execute plans with bounded independent review`.

## Task 7: Finish the desktop panel and settings

**Files:** `src/rpc.ts`, `src/gui.tsx`, `src/index.ts`; `tests/rpc.test.ts`; GUI smoke checklist in `docs/compatibility.md`.

**Consumes:** workflow/catalog/recommendation/ledger functions. **Produces:** validated RPC methods `getState`, `saveSettings`, `refreshCatalog`, `recommend`, `startRun`, `answerQuestions`, `approvePlan`, `stopRun`, `acceptRun`, `compareCosts`, `exportRun`, `deliverRun`; event `runUpdated`. Every mutation includes expected revision; server revalidates identity, authorization and budget.

- [ ] Write failing RPC tests for malformed settings, stale revision, forged approval hash, attempted hidden provider changes and secrets appearing in responses. Run `npm test -- tests/rpc.test.ts` and confirm failures.
- [ ] Register one desktop panel and one settings page using the host's GUI/RPC API. Its New Feature form starts the workflow independently of the ordinary chat composer. Include requirement entry, material questions, plan approval, stage progress with model/provider labels and links to underlying sessions, model recommendation/exclusion table, review evidence, stop/resume and cost view. Reuse native components and focus/keyboard behavior. Do not intercept unrelated chats. Revalidate policy/budget and record any native-picker model override in an owned session before more execution.
- [ ] Require per-role quality floors, benchmark source/version policy and feature/monthly budgets before automatic execution. Display unknown score/price/capability explicitly. An unscored override is a separate recorded action, never a disguised successful policy recommendation.
- [ ] Add per-role multi-select from the user's available OpenCode integrations. Show fixed selection for one model and automatic routing within the list for multiple models. Keep unavailable entries visible with reasons, newly released models unselected, and missing screenshot capability explicit. Validate reviewer vendor feasibility against actual selections before dispatch. Display background jobs, task dependencies, tested version, running/ready/succeeded distinction, deadline and next blocked/runnable step; no extra model-class configuration for shell/status tools.
- [ ] Default the model picker to Available in this project; offer Browse catalog for known unavailable entries, with connection handled in OpenCode. Add provider/vendor/modality/role/selected filters and expandable effort variants. Sort options are Recommended, Lowest cost with an explicit task/reference-workload/input-rate/output-rate basis, and Highest intelligence within one benchmark version/configuration. Unknown scores/prices sort last; separate incompatible score versions. Before task context exists, show unit rates or a clearly labelled reference workload, not a fabricated task bill. Test that sorting does not alter selected roles and that two providers serving the same model remain distinct price/auth routes. Explain available versus selected versus eligible for the actual task.
- [ ] Show source links, checked-at time, estimated-versus-reported amounts and disconnected provider status. Show exactly three role settings, including clarification under planner. Model rows expose supported reasoning variants, tested benchmark effort, service tier, rates and estimated task cost separately. Keep model/effort/permission/plan state synchronized across windows through server events. Public notifications/logs contain no prompts, code or credentials.
- [ ] Add the ledger-backed Usage view: Today, month picker, daily bars with an accessible table, month totals, budget remaining and pending reservations. Show provider/model/effort/role/project breakdowns, gross/credit/cash distinctions, unknown-charge counts and reporting timezone. Label scope as this plugin's runs on this host. Load the deterministic aggregates from Task 8 through the existing read-only state/RPC path; sorting or viewing history must not invoke a model or change budgets.
- [ ] Run `npm test -- tests/rpc.test.ts && npm run typecheck && npm run build`. Manually verify keyboard navigation, screen-reader labels, long model names, narrow window, loading/error/empty states, reconnection and duplicate windows in Desktop 2.2.7. Commit: `feat: add feature workflow desktop panel`.

## Task 8: Compare subscriptions and measure accepted work

**Files:** `src/costs.ts`, `src/gui.tsx`, `src/rpc.ts`; `tests/comparison.test.ts`; `scripts/measure-workflow.ts`; `docs/measurements.md`.

**Produces:** `compareCosts(ledger, subscriptions, period, operatingCosts): Comparison`, `summarizeRuns(runs, ledger, period): RunMetrics`. `RunMetrics` includes total spend, accepted count, completed/unresolved counts, repair rounds and elapsed time; cost per accepted feature is undefined when accepted count is zero.

Also produce `aggregateUsage(ledger, calendarMonth, reportingTimeZone): UsageSummary` with daily buckets and selected-month totals, gross/credit/cash amounts, cost provenance, unknown-charge counts, and provider/model/effort/role/project breakdowns. Return reservations separately. Reuse `src/costs.ts` and the existing ledger rather than creating an analytics service.

- [ ] Test timezone midnight/month boundaries and daylight-saving changes, requests crossing midnight, duplicate usage events, a late correction applied to its original day, unknown-charge partial totals, and inclusion of failed/repair/auxiliary calls. Assert the month equals the sum of its unrounded daily buckets and reservations are not added to incurred spend. A reporting-timezone change must not reset budget consumption.
- [ ] Aggregate by the UTC request-start timestamp converted to the configured reporting zone. Keep calendar reports, provider billing cycles, fixed subscription fees and operating costs distinct. Preserve estimated/provider-reported provenance and do not assign invented dollar usage to subscription allowance routes.

- [ ] Add failing assertions: with gross OpenAI $60 + Anthropic $20 + other $10, API-only is $90; a $100 subscription covering that $60 produces $130 total, not $30 or a negative bill. Failed runs stay in total cost; zero accepted runs shows no cost-per-accepted value. Test partial cycle credit, expiry, unclaimed/ineligible credit and unknown native capacity.
- [ ] Run `npm test -- tests/comparison.test.ts`; confirm failures.
- [ ] Implement the three scenarios from the spec, configurable dated subscription facts, user-entered/verified credit balances, local operating costs and optional taxes with a consistent basis. Do not equate API token prices to native subscription allowance. Do not double-count credits or treat provider credits as transferable cash.
- [ ] Display incremental cost for existing subscribers separately from replacement cost. Equivalent-workflow comparison includes independent external review; non-coding subscription benefits and unknown allowance capacity are explicit limits. Export only user-approved aggregate data and dated methodology.
- [ ] Implement a measurement script that runs the same approved tasks on identical clean snapshots using dynamic routing and a single qualifying frontier baseline. Require explicit paid-run authorization and budgets; otherwise run fixture mode. Include a screenshot/UI task and backend task, all failures/repairs, acceptance criteria and latency. Never infer universal savings from two examples.
- [ ] Run `npm test -- tests/comparison.test.ts && npm run measure -- --fixtures && npm run typecheck`. Commit: `feat: compare workflow spending with subscriptions`.

## Task 9: Export results and support authorized draft PRs

**Files:** `src/delivery.ts`, `src/run.ts`, `src/rpc.ts`; `tests/delivery.test.ts`; README delivery instructions.

**Produces:** `exportRun(run, ledger, destination): Promise<ExportResult>`, `deliverRun(run, destination): Promise<DeliveryResult>`. Destination is `local` or an explicitly authorized GitHub remote/branch profile; PR delivery uses existing Git/`gh` credentials, not new authentication infrastructure.

- [ ] Write failing tests for disabled publication, wrong remote, untracked changes omitted from a diff, unrelated files in a commit, secret fields in export, duplicate PR after retry and branch drift after review. Run `npm test -- tests/delivery.test.ts`; confirm failures.
- [ ] Export original requirement, approved plan, recommendation rationale, final diff/review status, validation evidence and aggregate costs. Exclude API keys, raw prompts outside the intended artifacts and benchmark data without redistribution permission.
- [ ] For enabled delivery, verify the reviewed diff/commit identity, create only the run's commit/branch, and open a draft PR. Include acceptance criteria, changes, test evidence, unresolved advisories and cost provenance. Do not merge or deploy. Use structured argv and a body file rather than shell-interpolated model text.
- [ ] Record the branch/commit/PR identity before final status; on retry search by that identity before creating another PR. Missing credentials or ambiguous side effects pause and preserve local results. All remote publication stays within the explicit project authorization.
- [ ] Run `npm test -- tests/delivery.test.ts && npm run typecheck`; use a disposable remote only when authorized. Commit: `feat: export runs and deliver authorized draft PRs`.

## Task 10: Package, document and verify the public release

**Files:** README/license/CI files, `docs/data-sources.md`, `docs/compatibility.md`, `docs/measurements.md`, package metadata and existing tests.

- [ ] Add CI checks for typecheck, deterministic tests, build and packed-package import. No paid keys or network benchmark access in public CI. Test secret redaction and ensure the package contains no captured source, user data or raw benchmark exports.
- [ ] Run `npm run typecheck && npm test && npm run build && npm pack --dry-run`. Install the actual packed package in a clean Desktop 2.2.7 profile; linking the source tree is insufficient.
- [ ] Complete the host smoke suite for permission bypass attempts, corrupt/stale sources, model removal, unavailable vision, duplicate events, context compaction, budget exhaustion, review loops, crash recovery and concurrent worktrees. Record platform results; keep unsupported platforms labelled untested.
- [ ] Write setup instructions using `opencode plugin add <published-package>` and Desktop Settings → Extensions → Plugins. Document supported sources/providers, benchmark source permissions, unknown-score behavior, model selection policy, manual/autonomous modes, provider-side budget limits, local costs and subscription comparison limits.
- [ ] Include the starter prompt below, a synthetic-data demo, and reproducible measurement instructions. Retain required licenses/attribution. Verify that a public data-source agreement covers the actual displayed and exported data before enabling AA-backed recommendations in a public release.
- [ ] Release gate: real host contract passes; all requested stages work; at least two hosted model vendors and one supported local runtime have documented smoke results; local benchmark qualifications/overrides are explicit; cost reports do not claim unmeasured savings; source-use permission is settled. GitHub/npm publication is a separate authorized action, not an automatic consequence of this plan.
- [ ] Commit: `docs: prepare verified plugin release`.

## Starter prompt shipped with the plugin

> Feature: [describe the problem and desired result]. Inspect this repo and its existing instructions first. Expand this into an implementation brief with observable acceptance criteria. Ask me about material unknowns; do not guess them. Consider real user journeys, failures, permissions, security, scale, monitoring/logs, accessibility, migrations and rollback; cover SEO/AEO/GEO only when applicable. Produce an ordered plan with affected areas, capabilities needed and validation commands without editing source. Follow this run's approval mode. After authorization, implement only the approved plan. Review the actual diff and validation evidence against the requirement and plan using the configured independent reviewer policy. Fix substantiated blocking issues within the configured repair and spending limits; stop with unresolved evidence if limits are reached. Show selected models, selection reasons, estimated and recorded costs, and comparison assumptions.

The prompt expresses intent. Permissions, stage gates, hashes, budgets and loop limits are enforced by the plugin, not by asking the model to obey this paragraph.

## Handoff and unresolved external dependencies

The next authorized action after approval is Task 1 in an isolated plugin repository/worktree. No runtime or dependencies have been installed for this planning task. Benchmark-contract permission, installed desktop compatibility, paid end-to-end behavior, actual subscription capacity and measured savings are not verified yet. Those facts must stay visible in the release checklist; they cannot be replaced by assumptions or synthetic test success.

Current host/source references are linked in the design brief. The version pin follows the explicit [2.2.7 release](https://github.com/anomalyco/opencode/releases/tag/v2.2.7), not GitHub's stale `releases/latest` result observed during research.
