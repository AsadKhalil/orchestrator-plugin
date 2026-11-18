# Does Relay save money, and how should it pick a model?

17 November 2026. Report for `docs/research/relay-cost-research-prompt.md`.

**What was done.** Research only. No code was changed, no model was called, nothing was built or installed. Relay's behaviour was read in `src/`. What OpenCode 2.3.0 records for each reply was read in its type files in `node_modules`. How OpenCode builds a request was read in its source at tag v2.3.0. I measured nothing: every dollar figure of mine is arithmetic from list prices.

**Words used.**

- **Request:** one call to a model. One message usually causes several, because every tool call is another request.
- **Cache:** the provider's saved copy of the chat so far. On Claude models, reading from it costs a tenth to a fortieth of the normal input price [1 M]. Each model has its own cache [2 M].
- **Re-read:** a model reading the whole chat at the full price, because it has no live cache of it.
- **Points:** percentage points of tasks passed.

**Marks after a claim.** `[n M]` maker or vendor claim. `[n I]` independent measurement. `[n P]` one person's report. `[A]` my arithmetic (Appendix B). `[code]` read in this repo's `src/` or in OpenCode's type files. `[repo]` recorded in `docs/compatibility.md`. The numbers point to the source list at the end, which has each link and date. Prices are USD list prices per million tokens, read on 17 Nov 2026.

## 1. Verdict

1. **As built, Relay does not reliably save money.** Each model change makes the new model re-read the whole chat at full price [2 M], and Relay switches whenever its pick differs from the chat's model, with no cost check [code]. On paper your Sonnet and Haiku setup lands within 8% of Sonnet alone, and an Opus planner with a Sonnet builder costs 24% more than Opus alone in a busy long chat [A]. Not measured.
2. **It saves when there is little to re-read or the step down is big:** a new chat, a chat idle longer than the cache lasts (5 minutes by default), a provider with no cache, or a model about 10 times cheaper. Sonnet to Haiku under 100,000 tokens costs a fraction of a cent.
3. **Your idea (expensive model plans, cheaper one builds) saves most as one hand-over after the plan, not as a switch on every message:** 39% to 79% on paper [A]. But in the one large independent test the cheaper builder passed 5 to 10 points fewer tasks [24 I], which takes back most of the saving. It holds best for small tasks, and for a builder one step below the planner.
4. **On a Claude plan or a local model the same re-read is paid in plan limit or in seconds.** Your live check ran through `claude-agent`, which lists no prices [repo], so Relay cannot see this cost today.
5. **Nobody has measured this in OpenCode.** The test in section 6 costs about $165 (pilot about $35) and needs your yes.

## 2. Break-even rule

**The rule.** A switch costs one full-price read of the whole chat by the new model. It pays only if the new model saves more than that on the requests it handles before the chat moves again.

Three things decide it:

- **Chat length so far.** The one-time cost grows with it (table 2).
- **Price gap.** What counts is the gap between the two models' *cached-read* prices and output prices, not their list prices. Fable 5.2 lists at 4 times Sonnet 5.5 but reads its cache at only twice Sonnet's price ($0.20 against $0.10) [1 M].
- **Requests left on the new model.** A build of 20 requests can repay a switch. One short answer usually cannot. Real coding chats average about 9 tool calls per message [64 I, my division].

When the new model only reads, a switch from A to B pays after `n > (W_B - R_B) / (R_A - R_B)` requests. `R` is the cached-read price and `W` the cache-write price. Opus to Sonnet: (2.50 - 0.10) / (0.20 - 0.10) = 24, so from the 25th request. Sonnet to Haiku: (0.125 - 0.01) / (0.10 - 0.01) = 1.3, so from the 2nd. Anthropic's own figure for one model: at 120,000 tokens on Opus 5.5, "One write costs as much as 25 reads" [4 M].

**Table 1. Requests before a switch to a cheaper model beats staying** [A]. Work requests add 1,500 tokens and write 500. The chat's current model has a live cache; the new one has none.

| From, to | Chat of 30,000 | 90,000 | 150,000 | 300,000 | If the new model only reads |
|---|---|---|---|---|---|
| Sonnet 5.5 to Haiku 5.5 | 1 | 1 | 6 | 8 | 2 (12 above 100,000) |
| Opus 5.5 to Haiku 5.5 | 1 | 1 | 3 | 3 | 1 (4 above 100,000) |
| GPT-6.1 Sol to GPT-6 Luna | 1 | 1 | 1 | 1 | 2 |
| Opus 5.5 to DeepSeek Flash | 1 | 1 | 1 | 2 | 2 |
| Sonnet 5.5 to DeepSeek Flash | 1 | 2 | 2 | 3 | 4 |
| Fable 5.2 to Sonnet 5.5 | 3 | 6 | 8 | 12 | 25 |
| Opus 5.5 to Sonnet 5.5 | 6 | 11 | 14 | 18 | 25 |
| Fable 5.2 to Opus 5.5 | 8 | 22 | 37 | 73 | never |
| Any step up to a dearer model | never | never | never | never | never |

**Table 2. What the first request after a switch costs, on top of staying** [A].

| Switch | Chat of 30,000 | 90,000 | 150,000 |
|---|---|---|---|
| Sonnet 5.5 to Haiku 5.5 | $0.001 | $0.002 | $0.079 |
| Opus 5.5 to Sonnet 5.5 | $0.07 | $0.21 | $0.35 |
| Haiku 5.5 to Sonnet 5.5 | $0.07 | $0.22 | $0.37 |
| Sonnet 5.5 to Opus 5.5 | $0.15 | $0.44 | $0.74 |

**Plain rules, when you pay per token and the provider has a cache:**

- **About 7 times cheaper or more:** switch any time. It pays within one to four requests. Watch price steps: Haiku 5.5 costs 5 times more on every line once the prompt passes 100,000 tokens [1 M], and GPT-6 models double their input price above 272,000 [5 M].
- **2 times cheaper (Opus to Sonnet):** only for a stretch of work, 6 to 18 requests. Not for one question or a small fix.
- **A dearer model:** never pays in money. You buy quality, at $0.07 to $0.74 a step (table 2).
- **A new chat, a chat idle longer than the cache lasts, or one OpenCode has just shortened (compacted):** switch freely. There is nothing to lose.
- **The way back** costs a second re-read, unless the old model's cache is still alive. One vendor found it alive on 97.4% of 4,684 switch-backs in agent traffic [14 M]. Nobody has measured it for people, who pause.

**What others measured.** One person saw $0.009 for the first request after a switch against $0.0009 before it, on a 4,300-token chat [9 P]. Another saw $0.223 against $0.020 at 60,000 tokens, and routed runs that "cost between 16% and 47% more than never routing at all" [10 P]. In OpenCode 1.x the first request after a switch in an 874,001-token chat cost $9.85 [11 P]. In GitHub Copilot's traffic the share of the prompt read from cache was 90% inside a turn, 55% across turns and 8% after a model switch [12 M]. In one small local test, taking turns between two models re-computed 1.9 times the tokens of staying [13 P].

Against this, router makers report savings: router plus caching 37.4% cheaper than caching alone [14 M]; 30% to 50% saved against sending everything to Opus 4.8, "even accounting for cache misses" [16 M]; 74% less per task than Opus 5.5 at the same score, while staying on one model for nearly nine of ten agent turns [17 M]. All three measured their own product.

**The other costs you asked about.**

