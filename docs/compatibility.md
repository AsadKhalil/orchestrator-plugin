# OpenCode compatibility evidence

## 2026-11-11 — server package smoke test

- macOS; `/Applications/OpenCode.app` bundle version 2.2.7; bundled CLI `opencode v2.2.7`.
- Packed `feature-pilot@0.0.0`, installed its tarball in a disposable project, and started the bundled server on loopback with separate XDG config/data/cache/state directories.
- A bare `feature-pilot` config entry attempted a public npm registry install and failed because the package is unpublished. A local package-directory entry `./node_modules/feature-pilot` loaded successfully.
- After reload, `/api/plugin` listed `feature-pilot` as `active`, source `local`, with `server: true`. No model request was made. The disposable server was stopped after the check.
- This proves only server entry loading of the packed artifact. The plugin entry is inactive; no host adapter, permissions, storage, GUI, model selection, spending controls or workflow were exercised. Desktop UI compatibility remains untested.

## 2026-11-11 — adapter persistence smoke test

A disposable local fixture loaded the packed adapter into the real 2.2.7 server. It called `prepareStage` with a synthetic model identity, creating a session without sending a prompt. After stopping and restarting the same isolated server, the fixture retrieved its stored session ID and `ownsSession` returned true for the original run. The fixture and data were confined to the disposable smoke project; the server was stopped.

This validates the session-create and plugin-storage round trip only. It does not validate model availability, variant propagation to an inference request, permission enforcement, unrelated-session protection, GUI or budget gates. The attempted generic session API inspection was inconclusive and is not evidence of those properties.

## 2026-11-11 — owned-session interrupt smoke test

With the updated adapter in the disposable 2.2.7 host fixture, the adapter rejected a wrong run ID and forwarded the authorized interrupt for the previously created owned session. The host returned `interrupted: false` because that session was idle. This confirms the API call shape and local ownership check for this case, not cancellation of a running inference or process. The server was stopped.

## 2026-11-12 — model inventory smoke test

The project-scoped inventory adapter returned 13 model records from an isolated 2.2.7 host and no top-level provider settings. A separately configured synthetic provider did not appear in the available inventory; its availability needs further investigation. The host's raw model records can contain provider settings (including API keys), so the adapter projects only explicit display fields and variant IDs. Unit tests cover credential omission from model and variant settings. This does not establish provider account access, live pricing, benchmark scores, or model-call eligibility. The server was stopped.

## 2026-11-12 — custom provider initialization

With a synthetic environment credential configured, the custom `smoke/model-one` was absent when the fixture queried during plugin setup but appeared enabled and active in a later `/api/model` response after host initialization. The adapter reads inventory on each call; callers must not treat an early startup snapshot as final. This does not isolate whether adding the environment credential was necessary, and no request was sent to the dummy endpoint. The server was stopped.

## 2026-11-12 — model variant and permission assertions

A disposable provider declared `smoke/model-one#high`, with a dummy local endpoint and synthetic credential. After host initialization, the adapter rejected a nonexistent variant, created an owned planner session for `high`, and `ctx.session.get` returned the exact provider, model and variant with the deny-all session rules. No inference request was sent. OpenCode's `ctx.permission.assert` rejected `edit`, `shell`, `subagent`, `browser`, `execute`, and a synthetic MCP write action for that session. The host was stopped.

These are permission API assertions, not end-to-end attempts through actual tools or subagents. The current deny-all placeholder also blocks useful planning and coding operations. Request-level variant propagation, budget reservation, tool bypass attempts, GUI and active cancellation remain unverified.

## 2026-11-12 — permission precedence limitation

In a disposable 2.2.7 host, a project `permissions` rule denied `read` for `secret.txt`; a session with deny-all followed by `read:* allow` was nevertheless allowed to read that resource according to `ctx.permission.assert`. Adding a project `policies` rule denying `tool.use` for `read:secret.txt` caused that same assertion to be denied. A separate normal read and glob were allowed; edit was denied. This distinguishes ordinary permission-rule precedence from the separate hard policy layer. The server was stopped.

Consequently, adding broad session allow rules would silently override ordinary project denials. Do not enable role profiles until the implementation preserves existing effective project/user permission decisions as well as hard policies and verifies actual tool execution paths. The reproducible probe is in `tests/fixtures/permission-precedence`; it is not part of the shipped plugin. The exact host integration needed to combine rules without privilege escalation remains under investigation.

## 2026-11-12 — deny-only hook investigation

A disposable-host permission hook changed disallowed actions to `deny` without granting allowed actions. It denied edit, shell, subagent and a synthetic MCP action, while a session-specific read denial remained denied. Crucially, a baseline session without the hook also allowed the `secret.txt` read despite the project permission rule used in the earlier probe. Thus the earlier observation does not establish that the plugin alone caused that project's denial to be overridden; the host's effective baseline must be accounted for. A hard policy denial was independently shown to block the action. No actual tool execution or bypass test was performed.

An isolated deny-only evaluator is implemented and unit tested, but is not registered in the plugin or used for session creation. It cannot remedy an already permissive host baseline, and no coder profile is enabled. Do not replace the deny-all placeholder until ownership, hook lifecycle, baseline permissions and actual tool paths have been verified.

## 2026-11-12 — role persistence

A disposable 2.2.7 server created an owned reviewer session using the updated adapter and returned `reviewer` from its role lookup both immediately and after server restart. No inference was requested. The server was stopped. Hook registration and end-to-end permission enforcement remain unverified.

## 2026-11-12 — registered permission hook

A disposable fixture invoked the built plugin entry point in a real 2.2.7 server, populated plugin-scoped ownership/role records and exercised `ctx.permission.assert`. Read was allowed for an owned planner session, while shell and edit were denied; a separate unowned session's read remained allowed. This is an API assertion test, not an actual tool-call bypass test. The fixture server was stopped.

The hook currently consults plugin storage for every evaluated session. If storage errors, the hook propagates the error because it cannot distinguish an owned session safely; this can also affect unrelated sessions. Resolve that isolation limitation before recommending installation or claiming Task 1 complete. Prepared sessions still have deny-all rules, so this experiment does not enable workflows.

## 2026-11-12 — cached hook restart check

A disposable fixture stored a planner session's ownership and role before starting the built plugin entry point. The 2.2.7 host loaded the storage scan and denied shell/edit while leaving read allowed. After a server restart, the same saved session had the same outcomes; an unrelated session's read was allowed both times. This uses permission assertions, not actual tool calls, and does not test sessions created by a second plugin instance. The server was stopped.

## 2026-11-12 — shared runtime stage creation

A disposable fixture initialized the built runtime, created a planner session through its shared adapter after the local synthetic model became available, and checked permission assertions. To isolate the hook, the fixture explicitly removed the session's deny-all rules in the disposable host only. The hook allowed read and denied shell/edit both immediately and after restarting the server. No inference request or actual tool execution occurred. Production still creates deny-all sessions. The test fixture is saved under `tests/fixtures/shared-runtime` and the server was stopped.

## 2026-11-12 — actual tool permission probe

