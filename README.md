# Feature Pilot

Feature Pilot is an **unfinished prototype** of an OpenCode Desktop plugin for planning, implementing and independently reviewing a feature with models selected by the user. It is not ready for production use or publication as a working orchestrator.

The intended workflow uses three roles: a planner clarifies the requirement and writes a plan, a coder implements the approved plan, and a reviewer from another vendor checks the result. The user chooses the models and variants allowed for each role. The design also calls for bounded repair cycles, spending limits and a comparison with subscription costs. See the [design](docs/opencode-feature-pilot-design.md) and [implementation plan](docs/opencode-feature-pilot-plan.md).

## Current state

- The local server entry has loaded in an isolated OpenCode 2.2.7 host. Desktop panel behavior is not yet verified.
- The prototype includes project-scoped model selections, draft records, a partial observed-usage view and manually entered cost scenarios. Host estimates are incomplete and are not provider bills.
- Artificial Analysis data is optional and requires the user's own key. Displayed entries are not verified model/variant matches and are not used for routing. Users must check their own data-use rights.
- **The end-to-end workflow still does not run against a real host.** Every plugin-owned model request now reserves its worst-case cost before dispatch (context window as input at the dearest input rate, plus the model's full output limit; your planned output tokens only drive estimates, because nothing enforces them as a cap) and is refused when there is no atomic budget ledger, no user-entered rate card, unknown token limits, an unbounded billing route or too little budget. Stock OpenCode 2.2.7 has no atomic storage, so on it every owned request is refused; budget enforcement needs the locally modified host described below. Reservations are released only by settlement evidence (the provider's own charge, or proof nothing was sent) that the user records with `settleReservation`; nothing settles them automatically, so budgets drain conservatively until you do.
- A resume-safe run driver (plan, approve, implement, validate, review, repair up to two rounds) is connected to host-backed stages and to `driveDraft`/`stopDraft` RPC: it creates a separate git worktree beside the project (not a sandbox: shell commands run with your own account permissions), runs the coder there, validates the approved commands through the host shell tool, picks a reviewer from a vendor that did not plan or code, and reviews the exact diff. It also includes a run lifecycle with pause/resume/stop/amendment, a route recommender (`recommendRoutes`), local export, run cost summaries and fixture-only measurement. **All of this has only been exercised against in-memory fakes of the host and real local git, never a real OpenCode host.** The coder (file edits and shell) is **off by default** and turns on only through the `coderEnabled` policy flag, because on 2.2.7 a broad allow rule can override a project's own deny rules; enable it only in a disposable project. One-shot command steps in an approved plan run in the foreground through the same host shell tool as validation (they need the `coderEnabled` opt-in too); steps that need a background service pause as `unsupported_step`, because OpenCode 2.2.7 gives plugins no verified way to stop an owned background shell. Draft-PR delivery is reachable over RPC (`getDelivery`, `saveDelivery`, `deliverDraft`) and from the panel, but only for an **accepted** run in a project whose settings authorize one remote; it is off by default, pushes only the run's own branch, never merges, and has only run against a scripted fake of `gh` and a local bare repository, never real GitHub. Stop now also ends a running validation wait, and a planner or reviewer reply wrapped in one Markdown fence is accepted.
- The panel now has controls for starting a feature, answering questions, approving, running (supervised or autonomous), stopping, accepting, resuming, exporting a preview, per-role spending policy with rate cards, the `coderEnabled` switch with its permission warning, budgets, a reservation list with settlement against the provider's own charge record, and a route-recommendation form with plain-language exclusion reasons (scores are entered by you and unverified; nothing is saved or switched automatically). Its decision logic lives in `src/gui-model.ts` and is unit tested; **the rendering has never been seen in OpenCode Desktop**. A Delivery section authorizes (or clears) one GitHub destination, and an accepted run offers "Publish draft pull request…" behind a second confirming click; "Export summary to disk" writes beside the run worktrees.
- No measured savings exist. See [measurements](docs/measurements.md) for the method and what is still needed before any claim.
- OpenCode 2.2.7's plugin context does not provide a verified way to inspect and stop owned background shells. Session interruption alone did not stop a shell in the isolated probe. See [compatibility findings](docs/compatibility.md); [what OpenCode would need to add](docs/opencode-host-requirements.md) to allow service steps.
- **Budget storage.** Stock 2.2.7 plugin storage has no compare-and-set. When the host lacks it, budgets are kept in a SQLite file the plugin owns (`<XDG_DATA_HOME or ~/.local/share>/opencode/feature-pilot/ledger.sqlite`), safe across OpenCode processes but **not** protected from other programs running as you, and not carried over if OpenCode later provides atomic storage (the host's own storage is then preferred, and spend recorded in the file is not counted). The panel shows which one is in use. Without either, no paid request is allowed.
- `npm run smoke:host` and `npm run smoke:host:model` (they need `FEATURE_PILOT_SMOKE_CLI` pointing at an `opencode` 2.2.7 binary and a prior `npm run build`) load the packed plugin into an isolated scratch host with no credentials. The second one sends one planner request to a free loopback mock model and checks the ledger. Neither exercises the coder, reviewer, shell tool or the Desktop panel.
- Some experiments require a locally modified OpenCode checkout; that fork is not included in this repository. The `smoke-fork-*` scripts expect a sibling checkout named `opencode-host-fork` and do not work from this repository alone.

Do not install this prototype in a working OpenCode profile or provide paid credentials. The [Desktop test checklist](docs/desktop-testing.md) describes the isolated test setup and its current limits.

## Starter prompt

> Feature: [describe the problem and desired result]. Inspect this repo and its existing instructions first. Expand this into an implementation brief with observable acceptance criteria. Ask me about material unknowns; do not guess them. Consider real user journeys, failures, permissions, security, scale, monitoring/logs, accessibility, migrations and rollback; cover SEO/AEO/GEO only when applicable. Produce an ordered plan with affected areas, capabilities needed and validation commands without editing source. Follow this run's approval mode. After authorization, implement only the approved plan. Review the actual diff and validation evidence against the requirement and plan using the configured independent reviewer policy. Fix substantiated blocking issues within the configured repair and spending limits; stop with unresolved evidence if limits are reached. Show selected models, selection reasons, estimated and recorded costs, and comparison assumptions.

The prompt expresses intent. Permissions, stage gates, hashes, budgets and loop limits are enforced by the plugin, not by asking the model to obey this paragraph.

## Development

The package pins OpenCode's plugin, client and schema packages to 2.2.7. Local checks run on Node.js 24 (Windows) and are defined for Node.js 24 in CI:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run check:prices -- --rates rates.json [--catalog models.json]   # read-only price delta report
npm run measure -- --fixtures    # synthetic measurement fixtures only
```

Passing these checks does not establish Desktop compatibility, billing accuracy or end-to-end safety. The package is private and unpublished; no license has been selected yet.