| Cost | Size | Source |
|---|---|---|
| The decider's request | $0 with the free decision model. About $0.0005 with `ollama-cloud/clef:27b`: about 20 decisions came to a cent. Under 1% of a chat's bill. | [repo] |
| Time the decider adds | 0.1 to 0.8 seconds in most recorded runs, 1.2 seconds for the first after a start, up to 2.2 seconds seen. | [repo] |
| Time the switch adds | The two switch calls took 2 to 16 ms. A re-read is slower than a cached read; no current timing was found for hosted models. `/relay` waits for a busy chat, up to two minutes. | [repo] [code] |
| Price steps | Haiku 5.5: 5x on every line above 100,000 tokens. GPT-6 family: input 2x above 272,000. No step on the other Claude models. | [1 M] [5 M] |

**Mistakes and redo turns.** In the one large independent test (500 tasks, cache counted, older models), a strong model alone passed 75.8% for $0.85 a task. Strong, then cheap in the same chat passed 65.6% for $0.51. For the GPT pair it was 85.8% for $0.47 against 81.0% for $0.41 [24 I]. To compare at the same quality [A]:

- Per *passed* task: $1.12 against $0.78 (Claude pair), $0.55 against $0.51 (GPT pair).
- If every failed task is redone on the strong model: $0.85 against $0.80, and $0.47 against $0.50.

So at the same quality the saving ran from about 30% down to a small loss.

**Pauses cost more than routing.** With 7 minutes between messages, my long chat on Sonnet alone costs $3.41 instead of $1.17, because every message re-reads the chat [A]. OpenCode sends no cache lifetime by default, so Anthropic uses 5 minutes [23 M]. With a one-hour lifetime (written at 2 times the input price [1 M]) the same chat costs $1.37 at any pause under an hour [A].

**By way of paying.**

| How you pay | What a switch costs | Rule | Evidence |
|---|---|---|---|
| Per token, with a cache (Anthropic, OpenAI, Gemini, DeepSeek keys; OpenRouter) | Dollars: tables 1 and 2. Anthropic: write 1.25x, read 0.025x to 0.1x [1 M]. OpenAI GPT-5.6 and later: write 1.25x, read 0.05x or 0.1x, cache kept 30 minutes [5 M]. Gemini 4 and DeepSeek: no write fee listed; reads at 0.05x and 0.02x [6 M] [7 M]. OpenRouter keeps a chat on the provider that holds its cache [69 M]. | The plain rules above. | Prices from makers. Break-even is my arithmetic. Switch costs: four individuals and one operator's traffic study. |
| Per token, no cache | Nothing extra: every request re-reads everything anyway. | A cheaper model is cheaper from the first request. On paper Relay as built costs $6.06 against $10.76 for one strong model on the long chat [A]. | Arithmetic only. Ollama Cloud bills per token; its price list has a "cached input" column but does not say how a hit is earned [8 M]. |
| Claude plan, through `claude-agent` | Plan limit. There is a 5-hour limit and a weekly one, shared by all models. Anthropic publishes no sizes or weights, only that cached parts "count less" [49 M]. One test (Jan 2026, older models) found usage followed API price ratios with cached reads free [51 P]. A later report says cached reads do move the meter [52 P]. Through OpenCode the 5-hour window drained about twice as fast as in Claude Code's own terminal: +8% of the meter for $0.81 of work against +4% for $0.79 [54 P]. A switch between two Claude models keeps the same Claude Code process, so the one-cache-per-model rule applies [53 M]. Coming from a non-Claude model, what Claude missed is replayed as one message; 40 of 67 such replays had more than 20 blocks, which is further back than Anthropic's cache looks, so they can miss it [55 P]. | Same direction as per token; the size is unknown. If usage follows API prices, re-reading 100,000 tokens on Sonnet ($0.25) takes about 2.5% of a Pro window through OpenCode, and 0.5% on the $100 Max plan [A]. Switching models does not get round a limit [50 M]. | No published weights, and two reports that disagree. |
| Local Ollama | Seconds: loading the other model unless both fit in memory, then re-reading the chat with no cache. Ollama keeps a model for 5 minutes, and up to three per GPU if they fit [56 M]. One user measured 17 to 36 seconds to re-read 24,000 to 46,000 tokens at every mode change [57 P]. One 8B model took 43.5 seconds to load [58 P]. A 7B model reads 886 tokens a second on an M4 Max and 14,771 on an RTX 4090 [59 P]. | Switch only at long work boundaries. At 0.75 seconds per 1,000 tokens, a 60,000-token chat takes about 45 seconds to re-read [A]. | One person each. No timing of two local models taking turns in a coding chat was found. |

## 3. Strategy table

**Table 3. Cost on paper** [A]: list prices, 60 seconds between messages, so the cache stays alive. The three chats are made up: a small task of 10 requests; a large task of 64 requests that ends near 140,000 tokens; a long chat of 12 messages and 68 requests that ends near 133,000. No failed work is counted, so the cheaper rows look better than they are. Assumptions are in Appendix B.

| Setup | Strategy | Small task | Large task | Long chat |
|---|---|---|---|---|
| **Yours:** Sonnet plans, builds big changes and reviews; Haiku does small fixes | A. Sonnet alone | $0.12 | $1.19 | $1.17 |
| | B. Haiku alone | $0.01 | $0.55 | $0.60 |
| | C. Relay as built | $0.11 | $1.25 | $1.12 |
| | D. Sonnet leads, helpers build | $0.10 | $1.52 | $1.12 |
| | E. Sonnet, lower effort on Execute | $0.11 | $0.99 | $1.00 |
| | F. One switch after the plan | same as A | same as A | same as A |
| **Your idea:** Opus plans and reviews; Sonnet builds; Haiku does small fixes | A. Opus alone | $0.24 | $2.38 | $2.34 |
| | B. Sonnet alone | $0.12 | $1.19 | $1.17 |
| | C. Relay as built | $0.21 | $2.26 | $2.91 |
| | D. Opus leads, helpers build | $0.20 | $1.91 | $1.58 |
| | E. Opus, lower effort on Execute | $0.22 | $1.98 | $2.00 |
| | F. One switch after the plan | $0.22 | $1.44 | $1.42 |
| | F, with reviews in a helper on Opus | $0.32 | $1.70 | $1.64 |
| **Mixed:** Opus plans; DeepSeek Flash builds; GPT-6.1 Sol reviews | A. Opus alone | $0.24 | $2.38 | $2.34 |
| | B. Flash alone | $0.02 | $0.18 | $0.18 |
| | C. Relay as built | $0.21 | $1.04 | $2.42 |
| | D. Opus leads, helpers build | $0.20 | $0.97 | $1.06 |
| | F. One switch after the plan | $0.13 | $0.49 | $0.49 |
| | F, with reviews in a helper on Sol | $0.18 | $0.65 | $0.63 |

With 7 minutes between messages, every row pays a re-read on each message. Then Relay as built is cheaper than one strong model: $2.62 against $3.41 with your setup, $4.05 against $6.82 with an Opus planner (long chat) [A].

**Table 4. Which wins, with the quality risk.**

