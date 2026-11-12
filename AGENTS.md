# AGENTS.md

Feature Pilot is an unfinished OpenCode 2.2.7 plugin (TypeScript, ESM) that plans, implements and reviews a feature with user-chosen models. `README.md` has the current state; `opencode-feature-pilot-plan.md` and `opencode-feature-pilot-design.md` have the intent. This file lists only what the code does not make obvious.

## Commands

- `npm run typecheck` · `npm test` (node:test through tsx, `tests/*.test.ts`) · `npm run build` (tsc, then the Vite GUI bundle into `dist/`) · `node scripts/check-package.mjs`. CI runs all four on Linux and Windows.
- Real-host smokes need a prior `npm run build` and `FEATURE_PILOT_SMOKE_CLI=<path to an opencode 2.2.7 binary>`: `npm run smoke:worktree`, `smoke:host`, `smoke:host:model`. They use scratch directories, loopback ports and synthetic keys.
- Run the four checks fresh before saying anything passes, and report the counts as printed.

## Never

- Install, load or test the plugin in a real OpenCode profile or Desktop, or use real or paid credentials. Isolate with `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`, a throwaway server password, and the mock provider in `scripts/smoke-host-model.mjs`.
- Merge anything. Delivery is a draft pull request for an accepted run only.
- Call something verified when it only ran against fakes. Record host findings in `docs/compatibility.md` with platform, version and what was not tested, and add a line to `docs/implementation-progress.md`.

## Invariants (all fail closed)

- Every plugin-owned model request reserves its worst-case cost first (`src/spending.ts`). With no atomic ledger there is no request. The ledger is the host's compare-and-set storage when it has it, else a local SQLite file (`src/budget-ledger.ts`, `src/local-ledger.ts`).
- Sessions the plugin creates start deny-all. A coder gets actions only while `coderEnabled` is on.
- A failed or ambiguous stage pauses the run (`needs_attention`) and is never retried automatically. Stage checkpoints decide what a resume may repeat.
- Service plan steps stay gated (`unsupported_step`) until OpenCode gives plugins verified shell inspect and stop. See `docs/opencode-host-requirements.md`.

## Gotchas

- The host reports any error an RPC handler throws as "RPC call failed". `guarded()` in `src/rpc.ts` returns the declared `rejected` error instead, so every method in `src/contract.ts` must declare `errors`. A test enforces this.
- Stock 2.2.7 plugin storage has no `compareAndSet`. Code must work without it and with it.
- `node:sqlite` is imported dynamically. Keep it that way so a runtime without it loses only the ledger.
- `src/` and `tests/` use CRLF line endings; docs and scripts use LF. Keep each file's own endings (`grep -c $'\r' <file>`).
- Tests must not touch a real data directory. `tests/plugin.test.ts` points `XDG_DATA_HOME` at a temp dir; give anything that opens the ledger an explicit temp root.
- Fake hosts in tests should behave like the real one. Use `asClient` in `tests/rpc.test.ts` for RPC handlers.
- Amounts are bigint-backed USD strings (`src/costs.ts`). Never use floating point for money.
- For a new guard, check red then green: break the guard, see the test fail, restore it.
- Mark a deliberate simplification with a `// shortcut:` comment that names its ceiling.