A disposable 2.2.7 host fixture created an owned planner session through the shared runtime and removed its deny-all rules in the fixture only to isolate the hook. It invoked OpenCode's registered `shell` and `write` tools through `ctx.tool.list()` with that session context. Both failed with underlying `Permission.BlockedError` for `shell` and `edit` respectively; neither target file was created. A separate unowned control session with a shell allow rule executed `touch` successfully and created its control file in the disposable project. No inference or paid calls were made. The probe is saved in `tests/fixtures/tool-permissions`; the host was stopped.

This verifies two actual tool entry points in the synthetic fixture, not nested execute, browser, MCP, subagent bypasses, coder permissions, organization policy propagation or the full agent loop. Production stages still have deny-all rules.

## 2026-11-12 — delegation probe

The disposable fixture invoked the registered `subagent` tool for an owned planner session; OpenCode returned `Permission.BlockedError` for `subagent`. The tool catalog did not expose `execute` as a directly invocable tool in this fixture. An attempted browser navigation returned `browser.disconnected`, so it did not prove the browser permission boundary. The server was stopped. No inference or paid calls were made.

Nested Code Mode, a connected desktop browser, real MCP tools, full agent-loop behavior and cross-instance synchronization remain unverified.

## 2026-11-12 — local model request

Using a synthetic OpenAI-compatible loopback endpoint and dummy credential, a disposable OpenCode 2.2.7 fixture prepared an owned planner session for `smoke/model-one#high`, then submitted a prompt directly via the host session API. The endpoint received `/v1/chat/completions` with `model: model-one`, `reasoning_effort: high` and streaming enabled. The synthetic response completed, and session context contained the synthetic token usage (10 input, 5 output) and zero cost. Both local servers were stopped; no paid provider was contacted. Fixture sources are in `tests/fixtures/wire-request`.

This establishes one request path and one variant only. It does not prove paid-provider billing accuracy, auxiliary-call coverage, reservations, context limits, streaming deduplication, or a working workflow. The fixture bypasses a future Feature Pilot prompt dispatch method, which is not implemented.

## 2026-11-12 — request interception feasibility

With the 2.2.7 host and a synthetic loopback provider, an `experimental.model.resolve` hook that threw for an owned session ran for `primary`, `generate` and `compaction` requests. The synthetic endpoint received none of those vetoed requests. In a separate untitled session, the hook saw `title` and `primary`; vetoing only `title` allowed the primary request through while no title request reached the endpoint. Both servers were stopped. Fixture sources are in `tests/fixtures/request-hooks`.

This shows veto behavior for these four observed request kinds on one HTTP provider path, not complete budget enforcement. WebSocket, retries, concurrent reservations, provider billing bounds, usage reconciliation and external processes remain untested. The production plugin does not yet register a spending hook.

## 2026-11-12 — fail-closed request guard

The built plugin's model-resolution hook blocked an owned planner's primary synthetic request before it reached a loopback provider. A separate unowned session made a successful control request to the same provider. This fixture uses direct host prompts and is saved under `tests/fixtures/request-guard`; both local servers were stopped.

The guard currently blocks every request for cached owned sessions because cost reservations are not implemented. It is not a working budget mechanism. Title/compaction/generate were unit-tested for this hook and observed with a separate real-host probe, but this production hook's full transport/retry coverage, cross-instance ownership synchronization and billing remain unverified.

## 2026-11-12 — plan storage round trip

A disposable 2.2.7 fixture created and programmatically approved a synthetic plan through the new repository using plugin storage. After stopping and restarting the isolated server, the fixture reopened the record in the `approved` state. This verifies serialization and persistence for the fixture, not user authentication or authorization: the approval was synthetic and no model or code execution occurred. The server was stopped.

## 2026-11-12 — inventory RPC and GUI package

The built server entry registered the read-only inventory RPC in a disposable 2.2.7 host. A local fixture called it and received 14 model records with no top-level settings. The response projection has unit coverage for removing provider and variant secrets. The GUI Vite bundle builds and is included in the npm package dry run. The server was stopped; no paid requests were made.

Desktop panel loading, rendering, project/location routing, accessibility and security across real windows remain untested. This partial view does not select models, provide benchmark scores or pricing, or start features. Existing request and tool guards remain in place.

## 2026-11-12 — session-location inventory routing

Using the external OpenCode 2.2.7 client, calls scoped to two isolated project directories returned the requested directory and each project's distinct synthetic provider. A call before the plugin finished starting failed; retrying after initialization succeeded. The server was stopped. The GUI now uses the mounted session's server and location and rejects a response for another directory. Desktop routing changes and rendering still need an interactive test.

## 2026-11-12 — owned stage read

In an isolated 2.2.7 server with a synthetic loopback provider, `createOpenCodeHost` prepared a planner session; a fixture submitted a prompt directly, waited, then `readStage` returned the session's `succeeded` outcome and assistant message with the selected provider/model/variant, finish reason, and 10 input / 5 output tokens. A wrong run ID was denied before reading. The local provider and server were stopped. The reported zero cost was the host's synthetic configuration, not evidence of a free real provider.

The fixture intentionally bypassed `createRuntime` and its spending guard for a local-only test. This confirms neither production dispatch nor completeness of auxiliary usage, error/retry handling, or billing. Session outcome and message reads are separate calls, not an atomic snapshot. Probe source is in `tests/fixtures/stage-read`.

## 2026-11-12 — stage prompt and wait

The owned host adapter submitted a queued synthetic prompt and waited for an isolated OpenCode 2.2.7 loopback response. The host rejected an ID without its required `msg_` prefix; the adapter now requires that prefix. A separate run using the production runtime returned a failed outcome, and the loopback endpoint saw no second request, consistent with the fail-closed spending hook. Both local servers were stopped.

The test covers one successful local response and one blocked request. Supplying an ID is not proof of idempotent replay or crash recovery; those require separate host tests and durable write-ahead state before the workflow can safely dispatch or retry. No production paid request is enabled by this work.

## 2026-11-12 — completed prompt replay

In a disposable 2.2.7 server using the synthetic loopback provider, resubmitting the same prompt ID to the same session after completion returned success without a second user/assistant message or model request. Submitting different text under the same ID also returned success and retained the original message. Reusing that ID in another session returned `Session.PromptConflictError`. These observations concern a completed request, not simultaneous requests, crashes or distributed hosts. Reproduction fixture: `tests/fixtures/prompt-replay`.

Feature Pilot now writes a prompt-intent record containing a text hash before dispatch and refuses any subsequent use of the same ID for reconciliation. A separate local probe using a fresh adapter saw the existing intent and refused changed text; one loopback request was observed. The queue protects adapters sharing the same storage object in one process only. Cross-instance atomicity and recovery inspection remain unproven, so the spending guard remains enabled. Both local servers were stopped.

## 2026-11-12 — storage concurrency boundary

The installed 2.2.7 plugin storage interface exposes `get`, `set`, `remove`, and `scan`; it exposes no transaction, compare-and-swap, or lock operation. This interface inspection alone does not prove host process/isolate topology or backend atomicity. Prompt intent, run transitions and reservations now each serialize across separate wrappers within one loaded module instance. Synthetic concurrent tests cover shared backends behind separate wrappers. Different module instances, processes or hosts can still race; these queues cannot enforce a global spend limit or safe multi-instance recovery. The request guard remains enabled.

## 2026-11-12 — per-project role selections