| Strategy | Small task | Large multi-file task | Long chat | Quality risk | Evidence |
|---|---|---|---|---|---|
| A. One strong model | Dearest, safe. | The safe default. | Fine while the cache lives. Pauses over 5 minutes are what cost. | Lowest. | The baseline in every study below. |
| B. One cheap model | **Wins.** All three Claude models passed 25 of 25 small tasks. A hard one cost $0.074 on Opus, $0.038 on Sonnet, $0.003 on Haiku [30 M]. | Cheapest and weakest: on Terminal-Bench, Haiku 5.5 passed 40.0% against Sonnet 63.9% and Opus 65.8% [33 I]. Pushed to Sonnet's score, Haiku cost about the same ($1.12 against $1.20 a task) and took 163 steps against 41 [29 M]. | As for large tasks. | High on hard work. | [30 M] is a reseller's own test. [33 I]. [29 M]. |
| C. Relay as built | About A (8% to 13% less). | About A (5% less to 5% more); 56% less with a much cheaper builder. | 4% less with your setup; 24% more with an Opus planner. | The re-reads, and the cheaper model's lower pass rate on what it is given: 5 to 10 points lost when a strong model handed over mid-task [24 I]. One router maker dropped per-request switching: "Jumping from a model to another during working sessions results in lower quality of the overall work" [40 M]. | No measurement of per-message switching in OpenCode was found. |
| D. Strong lead, cheaper helpers | Little to gain. | **Wins when the work is bigger than one context window and the helper is one step down.** In a defect search, Opus with Sonnet helpers scored 0.831 for $139; Opus alone 0.827 for $200; with Haiku helpers 0.677 for $47 [27 M]. Fable 5 with a cheaper "sidekick" scored 60.7 for $1.86 against 60.8 for $4.03 alone [28 M]. On ordinary coding tasks, Opus with Haiku helpers lost about 4 points for 32% less cost [27 M]. | 32% to 55% less on paper with a dearer lead, and the lead's chat stays half as long [A]. No gain when lead and helper are the same model. | A helper sees only its brief. With no history, the cheap finisher took 1.6 to 2 times the steps and passed 60.9% against 65.6%. A summary by the strong model did as well as the full history (66.8%) [24 I]. | [27 M] and [28 M] are makers. [24 I]. In OpenCode a helper starts a fresh chat and the parent's cache is not touched [18 M]. |
| E. One model, effort per mode | Little to gain. | **Try this first.** Sonnet 5.5 costs $0.37, $0.52, $1.20, $2.81 and $7.05 a task from low to max effort [29 M]. | Good: no model change. But an effort change can itself lose the cache. It did on a Copilot GPT route in OpenCode 2.2.0 and 2.3.0 [20 P]. Anthropic says current Claude models keep it [2 M]. | Lower effort loses points: Sonnet medium 62.7% for $0.16 against high 77.8% for $0.33; Opus medium is 2.5 points lower for 70% of the cost [27 M]. It can also cost more per task: Gemini 4 Carbon $11.89 at low, $9.22 at high [29 M]. | Makers. Anthropic: "Tune one model before you add a second" [27 M]. |
| F. Pick once, or one switch after the plan | **Wins, with B:** pick the cheap model at the start. | The cheapest way to use two models: one re-read. 39% less (Opus, then Sonnet) to 79% less (Opus, then Flash) [A]. Vendors disagree: one found plan-then-hand-off dearer at the same pass rate ($3.18 against $2.78) [25 M]; one found it cheaper on a single build ($1.26 against $2.47 to $2.90, with no strong-alone arm) [26 M]. | **Wins on cost.** With reviews in a helper on the strong model: 30% less [A]. | The builder's pass rate, as in C. The builder also reviews itself unless a helper does it. | [24 I] [25 M] [26 M]. No published measurement of plan hand-off in a coding tool was found. |

**Which wins.**

- **Small tasks:** one cheap model in a new, short chat (B, picked once).
- **Large multi-file tasks:** one strong model at the right effort (A, E). Use two models only as helpers one step down under a strong lead (D), or as one hand-over after the plan (F) if you accept a lower pass rate.
- **Long chats:** stay on one model and keep its cache alive (A, E). Move the chat at most once (F). Get checks from helpers. Switching per message (C) wins only when each message arrives after the cache has gone.

## 4. Model-picking method

### 4.1 Is "use it for" the right way?

| Way to pick | Verdict | Why |
|---|---|---|
| "Use it for" lines, matched by the decider (today) | Keep, for kinds of work. | Matching a message to a written description works: 93.17% in the maker's own test, on dialogue data, not coding [35 M]. A production router does the same and warns that overlapping descriptions send requests to the fallback [41 M]. Lines that name a size ("small quick fixes", "bigger changes") ask the decider how hard the job is, and that fails (next row). |
| Guess how hard the job is from the message | No. | A complexity score "was not predictive" (0.524, where 0.5 is chance) [36 M]. Routing on the prompt alone scored 0.627; after two cheap turns of looking around, 0.780 [37 I]. One maker removed its router after four months: "Complexity cannot be deduced from the prompt alone." [40 M] |
| Show the decider prices or model strength | No. | A model asked to pick with no measured data did worse than always using the best single model (41.41% against 43.83%). With a table of each model's measured score per kind of task it reached 47.74% [39 I]. Used as a router, Opus 4.6 spotted 7 of 147 hard steps [38 I]. "The classifier never sees model names" [41 M]. |
| Rank by catalog price or public benchmarks | Only for the re-read sum. | Token price is a poor guide to cost per task: the lower-priced model cost more in 32% of pairs [32 I], and Sonnet 5.5 at max effort cost the same per task as Opus 5.5 for a lower score ($10.02 for 55, $10.04 for 59) [33 I]. The best trained routers gained up to 4% in accuracy on the best single model, or matched it for up to 31.7% less cost, and several did not beat it at all [48 I]. But prices are exact for one thing: what a re-read costs. |
| Cheapest model that fits | No. | It needs a way to know the cheap model will get it right. Without one it is strategy B. |
| Start cheap, step up after a failure | Not inside one chat. | It needs a hard signal, such as a failing test. Carrying a cheap model's chat on to a strong one was the worst deal measured: 69.2% for $1.61, against the strong model alone at 79.2% for $0.72 [24 I]. In a vendor's test, 2 of 6 easy tasks stepped up on a false alarm [47 M]. |
| Stay unless the gain is clear | **Yes. This is what Relay lacks.** | Every coding router found does it. Requesty pins the model for 60 minutes [41 M]. Copilot switches "along natural cache boundaries" [42 M]. Kilo "only switches when a cheaper option is clearly worth it" [43 M]. Augment switches "only when the expected win from a different model exceeds the cost of the cache eviction" [44 M]. OrcaRouter: "de-escalate only when it is free" [45 M]. |

So the decider should see neither prices nor model strength. A step after it should see prices, and use them only for the re-read sum.

### 4.2 The method: the person's lines choose; cost may only say "not now" to a step down

1. **Decider (unchanged).** One request. It sees the message, up to ten file names and the lines. It never sees model names, prices or the chat's size. Under 0.6 for the mode, or 0.5 for the line, today's rules apply.
2. **Hard limits (one more).** The model is offered, takes pictures if needed, and fits the attached files. New: **the whole chat must fit** its context window with room to spare: OpenCode compacts a chat when less than 15% of the window, or 16,000 tokens, is free [18 M]. Today only the attached files are counted [code].
3. **Stay or go (new; arithmetic only, no model request).** This runs when the pick differs from the chat's model and the chat's model is one of this mode's models.
   - a. **Nothing to lose: go.** The chat is new, has been idle longer than the cache lasts, or was just compacted.
   - b. **No price, or $0, for either model: go.** Note "no price, so no cost check".
   - c. **The pick costs more per request: go.** The person's line asked for the stronger model. Record what the step up cost.
   - d. **The pick costs less: go only if `saving >= 1.5 x extra`.** Otherwise stay for this message, and say why.

   ```
   cost per request on model m = chat x R_m + 1,500 x W_m + 500 x O_m      (times the price step, if the chat is over it)
   saving = N x (cost per request on the chat's model - cost per request on the pick)
   extra  = (the part of the chat the pick has no live cache for) x (W_pick - R_pick)
   ```

   `R` is the cached-read price, `W` the cache-write price, `O` the output price. `N` is the usual number of requests for that line in Relay's own records, and 6 until there are three. The 1,500 and 500 stand in until the records give real averages. "No live cache" means the whole chat, unless the pick answered in this chat within the cache lifetime; then it means only what was added since. The 1.5 is a margin for these guesses; one published rule uses the same margin [15 M].

   Whichever model is used, the mode still sets the agent (`plan` or `build`) and the review rules.
