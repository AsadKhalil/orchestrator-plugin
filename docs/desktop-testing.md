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

## End-to-end run checklist (not yet performed on a real host)

Everything below is **unverified**: the run workflow has only been exercised against fakes of the host. Use a throwaway profile, a throwaway git repository with one commit, and a model/provider you are willing to spend a few cents on. Do not use a working profile.

1. Policy: enter a rate card for one planner, one coder and one reviewer route (reviewer from a different vendor than the other two), set a small monthly and feature budget, and leave `coderEnabled` off. Atomic host storage is required for budgets; stock 2.2.7 refuses every owned request without it.
2. Start a feature and press Run. Expect: a planner session, then clarification questions or a plan awaiting approval, and no file changes. If the run pauses, the panel shows the attention reason; record it.
3. Approve the plan. With `coderEnabled` off, expect a pause with `coder_not_enabled` and **no** coder session. Check the OpenCode session list to confirm.
4. In the disposable project only, turn `coderEnabled` on and Resume. Expect an isolated worktree at `<project>.feature-pilot/<run id>`, a coder session limited to that directory, validation commands run through the shell tool, then a reviewer session from the other vendor. Confirm the project's own checkout was never modified, and check whether a project-level deny rule (for example on `edit`) is overridden by the coder session; record the result either way, because it decides whether the coder can ever be enabled safely.
5. Press Stop while the coder is running. Expect the session to be interrupted and the run to end `cancelled`. Record whether any shell process survived.
6. Compare the host's own usage for the run with the reservations listed by `listReservations`. Settle one with the provider's own charge record and confirm the budget view changes.
7. Record what you saw in `docs/compatibility.md` with the host version. Nothing here counts as verified until it is written down there.
8. Delivery (use a throwaway GitHub repository you own, `gh` signed in, never a real project): in the panel's Delivery section authorize `origin` and the exact URL `git remote get-url origin` prints, then accept a finished run and publish. Expect one branch named `<prefix><first 12 characters of the run id>` and one **draft** pull request, nothing merged. Press publish again and expect the same pull request to be reused. Check the pull request text for anything you would not want public.
9. Crash recovery: while a coder or reviewer session is running, close OpenCode, reopen it and Resume. Expect the finished session to be reused (no second prompt in the session list), or a pause with `coder_turn_unresolved`/`reviewer_turn_unresolved` if the host cannot say whether it finished. Record what `readStage` reported for a session that was still generating.
10. Stop during validation: start a validation command that sleeps, press Stop, and record both how fast the run ends `cancelled` and whether the sleeping process survived.
