# AGENTS.md

Relay (package `relay-opencode`) is an unfinished OpenCode 2.3.0 plugin (TypeScript, ESM). `/relay <message>` in the normal OpenCode chat asks a decision model whether the message is plan, execute or review and which of that mode's models fits it, switches the chat to that model, and sends the message. After `/relay on` in a chat (or the pill above its chat box), every message there is placed the same way until `/relay off`. The side panel is settings only: the modes, the decider, and Recent choices. An older pipeline that planned, implemented and reviewed a feature from the side panel was removed on 17 Nov 2026 (it is in the git history). `README.md` has the current state; `docs/superpowers/specs/2026-11-13-relay-chat-model-guidance-design.md` has the intent. This file lists only what the code does not make obvious.

## Commands

- `npm run typecheck` · `npm test` (node:test through tsx, `tests/*.test.ts`) · `npm run build` (clears `dist/`, then tsc, then the Vite GUI bundle) · `node scripts/check-package.mjs`. CI runs all four on Linux and Windows.
- The real-host smoke needs a prior `npm run build` and `RELAY_SMOKE_CLI=<path to an opencode 2.3.0 binary>`: `npm run smoke:host:model`. It installs the packed plugin into an isolated server with scratch directories, loopback ports, a synthetic key and a mock model. CI runs it on Linux, macOS and Windows with the binary from `@opencode/cli-<os>-<arch>@2.3.0`.
- Run the four checks fresh before saying anything passes, and report the counts as printed.

## Never

- Install, load or test the plugin in a real OpenCode profile or Desktop, or use real or paid credentials. Isolate with `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`, a throwaway server password, and the mock provider in `scripts/smoke-host-model.mjs`. The owner can lift this for one named step, as they did on 14 Nov 2026 for the Desktop check and for the decider's example run (made-up messages to a free decision model from an isolated host), on 16 Nov for the live check with their Ollama models, and on 17 Nov for tests with their Claude models. Such a yes covers that step only, and the step is recorded in `docs/compatibility.md`.
- Merge anything. The owner chose pushes straight to `main` (16 Nov 2026); a pull request is merged only by a person.
- Call something verified when it only ran against fakes. Record host findings in `docs/compatibility.md` with platform, version and what was not tested, and add a line to `docs/implementation-progress.md`.

## Invariants

- The person's message is never dropped, doubled or changed. `/relay` sends it once, with the delivery it was given; the switch's hook never sends. Whatever fails before the send becomes a note in the record, and the message goes to the chat's current model.
- Plan and Review put the chat on OpenCode's `plan` agent; only Execute uses `build`. Relay never changes the permission settings of OpenCode's agents.
- An answer under 0.6 (`UNSURE_BELOW`): `/relay` moves the chat to Plan; with the switch on, the chat stays as it is.
- Nothing about a chat is switched while it is working: `/relay` waits for it (up to two minutes), and the switch's hook checks for 300 ms and otherwise leaves it alone.
- Relay's only model requests are the decider's, and they are not reserved against any budget (the owner, 14 Nov 2026: "i dont want a budget feature please ignore it we see it later"). There is one for each `/relay`, one for each message in a chat with the switch on, one for each helper that a model starts, and one for each try in the panel's test box. Each is limited by its size instead (4,000 characters of text, eight "use it for" lines of 200 characters for a mode, ten file names), and only a decision model can be the decider.

## Gotchas

- The host reports any error an RPC handler throws as "RPC call failed". `guarded()` in `src/rpc.ts` returns the declared `rejected` error instead, so every method in `src/contract.ts` must declare `errors`. A test enforces this.
- Stock plugin storage (2.2.7 and 2.3.0) has no `compareAndSet`. Code must work without it and with it. `src/relay-store.ts` serializes its own reads and writes; without `compareAndSet`, a save from two OpenCode processes in the same instant can still lose one, and the revision check catches every other stale save.
- The switch's `prompt` hook (`src/relay-auto.ts`) runs for every message in every chat, before the message goes out. It must never throw, because a throw fails the person's message, and everything it waits for is bounded. `/relay` marks its own send with `metadata: { relay: 'sent' }` so the hook skips it; keep that marker, or a `/relay` message in a chat with the switch on is decided twice.
- The panel bundles `router.ts`, `decider.ts`, `relay-store.ts`, `relay-view.ts`, `settings.ts` and `costs.ts`. Nothing they import may come from `node:`.
- Most files use CRLF line endings (`src/`, `tests/`, `scripts/`, `AGENTS.md`, most of `docs/`); `README.md` and `CONTRIBUTING.md` use LF. Keep each file's own endings. Check them with Node: in Git Bash, `grep -c` with a carriage return can print 0 for a CRLF file.
- Tests must not touch a real data directory or profile. Nothing in `src/` opens a file of its own; keep it that way, or give it an explicit temp root in tests.
- Fake hosts in tests should behave like the real one. Use `asClient` in `tests/rpc.test.ts` for RPC handlers.
- Prices are USD strings (`usdString` in `src/costs.ts`), compared exactly with `parseUsd` (bigint). Never use floating point for money. A catalog price of 0/0 reads "$0 or not listed", never "free".
- For a new guard, check red then green: break the guard, see the test fail, restore it.
- The package name, the plugin id and the RPC id are one name, `relay-opencode` (the owner had it renamed from `feature-pilot` on 17 Nov 2026), and a test in `tests/plugin.test.ts` keeps them equal. The host keeps each plugin's storage under its id (the keys start with `plugin:` and the id in UTF-16 hex), so a new id starts everyone with empty settings, switches and records: the 17 Nov rename did, and the owner chose to set their models again. Don't rename it again without the owner's yes.
- The owner's own OpenCode loads this folder's `dist/`, so each `npm run build` makes it reload Relay within a minute. On 17 Nov such a reload was followed by OpenCode's background service stalling and its replacement failing to open the database ("disk I/O error"), which leaves Desktop stuck until that process is ended (the owner's yes is needed for that). Build only when you need to, and check the service afterwards.
- Mark a deliberate simplification with a `// shortcut:` comment that names its ceiling.
