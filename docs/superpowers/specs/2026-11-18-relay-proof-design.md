# Relay: proving the savings with numbers (design)

Status: the owner approved the plan on 2026-11-18 ("ok plan approved"). This document writes it down. Choices made while writing it are marked *(my call)*.

On 2026-11-19 the owner answered a reviewer's two questions:
- Relay's setup: "Both, as separate sides".
- The Claude limits: "Quiet-hour blocks".

The owner then moved the test into their own OpenCode: "you can use my opencode as test environment, no need to create throway copy its lengthy process". This lifts `AGENTS.md`'s rule against testing in their profile for this test. The constraints below follow from it.

## Intent and why

The owner wants numbers that show Relay is worth installing. In their words: "i want to prove 2 point with numbers first is cost second is less usage will be used as 5 hour or weekly limit exhausted too quick", because "otherwise this plugin will be useless".

1. **Cost:** Relay makes the same work cost less.
2. **Limits:** Relay uses less of a plan's 5-hour and weekly limits.

The model is the "Proof" section of Headroom (github.com/headroomlabs-ai/headroom). It has three parts:

- a test anyone can re-run with one command, which prints a Before / After / Saved table;
- an accuracy table beside it;
- numbers on the user's own use, labelled "estimated" unless a control group makes them "measured".

The 17 Nov cost research (`docs/research/2026-11-17-relay-cost-and-model-choice.md`) already found the main risk. A switch to another model makes that model read the whole chat again at full price, so Relay saves only when the price gap is large or there is little to read. The test must be able to show a loss as plainly as a saving.

## Goals

- A re-runnable test in this repository, under `scripts/bench/`. For each provider it prints one table for three sides (below): tasks passed, cost at list price, and the share of the 5-hour and weekly limits used.
- Exact numbers where the provider reports them, and every estimate labelled as one.
- Numbers the owner can publish in a "Proof" section of the README, once they have seen them.

## Non-goals, for now

- A "saved so far" line in Relay's panel.
- Compression or compaction inside Relay.
- Measuring how Anthropic weighs each model in the Claude plan's limits while another session uses the same account.

## Anti-goals: a failure even if the test runs

- Tasks picked so that Relay wins. A side that passes fewer tasks shown as a saving. A loss left out.
- Changes to the owner's OpenCode beyond the test folder, and Relay's settings during the test, which are cleared afterwards. Reading the owner's stored logins, or their chats outside the test folder.
- A key printed, logged, written into the repository, or sent anywhere but its own provider.
- Spending past the stop rules below.

## Approaches considered

- **A. A test on the owner's providers, in a throwaway OpenCode.** Picked: the owner approved it on 18 Nov. It is the only approach that checks quality, and the only one others can re-run.
- **B. A "saved so far" line in the panel.** One chat in ten would be left alone as a control, as Headroom does. It costs nothing, but it cannot tell whether the cheaper model did the work as well, and it needs weeks of use. Later, and only if A shows a saving.
- **C. Headroom's compression built into Relay.** The owner raised this on 18 Nov. Not now, for three reasons:
  - Headroom is a Python and Rust proxy, and it already works with OpenCode by itself (`headroom wrap opencode`).
  - Relay is a TypeScript plugin and cannot run Headroom's code.
  - Mixed together, the numbers would hide what Relay itself saves.

  Instead, a later side of the test runs Relay with Headroom in front.

## Constraints

