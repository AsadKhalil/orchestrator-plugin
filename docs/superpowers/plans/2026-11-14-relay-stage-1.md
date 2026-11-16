# Relay Stage 1 (`/relay` in the chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `/relay <message>` in the normal OpenCode chat asks a decision model whether the message is plan, execute or review and which of that mode's "use it for" lines fits it, switches the chat to that model, and sends the message once, unchanged; a helper that checks work starts on a Review model with rules that make the review end.

**Architecture:** A pure router and a small decider adapter sit behind one server-side slash command and one tool hook, both registered in the existing `createRuntime` (`src/index.ts`). The three mode lists (each entry with its "use it for" line), the decider and the last 20 decisions live in plugin storage, which the host shares between projects. The old pipeline's code, guards and screens stay as they are.

**Tech Stack:** TypeScript (ESM, Node 24), `@opencode/plugin`, `@opencode/client` and `@opencode/schema` 2.3.0, `effect` 4.1.0, Solid for the panel, `node:test` through `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-13-relay-chat-model-guidance-design.md`, Stage 1, Gate 1 and the section "Choosing among a mode's models". What the host really does is in the 13 Nov and 14 Nov entries of `docs/compatibility.md`. Read both before starting a task.

**Status:** written on 2026-11-14 from the approved design. Later that day the owner asked for a choice among a mode's models and then said "update the plan and implement it". The plan was changed for that (the design's section "Choosing among a mode's models") and is being carried out inline, in the working tree, with no commits. Question 1 is answered: "i dont want a budget feature please ignore it we see it later". Tasks 1 to 10 are built, and each of their sections shows the tests as they are in the repo. A fresh whole-branch review (2026-11-15, Opus 5.5) found two Critical and three Important issues — two-way message ordering, a host call that could hang `/relay`, a helper, or (through a queue Relay shared with the older pipeline) the pipeline's own spend guard; an emoji at a file-name cut; a busy-wait that ran even when nothing needed changing; and a privacy sentence that did not mention helper task text — all five are fixed, each with its own test, and the whole suite and both isolated smokes pass on the fixed build. Six Minor findings and eight items the reviewer declined to judge are rulings in `progress.md`, not code changes. Their open boxes are the commits, which nobody asked for, and in Task 10 the owner's check of the labels. Task 11 is not started: its install into Desktop needs the owner's yes at that moment. Progress and rulings: `.superpowers/sdd/2026-11-14-relay-stage-1/progress.md` (not in git) and `docs/implementation-progress.md`.

## Global Constraints

- **Checks.** Every task ends with `npm run typecheck`, `npm test`, `npm run build` and `node scripts/check-package.mjs`, run fresh, with the counts reported as printed. On 14 Nov they printed: 395 tests, 392 pass, 0 fail, 3 skipped; "Package check passed: 97 files".
- **Progress line.** Every task adds one dated line to `docs/implementation-progress.md`: what changed, and the four results as printed.
- **The owner's yes.** Never install, load or test in the real OpenCode profile or Desktop, and never make a real model request, without the owner's yes at that moment. Steps that need it are marked **OWNER'S YES**. A yes covers that step only. On 14 Nov the owner said yes to the run in Task 10: made-up messages to the free decision model from an isolated OpenCode with no login, at most 90 requests (30 for each run, up to 3 runs). Two runs were made, 60 requests; that yes is used up for anything else.
- **Commits.** None unless the owner has said so. If they have: a local branch `relay-stage-1` whose first commit is the tree as it is today, then one commit for each task, each message ending with the `Co-Authored-By` line of the agent that made it. Never push, never merge. Otherwise skip every "Commit" step.
- **The message.** One `session.prompt` call for each `/relay`, with `{ ...prompt, sessionID, delivery }` exactly as received. Never dropped, never sent twice, never changed.
- **The agent.** Only a sure Execute decision moves the chat to `build`. Plan and Review use `plan`. Confidence below 0.6 means Plan. No answer means no switch.
- **The model.** Inside the mode, models that are not offered, cannot take an attached picture or have no room for the attached files are dropped. One model left: that one. No "use it for" lines: the first. A line answered with 0.5 or more: its model. Otherwise the chat keeps its model if it is usable in the mode, and else the first is used.
- **Order of host calls.** Agent, then model, then the message. A step that fails is noted and the message is still sent. A send that fails is reported and not repeated.
- **The decider.** A decision model only, through `context.experimental.generate.decisions`. It gives up after 5 seconds. Text over 4,000 characters is cut to the first 2,000 and the last 2,000. One request holds the mode question and, for each mode that needs it, one question over that mode's "use it for" lines (at most 8). It is told the names and sizes of up to 10 attached files. It is never given file contents, images, earlier messages, model names or prices.
- **Records.** Chat id, mode, model, confidence, how sure the line answer was, time taken, cost and a note. Never the message text or a file name.
- **No budget work.** Decider requests are not reserved, and nothing for `/relay` touches the ledger or shows a cost ceiling (the owner, 14 Nov). The caps on what is sent stay.
- **Money.** A bigint-backed USD string (`src/costs.ts`), never a float. A price of 0 in and 0 out reads "$0 or not listed", never "free".
- **Names.** Internal ids keep the old name (`feature-pilot`, `featurePilot*`, panel id `models`). Only text a person reads says Relay.
- **RPC.** Every method declares `errors` (`src/contract.ts:40`). A test enforces it (`tests/rpc.test.ts:223`).
- **Line endings.** This checkout has `core.autocrlf=true`, so every file is CRLF on disk. Write new files with CRLF, keep each file's endings, and check with `node -e`, not `grep`.
- **Guards.** A new guard is checked red then green: break it, see its test fail, restore it. A deliberate simplification gets a `// shortcut:` comment that names its ceiling.
- **Memory.** OpenCode sets plugins up again about once an hour. Nothing that matters is kept only in memory.
- **Panel bundle.** `src/router.ts`, `src/decider.ts` and `src/relay-store.ts` are imported by the panel. They must not import anything from `node:`.
- **Smokes.** They need `npm run build` and `FEATURE_PILOT_SMOKE_CLI` set to an OpenCode 2.3.0 CLI. On the owner's PC that is the one bundled with Desktop (`%LOCALAPPDATA%\Programs\ai.opencode.desktop\resources\opencode-cli.exe`); read its version first, because Desktop updates itself. A smoke uses scratch folders, a loopback mock provider and a made-up key, and makes no real request: every chat it creates names a mock model. Known gap: an isolated OpenCode still lists the skills in the owner's home folders; their names go only to the mock model on this machine.
- **Honesty.** Nothing is called verified when it only ran against fakes. Host findings go to `docs/compatibility.md` with platform, version and what was not tested.

## Review Focus