An isolated 2.2.7 server accepted the new settings RPC and saved `smoke/model-one#high` for the planner. After restart, the same project returned revision 1 and that selection; a second isolated project returned revision 0 and no selection. The host was stopped. Validation, stale revisions, unavailable choices and same-module concurrent edits have unit coverage. This did not exercise the Desktop panel, multiple app windows, credential changes, or concurrent host processes.

## 2026-11-12 — selected stage boundary

A disposable 2.2.7 host fixture saved a synthetic model/variant for the planner, verified that preparing the same model for an unselected coder role was rejected, and prepared a planner session. No prompt or inference was sent; the server was stopped. The production runtime still blocks owned requests. This checks stage preparation, not changes to selections after preparation, cross-instance atomicity, or native-picker overrides.

## 2026-11-12 — pre-prompt model recheck

In a disposable 2.2.7 host, the runtime prepared a planner stage with `smoke/model-one#high`. Switching the session to the same model's default variant via `session.switchModel` caused the runtime's prompt submission to reject it. Restoring the variant and removing it from planner settings caused submission to be rejected as unselected. No inference was attempted. The fixture is in `tests/fixtures/selected-model`; the server was stopped.

This checks one native switch before a prompt, not a concurrent switch during dispatch or all auxiliary/model-resolution paths. The checks are separate host calls and cannot enforce atomicity against another process. Older owned sessions lacking a saved stage model fail closed. The model-request guard remains enabled.

## 2026-11-12 — OpenRouter catalog RPC

The isolated 2.2.7 host called the opt-in OpenRouter pricing RPC and returned 466 public catalog entries; all were marked ineligible as budget bounds. The underlying live response had conditional overrides, so the panel displays base rates with flags rather than assuming they cover every request. The server was stopped. This tested server RPC and host storage only, not Desktop rendering, provider-specific account prices or a paid request.

## 2026-11-12 — isolated web UI and Desktop profile discovery

