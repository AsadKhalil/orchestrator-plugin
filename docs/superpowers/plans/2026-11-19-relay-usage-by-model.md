# Relay usage by model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Running totals per model and effort of every message Relay places, priced by OpenCode or else by Artificial Analysis, shown in the panel and by `/relay-stats` in the terminal app.

**Architecture:** The idle hook already reads what each reply took; the same write now adds it to a `relay/usage` total. Artificial Analysis's free model list (with the owner's key) is fetched at most once a day into storage and gives prices when OpenCode lists none, and the index. A new terminal entry, `dist/tui.js`, registers `/relay-stats` and shows the totals from a new RPC call in a dialog.

**Tech Stack:** TypeScript (ESM), node:test through tsx, OpenCode 2.3 plugin API (server, GUI, TUI), Solid for the panel.

**Spec:** `docs/superpowers/specs/2026-11-19-relay-usage-by-model-design.md`

## Global Constraints

- Money is USD strings and bigint (`parseUsd`, `formatUsd`); never floats. A price of $0 for both input and output reads "$0 or not listed".
- The key is sent only to `https://artificialanalysis.ai/api/v2/language/models/free`, in `x-api-key`; it is never returned by an RPC, written in a record, a note or an error, or logged.
- Artificial Analysis's data is credited wherever it is shown: "Prices and index: Artificial Analysis (artificialanalysis.ai)".
- Hooks never throw; the idle hook never goes to the network and still holds a chat for one second at most.
- Every RPC method declares `errors`. CRLF in `src/`, `tests/`, `scripts/`, `docs/` and `AGENTS.md`. No new dependency.
- Facts from the owner's test key (19 Nov): free tier, 763 models in 4 pages of 200 (`pagination.has_more`); fields `slug`, `name`, `model_creator.name`, `release_date`, `evaluations.artificial_analysis_intelligence_index`, `pricing.price_1m_input_tokens`, `price_1m_output_tokens`, `price_1m_cache_hit_tokens`, `price_1m_cache_write_tokens` (numbers or null). One entry per effort: `claude-sonnet-5-5` is Max, `claude-sonnet-5-5-high` is High; all efforts share prices.

## Review Focus

- A reply read twice (two idle events, two OpenCode processes) is counted once.
- A refused key (401), a used-up day (429) or no network keeps the stored copy, says why, and never shows the key.
- A model Artificial Analysis does not list (free, preview, contributor) has no borrowed price; `mimo-v2.5` must not match `mimo-v2-5-pro`.
- Totals stored by another version (missing fields, extra fields, garbage) read as unknown, never throw.
- `/relay-stats` when the server part does not answer shows a toast, not a crash.

---

### Task 1: Totals in the store

**Files:** Modify `src/costs.ts`, `src/relay-store.ts`. Test `tests/relay-store.test.ts`.

**Interfaces:**
- Produces: `costOf(tokens: number, perMillion: string | null): bigint | null` (trillionths of a dollar; null for a null price).
- Produces: `type PriceSource = 'opencode' | 'artificial-analysis'`; `Reply` gains `pricesFrom: PriceSource | null` (read as null when missing).
- Produces: `type UsageRow = { model: string; messages: number; requests: number; input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; openCodeUsd: string | null; byPrice: { input: string | null; output: string | null; cacheRead: string | null; cacheWrite: string | null }; prices: Prices | null; pricesFrom: PriceSource | null }`, `type Usage = { since: string | null; rows: UsageRow[] }`, `getUsage(store): Promise<Usage>` (rows sorted by model).
- Changes: `saveReplies(store, sessionID, replies, now = Date.now())` adds each reply it keeps to the row named `reply.model ?? 'unknown model'`, in the same queued step, stored at `relay/usage`.

- [ ] **Step 1: Failing tests** — `each reply is added once to the totals of its model and effort`: save a reply on `p/m#high` (input 5762, output 15, cache read 28572, cache write 300, cost '0.057313', prices 3 / 15 / 0.3 / 3.75), save it again, save one on `p/n`; expect one row for `p/m#high` with messages 1, requests 3, `byPrice` `{ input: '0.017286', output: '0.000225', cacheRead: '0.0085716', cacheWrite: '0.001125' }`, and `since` set. `a reply with no price adds tokens and no cost by price`. `totals that cannot be read start again`: stored `'garbage'` and a row with `requests: 'x'` read as no row.
- [ ] **Step 2:** `npx tsx --test tests/relay-store.test.ts` fails on the missing functions.
- [ ] **Step 3:** Implement `costOf`, the types, `getUsage`, and the addition in `saveReplies`. Mark with `// shortcut:` that two OpenCode processes saving the same reply in one instant can count it twice.
- [ ] **Step 4:** The file's tests pass; `npm test` passes.

### Task 2: Artificial Analysis's list and the key

