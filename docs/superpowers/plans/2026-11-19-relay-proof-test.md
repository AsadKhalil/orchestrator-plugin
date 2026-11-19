# Relay proof test, OpenCode Go leg: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run six Python exercises in the owner's OpenCode on four sides (Off, On with one model a mode, On with two models for Execute, Cheap only), with OpenCode Go models. Print one table: tasks passed, cost at list price, and the share of the 5-hour and weekly limits used.

**Architecture:**
- `scripts/bench/lib.ts` holds the arithmetic and the table, and `tests/bench.test.ts` tests them.
- `scripts/bench/run.ts` does the run. It drives the owner's running OpenCode service through `@opencode/client`, with the password from `~/.local/state/opencode/service.json`. It sets Relay's settings through `RelayRpc`, empties the one test folder before each chat, runs the hidden tests with Python's `unittest`, and writes `results.json`.
- `scripts/bench/report.ts` prints the table.

**Tech stack:**
- Node 24 and TypeScript, run with `tsx`, as `scripts/decider-examples.ts` is.
- `@opencode/client/promise`.
- `RelayRpc` from `src/contract.ts`, and `parseUsd` and `formatUsd` from `src/costs.ts`.
- Python's `unittest`.

**Spec:** `docs/superpowers/specs/2026-11-18-relay-proof-design.md`

## Global constraints

- **The test folder** is `%USERPROFILE%\relay-bench`; the `RELAY_BENCH_DIR` environment variable can change it.
  - Its `opencode.json` is exactly this:

    ```json
    { "permissions": [
      { "action": "shell", "resource": "*", "effect": "deny" },
      { "action": "webfetch", "resource": "*", "effect": "deny" },
      { "action": "websearch", "resource": "*", "effect": "deny" },
      { "action": "subagent", "resource": "*", "effect": "deny" },
      { "action": "skill", "resource": "*", "effect": "deny" },
      { "action": "question", "resource": "*", "effect": "deny" },
      { "action": "external_directory", "resource": "*", "effect": "deny" },
      { "action": "experimental_image_generate", "resource": "*", "effect": "deny" }
    ] }
    ```
  - It is written once, before the owner opens the folder in Desktop. Nothing rewrites it later.
- **The service.** Send it no request with any `location` other than the test folder. `client.project.list({})` takes no location, and it is the only way to check that the owner has opened the folder.
- **Never** print the service password or read OpenCode's stored logins.
- **Relay's settings** are read with `getRelay` before the first chat. They are put back with `saveRelay` in a `finally`, after an error too.
- **Models**, all with `variant: null`:
  - strong: `opencode-go/kimi-k3.1-pro`;
  - cheap: `opencode-go/glm-5.3-flash`;
  - decider: `opencode/jev-1.13-free`.
- **Sides** run in this order for each task: `off`, `on-one`, `on-two`, `cheap`.
  - `off`: the chat starts on the strong model, and Relay's switch stays off.
  - `on-one`: Relay is set to Plan [strong], Execute [cheap], Review [strong], with empty "use it for" lines. The chat starts on the strong model, then `/relay on`.
  - `on-two`: as `on-one`, but Execute is [cheap, "small edits in one or two files"] and [strong, "bigger changes across several files"].
  - `cheap`: the chat starts on the cheap model, and Relay's switch stays off.
- **The four messages**, word for word, with `<module>` the exercise's module name:
  1. "Read the exercise in instructions.md and the stub <module>.py, and plan the solution. Don't write any code yet."
  2. "Implement it."
  3. "Review the implementation for mistakes and missed cases. Don't change anything."
  4. "Fix what the review found."
- **Go's monthly limits**, from `https://opencode.ai/inference/go/v1/models`, read on 18 Nov 2026:
  - `kimi-k3.1-pro`: $15 on `go`, $60 on `go-plus`;
  - `glm-5.3-flash`: $60 on `go`, $180 on `go-plus`.

  5 hours = 20% of the month, and a week = 50%.
- **Stop rules for Go:**
  - The whole run's 5-hour share may not pass 100%.
  - The first run is `--tasks wordy` only.
  - A run stops at the first assistant entry that carries an error.
- **Money** is counted in trillionths of a dollar (`bigint`), never in floats.
- **Time limits.** A message may take at most 15 minutes, and a test run at most 120 seconds.
- **Python** is `RELAY_BENCH_PYTHON`, by default `python` (3.10.11 here). It runs `python -E -s -m unittest <module>_test`, in the test folder.

## Review focus

