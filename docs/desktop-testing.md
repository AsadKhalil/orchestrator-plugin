# Desktop smoke test

The user launched the isolated profile; its service failed because port 49374 was already used by the normal OpenCode service. The isolated `config/opencode/service.json` was then set to port 49375. On a later launch the isolated Desktop log reported its service ready on 127.0.0.1:49375; the service log reports loading the local plugin server entry. Computer use still selects the user's existing OpenCode window, so the test panel has not been inspected. No normal-profile service settings were changed.

This is a development checklist, not a release claim. Do not install this unfinished plugin into a working profile or use paid credentials.

OpenCode's [GUI plugin documentation](https://opencode.ai/docs/build/plugins/gui/#where-gui-entries-load) says Desktop loads GUI entries from its own background server and recommends global `opencode.json(c)` configuration. A plugin configured only in one project can load on that project's server without its panel appearing in Desktop. The browser client used in the isolated web probe listed the server plugin but did not show the GUI command; it does not establish Desktop compatibility.

The locally installed 2.2.7 Desktop executable contains an `OPENCODE_DESKTOP_TEST_ROOT` development mechanism that sets isolated XDG and Electron data directories. This is an implementation detail, not a documented stable public API. Validate isolation and the selected background server before using any test profile; keep it separate from the user's existing running Desktop and accounts.

To complete the host gate in an isolated profile:

1. Configure the built local plugin in that profile's global `config/opencode/opencode.json`. Use a disposable project and synthetic provider; do not copy credentials from the user's normal profile.
2. Start an independent Desktop instance with its test root and verify its server/config paths point to the disposable profile.
3. Open a session, invoke **Open Feature Pilot** from the command palette, and verify panel loading, keyboard navigation, screen-reader labels, narrow width, long names, loading and error states.
4. Select and remove planner, coder and reviewer variants; restart the isolated server and verify the selection remains scoped to the test project. Open a second window and check conflict/reload behavior.
5. Exercise the opt-in price refresh. Confirm unknown and conditional prices are labelled, and that the action makes no model request. Record any failures in `compatibility.md`.

Additional required gates include real permissions, cancellation, reconnect and the rest of the workflow described in the plan. A successful panel smoke test alone is insufficient for release.

The isolated test profile for this workspace is prepared at `work/desktop-isolated`, with a disposable Git project and a global configuration pointing at the local build. After the Mac was unlocked, the computer-use tool refused access to iTerm for safety, so the test instance was not launched by the assistant. A user may launch the prepared profile manually; verify its test-root/server paths before opening or modifying any project. The normal OpenCode profile was not changed.