**Files:** Create `src/artificial-analysis.ts`. Test `tests/artificial-analysis.test.ts`.

**Interfaces:**
- Consumes: `modelKey`, `IndexTable` from `src/intelligence.ts`; `usdString` from `src/costs.ts`; `Prices` from `src/relay-store.ts`.
- Produces: `AA_LIST_URL`, `AA_SOURCE = 'Artificial Analysis Intelligence Index, from Artificial Analysis'`, `AA_CREDIT = 'Prices and index: Artificial Analysis (artificialanalysis.ai)'`.
- Produces: `type AaModel = { slug: string; name: string; creator: string; released: string | null; index: number | null; prices: Prices }`; `parseAaPage(body: unknown): { models: AaModel[]; more: boolean }`; `fetchAaModels(key: string, fetcher: typeof fetch, ms?: number): Promise<AaModel[]>` (pages 1 to 5 at most); `loadAaModels(store, key, fetcher, now): Promise<{ models: AaModel[]; fetchedAt: string | null; note: string | null }>` (stored at `relay/aa-models`, refreshed when a day old, like `loadIndexTable`); `storedAaModels(store): Promise<AaModel[]>` (no network); `aaFor(model: { providerID: string; id: string; name: string; variant: string | null }, models: readonly AaModel[]): AaModel | null`; `aaIndexTable(models): IndexTable`; `getPriceKey(store): Promise<string | null>`; `setPriceKey(store, key: string | null): Promise<void>` (stored at `relay/aa-key`; null removes it and `relay/aa-models`).

- [ ] **Step 1: Failing tests**, with made-up models shaped like the real list (no copied data):
  - `a page becomes models with prices as USD strings and the index`: price 1.4 reads `'1.4'`, null cache write reads null, `more` follows `pagination.has_more`.
  - `every page is fetched with the key, and only from Artificial Analysis`: the fake fetcher sees `AA_LIST_URL?page=1` and `?page=2`, each with `x-api-key`, and no other URL.
  - `a refused key or a used-up day keeps the stored copy and says why, without the key`: 401 note "the key was refused", 429 note "today's 100 requests are used up", and the key string in no note.
  - `matching`: `p/glm-5.3` finds `glm-5-3`; `p/mimo-v2.5` finds nothing beside `mimo-v2-5-pro`; `claude-agent/sonnet` with variant `high` finds the newest Anthropic `claude-sonnet-…-high`, and with variant null the base entry.
  - `the key`: saved and read back; `'  '`, a key with a space and one over 200 characters are refused; null removes it and the stored list.
- [ ] **Step 2:** The file fails on the missing module.
- [ ] **Step 3:** Implement. `aaFor`: exact `modelKey` match on slug or name for `${id}-${variant}` first, then `${id}`, with the clash rule of `indexTable`; for `claude-agent` and ids `sonnet`, `haiku`, `opus` and `fable`, the base is the newest Anthropic slug `claude-${id}-<version>` with no effort suffix. Errors name the HTTP status, never the key.
- [ ] **Step 4:** The file's tests pass; `npm test` passes.

### Task 3: A reply priced by Artificial Analysis when OpenCode lists no price

**Files:** Modify `src/chat-facts.ts`, `src/relay-auto.ts`, `src/relay-command.ts` (the `RelayDeps` type), `src/index.ts`. Tests `tests/chat-facts.test.ts`, `tests/relay-auto.test.ts`, `tests/plugin.test.ts`.

**Interfaces:**
- Consumes: `AaModel`, `aaFor`, `storedAaModels` (Task 2); `PriceSource` (Task 1).
- Produces: `replyOf(messages, messageID, models = null, borrowed: readonly AaModel[] | null = null)`. OpenCode's price wins when its input or output price is a non-zero amount (`pricesFrom: 'opencode'`); else the Artificial Analysis match (`'artificial-analysis'`); else OpenCode's empty prices with `pricesFrom: null`.
- Produces: `RelayDeps.borrowedPrices?: () => Promise<AaModel[]>`; the idle hook reads it beside the model list, bounded the same way; `index.ts` passes `() => storedAaModels(context.storage)`.

- [ ] **Step 1: Failing tests** — `chat-facts`: a `claude-agent/sonnet#high` answer with an unpriced listing and a borrowed `claude-sonnet-5-5-high` gets `pricesFrom 'artificial-analysis'` and its prices; a priced listing keeps `'opencode'`. `relay-auto`: the hook keeps borrowed prices, and a failing `borrowedPrices` still keeps the reply. `plugin.test`: the registered hook reads the stored list.
- [ ] **Step 2–4:** fail, implement, pass; `npm test` passes.

### Task 4: The calls

**Files:** Modify `src/contract.ts`, `src/rpc.ts`. Test `tests/rpc.test.ts`.

