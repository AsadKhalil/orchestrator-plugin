# Relay Stage 1b (the per-chat switch, and the terminal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `/relay on` and `/relay off` (and a pill in Desktop) make every message in one chat go through Relay, in Desktop and in the terminal app.

**Architecture:** a `prompt` session hook routes each message of a chat whose switch is on, reusing `/relay`'s placing step (decider, router, switches, review rules) but never sending the message itself; `/relay` marks its own send so the hook skips it. A per-chat flag in plugin storage, two RPC methods, and a `ComposerPill` in the GUI.

**Tech Stack:** TypeScript (ESM), `@opencode/plugin` 2.3.0, node:test through tsx, Solid for the panel.

**Spec:** `docs/superpowers/specs/2026-11-13-relay-chat-model-guidance-design.md`, "Stage 1b: the switch, and the terminal". Host facts: the 2026-11-16 entry of `docs/compatibility.md`.

**Status:** written 2026-11-16. The owner chose: per chat, push straight to `main`, real tests in their OpenCode stopping at $2, MIT. Tasks 1 to 5 are built and pushed (each closed with the four checks; 25 guards checked red then green; both isolated smokes PASS, the model smoke with the switch on and off). Task 6, the live check in the owner's OpenCode, waits for their yes at that moment.

## Global Constraints

