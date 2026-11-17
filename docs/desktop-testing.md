# Checking Relay in OpenCode Desktop

The tests and the smoke cover the server side. The panel and the pill exist only in Desktop, and a real decision needs a decision model, so some checks need Desktop itself.

- **In your own Desktop.** Point your global `opencode.json` at your build (see the README), restart Desktop, open a chat and run **Open Relay** from the command palette. Use a throwaway project, because Execute can change files. `opencode/jev-1.13-free` is a free decider; a paid decision model costs about a cent for 40 decisions.
- **Driving Desktop from a script.** Desktop 2.3.0 accepts Chromium's `--remote-debugging-port=<port>` switch and binds it to 127.0.0.1. Quit Desktop first (it allows one instance), start it with the switch, and connect with Playwright's `chromium.connectOverCDP('http://127.0.0.1:<port>')`. The page is `oc://renderer/index.html`, the command palette is Ctrl+K, and the chat box is the `[contenteditable=true]` element. Desktop passes its environment to the background service it starts, so start it from a clean shell. Quit and restart Desktop normally afterwards, so the port is closed.
- **From Git Bash,** a command argument that starts with `/relay` is turned into a Windows path. Set `MSYS_NO_PATHCONV=1`, and read the chat box back before pressing Enter.
- **`opencode run "/relay on"` does not run the command:** it sends the text to the model as a plain message. Slash commands belong to the interactive terminal app and to Desktop.
- **If the panel, "Open Relay" or Settings → Extensions → Plugins is empty,** Desktop's background service may have failed to start and been left that way; see the README. Desktop's own log is under `%APPDATA%/ai.opencode.desktop/logs/` on Windows.

Record what you saw in `docs/compatibility.md`: the platform, the OpenCode version, what you did and what you did not test.
