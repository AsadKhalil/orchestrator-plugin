# Relay

**Relay picks the right model for each message in OpenCode.** You choose models for three kinds of work, Plan, Execute and Review, once. Then you type `/relay <message>`, or turn Relay on for a chat. A small decision model reads the message, picks the kind of work and the model that fits it, switches the chat to that model, and sends your message. The answer appears in the same chat.

> Relay is early. It is built for OpenCode 2.3.0. It has run against tests, an isolated OpenCode with a mock model, and one live check in a full OpenCode Desktop setup on Windows with real models (16 Nov 2026). See [Status](#status).

(The package and its internal ids are still named `feature-pilot`. That is on purpose: renaming them would lose saved settings.)

## Why use it

- **The right model, message by message.** Use a strong reasoning model for design and planning, a fast or cheap one for small edits, and a careful one for reviews. Relay switches for you.
- **Your own words decide.** Each model in a mode can have a "use it for" line, such as "small, quick edits" or "security reviews". The decision model matches your message to those lines. It never sees model names or prices.
- **Checks of work run on your Review model.** When a model starts a helper (an OpenCode subagent) to check work, Relay gives that helper your Review model and rules that make a review end: a verdict every time, and at most three checks.
- **Small, quick decisions.** A decision is one small request to a decision model. With OpenCode's free `opencode/jev-1.13-free`, a decision took about 0.13 seconds in testing (about 1.2 seconds for the first one after OpenCode starts), and OpenCode reported a cost of $0.
- **Your message is safe.** It is sent once and unchanged. If anything goes wrong while choosing, it still goes to the chat's current model. Relay never stores the text of your messages.
- **Measured, not promised.** On 30 labelled example messages, the decision model picked the right kind of work 30 times out of 30, and the expected model 29 times (the labels were written by the author). No cost savings have been measured.

## Install

You need OpenCode 2.3.0 (Desktop or the terminal app), and Node.js 24 with npm and git to build Relay.

1. Get Relay and build it:

   ```sh
   git clone https://github.com/AsadKhalil/orchestrator-plugin.git
   cd orchestrator-plugin
   npm ci
   npm run build
   ```

2. Tell OpenCode to load it. Open OpenCode's global config file, `~/.config/opencode/opencode.json` (on Windows, `C:\Users\<you>\.config\opencode\opencode.json`; create it if it does not exist), and add the folder you cloned to `plugins`:

   ```json
   {
     "plugins": ["/full/path/to/orchestrator-plugin"]
   }
   ```

   On Windows, write the path with forward slashes, for example `"C:/Users/you/code/orchestrator-plugin"`. Keep any plugins that are already in the list.

3. Restart OpenCode. (Desktop usually picks up a change to this file by itself within a minute.)
4. Check: type `/` in a chat. `/relay` should be in the list.

To update later: `git pull`, `npm ci`, `npm run build`, then restart OpenCode.

## Set up (once, in OpenCode Desktop)

1. Open a chat, open the command palette (Ctrl+K) and run **Open Relay**. The Relay panel opens on its **Modes** tab.
2. Add models to **Plan**, **Execute** and **Review**. When a mode has more than one model, write a short "use it for" line for each, for example "hard design and architecture" or "small, quick edits".
3. Choose a **decider**: a decision model. OpenCode lists the ones you can use; `opencode/jev-1.13-free` is free.
4. Type a sample message in the test box and press **Try** to see what Relay would pick.

The settings are shared by all your projects. The terminal app has no settings screen, so set them up in Desktop.

**If Open Relay is missing:** it shows only while a chat is open. Then check Settings → Extensions → Plugins: `feature-pilot` should be listed with **Reload** and a switch. If that list stays empty, or Desktop says it can't reach your computer, OpenCode's background service is not running properly and Desktop shows no plugin panels. Quit Desktop, end `opencode-cli.exe` (the one started with `serve --service`) in Task Manager, and start Desktop again.

## Use

| You type | What happens |
|---|---|
| `/relay <message>` | Relay picks the mode and the model for this one message, switches the chat, and sends it. |
| `/relay on` | Every message you send in this chat goes through Relay, without typing `/relay`. |
| `/relay off` | This chat goes back to normal. |

- In Desktop, the **Relay pill** above the chat box shows whether Relay is on for that chat. Click it to turn Relay on or off there, and to see the last choice.
- OpenCode shows a "Switched to …" line in the chat when Relay changes the model.
- Plan and Review use OpenCode's `plan` agent, which is meant for reading and planning, not editing. Only Execute uses `build`, which can change files.
- When the decision model is not sure (under 60%), `/relay` uses Plan. With `/relay on`, the chat stays as it is.
- In the terminal app, `/relay`, `/relay on` and `/relay off` work the same way. There is no pill there, and `/relay on` prints nothing.

## What leaves your machine

To choose, Relay sends the decider's provider your message text (at most 4,000 characters), the names and sizes of attached files (not their contents), how many pictures are attached, whether the chat's agent can change files, and your "use it for" lines. It never sends file contents, pictures, earlier messages, model names or prices. When a model starts a helper, the helper's task text is sent the same way; that text is written by the model and may quote code or chat content you do not see.

OpenCode makes every request, with your OpenCode login. Relay never sees your API keys.

## Status

- **Ran on a real OpenCode 2.3.0, isolated, with a mock model (Windows):** the plugin loads; `/relay` is registered; with no decider, a message goes once to the chat's own model; `/relay on` makes each message go through Relay once, and `/relay off` stops it. In throwaway checks, a model or agent switch made as a message is sent served that same message.
- **Ran against a real decision model:** 30 made-up messages, twice, with `opencode/jev-1.13-free` from an isolated OpenCode with no login.
- **Ran in a full OpenCode Desktop setup (Windows, Ollama Cloud models, 16 Nov 2026):** the Modes tab and its Try box; `/relay` placing messages on the Plan, Execute and Review models; the pill and `/relay on` turning the switch on and off; plain messages with the switch on (placed) and off (left alone); a helper that checks work starting on the Review model. This check found and fixed one bug: after a Plan answer, a clear "fix …" request was judged unsure and stayed on Plan.
- **Not yet run in a full setup:** pictures and attached files, the interactive terminal app, macOS and Linux, and the install steps above followed by a new user.

Details are in the [compatibility findings](docs/compatibility.md) and the [change log](docs/implementation-progress.md).

Known limits:

- Decision requests are not counted against any budget.
- With `/relay on`, a chat that is busy answering is not switched; the new message goes to the model already in use. `/relay` waits up to two minutes for a busy chat.
- A file's size is guessed at four bytes per token, so a file close to a model's limit can still be too big for it.
- Plan and Review rely on OpenCode's `plan` agent not editing. Another plugin can change that: in the live check, with the Plannotator plugin installed, a Plan turn submitted a plan and then edited a file.

## The older pipeline

This repo also holds an earlier, unfinished workflow: plan, implement and review a whole feature from the side panel, with spending limits and draft pull requests. It is not the product. The panel's Run, Spend and More tabs belong to it. It has run end to end once, on OpenCode 2.2.7 with real Ollama Cloud models, and otherwise only against fakes. Its coder can change files and run commands with your account's permissions; it is off until you turn on `coderEnabled`, and you should only do that in a throwaway project. Its design is in [docs/opencode-feature-pilot-design.md](docs/opencode-feature-pilot-design.md) and [docs/opencode-feature-pilot-plan.md](docs/opencode-feature-pilot-plan.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The four checks:

```sh
npm ci
npm run typecheck
npm test
npm run build
node scripts/check-package.mjs
```

## License

[MIT](LICENSE)