**Interfaces:**
- Produces: `getRelayUsage: { errors, input: nothing, output: { directory, since, rows: UsageRow[], credit: string | null } }` (storage only, so the panel can ask every few seconds; `credit` is `AA_CREDIT` when a row is priced by it or a key is saved).
- Produces: `setPriceKey: { errors, input: { key: string | null }, output: { saved: boolean } }`; `getRelay` output gains `priceKey: boolean`.
- Changes: `listIntelligence` uses `loadAaModels` and `aaIndexTable` when a key is saved (source `AA_SOURCE`, the credit in the note), else OpenRouter as now; when Artificial Analysis gives nothing, OpenRouter with a note.

- [ ] **Step 1: Failing tests** — usage fits what `getRelayUsage` declares; after `setPriceKey`, `getRelay` says `priceKey: true` and no output of any call contains the key; `listIntelligence` with a saved key and a fake fetcher reports `AA_SOURCE`, and with a 401 falls back to OpenRouter with a note.
- [ ] **Step 2–4:** fail, implement, pass; `npm test` passes.

### Task 5: The words

**Files:** Modify `src/relay-view.ts`. Test `tests/relay-view.test.ts`.

**Interfaces:**
- Produces: `usageText(view: { since: string | null; rows: readonly UsageRow[]; credit: string | null }): string` for the dialog, and `usageCells(row: UsageRow): { model: string; effort: string; requests: string; input: string; output: string; cacheRead: string; cacheWrite: string; cost: string; byPrice: string[] }` for the panel.

- [ ] **Step 1: Failing tests** — exact text for two rows, one priced by OpenCode and one by Artificial Analysis (cost marked `*`, a footnote "* at Artificial Analysis prices", the credit line, and per-kind lines such as `in 12,300 x $2 a million = $0.0246`); an unpriced row's cost reads "not listed"; with no rows: "No reply counted yet. Relay counts every message it places: /relay, or any message in a chat with Relay on."
- [ ] **Step 2–4:** fail, implement, pass.

### Task 6: The panel

**Files:** Modify `src/gui.tsx`.

- [ ] **Step 1:** A "Usage by model" `Acc` above Recent choices: a table of `usageCells`, the cost-by-price lines under each row, the credit; asked for with Recent choices every 5 seconds.
- [ ] **Step 2:** In the settings, "Artificial Analysis key": a password field with Save and Remove calling `setPriceKey`, "saved" or "not saved" from `priceKey`, and a link to artificialanalysis.ai's key page. The field is cleared after Save.
- [ ] **Step 3:** `npm run typecheck` and `npm run build` pass.

### Task 7: The terminal

**Files:** Create `src/tui.ts`, `tests/tui.test.ts`. Modify `package.json` (export `"./tui": "./dist/tui.js"`), `scripts/check-package.mjs` (require `dist/tui.js`), `tests/plugin.test.ts`.

**Interfaces:**
- Consumes: `RelayRpc`, `usageText`, `describeError`.
- Produces: default export `{ id: 'relay-opencode', setup(ctx) }`; no runtime import from `@opencode/plugin/tui` (its index pulls in Solid). `setup` adds a keymap layer with one command: `id 'relay-opencode.stats'`, `title 'Relay: usage by model'`, `palette: true`, `slash: { name: 'relay-stats' }`; `run` calls `ctx.client.rpc(RelayRpc).getRelayUsage({}, { location: ctx.location ?? ctx.data.location.default() })` and shows `ctx.ui.dialog.alert({ title: 'Relay: usage by model', message: usageText(value) })`; a failure shows `ctx.ui.toast.show({ variant: 'error', title: 'Relay', message })`.

- [ ] **Step 1: Failing tests** — with a fake context: the layer has the slash command `relay-stats`; `run` asks `getRelayUsage` with the location and shows the dialog with `usageText`'s text; a failing call shows an error toast and resolves. `plugin.test`: the terminal part's id is the package name.
- [ ] **Step 2–4:** fail, implement, pass; `npm run build` then `node scripts/check-package.mjs` lists `dist/tui.js`.

### Task 8: Records and release

**Files:** `docs/guide.md`, `docs/privacy.md`, `docs/status.md`, `docs/implementation-progress.md`, `docs/compatibility.md`, `AGENTS.md`, `README.md` (one line for `/relay-stats`), `scripts/smoke-host-model.mjs`.

- [ ] **Step 1:** The smoke checks that the host lists the plugin with its terminal part, and that `getRelayUsage` holds the smoke's replies per model.
- [ ] **Step 2:** Docs: the table, `/relay-stats`, the key and what is sent where (`privacy.md`), the credit, the owner's one-check leave of 19 Nov in `compatibility.md` and in `AGENTS.md`'s Never line, Relay's second network request in `AGENTS.md`.
- [ ] **Step 3:** The four checks fresh, the smoke on the 2.3.2 CLI, commit, push only this work, and GitHub's checks on three systems.