4. **Send (unchanged).** Once, unchanged. Anything that fails before the send becomes a note, and the message goes to the chat's current model.
5. **Afterwards (new; no model request).** From OpenCode's record of the reply, keep the tokens read from cache, the tokens written to cache, the cost and the seconds, next to the decision. That gives `N`, the averages, and what each switch really cost.

**Inputs.** Catalog prices: input, output, cached read, cache write, and the size of any price step. Relay keeps the first three and a yes-or-no flag for steps today [code]. The chat's size (the tokens of its latest reply) and when it last answered; OpenCode stores both per reply [code]. Relay's own records.

**When unsure, or when data is missing.**

| Case | What happens |
|---|---|
| The decider is unsure of the mode or the line | As today. |
| No price, or $0: a plan, a local model, "$0 or not listed" | No cost check; the line is followed. The hard limit still applies, and step 5 still records tokens re-read and seconds. |
| Cached-read price missing | The model is treated as having no cache, so a cheaper model goes at once. |
| Cache-write price missing | The input price is used. |
| Chat size or last activity unknown | Go, with a note. |
| The chat's model is not one of this mode's models | Go: the person did not choose it for this work. |

### 4.3 Example 1: your setup

Plan: Sonnet 5.5. Execute: Haiku 5.5 ("small quick fixes in one file") and Sonnet 5.5 ("bigger changes across several files, new features"). Review: Sonnet 5.5. Decider: `ollama-cloud/clef:27b`. The sums use API list prices [A].

| # | Message | Chat | Decider | Step 3 | Result |
|---|---|---|---|---|---|
| 1 | "In two sentences, what does src/text.js do?" | new | Plan | one Plan model | Sonnet |
| 2 | "Add a one-line comment at the top of src/text.js" | 20,000 tokens, on Sonnet | Execute, "small quick fixes": Haiku | cheaper: saving $0.061, extra $0.002 | go to Haiku |
| 3 | "Add src/stats.js and src/index.js" | 24,000, on Haiku | Execute, "bigger changes": Sonnet | dearer: go. Sonnet answered two minutes ago, so it re-reads only the new 4,000 tokens, about $0.01 | Sonnet |
| 4 | "Review src/text.js" | 45,000, on Sonnet | Review: Sonnet | same model | stays; agent `plan`, review rules added |
| later | "Fix the typo in the README title" | 150,000, on Sonnet | Execute, "small quick fixes": Haiku | cheaper per token, but the chat is past Haiku's 100,000 step: saving $0.084, extra $0.086, 1.5 x extra $0.129 | **stays on Sonnet**; the note says why |

The edge is sharp. At 95,000 tokens the same message goes to Haiku (saving $0.101, extra $0.011). At 101,000 it stays (saving $0.070, extra $0.058) [A].

**On your plan.** The `claude-agent` models list no price [repo], so step 3b applies and every row goes as it does today. The last row is the one that matters for you. A size limit on Haiku (advice 5) catches it without prices.

### 4.4 Example 2: mixed providers with a local model

Plan: Claude Opus 5.5 ("hard design questions") and GPT-6.1 Sol ("everyday questions about the code"). Execute: DeepSeek V4.1 Flash ("bigger changes across several files") and a local Ollama model ("small edits in private code", no price). Review: GPT-6.1 Sol. Decider: `opencode/jev-1.13-free`.

| # | Message | Chat | Decider | Step 3 | Result |
|---|---|---|---|---|---|
| 1 | "Design the import feature" | new | Plan, "hard design": Opus | new chat | Opus |
| 2 | "What does parseRow return?" | 60,000, on Opus | Plan, "everyday questions": Sol | cheaper, but only 2 times: saving $0.089, extra $0.144 | **stays on Opus** (Sol would need 15 requests) |
| 3 | "Build it" | 62,000, on Opus | Execute, "bigger changes": Flash | Opus is not an Execute model: go. The sum agrees: saving $0.171, extra $0.018 | Flash |
| 4 | "Rename this variable in one file" | 70,000, on Flash | Execute, "small edits in private code": local model | no price: no cost check. Hard limit: does a 70,000-token chat fit? Ollama's default window is 4,000 to 32,000 tokens on cards under 48 GB [56 M] | fits: local model, after a load and about 50 seconds of reading [A]. Does not fit: stays on Flash, with a note |
| 5 | "Review the change" | 80,000 | Review: Sol | the chat's model is not a Review model: go. The step up costs 80,000 x $2.50 = $0.20 | Sol |
| 6 | "Fix the failing import test" | 85,000, on Sol | Execute, "bigger changes": Flash | Sol is not an Execute model: go. The sum agrees: saving $0.094, extra $0.025 | Flash |

## 5. Redesign advice

Ranked: do the cheap, certain things first.