Seven things the design implies but its own test list does not cover, most likely first (6 and 7 came with the choice among a mode's models). Each has a test in the task that owns the code.

1. **Two `/relay` messages overlap in one chat** (typed again because nothing seemed to happen while the chat was busy). Each must be answered by its own mode's model, in the order typed. Test in Task 7.
2. **A mode's model has no effort set, or the chat is already on the chosen agent and model.** The switch must carry no `variant` key, and a chat that is already there is not switched again (the host reports "no effort" as `default`). Test in Task 7.
3. **Reading the settings, the chat or the model list fails while `/relay` runs.** The message must still be sent once, unchanged. (When Relay cannot tell whether the chat belongs to a pipeline run, it refuses instead and nothing is sent; see Task 7.) Test in Task 7.
4. **The tool hook sees every tool call, not only the start of a helper.** A `bash` or `read` call must pass straight through with no storage read, no model list and no decider call. Helpers of a pipeline chat are left alone. Test in Task 8.
5. **A long message with emoji at the cut.** The text sent to the decider must never hold half a character. Test in Task 5.
6. **The decider answers the mode but not the line question, or names a line that is not there.** The mode is still used, and the model falls back by rule. Tests in Tasks 4 and 5.
7. **A file whose size cannot be read, or a disk that does not answer.** The size counts as 0, reading gives up after 1 second, and the message is still sent once. Test in Task 7.

---

## How the design's tasks map here

| Design, Stage 1 | Here |
|---|---|
| 1 records | Task 1 |
| 3 catalog cost, and the model-list part of 5 | Task 2 (moved first: saving the decider needs the list of decision models) |
| 2 settings | Task 3 (storage) and Task 6 (RPC) |
| 4 router | Task 4 |
| 5 decider | Task 5 |
| 6 the command, with its tests from 8 | Task 7 |
| 7 checks on the Review model, with its tests from 8 | Task 8 |
| 9 panel | Task 9 |
| 10 examples | Task 10 |
| 11 live check, Gate 1 | Task 11 |

## What the design left to the builder (my choices)

- **Names.** Storage keys `relay/settings` and `relay/decisions`. RPC methods `getRelay`, `saveRelay`, `testDecider`. Command `relay`. Instruction key `relay-review-rules`.
- **Decisions** are one stored list of the last 20.
- **The panel** learns of a new decision when the tab opens and on Refresh. It does not poll.
- **A switch to the agent or model the chat is already on is skipped**, so the chat gets no needless "Switched to" line.
- **An `@` file's position** is forwarded unchanged (that delivered the file on 14 Nov).
- **The wait for a busy chat** ends after 2 minutes (120 seconds). The message then goes unchanged, with the reason. Relay waits only when it is about to switch.
- **No cost ceiling is shown.** The first version of this plan counted the most one decision can cost. It was dropped on 14 Nov with the budget question; the panel shows the decider's price.
- **The line questions** are named `plan_line`, `execute_line` and `review_line`. Their choices are `1` to `8`, with the line as the description, and `none`. A line counts from a confidence of 0.5.
- **Room for files** is the attached files' bytes divided by 4, against the model's context window. Reading the sizes gives up after 1 second.
- **The test box** shows what Relay would do with the sample: the mode after the 0.6 rule, the model and the note.
- **A model with more than one price tier** shows its base tier and is marked.
- **The decider's question** is worded for any text, so that one question serves chat messages and helper tasks. It differs a little from the wording that ran on 14 Nov. Task 10 measures it.
- **The review rules stay on a chat** until a later `/relay` picks another mode. If the person changes the model by hand in between, the rules stay.

Added beyond the design's task list, also mine:

- Commands for one chat run one after another (Review Focus 1).
- When Relay cannot tell whether a chat belongs to a pipeline run, because plugin storage is failing, `/relay` refuses and sends nothing. In that state the pipeline's guards already refuse every request in every chat.
- The tool hook leaves the helpers of a pipeline chat alone.
- Task 7 ends with a run in an isolated OpenCode with mock models, before anything reaches the real Desktop.
- The panel opens on Modes, says where the message text is sent, and shows the review rules as text. The design lists the last two for the panel as a whole; they are here because helpers are routed from this stage on.

## Words and values every task shares

Notes a person can read. Several notes are joined with `; `. `<Mode>` is `Plan`, `Execute` or `Review`. A `<message>` is cut to 200 characters. The two time notes are built from their limits, in seconds.

| When | Note |
|---|---|
| no decider is chosen | `no decider chosen` |
| the decisions call throws, or answers with the type `error` | `the decider gave no answer: <message>` |
| the answer cannot be read | `the decider's answer could not be read` |
| over the time limit | `the decider took longer than 5 seconds` |
| confidence below 0.6 | `not sure, so Plan` |
| the mode's list is empty | `no model chosen for <Mode>` |
| nothing in the list is offered | `no chosen <Mode> model is offered right now` |
| a picture, and none of the offered choices takes one | `no chosen <Mode> model takes pictures` |
| the attached files fit none of the choices that are left | `the attached files are too big for every chosen <Mode> model` |
| no line fits (the decider chose none, or was under 0.5) | `no line fits clearly, so the chat's model stays` or `no line fits clearly, so the first model is used` |
| the decider did not answer the line question | `no answer about the lines, so the chat's model stays` or `no answer about the lines, so the first model is used` |
| the chat stays busy | `the chat was still busy after 120 seconds` |
| settings or the model list cannot be read | `Relay's settings could not be read: <message>` |
| a step fails | `agent not switched: <message>`, `model not switched: <message>`, `review rules not set: <message>` |
| the send fails | `the message could not be sent: <message>` |
| a helper's task is not a check | `not a check` |
| a helper's task may be a check, but the decider is not sure | `not sure it is a check` |
| the hook itself fails | `helper left alone: <message>` |

The decider's question, used for chat messages and for helper tasks:

```ts
{ type: 'choice', name: 'mode',
  instructions: 'Which mode fits the text? Choose execute only when it clearly asks to change, create, fix or run something now. Choose review when it asks to check existing work and report, with nothing to change. Otherwise choose plan.',
  choices: [
    { value: 'plan', description: 'Think, explain, investigate, design or plan. Nothing is changed.' },
    { value: 'execute', description: 'Write, change, create, fix or run something now.' },
    { value: 'review', description: 'Check existing work for mistakes and risks, and report them.' },
  ] }
```

The line question, one for each mode that has two or more usable models and at least one line (its name is `<mode>_line`):

```ts
{ type: 'choice', name: 'plan_line',
  instructions: 'Which description of work fits the text best? Choose none when no description fits clearly.',
  choices: [
    { value: '1', description: '<the first usable line>' },
    { value: '2', description: '<the second usable line>' },
    { value: 'none', description: 'None of these fits clearly.' },
  ] }
```

The one text input. For a chat message: `The person's message: "<text>"` then a new line and `The chat is on the agent: <agent or unknown>. Attached files: <files>. Attached pictures: <m>.` Here `<files>` is `none`, or up to 10 entries such as `a.txt (2 kB), notes.md (size unknown)`, followed by ` and <k> more` when there are more. For a helper: `A task that a model is handing to a helper: "<text>"`.

The review rules, set on a chat in Review mode and added to the task of a checking helper:

```ts
export const REVIEW_RULES_KEY = 'relay-review-rules';
export const reviewRules = [
  'When you review work in this chat, follow these rules.',
  '1. Report a blocking finding only when you have concrete evidence of a defect or of an unmet requirement. Everything else is an advisory note, and a note never calls for another round.',
  '2. End every review with a verdict: "approve" or "request changes". Approve when no blocking finding remains.',
  '3. When you check work again after a fix, look only at whether the earlier blocking findings are fixed and whether the fix broke something. Do not start a new full review.',
  '4. One piece of work gets at most three checks. After the third, stop and list what is still open so the person can decide.',
].join('\n');
```

## File structure

| File | What it is for |
|---|---|
| `src/costs.ts` (change) | `usdString`: a host number becomes a USD string or unknown |
| `src/inventory.ts` (change) | the model list gains prices, and can ask for decision models |
| `src/settings.ts` (change) | exports its two model-choice checks; behaviour unchanged |
| `src/relay-store.ts` (new) | what Relay keeps in plugin storage: the settings and the last 20 decisions |
| `src/router.ts` (new) | pure rules: which models are usable, which lines to ask about, and answer + settings + models + attachment + the chat's model → switch or no switch; the review rules text |
| `src/decider.ts` (new) | builds the questions, cuts the text, names the files, calls the host, gives up after 5 s, reads the answers |
| `src/contract.ts`, `src/rpc.ts` (change) | `listModels` gains prices; `getRelay`, `saveRelay`, `testDecider` |
| `src/relay-command.ts` (new) | the `/relay` command |
| `src/review-helper.ts` (new) | the tool hook that starts a checking helper on a Review model |
| `src/index.ts` (change) | registers the command and the hook |
| `src/relay-view.ts` (new) | the words of the Modes tab: a price, the last choice, a try, what is sent to the decider, the checks line |
| `src/gui.tsx`, `src/gui-styles.ts` (change) | the Models tab becomes Modes |
| `tests/relay-fakes.ts` (new) | one fake host for the command and hook tests |
| `scripts/relay-examples.json`, `scripts/decider-examples.ts` (new) | the 30 examples and the script that runs them |

---

### Task 1: Records and the 2.3.0 packages

**Files:**
- Modify: `package.json:17-19`, `package-lock.json`, `AGENTS.md`, `README.md:12,18,31`, `docs/desktop-testing.md:15`, `scripts/smoke-host.mjs:3`, `scripts/smoke-host-model.mjs:1,4,139`

**Interfaces:**
- Consumes: nothing.
- Produces: the three `@opencode/*` packages at 2.3.0 for every later task.

- [x] **Step 1: the three `AGENTS.md` changes**

C was the design's question 1, and the owner answered it on 14 Nov: "i dont want a budget feature please ignore it we see it later". A and B describe what the owner had already decided, so they were written without a separate stop and are shown to the owner in the final report. As written:

A. The opening paragraph (line 3):

> Relay (package `feature-pilot`) is an unfinished OpenCode 2.3.0 plugin (TypeScript, ESM). What it is becoming: `/relay <message>` in the normal OpenCode chat asks a decision model whether the message is plan, execute or review and which of that mode's models fits it, switches the chat to that model, and sends the message. The side panel is settings only. The older pipeline that plans, implements and reviews a feature from the side panel is still in the code and is not the product. `README.md` has the current state; `docs/superpowers/specs/2026-11-13-relay-chat-model-guidance-design.md` has the intent (`opencode-feature-pilot-plan.md` and `opencode-feature-pilot-design.md` describe the older pipeline). This file lists only what the code does not make obvious.

B. The first bullet under "Never" (the real-profile rule) gained:

> The owner can lift this for one named step, as they did on 14 Nov 2026 for the Desktop check and for the decider's example run (made-up messages to a free decision model from an isolated host). Such a yes covers that step only, and the step is recorded in `docs/compatibility.md`.

C. The first bullet under "Invariants" (reserve the worst-case cost first) gained:

> One exception, decided by the owner on 2026-11-14 ("i dont want a budget feature please ignore it we see it later"): Relay's decider requests (`src/decider.ts`) are not reserved, and `/relay` has no budget. There is one such request for each `/relay`, one for each helper that a model starts, and one for each try in the panel's test box. Each is limited by its size instead (4,000 characters of text, eight "use it for" lines of 200 characters for a mode, ten file names), and only a decision model can be the decider.

- [x] **Step 2: Bump the packages**

Run: `npm install --save-exact @opencode/client@2.3.0 @opencode/plugin@2.3.0 @opencode/schema@2.3.0`, then `npm ls @opencode/client @opencode/plugin @opencode/schema effect`
Expected: the three at `2.3.0`, `effect@4.1.0`.

- [x] **Step 3: Run `npm run typecheck` and fix what the new types reject**

Expected: exit 0. If a fix would change what the pipeline does, stop and report instead. (It passed with no change to the code.)

- [x] **Step 4: Change the text**

- `AGENTS.md`: A, B and C. In the smoke bullet, "2.2.7 binary" becomes "2.3.0 binary". For the bullet "Stock 2.2.7 plugin storage has no `compareAndSet`": read `node_modules/@opencode/plugin/dist/promise/storage.d.ts`. It still has none, so the bullet says "Stock plugin storage (2.2.7 and 2.3.0) has no `compareAndSet`". "Code must work without it and with it." stays.
- `README.md`: line 31 (what the package pins) and line 18 (which binary the smokes need) say 2.3.0. Lines 9, 13, 16 and 17 are findings made on 2.2.7 and keep that label. Line 12 (the reservation rule) gains the same exception in one sentence.
- `docs/desktop-testing.md:15`: "**Open Feature Pilot**" becomes "**Open Relay**".
- `scripts/smoke-host.mjs:3`, `scripts/smoke-host-model.mjs:1,4`: "2.2.7 binary" becomes "2.3.0 binary". `scripts/smoke-host-model.mjs:139`: the PASS line prints the version that `<cli> --version` reports, not a fixed "2.2.7".

- [x] **Step 5: Run the two smokes on the 2.3.0 CLI**

Run: `npm run build`, then `npm run smoke:host` and `npm run smoke:host:model`
Expected: each prints a line starting `PASS:`. Record both results, pass or fail, in `docs/compatibility.md` with the CLI's version. A failure is a finding, not something to work around. (Both passed on `opencode v2.3.0`.)

- [x] **Step 6: Run the four checks; add the progress line**

- [ ] **Step 7: Commit** — `chore: move to OpenCode 2.3.0 packages and put the records right`

---

### Task 2: Model list with prices and decision models

**Files:**
- Modify: `src/costs.ts`, `src/inventory.ts:4-20`, `src/contract.ts:78-89`, `src/gui.tsx:26`
- Test: `tests/inventory.test.ts` (it exists; add to it), `tests/rpc.test.ts:41-55`

**Interfaces:**
- Consumes: the host's model record: `cost: Array<{ tier?: { type: 'context'; size: number }; input: number; output: number; cache: { read: number; write: number } }>`.
- Produces:

```ts
// src/costs.ts
export function usdString(value: unknown): string | null
// src/inventory.ts
export type ModelCostView = { inputPerMillion: string | null; outputPerMillion: string | null; cacheReadPerMillion: string | null; tiered: boolean };
export function listProjectModels(context: Pick<Plugin.Context, 'location' | 'model'>, type?: 'chat' | 'decision'): Promise<ListedModel[]>
export type ListedModel = { providerID: string; id: string; name: string; enabled: boolean; status: string; variants: string[]; capabilities: { input: string[]; output: string[]; tools: boolean }; limit: { context: number; output: number }; cost: ModelCostView };
```

- [x] **Step 1: Add the failing tests** to `tests/inventory.test.ts` (its three tests stay; import `usdString` from `../src/costs.js`)

```ts
test('a host price becomes a string, and anything doubtful becomes unknown', () => {
  for (const [value, text] of [[0.24, '0.24'], [0, '0'], [10, '10'], [0.1 + 0.2, '0.3'], [0.000001, '0.000001'], [1234.5, '1234.5']] as const) assert.equal(usdString(value), text);
  for (const value of [0.0000004, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e21, '0.24', null, undefined]) assert.equal(usdString(value), null);
});

const record = (extra: object) => ({ providerID: 'p', id: 'm', name: 'Model', enabled: true, status: 'active', variants: [{ id: 'high', settings: { apiKey: 'hidden' } }], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 }, headers: { authorization: 'secret' }, ...extra });
const host = (data: unknown[], seen: unknown[] = []) => ({ location: { directory: '/repo' }, model: { async list(input: unknown) { seen.push(input); return { data }; } } }) as never;

test('each model carries its base price as strings, and no secrets', async () => {
  const [one, tiers, none, bare] = await listProjectModels(host([
    record({ cost: [{ input: 0.15, output: 0.6, cache: { read: 0.003, write: 0 } }] }),
    record({ cost: [{ tier: { type: 'context', size: 200000 }, input: 2, output: 8, cache: { read: 0, write: 0 } }, { input: 1, output: 4, cache: { read: 0, write: 0 } }] }),
    record({ cost: [] }), record({}),
  ]));
  assert.deepEqual(one.cost, { inputPerMillion: '0.15', outputPerMillion: '0.6', cacheReadPerMillion: '0.003', tiered: false });
  assert.deepEqual(tiers.cost, { inputPerMillion: '1', outputPerMillion: '4', cacheReadPerMillion: '0', tiered: true });
  for (const model of [none, bare]) assert.deepEqual(model.cost, { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, tiered: false });
  assert.equal(/secret|hidden/.test(JSON.stringify([one, tiers, none, bare])), false);
});

test('decision models are asked for by type, and chat models as before', async () => {
  const seen: unknown[] = [];
  await listProjectModels(host([], seen)); await listProjectModels(host([], seen), 'decision');
  assert.deepEqual(seen, [{ location: { directory: '/repo' } }, { location: { directory: '/repo' }, types: ['decision'] }]);
});
```

In `tests/rpc.test.ts`, the existing "does not return provider secrets" test also asserts `(result as any).models[0].cost` equals the three nulls with `tiered: false`, and that the whole result fits the schema `listModels` declares. For that the file gains a small checker, `fits(schema, value)`, which lists what does not fit (missing keys, keys the schema does not declare, wrong types). The real host refuses such an output, and the fake did not. Task 6 uses the same checker.

- [x] **Step 2: Run `npx tsx --test tests/inventory.test.ts tests/rpc.test.ts`** — Expected: FAIL, `usdString` is not exported; then, with `src/inventory.ts` done and `src/contract.ts` not yet, `output.models[0].cost: not declared`.

- [x] **Step 3: Implement**

`usdString`: a finite number of zero or more becomes six decimals with trailing zeros trimmed; anything else, and a value that is not zero but rounds to zero, is `null`. The base price is the first entry without a `tier`, or the first entry when all have one; `tiered` is true when more than one entry is listed. In `src/contract.ts` the `listModels` item gains `cost` with those four fields; keep the item as one named constant, because Task 6 reuses it. In `src/gui.tsx:26` the `Model` type gains `cost: ModelCostView`.

- [x] **Step 4: Run the test again** — Expected: PASS.
- [x] **Step 5: Run the four checks; add the progress line**
- [ ] **Step 6: Commit** — `feat: model list carries prices and can list decision models`

---

### Task 3: Relay's settings and recent decisions in plugin storage

**Files:**
- Modify: `src/settings.ts` (export two checks; behaviour unchanged)
- Create: `src/relay-store.ts`
- Test: `tests/relay-store.test.ts` (new); `tests/settings.test.ts` must pass untouched

**Interfaces:**
- Consumes: `ModelChoice`, `serial` from `src/settings.ts`.
- Produces:

```ts
// src/settings.ts
export type OfferedModel = { providerID: string; id: string; enabled: boolean; status: string; variants: readonly string[] };
export function validateChoices(value: unknown): ModelChoice[]   // one list: well-formed entries (exactly id, providerID, variant), no duplicates
export function offered<M extends OfferedModel>(models: readonly M[], choice: ModelChoice): M | undefined   // listed, enabled, not deprecated, variant offered
// src/relay-store.ts
export const modes = ['plan', 'execute', 'review'] as const;
export type Mode = typeof modes[number];
export const USE_FOR_MAX = 200;
export type ModeChoice = ModelChoice & { useFor: string };   // '' when nothing is written
export type RelaySettings = { revision: number; modes: Record<Mode, ModeChoice[]>; decider: ModelChoice | null };
export type Decision = { at: string; sessionID: string; kind: 'chat' | 'helper'; mode: Mode | null; confidence: number | null; fit: number | null; model: string | null; ms: number; costUsd: string | null; note: string | null };
export type RelayStore = { get(key: string): Promise<unknown>; set(key: string, value: RelaySettings | Decision[]): Promise<void>; compareAndSet?(key: string, expected: unknown, value: RelaySettings | Decision[]): Promise<boolean> };
export const modelName: (choice: ModelChoice) => string   // 'provider/id' or 'provider/id#variant'
export function getRelaySettings(store: Pick<RelayStore, 'get'>): Promise<RelaySettings>
export function saveRelaySettings(store: RelayStore, revision: number, input: unknown, chatModels: readonly OfferedModel[], decisionModels: readonly OfferedModel[]): Promise<RelaySettings>
export function recordDecision(store: RelayStore, decision: Decision): Promise<void>
export function recentDecisions(store: Pick<RelayStore, 'get'>): Promise<Decision[]>   // newest first, at most 20
```

For a chat message, `Decision.mode` is the mode Relay used (Plan when not sure). For a helper it is the decider's answer as it came. It is `null` when the decider gave no answer. `Decision.model` is the model Relay chose, and `null` when nothing was switched. `Decision.fit` is how sure the decider was about the "use it for" line it chose, and `null` when no line was asked about or none was chosen.

In what is saved, an entry of a mode's list may carry `useFor`. It is optional in the input and always present in what is stored and returned. White space is collapsed and trimmed, and a line longer than 200 characters is refused. The same model twice in one mode is a duplicate whatever the lines say.

- [x] **Step 1: Write the failing tests** in `tests/relay-store.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRelaySettings, saveRelaySettings, recordDecision, recentDecisions, modelName, USE_FOR_MAX } from '../src/relay-store.js';

function store() { const map = new Map<string, unknown>(); return { map, async get(k: string) { return structuredClone(map.get(k)); }, async set(k: string, v: unknown) { await new Promise(r => setTimeout(r, 2)); map.set(k, structuredClone(v)); } }; }
const chat = [{ providerID: 'p', id: 'm', enabled: true, status: 'active', variants: ['high'] }];
const deciders = [{ providerID: 'd', id: 'judge', enabled: true, status: 'active', variants: [] }];
const high = { providerID: 'p', id: 'm', variant: 'high' }, judge = { providerID: 'd', id: 'judge', variant: null };
const plain = { ...high, useFor: '' };
const empty = { plan: [], execute: [], review: [] };

test('settings start empty, are one set for all projects, and reject a stale revision', async () => {
  const db = store();
  assert.deepEqual(await getRelaySettings(db), { revision: 0, modes: empty, decider: null });
  const saved = await saveRelaySettings(db, 0, { modes: { ...empty, review: [high] }, decider: judge }, chat, deciders);
  assert.deepEqual(saved, { revision: 1, modes: { ...empty, review: [plain] }, decider: judge });
  assert.deepEqual(await getRelaySettings(db), saved);
  assert.deepEqual([...db.map.keys()], ['relay/settings']);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: null }, chat, deciders), /stale/i);
});

test('each choice carries its "use it for" line: white space collapsed, optional, and at most 200 characters', async () => {
  const db = store();
  assert.equal(USE_FOR_MAX, 200);
  const saved = await saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, useFor: '  hard   design\n work ' }, { ...high, variant: null }] }, decider: null }, chat, deciders);
  assert.deepEqual(saved.modes.plan, [{ ...high, useFor: 'hard design work' }, { ...high, variant: null, useFor: '' }]);
  const longest = await saveRelaySettings(db, 1, { modes: { ...empty, plan: [{ ...high, useFor: ` ${'x'.repeat(200)} ` }] }, decider: null }, chat, deciders);
  assert.equal(longest.modes.plan[0].useFor, 'x'.repeat(200));
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [{ ...high, useFor: 'x'.repeat(201) }] }, decider: null }, chat, deciders), /at most 200 characters/);
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [{ ...high, useFor: 5 }] }, decider: null }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [{ ...high, note: 'x' }] }, decider: null }, chat, deciders), /invalid/i);
  assert.equal((await getRelaySettings(db)).revision, 2);
});

test('only an offered chat model can be chosen for a mode, and only a decision model can decide', async () => {
  const db = store();
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, id: 'gone' }] }, decider: null }, chat, deciders), /unavailable/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, variant: 'ultra' }] }, decider: null }, chat, deciders), /unavailable/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [high, high] }, decider: null }, chat, deciders), /duplicate/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, plan: [{ ...high, useFor: 'one thing' }, { ...high, useFor: 'another' }] }, decider: null }, chat, deciders), /duplicate/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { ...empty, extra: [] }, decider: null }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: { plan: [], execute: [] }, decider: null }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: null, extra: 1 }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty }, chat, deciders), /invalid/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: high }, chat, deciders), /decision model/i);
  await assert.rejects(saveRelaySettings(db, 0, { modes: empty, decider: { ...judge, useFor: 'x' } }, chat, deciders), /invalid/i);
  assert.equal(db.map.size, 0);
});

test('a choice that is no longer offered stays until the person removes it, and its line may still change', async () => {
  const db = store();
  await saveRelaySettings(db, 0, { modes: { ...empty, plan: [high] }, decider: judge }, chat, deciders);
  const kept = await saveRelaySettings(db, 1, { modes: { ...empty, plan: [{ ...high, useFor: 'small fixes' }] }, decider: judge }, [], []);
  assert.deepEqual([kept.revision, kept.modes.plan, kept.decider], [2, [{ ...high, useFor: 'small fixes' }], judge]);
  await assert.rejects(saveRelaySettings(db, 2, { modes: { ...empty, plan: [high], review: [high] }, decider: judge }, [], []), /unavailable/i, 'kept in Plan does not make it new-able in Review');
});

test('with compare-and-set, a write that lost the race is stale and nothing falls back to set', async () => {
  const db = store(); let fallback = false;
  const storage = { ...db, async set() { fallback = true; }, async compareAndSet() { return false; } };
  await assert.rejects(saveRelaySettings(storage, 0, { modes: empty, decider: null }, chat, deciders), /stale/i);
  assert.equal(fallback, false);
  const seen: unknown[] = [];
  const atomic = { ...db, async set() { fallback = true; }, async compareAndSet(key: string, expected: unknown, value: unknown) { seen.push([key, expected]); db.map.set(key, value); return true; } };
  assert.equal((await saveRelaySettings(atomic, 0, { modes: empty, decider: null }, chat, deciders)).revision, 1);
  assert.deepEqual([seen, fallback], [[['relay/settings', undefined]], false]);
});

test('stored settings that cannot be read are an error, not an empty set', async () => {
  for (const damaged of ['garbage', { revision: -1, modes: empty, decider: null }, { revision: 1, modes: { plan: [] }, decider: null }, { revision: 1, modes: empty }])
    await assert.rejects(getRelaySettings({ async get() { return damaged; } }), /invalid/i);
});

test('the last 20 decisions are kept, newest first, and what cannot be read is left out', async () => {
  const db = store(), base = { sessionID: 'ses-1', kind: 'chat', mode: 'plan', confidence: 0.9, fit: 0.8, model: 'p/m', ms: 150, costUsd: '0', note: null } as const;
  for (let i = 0; i < 23; i++) await recordDecision(db, { ...base, at: `2026-11-14T00:00:${String(i).padStart(2, '0')}.000Z` });
  const recent = await recentDecisions(db);
  assert.deepEqual([recent.length, recent[0].at, recent[19].at], [20, '2026-11-14T00:00:22.000Z', '2026-11-14T00:00:03.000Z']);
  assert.deepEqual(recent[0], { ...base, at: '2026-11-14T00:00:22.000Z' });
  assert.deepEqual([...db.map.keys()], ['relay/decisions']);
  assert.deepEqual(await recentDecisions({ async get() { return 'garbage'; } }), []);
  const { fit: _fit, ...older } = { ...base, at: 'earlier' };
  assert.deepEqual(await recentDecisions({ async get() { return [older, 'garbage', { at: 1 }, { ...base, at: 'later', extra: 'x', mode: 'other' }]; } }), [{ ...base, at: 'later', mode: null }, { ...base, at: 'earlier', fit: null }]);
});

test('model names', () => { assert.equal(modelName(high), 'p/m#high'); assert.equal(modelName(judge), 'd/judge'); assert.equal(modelName(plain), 'p/m#high'); });
```

- [x] **Step 2: Run `npx tsx --test tests/relay-store.test.ts`** — Expected: FAIL, cannot find `../src/relay-store.js`.

- [x] **Step 3: Implement**

Export the two checks from `src/settings.ts` and make `validateRoles` and `saveSelections` use them. `saveRelaySettings` follows `saveSelections`: the input has exactly the keys `modes` and `decider`; `modes` has exactly `plan`, `execute`, `review`; a choice that was already saved in that mode may stay, and its line may change; a new one must be `offered`; a new decider must be `offered` among `decisionModels`, else throw `The decider must be a decision model that is offered`; the same compare-and-set or set write. Stored settings that cannot be read throw (`/relay` then sends the message unchanged). `recordDecision` reads the list, adds, keeps the last 20 and writes, inside `serial`:

```ts
// shortcut: one stored list. Two project folders deciding in the same instant can lose one record; give each record its own key if that ever matters.
```

`recentDecisions` leaves out a stored record it cannot read, drops a field it does not know and reads a missing one as `null`, so that one odd record cannot stop the panel's tab from loading (the RPC output is checked against its schema by the host).

- [x] **Step 4: Run `npx tsx --test tests/relay-store.test.ts tests/settings.test.ts`** — Expected: PASS.
- [x] **Step 5: Red then green.** Each of these must turn its test red, and the file is then restored: allow 201 characters; let a chat model be the decider; skip the "must be offered" check; fall back to `set` after a lost compare-and-set; keep 21 decisions.
- [x] **Step 6: Run the four checks; add the progress line**
- [ ] **Step 7: Commit** — `feat: Relay settings and recent decisions in plugin storage`

---

### Task 4: The router

**Files:**
- Create: `src/router.ts`
- Test: `tests/router.test.ts` (new)

**Interfaces:**
- Consumes: `Mode`, `ModeChoice`, `RelaySettings`, `modes` (Task 3); `offered`, `OfferedModel`, `ModelChoice` (`src/settings.ts`); `describeError` (`src/gui-model.ts`).
- Produces:

```ts
export const UNSURE_BELOW = 0.6;        // below this the mode is Plan
export const LINE_UNSURE_BELOW = 0.5;   // below this no line counts as chosen
export const MAX_LINES = 8;
export const REVIEW_RULES_KEY: string; export const reviewRules: string;   // the exact text in "Words and values every task shares"
export const modeLabel: (mode: Mode) => 'Plan' | 'Execute' | 'Review';
export const brief: (error: unknown) => string;   // a failure's message for a note: one line, at most 200 characters
export type LineAnswer = { index: number | null; confidence: number };   // index into described(usable); null = the decider chose "none"
export type DeciderAnswer = { kind: 'answer'; mode: Mode; confidence: number; lines: Partial<Record<Mode, LineAnswer>>; ms: number; costUsd: string | null } | { kind: 'none'; reason: string; ms: number };
export type RoutableModel = OfferedModel & { capabilities: { input: readonly string[] }; limit: { context: number } };
export type Attachment = { needsImage: boolean; tokens: number };   // tokens: about how many the attached files take
export type RouteResult = { switch: true; mode: Mode; agent: 'plan' | 'build'; model: ModelChoice; fit: number | null; note: string | null } | { switch: false; mode: Mode | null; note: string };
export function candidates(mode: Mode, list: readonly ModeChoice[], models: readonly RoutableModel[], attachment: Attachment): { usable: ModeChoice[]; note: string | null }
export const described: (usable: readonly ModeChoice[]) => ModeChoice[]   // the usable models with a line, at most eight
export function linesFor(settings: Pick<RelaySettings, 'modes'>, models: readonly RoutableModel[], attachment: Attachment): Partial<Record<Mode, string[]>>
export function pickModel(usable: readonly ModeChoice[], line: LineAnswer | undefined, current: ModelChoice | null): { model: ModelChoice; fit: number | null; note: string | null }
export function route(answer: DeciderAnswer, settings: Pick<RelaySettings, 'modes'>, models: readonly RoutableModel[], attachment: Attachment, current: ModelChoice | null): RouteResult
export function checksStatus(settings: Pick<RelaySettings, 'modes' | 'decider'>, models: readonly RoutableModel[]): { active: boolean; note: string | null }
```

The rules, in order:

1. **No answer:** no switch, and the note is the reason.
2. **The mode:** the decider's, or Plan when its confidence is below 0.6 (`not sure, so Plan`). Execute uses the agent `build`; Plan and Review use `plan`.
3. **Which of the mode's models can be used** (`candidates`), keeping the person's order: offered now; taking pictures when a picture is attached; with room for the attached files (dropped when the model's context window is known and `tokens` is larger). When none is left, there is no switch and the note says which step emptied the list.
4. **Which one** (`pickModel`): one usable model: that one. No usable model has a line: the first. The decider chose a line with a confidence of 0.5 or more: that line's model, and `fit` is the confidence. Otherwise `fit` is `null`, and the chat's model stays when it is one of the usable ones (same provider, id and effort), else the first usable model is used. The note says `no line fits clearly` (the decider chose none, or was under 0.5) or `no answer about the lines` (no answer for that mode, or a line that is not there).

`linesFor` gives the decider adapter the lines to ask about: for each mode with two or more usable models and at least one line, the lines of `described(usable)`. The command, the test box and the helper hook all build the lines and read the answer through these same functions, so an answer's number always points at the same model. `current` is the chat's model with "no effort" as `null` (`hostVariant`).

```ts
// shortcut: only the attached files are counted, not the message or the chat so far, so a long chat can still overflow the chosen model. A model whose size is not listed (0) is kept.
```

- [x] **Step 1: Write the failing tests** in `tests/router.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, candidates, described, linesFor, checksStatus, modeLabel, reviewRules, REVIEW_RULES_KEY, UNSURE_BELOW, LINE_UNSURE_BELOW, MAX_LINES, type LineAnswer } from '../src/router.js';
import type { Mode } from '../src/relay-store.js';

const m = (id: string, input = ['text'], extra = {}) => ({ providerID: 'p', id, enabled: true, status: 'active', variants: ['high'], capabilities: { input }, limit: { context: 1000 }, ...extra });
const models = [m('plan'), m('exec'), m('review'), m('deep'), m('eyes', ['text', 'image']), m('big', ['text'], { limit: { context: 100000 } })];
const pick = (id: string, variant: string | null = null) => ({ providerID: 'p', id, variant });
const entry = (id: string, useFor = '', variant: string | null = null) => ({ ...pick(id, variant), useFor });
const settings = { modes: { plan: [entry('plan')], execute: [entry('exec', '', 'high')], review: [entry('review')] } };
const withPlan = (...plan: ReturnType<typeof entry>[]) => ({ modes: { ...settings.modes, plan } });
const three = withPlan(entry('plan', 'short questions'), entry('deep', 'hard design'), entry('eyes', 'screens and layout'));
const nothing = { needsImage: false, tokens: 0 };
const sure = (mode: Mode, confidence = 0.9, lines: Partial<Record<Mode, LineAnswer>> = {}) => ({ kind: 'answer', mode, confidence, lines, ms: 5, costUsd: null }) as const;

test('each mode gets its agent, and a mode with one model gets that model', () => {
  assert.deepEqual(route(sure('execute'), settings, models, nothing, null), { switch: true, mode: 'execute', agent: 'build', model: pick('exec', 'high'), fit: null, note: null });
  assert.deepEqual(route(sure('plan'), settings, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: null });
  assert.deepEqual(route(sure('review'), settings, models, nothing, null), { switch: true, mode: 'review', agent: 'plan', model: pick('review'), fit: null, note: null });
  assert.deepEqual([modeLabel('plan'), modeLabel('execute'), modeLabel('review')], ['Plan', 'Execute', 'Review']);
});

test('confidence below 0.6 gives Plan, and 0.6 itself does not', () => {
  assert.equal(UNSURE_BELOW, 0.6);
  assert.deepEqual(route(sure('execute', 0.59), settings, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: 'not sure, so Plan' });
  assert.equal((route(sure('execute', 0.6), settings, models, nothing, null) as { agent: string }).agent, 'build');
});

test('no answer gives no switch, with the reason', () => {
  assert.deepEqual(route({ kind: 'none', reason: 'no decider chosen', ms: 0 }, settings, models, nothing, null), { switch: false, mode: null, note: 'no decider chosen' });
});

test('with no lines written, the first usable model in the list wins', () => {
  const list = [entry('gone'), entry('off'), entry('old'), entry('exec', '', 'ultra'), entry('exec', '', 'high'), entry('deep')];
  const offeredNow = [...models, m('off', ['text'], { enabled: false }), m('old', ['text'], { status: 'deprecated' })];
  assert.deepEqual(route(sure('execute'), { modes: { ...settings.modes, execute: list } }, offeredNow, nothing, pick('other')), { switch: true, mode: 'execute', agent: 'build', model: pick('exec', 'high'), fit: null, note: null });
});

test('a picture needs a model that takes pictures', () => {
  const picture = { needsImage: true, tokens: 0 };
  assert.deepEqual(route(sure('execute'), settings, models, picture, null), { switch: false, mode: 'execute', note: 'no chosen Execute model takes pictures' });
  const both = { modes: { ...settings.modes, execute: [entry('exec', '', 'high'), entry('eyes')] } };
  assert.deepEqual((route(sure('execute'), both, models, picture, null) as { model: unknown }).model, pick('eyes'));
});

test('attached files must fit the model, and a model with no known size is kept', () => {
  const files = { needsImage: false, tokens: 1001 };
  assert.deepEqual(route(sure('execute'), settings, models, files, null), { switch: false, mode: 'execute', note: 'the attached files are too big for every chosen Execute model' });
  assert.equal((route(sure('execute'), settings, models, { needsImage: false, tokens: 1000 }, null) as { switch: boolean }).switch, true, 'exactly full still fits');
  const both = { modes: { ...settings.modes, execute: [entry('exec', '', 'high'), entry('big')] } };
  assert.deepEqual((route(sure('execute'), both, models, files, null) as { model: unknown }).model, pick('big'));
  const unknown = [m('exec', ['text'], { limit: { context: 0 } })];
  assert.deepEqual((route(sure('execute'), settings, unknown, files, null) as { model: unknown }).model, pick('exec', 'high'));
});

test('an empty list, or a list with nothing on offer, gives no switch', () => {
  assert.deepEqual(route(sure('review'), { modes: { ...settings.modes, review: [] } }, models, nothing, null), { switch: false, mode: 'review', note: 'no model chosen for Review' });
  assert.deepEqual(route(sure('review'), { modes: { ...settings.modes, review: [entry('gone')] } }, models, nothing, null), { switch: false, mode: 'review', note: 'no chosen Review model is offered right now' });
  assert.deepEqual(route(sure('execute', 0.2), withPlan(), models, nothing, null), { switch: false, mode: 'plan', note: 'not sure, so Plan; no model chosen for Plan' });
});

test('the line the decider chose picks the model, from a confidence of 0.5', () => {
  assert.equal(LINE_UNSURE_BELOW, 0.5);
  assert.deepEqual(route(sure('plan', 0.9, { plan: { index: 1, confidence: 0.8 } }), three, models, nothing, pick('plan')), { switch: true, mode: 'plan', agent: 'plan', model: pick('deep'), fit: 0.8, note: null });
  assert.deepEqual(route(sure('plan', 0.9, { plan: { index: 2, confidence: 0.5 } }), three, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('eyes'), fit: 0.5, note: null });
  assert.deepEqual((route(sure('plan', 0.9, { plan: { index: 2, confidence: 0.49 } }), three, models, nothing, null) as { model: unknown }).model, pick('plan'));
});

test('when no line fits, the chat keeps its model if the mode can use it, and else the first is used', () => {
  const noLine = sure('plan', 0.9, { plan: { index: null, confidence: 0.95 } });
  assert.deepEqual(route(noLine, three, models, nothing, pick('eyes')), { switch: true, mode: 'plan', agent: 'plan', model: pick('eyes'), fit: null, note: 'no line fits clearly, so the chat\'s model stays' });
  for (const current of [null, pick('other'), pick('eyes', 'high')])
    assert.deepEqual(route(noLine, three, models, nothing, current), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: 'no line fits clearly, so the first model is used' });
  const weak = sure('plan', 0.9, { plan: { index: 1, confidence: 0.3 } });
  assert.equal((route(weak, three, models, nothing, pick('eyes')) as { note: string }).note, 'no line fits clearly, so the chat\'s model stays');
});

test('a missing line answer, or one that names a line that is not there, falls back the same way', () => {
  for (const lines of [{}, { plan: { index: 3, confidence: 0.9 } }, { plan: { index: -1, confidence: 0.9 } }, { execute: { index: 1, confidence: 0.9 } }]) {
    assert.deepEqual(route(sure('plan', 0.9, lines), three, models, nothing, pick('deep')), { switch: true, mode: 'plan', agent: 'plan', model: pick('deep'), fit: null, note: 'no answer about the lines, so the chat\'s model stays' });
    assert.deepEqual(route(sure('plan', 0.9, lines), three, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: 'no answer about the lines, so the first model is used' });
  }
});

test('a mode the decider was not sure about uses the Plan line', () => {
  const answer = sure('execute', 0.4, { plan: { index: 1, confidence: 0.7 }, execute: { index: 0, confidence: 0.99 } });
  assert.deepEqual(route(answer, three, models, nothing, null), { switch: true, mode: 'plan', agent: 'plan', model: pick('deep'), fit: 0.7, note: 'not sure, so Plan' });
  assert.deepEqual((route(sure('execute', 0.4), three, models, nothing, null) as { note: string }).note, 'not sure, so Plan; no answer about the lines, so the first model is used');
});

test('the lines count only the models that can be used now and have a line', () => {
  const list = [entry('gone', 'not offered'), entry('plan'), entry('deep', 'hard design'), entry('eyes', 'screens')];
  const { usable, note } = candidates('plan', list, models, nothing);
  assert.deepEqual([usable.map(item => item.id), note], [['plan', 'deep', 'eyes'], null]);
  assert.deepEqual(described(usable).map(item => item.id), ['deep', 'eyes']);
  assert.deepEqual(linesFor(withPlan(...list), models, nothing), { plan: ['hard design', 'screens'] });
  assert.deepEqual((route(sure('plan', 0.9, { plan: { index: 0, confidence: 0.9 } }), withPlan(...list), models, nothing, null) as { model: unknown }).model, pick('deep'));
  assert.deepEqual(candidates('plan', list, models, { needsImage: true, tokens: 0 }).usable.map(item => item.id), ['eyes']);
});

test('lines are asked about only where there is a choice to make, and at most eight', () => {
  assert.equal(MAX_LINES, 8);
  assert.deepEqual(linesFor(settings, models, nothing), {}, 'one model each');
  assert.deepEqual(linesFor(withPlan(entry('plan'), entry('deep')), models, nothing), {}, 'two models, no line');
  assert.deepEqual(linesFor(withPlan(entry('plan', 'only this one')), models, nothing), {}, 'a line, one model');
  assert.deepEqual(linesFor(withPlan(entry('plan'), entry('deep', 'hard design')), models, nothing), { plan: ['hard design'] });
  assert.deepEqual(linesFor(three, models, { needsImage: true, tokens: 0 }), {}, 'a picture leaves one model');
  const many = Array.from({ length: 10 }, (_, index) => entry(`m${index}`, `line ${index}`));
  const all = { modes: { plan: many, execute: many, review: many } }, offeredNow = many.map(item => m(item.id));
  assert.deepEqual(linesFor(all, offeredNow, nothing), { plan: many.slice(0, 8).map(item => item.useFor), execute: many.slice(0, 8).map(item => item.useFor), review: many.slice(0, 8).map(item => item.useFor) });
  assert.deepEqual((route(sure('plan', 0.9, { plan: { index: 7, confidence: 0.9 } }), all, offeredNow, nothing, null) as { model: unknown }).model, pick('m7'));
  assert.equal((route(sure('plan', 0.9, { plan: { index: 8, confidence: 0.9 } }), all, offeredNow, nothing, null) as { note: string }).note, 'no answer about the lines, so the first model is used');
});

test('checks are routed only with a decider and a usable Review model', () => {
  const full = { ...settings, decider: pick('judge') };
  assert.deepEqual(checksStatus(full, models), { active: true, note: null });
  assert.deepEqual(checksStatus({ ...full, decider: null }, models), { active: false, note: 'no decider chosen' });
  assert.deepEqual(checksStatus({ ...full, modes: { ...full.modes, review: [] } }, models), { active: false, note: 'no model chosen for Review' });
  assert.deepEqual(checksStatus({ ...full, modes: { ...full.modes, review: [entry('gone')] } }, models), { active: false, note: 'no chosen Review model is offered right now' });
});

test('the review rules hold the four points', () => {
  for (const point of [/concrete evidence/, /verdict/, /earlier blocking findings/, /at most three checks/]) assert.match(reviewRules, point);
  assert.equal(REVIEW_RULES_KEY, 'relay-review-rules');
});
```

- [x] **Step 2: Run `npx tsx --test tests/router.test.ts`** — Expected: FAIL, cannot find `../src/router.js`.
- [x] **Step 3: Implement** as the tests and the notes table fix them. No `node:` import.
- [x] **Step 4: Run the test again** — Expected: PASS.
- [x] **Step 5: Red then green.** Each of these must turn its test red, and the file is then restored: `UNSURE_BELOW` 0.5; the agent `build` for an unsure Execute; `LINE_UNSURE_BELOW` 0.4; no picture check; a file of exactly the window's size does not fit; a model with no listed size is dropped; the chat's model kept by id alone; a model that is not offered counted as usable; lines asked about for a mode with one model.
- [x] **Step 6: Run the four checks; add the progress line**
- [ ] **Step 7: Commit** — `feat: pure router for /relay`

---

### Task 5: The decider adapter

The owner answered line C of Task 1 on 14 Nov, so this task is not reserved through the ledger.

**Files:**
- Create: `src/decider.ts`
- Test: `tests/decider.test.ts` (new)

**Interfaces:**
- Consumes: `DeciderAnswer`, `LineAnswer`, `MAX_LINES`, `brief` (Task 4), `Mode`, `modes` (Task 3), `usdString` (Task 2). The host call, as it answered in Desktop on 14 Nov: `context.experimental.generate.decisions({ model, input, questions })` returned `{ answers, cost, tokens, native }` with no `data` wrapper, `cost` 0 and `tokens` `{ input: 418, output: 38 }`; the answer was `{ type: 'choice', name: 'mode', choice: 'execute', probabilities: [{ value, probability }, ...], confidence: 0.97 }`. The host's types also allow an answer `{ type: 'error', name, reason, message? }`, which was not seen. The types allow several questions in one request; that was not tried against a real model before Task 10.
- Produces:

```ts
export const MAX_CHARS = 4000; export const TIMEOUT_MS = 5000; export const MAX_FILE_NAMES = 10;
export type FileFact = { name: string; bytes: number | null };
export type DecideInput = { kind: 'chat' | 'helper'; text: string; agent: string | null; files: readonly FileFact[]; images: number; lines: Partial<Record<Mode, readonly string[]>> };
export type DecisionsRequest = { model: { providerID: string; id: string; variant?: string }; input: { type: 'text'; text: string }[]; questions: { type: 'choice'; name: string; instructions: string; choices: { value: string; description: string }[] }[] };
export type DecisionsHost = { decisions(request: DecisionsRequest): Promise<unknown> };
export function capText(text: string): string
export function buildDecisionRequest(decider: ModelChoice, input: DecideInput): DecisionsRequest
export function decide(host: DecisionsHost, decider: ModelChoice | null, input: DecideInput, timeoutMs?: number): Promise<DeciderAnswer>
```

`files` are the attached files that are not pictures, and `images` counts the pictures. `lines` comes from `linesFor` (Task 4): the caller passes every mode's lines for a chat message, and only `review` for a helper.

- [x] **Step 1: Write the failing tests** in `tests/decider.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionRequest, capText, decide, MAX_CHARS, MAX_FILE_NAMES, TIMEOUT_MS, type DecideInput, type FileFact } from '../src/decider.js';

const judge = { providerID: 'd', id: 'judge', variant: null };
const chat: DecideInput = { kind: 'chat', text: 'fix the login test', agent: 'plan', files: [{ name: 'a.txt', bytes: 2048 }], images: 0, lines: {} };
const choice = (name: string, value: unknown, confidence: unknown) => ({ type: 'choice', name, choice: value, probabilities: [], confidence });
const reply = (value: unknown, confidence: unknown, ...more: unknown[]) => ({ answers: [choice('mode', value, confidence), ...more], cost: 0, tokens: { input: 418, output: 38 } });

test('with no lines to ask about, the request is one choice question with the three modes', () => {
  const request = buildDecisionRequest(judge, chat);
  assert.deepEqual(request.model, { providerID: 'd', id: 'judge' });
  assert.deepEqual(request.input, [{ type: 'text', text: 'The person\'s message: "fix the login test"\nThe chat is on the agent: plan. Attached files: a.txt (2 kB). Attached pictures: 0.' }]);
  assert.deepEqual(request.questions.map(q => [q.type, q.name, q.choices.map(c => c.value)]), [['choice', 'mode', ['plan', 'execute', 'review']]]);
  assert.match(request.questions[0].instructions, /Choose execute only when it clearly asks/);
  const helper = buildDecisionRequest({ ...judge, variant: 'fast' }, { kind: 'helper', text: 'Review the diff', agent: null, files: [], images: 0, lines: {} });
  assert.deepEqual(helper.model, { providerID: 'd', id: 'judge', variant: 'fast' });
  assert.equal(helper.input[0].text, 'A task that a model is handing to a helper: "Review the diff"');
  assert.match(buildDecisionRequest(judge, { ...chat, agent: null }).input[0].text, /agent: unknown\./);
});

test('each mode with lines gets its own question: the lines as numbered choices, then none', () => {
  const request = buildDecisionRequest(judge, { ...chat, lines: { plan: ['hard design', 'screens'], review: ['security'] } });
  assert.deepEqual(request.questions.map(q => q.name), ['mode', 'plan_line', 'review_line']);
  assert.deepEqual(request.questions[1].choices, [{ value: '1', description: 'hard design' }, { value: '2', description: 'screens' }, { value: 'none', description: 'None of these fits clearly.' }]);
  assert.deepEqual(request.questions[2].choices.map(c => c.value), ['1', 'none']);
  assert.match(request.questions[1].instructions, /Choose none when no description fits clearly/);
  const many = buildDecisionRequest(judge, { ...chat, lines: { execute: Array.from({ length: 12 }, (_, index) => `line ${index}`) } });
  assert.deepEqual(many.questions[1].choices.map(c => c.value), ['1', '2', '3', '4', '5', '6', '7', '8', 'none'], 'never more than eight lines');
  assert.deepEqual(buildDecisionRequest(judge, { ...chat, lines: { plan: [] } }).questions.map(q => q.name), ['mode'], 'no lines, no question');
});

test('the decider is told the names and sizes of at most ten files, and never a folder', () => {
  const second = (files: FileFact[], images = 0) => buildDecisionRequest(judge, { ...chat, files, images }).input[0].text.split('\n')[1];
  assert.equal(MAX_FILE_NAMES, 10);
  assert.equal(second([]), 'The chat is on the agent: plan. Attached files: none. Attached pictures: 0.');
  assert.equal(second([{ name: 'a.txt', bytes: 999 }, { name: 'notes.md', bytes: null }, { name: 'big.log', bytes: 12_345_678 }], 2), 'The chat is on the agent: plan. Attached files: a.txt (999 B), notes.md (size unknown), big.log (12 MB). Attached pictures: 2.');
  assert.equal(second([{ name: 'C:\\Users\\someone\\private folder\\plan.md', bytes: 1500 }, { name: '/home/someone/src/app.ts', bytes: 0 }]), 'The chat is on the agent: plan. Attached files: plan.md (2 kB), app.ts (0 B). Attached pictures: 0.');
  const many = second(Array.from({ length: 13 }, (_, index) => ({ name: `f${index}.ts`, bytes: 10 })));
  assert.match(many, /f9\.ts \(10 B\) and 3 more\. Attached pictures: 0\.$/);
  assert.equal(many.includes('f10.ts'), false);
  assert.equal(second([{ name: 'a\nb\t  c.txt', bytes: 1 }]), 'The chat is on the agent: plan. Attached files: a b c.txt (1 B). Attached pictures: 0.');
  assert.match(second([{ name: `${'n'.repeat(100)}.txt`, bytes: 1 }]), new RegExp(`files: ${'n'.repeat(80)} \\(1 B\\)\\.`));
});

test('text over 4,000 characters keeps the first 2,000 and the last 2,000, and never half a character', () => {
  assert.equal(MAX_CHARS, 4000);
  assert.equal(capText('a'.repeat(4000)), 'a'.repeat(4000));
  assert.equal(capText('a'.repeat(3000) + 'b'.repeat(3000)), 'a'.repeat(2000) + '\n[...]\n' + 'b'.repeat(2000));
  const emoji = capText('x' + '😀'.repeat(2500) + 'y');   // both cuts fall inside a two-unit character
  assert.doesNotThrow(() => encodeURIComponent(emoji));   // it throws on half a character
  assert.ok(emoji.length <= 4000 + '\n[...]\n'.length);
  const sent = buildDecisionRequest(judge, { ...chat, text: 'a'.repeat(3000) + 'b'.repeat(3000) }).input[0].text;
  assert.equal(sent.split('"')[1], 'a'.repeat(2000) + '\n[...]\n' + 'b'.repeat(2000), 'the cut text is what is sent');
});

test('a readable answer becomes the mode, the confidence, the cost and the lines', async () => {
  const answer = await decide({ decisions: async () => reply('review', 0.97) }, judge, chat);
  assert.deepEqual({ ...answer, ms: 0 }, { kind: 'answer', mode: 'review', confidence: 0.97, lines: {}, costUsd: '0', ms: 0 });
  const lines = { plan: ['a', 'b'], execute: ['c'], review: ['d', 'e', 'f'] };
  const answers = [choice('review_line', '3', 0.6), choice('plan_line', '2', 0.8), choice('mode', 'plan', 0.9), choice('execute_line', 'none', 0.7)];
  const full = await decide({ decisions: async () => ({ answers, cost: 0.000012 }) }, judge, { ...chat, lines });
  assert.deepEqual({ ...full, ms: 0 }, { kind: 'answer', mode: 'plan', confidence: 0.9, lines: { plan: { index: 1, confidence: 0.8 }, execute: { index: null, confidence: 0.7 }, review: { index: 2, confidence: 0.6 } }, costUsd: '0.000012', ms: 0 });
  assert.equal(((await decide({ decisions: async () => ({ answers: [choice('mode', 'plan', 0.9)] }) }, judge, chat)) as { costUsd: unknown }).costUsd, null, 'no cost reported is unknown, not zero');
});

test('a line answer that cannot be used is left out, and the mode still counts', async () => {
  const lines = { plan: ['a', 'b'] };
  const unusable = [choice('plan_line', '3', 0.9), choice('plan_line', '0', 0.9), choice('plan_line', 2, 0.9), choice('plan_line', true, 0.9), choice('plan_line', '1', 1.5), choice('plan_line', '1', '0.9'), choice('plan_line', '1', Number.NaN),
    { type: 'error', name: 'plan_line', reason: 'refused' }, choice('other_line', '1', 0.9), choice('review_line', '1', 0.9), choice('review_line', 'none', 0.9), null, 'plan_line'];
  for (const extra of unusable) {
    const answer = await decide({ decisions: async () => reply('plan', 0.9, extra) }, judge, { ...chat, lines });
    assert.deepEqual({ ...answer, ms: 0 }, { kind: 'answer', mode: 'plan', confidence: 0.9, lines: {}, costUsd: '0', ms: 0 }, JSON.stringify(extra));
  }
});

test('anything else counts as no answer', async () => {
  const none = async (result: () => Promise<unknown>, decider: typeof judge | null = judge) => { const a = await decide({ decisions: result }, decider, chat); assert.equal(a.kind, 'none'); return (a as { reason: string }).reason; };
  assert.equal(await none(async () => { throw new Error('must not be called'); }, null), 'no decider chosen');
  assert.equal(await none(async () => { throw new Error('ProviderRequestError: 503'); }), 'the decider gave no answer: ProviderRequestError: 503');
  assert.equal(await none(() => { throw new Error('thrown before a promise existed'); }), 'the decider gave no answer: thrown before a promise existed');
  assert.equal(await none(async () => { throw new Error(`long\n${'x'.repeat(400)}`); }), `the decider gave no answer: long ${'x'.repeat(195)}`);
  assert.equal(await none(async () => ({ answers: [{ type: 'error', name: 'mode', reason: 'refused' }] })), 'the decider gave no answer: refused');
  for (const bad of [reply('unsure', 0.9), reply(true, 0.9), reply('plan', 1.2), reply('plan', -0.1), reply('plan', Number.NaN), reply('plan', '0.9'), { answers: [] }, { answers: [null] }, { answers: [{ ...choice('mode', 'plan', 0.9), name: 'other' }] }, { answers: [{ ...choice('mode', 'plan', 0.9), type: 'score' }] }, null, 'plan', undefined])
    assert.equal(await none(async () => bad), "the decider's answer could not be read");
});

test('it gives up after the time limit and ignores a late answer and a late failure', async () => {
  assert.equal(TIMEOUT_MS, 5000);
  let calls = 0;
  const slow = { decisions: () => { const nth = ++calls; return new Promise((done, fail) => setTimeout(() => nth === 1 ? done(reply('execute', 0.99)) : fail(new Error('late')), 40)); } };
  for (const _ of [1, 2]) { const a = await decide(slow, judge, chat, 10); assert.deepEqual([a.kind, (a as { reason: string }).reason], ['none', 'the decider took longer than 0.01 seconds']); }
  await new Promise(done => setTimeout(done, 60));   // the late failure must not surface as an unhandled rejection
});
```

- [x] **Step 2: Run `npx tsx --test tests/decider.test.ts`** — Expected: FAIL, cannot find `../src/decider.js`.

- [x] **Step 3: Implement**

The request omits `variant` when the choice has none. The first question is `mode`; then one `<mode>_line` question for each mode that has lines, in the order plan, execute, review, with at most eight lines each. A file is named by the last part of its path only, with white space flattened and at most 80 characters, so a home folder's name never leaves the machine; its size is shown as `B`, `kB` or `MB`, or `size unknown`. The time-limit note is built from the limit (`5 seconds` for 5000). A call that is given up on is not stopped (Stage 0), so its late result and its late failure are both dropped. `ms` is the time until the answer or the give-up.

Reading the answer: the `mode` answer must be a `choice` with one of the three modes and a confidence from 0 to 1, or there is no answer. A line answer is used only when that mode was asked about and the answer is a `choice` of `none` or of a number that was sent, with a confidence from 0 to 1; anything else is left out, and the router falls back by its rule. `costUsd` is `usdString` of the reported cost, so no cost reported reads as unknown.

No `node:` import. There is no cost ceiling (dropped on 14 Nov with the budget question).

- [x] **Step 4: Run the test again** — Expected: PASS.
- [x] **Step 5: Red then green.** Each of these must turn its test red, and the file is then restored: wait for a late answer; send the text uncut; cut inside a two-unit character; name more than ten files; send a folder; send more than eight lines; accept a confidence above 1; accept a line number that was not sent; accept a line answer for a mode that was not asked about.
- [x] **Step 6: Run the four checks; add the progress line**
- [ ] **Step 7: Commit** — `feat: decider adapter for /relay`

---

### Task 6: RPC to read and save the settings and to try the decider

**Files:**
- Modify: `src/contract.ts`, `src/rpc.ts`
- Test: `tests/rpc.test.ts`

**Interfaces:**
- Consumes: `listProjectModels(context, 'decision')` and `modelItem` (Task 2); `getRelaySettings`, `saveRelaySettings`, `recentDecisions`, `modelName`, `RelayStore` (Task 3); `checksStatus`, `linesFor`, `route` (Task 4); `decide` (Task 5).
- Produces three RPC methods. Each declares `errors`, and the panel (Task 9) calls them:

```
getRelay:    {} -> { directory, settings: { revision, modes, decider }, decisions: Decision[], deciders: ListedModel[], checks: { active, note } }
saveRelay:   { revision, modes, decider } -> the same as getRelay
testDecider: { text } -> { directory, mode, confidence, model, fit, ms, costUsd, note }
```

In what the panel sends, a mode's entry is `{ providerID, id, variant, useFor? }`; in what comes back `useFor` is always there (`''` for no line). `deciders` is the list of decision models, with prices and no secrets. `checks` is `checksStatus` for the chat models of this project.

`testDecider` reports what Relay would do with a sample message, by the same path as `/relay` with nothing attached and no chat: `mode` is the mode after the 0.6 rule (or `null` with no answer), `confidence` is the decider's own, `model` is the name of the pick (`provider/id` or `provider/id#effort`) with no chat model to keep, and `fit` is the line's confidence. Nothing is switched, sent or recorded. `registerInventory`'s context type gains `'experimental'`.

- [x] **Step 1: Write the failing tests** at the end of `tests/rpc.test.ts` (with `import { recordDecision } from '../src/relay-store.js';` at the top)

```ts
// ---- Relay: the settings every project shares, and the panel's test box ----
const relayHigh = { providerID: 'p', id: 'm', variant: 'high' }, relayDeep = { providerID: 'p', id: 'deep', variant: null }, relayJudge = { providerID: 'd', id: 'judge', variant: null };
const noModes = { plan: [], execute: [], review: [] };
const picked = (name: string, value: unknown, confidence: number) => ({ type: 'choice', name, choice: value, probabilities: [], confidence });
/** Two project folders on one host: plugin storage is shared, the chat models are p/m (effort high) and p/deep, and the only decision model is d/judge. */
function relayHost() {
  const data = new Map<string, unknown>(), requests: any[] = [];
  let reply: unknown = { answers: [picked('mode', 'review', 0.97)], cost: 0 };
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async set(key: string, value: unknown) { data.set(key, structuredClone(value)); } };
  const listed = (providerID: string, id: string, variants: string[] = []) => ({ providerID, id, name: id, enabled: true, status: 'active', variants: variants.map(variant => ({ id: variant })), capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 1000, output: 10 }, cost: [{ input: 0.24, output: 0, cache: { read: 0, write: 0 } }], headers: { authorization: 'secret' } });
  const connect = async (directory: string) => {
    let handlers: any;
    await registerInventory({
      location: { directory }, storage, session: {},
      model: { async list(input: { types?: string[] }) { return { data: input.types?.includes('decision') ? [listed('d', 'judge')] : [listed('p', 'm', ['high']), listed('p', 'deep')] }; } },
      experimental: { generate: { async decisions(request: unknown) { requests.push(request); return reply; } } },
      rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } },
    } as never);
    return handlers;
  };
  return { storage, requests, connect, answer(next: unknown) { reply = next; } };
}

test('getRelay and saveRelay keep one set of settings for every project, and fit what they declare', async () => {
  const host = relayHost(), one = await host.connect('/one'), two = await host.connect('/two');
  const input = { revision: 0, modes: { ...noModes, review: [{ ...relayHigh, useFor: ' checks  for mistakes ' }, relayDeep] }, decider: relayJudge };
  assert.deepEqual(fits(FeaturePilot.methods.saveRelay.input, input), [], 'what the panel sends fits the declared input');
  const saved = await one.saveRelay(input);
  assert.equal(saved.settings.revision, 1);
  assert.deepEqual(saved.settings.modes.review, [{ ...relayHigh, useFor: 'checks for mistakes' }, { ...relayDeep, useFor: '' }]);
  await recordDecision(host.storage, { at: '2026-11-14T00:00:00.000Z', sessionID: 'ses-1', kind: 'chat', mode: 'review', confidence: 0.97, fit: null, model: 'p/m#high', ms: 150, costUsd: '0', note: null });
  const seen = await two.getRelay({});
  assert.equal(seen.directory, '/two');
  assert.deepEqual(seen.settings, saved.settings);
  assert.deepEqual(seen.deciders.map((model: { providerID: string; id: string; cost: { inputPerMillion: string } }) => `${model.providerID}/${model.id} ${model.cost.inputPerMillion}`), ['d/judge 0.24']);
  assert.deepEqual([seen.checks, seen.decisions.length, seen.decisions[0].model], [{ active: true, note: null }, 1, 'p/m#high']);
  assert.equal(JSON.stringify(seen).includes('secret'), false);
  assert.deepEqual([fits(FeaturePilot.methods.getRelay.output, seen), fits(FeaturePilot.methods.saveRelay.output, saved)], [[], []]);
  await assert.rejects(one.saveRelay({ revision: 0, modes: noModes, decider: null }), { type: 'rejected', message: /stale/i });
  await assert.rejects(one.saveRelay({ revision: 1, modes: noModes, decider: relayHigh }), { type: 'rejected', message: /decision model/i });
  await assert.rejects(one.saveRelay({ revision: 1, modes: { ...noModes, plan: [{ ...relayHigh, useFor: 'x'.repeat(201) }] }, decider: relayJudge }), { type: 'rejected', message: /at most 200 characters/ });
  const cleared = await two.saveRelay({ revision: 1, modes: noModes, decider: null });
  assert.deepEqual([cleared.settings.revision, cleared.checks], [2, { active: false, note: 'no decider chosen' }]);
});

test('testDecider asks the chosen decider once and reports what Relay would do', async () => {
  const host = relayHost(), one = await host.connect('/one');
  await one.saveRelay({ revision: 0, modes: { ...noModes, review: [{ ...relayHigh, useFor: 'checks for mistakes' }, relayDeep] }, decider: relayJudge });
  host.answer({ answers: [picked('mode', 'review', 0.97), picked('review_line', '1', 0.8)], cost: 0 });
  const sure = await one.testDecider({ text: 'check my diff' });
  assert.deepEqual({ ...sure, ms: 0 }, { directory: '/one', mode: 'review', confidence: 0.97, model: 'p/m#high', fit: 0.8, ms: 0, costUsd: '0', note: null });
  assert.deepEqual(fits(FeaturePilot.methods.testDecider.output, sure), []);
  assert.equal(host.requests.length, 1);
  assert.deepEqual(host.requests[0].model, { providerID: 'd', id: 'judge' });
  assert.deepEqual(host.requests[0].questions.map((question: { name: string }) => question.name), ['mode', 'review_line']);
  assert.equal(/p\/m|deep|0\.24/.test(JSON.stringify(host.requests[0])), false, 'the decider is never told a model name or a price');
  host.answer({ answers: [picked('mode', 'execute', 0.4)], cost: 0 });
  const unsure = await one.testDecider({ text: 'hmm' });
  assert.deepEqual({ ...unsure, ms: 0 }, { directory: '/one', mode: 'plan', confidence: 0.4, model: null, fit: null, ms: 0, costUsd: '0', note: 'not sure, so Plan; no model chosen for Plan' });
  host.answer({ answers: [] });
  const silent = await one.testDecider({ text: 'hello' });
  assert.deepEqual({ ...silent, ms: 0 }, { directory: '/one', mode: null, confidence: null, model: null, fit: null, ms: 0, costUsd: null, note: "the decider's answer could not be read" });
  assert.deepEqual([fits(FeaturePilot.methods.testDecider.output, unsure), fits(FeaturePilot.methods.testDecider.output, silent)], [[], []]);
  await assert.rejects(one.testDecider({ text: '  ' }), { type: 'rejected', message: /sample message/i });
  assert.equal(host.requests.length, 3);
  assert.deepEqual((await one.getRelay({})).decisions, [], 'a try in the test box is not recorded');
});
```

- [x] **Step 2: Run `npx tsx --test tests/rpc.test.ts`** — Expected: FAIL: `one.saveRelay is not a function`, and the contract has no `saveRelay`.
- [x] **Step 3: Implement.** In `src/contract.ts` the schemas for a mode's entry (one with `useFor` required for outputs, one with it optional for the input), a decision (`fit` included), the shared output, and the three methods. In `src/rpc.ts` the three handlers. Blank text in `testDecider` throws `Type a sample message`. The settings are read from the plugin's storage with no project key, so every project sees the same ones.
- [x] **Step 4: Run the test again** — Expected: PASS, and the test "every method declares errors" still passes.
- [x] **Step 5: Red then green.** Each of these must turn its test red, and the file is then restored: no refusal of blank text; the chat models passed as the decision models; no lines sent from the test box; `fit` not declared in the test box's output; `useFor` not declared in a mode's entry.
- [x] **Step 6: Run the four checks; add the progress line**
- [ ] **Step 7: Commit** — `feat: RPC for Relay's settings and the decider test box`

---

### Task 7: The `/relay` command

**Files:**
- Create: `src/relay-command.ts`, `tests/relay-fakes.ts`, `tests/relay-command.test.ts`
- Modify: `src/decider.ts` (`within`, `LATE`), `src/index.ts`, `tests/plugin.test.ts`, `scripts/smoke-host-model.mjs`

**Interfaces:**
- Consumes: `route`, `linesFor`, `reviewRules`, `REVIEW_RULES_KEY`, `brief`, `DeciderAnswer` (Task 4); `decide`, `DecideInput` (Task 5); `getRelaySettings`, `recordDecision`, `modelName`, `RelayStore` (Task 3); `listProjectModels` (Task 2); `hostVariant` (`src/types.ts`); `roleFor` (`src/index.ts`). Host calls, as run on 14 Nov: `context.command.transform(editor => editor.add({ name, description, execute }))`, `execute({ sessionID, prompt, delivery })`, `session.get`, `session.wait`, `session.switchAgent({ sessionID, agent })`, `session.switchModel({ sessionID, model })`, `session.instructions.entry.put({ sessionID, key, value })` and `.remove({ sessionID, key })`, `session.prompt({ ...prompt, sessionID, delivery })`.
- Produces:

```ts
// src/decider.ts: one time limit for the decider, the wait for a busy chat and the read of a file's size
export const LATE: unique symbol
export function within<T>(work: () => T | Promise<T>, ms: number): Promise<T | typeof LATE>

// src/relay-command.ts
export type RelayDeps = {
  session: Pick<Plugin.Context['session'], 'get' | 'wait' | 'switchAgent' | 'switchModel' | 'prompt' | 'instructions'>;
  store: RelayStore;
  chatModels: () => Promise<ListedModel[]>;
  decide: (decider: ModelChoice | null, input: DecideInput) => Promise<DeciderAnswer>;
  owned: (sessionID: string) => Promise<boolean>;      // true for a chat a Relay run created
  fileSize: (uri: string) => Promise<number | null>;   // bytes, or null when it is not a file on this machine
  waitMs?: number;                                      // 120_000: how long a busy chat is waited for
  sizeMs?: number;                                      // 1000: how long reading one file's size may take
};
export function isPicture(file: { uri?: string; name?: string }): boolean
export function localPath(uri: string): string | null   // a `file:` address with no host, as a path; else null
export function fileSize(uri: string): Promise<number | null>
export function relayCommand(deps: RelayDeps): { name: 'relay'; description: string; execute(input: { sessionID; prompt; delivery }): Promise<void> }

// tests/relay-fakes.ts: a host that behaves like the real one. It keeps the chat's agent and model and changes them on a switch.
export function entry(id: string, variant?: string | null, useFor?: string): ModeChoice   // a `p/<id>` choice
export function fakeRelay(options?): { deps: RelayDeps; calls: { name: string; input: unknown }[]; data: Map<string, unknown>; chat: { agent?: string; model? } }
```

The fake's chat models are `p/plan`, `p/exec` (effort `high`), `p/review` and `p/usual`, which take text, `p/eyes`, which also takes pictures, and `p/small`, which holds 1,000 tokens. Its options: `settings`, `chat`, `decision` (a reply, an `Error`, `'never'`, or a function of the request), `decideMs`, `owned`, `busyMs`, `waitMs`, `sizeMs`, `sizes` (bytes by address), and `fail` (an error for any one call). `deps.decide` is the real `decide` over a fake decisions call. `calls` lists every call in order, a failing one included, under the names `owned`, `get`, `wait`, `idle`, `decisions`, `models`, `switchAgent`, `switchModel`, `put`, `remove`, `prompt`, `storageGet`, `storageSet`, `size`.

What `execute` does, in order:

1. Blank `prompt.text`: throw `Relay: type your message after /relay.` Nothing else happens.
2. `deps.owned(sessionID)` is true: throw `Relay: /relay does not work in a chat that a Relay run created.` If the lookup itself throws, that error is thrown. Nothing is sent.
3. Commands for the same chat run one after another, whether the one before worked or not.
4. Read the settings, the chat and the chat models. If one cannot be read, the decider is not asked, the note is `<the settings | the chat | the model list> could not be read: <why>`, and the flow goes on to step 8.
5. Sort the attached files. A picture (`isPicture`) is only counted. Every other file is named by its `name`, or else by its address without what follows a `?` or `#` (never by a `data:` address, which holds the content), and sized by `deps.fileSize`, for at most `sizeMs`; a failure or a late answer is "size unknown". What comes with the message is `{ needsImage: there is a picture, tokens: the known bytes / 4, rounded up }`.
6. Ask the decider: the text, the chat's agent, the files' names and sizes, the number of pictures, and `linesFor(settings, models, attachment)`. Route, with the chat's model as the one to keep when no line fits.
7. For a switch: first wait until the chat is idle, for at most `waitMs`; if it is still busy then, nothing is switched. Then `switchAgent` unless the chat is on that agent; `switchModel` unless the chat is on that model with that effort (compared with `hostVariant`); the model argument has no `variant` key when the choice has none. For Review, `put` the rules; for another mode, `remove` them. With no switch there is no wait, and the rules entry is left alone.
8. `session.prompt({ ...prompt, sessionID, delivery })`, once. If it throws, record the decision with the note and throw the same error.
9. Record the decision: `model` and `fit` only when the chat is on the chosen model. A record that fails is swallowed.

Any failure in steps 4 to 7 becomes a note and the flow goes on to step 8. Two shortcuts are marked in the code: four bytes to a token, and a failed `remove` is not reported.

`isPicture`: the `uri` starts with `data:image/`, or the `name`, or the `uri` without its `?` and `#` parts, ends in `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` or `.bmp`, in any letter case. (On 14 Nov an `@` file arrived as a name and an address with no type. What a pasted picture looks like is not known; Task 11 records it.)

`localPath` gives a path only for a `file:` address with no host. An address that names another machine is never opened: on Windows that would be a network call.

- [x] **Step 1: Write `tests/relay-fakes.ts` and the failing tests** in `tests/relay-command.test.ts`

```ts
import { decide, type DecisionsRequest } from '../src/decider.js';
import type { RelayDeps } from '../src/relay-command.js';
import type { Mode, RelaySettings } from '../src/relay-store.js';

// One fake host for the /relay command and the helper hook. It behaves like the real one where the tests depend on it:
// it keeps the chat's agent and model and changes them on a switch, it reports "no effort" as `default`, and a chat that is busy stays busy until its time is up.

type Picked = { choice: string; confidence: number };
export type FakeReply = Picked & { lines?: Partial<Record<Mode, Picked>> };
type Step = 'owned' | 'get' | 'wait' | 'switchAgent' | 'switchModel' | 'put' | 'remove' | 'prompt' | 'models' | 'storageGet' | 'storageSet';
export type FakeOptions = {
  /** Default: plan [p/plan], execute [p/exec#high], review [p/review], no lines, decider d/judge. */
  settings?: Partial<RelaySettings>;
  /** Default: agent `plan`, model p/usual. */
  chat?: { agent?: string; model?: { providerID: string; id: string; variant?: string } };
  /** Default: execute at 0.98. `never` does not answer. */
  decision?: FakeReply | Error | 'never' | ((request: DecisionsRequest) => FakeReply);
  /** The decider's time limit in this fake; default 5000. */
  decideMs?: number;
  owned?: boolean; busyMs?: number; waitMs?: number; sizeMs?: number;
  /** A file's size by its address; default 2048 bytes. `never` does not answer. */
  sizes?: Record<string, number | null | Error | 'never'>;
  fail?: Partial<Record<Step, Error>>;
};

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
export const entry = (id: string, variant: string | null = null, useFor = '') => ({ providerID: 'p', id, variant, useFor });
const listed = (id: string, input: string[], variants: string[], context: number) => ({ providerID: 'p', id, name: id, enabled: true, status: 'active', variants, capabilities: { input, output: ['text'], tools: true }, limit: { context, output: 1000 }, cost: { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, tiered: false } });
/** The chat models on offer: all take text; `p/eyes` also takes pictures; `p/small` has a context window of 1,000 tokens. */
export const fakeModels = [listed('plan', ['text'], [], 100_000), listed('exec', ['text'], ['high'], 100_000), listed('review', ['text'], [], 100_000), listed('usual', ['text'], [], 100_000), listed('eyes', ['text', 'image'], [], 100_000), listed('small', ['text'], [], 1000)];

export function fakeRelay(options: FakeOptions = {}) {
  const calls: { name: string; input: unknown }[] = [], data = new Map<string, unknown>();
  const settings: RelaySettings = { revision: 1, modes: { plan: [entry('plan')], execute: [entry('exec', 'high')], review: [entry('review')] }, decider: { providerID: 'd', id: 'judge', variant: null }, ...options.settings };
  data.set('relay/settings', settings);
  const chat: { agent: string; model: { providerID: string; id: string; variant?: string } } = { agent: options.chat?.agent ?? 'plan', model: options.chat?.model ?? { providerID: 'p', id: 'usual', variant: 'default' } };
  const idleAt = Date.now() + (options.busyMs ?? 0);
  /** Every call is listed, a failing one included. */
  const step = <T>(name: Step, input: unknown, work: () => T): T => { calls.push({ name, input }); const failure = options.fail?.[name]; if (failure) throw failure; return work(); };
  const decisions = async (request: DecisionsRequest): Promise<unknown> => {
    calls.push({ name: 'decisions', input: request });
    const decision = options.decision ?? { choice: 'execute', confidence: 0.98 };
    if (decision instanceof Error) throw decision;
    if (decision === 'never') return new Promise(() => undefined);
    const reply = typeof decision === 'function' ? decision(request) : decision;
    const choice = (name: string, picked: Picked) => ({ type: 'choice', name, choice: picked.choice, probabilities: [], confidence: picked.confidence });
    return { answers: [choice('mode', reply), ...Object.entries(reply.lines ?? {}).map(([mode, picked]) => choice(`${mode}_line`, picked))], cost: 0, tokens: { input: 418, output: 38 } };
  };
  const deps: RelayDeps = {
    session: {
      async get(input: { sessionID: string }) { return step('get', input, () => ({ id: input.sessionID, agent: chat.agent, model: { ...chat.model } })); },
      async wait(input: unknown) { step('wait', input, () => undefined); const left = idleAt - Date.now(); if (left > 0) await sleep(left); calls.push({ name: 'idle', input }); },
      async switchAgent(input: { agent: string }) { step('switchAgent', input, () => { chat.agent = input.agent; }); },
      async switchModel(input: { model: { providerID: string; id: string; variant?: string } }) { step('switchModel', input, () => { chat.model = { variant: 'default', ...input.model }; }); },
      async prompt(input: unknown) { step('prompt', input, () => undefined); },
      instructions: { entry: { async put(input: unknown) { step('put', input, () => undefined); }, async remove(input: unknown) { step('remove', input, () => undefined); } } },
    } as never,
    store: {
      async get(key: string) { return step('storageGet', key, () => structuredClone(data.get(key))); },
      async set(key: string, value: unknown) { step('storageSet', key, () => { data.set(key, structuredClone(value)); }); },
    },
    chatModels: async () => step('models', undefined, () => fakeModels),
    decide: (decider, input) => decide({ decisions }, decider, input, options.decideMs),
    owned: async sessionID => step('owned', sessionID, () => options.owned ?? false),
    fileSize: async uri => {
      calls.push({ name: 'size', input: uri });
      const size = options.sizes?.[uri];
      if (size instanceof Error) throw size;
      return size === 'never' ? new Promise<number | null>(() => undefined) : size === undefined ? 2048 : size;
    },
    waitMs: options.waitMs, sizeMs: options.sizeMs,
  };
  return { deps, calls, data, chat };
}
```

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { relayCommand, isPicture, fileSize, localPath } from '../src/relay-command.js';
import { recentDecisions } from '../src/relay-store.js';
import { reviewRules } from '../src/router.js';
import { entry, fakeRelay } from './relay-fakes.js';

const typed = { text: 'fix the login test', files: [{ uri: 'file:///repo/a.txt', name: 'a.txt', mention: { start: 22, end: 28, text: '@a.txt' } }], agents: [], skills: [] };
type Fake = ReturnType<typeof fakeRelay>;
const run = (f: Fake, prompt: object = typed) => relayCommand(f.deps).execute({ sessionID: 'ses-1', prompt, delivery: 'steer' } as never);
const names = (f: Fake) => f.calls.map(call => call.name);
const input = (f: Fake, name: string) => f.calls.find(call => call.name === name)?.input as any;
const prompts = (f: Fake) => f.calls.filter(call => call.name === 'prompt').map(call => call.input);
const last = async (f: Fake) => (await recentDecisions({ get: async key => structuredClone(f.data.get(key)) }))[0];
const sent = [{ ...typed, sessionID: 'ses-1', delivery: 'steer' }];
const switches = (f: Fake) => names(f).filter(name => ['switchAgent', 'switchModel', 'put', 'remove'].includes(name));
const asked = (f: Fake) => input(f, 'decisions').input[0].text.split('\n')[1] as string;
const execute = (...list: ReturnType<typeof entry>[]) => ({ modes: { plan: [entry('plan')], execute: list, review: [entry('review')] } });

test('a sure Execute decision switches the agent, then the model, then sends once, unchanged', async () => {
  const f = fakeRelay(); await run(f);
  assert.deepEqual(names(f).filter(name => name.startsWith('switch') || name === 'prompt'), ['switchAgent', 'switchModel', 'prompt']);
  assert.deepEqual(input(f, 'switchAgent'), { sessionID: 'ses-1', agent: 'build' });
  assert.deepEqual(input(f, 'switchModel'), { sessionID: 'ses-1', model: { providerID: 'p', id: 'exec', variant: 'high' } });
  assert.deepEqual(prompts(f), sent);
});

test('Review uses the plan agent and sets the rules before the send; Plan removes them', async () => {
  const review = fakeRelay({ chat: { agent: 'build' }, decision: { choice: 'review', confidence: 0.9 } }); await run(review);
  assert.deepEqual(input(review, 'switchAgent'), { sessionID: 'ses-1', agent: 'plan' });
  assert.deepEqual(input(review, 'put'), { sessionID: 'ses-1', key: 'relay-review-rules', value: reviewRules });
  assert.ok(names(review).indexOf('put') < names(review).indexOf('prompt'));
  const plan = fakeRelay({ decision: { choice: 'plan', confidence: 0.9 } }); await run(plan);
  assert.deepEqual(input(plan, 'remove'), { sessionID: 'ses-1', key: 'relay-review-rules' });
  assert.equal(names(plan).includes('put'), false);
});

test('not sure means Plan and never build; a model with no effort is sent without a variant key', async () => {
  const f = fakeRelay({ decision: { choice: 'execute', confidence: 0.59 } }); await run(f);
  assert.equal(names(f).includes('switchAgent'), false);          // the chat was on plan already
  assert.deepEqual(input(f, 'switchModel'), { sessionID: 'ses-1', model: { providerID: 'p', id: 'plan' } });
  assert.match((await last(f)).note!, /not sure, so Plan/);
  const g = fakeRelay({ chat: { agent: 'build' }, decision: { choice: 'execute', confidence: 0.59 } }); await run(g);
  assert.deepEqual(input(g, 'switchAgent'), { sessionID: 'ses-1', agent: 'plan' });
});

test('a decider error, a slow decider and an unset decider each send unchanged with no switch and no wait', async () => {
  for (const [options, note] of [[{ decision: new Error('boom') }, /gave no answer: boom/], [{ decision: 'never', decideMs: 20 }, /took longer than/], [{ settings: { decider: null } }, /no decider chosen/]] as const) {
    const f = fakeRelay(options as never); await run(f);
    assert.deepEqual(switches(f), []); assert.equal(names(f).includes('wait'), false); assert.deepEqual(prompts(f), sent);
    const record = await last(f);
    assert.match(record.note!, note); assert.deepEqual([record.mode, record.model, record.confidence, record.fit], [null, null, null, null]);
  }
});

test('a failed switch still sends; a failed send is reported and not repeated', async () => {
  const f = fakeRelay({ fail: { switchAgent: new Error('no such agent'), switchModel: new Error('model gone') } }); await run(f);
  assert.deepEqual(prompts(f), sent);
  const record = await last(f);
  assert.match(record.note!, /agent not switched: no such agent; model not switched: model gone/); assert.equal(record.model, null, 'the chat is not on the chosen model');
  const g = fakeRelay({ fail: { prompt: new Error('inbox closed') } });
  await assert.rejects(run(g), /inbox closed/);
  assert.equal(prompts(g).length, 1);
  assert.match((await last(g)).note!, /the message could not be sent: inbox closed/);
  const h = fakeRelay({ decision: { choice: 'review', confidence: 0.9 }, fail: { put: new Error('entry refused') } }); await run(h);
  assert.deepEqual(prompts(h), sent); assert.match((await last(h)).note!, /review rules not set: entry refused/);
});

test('a picture goes only to a model with image input, and is neither sized nor named to the decider', async () => {
  const picture = { ...typed, files: [{ uri: 'file:///repo/red.png', name: 'red.png' }] };
  const none = fakeRelay(); await run(none, picture);
  assert.deepEqual(switches(none), []); assert.equal(prompts(none).length, 1);
  assert.match((await last(none)).note!, /no chosen Execute model takes pictures/);
  assert.equal(names(none).includes('size'), false);
  assert.equal(asked(none), 'The chat is on the agent: plan. Attached files: none. Attached pictures: 1.');
  const second = fakeRelay({ settings: execute(entry('exec', 'high'), entry('eyes')) }); await run(second, picture);
  assert.deepEqual(input(second, 'switchModel').model, { providerID: 'p', id: 'eyes' });
  for (const file of [{ uri: 'data:image/png;base64,AAAA' }, { uri: 'file:///x/Shot.JPEG?v=1' }, { name: 'a.webp', uri: 'x' }]) assert.equal(isPicture(file), true);
  for (const file of [{ uri: 'file:///repo/a.txt', name: 'a.txt' }, { uri: 'file:///repo/png.md' }, {}]) assert.equal(isPicture(file), false);
});

test('a busy chat is waited for before any switch; after the ceiling, or when the wait fails, the message goes unchanged', async () => {
  const f = fakeRelay({ busyMs: 30 }); await run(f);
  assert.ok(names(f).indexOf('idle') < names(f).indexOf('switchAgent'));
  const stuck = fakeRelay({ busyMs: 300, waitMs: 20 }); await run(stuck);
  assert.deepEqual(switches(stuck), []); assert.deepEqual(prompts(stuck), sent);
  assert.equal((await last(stuck)).note, 'the chat was still busy after 0.02 seconds');
  const broken = fakeRelay({ fail: { wait: new Error('no such chat') } }); await run(broken);
  assert.deepEqual(switches(broken), []); assert.deepEqual(prompts(broken), sent);
  assert.equal((await last(broken)).note, 'could not wait for the chat: no such chat');
});

test('blank text, a pipeline chat and a chat Relay cannot place are refused, and nothing is sent', async () => {
  const f = fakeRelay(); await assert.rejects(run(f, { ...typed, text: '  \n' }), /type your message after \/relay/);
  const g = fakeRelay({ owned: true }); await assert.rejects(run(g), /does not work in a chat that a Relay run created/);
  const h = fakeRelay({ fail: { owned: new Error('storage offline') } }); await assert.rejects(run(h), /storage offline/);
  assert.deepEqual([names(f), names(g), names(h)], [[], ['owned'], ['owned']]);
});

test('a chat already on the chosen agent and model is not switched again', async () => {
  const f = fakeRelay({ chat: { agent: 'build', model: { providerID: 'p', id: 'exec', variant: 'high' } } }); await run(f);
  const g = fakeRelay({ chat: { agent: 'plan', model: { providerID: 'p', id: 'plan', variant: 'default' } }, decision: { choice: 'plan', confidence: 0.9 } }); await run(g);
  for (const fake of [f, g]) { assert.equal(names(fake).some(name => name.startsWith('switch')), false); assert.equal(prompts(fake).length, 1); }
  assert.deepEqual([(await last(f)).model, (await last(g)).model], ['p/exec#high', 'p/plan']);
});

test('two /relay messages in one chat run one after the other, each on its own model', async () => {
  const f = fakeRelay({ busyMs: 20, decision: request => ({ choice: request.input[0].text.includes('first') ? 'execute' : 'plan', confidence: 0.9 }) });
  const command = relayCommand(f.deps), go = (text: string) => command.execute({ sessionID: 'ses-1', prompt: { ...typed, text }, delivery: 'steer' } as never);
  await Promise.all([go('first'), go('second')]);
  assert.deepEqual(f.calls.filter(call => ['switchModel', 'prompt'].includes(call.name)).map(call => call.name === 'prompt' ? (call.input as any).text : (call.input as any).model.id), ['exec', 'first', 'plan', 'second']);
  assert.deepEqual([f.chat.agent, f.chat.model.id], ['plan', 'plan'], 'the second message saw what the first one did to the chat, so it left build');
  const g = fakeRelay({ fail: { prompt: new Error('inbox closed') } }), failing = relayCommand(g.deps);
  await assert.rejects(failing.execute({ sessionID: 'ses-1', prompt: typed, delivery: 'steer' } as never), /inbox closed/);
  await assert.rejects(failing.execute({ sessionID: 'ses-1', prompt: typed, delivery: 'steer' } as never), /inbox closed/);
  assert.equal(prompts(g).length, 2, 'a failed message does not block the next one in that chat');
});

test('a failure of storage, the chat lookup or the model list still sends once, unchanged', async () => {
  for (const [fail, note] of [[{ storageGet: new Error('storage offline') }, null], [{ get: new Error('no such chat') }, /the chat could not be read: no such chat/], [{ models: new Error('list failed') }, /the model list could not be read: list failed/], [{ storageSet: new Error('disk full') }, null], [{ remove: new Error('no') }, null]] as const) {
    const f = fakeRelay({ fail }); await run(f);
    assert.deepEqual(prompts(f), sent);
    if (note) { assert.deepEqual(switches(f), []); assert.match((await last(f)).note!, note); }
  }
  const offline = fakeRelay({ fail: { storageGet: new Error('storage offline') } }); await run(offline);
  assert.deepEqual([switches(offline), names(offline).includes('decisions')], [[], false], 'with no settings nothing is decided or switched');
  const quiet = fakeRelay({ fail: { remove: new Error('no entry') } }); await run(quiet);
  assert.equal((await last(quiet)).note, null, 'a failed remove is not reported');
});

test('the decider gets the text, the agent, and the names and sizes of the files; the record holds no message text and no file name', async () => {
  const f = fakeRelay(); await run(f);
  const request = JSON.stringify(input(f, 'decisions'));
  assert.match(request, /fix the login test/);
  assert.equal(asked(f), 'The chat is on the agent: plan. Attached files: a.txt (2 kB). Attached pictures: 0.');
  assert.equal(/file:\/\/|\/repo|@a\.txt|\busual\b|\bexec\b|#high/.test(request), false, 'no address, no folder, no model name');
  assert.deepEqual(input(f, 'decisions').questions.map((question: { name: string }) => question.name), ['mode'], 'one model in each mode: nothing to choose');
  const record = await last(f);
  assert.deepEqual(Object.keys(record).sort(), ['at', 'confidence', 'costUsd', 'fit', 'kind', 'mode', 'model', 'ms', 'note', 'sessionID']);
  assert.deepEqual([record.kind, record.sessionID, record.mode, record.model, record.confidence, record.fit, record.costUsd, record.note], ['chat', 'ses-1', 'execute', 'p/exec#high', 0.98, null, '0', null]);
  assert.equal(/login|a\.txt/.test(JSON.stringify(record)), false);
});

test('in a mode with several models the line the decider chose picks the model', async () => {
  const settings = execute(entry('exec', 'high', 'small, clear changes'), entry('usual', null, 'large changes across many files'), entry('eyes'));
  const f = fakeRelay({ settings, chat: { model: { providerID: 'p', id: 'plan' } }, decision: { choice: 'execute', confidence: 0.9, lines: { execute: { choice: '2', confidence: 0.8 } } } }); await run(f);
  const question = input(f, 'decisions').questions[1];
  assert.deepEqual([question.name, question.choices], ['execute_line', [{ value: '1', description: 'small, clear changes' }, { value: '2', description: 'large changes across many files' }, { value: 'none', description: 'None of these fits clearly.' }]]);
  assert.deepEqual(input(f, 'switchModel').model, { providerID: 'p', id: 'usual' });
  const record = await last(f);
  assert.deepEqual([record.mode, record.model, record.fit, record.note], ['execute', 'p/usual', 0.8, null]);
});

test('when no line fits, the chat keeps its model if the mode lists it, and else the first is used', async () => {
  const settings = execute(entry('exec', 'high', 'small, clear changes'), entry('usual', null, 'large changes across many files'));
  const decision = { choice: 'execute', confidence: 0.9, lines: { execute: { choice: 'none', confidence: 0.9 } } };
  const stays = fakeRelay({ settings, decision }); await run(stays);          // the chat is on p/usual
  assert.deepEqual(switches(stays), ['switchAgent', 'remove']);
  assert.deepEqual([(await last(stays)).model, (await last(stays)).note], ['p/usual', 'no line fits clearly, so the chat\'s model stays']);
  const moves = fakeRelay({ settings, decision, chat: { model: { providerID: 'p', id: 'plan' } } }); await run(moves);
  assert.deepEqual(input(moves, 'switchModel').model, { providerID: 'p', id: 'exec', variant: 'high' });
  assert.equal((await last(moves)).note, 'no line fits clearly, so the first model is used');
  const silent = fakeRelay({ settings, decision: { choice: 'execute', confidence: 0.9 } }); await run(silent);
  assert.equal((await last(silent)).note, 'no answer about the lines, so the chat\'s model stays');
});

test('files that do not fit leave a model out; a size that cannot be read counts as nothing, and reading gives up after its limit', async () => {
  const settings = execute(entry('small'), entry('exec', 'high'));
  const big = fakeRelay({ settings, sizes: { 'file:///repo/a.txt': 8000 } }); await run(big);       // about 2,000 tokens; p/small holds 1,000
  assert.deepEqual(input(big, 'switchModel').model, { providerID: 'p', id: 'exec', variant: 'high' });
  assert.match(asked(big), /a\.txt \(8 kB\)/);
  const only = fakeRelay({ settings: execute(entry('small')), sizes: { 'file:///repo/a.txt': 8000 } }); await run(only);
  assert.deepEqual([switches(only), (await last(only)).note], [[], 'the attached files are too big for every chosen Execute model']);
  for (const size of [null, new Error('no such file'), 'never'] as const) {
    const started = Date.now(), f = fakeRelay({ settings, sizes: { 'file:///repo/a.txt': size }, sizeMs: 30 }); await run(f);
    assert.deepEqual(input(f, 'switchModel').model, { providerID: 'p', id: 'small' }, String(size));
    assert.match(asked(f), /a\.txt \(size unknown\)/);
    assert.deepEqual(prompts(f), sent); assert.ok(Date.now() - started < 1000);
  }
});

test('a file with no name is named by the last part of its address, never by its content or by what follows a ? or #', async () => {
  const f = fakeRelay(); await run(f, { ...typed, files: [{ uri: 'file:///repo/src/notes.md' }, {}, { uri: 'data:text/plain;base64,SGVsbG8=' }, { uri: 'https://example.test/docs/guide.md?token=hidden#top' }] });
  assert.match(asked(f), /Attached files: notes\.md \(2 kB\), file \(size unknown\), file \(2 kB\), guide\.md \(2 kB\)\./);
  assert.equal(/SGVsbG8|hidden|example\.test/.test(JSON.stringify(input(f, 'decisions'))), false);
});

test('only a file on this machine is sized: an address that names another machine is never opened', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'relay-size-')), file = join(folder, 'five.txt');
  try {
    writeFileSync(file, 'hello');
    assert.equal(await fileSize(pathToFileURL(file).href), 5);
    assert.equal(localPath(pathToFileURL(file).href), file);
    for (const uri of ['file://server/share/a.txt', 'https://example.test/a.txt', 'data:text/plain,hi', 'not an address', '']) { assert.equal(localPath(uri), null, uri); assert.equal(await fileSize(uri), null, uri); }
    await assert.rejects(fileSize(pathToFileURL(join(folder, 'missing.txt')).href));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
```

- [x] **Step 2: Run `npx tsx --test tests/relay-command.test.ts`** — Expected: FAIL, cannot find `../src/relay-command.js`.

- [x] **Step 3: Implement `relayCommand` and register it**

In `createRuntime`, inside the existing `try`, after the `retry` hook, and with a disposer like its neighbours. The command is made once, because the per-chat queue lives in it and the host runs the callback again whenever it rebuilds its commands:

```ts
const relayDeps: RelayDeps = {
  session: context.session, store: context.storage as unknown as RelayStore, chatModels: () => listProjectModels(context), fileSize,
  decide: (decider, input) => decide({ decisions: request => context.experimental.generate.decisions(request as never) }, decider, input),
  owned: async sessionID => await roleFor(sessionID) !== null,
};
const relay = relayCommand(relayDeps);
const command = await context.command.transform(editor => editor.add(relay));
disposers.push(() => command.dispose());
```

The command's description: `Relay: pick the model for this message (plan, execute or review) and send it`. In `tests/plugin.test.ts`, `withSessionHook` gives a fake host the `command.transform` that the real host always has, and three tests cover the registration: the command is added once and disposed; as registered it refuses a chat that a run created and sends a normal chat's message once and records it.

- [x] **Step 4: Run `npx tsx --test tests/relay-command.test.ts tests/plugin.test.ts`** — Expected: PASS.

- [x] **Step 5: Red then green.** Each of these turned its test red, and the file was then restored: no refusal of a pipeline chat; no refusal of blank text; a failure before the send not caught; no per-chat queue (this one first stayed green, so the test now also checks where the chat ends up); a failed earlier message blocking the next; a switch made while the chat is busy; the wait not limited; a `variant` key sent when the choice has none; the chat's effort not read with `hostVariant`; a picture also counted as a file; a file named with what follows `?`; a file named by a `data:` address; a `file:` address on another machine opened; the read of a size not limited; the rules set for a mode that is not Review; `model` and `fit` recorded after a failed switch; the agent switched again when the chat is on it; the files' size not counted; `owned` always false in `src/index.ts`; the command made anew on each rebuild.

- [x] **Step 6: Extend the isolated smoke** in `scripts/smoke-host-model.mjs`, before its PASS line (`scripts/smoke-host-model.mjs:150-172`)

In a new chat on a mock model: a blank `/relay` is refused with the plugin's own words; `/relay Say hello.` makes exactly one model request, on the chat's own model, with the typed text as the last message; `getRelay` then shows one decision (`chat`, this chat, no mode, no model, `no decider chosen`), revision 0 and checks off; `wait` on the idle chat returns at once; the chat is still on its own model. The chat names a mock model, so nothing here can reach a real provider. The mock also keeps the shape of each request (roles, number of tools, the first words of the system text and of the last message) and prints the shapes when the smoke fails.

- [x] **Step 7: Run `npm run build`, then `npm run smoke:host:model`**

Result: `PASS:` on Windows 11 with the OpenCode 2.3.0 CLI that ships with Desktop, in scratch folders, with the mock provider. The first runs failed with "/relay made 2 model requests, expected exactly one". The request shapes showed why: the chat was on a mock model that holds 8,000 tokens, and the host compacted the new chat before its first turn (two "summarize the conversation" requests). `/relay` did not send twice. The smoke's `/relay` chat now uses a mock model that holds 200,000 tokens. The smoke does not prove a switch: no mock can be a decision model. Recorded in `docs/compatibility.md`.

- [x] **Step 8: Run the four checks; add the progress line**
- [ ] **Step 9: Commit** — `feat: /relay command`

---

### Task 8: Checks on the Review model

**Files:**
- Create: `src/review-helper.ts`, `tests/review-helper.test.ts`
- Modify: `src/index.ts` (register beside the command), `tests/plugin.test.ts`

**Interfaces:**
- Consumes: `RelayDeps` and `fakeRelay` (Task 7); `candidates`, `linesFor`, `pickModel`, `checksStatus`, `reviewRules`, `UNSURE_BELOW`, `brief` (Task 4); `getRelaySettings`, `recordDecision`, `modelName` (Task 3). The host, as seen in Stage 0 on 2.3.0: `context.tool.hook('execute.before', handler)`; the event is `{ tool, sessionID, agent, messageID, id, input }`; the tool that starts a helper is `subagent`; its input has `agent`, `description`, `prompt`, and sometimes `model` (`provider/id#variant`) and `sessionID` (to continue a helper); replacing `event.input` changes the call; an error that escapes stops the helper from starting.
- Produces:

```ts
export function reviewHelperHook(deps: Pick<RelayDeps, 'store' | 'chatModels' | 'decide' | 'owned'>): (event: { tool: string; sessionID: string; input: unknown }) => Promise<void>
```

What the hook does, in order:

1. `event.tool !== 'subagent'`: return at once, before any `await`.
2. Everything after this is inside one `try`. A caught error is recorded as `helper left alone: <message>` if that is possible, and never thrown.
3. Return without a record when the input is not an object, has no text `prompt` or a blank one, names a `model`, or has a `sessionID`.
4. Return without a record when `deps.owned(event.sessionID)` is true.
5. Read the settings and the chat models. Return without a record, and without asking the decider, when `checksStatus` is not active.
6. Ask the decider with `{ kind: 'helper', text: input.prompt, agent: null, files: [], images: 0, lines }`, where `lines` holds only the Review lines (and only when Review has two or more usable models and a line).
7. For `review` with a confidence of 0.6 or more: pick one of the usable Review models with `pickModel(usable, answer.lines.review, null)`. A helper has no model of its own to keep, so with no clear line the first usable one is used. Then `event.input = { ...input, model: modelName(the pick), prompt: input.prompt + '\n\n' + reviewRules }`. The input object itself is not changed. Otherwise leave the input as it is.
8. Record the decision with `kind: 'helper'`, the calling chat's id, and the decider's own answer as `mode`: the model, the line's fit and the pick's note when routed; else `model: null` and the note (`not a check`, `not sure it is a check`, or the decider's reason).

- [x] **Step 1: Write the failing tests** in `tests/review-helper.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewHelperHook } from '../src/review-helper.js';
import { recentDecisions } from '../src/relay-store.js';
import { reviewRules } from '../src/router.js';
import { entry, fakeRelay } from './relay-fakes.js';

const call = (input: unknown, tool = 'subagent') => ({ tool, sessionID: 'ses-1', agent: 'build', messageID: 'msg-1', id: 'call-1', input });
const task = { agent: 'general', description: 'Check the diff', prompt: 'Review the changes in src/auth.ts for mistakes.' };
const check = { decision: { choice: 'review', confidence: 0.95 } };
type Fake = ReturnType<typeof fakeRelay>;
const asked = (f: Fake) => f.calls.find(item => item.name === 'decisions')?.input as any;
const last = async (f: Fake) => (await recentDecisions({ get: async key => structuredClone(f.data.get(key)) }))[0];
/** Settings whose Execute list has lines too, so a test can see that a helper is only asked about the Review lines. */
const reviewers = (...list: ReturnType<typeof entry>[]) => ({ modes: { plan: [entry('plan')], execute: [entry('exec', 'high', 'small changes'), entry('usual', null, 'large changes')], review: list } });
const started = async (options: object, input: object = task) => { const f = fakeRelay(options as never), event = call({ ...input }); await reviewHelperHook(f.deps)(event); return { f, input: event.input as typeof task & { model?: string } }; };

test('a helper whose task is a check starts on the Review model and gets the rules', async () => {
  const { f, input } = await started(check);
  assert.deepEqual(input, { ...task, model: 'p/review', prompt: `${task.prompt}\n\n${reviewRules}` });
  assert.equal(asked(f).input[0].text, 'A task that a model is handing to a helper: "Review the changes in src/auth.ts for mistakes."');
  assert.deepEqual(asked(f).questions.map((question: { name: string }) => question.name), ['mode'], 'one Review model: nothing to choose');
  const record = await last(f);
  assert.deepEqual(Object.keys(record).sort(), ['at', 'confidence', 'costUsd', 'fit', 'kind', 'mode', 'model', 'ms', 'note', 'sessionID']);
  assert.deepEqual([record.kind, record.sessionID, record.mode, record.model, record.confidence, record.fit, record.costUsd, record.note], ['helper', 'ses-1', 'review', 'p/review', 0.95, null, '0', null]);
  assert.equal(/auth\.ts|Review the changes/.test(JSON.stringify(record)), false, 'the record holds no task text');
  assert.equal(f.calls.some(item => ['get', 'wait', 'switchAgent', 'switchModel', 'put', 'remove', 'prompt'].includes(item.name)), false, 'the calling chat is not touched');
});

test('with several Review models the line the decider chose picks the helper\'s model, and only the Review lines are asked about', async () => {
  const settings = reviewers(entry('review', null, 'small diffs'), entry('eyes', null, 'security and money code'), entry('usual'));
  const chosen = await started({ settings, decision: { choice: 'review', confidence: 0.9, lines: { review: { choice: '2', confidence: 0.8 } } } });
  assert.equal(chosen.input.model, 'p/eyes');
  assert.deepEqual(asked(chosen.f).questions.map((question: { name: string }) => question.name), ['mode', 'review_line']);
  assert.deepEqual(asked(chosen.f).questions[1].choices.map((item: { description: string }) => item.description), ['small diffs', 'security and money code', 'None of these fits clearly.']);
  const record = await last(chosen.f);
  assert.deepEqual([record.model, record.fit, record.note], ['p/eyes', 0.8, null]);
  // A helper has no model of its own to keep, so with no clear line the first Review model is used.
  const none = await started({ settings, decision: { choice: 'review', confidence: 0.9, lines: { review: { choice: 'none', confidence: 0.9 } } } });
  assert.equal(none.input.model, 'p/review');
  assert.deepEqual([(await last(none.f)).model, (await last(none.f)).fit, (await last(none.f)).note], ['p/review', null, 'no line fits clearly, so the first model is used']);
  const effort = await started({ ...check, settings: reviewers(entry('exec', 'high')) });
  assert.equal(effort.input.model, 'p/exec#high', 'the effort travels in the model name');
  const gone = await started({ ...check, settings: reviewers(entry('gone'), entry('eyes')) });
  assert.equal(gone.input.model, 'p/eyes', 'a Review model that is not offered is passed over');
});

test('every other helper is left as it is', async () => {
  for (const [options, input, decided, note] of [
    [{ decision: { choice: 'execute', confidence: 0.95 } }, task, true, 'not a check'],
    [{ decision: { choice: 'plan', confidence: 0.95 } }, task, true, 'not a check'],
    [{ decision: { choice: 'review', confidence: 0.59 } }, task, true, 'not sure it is a check'],
    [{ decision: new Error('boom') }, task, true, 'the decider gave no answer: boom'],
    [check, { ...task, model: 'q/other' }, false, null],                               // the call names a model
    [check, { ...task, sessionID: 'ses-child' }, false, null],                         // it continues an earlier helper
    [{ ...check, settings: { modes: { plan: [], execute: [], review: [] } } }, task, false, null],   // no Review model
    [{ ...check, settings: reviewers(entry('gone')) }, task, false, null],             // the only Review model is not offered
    [{ ...check, settings: { decider: null } }, task, false, null],                    // no decider
    [{ ...check, owned: true }, task, false, null],                                    // a chat that a Relay run created
    [check, { agent: 'general' }, false, null],                                        // no task text
    [check, { ...task, prompt: '  ' }, false, null],                                   // blank task text
  ] as const) {
    const { f, input: after } = await started(options, input);
    assert.deepEqual(after, input, JSON.stringify(options));
    assert.equal(asked(f) !== undefined, decided, JSON.stringify(options));
    assert.equal((await last(f))?.note ?? null, note, JSON.stringify(options));
  }
  const unsure = await last((await started({ decision: { choice: 'review', confidence: 0.59 } })).f);
  assert.deepEqual([unsure.kind, unsure.mode, unsure.confidence, unsure.model, unsure.fit], ['helper', 'review', 0.59, null, null], 'the record keeps the decider\'s own answer');
});

test('an error inside the hook never stops a helper from starting, and the input is replaced, not changed in place', async () => {
  for (const [fail, note] of [[{ owned: new Error('storage offline') }, 'helper left alone: storage offline'], [{ models: new Error('list failed') }, 'helper left alone: list failed'], [{ storageGet: new Error('storage offline') }, null], [{ storageSet: new Error('disk full') }, null]] as const) {
    const f = fakeRelay({ ...check, fail }), event = call({ ...task });
    await assert.doesNotReject(reviewHelperHook(f.deps)(event));
    assert.equal((await last(f))?.note ?? null, note);
    if (note) assert.deepEqual(event.input, task);
  }
  for (const input of [null, undefined, 'text', 7, []]) await assert.doesNotReject(reviewHelperHook(fakeRelay(check).deps)(call(input)));
  const frozen = call(Object.freeze({ ...task }));
  await reviewHelperHook(fakeRelay(check).deps)(frozen);
  assert.equal((frozen.input as { model: string }).model, 'p/review');
});

test('any other tool passes straight through, before anything is read', async () => {
  const f = fakeRelay(check), event = call({ command: 'ls' }, 'bash');
  await reviewHelperHook(f.deps)(event);
  assert.deepEqual([f.calls, event.input], [[], { command: 'ls' }]);
});
```

- [x] **Step 2: Run `npx tsx --test tests/review-helper.test.ts`** — Expected: FAIL, cannot find `../src/review-helper.js`.
- [x] **Step 3: Implement `reviewHelperHook`; register it** in `createRuntime` beside the command: `const helper = await context.tool.hook('execute.before', reviewHelperHook(relayDeps));`, with a disposer. In `tests/plugin.test.ts`, `withSessionHook` gives a fake host the `tool.hook` that the real host always has, and two tests cover the registration: the hook is registered once and disposed, and as registered it asks the host's decision call and gives a checking helper the Review model.
- [x] **Step 4: Run `npx tsx --test tests/review-helper.test.ts tests/plugin.test.ts`** — Expected: PASS.
- [x] **Step 5: Red then green.** Each of these turned its test red, and the file was then restored: the `try` taken away; the `subagent` test moved below the first `await`; a call that names a model not left alone; a call that continues a helper not left alone; a helper in a pipeline chat not left alone; the decider asked while checks are off; a check accepted below 0.6; an `execute` answer treated as a check; the lines of every mode sent; the decider's line ignored; the rules not added to the task; the input object itself changed; the hook not disposed; the host's decision call not used as registered.
- [x] **Step 6: Run `npm run build`, then `npm run smoke:host:model`** — Result: `PASS:` (the plugin still loads with the hook registered, and the planner turn and the `/relay` part still work). No helper was started in the smoke, so the hook itself has only run against fakes.
- [x] **Step 7: Run the four checks; add the progress line**
- [ ] **Step 8: Commit** — `feat: checking helpers start on a Review model`

---

### Task 9: The Modes tab

**Files:**
- Create: `src/relay-view.ts`, `tests/relay-view.test.ts`
- Modify: `src/gui.tsx`, `src/gui-styles.ts`, `README.md:14`, `docs/desktop-testing.md:16`

**Interfaces:**
- Consumes: `getRelay`, `saveRelay`, `testDecider`, `listModels` with `cost` (Tasks 2 and 6); `offered` (`src/settings.ts`); `USE_FOR_MAX`, `Decision`, `Mode`, `ModeChoice`, `RelaySettings` (Task 3); `reviewRules`, `modeLabel` (Task 4); `MAX_CHARS`, `MAX_FILE_NAMES` (Task 5).
- Produces, in `src/relay-view.ts` (pure, so it runs under node:test; the panel bundles it, so it imports nothing from `node:`):

```ts
export function priceLabel(cost: { inputPerMillion: string | null; outputPerMillion: string | null; tiered: boolean }): string
export function decisionLine(decision: Pick<Decision, 'kind' | 'mode' | 'model' | 'confidence' | 'fit' | 'ms' | 'note'> | undefined): string
export function tryLine(result: Pick<Decision, 'mode' | 'model' | 'confidence' | 'fit' | 'ms' | 'note' | 'costUsd'>): string   // one try in the test box
export const privacyNote: (providerID: string | null) => string   // what is sent to the decider, and to whom
export const checksLine: (checks: { active: boolean; note: string | null }) => string
```

There is no "at most about $X for one decision" beside a decider: the owner dropped the budget work for `/relay` on 14 Nov.

- [x] **Step 1: Write the failing tests** in `tests/relay-view.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksLine, decisionLine, priceLabel, privacyNote, tryLine } from '../src/relay-view.js';
import { buildDecisionRequest, MAX_CHARS, MAX_FILE_NAMES } from '../src/decider.js';

const chat = { kind: 'chat' as const, mode: 'execute' as const, model: 'p/exec#high' as string | null, confidence: 0.98 as number | null, fit: null as number | null, ms: 150, note: null as string | null };

test('a price is never called free', () => {
  assert.equal(priceLabel({ inputPerMillion: '0', outputPerMillion: '0', tiered: false }), '$0 or not listed');
  assert.equal(priceLabel({ inputPerMillion: null, outputPerMillion: null, tiered: false }), 'price not listed');
  assert.equal(priceLabel({ inputPerMillion: '0.24', outputPerMillion: '0', tiered: false }), '$0.24 in / $0 out per 1M tokens');
  assert.equal(priceLabel({ inputPerMillion: '1', outputPerMillion: null, tiered: true }), '$1 in / not listed out per 1M tokens (base tier)');
});

test('the last choice reads as one line', () => {
  assert.equal(decisionLine(undefined), 'No /relay message yet.');
  assert.equal(decisionLine(chat), 'Last choice: Execute, p/exec#high, 98% sure, 150 ms.');
  assert.equal(decisionLine({ ...chat, model: 'p/usual', confidence: 0.9, fit: 0.8 }), 'Last choice: Execute, p/usual, 90% sure, line fit 80%, 150 ms.');
  assert.equal(decisionLine({ ...chat, confidence: null }), 'Last choice: Execute, p/exec#high, 150 ms.');
  assert.equal(decisionLine({ ...chat, mode: 'plan', model: 'p/plan', confidence: 0.4, note: 'not sure, so Plan' }), 'Last choice: Plan, p/plan, 40% sure, 150 ms (not sure, so Plan).');
  assert.equal(decisionLine({ ...chat, mode: null, model: null, confidence: null, ms: 5000, note: 'the decider took longer than 5 seconds' }), 'Last choice: nothing switched (the decider took longer than 5 seconds).');
  assert.equal(decisionLine({ ...chat, model: null, note: 'no chosen Execute model takes pictures' }), 'Last choice: nothing switched (no chosen Execute model takes pictures).');
  assert.equal(decisionLine({ ...chat, kind: 'helper', mode: 'review', model: 'p/review', confidence: 0.95, ms: 160.4 }), 'Last choice (a helper): Review, p/review, 95% sure, 160 ms.');
  assert.equal(decisionLine({ ...chat, kind: 'helper', model: null, confidence: 0.9, note: 'not a check' }), 'Last choice (a helper): left as it was (not a check).');
});

test('a try in the test box reads as one line, with the cost', () => {
  assert.equal(tryLine({ mode: 'review', confidence: 0.97, model: 'p/m#high', fit: 0.8, ms: 150, costUsd: '0', note: null }), 'Review, p/m#high, 97% sure, line fit 80%, 150 ms, cost $0.');
  assert.equal(tryLine({ mode: 'plan', confidence: 0.4, model: null, fit: null, ms: 150, costUsd: null, note: 'not sure, so Plan; no model chosen for Plan' }), 'Plan, no model, 40% sure, 150 ms, cost not reported (not sure, so Plan; no model chosen for Plan).');
  assert.equal(tryLine({ mode: null, confidence: null, model: null, fit: null, ms: 5000, costUsd: null, note: 'the decider took longer than 5 seconds' }), 'No answer (the decider took longer than 5 seconds).');
});

test('the panel says what is sent to the decider and to whom, with the limits the decider really has', () => {
  assert.equal(privacyNote('opencode'), "To choose, Relay sends to opencode: your message text (at most 4,000 characters), the names and sizes of attached files (the first 10), how many pictures are attached, the name of the chat's agent, and the lines you wrote above. Never the contents of files, pictures or earlier messages. While a decider and a Review model are chosen, the task text of each helper that a model starts is sent the same way.");
  assert.match(privacyNote(null), /^To choose, Relay sends to the decider's provider: your message text/);
  assert.deepEqual([MAX_CHARS, MAX_FILE_NAMES], [4000, 10]);
  // Everything the request carries is something the sentence names: the text, file names with sizes, a count of pictures, the agent and the lines.
  const request = buildDecisionRequest({ providerID: 'opencode', id: 'judge', variant: null }, { kind: 'chat', text: 'fix the test', agent: 'build', files: [{ name: 'C:/home/me/notes.txt', bytes: 2048 }], images: 2, lines: { plan: ['deep design', 'quick questions'] } });
  assert.deepEqual(request.input, [{ type: 'text', text: 'The person\'s message: "fix the test"\nThe chat is on the agent: build. Attached files: notes.txt (2 kB). Attached pictures: 2.' }]);
  assert.deepEqual(request.questions.map(question => question.name), ['mode', 'plan_line']);
  assert.deepEqual(request.questions[1].choices.map(choice => choice.description), ['deep design', 'quick questions', 'None of these fits clearly.']);
});

test('the panel says whether helpers that check work get a Review model', () => {
  assert.equal(checksLine({ active: true, note: null }), 'Helpers that check work start on a Review model.');
  assert.equal(checksLine({ active: false, note: 'no decider chosen' }), "Helpers that check work keep the chat's model: no decider chosen.");
  assert.equal(checksLine({ active: false, note: null }), "Helpers that check work keep the chat's model: not set up.");
});
```

- [x] **Step 2: Run `npx tsx --test tests/relay-view.test.ts`** — Expected: FAIL, cannot find `../src/relay-view.js`.
- [x] **Step 3: Implement the five functions.** Run the test — Expected: PASS.

- [x] **Step 4: Change `src/gui.tsx`**

- The tab's label is `Modes`; its id stays `models`. The panel opens on it. The tag reads `Plan · Execute · Review`.
- `roleCards` becomes `modeCards`: Plan, "Thinks, explains and plans. Cannot change files."; Execute, "Writes, changes, fixes and runs. Can change files."; Review, "Checks existing work and reports. Cannot change files. Helpers that check work use these models too."
- The resource loads `listModels` and `getRelay` (no longer `getSelections`). Every change (a model added or removed, a line written, a decider chosen) saves through `saveRelay` with the current revision and then reloads. When the server refuses, its own words are shown and the controls go back to what is stored. The old pipeline's role selections stay in storage and can no longer be edited here.
- The tab body, top to bottom: the help line "Type /relay and your message in the chat. Relay picks Plan, Execute or Review for it, switches the chat to a model you chose for that mode, and sends your message. These settings are the same in every project."; the three mode cards; a Decider card; a closed "Review rules" section holding `reviewRules`; the existing count, Refresh and save-error row.
- A mode card: each chosen model as a chip (marked `unavailable` by the router's own test, `offered`) with a remove button, and beside it a text box "Use it for…" of at most 200 characters, saved when it is left; "None chosen yet. /relay leaves the chat as it is for <Mode>." for an empty list; with two or more models, the rule in one hint: the decider picks the one whose line fits; when no line fits clearly the chat keeps its model if it is in the list, otherwise the first is used; with no lines written the first is always used; then the "Add a model" select.
- The Decider card: a select of `deciders`, each option `<name> · <effort> · <priceLabel>`, with "No decider: /relay sends without switching" first and a saved decider that is no longer offered kept in the list as "not offered now"; `privacyNote(<the decider's provider>)`; a text box and a Try button that calls `testDecider` and shows `tryLine` of the result, or the server's words when it fails (Try is off with no decider or no text); `decisionLine(decisions[0])`; `checksLine(checks)`.
- Every control keeps a label, as the existing ones have. `src/gui-styles.ts` gains `.rl-pick` for a chip above its text box.
- `README.md:14` names the tabs as Run, Modes, Spend, More and says what the Modes tab holds. That line and `docs/desktop-testing.md:16` each say that the panel no longer edits the old pipeline's planner, coder and reviewer models. The rest of the docs changes in Stage 2.

- [x] **Step 5: Red then green.** Each of these turned its test red, and the file was then restored: a price of 0 shown as a price; no "price not listed"; no "(base tier)"; a helper said to be "nothing switched"; a choice with no model shown as a choice; the line's fit left out; a missing confidence shown as 0%; no answer shown as Plan; an unreported cost shown as $0; a missing reason shown as "null"; the character limit not taken from the decider; a file's whole path sent to the decider.
- [x] **Step 6: Look at the tab.** In a browser preview with fake data (a scratch harness, loopback only), in both themes: a model added, removed, a line written (spaces tidied), a decider chosen and cleared, a sample tried, and a refused save (the server's words shown, the controls back to what is stored).
- [x] **Step 7: Run the four checks; add the progress line.** Not verified by them: how the tab looks and works in Desktop. That is Task 11.
- [ ] **Step 8: Commit** — `feat: the Models tab becomes Modes`

---

### Task 10: Thirty examples for the decider

**Files:**
- Create: `scripts/relay-examples.json`, `scripts/decider-examples.ts`, `tests/relay-examples.test.ts`
- Modify: `package.json` (script `examples:decider`: `tsx scripts/decider-examples.ts`), `docs/compatibility.md`, `README.md` (the `/relay` bullet)

**Interfaces:**
- Consumes: `decide`, `TIMEOUT_MS`, `DecisionsHost`, `FileFact` (Task 5); `candidates`, `linesFor`, `pickModel`, `route`, `modeLabel`, `UNSURE_BELOW`, `DeciderAnswer`, `LineAnswer` (Task 4); `listProjectModels`, `ListedModel` (Task 2); `priceLabel` (Task 9); `parseUsd`, `formatUsd` (`src/costs.ts`); the way `scripts/smoke-host-model.mjs` starts and stops an isolated server.
- Produces `scripts/relay-examples.json`: `{ lines, examples }`. `lines` is one sample set of "use it for" lines, two for each mode. Each of the 30 examples names its expected mode and the line of that mode it should match (counted from 1), or `null` when none fits.
- Produces, in `scripts/decider-examples.ts`. The pure parts are exported and tested; `main` runs only when the file is the script, as in `scripts/check-prices.ts`. `scripts/` is not in `tsconfig.json`, so the script is type-checked through the test that imports it.

```ts
export type Example = { text: string; agent: 'plan' | 'build'; expect: Mode; line: number | null; nearMiss?: true; followUp?: true; files?: FileFact[] };
export type ExampleSet = { lines: Record<Mode, string[]>; examples: Example[] };
// `said` is the decider's own mode and `mode` the one after the 0.6 rule. `lineSaid` is its own answer about the expected mode's lines and `line` the line picked after the 0.5 rule.
export type Outcome = { mode: Mode | null; said: Mode | null; confidence: number | null; line: number | null; fit: number | null; lineSaid: LineAnswer | null; ms: number; costUsd: string | null; note: string | null };
export type Summary = { total: number; rightMode: number; toExecute: number; changed: number; rescued: number; spoiled: number; offLine: number; wrongLine: number; noLine: number; extraLine: number; noAnswer: number; firstMs: number | null; medianMs: number | null; slowestMs: number | null; costUsd: string; costReported: number; mixups: string[] };
export function judge(set: ExampleSet, example: Example, answer: DeciderAnswer): Outcome
export function scoreExamples(set: ExampleSet, outcomes: readonly Outcome[]): Summary
export function examplesReport(summary: Summary): string
export function modelRefusal(providerID: string, id: string, listed: readonly ListedModel[], paid: boolean): string | null
export async function runExamples(set: ExampleSet, host: DecisionsHost, decider: ModelChoice, pauseMs = 300): Promise<Outcome[]>
```

How an example is judged. The sample lines become settings with one made-up model for each line, all usable, so every request carries the mode question and the three line questions. The mode is what `route` gives (confidence below 0.6 means Plan). The line is what `pickModel` gives for the answer to the **expected** mode's line question (0.5 or more, else none), whatever mode the decider chose, so a wrong mode does not hide how well the lines are told apart. "Off the expected line" counts every difference among the 30: a wrong line, no line where one was expected, and a line where none was expected.

- [x] **Step 1: Write the failing tests** in `tests/relay-examples.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { examplesReport, judge, modelRefusal, runExamples, scoreExamples, type Example, type ExampleSet, type Outcome } from '../scripts/decider-examples.js';
import { modes, USE_FOR_MAX, type Mode } from '../src/relay-store.js';
import { MAX_LINES, type DeciderAnswer, type LineAnswer } from '../src/router.js';

// No network and no host: the labelled set is read from the repo, and the scoring is fed made-up answers.
const set = JSON.parse(readFileSync(new URL('../scripts/relay-examples.json', import.meta.url), 'utf8')) as ExampleSet;
const answer = (mode: Mode, confidence: number, lines: Partial<Record<Mode, LineAnswer>> = {}): DeciderAnswer => ({ kind: 'answer', mode, confidence, lines, ms: 150, costUsd: '0' });
const tiny: ExampleSet = {
  lines: { plan: ['design', 'understand'], execute: ['small edits', 'large work'], review: ['security', 'correctness'] },
  examples: [
    { text: 'rename it', agent: 'build', expect: 'execute', line: 1 },
    { text: 'why is it slow?', agent: 'build', expect: 'plan', line: 2, nearMiss: true },
    { text: 'ok, do it', agent: 'plan', expect: 'execute', line: null, followUp: true },
    { text: 'check for leaks', agent: 'build', expect: 'review', line: 1 },
  ],
};
// Unless a test says otherwise, the decider itself said the mode that the router kept.
const outcome = (over: Partial<Outcome>): Outcome => ({ said: over.mode === undefined ? 'plan' : over.mode, mode: 'plan', confidence: 0.9, line: null, fit: null, lineSaid: null, ms: 150, costUsd: '0', note: null, ...over });

test('the example set has 30 labelled messages, 10 near misses, 3 follow-ups and one sample set of lines', () => {
  assert.equal(set.examples.length, 30);
  for (const mode of modes) {
    assert.ok(set.lines[mode].length >= 2 && set.lines[mode].length <= MAX_LINES, `${mode} has two to eight lines`);
    for (const line of set.lines[mode]) assert.ok(line.trim() === line && line.length > 0 && line.length <= USE_FOR_MAX);
    assert.ok(set.examples.filter(example => example.expect === mode).length >= 8, `${mode} has at least eight examples`);
    for (const [index] of set.lines[mode].entries()) assert.ok(set.examples.filter(example => example.expect === mode && example.line === index + 1).length >= 2, `${mode} line ${index + 1} is expected by at least two examples`);
  }
  for (const example of set.examples) {
    assert.ok(example.text.trim());
    assert.ok(['plan', 'build'].includes(example.agent));
    assert.ok(modes.includes(example.expect));
    assert.ok(example.line === null || (Number.isInteger(example.line) && example.line >= 1 && example.line <= set.lines[example.expect].length), `"${example.text}" names a line of its own mode, or none`);
    for (const file of example.files ?? []) assert.ok(file.name.trim() && Number.isInteger(file.bytes) && file.bytes! > 0);
  }
  const nearMisses = set.examples.filter(example => example.nearMiss);
  assert.ok(nearMisses.length >= 10);
  assert.equal(nearMisses.some(example => example.expect === 'execute'), false, 'a near miss is never Execute');
  const followUps = set.examples.filter(example => example.followUp);
  assert.ok(followUps.length >= 3);
  assert.ok(followUps.every(example => example.agent === 'plan' && example.expect === 'execute'), 'a follow-up is "do it" after a plan');
  assert.equal(new Set(set.examples.map(example => example.text)).size, 30);
  const none = set.examples.filter(example => example.line === null).length;
  assert.ok(none >= 3 && none <= 8, 'a few examples fit no line, most fit one');
});

test('an example is judged by the router: the 0.6 rule for the mode, the 0.5 rule for the line of the expected mode', () => {
  const [rename, slow] = tiny.examples;
  assert.deepEqual(judge(tiny, rename, answer('execute', 0.98, { execute: { index: 0, confidence: 0.8 } })), { mode: 'execute', said: 'execute', confidence: 0.98, line: 1, fit: 0.8, lineSaid: { index: 0, confidence: 0.8 }, ms: 150, costUsd: '0', note: null });
  assert.deepEqual((({ mode, said, lineSaid }) => [mode, said, lineSaid])(judge(tiny, rename, answer('execute', 0.59))), ['plan', 'execute', null], 'not sure means Plan, and what the decider itself said is kept');
  assert.deepEqual(judge(tiny, rename, answer('execute', 0.9, { execute: { index: 1, confidence: 0.49 } })).lineSaid, { index: 1, confidence: 0.49 }, 'the line answer is kept even when it is under the 0.5 rule');
  assert.deepEqual([judge(tiny, rename, answer('execute', 0.9, { execute: { index: 1, confidence: 0.49 } })).line, judge(tiny, rename, answer('execute', 0.9, { execute: { index: 1, confidence: 0.5 } })).line], [null, 2]);
  assert.equal(judge(tiny, rename, answer('execute', 0.9, { execute: { index: null, confidence: 0.9 } })).line, null, 'the decider chose none');
  // The mode is wrong, and the line is still read from the question about the expected mode's lines.
  assert.deepEqual((({ mode, line }) => ({ mode, line }))(judge(tiny, slow, answer('execute', 0.9, { plan: { index: 1, confidence: 0.7 }, execute: { index: 0, confidence: 0.9 } }))), { mode: 'execute', line: 2 });
  assert.deepEqual(judge(tiny, slow, { kind: 'none', reason: 'the decider took longer than 5 seconds', ms: 5000 }), { mode: null, said: null, confidence: null, line: null, fit: null, lineSaid: null, ms: 5000, costUsd: null, note: 'the decider took longer than 5 seconds' });
});

test('the score says what the not-sure rule did: the answers it made right and the answers it made wrong', () => {
  const five: ExampleSet = { ...tiny, examples: [...tiny.examples, { text: 'explain it', agent: 'build', expect: 'plan', line: null }] };
  const summary = scoreExamples(five, [
    outcome({ mode: 'plan', said: 'execute', confidence: 0.55, line: 1, fit: 0.9 }),   // the decider was right but not sure, so Plan: made wrong
    outcome({ mode: 'plan', said: 'execute', confidence: 0.3, line: 2, fit: 0.9 }),    // the decider was wrong and not sure, so Plan: made right
    outcome({ mode: 'plan', said: 'plan', confidence: 0.4 }),                          // wrong either way, and the rule changed nothing
    outcome({ mode: 'plan', said: 'execute', confidence: 0.5, line: 1, fit: 0.9 }),    // wrong either way, and the rule changed it
    outcome({ mode: 'plan', said: 'review', confidence: 0.2 }),                        // made right
  ]);
  assert.deepEqual([summary.rightMode, summary.changed, summary.rescued, summary.spoiled], [2, 4, 2, 1]);
  assert.deepEqual(summary.mixups, [
    'mode: "rename it" expected Execute, got Plan (the decider said Execute, 55% sure)',
    'rule: "why is it slow?" is Plan only by the not-sure rule (the decider said Execute, 30% sure)',
    'mode: "ok, do it" expected Execute, got Plan (40% sure)',
    'mode: "check for leaks" expected Review, got Plan (the decider said Execute, 50% sure)',
    'rule: "explain it" is Plan only by the not-sure rule (the decider said Review, 20% sure)',
  ]);
  assert.match(examplesReport(summary), /^Not-sure rule \(under 60% sure means Plan\): changed 4 of 5 answers; 2 became right, 1 became wrong\.$/m);
});

test('the score counts right modes, mistaken Execute, lines other than the expected one, times and cost', () => {
  const summary = scoreExamples(tiny, [
    outcome({ mode: 'execute', line: 2, fit: 0.7, ms: 900, costUsd: '0.001' }),          // right mode, wrong line
    outcome({ mode: 'execute', confidence: 0.8, line: null, lineSaid: { index: 1, confidence: 0.4 }, ms: 200, costUsd: '0.002' }),   // sent to Execute by mistake, and no line where one was expected
    outcome({ mode: 'execute', line: 1, fit: 0.6, ms: 100, costUsd: null }),                // right mode, a line where none was expected
    outcome({ mode: null, confidence: null, line: null, lineSaid: null, ms: 800, costUsd: null, note: 'the decider gave no answer: 429' }),    // no answer
  ]);
  // The first request is timed apart: 900 ms is not the slowest of "the others".
  assert.deepEqual({ ...summary, mixups: [] }, { total: 4, rightMode: 2, toExecute: 1, changed: 0, rescued: 0, spoiled: 0, offLine: 4, wrongLine: 1, noLine: 2, extraLine: 1, noAnswer: 1, firstMs: 900, medianMs: 200, slowestMs: 800, costUsd: '0.003', costReported: 2, mixups: [] });
  assert.deepEqual(summary.mixups, [
    'line: "rename it" expected Execute line 1, got line 2 (fit 70%)',
    'mode: "why is it slow?" expected Plan, got Execute (80% sure)',
    'line: "why is it slow?" expected Plan line 2, got no line (the decider said line 2, 40% sure)',
    'line: "ok, do it" expected no Execute line, got line 1 (fit 60%)',
    'mode: "check for leaks" expected Review, got no answer (the decider gave no answer: 429)',
    'line: "check for leaks" expected Review line 1, got no line',
  ]);
  // "None" is an answer too, and the report says how sure the decider was of it.
  assert.deepEqual(scoreExamples({ ...tiny, examples: [tiny.examples[0]] }, [outcome({ mode: 'execute', lineSaid: { index: null, confidence: 0.95 } })]).mixups, ['line: "rename it" expected Execute line 1, got no line (the decider said none, 95% sure)']);
  assert.throws(() => scoreExamples(tiny, []), /4 examples but 0 outcomes/);
});

test('the report says each Gate 1 line and whether it passes', () => {
  const good: Example[] = Array.from({ length: 30 }, (_, index) => ({ text: `message ${index}`, agent: 'build', expect: 'plan', line: null }));
  const passing = examplesReport(scoreExamples({ ...tiny, examples: good }, good.map(() => outcome({}))));
  assert.match(passing, /^Right mode: 30 of 30\. Gate 1 needs at least 27: pass\.$/m);
  assert.match(passing, /^Sent to Execute by mistake: 0\. Gate 1 needs 0: pass\.$/m);
  assert.match(passing, /^Off the expected line: 0 of 30 \(0 wrong line, 0 no line where one was expected, 0 a line where none was expected\)\. Gate 1 allows 3: pass\.$/m);
  assert.match(passing, /^Not-sure rule \(under 60% sure means Plan\): changed 0 of 30 answers; 0 became right, 0 became wrong\.$/m);
  assert.match(passing, /^Time: first request 150 ms; the other 29: median 150 ms, slowest 150 ms\. Gate 1 needs under 1000 ms: first request pass, the others pass\.$/m);
  assert.match(passing, /^Cost the host reported: \$0 \(30 of 30 requests reported one\)\.$/m);
  assert.match(passing, /^No answer: 0 of 30\.$/m);
  assert.match(passing, /^Mix-ups: none\.$/m);
  const failing = examplesReport(scoreExamples({ ...tiny, examples: good }, good.map((_, index) => outcome(index < 4 ? { mode: 'execute', line: 1, fit: 0.9, ms: index === 0 ? 1000 : 150 } : {}))));
  assert.match(failing, /^Right mode: 26 of 30\. Gate 1 needs at least 27: MISS\.$/m);
  assert.match(failing, /^Sent to Execute by mistake: 4\. Gate 1 needs 0: MISS\.$/m);
  assert.match(failing, /a line where none was expected\)\. Gate 1 allows 3: MISS\.$/m);
  // The first request after the host starts can be a cold start, so it gets its own verdict.
  assert.match(failing, /^Time: first request 1000 ms; .*under 1000 ms: first request MISS, the others pass\.$/m);
  assert.match(examplesReport(scoreExamples({ ...tiny, examples: good }, good.map((_, index) => outcome({ ms: index === 7 ? 1000 : 150 })))), /^Time: first request 150 ms; the other 29: median 150 ms, slowest 1000 ms\. Gate 1 needs under 1000 ms: first request pass, the others MISS\.$/m);
  assert.match(failing, /^Mix-ups:\n- mode: "message 0" expected Plan, got Execute \(90% sure\)$/m);
});

// ---- The run itself, against a made-up host: how many requests go out, and when it stops ----
const picked = (name: string, choice: string, confidence: number) => ({ type: 'choice', name, choice, probabilities: [], confidence });
const judgeModel = { providerID: 'd', id: 'judge', variant: null };
function fakeHost(reply: (count: number) => unknown) {
  const requests: any[] = [];
  return { requests, async decisions(request: unknown) { requests.push(request); const value = reply(requests.length); if (value instanceof Error) throw value; return value; } };
}

test('a run sends each example once, with every line question, and never more than 30', async () => {
  const host = fakeHost(() => ({ answers: [picked('mode', 'execute', 0.9), picked('execute_line', '1', 0.8), picked('plan_line', '2', 0.7), picked('review_line', 'none', 0.9)], cost: 0 }));
  const outcomes = await runExamples(tiny, host, judgeModel, 0);
  assert.deepEqual(outcomes.map(({ mode, line, costUsd }) => [mode, line, costUsd]), [['execute', 1, '0'], ['execute', 2, '0'], ['execute', 1, '0'], ['execute', null, '0']]);
  assert.equal(host.requests.length, 4);
  assert.deepEqual(host.requests.map(request => request.model), Array(4).fill({ providerID: 'd', id: 'judge' }));
  assert.deepEqual(host.requests[0].questions.map((question: { name: string }) => question.name), ['mode', 'plan_line', 'execute_line', 'review_line']);
  assert.match(host.requests[2].input[0].text, /"ok, do it"\nThe chat is on the agent: plan\. Attached files: none\. Attached pictures: 0\./);
  const tooMany = fakeHost(() => ({ answers: [] }));
  await assert.rejects(runExamples({ ...tiny, examples: Array.from({ length: 31 }, (_, index) => ({ ...tiny.examples[0], text: `message ${index}` })) }, tooMany, judgeModel, 0), /at most 30 examples/);
  assert.equal(tooMany.requests.length, 0, 'nothing is sent when the set is too big');
});

test('a run stops when the model cannot be reached: no answer to the first request, or to three in a row', async () => {
  const dead = fakeHost(() => new Error('401 unauthorized'));
  await assert.rejects(runExamples(set, dead, judgeModel, 0), /Stopped after 1 request\(s\): the model did not answer \(the decider gave no answer: 401 unauthorized\)/);
  assert.equal(dead.requests.length, 1);
  const limited = fakeHost(count => count <= 2 ? { answers: [picked('mode', 'plan', 0.9)], cost: 0 } : new Error('429 too many requests'));
  await assert.rejects(runExamples(set, limited, judgeModel, 0), /Stopped after 5 request\(s\)/);
  assert.equal(limited.requests.length, 5);
  // Misses with answers between them do not stop the run: only three in a row do.
  const flaky = fakeHost(count => [2, 4, 6].includes(count) ? new Error('502') : { answers: [picked('mode', 'plan', 0.9)], cost: 0 });
  assert.equal((await runExamples(set, flaky, judgeModel, 0)).length, 30);
});

test('a model is refused before any request unless it is listed, enabled and free (or the paid switch is on)', () => {
  const model = (id: string, enabled: boolean, input: string | null, output: string | null) => ({ providerID: 'd', id, name: id, enabled, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: false }, limit: { context: 1000, output: 100 }, cost: { inputPerMillion: input, outputPerMillion: output, cacheReadPerMillion: null, tiered: false } });
  const listed = [model('free', true, '0', '0'), model('off', false, '0', '0'), model('paid', true, '0.24', '0'), model('unknown', true, null, null)];
  assert.equal(modelRefusal('d', 'free', listed, false), null);
  assert.match(modelRefusal('d', 'gone', listed, false)!, /does not list d\/gone as a decision model\. It lists: d\/free, d\/off, d\/paid, d\/unknown\./);
  assert.match(modelRefusal('d', 'off', listed, false)!, /not enabled/);
  assert.match(modelRefusal('d', 'paid', listed, false)!, /has a listed price \(\$0\.24 in \/ \$0 out per 1M tokens\)\. Set RELAY_EXAMPLES_PAID=1/);
  assert.match(modelRefusal('d', 'unknown', listed, false)!, /price not listed/, 'an unknown price is not a free one');
  assert.equal(modelRefusal('d', 'paid', listed, true), null);
  assert.match(modelRefusal('d', 'off', listed, true)!, /not enabled/, 'the paid switch does not enable a model');
});
```

- [x] **Step 2: Run `npx tsx --test tests/relay-examples.test.ts`** — Expected: FAIL, cannot find `../scripts/decider-examples.js`.

- [x] **Step 3: Write the sample lines and the 30 examples**

11 plan, 11 execute and 8 review. Ten are near misses (a question about fixing or changing something that is not Execute), three are follow-ups typed on a chat that is on `plan` ("ok, do it"), seven fit no line, and three name one made-up file. The six examples of the first design are kept. Made-up file names only.

```json
{
  "lines": {
    "plan": [
      "hard thinking: architecture, design, comparing options and trade-offs",
      "understanding existing code: what it does, why it behaves this way, where something is"
    ],
    "execute": [
      "small, quick edits: typos, renames, one-line fixes, config values",
      "larger work: new features, refactors, changes across several files"
    ],
    "review": [
      "security: secrets, auth, injection, permissions",
      "correctness: bugs, edge cases, missing tests"
    ]
  },
  "examples": [
    { "text": "explain this", "agent": "build", "expect": "plan", "line": 2 },
    { "text": "how would you fix this?", "agent": "build", "expect": "plan", "line": null, "nearMiss": true },
    { "text": "why is login slow? @src/auth.ts", "agent": "build", "expect": "plan", "line": 2, "files": [{ "name": "src/auth.ts", "bytes": 5200 }] },
    { "text": "what are the trade-offs between keeping sessions in redis and in postgres?", "agent": "plan", "expect": "plan", "line": 1 },
    { "text": "should we split billing into its own service? give me the pros and cons", "agent": "build", "expect": "plan", "line": 1, "nearMiss": true },
    { "text": "which of these two ways to fix the retry bug is safer?", "agent": "build", "expect": "plan", "line": 1, "nearMiss": true },
    { "text": "what does the migration script change in the users table?", "agent": "build", "expect": "plan", "line": 2, "nearMiss": true },
    { "text": "design a data model for team invitations with expiry and roles", "agent": "plan", "expect": "plan", "line": 1 },
    { "text": "how should we restructure the checkout flow so it stops being flaky? compare two options", "agent": "build", "expect": "plan", "line": 1, "nearMiss": true },
    { "text": "why does the fix for the timezone bug not work?", "agent": "build", "expect": "plan", "line": 2, "nearMiss": true },
    { "text": "what would it take to move the public API from REST to gRPC?", "agent": "build", "expect": "plan", "line": 1, "nearMiss": true },

    { "text": "Please find out why the login test fails and fix it.", "agent": "build", "expect": "execute", "line": null },
    { "text": "Review this and fix it", "agent": "build", "expect": "execute", "line": null },
    { "text": "ok, do it", "agent": "plan", "expect": "execute", "line": null, "followUp": true },
    { "text": "rename getUser to fetchUser in api.ts", "agent": "build", "expect": "execute", "line": 1 },
    { "text": "fix the typo in the README title", "agent": "build", "expect": "execute", "line": 1 },
    { "text": "add CSV export to the reports page, with tests", "agent": "build", "expect": "execute", "line": 2 },
    { "text": "yes, go ahead with the refactor you proposed across the three services", "agent": "plan", "expect": "execute", "line": 2, "followUp": true },
    { "text": "bump the request timeout to 30 seconds in config.yaml", "agent": "build", "expect": "execute", "line": 1 },
    { "text": "refactor the payment module to use the new client everywhere", "agent": "build", "expect": "execute", "line": 2 },
    { "text": "run the unit tests and tell me which ones fail", "agent": "build", "expect": "execute", "line": null },
    { "text": "looks right, apply it", "agent": "plan", "expect": "execute", "line": null, "followUp": true },

    { "text": "review my changes for security problems before I push", "agent": "build", "expect": "review", "line": 1 },
    { "text": "check this diff for bugs and missed edge cases", "agent": "build", "expect": "review", "line": 2, "files": [{ "name": "changes.diff", "bytes": 12400 }] },
    { "text": "does this PR leak any API keys or tokens?", "agent": "build", "expect": "review", "line": 1, "files": [{ "name": "pr-482.patch", "bytes": 40100 }] },
    { "text": "look over the new upload handler and tell me what is wrong with it, don't change anything", "agent": "build", "expect": "review", "line": 2, "nearMiss": true },
    { "text": "is the SQL in reports.ts safe from injection?", "agent": "plan", "expect": "review", "line": 1 },
    { "text": "before I merge: did my fix for the null check cover every caller?", "agent": "build", "expect": "review", "line": 2, "nearMiss": true },
    { "text": "review the README wording for tone and clarity", "agent": "build", "expect": "review", "line": null },
    { "text": "would this change break anything? just check, don't fix", "agent": "build", "expect": "review", "line": 2, "nearMiss": true }
  ]
}
```

- [x] **Step 4: Write `scripts/decider-examples.ts`**

- `main` starts an isolated OpenCode as the smokes do (scratch config, data, cache and state folders, a throwaway password, loopback, no credential, no plugin; `FEATURE_PILOT_SMOKE_CLI`) and reads its version. The decider is `RELAY_EXAMPLES_MODEL` (default `opencode/jev-1.13-free`; the provider is the part before the first `/`).
- It lists the decision models through `listProjectModels` (safe fields only) and stops with `modelRefusal`'s words when the model is not listed, not enabled, or has a price that is not 0 in and 0 out (an unknown price is not a free one) and `RELAY_EXAMPLES_PAID=1` is not set.
- `runExamples` sends one request for each example, in order, through `decide`, over the client's `experimental.generate.decisions` call (unwrapping `data` when the client wraps its result). It refuses a set of more than 30. The first request may take a minute, because the host's first use of a provider is slow; every later one has `/relay`'s own 5 seconds. It stops when the model cannot be reached: no answer to the first request, or to three in a row.
- It prints one line naming the decider, its price, the host's version and the number of requests, then `examplesReport`, then a line that says what the run does not show. Nothing else from the host is printed.
- `RELAY_EXAMPLES_OUT=<file>` keeps the outcomes. `RELAY_EXAMPLES_FROM=<file>` prints the report for kept outcomes again with no host and no request. `RELAY_EXAMPLES_SET=<file>` uses another labelled set.
- Run the tests — Expected: PASS.

- [x] **Step 5: Red then green.** Each of these turned its test red, and the file was then restored: the line read from the decider's own mode instead of the expected one; the decider's own mode not kept; the 0.6 rule not applied; a line under 0.5 counted as picked; the line answer not kept; an answer the rule did not change counted as changed; changed answers not counted; answers made right not counted; every changed wrong answer counted as made wrong; "became right" and "became wrong" swapped; the wrong number as "changed"; the line the decider said off by one; the decider's "none" worded differently; an Execute example counted as sent to Execute by mistake; the first request counted among "the others"; a missing cost counted as $0; fewer outcomes than examples accepted; each of the four Gate 1 bars loosened (the time bar for the first request and for the others); the others' time verdict taken from the first request; a set of 31 sent; a run that goes on after no answer to the first request; a run that goes on after three in a row; misses counted as in a row when answers came between them; a model with an unknown price accepted; the paid switch turning on a model that is not enabled; a near miss labelled Execute. That is 30. One more change (the order in which a line difference is named) cannot alter any result and stayed green.

- [x] **Step 6: Two dry runs with no model request.** `RELAY_EXAMPLES_FROM` with made-up outcomes printed a report. `RELAY_EXAMPLES_MODEL=opencode/none-such` on the isolated host stopped with "The isolated OpenCode does not list opencode/none-such as a decision model. It lists: opencode/jev-1.13-free."

- [x] **Step 7 (OWNER'S YES, given on 14 Nov): `npm run examples:decider`**

Two runs, 60 of the 90 allowed requests, made-up messages only, from an isolated OpenCode with no login. Run 1 used the file's order; run 2 started at the sixteenth example, to see whether the slow first request belongs to the example or to the position, and it kept what the decider itself said. Both runs: 30 of 30 right modes, none that is not Execute sent to Execute, 29 of 30 lines as labelled, cost $0, no request unanswered, and the same mode and line for every example. Run 2 printed:

```
Decider: opencode/jev-1.13-free ($0 or not listed) on opencode v2.3.0; 30 requests from an isolated OpenCode with no login.
Right mode: 30 of 30. Gate 1 needs at least 27: pass.
Sent to Execute by mistake: 0. Gate 1 needs 0: pass.
Not-sure rule (under 60% sure means Plan): changed 1 of 30 answers; 1 became right, 0 became wrong.
Off the expected line: 1 of 30 (0 wrong line, 1 no line where one was expected, 0 a line where none was expected). Gate 1 allows 3: pass.
Time: first request 1181 ms; the other 29: median 132 ms, slowest 254 ms. Gate 1 needs under 1000 ms: first request MISS, the others pass.
Cost the host reported: $0 (30 of 30 requests reported one).
No answer: 0 of 30.
Mix-ups:
- line: "explain this" expected Plan line 2, got no line (the decider said none, 80% sure)
- rule: "how would you fix this?" is Plan only by the not-sure rule (the decider said Execute, 28% sure)
LIMIT: made-up messages, one sample set of lines, one decision model, one run. No chat, switch or plugin was involved.
```

Run 1's first request took 1187 ms and its other 29 a median of 128 ms, the slowest 448 ms. What this leaves for the owner: the first decision of a freshly started host is over Gate 1's one second in both runs, and every later one is well under it. Whether that counts against Gate 1 is the owner's call; nothing was changed to make it pass. No label was changed after the runs. The full table is in `docs/compatibility.md`.

- [x] **Step 8: Run the four checks and both isolated smokes; add the progress line; record the run in `docs/compatibility.md`; bring the README's `/relay` bullet up to date.**
- [ ] **Step 9: The owner checks the 30 labels and the sample lines.** The run came before this check (a ruling, see the ledger). A corrected label can be scored from the table in `docs/compatibility.md`; changed lines or new messages need a new run and a new yes.
- [ ] **Step 10: Commit** — `test: thirty labelled examples and a script for the decider`

---

### Task 11: The live check in Desktop, and Gate 1

**Files:**
- Modify: `docs/compatibility.md`, `docs/implementation-progress.md`, `README.md` (one "Current state" bullet)

**Interfaces:**
- Consumes: everything above, built and packed.
- Produces: the Gate 1 result.

- [ ] **Step 1: Read the versions** of Desktop and its CLI and write them down. Run the four checks.

- [ ] **Step 2 (OWNER'S YES): install the build where Desktop loads Relay from**

`npm run build`, `npm pack`; keep a copy of the tarball that is in `~/feature-pilot-install` now, so it can be put back; then `npm install <new tarball>` in that folder. Do it when the OpenCode service is idle (its write counter flat for 25 seconds), and tell the owner first: OpenCode may load the new build by itself, and its service may be replaced within a minute.

- [ ] **Step 3: The owner sets up the panel.** A decider and a model for each mode, free ones to start; in at least one mode two models, each with a "use it for" line. One try in the test box. Note what the panel shows.

- [ ] **Step 4: Ten real `/relay` messages, typed by the owner.** Among them: one with an `@` file, one with a pasted picture, one with an `@`-mentioned picture, one follow-up such as "ok, do it" after a plan, one typed while the chat is still answering, and `/relay` with nothing after it. For each, write down the mode, the model and the line fit Relay recorded, the model that answered, the time the decision took (the first one after OpenCode starts above all), and whether the message arrived once and unchanged.

- [ ] **Step 5: One short run that uses helpers through Superpowers**, with at least three checks of work. For each helper: what Relay recorded, and the model Desktop shows for that helper's chat. Relay keeps the last 20 decisions, so read them during the run as well as after it.

- [ ] **Step 6: One review cycle** on a small example with one planted defect: the first check must find it, and after the fix the review must approve, within three checks.

- [ ] **Step 7: Record** in `docs/compatibility.md`: platform, versions, each Gate 1 line with pass or fail and what was seen, and what was not checked. Among the things to state either way: what Desktop shows when `/relay` is refused; the shape of a pasted picture; a Review model whose id holds a `/`; a helper call that continues an earlier helper; what the Plannotator plugin adds on the `plan` agent; a `/relay` waiting when OpenCode sets its plugins up again. Add one "Current state" bullet to `README.md` and the progress line.

- [ ] **Step 8: Report Gate 1 to the owner.**

Gate 1 passes when: all ten messages are answered in the chat by their mode's model, with none dropped, doubled or changed; at least 27 of the 30 examples get the right mode; no example that is not Execute is sent to Execute; no more than 3 of the 30 are sent to a line other than the expected one; each decision takes under 1 second with a decision model; in the helper run every check of work ran on the Review model and no helper that writes code did; and the review cycle ended within three checks, with the planted defect found on the first check and an approval once it was fixed. If any line fails, stop there: Stage 2 does not start, and the plan changes. Task 10 measured the three example lines on 14 Nov (30 of 30, 0, and 1 of 30) and the time: about 0.13 seconds for a decision, but about 1.2 seconds for the first one of a freshly started host. The owner decides whether that first one counts.

- [ ] **Step 9: Commit** — `docs: Stage 1 live check and Gate 1 result`
