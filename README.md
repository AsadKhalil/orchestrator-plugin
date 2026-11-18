# Relay

**Relay picks the right model for each message in OpenCode.** You choose models for three kinds of work, Plan, Execute and Review, once. Then you type `/relay <message>`, or turn Relay on for a chat. A small decision model reads the message, picks the kind of work and the model that fits it, switches the chat to that model, and sends your message. The answer appears in the same chat.

> Relay is early. It is built for OpenCode 2.3.0. It has run against tests; in an isolated OpenCode with a mock model, on Linux, macOS and Windows, on every push; and in live checks in a full OpenCode Desktop setup on Windows, with Ollama Cloud models (16 Nov 2026) and Claude models (17 Nov 2026). See [Status](#status).

The package is `relay-opencode`. Until 17 Nov 2026 it was called `feature-pilot`; settings saved under that name are not carried over.

## Why use it

- **The right model, message by message.** Use a strong reasoning model for design and planning, a fast or cheap one for small edits, and a careful one for reviews. Relay switches for you.
- **Your own words decide.** Each model in a mode can have a "use it for" line, such as "small, quick edits" or "security reviews". The decision model matches your message to those lines. It never sees model names or prices.
- **Checks of work run on your Review model.** When a model starts a helper (an OpenCode subagent) to check work, Relay gives that helper your Review model, even if the model that starts it asked for another one, and rules that make a review end: a verdict every time, and at most three checks.
- **Small, quick decisions.** A decision is one small request to a decision model. With OpenCode's free `opencode/jev-1.13-free`, a decision took about 0.13 seconds in testing (about 1.2 seconds for the first one after OpenCode starts), and OpenCode reported a cost of $0.
- **Your message is safe.** It is sent once and unchanged. If anything goes wrong while choosing, it still goes to the chat's current model. Relay never stores the text of your messages.
- **Measured, not promised.** On 30 labelled example messages, the decision model picked the right kind of work 30 times out of 30, and the expected model 29 times (the labels were written by the author). No cost saving has been measured yet; [When Relay saves money](#when-relay-saves-money) says what to expect.

## Install

You need OpenCode 2.3.0 (Desktop or the terminal app), and Node.js 24 with npm and git to build Relay.

1. Get Relay and build it:

   ```sh
   git clone https://github.com/AsadKhalil/relay-opencode.git
   cd relay-opencode
   npm ci
   npm run build
   ```

2. Tell OpenCode to load it. Open OpenCode's global config file, `~/.config/opencode/opencode.json` (on Windows, `C:\Users\<you>\.config\opencode\opencode.json`; create it if it does not exist), and add the folder you cloned to `plugins`:

   ```json
   {
     "plugins": ["/full/path/to/relay-opencode"]
   }
   ```

   On Windows, write the path with forward slashes, for example `"C:/Users/you/code/relay-opencode"`. Keep any plugins that are already in the list.

3. Restart OpenCode. (Desktop usually picks up a change to this file by itself within a minute.)
4. Check: type `/` in a chat. `/relay` should be in the list.

To update later: `git pull`, `npm ci`, `npm run build`, then restart OpenCode.

## Set up (once, in OpenCode Desktop)

1. Open a chat, open the command palette (Ctrl+K) and run **Open Relay**. The Relay panel opens beside the chat.
2. Add models to **Plan**, **Execute** and **Review**: press **+ Add a model** under a mode. A table lists the models OpenCode offers you, with the price per million tokens (input / output), the context size and the intelligence index. Type in the search box to find one by its name or its provider, narrow the table to one provider, or sort it by price (cheapest first), by context (largest first) or by index (highest first). Press **Add** on a row. Each chosen model has a menu for its effort (low, high and so on) when the model offers them. The prices come from OpenCode's own model catalog, which OpenCode fills from [models.dev](https://models.dev); Relay asks nothing of its own. "not listed" means OpenCode has no price for that model (on 17 Nov 2026 every model of the `claude-agent` provider), and "$0 or not listed" means the catalog says 0, which can be either. The index is the Artificial Analysis Intelligence Index, taken from OpenRouter's public model list. For a model with efforts, it is the score at its highest effort, and a lower effort scores less (GPT-6.2 Sol: 57 at max, 41 at low). The price per token is the same at every effort, but a higher effort writes more tokens, so each reply costs more. "—" means Relay could not match the model. Hover over a number to see which model it came from. See [data sources](docs/data-sources.md). When a mode has more than one model, write a short "use it for" line for each, for example "hard design and architecture" or "small, quick edits".
3. Choose a **decider**: press **+ Choose a decider** and **Use** on a row. The table lists only the decision models OpenCode offers you; `opencode/jev-1.13-free` is free. **Change the decider** opens it again, and × removes the decider. Until you choose one, the panel and the pill warn you: without a decider, Relay switches nothing.
4. Type a sample message in the test box and press **Try** to see what Relay would pick.

**Recent choices** at the bottom of the panel lists the last 20 decisions, for chats and helpers, and updates by itself. Once the chat has answered a message, its row also says what the first request of the reply took: the tokens read new, the tokens read from a cache, the cost OpenCode worked out (when the model has a listed price), the seconds until the first word, and how many requests the whole reply made. A switch to another model shows up there as a large "read new" number.

The settings are shared by all your projects. The terminal app has no settings screen, so set them up in Desktop.

**If Open Relay is missing:** it shows only while a chat is open. Then check Settings → Extensions → Plugins: `relay-opencode` should be listed with **Reload** and a switch. If that list stays empty, or Desktop says it can't reach your computer, OpenCode's background service is not running properly and Desktop shows no plugin panels. Quit Desktop, end `opencode-cli.exe` (the one started with `serve --service`) in Task Manager, and start Desktop again.

## Use

| You type | What happens |
|---|---|
| `/relay <message>` | Relay picks the mode and the model for this one message, switches the chat, and sends it. |
| `/relay on` | Every message you send in this chat goes through Relay, without typing `/relay`. |
| `/relay off` | This chat goes back to normal. |

- In Desktop, the **Relay pill** above the chat box shows whether Relay is on for that chat. Click it to turn Relay on or off there, and to see the last choice. With no decider chosen it reads **Relay on · no decider**, and its menu opens the Relay panel.
- OpenCode shows a "Switched to …" line in the chat when Relay changes the model, and Desktop's model picker follows Relay's choice.
- Plan and Review use OpenCode's `plan` agent, which is meant for reading and planning, not editing. Only Execute uses `build`, which can change files.
- When the decision model is not sure (under 60%), `/relay` uses Plan. With `/relay on`, the chat stays as it is.
- In a long chat, a move to a cheaper model of the same mode is made only when it pays, and a model the chat no longer fits is not used. See [When Relay saves money](#when-relay-saves-money).
- In the terminal app, `/relay`, `/relay on` and `/relay off` work the same way. There is no pill there, and `/relay on` prints nothing.

## When Relay saves money

No saving has been measured yet. This section is arithmetic on list prices, plus what one check on an isolated OpenCode with mock models showed. The working is in `docs/research/2026-11-17-relay-cost-and-model-choice.md`.

**A switch to another model has a price.** A provider keeps a cache of the chat for each model. A model that has not seen the chat reads all of it at full price on its first request, and the model you left loses its cache after a few minutes (five with Anthropic, unless a longer time is set). A change of mode on the same model has no such price. In the check, a move between Plan and Execute, the review rules and another effort all left the start of the request as it was; only a change of model did not (18 Nov 2026, OpenCode 2.3.0 with a mock model, so what was seen is the request, not a real cache).

So Relay saves when there is little to read again, or when the other model is far cheaper:

- a new chat, or a chat that has been idle longer than the cache lasts;
- a provider that has no cache;
- a model about seven times cheaper or more. On paper that pays within one to four requests.

It does not save when a long chat moves to a model that is only about twice cheaper, for one question or one small fix. On paper such a move pays only after 6 to 18 requests on the cheaper model.

**What Relay does about it** (since 18 Nov 2026):

- **A step down happens only when it pays.** When your line picks a cheaper model of the same mode, Relay works out what reading the chat again would cost, and what the cheaper model would save over the next requests. It moves the chat only if the saving is at least one and a half times that cost. Otherwise the chat's model stays for that message, the mode still sets the agent, and Recent choices says why. A step up to a dearer model is always made: your line asked for it.
- **The whole chat must fit.** A chat is moved to a model only when the chat so far, with the attached files, fits that model with the room OpenCode keeps free before it compacts a chat.
- **Recent choices shows what each reply took**, so you can see what a switch cost.

The check uses OpenCode's listed prices and a few guesses: a cache that lasts five minutes, 1,500 new tokens in and 500 out for each coming request, and 6 requests for a line until three replies of that line are on record. With no listed price (a plan, a local model, "$0 or not listed") there is no cost check, and your line is followed.

**What you can do:**

- **In a long chat, use `/relay` at clear points** instead of leaving Relay on: at the first message, and when a plan is approved and the building starts. With Relay on, every message can move the chat.
- **Ask for checks through a helper.** Ask the model to have a helper (a subagent) check the work. A helper is a chat of its own, so nothing is read again and your chat keeps its cache. Relay gives a helper that checks work your Review model.
- **Try one model at two efforts first.** Choose the same model for all three modes, with a higher effort for Plan and Review and a lower one for Execute. The model does not change, so the chat is not read again. Two cautions: a lower effort can do worse work, and on one provider's route an effort change itself was reported to lose the cache in OpenCode 2.3.0.

## What leaves your machine

To choose, Relay sends the decider's provider your message text (at most 4,000 characters), the names and sizes of attached files (not their contents), how many pictures are attached, whether the chat's agent can change files, and your "use it for" lines. It never sends file contents, pictures, earlier messages, model names or prices. When a model starts a helper, the helper's task text is sent the same way; that text is written by the model and may quote code or chat content you do not see.

To weigh a move and to show what a reply took, Relay reads the chat's token counts, costs and times from OpenCode on your machine. It keeps them with its last 20 records in OpenCode's plugin storage and sends them nowhere.

To show the intelligence index, Relay downloads OpenRouter's public model list, at most once a day. It sends no key and nothing about you or your models.

OpenCode makes every model request, with your OpenCode login. Relay never sees your API keys.

## Status

- **Ran on a real OpenCode 2.3.0, isolated, with a mock model (Linux, macOS and Windows, in GitHub's checks on every push):** the plugin installs from its package and loads; `/relay` is registered; with no decider, a message goes once to the chat's own model; `/relay on` makes each message go through Relay once, and `/relay off` stops it. In throwaway checks, a model or agent switch made as a message is sent served that same message.
- **Ran against a real decision model:** 30 made-up messages, twice, with `opencode/jev-1.13-free` from an isolated OpenCode with no login.
- **Ran in a full OpenCode Desktop setup (Windows, Ollama Cloud models, 16 Nov 2026):** the Modes tab and its Try box; `/relay` placing messages on the Plan, Execute and Review models; the pill and `/relay on` turning the switch on and off; plain messages with the switch on (placed) and off (left alone); a helper that checks work starting on the Review model. This check found and fixed one bug: after a Plan answer, a clear "fix …" request was judged unsure and stayed on Plan.
- **Ran in a full OpenCode Desktop setup with Claude models (Windows, 17 Nov 2026):** six plain messages with Relay on, each answered by its mode's model (Sonnet for Plan and Review, Haiku or Sonnet for Execute by their "use it for" lines); a review cycle that found a planted bug on the first check and approved the fix on the second; `/relay` with an @-mentioned file and an @-mentioned picture; a pasted picture with Relay on; a busy chat; and the panel's prices, Cheapest first, Recent choices and warning. It found and fixed two problems with Desktop: its model picker did not follow Relay's switches, and pasted pictures were not counted.
- **The install steps above, followed from a fresh clone of this repository in a throwaway OpenCode profile (Windows, 17 Nov 2026):** OpenCode loaded Relay and `/relay on` worked in a new chat.
- **Not yet run in a full setup:** the interactive terminal app, and Relay with a real decision model on macOS and Linux.
- **The model table (17 Nov 2026), in a plain browser page that runs the panel's real code with a fake OpenCode:** search, the provider filter, the three orders, Add, adding a model again with another effort, and the effort menu all did what they should. Not yet seen in Desktop itself.
- **The decider's table, and checks from helpers that name a model (17 Nov 2026):** the decider is picked from the same kind of table, checked in the same plain page. A helper whose task is a check now goes to the Review model even when the calling model names another; tests cover it, and it has not run in a live chat yet.
- **The intelligence index (18 Nov 2026):** a real OpenCode 2.3.0 with no login fetched OpenRouter's list through Relay, matched 4 of its 11 free models, and used its stored copy on the next call. The tables were checked in the plain page. Not yet seen in Desktop.
- **What a reply took, the whole chat's fit, and stay or go (18 Nov 2026):** ran on a real OpenCode 2.3.0, isolated, with mock models and a mock decision model, on Windows. `/relay` switched the agent and the model. Each record got what its reply took once the chat had answered, also for a plain message with Relay on and for a reply of two requests. A model the chat no longer fitted was not offered. A step down that did not pay left the chat on its model, with the reason in the record. Every amount was what the mock reported, so no real cost and no real cache has been seen. Not yet run: real models, the paid stages of the cost test, the new line in Desktop's panel, and macOS and Linux.
- **Renamed on 17 Nov 2026:** the package, the plugin id and the GitHub repository are now `relay-opencode` (they were `feature-pilot` and `orchestrator-plugin`; the old repository address forwards to the new one). The renamed package passed the isolated real-host check on Windows.
- **Removed on 17 Nov 2026:** the older feature pipeline in the side panel (the Run, Spend and More tabs). Anything it saved is left in place and ignored.

Details are in the [compatibility findings](docs/compatibility.md) and the [change log](docs/implementation-progress.md).

Known limits:

- Decision requests are not counted against any budget.
- The cost check is arithmetic on listed prices and the guesses named in [When Relay saves money](#when-relay-saves-money). It has not been checked against a provider's bill. It takes a cache to last five minutes: with a longer cache time set in OpenCode, Relay still moves a chat that was idle for five minutes without a cost check.
- The cost check weighs only a move between two models of the same mode. When the chat's model is not one of the new mode's models, for example Plan on one model and Execute on another, the chat moves as before.
- What a reply took is read when the chat goes idle. A reply that was stopped, or a message that was taken back, shows nothing.
- With `/relay on`, a chat that is busy answering is not switched; the new message goes to the model already in use. `/relay` waits up to two minutes for a busy chat.
- A file's size is guessed at four bytes per token, so a file close to a model's limit can still be too big for it.
- In Desktop, a picture pasted into a `/relay` message is lost before Relay sees it: OpenCode gives a command only the text and @-mentioned files. @-mention the picture instead, or paste it into a plain message with Relay on.
- Desktop sends its own agent with every message, and a plugin cannot change it. So the message after a one-off `/relay` to Plan or Review runs on Build, with the model Relay picked. With `/relay on`, every message is placed again.
- A helper that continues an earlier helper keeps that helper's model.
- Plan and Review rely on OpenCode's `plan` agent not editing. Another plugin can change that: in the live check, with the Plannotator plugin installed, a Plan turn submitted a plan and then edited a file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The four checks, which GitHub also runs on every push:

```sh
npm ci
npm run typecheck
npm test
npm run build
node scripts/check-package.mjs
```

## License

[MIT](LICENSE)