| # | Change | Why | Cost to build | What is lost |
|---|---|---|---|---|
| 1 | **Record what each switch cost.** After the send, read the reply's record and keep the tokens read from cache, written to cache, the cost and the seconds with the decision. Show it in Recent choices: "re-read 84,000 tokens, $0.21, 9 s". | Nobody has measured this. OpenCode stores all of it per reply, and for plan models too (tokens, no price) [18 M] [53 M]. It works for dollars, plan limit and local time alike. Change 3 needs it. | About a day: one read after the turn, four fields in the record, one line in the panel, tests. | Nothing for the person. |
| 2 | **Say when Relay saves.** In the README and the panel: in a long chat use `/relay` at clear points (first message, plan approved) rather than leaving the switch on. Ask for checks through a helper: Relay already puts those on the Review model, and with the switch off the chat itself does not move [code]. Try one model at two efforts first; Relay's model choices already carry an effort [code]. If you pause more than 5 minutes between messages, set a longer cache lifetime in OpenCode. Replace "No cost savings have been measured" with the rule in section 2. | Free, and usable today. Rows E and F in table 4. The pause sum: $3.41 down to $1.37 [A]. | An hour or two of writing. | Nothing. |
| 3 | **The stay-or-go check, and count the whole chat** (steps 2 and 3 in section 4.2). | Relay switches whenever the pick differs [code]. Every coding router found stays unless the gain is clear (section 4.1). After a model switch only 8% of the prompt came from cache [12 M]. A chat too long for the picked model makes OpenCode compact it first: two extra requests were seen in this repo [repo]. | Two to three days. `inventory.ts` keeps the cache-write price and the step size. One pure function in `router.ts`, with money in whole units as `parseUsd` does, and nothing from `node:`. Chat size and last activity are read where the chat is already read. Notes. Red-then-green tests. Build it after stage 1 of the test. | The person's line is sometimes not followed for one message; the note says so. One more rule to explain. It is wrong when `N` is wrong. |
| 4 | **Helpers that build get the Execute model.** `review-helper.ts` already asks the decider about every helper a model starts and moves checks to the Review model. Do the same for builds. | A helper is the one way found to use a second model without re-reading the chat or losing its cache [2 M] [3 M] [18 M]. Same quality for 30% less with helpers one step down, on work bigger than one window [27 M]. | About a day. Do it only if the test shows D wins for your models: Haiku helpers lost 4 points [27 M], and a helper on the lead's own model cost 28% more on paper [A]. | A helper call that named a model gets another one, as checks do since 17 Nov. |
| 5 | **An optional size limit per model:** "do not move a chat over N tokens to this model". | For models with no price. On your plan: Haiku, 100,000. For a local model: its real window. Ollama's default is 4,000 to 32,000 tokens on cards under 48 GB, whatever the model can hold [56 M]. | Half a day: one optional number in the panel, used by the same filter as change 3. | One more setting. |
| 6 | **A hint when the Review model looks weaker than the builders** (its listed price is below every Execute model's). | A weaker reviewer cut the pass rate from 91.4% to 82.8% and raised the cost from $0.226 to $0.382 a task [31 I; one run per condition, older models]. | An hour or two. | The hint can be wrong: price is not strength [32 I]. |

**Not advised:** prices or model names in the decider's prompt; guessing how hard a job is; stepping up after a failure inside one chat; ranking models by benchmarks. Section 4.1 has the evidence.

**Checked, and no change needed** (read in OpenCode's source; not measured on 2.3.0):

- **Plan to build on the same model keeps the cache.** Both agents send the same tool list and system text, and a switch adds one reminder message near the end [18 M]. One user measured it on 2.0.10: "276 in, 43377 cached" [19 P].
- **The review rules do not break the cache.** Adding or removing them mid-chat appends one update message. The system text stays frozen until the next compaction [18 M].
- **Keep switching only while the chat is idle.** An agent switch during a running turn put the reminder last, and one model refused 6 of 6 such requests [22 P].
- **One open OpenCode bug to watch.** One-off prompts take the cache marker, so each such request writes a cache entry that nothing reads. The Plan reminder that is re-added after a compaction is named among them; the measured cases were other reminders. The fix is not in 2.3.0 [21 P]. Relay keeps Plan and Review chats on `plan`, so its long chats may be exposed.

## 6. Test you can run

**Ground rules, from `AGENTS.md`.**

- Use an isolated OpenCode only: its own `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`, a throwaway server password and loopback ports, as `scripts/smoke-host-model.mjs` does. Never your real profile or Desktop.
- Build a copy of the repo, never this folder: your own OpenCode reloads this folder's `dist/` on every build.
- Stages 1 and 2 use a real key and real money. `AGENTS.md` forbids that unless you say yes to that named step.
- Write what was seen into `docs/compatibility.md` (platform, version, what was not tested) and add a line to `docs/implementation-progress.md`.

**Stage 0. What a switch does to the request. Free; no yes needed.**

1. Start the isolated server with the smoke script's mock provider and two mock models. Make the mock keep every request whole.
2. In one chat, send three messages. Then make one change at a time, with a message after each: agent to `plan`; back to `build`; review rules on; review rules off; model to the second mock model; back to the first; effort changed.
3. For each request, compare it with the one before. Is the system text the same? Is the tool list the same? Is the earlier message list an exact start of the new one?
4. Expected from the source: only the model change sends a different start. If an agent change or the review rules rewrite the start, stop and fix that first. On paper it would add 22% to 77% to a chat's cost (Appendix B).

The mock speaks the OpenAI format, so this shows the text of each request, not a real cache.

**Stage 1. What a switch costs. Needs your yes. Under $10.**

Use an Anthropic API key with a spending limit, not the plan: the key shows dollars and cache tokens, and the plan drains about twice as fast through OpenCode [54 P].

1. In one chat, let Sonnet read files until the chat is about 30,000 tokens. Do step 2 there, then again at about 60,000 and 120,000.
2. Record input, cache-read and cache-write tokens, cost and seconds for each of these:
   - a. one more request on Sonnet;
   - b. `build` to `plan`, then a request;
   - c. review rules on, a request; off, a request;
   - d. effort changed, a request;
   - e. switch to Haiku, two requests;
   - f. back to Sonnet after 1 minute;
   - g. to Haiku, and back to Sonnet after 6 minutes.
3. Expected: a to c read nearly everything from cache. e reads nothing from cache on its first request and nearly everything on its second. f reads the old part from cache. g reads nothing. d is unknown.

**Stage 2. Which strategy saves money at the same quality. Needs your yes. About $165; cap $200.**

*Tasks: 12, each a folder with a start commit and tests the model cannot see.*

- 4 small: one-file exercises that come with tests, from the Aider polyglot set [65 M].
- 4 large: multi-file tasks from SWE-bench Pro's public set, whose reference fixes average 107 lines over 4.1 files [66 I]. If its containers are too heavy on Windows, write four feature tasks of 2 to 5 files in a small repo of your own.
- 4 long chats: a fixed script of 10 messages on one repo (question, plan, build, small fix, review, fix, review, question, small fix, build). Run the tests after every build or fix, and use the same script for every arm, as UserSWE does [63 I].

*Arms, on your models at API list prices.*

| Arm | Setup |
|---|---|
| A | Sonnet 5.5 for everything; Relay off |
| B | Haiku 5.5 for everything; Relay off |
| C | Relay as built, switch on, your lines |
| D | Sonnet leads; every build or fix goes to a helper whose agent is set to Haiku |
| E | Relay with Sonnet at high effort for Plan and Review, and at medium for Execute |
| F (optional pair) | Opus 5.5 alone, against Opus until the plan is approved and then Sonnet, with no switch back |
| later | C with the stay-or-go check, once it is built |

*What to record.*

- **For each reply:** model, agent, input, output, reasoning, cache-read and cache-write tokens, cost, seconds. OpenCode stores these [code]; read them with `opencode session export <id>` or `opencode stats --cost --models --json` [23 M]. Sum the cost of every step, as a published harness does [67 I], and add the helpers' own chats.
- **For each message:** Relay's decision (mode, model, how sure, decider time and cost) from Recent choices. Copy it after each chat: only the last 20 are kept [code].
- **For each task:** tests pass or fail; redo turns (each "the tests still fail" message the script had to send, two at most); total cost; requests; minutes.

*Runs.* Three for each task and arm: 180 runs. Runs of one task differed by up to 30 times in tokens in one study [34 I], and a single run's pass rate moves 2 to 6 points [62 I].

*Budget* [A, from the made-up chats]. One pass costs A $9.92, B $4.64, C $9.92, D $10.96 and E $8.40: $43.84. Three passes: $131.52. With 25% for retries: about $165. The optional Opus pair adds $32.16 a pass, about $120 in all. **Pilot first:** 6 tasks, 1 run, 5 arms, about $22; with stage 1, about $35.

*Stop rules.*

- Stop at $200 spent, added up after every run from OpenCode's own cost figures.
- A run stops at 60 requests or 15 minutes, and counts as a fail.
- After the pilot, drop an arm that costs more than A on every pilot task and passes fewer.
- Stop if stage 0 or 1 shows a surprise. Fix or re-plan first.

*Reading the result.*

- An arm **saves money at the same quality** if it is cheaper than A on at least 10 of the 12 tasks (sign test, p = 0.039; mean cost of the three runs, redo turns included) and passes no fewer than A's passes minus 2, out of 36.
- Be plain about what this can show. 36 runs an arm show only large gaps in pass rate, about 30 points: my arithmetic [A] with the formula in [60 M]. Cost gaps show far more clearly: in one study 616 paired tasks could not tell 42.5% from 44.5% passed, but showed a 6.33-times cost gap [61 P].

**Optional, after stage 2.**

- **Your plan. Needs your yes; it costs plan allowance.** Run two long-chat tasks under A and C with the isolated OpenCode signed in to your Claude plan. Note the 5-hour meter before and after each, as [54 P] did. The meter moves in whole percents, so use the long chats.
- **Local models. Free.** In the isolated OpenCode, take turns between two local Ollama models in one chat at about 20,000 and 50,000 tokens. Read `load_duration`, `prompt_eval_duration` and `prompt_eval_cached_count` from Ollama [56 M].

## 7. Open questions

**What nobody has measured.**

1. How often the old model's cache is still alive when a person's chat comes back to it. The only figure is a vendor's, on agent traffic [14 M].
2. How a Claude plan counts cached reads, cache writes and each model. No weights are published, and two reports disagree [51 P] [52 P].
3. Whether a step down mid-chat costs pass rate on today's models. The large independent test used Opus 4.7 with Haiku 4.5, and GPT-5.6 Sol with Luna [24 I].
4. How well a decision model picks from a person's own short list of lines. Not found. Its confidence is not a calibrated chance: in one test, answers at 0.99 or more were 96.3% right and answers under 0.5 were 29.6% right [46 I]. Relay's 0.6 and 0.5 were not tuned on labelled coding messages.
5. How long two local models take to alternate in a coding chat. Not found.
6. Any size of task above which plan-then-build pays. Not found.

**What only the experiment can settle.**

7. Whether OpenCode 2.3.0 really keeps the cache across an agent switch, the review rules and an effort change (stages 0 and 1). The source says yes for the first two. An effort change lost it on one route [20 P].
8. Whether Relay's chats on `plan` hit the open cache bug after a compaction [21 P].
9. Whether helpers that see only a brief build as well as the chat's own model, and what they add in tokens, in OpenCode.
10. Whether the 8% and 24% in the verdict hold on real tasks. They come from three made-up chats.

## Appendix A. The 14 November claims, checked

| # | Claim | Check | What I found |
|---|---|---|---|
| 1 | Each model has its own cache; after a switch the new model reads the whole chat at full price. Anthropic's example: 100,000 tokens into an Opus chat, a switch to Haiku for an easy question costs more than staying. Anthropic suggests helpers. | Holds; the example has aged. | The wording is exact [2 M] [3 M]. At today's prices the example turns round below Haiku 5.5's price step: 100,000 tokens read on Opus 5.5 cost $0.020; written on Haiku 5.5 they cost $0.0125 at or under 100,000 and $0.0625 above [1 M] [A]. No provider was found where a model switch keeps the cache. |
| 2 | With write 1.25x and read 0.1x, a model 5 times cheaper pays back after about 2 turns, 3 times after about 5, 2 times after about 10. A dearer model never pays back. | Corrected. | It assumed one read rate. Opus 5.5 and Sonnet 5.5 read at 0.05x and Fable 5.2 at 0.025x [1 M], so the absolute prices decide. Opus to Sonnet (2 times): 25 requests if it only reads, 6 to 18 with work. Sonnet to Haiku (20 times): 1 or 2 under 100,000 tokens, 6 to 12 above [A]. It also counted turns; one message is several requests. "Never pays back" holds. |
| 3 | Plan-strong, build-cheap: gains of a few points, mostly measured by makers. Stencil: $3.18 against $2.78 at the same pass rate. Kilo: $1.26 against $2.47 to $2.90. Cheap builders fail on surprises, rebuild code that exists, or change tests. | Figures hold; new evidence is less kind. | Stencil and Kilo hold [25 M] [26 M]. Kilo's is one build with no strong-alone arm, and its builder never used the plan's guard. New and independent: a step down mid-task lost 5 to 10 points [24 I]. New from a maker: helpers one step down kept quality for 30% less on work bigger than one window; Haiku helpers lost 4 points [27 M]. The failure modes found with numbers are extra steps, stopping early, drifting from the plan and needing fixes from the lead. "Changes the tests" and "rebuilds existing code" were not found with numbers. |
| 4 | A reviewer weaker than the writer made results worse: 91.4% down to 82.8%. | Holds. | 116 tasks, one run per condition, older models. Cost rose from $0.226 to $0.382 a task. The other way round, a stronger reviewer raised 71.6% to 89.7% [31 I]. |
| 5 | Deciding the kind of work from the message works (about 93%, not on coding). Guessing difficulty does not. | Holds, with a note. | The 93.17% is the maker's own paper, on dialogue data; a general model scored 92.79% on the same test [35 M]. Difficulty: 0.524 [36 M], 0.627 [37 I], and a router removed [40 M]. |
| 6 | Coding routers stay on one model across related turns: Requesty pins for 60 minutes; Copilot switches only at cache boundaries. | Holds. | Both confirmed [41 M] [42 M]; four more do the same (section 4.1). Against: LiteLLM now classifies every turn by default and reports the cache alive on 97.4% of switch-backs [14 M]. Cursor reports 30% to 50% saved with switching [16 M]; its three savings figures come from three pages. |
| 7 | Changing effort is often a better lever than changing model, and on some models it keeps the cache. | Holds, with two cautions. | Anthropic says so and measures it [27 M] [2 M]. In OpenCode 2.3.0 an effort change lost the cache on one Copilot GPT route [20 P]. Lower effort loses points, and once cost more per task [29 M]. |
| 8 | Price per token is a poor guide to cost per task. | Holds. | [32 I] [33 I] [29 M]. |
| 9 | Nobody has measured how well a decision model picks among a person's own short list. | Still not found. | Nearest: a decision model on 77 fixed options, 81.0% [46 I]. This repo's own 30 examples: 29 right, with labels written by the author (`README.md`). |
| 10 | Another figure in that report: an adviser model gave 2.7 points more for 11.9% less cost. | Weak. | The two arms had different thinking settings [68 M]. Anthropic's later page found an adviser pairing cost 2.1 times the model alone for "a small gain that may be chance" [27 M]. |

## Appendix B. The arithmetic

The sums were run with two small Node scripts that call no model and check themselves. They are not in the repo, because this task allowed one file. Everything needed to redo them is here.

**Prices used**, per million tokens: input / cached read / cache write / output [1 M] [5 M] [7 M].

| Model | Input | Cached read | Cache write | Output | Price step |
|---|---|---|---|---|---|
| Fable 5.2 | $8 | $0.20 | $10 | $40 | none |
| Opus 5.5 | $4 | $0.20 | $5 | $20 | none |
| Sonnet 5.5 | $2 | $0.10 | $2.50 | $10 | none |
| Haiku 5.5 | $0.10 | $0.01 | $0.125 | $0.50 | 5x above 100,000 prompt tokens |
| GPT-6.1 Sol | $2 | $0.10 | $2.50 | $10 | input 2x above 272,000 |
| GPT-6 Luna | $0.10 | $0.01 | $0.125 | $0.50 | as Sol; not reached here |
| DeepSeek V4.1 Flash, peak hours | $0.30 | $0.006 | $0.30 (no write fee) | $1.20 | none |

**One request costs** `step x (R x cached + W x not cached + O x output) / 1,000,000`. `cached` is the part of the prompt that this model wrote or read within the cache lifetime.

**Assumptions** (mine, not measured):

- 12,000 tokens of system text and tools before the first message. A helper starts at 9,000.
- A request takes 6 seconds. The cache lasts 5 minutes. Messages are 60 seconds apart (cache alive) or 420 seconds apart (cache gone).
- Tokens a request adds, in and out: question 2,000 and 400; plan 2,000 and 600; big build 1,500 and 600; small fix 1,000 and 300; check 2,000 and 500. The first request of a message adds 300.
- A cheap-tier model (Haiku, Flash, Luna) takes 1.4 times the requests. That is mild: pushed to Sonnet's score, Haiku took 4 times the steps [29 M].
- A helper takes 1.5 times the requests of the same work done in the chat. The lead spends one request on the brief and one on the result.
- E halves the output on Execute messages.
- No failed task, redo turn or compaction is counted.

**The three chats**, in requests. Small task: question 3, small fix 5, check 2. Large task: question 5, plan 6, big build 40, check 5, small fix 6, check 2. Long chat: question 5, plan 6, big build 18, small fix 4, check 4, small fix 5, check 2, question 4, small fix 6, small fix 3, big build 10, question 1.

**With the cache gone at every message** (420 seconds apart): small task / large task / long chat.

| Setup | A | B | C | D | E | F | F with helper reviews |
|---|---|---|---|---|---|---|---|
| Yours | $0.22 / $2.25 / $3.41 | $0.02 / $0.87 / $1.34 | $0.15 / $1.98 / $2.62 | $0.19 / $1.98 / $2.41 | $0.20 / $1.96 / $3.09 | as A | not run |
| Your idea | $0.43 / $4.50 / $6.82 | $0.22 / $2.25 / $3.41 | $0.29 / $2.98 / $4.05 | $0.37 / $2.85 / $4.17 | $0.41 / $3.93 / $6.17 | $0.27 / $2.47 / $3.63 | $0.38 / $2.69 / $3.72 |
| Mixed | $0.43 / $4.50 / $6.82 | $0.03 / $0.36 / $0.58 | $0.21 / $1.59 / $2.94 | $0.38 / $1.90 / $3.65 | $0.41 / $3.93 / $6.17 | $0.14 / $0.74 / $0.94 | $0.19 / $0.89 / $1.04 |
| No cache at all: a $2 / $10 model and one 5 times cheaper | $0.43 / $10.46 / $10.76 | $0.16 / $4.07 / $4.51 | $0.28 / $5.69 / $6.06 | $0.35 / $5.07 / $4.44 | $0.42 / $9.55 / $9.98 | $0.20 / $4.06 / $4.46 | not run |

**Two "what if" rows for stage 0** (your setup, cache alive; Relay as built is $0.11 / $1.25 / $1.12). If an agent change also re-read the chat: $0.11 / $1.62 / $1.98. If the review rules also did: $0.15 / $1.53 / $1.53. OpenCode's source says neither happens.

**A one-hour cache** (Sonnet alone, long chat; writes at $4): $1.37 at any pause under an hour, against $1.17 with a 5-minute cache and 60-second pauses, and $3.41 with 7-minute pauses.

## Sources

Kind: **M** maker or vendor claim, **I** independent measurement, **P** one person's report.

| # | Source | Link | Date | Kind |
|---|---|---|---|---|
| 1 | Anthropic, API pricing | https://platform.claude.com/docs/en/about-claude/pricing | read 17 Nov 2026 | M |
| 2 | Anthropic, Claude Code docs, "Prompt caching" | https://code.claude.com/docs/en/prompt-caching | read 17 Nov 2026 | M |
| 3 | Anthropic, "Lessons from building Claude Code: prompt caching is everything" | https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/ | 30 Apr 2026 | M |
| 4 | Anthropic, "What a task costs on Opus 5.5" | https://claude.dev/blog/what-a-task-costs-on-opus-5-5/ | 25 Sep 2026 | M |
| 5 | OpenAI, API pricing and prompt-caching guide | https://developers.openai.com/api/docs/pricing and https://developers.openai.com/api/docs/guides/prompt-caching | read 17 Nov 2026 | M |
| 6 | Google, Gemini API pricing and caching | https://aistudio.google.com/docs/pricing and https://aistudio.google.com/docs/caching | read 17 Nov 2026 | M |
| 7 | DeepSeek, pricing and cache guide | https://api-docs.deepseek.com/quick_start/pricing/ and https://api-docs.deepseek.com/guides/kv_cache | read 17 Nov 2026 | M |
| 8 | Ollama, pricing | https://ollama.com/pricing | read 17 Nov 2026 | M |
| 9 | "What fallback model actually does to your prompt cache" | https://mer.vin/news/what-fallback-model-actually-does-to-your-prompt-cache/ | 14 Sep 2026 | P, measured |
| 10 | "Model routing layers and the prompt cache tax" | https://alphasignal.ai/news/model-routing-layers-and-the-prompt-cache-tax | 29 Jul 2026 | P, measured; method thin |
| 11 | OpenCode issue 44592 (OpenCode 1.x) | https://github.com/anomalyco/opencode/issues/44592 | 24 Aug 2026 | P |
| 12 | Study of GitHub Copilot traffic, arXiv 2608.00101 | https://arxiv.org/abs/2608.00101 | 30 Jul 2026 | M: measured, but by the operator's own researchers |
| 13 | "The hidden cost of LLM routing" | https://towardsdatascience.com/the-hidden-cost-of-llm-routing-why-switching-models-costs-more/ | 20 Oct 2026 | P, measured on a small local model |
| 14 | LiteLLM, router and caching benchmark; auto-routing docs | https://docs.litellm.ai/blog/auto-router-prompt-caching-benchmark and https://docs.litellm.ai/docs/proxy/auto_routing.md | 31 Jul 2026; 17 Nov 2026 | M |
| 15 | Edgee and Respan, break-even posts | https://www.edgee.ai/blog/posts/switching-llms-mid-conversation-is-a-ski-rental-problem and https://www.respan.ai/blog/llm-prompt-caching | 10 Nov 2026; 9 Nov 2026 | M, arithmetic from list prices |
| 16 | Cursor, router posts and forum | https://cursor.com/blog/router , https://cursor.com/blog/how-cursor-router-works , https://forum.cursor.com/t/introducing-cursor-router/166386 | 22 Jul, 6 Aug, 23 Jul 2026 | M |
| 17 | OpenRouter, Auto and Auto Code routers | https://openrouter.ai/blog/announcements/auto-and-auto-code-routers/ | 6 Nov 2026 | M |
| 18 | OpenCode source at tag v2.3.0: `cache-policy.ts`, `plan.ts`, `tool.ts`, `agent.ts`, `model-request.ts`, `compaction.ts`, `to-llm-message.ts`, `subagent.ts`, `usage.ts`, `instruction-state.ts`, `instruction-entry.ts` | https://github.com/anomalyco/opencode/tree/v2.3.0 | tag of 13 Nov 2026 | M, source code; read, not run |
| 19 | OpenCode issue 50055 | https://github.com/anomalyco/opencode/issues/50055 | 19 Sep 2026 | P, measured in one session on 2.0.10 |
| 20 | OpenCode issue 59868 | https://github.com/anomalyco/opencode/issues/59868 | 28 Oct and 17 Nov 2026 | P, measured by two users |
| 21 | OpenCode issue 62554 | https://github.com/anomalyco/opencode/issues/62554 | 7 to 17 Nov 2026 | P, reproduced by the maintainers' bot |
| 22 | OpenCode issue 57013 | https://github.com/anomalyco/opencode/issues/57013 | 19 Oct 2026 | P |
| 23 | OpenCode docs: models, agents, CLI, API | https://opencode.ai/docs/models/ , https://opencode.ai/docs/agents/ , https://opencode.ai/docs/cli/commands/ , https://opencode.ai/docs/api/ | read 17 Nov 2026 | M |
| 24 | "The Handoff Tax", arXiv 2608.24358 | https://arxiv.org/abs/2608.24358 | 25 Aug 2026 | I; older models |
| 25 | Stencil, "Prewalk" | https://stencil.so/blog/prewalk | 13 Jul 2026 | M |
| 26 | Kilo, "Auto model vs picking your own" | https://blog.kilo.ai/p/auto-model-vs-picking-your-own | 27 Jul 2026 | M, one build |
| 27 | Anthropic, "Optimizing for cost and intelligence" | https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence | runs of Sep to Nov 2026 | M |
| 28 | Cognition, "Making Fable cheaper than Opus" | https://cognition.com/blog/making-fable-cheaper-than-opus | 13 Jul 2026 | M |
| 29 | Cursor, CursorBench 4.0 | https://cursor.com/evals | last change 7 Oct 2026 | M |
| 30 | OpenRouter, "Claude Opus vs Sonnet vs Haiku" | https://openrouter.ai/blog/insights/claude-opus-vs-sonnet-vs-haiku/ | 30 Oct 2026 | M, a reseller's own test |
| 31 | Cross-model review study, arXiv 2607.21656 | https://arxiv.org/abs/2607.21656 | 22 Jul 2026 | I |
| 32 | Listed price against total cost, arXiv 2603.23971 | https://arxiv.org/abs/2603.23971 | 25 Mar 2026 | I |
| 33 | Artificial Analysis model pages; Terminal-Bench leaderboard | https://artificialanalysis.ai/models/claude-sonnet-5-5 and https://www.tbench.ai/leaderboard | read 17 Nov 2026 | I |
| 34 | Token use across repeated runs, arXiv 2604.22750 | https://arxiv.org/abs/2604.22750 | 24 Apr 2026 | I |
| 35 | Arch-Router, arXiv 2506.16655 | https://arxiv.org/abs/2506.16655 | 19 Jun 2025 | M; older; dialogue data |
| 36 | LiteLLM, auto-routing benchmark | https://docs.litellm.ai/docs/proxy/auto_routing_benchmark.md | 17 Nov 2026 | M, own test with the method published |
| 37 | SWE-Router | https://www.alphaxiv.org/abs/2607.00053 | 30 Jun 2026 | I |
| 38 | TwinRouterBench, arXiv 2605.18859 | https://arxiv.org/abs/2605.18859 | 24 Oct 2026 | I |
| 39 | Agent-as-a-Router, arXiv 2606.22902 | https://arxiv.org/abs/2606.22902 | 22 Jun 2026 | I |
| 40 | Manifest, "Why we deprecated our LLM router" | https://manifest.build/blog/why-we-deprecated-our-llm-router/ | 31 Jul 2026 | M |
| 41 | Requesty, auto-routing docs | https://docs.requesty.ai/features/auto-routing.md | no date; read 17 Nov 2026 | M |
| 42 | GitHub Copilot, auto model selection | https://docs.github.com/en/copilot/concepts/auto-model-selection | no date; read 17 Nov 2026 | M |
| 43 | Kilo, Auto model docs | https://kilo.ai/docs/code-with-ai/agents/auto-model | no date; read 17 Nov 2026 | M |
| 44 | Augment, Prism | https://www.augmentcode.com/blog/augment-prism-model-routing-to-reduce-cost-and-maintain-quality | 2 May 2026 | M |
| 45 | OrcaRouter, session-aware routing | https://www.orcarouter.ai/blog/orcarouter-session-aware-routing | 14 Aug 2026 | M |
| 46 | OpenRouter, Jev 1.13 against Claude Opus 5 on classification | https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification | 22 Sep 2026 | I, by a reseller of both models; not coding |
| 47 | GMI, model escalation test | https://www.gmicloud.ai/en/blog/dynamic-model-escalation-for-coding-agents-a-gmi-router-experiment-across-two-harnesses | 16 Sep 2026 | M |
| 48 | LLMRouterBench, arXiv 2601.07206 | https://arxiv.org/abs/2601.07206 | 12 Jan 2026 | I |
| 49 | Anthropic help: usage limits, best practices, the Max plan | https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work , https://support.claude.com/en/articles/9797557-usage-limit-best-practices , https://support.claude.com/en/articles/11049741-what-is-the-max-plan | read 17 Nov 2026 | M |
| 50 | Anthropic, Claude Code docs: errors, costs | https://code.claude.com/docs/en/errors and https://code.claude.com/docs/en/costs | read 17 Nov 2026 | M |
| 51 | "Claude limits" measurement | https://she-llac.com/claude-limits | 25 Jan 2026 | P, measured; older models |
| 52 | Claude Code issue 87419 | https://github.com/anthropics/claude-code/issues/87419 | 17 Aug 2026 | P |
| 53 | OpenCode, Claude Agent provider: spec and source | https://github.com/anomalyco/opencode/blob/dev/specs/v2/claude-agent-provider.md | read 17 Nov 2026 | M |
| 54 | OpenCode issue 61072 | https://github.com/anomalyco/opencode/issues/61072 | 1 to 17 Nov 2026 | P, a controlled test; the maintainers agree |
| 55 | OpenCode issue 63871 | https://github.com/anomalyco/opencode/issues/63871 | 13 Nov 2026 | P |
| 56 | Ollama docs: FAQ, context length, usage | https://docs.ollama.com/faq , https://docs.ollama.com/context-length , https://docs.ollama.com/api/usage | read 17 Nov 2026 | M |
| 57 | Cline issue 15641 | https://github.com/cline/cline/issues/15641 | 10 Nov 2026 | P, measured |
| 58 | Ollama load-time measurements | https://bmdpat.com/blog/ollama-load-duration-local-llm-benchmark-2026 | 30 Aug 2026 | P |
| 59 | llama.cpp speed tables | https://github.com/ggml-org/llama.cpp/discussions/4167 | updated to 30 Aug 2026 | P, many users' own measurements |
| 60 | Anthropic, statistics for model evaluations, arXiv 2411.00640 | https://arxiv.org/abs/2411.00640 | Nov 2024 | M; older |
| 61 | nilenso, a SWE-bench Pro comparison | https://blog.nilenso.com/blog/2026/04/08/checking-my-model-vibes-against-swe-bench-pro/ | 8 Apr 2026 | P |
| 62 | Run-to-run variance on SWE-bench Verified, arXiv 2602.07150 | https://arxiv.org/abs/2602.07150 | 6 Feb 2026 | I |
| 63 | UserSWE, arXiv 2610.29822 | https://arxiv.org/abs/2610.29822 | 21 Oct 2026 | I |
| 64 | SWE-chat, arXiv 2604.20779 | https://arxiv.org/abs/2604.20779 | 22 Apr 2026 | I |
| 65 | Aider polyglot benchmark | https://aider.chat/2024/12/21/polyglot.html | 21 Dec 2024 | M; older |
| 66 | SWE-bench Pro | https://github.com/scaleapi/SWE-bench_Pro-os | read 17 Nov 2026 | I |
| 67 | Harbor's OpenCode adapter | https://github.com/laude-institute/harbor/blob/main/src/harbor/agents/installed/opencode.py | read 17 Nov 2026 | I |
| 68 | Anthropic, "The advisor strategy" | https://claude.com/blog/the-advisor-strategy | 9 Apr 2026 | M |
| 69 | OpenRouter, prompt-caching guide | https://openrouter.ai/docs/guides/best-practices/prompt-caching | read 17 Nov 2026 | M |
