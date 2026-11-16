# AGENTS.md

Relay (package `feature-pilot`) is an unfinished OpenCode 2.3.0 plugin (TypeScript, ESM). What it is becoming: `/relay <message>` in the normal OpenCode chat asks a decision model whether the message is plan, execute or review and which of that mode's models fits it, switches the chat to that model, and sends the message. The side panel is settings only. The older pipeline that plans, implements and reviews a feature from the side panel is still in the code and is not the product. `README.md` has the current state; `docs/superpowers/specs/2026-11-13-relay-chat-model-guidance-design.md` has the intent (`opencode-feature-pilot-plan.md` and `opencode-feature-pilot-design.md` describe the older pipeline). This file lists only what the code does not make obvious.

## Commands

- `npm run typecheck` · `npm test` (node:test through tsx, `tests/*.test.ts`) · `npm run build` (tsc, then the Vite GUI bundle into `dist/`) · `node scripts/check-package.mjs`. CI runs all four on Linux and Windows.
- Real-host smokes need a prior `npm run build` and `FEATURE_PILOT_SMOKE_CLI=<path to an opencode 2.3.0 binary>`: `npm run smoke:worktree`, `smoke:host`, `smoke:host:model`. They use scratch directories, loopback ports and synthetic keys.
- Run the four checks fresh before saying anything passes, and report the counts as printed.

## Never

- Install, load or test the plugin in a real OpenCode profile or Desktop, or use real or paid credentials. Isolate with `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`, a throwaway server password, and the mock provider in `scripts/smoke-host-model.mjs`. The owner can lift this for one named step, as they did on 14 Nov 2026 for the Desktop check and for the decider's example run (made-up messages to a free decision model from an isolated host). Such a yes covers that step only, and the step is recorded in `docs/compatibility.md`.
- Merge anything. Delivery is a draft pull request for an accepted run only.
- Call something verified when it only ran against fakes. Record host findings in `docs/compatibility.md` with platform, version and what was not tested, and add a line to `docs/implementation-progress.md`.

## Invariants (all fail closed)

- Every plugin-owned model request reserves its worst-case cost first (`src/spending.ts`). With no atomic ledger there is no request. The ledger is the host's compare-and-set storage when it has it, else a local SQLite file (`src/budget-ledger.ts`, `src/local-ledger.ts`). One exception, decided by the owner on 2026-11-14 ("i dont want a budget feature please ignore it we see it later"): Relay's decider requests (`src/decider.ts`) are not reserved, and `/relay` has no budget. There is one such request for each `/relay`, one for each helper that a model starts, and one for each try in the panel's test box. Each is limited by its size instead (4,000 characters of text, eight "use it for" lines of 200 characters for a mode, ten file names), and only a decision model can be the decider.
- Sessions the plugin creates start deny-all. A coder gets actions only while `coderEnabled` is on.
- A failed or ambiguous stage pauses the run (`needs_attention`) and is never retried automatically. Stage checkpoints decide what a resume may repeat.
- Service plan steps stay gated (`unsupported_step`) until OpenCode gives plugins verified shell inspect and stop. See `docs/opencode-host-requirements.md`.

## Gotchas

- The host reports any error an RPC handler throws as "RPC call failed". `guarded()` in `src/rpc.ts` returns the declared `rejected` error instead, so every method in `src/contract.ts` must declare `errors`. A test enforces this.
- Stock plugin storage (2.2.7 and 2.3.0) has no `compareAndSet`. Code must work without it and with it.
- `src/relay-store.ts` keeps its own `serial()` queue, a copy of `src/settings.ts`'s, not a shared one: a stuck Relay storage read or write must never hold up the older pipeline's `getSelections`/`getPolicy` (its spend guard and permission checks). Don't merge the two queues back into one.
- `node:sqlite` is imported dynamically. Keep it that way so a runtime without it loses only the ledger.
- `src/` and `tests/` use CRLF line endings; docs and scripts use LF. Keep each file's own endings (`grep -c $'\r' <file>`).
- Tests must not touch a real data directory. `tests/plugin.test.ts` points `XDG_DATA_HOME` at a temp dir; give anything that opens the ledger an explicit temp root.
- Fake hosts in tests should behave like the real one. Use `asClient` in `tests/rpc.test.ts` for RPC handlers.
- Amounts are bigint-backed USD strings (`src/costs.ts`). Never use floating point for money.
- For a new guard, check red then green: break the guard, see the test fail, restore it.
- The product is called Relay, but its internal ids keep the old name on purpose: package `feature-pilot`, the `featurePilot*` session metadata keys, `<project>.feature-pilot/` worktrees, the `feature-pilot/` ledger directory and the `feature-pilot-run-v1` export format. Renaming them would orphan saved settings, runs and worktrees. Only text a person reads uses the new name.
- Mark a deliberate simplification with a `// shortcut:` comment that names its ceiling.