- The four checks (`npm run typecheck`, `npm test`, `npm run build`, `node scripts/check-package.mjs`) run fresh at the end of each task, with the counts reported as printed.
- Tests first: each new behavior gets a failing test before the code; each new guard is broken once to see its test fail.
- The hook never throws (a throw fails the person's message). Every failure becomes a note in the record, and the message goes as it is.
- The message is never sent, dropped, doubled or changed by the hook; only the host sends it. `/relay`'s own send adds `metadata: { relay: 'sent' }`, which the host stores and does not send to the model.
- With the switch on, an answer under 0.6 changes nothing; `/relay` keeps its rule (under 0.6 means Plan).
- A busy chat is not waited for by the hook: a 300 ms check; when busy, nothing is switched.
- Every host and storage call in the hook is bounded by `readMs` (default 5 s), like `/relay`.
- The flag is `relay/on/<chat id>` in plugin storage, `true` or `false`. Nothing about it is kept only in memory.
- Every new RPC method declares `errors`. Panel files import nothing from `node:`.
- Only text a person reads says Relay; internal ids keep `feature-pilot`.

## Review Focus

1. **A message sent while the chat is busy, with the switch on.** It goes as it is, with no switch mid-turn, and the record says why. Test in Task 3.
2. **`/relay <message>` in a chat with the switch on.** Decided once: one decider request, one record. Tests in Tasks 2 and 3.
3. **A storage or host call that never answers inside the hook.** The hook returns within its bounds and never throws; the message is not held. Test in Task 3.
4. **The switch is per chat.** On in one chat changes nothing in another, nor in a helper's chat. Test in Task 3.
5. **What counts as a toggle.** `/relay on`, ` ON `, `/relay Off` toggle; `/relay on second thought…` is an ordinary message. Test in Task 2.

---

### Task 1: the router can leave an unsure answer alone; the flag in storage

**Files:** Modify `src/router.ts`, `src/relay-store.ts`. Test `tests/router.test.ts`, `tests/relay-store.test.ts`.

**Interfaces — Produces:**
- `route(answer, settings, models, attachment, current, unsure: 'plan' | 'stay' = 'plan'): RouteResult`. With `'stay'`, an answer under `UNSURE_BELOW` gives `{ switch: false, mode: null, note: 'not sure, so the chat stays as it is' }`.
- `chatSwitch(store: Pick<RelayStore, 'get'>, sessionID: string): Promise<boolean>` (true only for a stored `true`) and `setChatSwitch(store: Pick<RelayStore, 'set'>, sessionID: string, on: boolean): Promise<void>`, key `relay/on/${encodeURIComponent(sessionID)}`.

- [x] Tests: `'stay'` under 0.6 gives no switch with that note, at 0.6 it switches as before, `'plan'` unchanged; a chat's switch starts off, turns on and off, is per chat, and a stored non-boolean reads as off. Run, see them fail.
- [x] Implement. Run, see them pass. The four checks.

### Task 2: `/relay on`, `/relay off`, and `/relay` marks its own send

**Files:** Modify `src/relay-command.ts`. Test `tests/relay-command.test.ts`, `tests/relay-fakes.ts`.

**Interfaces — Produces:** `placeMessage(deps, timing, input): Promise<{ outcome, notes }>` (the placing step lifted out of `relay()`, behavior unchanged; `input.unsure` and `timing.waitMs` chosen by the caller); `/relay` sends `{ ...prompt, sessionID, delivery, metadata: { relay: 'sent' } }`.

- [x] Tests: `/relay on` and `/relay off` (any case, spaces around) set the flag and send nothing; they are refused in a pipeline chat; `/relay on second thought` is a message; a toggle joins the chat's queue in order; the send carries the marker. Run, see them fail.
- [x] Implement. Run, see them pass. The four checks.

### Task 3: the `prompt` hook

**Files:** Create `src/relay-auto.ts`; modify `src/index.ts`. Test `tests/relay-auto.test.ts`, `tests/plugin.test.ts`.

**Interfaces — Consumes:** `placeMessage` (Task 2), `chatSwitch` and `route(..., 'stay')` (Task 1). **Produces:** `relayAutoHook(deps: RelayDeps): (event: { sessionID; prompt; metadata?; delivery }) => Promise<void>`, registered with `context.session.hook('prompt', ...)`.

- [x] Tests: a message in a chat with the switch on is placed (agent, model, rules) and recorded, and nothing is sent by the hook; off, a marked message, a blank one and a pipeline chat are left alone with no decider request; unsure keeps the chat as it is; a busy chat is not switched and the record says so; a hanging flag read, chat read, model list or decider ends within the bounds and the hook never rejects; one chat on does not touch another; registration and disposal in the plugin. Run, see them fail.
- [x] Implement. Run, see them pass. The four checks.

### Task 4: RPC for the pill, and the pill

**Files:** Modify `src/contract.ts`, `src/rpc.ts`, `src/relay-view.ts`, `src/gui.tsx`. Test `tests/rpc.test.ts`, `tests/relay-view.test.ts`.

**Interfaces — Produces:** `getRelayChat({ sessionID }) → { on: boolean; last: Decision | null }` (the newest record for that chat), `setRelayChat({ sessionID, on }) → { on: boolean }`; `pillView(state)` → `{ label, tone, rows }` text; the Modes tab's switch sentence.

- [x] Tests: both methods declare errors, fit their schemas, read and set the flag, and `last` is that chat's newest record; the pill's words for on, off and a last choice. Run, see them fail.
- [x] Implement; register the pill with `ctx.add(ComposerPill, ...)` inside a guard so a host without the registry loses only the pill. Run, see them pass. The four checks.

### Task 5: the smoke and the records

**Files:** Modify `scripts/smoke-host-model.mjs`, `README.md`, `docs/implementation-progress.md`, `docs/compatibility.md`, this plan.

- [x] The model smoke also turns the switch on in its `/relay` chat, sends a plain message (one request, one record, no decider so no switch), sends a `/relay` message (one record, not two), turns the switch off, and sends one more (no record). Run both smokes on a fresh build.
- [x] Record the results; progress line; plan status.

### Task 6: live check in the owner's OpenCode (OWNER'S YES at that moment)

- [ ] Ask the owner. Install the build where their OpenCode loads it, version read first. Gate 1b and the open part of Gate 1, in Desktop and in the terminal, with their Ollama models; stop when the cost OpenCode reports reaches $2. Record what was seen and what was not.