1. **A permission question.** The owner's own rules may ask before an edit. The runner answers each pending request for its chat: it allows `edit` and `write` on a path inside the test folder, and rejects anything else. Otherwise the chat waits until its 15-minute limit.
2. **A refusal from Go,** for example a limit reached. The assistant entry carries an error. The run stops there, puts Relay's settings back, and still writes `results.json` with what finished.
3. **Only 20 records.** Relay's Recent choices keeps the last 20. The runner reads a chat's decisions right after that chat, not at the end.
4. **Model code that loops or floods output.** The test run is killed at 120 seconds and counts as a fail. Only the last 2,000 characters of its output are kept.
5. **Leftovers from the previous chat.** Before each chat the folder is emptied, apart from `opencode.json`, so no side sees another side's work.

---

### Task 1: The test folder and the six exercises

**Files:**
- Create: `%USERPROFILE%\relay-bench\opencode.json` (outside the repository).
- Create: `scripts/bench/tasks/<exercise>/` for `affine-cipher`, `variable-length-quantity` and `wordy` (easier), and `book-store`, `bowling` and `forth` (harder). Each holds `instructions.md`, `<module>.py` (the stub) and `<module>_test.py`.
- Create: `scripts/bench/tasks/SOURCE.md`.
- Test: `tests/bench.test.ts`.

- [ ] **Step 1:** Write the folder's `opencode.json` as given in Global constraints. Ask the owner to open the folder in Desktop (File → Open Folder), and wait for their word before Task 3's check.
- [ ] **Step 2: Write the failing test** `the six exercises are complete and hold no solution`.
  - For each of the six folders: `instructions.md` is not empty.
  - There is exactly one `<module>.py` and one `<module>_test.py`, where `<module>` is the folder's name with `-` as `_`.
  - There is no `example.py` and no `.meta` folder.
- [ ] **Step 3:** Run `npx tsx --test tests/bench.test.ts`. It is expected to fail: the folders are missing.
- [ ] **Step 4: Download.** From `https://raw.githubusercontent.com/Aider-AI/polyglot-benchmark/main/python/exercises/practice/<exercise>/`:
  - `instructions.md` is `.docs/instructions.md`, followed by `.docs/instructions.append.md` when it exists;
  - then `<module>.py` and `<module>_test.py`.
  - Never `.meta/`.
  - `SOURCE.md` names the source URL, the commit SHA of `main` (from the GitHub API), the date, and "Exercism's Python track, MIT License, chosen for Aider's polyglot benchmark".
- [ ] **Step 5:** Run the test again. It is expected to pass.
- [ ] **Step 6:** Commit the task folders and the test.

### Task 2: The arithmetic and the table (`scripts/bench/lib.ts`)

**Interfaces it produces:**

```ts
export type Side = 'off' | 'on-one' | 'on-two' | 'cheap';
export type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
type PriceSet = { inputPerMillion: string | null; outputPerMillion: string | null; cacheReadPerMillion: string | null; cacheWritePerMillion: string | null };
export type Cost = PriceSet & { steps: (PriceSet & { above: number })[] };   // Relay's listModels `cost`
export function requestCost(tokens: Tokens, cost: Cost): bigint;           // trillionths of a dollar
export function limitShare(cost: bigint, monthlyUsd: string): { month: string; fiveHour: string; week: string };   // percents, one decimal
export type ChatResult = { task: string; side: Side; passed: boolean; cost: bigint };
export function sideTotals(chats: ChatResult[]): Map<Side, { passed: number; tasks: number; cost: bigint }>;
export function table(totals: ReturnType<typeof sideTotals>, monthly: (cost: bigint) => { fiveHour: string; week: string }): string;
```

- **`requestCost`** = input × input price + `cache.read` × read price + `cache.write` × write price + (output + reasoning) × output price.
  - A write price that is null counts as the input price. A read price that is null counts as the input price.
  - The price set is the last `steps` entry whose `above` is less than input + `cache.read` + `cache.write`, otherwise the base set.
  - Task 4 checks whether OpenCode keeps reasoning apart from output, against the entry's own `cost`.
- **`table`** prints one row each for: "Tasks passed" (`n of m`), "Cost at list price" (`$x.xxxx`), "5-hour limit used", "Weekly limit used", and "Saved, against Off" (`-` under Off).

