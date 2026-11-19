# The decider sees the last reply: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The decider gets the end of the chat's last reply, so a short follow-up such as "Implement it." can be placed on the right line. When no line fits, the mode's first model is used.

**Architecture:** There are three small changes:
- the router's fallback when no line fits (`pickModel`);
- what the decider is told (`describe`, plus a pure `lastReply` reader);
- the wiring in `placeMessage`, which already reads the chat's messages for the cost check.

Then the docs, and a live run of the proof test's two-model side in the owner's OpenCode.

**Tech Stack:** TypeScript (ESM), node:test through tsx, OpenCode 2.3.x plugin API.

**Spec:** `docs/superpowers/specs/2026-11-19-relay-decider-last-reply-design.md`

## Global Constraints

- At most the last 1,500 characters of the reply's text (`MAX_REPLY_CHARS = 1500`), never cut inside a two-unit character.
- Never the model's reasoning, tool calls or tool output. Never an earlier reply. The home folder's path becomes `~`.
- A helper's decision (`kind: 'helper'`) gets no reply.
- Notes: "no line fits clearly, so the first model is used" and "no answer about the lines, so the first model is used". The note "…so the chat's model stays" now comes only from the cost check.
- `src/decider.ts` and `src/router.ts` are bundled into the panel: nothing they import may come from `node:`.
- CRLF line endings in `src/`, `tests/` and `docs/` (check with Node). Commit only the files listed here: the shared tree holds another session's uncommitted work.
- The four checks run fresh before anything is called passing: `npm run typecheck`, `npm test`, `npm run build`, `node scripts/check-package.mjs`. They run in a clean clone of the commit, because the shared tree holds another session's uncommitted changes.
- The owner's Relay copy (`~/.config/opencode/relay`) is updated only with their yes, from a build of a clean clone. The test folder must be open in Desktop first: a request that boots the folder's location has been followed by the service hanging (19 Nov, twice).

## Review Focus

1. A reply that is only tool calls, with no text, gives no reply line. It must not send an empty pair of quotes.
2. The person's new message may already be in `session.context` when the switch's hook runs. Its reply is then the one before it, never nothing.
3. On Windows the home folder can appear with either slash and in any case (`C:\Users\x`, `c:/users/x`). All of these become `~`.
4. A chat whose messages could not be read (`spare()` gives null) still gets a decision, without the reply.
5. A chat on the strong model of a two-model Execute, warm cache, "continue": the first model (cheap) is picked, and the cost check may still keep the chat where it is. The note must say which happened.

---

### Task 1: When no line fits, the first model is used

**Files:**
- Modify: `src/router.ts` (`pickModel`, and its call in `route`)
- Test: `tests/router.test.ts`, `tests/relay-command.test.ts`

**Interfaces:**
- Produces: `pickModel(usable: readonly ModeChoice[], line: LineAnswer | undefined): { model: ModelChoice; fit: number | null; note: string | null }`. The `current` parameter goes.

- [ ] **Step 1: Change the two router tests that pin the old rule, and the relay-command one**

`tests/router.test.ts`: rename the test "when no line fits, the chat keeps its model if the mode can use it, and else the first is used" to "when no line fits, the first model of the list is used, whatever model the chat is on". Its assertions become:

```ts
for (const current of [null, pick('eyes'), pick('other'), pick('eyes', 'high')])
  assert.deepEqual(route(noLine, three, models, nothing, current), { switch: true, mode: 'plan', agent: 'plan', model: pick('plan'), fit: null, note: 'no line fits clearly, so the first model is used' });
assert.equal((route(weak, three, models, nothing, pick('eyes')) as { note: string }).note, 'no line fits clearly, so the first model is used');
```

In "a missing line answer … falls back the same way", the `pick('deep')` case now expects `model: pick('plan')` and the note "no answer about the lines, so the first model is used".