An isolated browser connected to a disposable 2.2.7 server showed `feature-pilot` in Extensions → Plugins and created a synthetic empty session. Searching the command palette did not show the GUI command. The [GUI documentation](https://opencode.ai/docs/build/plugins/gui/#where-gui-entries-load) states that Desktop loads GUI entries from its own background server and recommends global configuration; the web observation is not a Desktop panel test. The browser tab and server were closed.

Inspection of the installed 2.2.7 Electron main bundle found an `OPENCODE_DESKTOP_TEST_ROOT` environment variable that redirects XDG and Electron data paths; it is an undocumented implementation detail. The existing normal Desktop was already running. Computer-use access to the terminal was denied, so no isolated Desktop instance or panel was launched through the UI. See `desktop-testing.md` for the remaining checklist. No changes were made to the user's normal Desktop configuration.

## 2026-11-12 — synthetic coder permission profile

A disposable 2.2.7 fixture explicitly granted test-only session permissions and installed the deny-only evaluator with a synthetic coder action profile. Actual `write` and `shell` tool calls succeeded for that coder; the same write was denied for a planner. A coder session with an explicit native edit denial was denied, and an attempted coder subagent was denied even when listed in the synthetic profile. Only the coder's two expected files appeared in the disposable project. No inference occurred and the server was stopped. Fixture: `tests/fixtures/coder-permissions`.

This test does not prove approved-plan path or command scope, nested shell operations, MCP/browser behavior, project permission precedence, process isolation, or cross-instance protection. The production runtime does not supply a coder profile and continues to deny coder actions; created sessions still carry deny-all rules. Do not infer that this synthetic action list is safe to activate for real work.

## 2026-11-12 — approved validation commands

A disposable 2.2.7 server saved a synthetic approved plan containing a validation command, then restored it after restart. No command or inference was executed. The updated run schema requires validation commands; older experimental saved plans without them fail closed and must be recreated rather than silently inheriting approval. The server was stopped.

## 2026-11-12 — native validation tool results

A disposable 2.2.7 fixture used a synthetic session with explicit shell permission. OpenCode's shell tool returned matching structured `output` and `metadata` with `status: completed` and exit 0 for `printf synthetic-ok`, and exit 7 for `exit 7`. The new validation runner invoked those approved synthetic commands and reported passed then failed. The server was stopped; no model inference or real project command was run. Fixture: `tests/fixtures/validation-tool`.

The fixture supplied a constant synthetic diff ID and test-only permissions. It does not prove a real full-worktree identity, safe command authorization, native process termination on timeout, background job cleanup, or trustworthy end-to-end review evidence. The runner is not exposed to production workflows.

## 2026-11-12 — host VCS diff completeness

A disposable Git project on OpenCode 2.2.7 contained a tracked text modification, new text and binary files, an ignored file, and a large new text file. `vcs.diff` with `mode: working` and `untracked: files` returned the tracked modification and new non-ignored files. It represented binary content only as a binary-difference notice. For a one-million-line untracked text file, the returned patch contained only a file header, with no `more` flag; changing the file's content while retaining its line count produced the same patch. Ignored content did not appear. Initial `vcs.status` returned an empty list before eventually reporting changes.

Consequently, the host diff alone is not a reliable whole-worktree content identity, even when `more` is absent. Added a read-only diff adapter that checks project location, compares status snapshots, flags binary or content-less patches and oversized output, and always reports the worktree identity as unverified. A real-host fixture returned the expected binary/content-missing warnings. It does not resolve completeness or guarantee atomicity. The server was stopped; fixtures are under `tests/fixtures/vcs-diff`.

## 2026-11-12 — isolated worktree creation

A disposable 2.2.7 server created a native worktree at an explicitly supplied commit while the source had a tracked modification and an untracked binary. The worktree contained the committed baseline; the source file, binary bytes and Git status remained unchanged. The host returned a generated subdirectory under the requested parent, not the parent itself. The synthetic worktree was removed with `force: false` and the server was stopped.

The reproducible `npm run smoke:worktree` creates its own temporary repository and isolated XDG state, uses a synthetic loopback password and no model calls, then cleans up. Set `FEATURE_PILOT_SMOKE_CLI` to the desired 2.2.7 CLI if `opencode` is not on PATH. This fixture has no project startup script. [OpenCode's API documentation](https://opencode.ai/docs/api) states that worktree creation runs the project's setup script; the plugin must inspect and explicitly authorize that behavior before using the API on real projects. A clean baseline worktree is not a snapshot of subsequent uncommitted changes, and this test does not establish content identity, concurrency safety or Desktop behavior.

## 2026-11-12 — clarification storage

A disposable 2.2.7 plugin fixture created a run with one unanswered synthetic question. After a server restart it restored and answered that question, and after a second restart it restored the answered run in planning state. No inference or user approval occurred; all three servers were stopped. Fixture: `tests/fixtures/clarification-storage`.

## 2026-11-12 — structured plan storage

A disposable 2.2.7 plugin fixture saved and approved a synthetic plan with structured steps and acceptance criteria, then restored the approved record after a server restart. The approval was programmatic for the fixture; no real user approval or inference occurred. The server was stopped. Existing experimental plans using string-only steps do not meet the new schema and fail closed.

## 2026-11-12 — background shell handles and wake-ups

In a disposable 2.2.7 host, the plugin context did not expose `ctx.session.shell`, although the external client has that method. The native `shell` tool accepted a fixed synthetic command with `background: true`, returned a `running` result with a shell ID, and emitted `shell.created` and `shell.exited` events for the same ID; the exit event carried status `exited` and code 0. A fixture persisted the intent, native handle and exit event as a successful synthetic job. Its model-resolution hook also observed one `primary` request triggered during completion and blocked it before inference. Thus background completion can wake a session and incur a model request; a no-cost wake-up must not be assumed. Fixture: `tests/fixtures/background-shell`.

This is one short local command with test-only permissions and a synthetic content version. Shell events are ephemeral; event loss, replay after reconnect, immediate-exit races, service readiness, cancellation, process-tree cleanup and billing remain unverified. The host was stopped.

## 2026-11-12 — partial observed usage

A disposable 2.2.7 fixture made a synthetic request to a loopback mock provider and queried the plugin's usage RPC. It returned an observed assistant message, marked its zero host cost and cash charge unknown, and reported incomplete coverage. The fixture deliberately bypassed the production inference guard for the synthetic request; it does not enable production inference. The fixture is in `tests/fixtures/observed-usage`.

The report scans at most 100 owned sessions for the current project and uses current session context and assistant-message creation times. It may miss older, compacted, auxiliary, failed or otherwise unavailable requests. Positive host cost values are only estimates; zero or unrepresentable costs, actual cash charges, credits and effort remain unknown. It is not an invoice or complete spending ledger, and the Desktop panel has not been interactively verified.

## 2026-11-12 — transactional ledger feasibility

A disposable OpenCode 2.2.7 server loaded `node:sqlite` and performed a simple in-memory query. In a second isolated run it loaded the built atomic ledger, created and replayed a synthetic reservation, rejected another reservation above the synthetic limit, and reconciled the original amount. No model request was made. Five independent Node processes concurrently targeting one test database produced one reservation and four budget rejections. The server was stopped. Fixture: `tests/fixtures/atomic-ledger`.

The SQLite ledger is not connected to production request dispatch. A secure, stable host-wide database path and permissions, budget setting/version authority, crash and power-loss behavior, multiple OpenCode host processes, and all paid request/price bounds still need verification. SQLite on other platforms and network filesystems was not tested. The request guard remains enabled.

## 2026-11-12 — reservation process interruption

A local Node test killed a synthetic ledger worker before a SQLite transaction committed and confirmed that its reservation was absent after reopening the database. A second worker committed a reservation and was killed without closing its connection; the reservation remained after reopening and blocked spending beyond the test budget. These are process-termination tests on the local filesystem, not power-loss, filesystem-failure, cross-host, or OpenCode-host crash tests.

## 2026-11-12 — private ledger path probe

On macOS, a disposable 2.2.7 host used the built POSIX path helper under an isolated state directory and opened the resulting SQLite file. Tests cover existing data, symlinks, and group/other permissions. The server was stopped. This does not verify Windows, shared or network filesystems, hostile changes to ancestor paths, or the gap between validating a file and SQLite reopening its pathname. The helper is not used by production dispatch.

## 2026-11-12 — project-scoped draft RPC

A disposable Git project and OpenCode 2.2.7 server invoked the typed draft RPC: it saved a synthetic feature requirement with the project's 40-character HEAD commit and listed the same draft. No model inference was requested, and the server was stopped. The panel remains untested interactively. Draft baseline resolution uses local `git rev-parse` with a timeout and strips inherited `GIT_` environment variables; it records only the commit, not uncommitted content.

## 2026-11-12 — draft questions and approval RPC

A disposable OpenCode 2.2.7 server saved a synthetic draft, inserted a synthetic clarification and plan through a test fixture, then used the typed RPC to answer the question, retrieve the full plan and approve its hash. The RPC returned `approved`; no planner, coder or real user approval occurred. The server was stopped. Desktop rendering and cross-process approval races remain unverified.

## 2026-11-12 — planner reply handoff

An isolated 2.2.7 host used an owned synthetic planner session with `smoke/model-one#high` and a loopback mock provider. After one local request, the planner handoff matched the owned prompt and model, read the host message, parsed a synthetic structured question, and saved the run in `clarifying` state. Both servers were stopped. Fixture: `tests/fixtures/planner-handoff`. The fixture deliberately bypasses the production spending guard; the session's deny-all rules also mean it did not research the repository.

## 2026-11-12 — planner native read probe

A disposable 2.2.7 host created a synthetic planner session with no additional session permissions and installed the deny-only planner hook. Actual tool calls read a synthetic file successfully; attempted file write and shell commands were blocked by native permission errors. No model request was made. Fixture: `tests/fixtures/planner-read`. This does not establish behavior of nested tools, browser/MCP, project permission precedence, cross-instance ownership, or real planning. Production sessions still deny all tools.

The planner handoff was also repeated against the local mock provider after adding a check that the host's user-message text hashes to the saved prompt intent; the synthetic clarification was saved successfully. That fixture bypasses the production request guard.

## 2026-11-12 — tool-using planner handoff

A disposable 2.2.7 host with a synthetic loopback model received an owned planner prompt, ran an actual synthetic file `read` tool call, then received a structured question in a second model response. The host transcript contained an intermediate assistant message with `finish: tool-calls` and completed `read`, then a final assistant message with `finish: stop`; the updated handoff saved the clarification. Two local mock requests were observed and both servers were stopped. The fixture explicitly removes deny-all session rules and bypasses the production spending guard. It proves this single transcript shape, not full planner permissions, accounting or safe production dispatch. Fixture: `tests/fixtures/planner-tool-turn`.

## 2026-11-12 — checkpointed planner turn

A disposable 2.2.7 server ran the experimental planner-turn function against a synthetic loopback provider. It prepared an owned planner session, sent one local request, saved a structured question and persisted a `complete` checkpoint. The fixture bypassed the production spending guard and used deny-all tool permissions. The host and mock server were stopped. Fixture: `tests/fixtures/planner-turn`. This successful path does not prove crash recovery or cross-process synchronization.

## 2026-11-12 — planner recovery after a simulated disconnect

A disposable 2.2.7 host submitted one synthetic loopback planner prompt and simulated a lost wait. After the existing session completed, fresh adapter/repository objects reconciled its saved response into a clarification and marked the checkpoint complete. The mock server observed one request; no replay occurred. The host and mock server were stopped. The fixture bypasses the production request guard and simulates a disconnect within one host process; it is not an actual restart or crash-recovery test. Fixture: `tests/fixtures/planner-recovery`.

## 2026-11-12 — planner recovery across a host restart

In isolated XDG directories, a disposable OpenCode 2.2.7 server submitted one synthetic loopback planner request, simulated a lost wait, and waited until the mock response had completed while retaining a `submitted` checkpoint. The server was stopped and restarted using the same state directories. The fixture restored the run and checkpoint, reconciled the already completed owned session into a clarification, and marked the checkpoint complete. The loopback provider observed one request in total. Both servers were stopped. Fixture: `tests/fixtures/planner-restart`.

This was a graceful server restart after the response completed, not a crash during dispatch or a power-loss test. It bypassed the production spending guard and did not exercise real billing, repository research or cross-process concurrency.

## 2026-11-12 — late-created session metadata

In an isolated OpenCode 2.2.7 host, the runtime initialized first; the fixture then created a synthetic session containing Feature Pilot planner metadata and a separate ordinary control session. The runtime's cache-miss lookup found the planner metadata: its edit permission was denied and its local prompt ended in failure. The ordinary session's read was permitted and its prompt succeeded; the synthetic loopback provider observed exactly one request. Both servers were stopped. Fixture: `tests/fixtures/metadata-ownership`.

Session metadata is not an authenticated host-wide ownership registry and may be changed or inherited. The probe does not test concurrent host processes, metadata tampering or all request transports. If the host's session lookup fails for an uncached session, the hooks fail closed, which can affect an ordinary session during that failure. The production inference guard remains enabled.

## 2026-11-12 — late-created durable ownership

An isolated 2.2.7 runtime was initialized before a synthetic, metadata-free session and its Feature Pilot ownership/role records were created. The runtime's cache-miss lookup read the durable records: edit permission and the model request were blocked. An ordinary control session could read and its local mock-model request succeeded; the mock observed one request. Both servers were stopped. Fixture: `tests/fixtures/storage-ownership`. This was one host instance and does not prove synchronization across processes or protection against storage tampering.

The lookup now fails closed when it cannot establish that an uncached session is unrelated: either a storage outage with no ownership metadata or a host session lookup failure can affect ordinary sessions. This tradeoff must be resolved before a general release.

## 2026-11-12 — two server ownership probe

Two disposable OpenCode 2.2.7 server processes shared isolated XDG state and a synthetic project. The watcher initialized its runtime before the creator made an unmarked session and wrote its ownership records. The watcher then read those records, denied edit and blocked the synthetic model request; the loopback mock saw no request. Both servers and the mock were stopped. This is one same-machine scenario, not evidence of atomic cross-process writes, metadata tampering resistance, all model transports, or behavior across different XDG roots. Fixture: `tests/fixtures/cross-process-ownership`.

The first trial timed out without an observation. A separate simultaneous startup against a brand-new shared host database caused one server's schema migration to fail because the other had created the same table. After the database had initialized, starting the second server succeeded and the probe above completed. Concurrent first-run initialization should not be assumed safe.

## 2026-11-12 — transactional run store

A disposable 2.2.7 host loaded the built SQLite-backed run store, created a synthetic run, updated it and rejected a stale update through a second database connection. A separate Node test used five independent processes to race the same revision; one update succeeded and four were rejected. The server was stopped. Fixture: `tests/fixtures/sqlite-run-store`. This does not establish safe database location, migration, cross-process OpenCode host behavior or recovery after interrupted writes.

## 2026-11-12 — budget month determination

The experimental SQLite ledger now derives its UTC month from its host clock at reservation time rather than accepting a caller-supplied period. Unit tests cover the UTC month boundary, replay across the boundary, rejection of a caller-supplied period, and carrying an unresolved reservation into the next month's available budget. An isolated 2.2.7 server ran the updated synthetic reserve/replay/reconcile fixture successfully and was stopped. This does not establish reliable wall-clock behavior under clock changes, actual provider billing dates or hard spending enforcement.

## 2026-11-12 — reservation settlement evidence

The synthetic SQLite ledger fixture succeeded in a disposable 2.2.7 host after settlement records began requiring a final gross-charge reference or a confirmed-not-dispatched reference. The server was stopped. Tests show missing, estimated and conflicting evidence cannot release reservations, and older settled rows lacking evidence fail closed. The API validates the form of evidence only; it cannot independently verify that a provider charged the amount or that dispatch did not occur. Existing experimental settled databases without evidence require manual migration or recreation and must not be silently treated as complete.

## 2026-11-12 — reviewer response handoff

A disposable 2.2.7 host created a synthetic run and pending review with fixture-supplied plan, diff and validation data. An owned reviewer session sent one local mock-model request and the handoff recorded its structured approval, producing `ready_for_acceptance`. Both servers were stopped. The fixture bypassed the production inference guard, and the diff, contributor identity and validation were synthetic. This is not evidence of an actual independent review or trustworthy worktree identity. Fixture: `tests/fixtures/reviewer-handoff`.

## 2026-11-12 — durable stop request

A disposable 2.2.7 host saved a stop request for a synthetic run. After a graceful restart, it restored the request and rejected a further requirement change. No model or shell process was started, so this is not a cancellation or cleanup test. Fixture: `tests/fixtures/stop-storage`. Existing experimental run records lacking the new stop flag fail closed rather than being silently treated as active.

## 2026-11-12 — active planner interruption

A disposable 2.2.7 server started one synthetic planner request against a delayed loopback mock. The experimental stop helper persisted the stop request, checked session ownership and requested interruption; the host reported the session outcome `interrupted`. The helper continued to label process cleanup unverified. Both servers were stopped. Fixture: `tests/fixtures/stop-active`. This test bypassed the production spending guard and did not start a shell, verify billing, test stop/dispatch races, or prove subprocess termination.

## 2026-11-12 — background shell interruption and API boundary

The user subsequently authorized a local OpenCode fork. A checkout of tag `v2.2.7` now exposes the existing location-scoped shell get, output and remove operations to Effect and Promise plugins. Focused fork tests passed for both SDKs, including removing a running synthetic shell and rejecting a different requested location; fork core and plugin typechecks passed. This is not installed in Desktop or connected to Feature Pilot. Shell metadata is caller-supplied, not proof of ownership, and descendant termination, output retention during removal, races and other platforms remain unverified. One unrelated test in the full plugin test file failed to resolve a local plugin fixture under Bun 1.3.14; the fork requests Bun 1.4.4.

A subsequent macOS fork test launched a synthetic shell with an ordinary `sleep` child, then removed the shell through the plugin host; the child was no longer alive after removal. A separate test confirmed that shell output is no longer accessible through the shell API after removal. These results do not cover detached descendants, process-ID reuse, concurrent removal, Windows/Linux, ownership authentication or durable output capture. Three focused tests and fork core/plugin typechecks passed.

The local fork now also exposes a distinct plugin `shell.stop` operation: it waits for a killed shell to complete and leaves its captured output available. Focused Effect and Promise tests passed, including one ordinary child and repeated stop, as did core/plugin typechecks. This is still a prototype: caller-supplied shell metadata does not authenticate ownership; detached descendants, kill failures, concurrent stop/remove races, crash recovery and platforms other than macOS remain unverified. It is not wired into Feature Pilot or the installed Desktop.

The focused fork tests also cover two overlapping stop calls on one running synthetic shell and a stop after ordinary completion. Both overlapping calls returned `killed`, output remained readable, and stopping a completed command preserved `exited`. The overlapping-stop test passed five repeated runs on macOS. This does not establish behavior for stop versus remove or injected kill failures.

Using the checkout's required Bun 1.4.4, the complete fork `test/plugin.test.ts` file passed (26 tests); the earlier module-resolution failure reproduced only when the test runner actually used Bun 1.3.14. A disposable fork source server loaded a synthetic plugin, started a background shell, stopped it through the Promise plugin API, and read its retained output. The probe blocks model resolution and provides no paid credentials. See `scripts/smoke-fork-shell.mjs` and the fork fixture `packages/core/test/fixture/plugin-shell-probe`. This does not prove ownership, descendant cleanup on all platforms, crash recovery, or Desktop integration.

The local fork now keeps an internal session association separate from caller-supplied metadata for shells started through the native session and tool paths. `shell.stop` requires the matching session ID; focused tests reject a different ID and metadata-only forgery. The isolated source-server probe passes with a native tool-created shell and the matching session. The experimental Feature Pilot stop helper can call this operation only after its own run/session ownership check, but remains unwired to RPC or execution and continues to report process cleanup as unverified. These tests do not establish a host-wide authorization boundary between plugins, durable ownership after restart, stop/remove races, or cross-platform process cleanup.

A disposable fork source-server probe now exercises the actual Feature Pilot stop helper against a synthetic approved run, native background shell and recorded ownership. It persisted the stop request, stopped the shell and read its output; model resolution was blocked and no paid credentials were supplied. This uses a fixture-created ownership record and synthetic plan; it is not an end-to-end production workflow or a cross-process ownership proof.

The local fork now offers namespaced plugin-storage compare-and-set through the existing host database, using a single conditional SQL statement. Tests cover missing values, JSON null, contention and plugin namespaces; a synthetic Promise plugin exercised contention inside an isolated fork server. JSON comparison is by stored serialized representation, not semantic object equality. Thirty-one fork KV/plugin tests and core/plugin typechecks passed. Cross-process behavior, crash durability, migrations and integration into Feature Pilot's budget ledger remain unverified; automatic dispatch remains blocked.

Project draft operations now use compare-and-set for run transitions when the fork supplies it; the standard 2.2.7 host keeps its process-local fallback. An isolated fork-server fixture confirmed that the real run repository took the compare-and-set path while creating, approving and stopping a synthetic run. A simulated conflicting write was rejected after a revision recheck. This does not cover other plugin settings, the budget ledger, cross-process host races or crash recovery; the production request guard remains enabled.

Two separately started fork servers shared a disposable XDG database and raced the same Feature Pilot run revision after both had read it. One update succeeded, the other was rejected as stale, and both servers read the same saved winner. See `scripts/smoke-fork-cas.mjs` and the fork's `plugin-cas-race` fixture. This covers one same-machine race on an initialized database; multi-host or network filesystems, crash and power-loss behavior, plugin settings and spending reservations remain unverified.

An experimental `CasReservationLedger` now stores budget limits and reservations together through the fork's compare-and-set API. It retains unsettled reservations across UTC month boundaries and requires caller-supplied final evidence to reconcile. The two-server fixture also raced two reservations against a $1 limit: one $0.80 reservation succeeded, the other was refused, and both servers observed one saved reservation. This is one same-machine synthetic case; evidence is not independently authenticated, prices and all model calls are not yet bounded, migration and crash/power-loss recovery remain unverified, and this ledger is not connected to request dispatch.

A disposable fork-server process was killed after confirming a synthetic reservation had committed. A fresh server using the same isolated host database recovered the unsettled reservation and refused an additional reservation that would exceed the limit. See `scripts/smoke-fork-budget-crash.mjs`. This is one post-commit process-crash test on local macOS storage, not a power-loss, pre-commit, disk-failure, network-filesystem or ambiguous model-dispatch test.

Budget RPCs and an experimental panel section now load and save the host-wide monthly limit and the open project's draft-specific limit using that ledger. Stale edits fail; standard 2.2.7 without compare-and-set reports the feature unavailable. A synthetic fork-server probe verified the monthly typed RPC, and unit tests cover draft scope and stale revisions. Desktop rendering is not yet verified, and these settings do not enable or enforce live model dispatch.

The budget view now also reports UTC-month and selected-feature committed amounts, unresolved reservations, remaining limits and over-limit amounts from one ledger snapshot. Pending reservations from earlier months remain in the monthly figure until reconciled; settled prior-month amounts remain in the feature total only. Unit tests cover month rollover and a lowered limit, and a synthetic fork-server RPC verified pending and remaining amounts. These figures are budget bookkeeping, not a complete bill, and live requests are not yet recorded by the ledger.

Model selections now use host compare-and-set when available, rejecting an intervening edit instead of overwriting it; standard 2.2.7 retains its process-local fallback. Two isolated fork servers raced synthetic model-selection edits from the same revision: one saved, the other failed as stale, and both read back the same selection. This does not prove atomicity between selection, model dispatch and price/budget reservation.

On the fork, prompt-intent creation now uses compare-and-set when available. In the isolated two-server fixture both processes tried to claim the same synthetic prompt ID; one submitted it and the other refused it. Model resolution remained blocked. This does not provide exactly-once inference or recover ambiguous dispatch after crashes; standard 2.2.7 still has only process-local serialization, and the production spending guard remains enabled.

Planner checkpoint creation and phase updates now use compare-and-set on the fork. Two isolated servers raced the same synthetic planner checkpoint: one reached the fixture's preparation step and the other was rejected before preparing a session. A unit test also verifies a competing checkpoint change prevents prompt dispatch. This does not provide a cross-process active lease, exactly-once inference, or complete crash reconciliation; ambiguous turns still require attention and production dispatch remains blocked.

In a disposable 2.2.7 host, the fixture started a bounded synthetic background `sleep 30`. Calling `session.interrupt` returned `interrupted: false`; a subsequent external client `shell.get` still reported the shell as `running`, with the synthetic session ID in its metadata. Calling external `shell.remove` made that shell ID unavailable, and its reported parent PID was no longer alive after 300 ms. No model request was allowed. The host was stopped. Fixture: `tests/fixtures/shell-stop-probe`.

The installed plugin context exposes only `shell.hook`, not `shell.get` or `shell.remove`; the external client has those methods, but the plugin has no documented server URL/authenticated client in its context. This single probe does not establish descendant cleanup, output retention, authorization, race-free ownership or behavior on other platforms. The missing plugin-context shell inspect/stop capability is recorded as a Task 1 gate in the plan; do not infer that process cleanup is implemented.

## 2026-11-12 — optional Artificial Analysis feed

The optional user-keyed display feed calls the documented [Artificial Analysis free language-model endpoint](https://artificialanalysis.ai/data-api/docs/reference) only when requested. The [API overview](https://artificialanalysis.ai/data-api/docs) requires attribution, states that the numeric index version omits patch versions, and explains that Coding and Agentic Index fields are no longer published. The [access page](https://artificialanalysis.ai/data-api) describes free API data as internal use only, with separate commercial redistribution rights. This is source documentation, not a determination of every user's license rights.

A disposable 2.2.7 host used a synthetic key and synthetic fetch responses to exercise the typed RPC across two pages; it returned two entries, preserved one unknown score and did not return the key. No real Artificial Analysis API call was made. Fixture: `tests/fixtures/artificial-analysis`. The feed does not cache or ship benchmark data and does not establish exact model/version/effort mappings or authorize routing. Desktop rendering and actual API access remain unverified.

## 2026-11-12 — project-scoped transactional runs

The experimental SQLite run store now requires an explicit project identity and stores each project's runs separately; a same-process test created the same run ID in two projects and verified separate contents. A disposable 2.2.7 host exercised an earlier version of the scoped store using synthetic data. A later safety check refuses nonempty legacy unscoped tables instead of hiding them; that check has unit coverage only. The draft RPC continues to use plugin storage. Actual Desktop UI inspection was attempted, but the Mac was locked and the computer-use surface could not unlock it.

## 2026-11-12 — local export preview

A disposable 2.2.7 host created a synthetic draft and returned its revision-checked JSON export through the typed RPC. The preview included the requirement and explicit missing-diff and missing-cost markers; no model request or publication occurred. The host was stopped. Unit tests cover project isolation, stale revisions and omission of unrelated extra fields. Fixture: `tests/fixtures/export-rpc`. The preview may contain sensitive information intentionally present in a requirement, plan or findings; it is not a secret scrubber or a complete run export.

## 2026-11-12 — host-connected run driver (fakes only; no real host)

The run driver is now wired to host-backed stages (`src/host-ports.ts`, `src/driver.ts`) and exposed as `driveDraft` and `stopDraft`. Everything in this entry was exercised against **in-memory fakes of the host** and real local git repositories on Windows (Node 24). No OpenCode 2.2.7 server, Desktop window, paid provider or `gh` was involved, and no `opencode` binary is installed on the machine that ran these tests. Treat every statement below as unverified on a real host until a disposable-profile run records otherwise.

- **Worktree.** The run's worktree is created with plain `git worktree add --detach <project>.feature-pilot/<runID> <baseCommit>`, not the host's worktree API, so the project's own working tree is untouched. Git does write worktree metadata under the project's `.git`. A leftover directory is adopted only if it still matches the baseline. The plugin never deletes it.
- **Coder and shell are off by default.** The coder session gets `read, glob, grep, edit, shell` only while the operator has set `coderEnabled` in the policy. This is deliberate: on 2.2.7 a broad session allow rule overrides project deny rules (see the permission-precedence findings above), so enabling the coder can silently bypass a project's own denials. Enable it only in a disposable project. Validation commands also run only when `coderEnabled` is on, through the host `shell` tool using the result shape recorded in `tests/fixtures/validation-tool`.
- **Review inputs.** The reviewer receives the exact worktree diff (including untracked files), refuses if the worktree changed after validation, and gets no write access. A worktree containing a symlink or Windows junction that leads outside it is refused: a probe on this machine showed git follows a junction, which would have placed an outside file in the diff sent to the reviewer. Symlink behaviour specifically could not be tested here because the account cannot create symlinks.
- **Not a sandbox.** The coder's allow rules are `resource: '*'`: not scoped to the worktree path, and the worktree is not an isolation boundary. Shell commands run with the user's own account permissions and credentials and can read or write outside the worktree; the session's working directory is only a starting point. Scoping file actions to a path was deliberately not done because a shell rule's resource is the command text and how 2.2.7 matches file-path patterns is unverified, so a guessed scope could deny everything or give false assurance. A real boundary (a container or VM with no host credentials and restricted network) is outside what this plugin can provide. Autonomous mode approves the planner's own validation commands without a person reading them; it requires an explicit button press, `coderEnabled`, and open budgets, but the commands are still model-written.
- **Independence.** The reviewer is the first user-ordered route whose vendor is not a vendor that planned or coded the run. Contributing vendors are recorded when a planner or coder stage starts; unknown contributors mean no review.
- **Planner resume.** An unfinished planner turn is reconciled from the host's session record and never replayed.
- **Command steps (2026-11-12, fakes only).** A plan step with `execution.kind: 'command'` and role `coder` is run to completion in the foreground through the host shell tool in the run worktree, with its own deadline, and completes by recording an outcome (exit status only; output is not stored). It needs the same `coderEnabled` opt-in as validation, spends no model money, and is run again on Resume if it failed, timed out or could not be read, so write such commands to be safe to repeat. A `validate`-kind command step must have run on exactly the content that is reviewed. Deadline and Stop end the wait and pass an aborted signal to the tool; as with validation, the command itself may survive (unverified).
- **Not supported yet.** Plan steps with `execution.kind: 'service'` (a long-running process with a readiness probe), and command steps owned by a non-coder role, pause with `unsupported_step`: OpenCode 2.2.7 gives plugins no verified way to inspect and stop owned background shells, and the plan's host-capability gate forbids enabling them until it does (what OpenCode would need to provide is in `docs/opencode-host-requirements.md`). Draft-PR delivery is exposed over RPC and the panel (see "Delivery" below) but has never run against real GitHub.
- **Budgets.** Autonomous runs require atomic host storage with monthly and feature budgets that have budget left. Stock 2.2.7 lacks atomic storage, so on it every owned model request is still refused. `settleReservation` lets the user release a reservation only with the provider's own charge or proof it was never dispatched; host-computed costs never release one.

## 2026-11-12 — independent review findings and known limits (fakes only)

A read-only reviewer with no execution tool traced the new run-driver code. I reproduced each finding I acted on before changing anything; findings I could not reproduce are listed as such.

- **Fixed after reproducing:** a rename produced an empty path in the diff file list, so the link-escape check and the reviewer context skipped the renamed file (now `--no-renames`); a coder step whose dependencies could never be satisfied ran, and was paid for, before the run record refused it (now refused first as `step_dependencies_unmet`); a failed planner turn left an incomplete checkpoint that blocked every later Resume (a Resume now asks the planner again once the old turn is provably unusable, and still refuses while the old session may be running); a Stop pressed while a stage session was being prepared still sent the paid prompt; a repair coder from the reviewer's vendor was allowed; an oversized or binary-looking diff only failed after the coder and validation were paid and in a state that could not be amended (now an early `reviewable` check pauses while validating); a coder could hide source from the reviewer by making git treat it as binary; an unexpected driver error left the run looking live; pending reservations could be hidden behind 200 settled ones; the recommender's staleness window (45 days) disagreed with the ranking rule (7 days).
- **Not reproduced:** the Windows `git` lookup from the child's working directory. A copy of `node.exe` named `git.exe` in the cwd was not run on Node 24 here. A host running under another runtime was not tested.
- **Known and not fixed:**
  - Replay checkpoints (planner since the first pass; coder and reviewer since 2026-11-12, fakes only): each stage records `stage-turn/<run>/<role>` (session, prompt id, hash of the request, phase) before sending. On resume the same request reuses a finished session (the prompt must still be present in it), pauses as `coder_turn_unresolved`/`reviewer_turn_unresolved` when the earlier session may still be running or cannot be read, and sends again only when the earlier session failed or was interrupted, its prompt provably never reached it, or its reply was unusable (that costs again; the ledger bounds it). Unverified on a real host: how `readStage` reports a session that is still generating, and whether `ownsPrompt` is reliable across a plugin reload. A paused `*_turn_unresolved` run has no in-panel way to abandon the old turn; stop or finish the session in OpenCode and resume.
  - Stop ends the wait on a running validation command at once and gives the host shell tool an aborted signal, but the command itself may keep running: host session interruption did not stop a shell in the earlier probe, and nothing verifies that the tool honours the signal.
  - `maxOutputTokens` is not enforced as a request cap, so it no longer sizes the reservation: each request reserves the context window as input plus the model's full output limit (which covers billed reasoning), so a request cannot bill more than it reserved. The allowance only drives cost estimates and recommendations. The cost is that budgets run out sooner for models with large output limits.
  - `git worktree add` and the content snapshot have a 30 second timeout; a slow checkout can leave a partial directory that later attempts refuse to adopt.

### Delivery over RPC and the panel (2026-11-12; fakes and a local bare repository only)

- `getDelivery`/`saveDelivery` keep a per-project, revision-checked setting: publication off by default, one remote (name, URL exactly as `git remote get-url` prints it, base branch, branch prefix). Names must be plain (no leading `-`, no `..`), URLs may not embed credentials, and enabling publication without a destination is refused.
- `deliverDraft` with target `github` refuses unless publication is enabled, the run is `accepted` (a human decision, stricter than `deliverRun`, which also allows `ready_for_acceptance`), and a worktree is recorded. Only one delivery per run runs at a time. The delivery record (`run-delivery/<run>`) is saved before the push and after the pull request exists, so a repeat click reuses the branch and pull request instead of creating another; an unreadable record stops with `needs_attention`.
- Target `local` writes `run.json` and `summary.md` under `<project>.feature-pilot/exports/feature-pilot-<run>/`, beside the worktrees so an export never appears as an uncommitted change. Costs are not included (accounting is not wired into the export).
- Unverified: real `gh`/GitHub behaviour (auth prompts, branch protection, forks, SSO), Windows credential helpers, and whether a draft pull request on a private repository exposes anything beyond the run's requirement, plan and review text.

### Other changes in this pass

- **Output allowance.** `maxOutputTokens` is not enforced as a request cap (the `experimental.model.resolve` hook only carries a model reference), so each request now reserves the context window as input plus the model's *full* output limit. Budgets run out sooner for models with large output limits; the allowance only drives estimates and recommendations.
- **Stop during validation.** Stop aborts the wait on a running validation command and passes an aborted signal to the host shell tool. Whether the host actually kills the command is not verified; the run is cancelled either way.
- **Fenced replies.** A planner or reviewer reply that is exactly one Markdown code fence around the JSON is accepted (prose around it still is not), so a harmless formatting habit no longer costs a paid turn.

## 2026-11-12 — Windows 2.2.7 real-host smoke (packed plugin, no model)

Platform: Windows 11, Node 24, `opencode v2.2.7` from the downloaded `@opencode/cli` package, run only in a scratch directory with isolated XDG config/data/cache/state, a loopback port, a throwaway server password and no credentials. The CLI's postinstall had to be run once by hand because install scripts are off.

- **Native worktree.** `npm run smoke:worktree` against that binary passed: a worktree was created at the requested commit and a dirty source checkout was preserved.
- **Packed plugin.** `npm run smoke:host` packs the built plugin, installs the tarball into a disposable project (`--ignore-scripts`), lists it as `./node_modules/feature-pilot` in `opencode.json`, and starts `opencode serve`. The host listed it as `feature-pilot`, source `local`, features `server` and `gui`, status `active`. It appears a moment after the server first answers, so the script waits for it.
- **RPC and storage.** `getPolicy`, `getSelections`, `getDelivery`, `listModels` (12 built-in models visible with no credentials), `saveDelivery` (rejects URL credentials and a stale revision, then saves), `createDraft` (recorded the real `HEAD`), `listDrafts`, `getDraft`, `driveDraft`, `stopDraft` and `deliverDraft` all answered with schema-valid output. A local export wrote `run.json` and `summary.md` beside the project. After a server restart the run and the delivery settings were still there. A GitHub delivery for a run that was not accepted was refused.
- **No model request.** `getBudget` reported `available: false`: stock 2.2.7 plugin storage has no compare-and-set. The driver therefore paused with `budget_exhausted` before creating a session, and the host held 0 sessions. This is the designed fail-closed behaviour, and it means no run can reach a model on stock 2.2.7 (see `docs/opencode-host-requirements.md`).
- **Finding: handler errors are opaque.** A handler that throws reaches the client as `{ type: 'rpc.internal', message: 'RPC call failed' }`, so every message the panel relies on (stale revision, "Select a run", credential refusal) was lost. All methods now declare a `rejected` error and the handlers return it; the smoke asserts `{ type: 'rejected', message: /stale/i }`. A regression test fails if the wrapper is removed.
- **Not exercised:** any provider or model turn, the shell tool, permission rules, a worktree run through the driver, the atomic-storage budget gate, and the Desktop panel. The GUI features are only known to be declared; nothing rendered them. Run `docs/desktop-testing.md` for those.

## 2026-11-12 — local-file budget ledger on stock 2.2.7 (Windows, mock provider)

Stock 2.2.7 plugin storage has no compare-and-set, so the budget gate used to stop every run. The plugin now falls back to a SQLite file when the host has none: `<XDG_DATA_HOME, else ~/.local/share>/opencode/feature-pilot/ledger.sqlite`. The existing `CasReservationLedger` is reused unchanged on a small store (`src/local-ledger.ts`) that implements `get` and `compareAndSet` with `BEGIN IMMEDIATE`. Host storage is preferred when it can compare-and-set. If `node:sqlite` cannot be loaded, or the path is unsafe, there is no ledger and every owned request is refused. The panel states which backend is in use.

- **Unit and race tests.** Six separate processes made 15 one-cent attempts each against a 50-cent limit: exactly 50 succeeded. The test fails if the comparison is removed or the write lock is dropped (the second mutation let all 90 through). A corrupt record fails closed; a failed open is retried; a directory that is a link is refused.
- **Real host.** `npm run smoke:host` (Windows, 2.2.7, scratch directories): `getBudget` reports `local_file`; the ledger file appears under the isolated data directory; monthly and feature limits are saved and survive a restart; with no limits the driver still stops with `budget_exhausted`, and with limits it proceeds to the next requirement.
- **A model turn against a mock.** `npm run smoke:host:model` runs a free loopback OpenAI-compatible mock. The custom provider loaded with `providers.<id>.package = "@ai-sdk/openai-compatible"`, `settings.baseURL`, `env` and `models`. A run whose feature limit was below the worst case ($0.01 against $0.039) stopped before any request reached the mock. A run with a $1 limit sent exactly one request (`model-one`, `reasoning_effort: high`, streaming, the synthetic key), the planner's question reply was parsed and the run reached `clarifying`, the ledger held one pending reservation of $0.039, and that reservation survived a restart. This took about 90 seconds the first time, most likely the host preparing the provider package on first use (not verified); the refused run failed within about a second.
- **Not shown to the user:** a refusal by the spending guard reaches the plugin only as "Planner did not complete successfully", because the host does not pass the guard's reason back, so the run shows `stage_failed`. The explanation text now names the budget as a common cause. Mapping the exact reason would need the guard to record its denial where the driver can read it.
- **Limits.** Any program running as this user can edit the file (on Windows no access check is made beyond the profile's defaults); crash and power-loss behaviour, network file systems and OpenCode windows on different machines were not tested; spend is not carried between the file and host storage if the backend changes; the reservation stays pending because settling needs provider charge evidence. Only the planner stage ran: no coder, reviewer, shell tool, worktree run, permission rule or Desktop panel. The tested CLI is `@opencode/cli` 2.2.7; the Desktop app's embedded 2.2.7 CLI has the same size but a different hash, so it was not shown to be the same binary.