- [ ] **Step 1: Write the failing tests** in `tests/bench.test.ts`:
  - `requestCost({input:1000,output:500,reasoning:0,cache:{read:8000,write:0}}, kimi)`, with Kimi at 2 / 10 / 0.2 / null and no steps, gives `8_600_000_000n`. `formatUsd` of it gives `'0.0086'`.
  - With a step `{above: 200000, …4 / 20 / 0.4 / null}` and 250,000 tokens read new, the step's prices are used.
  - `limitShare(parseUsd('1.5'), '15')` gives `{ month: '10.0', fiveHour: '50.0', week: '20.0' }` (Go's docs: "$1.50 of usage on a model with a $15 limit uses 10%").
  - `limitShare(parseUsd('6'), '60').month` gives `'10.0'`.
  - For two chats (`off` passed at $0.10, and `on-one` failed at $0.04), `table` contains `| Tasks passed | 1 of 1 | 0 of 1 |` and `| Saved, against Off | - | 60.0% |`.
- [ ] **Step 2:** Run `npx tsx --test tests/bench.test.ts`. It is expected to fail because `lib.ts` is missing.
- [ ] **Step 3:** Implement `scripts/bench/lib.ts` with the signatures above.
- [ ] **Step 4:** Run the tests, then `npm test` and `npm run typecheck`. All are expected to pass.
- [ ] **Step 5:** Commit.

### Task 3: The runner (`scripts/bench/run.ts`)

**Interfaces:**
- **Consumes:** Task 2's functions.
- **Produces:** `<out>/results.json`, with these fields:

  ```ts
  { startedAt: string; opencodeVersion: string; plan: 'go' | 'go-plus'; models: { strong: string; cheap: string; decider: string };
    settingsBefore: unknown; stoppedBecause: string | null;
    chats: { task: string; side: Side; sessionID: string; passed: boolean; testTail: string; seconds: number;
             entries: { model: string; agent: string; tokens: Tokens; openCodeCost: number; cost: string; created: number; completed: number | null; error: unknown }[];
             decisions: { mode: string | null; model: string | null; confidence: number | null; note: string | null }[] }[] }
  ```

- **Usage:** `npx tsx scripts/bench/run.ts --plan go|go-plus --out <dir> [--tasks a,b] [--sides off,on-one,on-two,cheap] [--check]`

- [ ] **Step 1: The connection.**
  - Read `service.json` and make the client: `OpenCode.make({ baseUrl, headers: { authorization: 'Basic ' + base64('opencode:' + password) } })`.
  - Read the version from `GET /api/info`.
- [ ] **Step 2: `--check`**, which sends no request to a model.
  - `client.project.list({})` includes the test folder.
  - `rpc.listModels({}, { location })` lists the strong and the cheap model as enabled.
  - `rpc.getRelay` lists the decider among `deciders`.
  - Python runs.
  - In a temporary copy, each untouched stub fails its own tests.
  - It prints one `PASS` line, or what is missing.
- [ ] **Step 3: One chat**, `runChat(task, side)`.
  1. Empty the folder, apart from `opencode.json`, and copy in `instructions.md` and the stub.
  2. For `on-one` and `on-two`, `saveRelay` that side's settings.
  3. `session.create({ model, location, title: 'relay-bench <task> <side>' })`.
  4. For the on sides, `session.command({ sessionID, name: 'relay', text: 'on' })`.
  5. For each of the four messages:
     - `session.prompt({ sessionID, text })`;
     - then `experimental.session.wait`, raced against 15 minutes;
     - while it waits, every 2 seconds it answers `permission.request.list({ location })` as Review focus 1 says.
  6. Read the assistant entries of `session.context({ sessionID })`, and that chat's records from `getRelayDecisions`.
  7. Copy `<module>_test.py` in and run Python with a 120-second limit.
- [ ] **Step 4: The run.**
  - It reads `getRelay` first.
  - For each task, the four sides run in order, and after each chat it writes `results.json`.
  - It stops as the stop rules say, and before each chat it projects the 5-hour share from the chats so far.
  - In a `finally`, it puts back `settingsBefore` with the current revision.
- [ ] **Step 5:** Run `npx tsx scripts/bench/run.ts --plan <plan> --out <scratch>/check --check`. It is expected to print `PASS`.
- [ ] **Step 6:** Commit.

### Task 4: The pilot, the report and the full Go run

**Files:**
- Create: `scripts/bench/report.ts`.
- Modify: `docs/compatibility.md` and `docs/implementation-progress.md`.

- [ ] **Step 1: Write `report.ts`.** It reads `results.json`, sums each request's `cost`, prints `table`, and ends with "N tasks, 1 run: only large differences mean anything."
- [ ] **Step 2: Run the pilot:** `--tasks wordy`.
  - Expected: four chats, a `results.json`, and `getRelay().settings` equal to `settingsBefore`.
  - Compare `cost` with `openCodeCost` on every entry. If they differ, or OpenCode's cost is 0, record which one the table uses and why.
- [ ] **Step 3: Project the six tasks** from the pilot. If they would pass 100% of a 5-hour window, keep as many tasks as fit, with at least one easier and one harder.
- [ ] **Step 4: The full run, and `report.ts`.** Write what was seen into `docs/compatibility.md`: platform, OpenCode version, the Relay build (`01b59fb`), the plan, the models, and what was not tested. Add one line to `docs/implementation-progress.md`. Commit and push.
- [ ] **Step 5:** Show the owner the table before anything goes into the README.

The Claude quiet-hour blocks and the Ollama run get a plan of their own once the Go numbers are in.