`tests/relay-command.test.ts`: in "when no line fits, …" (rename it the same way), the chat on `p/usual` now moves to `p/exec` (variant `high`), with the note "no line fits clearly, so the first model is used". The `silent` case gets the note "no answer about the lines, so the first model is used".

- [ ] **Step 2: Run them**

Run: `npx tsx --test tests/router.test.ts tests/relay-command.test.ts`
Expected: FAIL. The notes still say "so the chat's model stays".

- [ ] **Step 3: Change `pickModel`**

When no line is chosen clearly, return `usable[0]` with the note `${reason}, so the first model is used`. Drop the `current` parameter, and update the call in `route`.

- [ ] **Step 4: Run them again, then the whole suite**

Run: `npx tsx --test tests/router.test.ts tests/relay-command.test.ts`, then `npm test`
Expected: PASS. `tests/review-helper.test.ts` already expects "so the first model is used".

- [ ] **Step 5: Commit**

```bash
git add src/router.ts tests/router.test.ts tests/relay-command.test.ts
git commit -m "When no line fits, Relay uses the mode's first model"
```

### Task 2: The decider is told the end of the last reply

**Files:**
- Modify: `src/decider.ts`
- Test: `tests/decider.test.ts`

**Interfaces:**
- Produces:
  - `MAX_REPLY_CHARS = 1500`.
  - `lastReply(messages: unknown): string | null`: the text of the latest reply, trimmed, at most its last `MAX_REPLY_CHARS`; null when there is none.
  - `DecideInput` gains `reply?: string | null`.

- [ ] **Step 1: Write the failing tests**

- `test('the end of the last reply is told to the decider, after the message, and never for a helper')`. `buildDecisionRequest(decider, { …chat input, reply: 'Plan: change wordy.py only.' })` makes the input text contain `The end of the chat's last reply: "Plan: change wordy.py only."` after the message line. With `reply: null`, or `kind: 'helper'`, the text does not contain "last reply".
- `test("the line question asks the decider to judge the work by the message and the last reply")`. The `execute_line` question's instructions match `/last reply/`.
- `test('the last reply is the text of the latest answer, without reasoning or tools')`. `lastReply` of these messages:
  1. a user message;
  2. an assistant message with content `[{type:'reasoning',text:'think'}, {type:'text',text:'old'}]`;
  3. another user message;
  4. an assistant message with content `[{type:'reasoning',text:'r'}, {type:'tool',…}]`;
  5. an assistant message with content `[{type:'text',text:'Step 1'}, {type:'text',text:'Step 2'}]`.

  It gives `'Step 1\nStep 2'`. Adding a trailing user message (the new one) gives the same. Only the last two entries give the same too.
- `test('a reply that is only tool calls, or no reply at all, gives nothing')`. `lastReply([])`, `lastReply(null)`, and a latest reply that has only `tool` parts, all give `null`.
- `test('a long reply keeps its last 1,500 characters, and never half a character')`. A reply of 2,000 'a' followed by '😀' plus 1,498 'b' gives a 1,500-character string. Its first unit is not a lone low surrogate.

- [ ] **Step 2: Run them**

Run: `npx tsx --test tests/decider.test.ts`
Expected: FAIL (`lastReply` not exported; no reply line).

- [ ] **Step 3: Implement**

- `lastReply`: find the newest assistant entry, whatever it holds. Take the assistant entries from the last user entry before it up to it: that is the latest reply. Join their `text` parts with `\n`, trim, and keep the end. Drop a leading lone low surrogate, as `capText` does. A latest reply with no text gives null, never an earlier reply's text.
- `describe`: for `kind: 'chat'` with a non-empty `reply`, add the line after the message line.
- The line question's instruction: "Which description of work fits best? Judge the size of the work by the person's message and, when it is given, the end of the chat's last reply. Choose none when no description fits clearly."
- Update the header comment: earlier messages are never sent, except the end of the last reply.

- [ ] **Step 4: Run them again, then the whole suite**