- **Where it runs** (the owner, 19 Nov). The test runs in the owner's own OpenCode: the service Desktop runs, reached through its API. The service's password comes from its own file and is never printed.
  - **One test folder,** `%USERPROFILE%\relay-bench`. The owner opens it in Desktop once before the first run, because `AGENTS.md` warns against asking the running service about a folder it has not loaded. Every task uses this one folder, and between chats the script puts back the task's starting files.
  - **No keys.** The test uses the logins already in the owner's OpenCode: OpenCode Go, Ollama Cloud, and `claude-agent` (their Claude Max plan). Nothing is read from where OpenCode keeps them.
  - **Relay's settings are shared by every chat.** The test sets them for each side and clears them at the end. The owner had none saved under `relay-opencode` on 18 Nov. While the test runs, the owner does not use chats where Relay is on.
  - **The Relay under test is the owner's copy:** the build of `01b59fb` in `~/.config/opencode/relay`. The later main (`1eb9dda`) changes only how a cache's age is counted (from the request's start rather than its end), so the copy is not reinstalled for the test *(my call)*. The version is recorded with the results.
  - **What the model sees** is the owner's usual setup, with their skills and folders, as in their own use. It is the same on every side.
- **Budgets.** From the owner on 18 Nov: Ollama "upto 2$". For OpenCode Go and the Claude Max plan: "you can use any model".
- **The Claude plan's meter.** Some answers carry a reading of it: `native.rateLimit` on an assistant entry of `session.context`, with `unifiedWindows.five_hour.utilization` and `seven_day.utilization`, `status` and `resetsAt`. Not every answer has one. The reading moves in 1% steps and covers the whole account, and other sessions use that account. So:
  - **All four sides** report tasks passed, tokens and cost at API prices.
  - **The meter is measured in quiet-hour blocks** (the owner's choice).
    - In an hour when no other Claude session of the owner's is working, the owner says go.
    - The six tasks run as one block on Sonnet only (the Off side), then as one block on Haiku only (the Cheap only side).
    - The meter is read before and after each block: from `native.rateLimit` on an answer that carries it, and otherwise by the owner from Claude's usage page.
    - That shows how many points of the 5-hour and weekly meters the same work takes on each model, which is how much less Haiku counts.
    - If the Haiku block moves the meter by less than three points, the result is given as a bound ("at most N points").
  - **The two "On" sides** run outside the quiet hour. Their limit rows are worked out from their tokens per model, with the points per token measured in the blocks, and marked "estimated".
  - **Timing.** At 16:31 on 18 Nov the weekly reading was 0.86 (status `allowed_warning`), and by 17:12 it was 0.90. It reset at 19:00 local that day. The session plugin-13 ended its Claude runs at 17:12.
- **What the model may do.** It may read and edit files in the test folder only. The folder's own `opencode.json` denies shell, web, helpers, skills, questions and folders outside it, as `paid-stage1.mjs` did. It is written before the owner opens the folder, so it never changes while the service has the folder loaded.
- **Running the tests.** The script runs them itself, with Python's `unittest`, `-I` and a time limit. Every side gets the same rules.
- **The decider** is `opencode/jev-1.13-free`: free, with no login.
- **Relay's cost check** (stay or go) runs only for models with a listed price. Go and Ollama models have one. `claude-agent` models do not, so on Claude, Relay follows the decider's pick without the check, as it does today for anyone on that provider.

## The test

### Sides

Every side gets the same tasks and the same messages.

- **Off:** Relay's switch is off, and the chat is on the strong model for every message. This is what a user does without Relay.
- **On, one model a mode:** `/relay on`, with Plan on the strong model, Execute on the cheap model and Review on the strong model. The decider picks the mode for each message. Each mode has one model, so Relay's cost check never runs (it weighs only a move between two models of the same mode, `stayOrGo` in `src/router.ts`). The chat changes model at almost every message.
- **On, two for Execute:** `/relay on`, with Plan on the strong model and Review on the strong model. Execute has two models:
  - the cheap model, "small edits in one or two files";
  - the strong model, "bigger changes across several files".

  The decider also picks the line. A move from the strong model to the cheap one within Execute goes through the cost check. This is how the owner set Relay up on 17 Nov.
- **Cheap only:** Relay is off, and the chat is on the cheap model for every message. This side answers "why not just use the cheap model?" *(my call)*

Both "On" sides run, at the owner's word, so the numbers show which setup saves more.

### Models

1. **OpenCode Go, first.**
   - Strong: `opencode-go/kimi-k3.1-pro`. It costs $2 in and $10 out per million tokens, with a $15 monthly allowance on Go.
   - Cheap: `opencode-go/glm-5.3-flash`. It costs $0.15 in and $0.50 out, with a $60 monthly allowance on Go.
   - Not DeepSeek: it needs a region setting changed and costs double at weekday peak hours. Not GLM-5.3: its allowance is raised until 22 Nov, which would distort the limit numbers. *(my call)*
2. **Claude, second.** `claude-agent/sonnet` (Sonnet 5.5) and `claude-agent/haiku` (Haiku 5.5).
3. **Ollama, third.** A strong and a cheap model from the owner's Ollama Cloud list, chosen by price and intelligence index when that run is built.

### Tasks

- **Source.** Six coding exercises with tests, from a public set: the Exercism exercises of the Aider polyglot benchmark. Tasks from a public set cannot have been picked to suit Relay.
- **Setup.** For each chat, the script puts the exercise's text and its stub into the test folder. The tests stay outside the folder until the end. The exercises are Python, so the tests run with `unittest` and nothing needs installing *(my call)*.
- **The chat.** Each task is a chat of four messages, the same on every side:
  1. "Read the exercise and plan the solution. Don't write any code yet." (plan)
  2. "Implement it." (build)
  3. "Review the implementation for mistakes and missed cases. Don't change anything." (review)
  4. "Fix what the review found." (build)
- **Scoring.** The script then copies the tests in and runs them: pass or fail.

### Order

Task by task, the three sides take turns, so the time of day falls on all three alike.

### What is recorded

- **From OpenCode, for each request and message:**
  - the model and the agent;
  - tokens: input, output, reasoning, read from the cache and written to it;
  - cost and seconds;
  - Relay's decision for each message: mode, model, how sure it was, and its note.
- **On Go, without a recorder** *(my call: a recorder would mean sending the owner's Go traffic through a loopback address)*.
  - Each request's list cost is worked out from OpenCode's token counts and Go's list prices, from `https://opencode.ai/inference/go/v1/models`.
  - If OpenCode keeps Go's own `usage.opencode` figures on the answer, those are used instead.
  - The owner can check the total on Go's console page.
- **On Claude:** each request's tokens, from OpenCode's assistant entries (input, read from cache, written to the cache, output). With a plan login, every model lists no price and every answer costs 0, so the cost at API prices is worked out from the `anthropic` provider's list. Where an answer carries `native.rateLimit`, its readings are kept too.

  There is no recorder in front of `claude-agent`. Its `baseURL` would become Claude Code's `ANTHROPIC_BASE_URL`, the login token would pass through the recorder, and the provider would lose its price source.
- **For each task:** tests passed or failed, and the total cost and limit share of its messages.

### Output

`results.json`, and one table per provider:

| | Off | On, one model a mode | On, two for Execute | Cheap only |
|---|---:|---:|---:|---:|
| Tasks passed | ? of 6 | ? of 6 | ? of 6 | ? of 6 |
| Cost at list price | | | | |
| 5-hour limit used | | | | |
| Weekly limit used | | | | |
| Saved, against Off | | | | |

- **Go's limit shares** *(my call)*. Go's docs give the rule: "$1.50 of usage on a model with a $15 limit uses 10% of your monthly allowance".
  - A request's share of the month is its `list_cost` divided by that model's monthly limit on the owner's plan. The monthly limits come from Go's model list (`go.monthly_usage`). The plan, Go or Go Plus, is the one the owner names, or Go's `billing_source` if OpenCode keeps it.
  - The 5-hour limit is 20% of the month and the weekly limit is 50%, so the 5-hour share is the month's share divided by 0.2, and the weekly share is it divided by 0.5.
  - Go's own `allowance` figure is kept to check this arithmetic.
- **Small sample.** With six tasks and one run, only large differences mean anything, and the output says so.

### Stop rules

- **Go:**
  - The whole Go run may use at most one 5-hour window, counted as above. On the Go plan that is 20% of the month and 40% of the week *(my call)*.
  - The first run is one task on each side. From it the script projects the six tasks. If they would not fit, it runs as many tasks as fit, and the table says how many *(my call)*.
  - By the request sizes the session plugin-13 saw on small tasks (2 or 3 requests a reply; 220 to 1,400 tokens read new and 100 to 810 written a request), six tasks on the four sides should take from about a third to most of the window.
  - A run also stops at the first refused request. Extra Usage, which bills the balance once a limit is reached, is off by default on Go and Go Plus, so a request past a limit is refused rather than paid for. If OpenCode keeps `billing_source`, the run also stops at the first request billed to the balance.
- **Ollama:** the run stops at $2 of cost, as OpenCode reports it.
- **Claude:**
  - Any run stops if the rate-limit reading says the plan is rejecting requests or using extra usage.
  - The two quiet-hour blocks together stop at 20 points of the 5-hour meter.

### Where results go

- **First:** the scratch output folder.
- **Then:** what was seen goes into `docs/compatibility.md`, with a line in `docs/implementation-progress.md`.
- **Last:** the README's "Proof" section, only after the owner has seen the numbers.

## Left to the builder

- The script's structure. It should reuse the parts of `scripts/smoke-host-model.mjs` and the scratch `paid-stage1.mjs`: the isolated host, the recorder and the denied tools.
- Which six Python exercises: three easier and three harder.
- The OpenCode version is whatever the owner's service runs (2.3.2 on 18 Nov). Record it with the results.

## Later

- Three runs per task, if the first run is worth repeating.
- A "Relay with Headroom" side.
- Pricing `claude-agent` models at the `anthropic` list price, so that Relay's cost check also runs on the Claude plan.
- The panel's "saved so far" line, with a control group.