Run: `npx tsx --test tests/decider.test.ts`, then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/decider.ts tests/decider.test.ts
git commit -m "The decider is told the end of the chat's last reply"
```

### Task 3: Relay passes the reply, without the home folder

**Files:**
- Modify: `src/relay-command.ts` (`placeMessage`)
- Test: `tests/relay-command.test.ts`

**Interfaces:**
- Consumes: `lastReply` and `DecideInput.reply` (Task 2).
- Produces: `withoutHome(text: string, home: string): string` in `src/relay-command.ts`. Every occurrence of `home`, with either slash and in any case, becomes `~`.

- [ ] **Step 1: Write the failing tests**

- `test("the decider is told the end of the chat's last reply, with the home folder as ~")`. The fake chat's messages hold a reply whose text names `${homedir()}\\relay-bench\\wordy.py`. The decisions request's text contains `~\\relay-bench\\wordy.py`, and not `homedir()`.
- `test('when the chat cannot be read in time, the decider is asked without the reply')`. With `messages: 'never'`, the decisions request's text does not contain "last reply", and the message is still sent once.
- `test('the home folder is replaced with either slash and in any case')`. `withoutHome('C:/USERS/me/x and c:\\users\\me\\y', 'C:\\Users\\me')` gives `'~/x and ~\\y'`.

- [ ] **Step 2: Run them**

Run: `npx tsx --test tests/relay-command.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `place()`, pass `reply: messages === null ? null : (text => text && withoutHome(text, homedir()))(lastReply(messages))` to `deps.decide`. Implement `withoutHome` with a case-insensitive regular expression built from `home`. Each `\` or `/` in `home` matches either slash, and the other characters are escaped.

- [ ] **Step 4: Run them again, then the whole suite**

Run: `npx tsx --test tests/relay-command.test.ts`, then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/relay-command.ts tests/relay-command.test.ts
git commit -m "Relay gives the decider the last reply, with the home folder hidden"
```

### Task 4: The docs say what changed

**Files:**
- Modify: `docs/privacy.md`, `docs/guide.md`, `AGENTS.md`, `docs/superpowers/specs/2026-11-13-relay-chat-model-guidance-design.md`, `docs/implementation-progress.md`

- [ ] **Step 1: Edit**
  - `docs/privacy.md`: the decider is also sent the end of the chat's last reply. That is at most 1,500 characters of the model's text, with the home folder shown as `~`; never its reasoning, tool calls or tool output.
  - `docs/guide.md`: when no line fits clearly, the first model in the list is used, so put your everyday model first. The cost check can still keep the chat's model.
  - `AGENTS.md`: the "Invariants" bullet on the decider's size caps gains "1,500 characters of the last reply".
  - The 13 Nov spec: one dated sentence after "What the decider is given".
  - `docs/implementation-progress.md`: one line.
- [ ] **Step 2: Run the four checks in a clean clone of HEAD.** Expected: each exits 0, and the test count is printed.
- [ ] **Step 3: Commit** the five docs.

### Task 5: The live check in the owner's OpenCode (needs the owner's yes)

- [ ] **Step 1:** With the owner's yes, build and pack from a clean clone. Install into `~/.config/opencode/relay` as on 18 Nov, and record the commit.
- [ ] **Step 2:** The owner opens `relay-bench` in Desktop. Then run `npx tsx scripts/bench/run.ts --plan go --out <scratch>/on-two-fixed --sides on-two --check`. Expected: PASS.
- [ ] **Step 3:** Run the same command without `--check` and with `--budget 50`.
  - Expected: the Execute decisions name `glm-5.3-flash` with a fit, or the first model with the note "no line fits clearly, so the first model is used". There should be no "so the chat's model stays" from a missing line.
- [ ] **Step 4:** Make the 6-task table with `scripts/bench/report.ts`, from the Off, one-model and Cheap files and this run's.
- [ ] **Step 5:** Record it in `docs/compatibility.md`: platform, version, numbers, what was not tested. Add a line in `docs/implementation-progress.md`, then commit and push.
