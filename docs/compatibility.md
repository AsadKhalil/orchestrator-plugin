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

## 2026-11-12 — a full run on the real Windows 2.2.7 host with real Ollama Cloud models

Platform: Windows 11, the OpenCode 2.2.7 CLI that ships inside the Desktop app, run as `opencode serve` on a loopback port with a throwaway server password. The profile was the user's normal one (their own config, data directory and existing `ollama-cloud` credential, which was never printed), so their global plugins loaded too. The packed plugin was installed from a tarball into a separate folder and loaded from a disposable Git project. Models: `gpt-oss:120b` (planner), `glm-5.3-flash` (coder), `gemma4:31b` (reviewer), all through the host's own provider. The routes were labelled `metered_api` with the catalog list prices. (Corrected 2026-11-13: this entry first said that Ollama Cloud is flat-rate and that the label was only a way past the `billing_unbounded` refusal. Ollama Cloud bills per token against usage credits, per ollama.com/pricing as read on 13 Nov, and its page prices equal the catalog prices, so `metered_api` was the right label.)

- **Result.** One run went the whole way: plan, approval, the expected `coder_not_enabled` pause, coder enabled, three coder steps in the run worktree, validation, a reviewer from another vendor (approve, no findings), acceptance, local export. Checked separately from the run record: `npm test` in the worktree gave 2 passing and 0 failing, and the real project directory was unchanged (no `subtract`, same commit). Real spend for the run was about $0.009 (sum of the sessions' own cost); $3.43 stayed reserved.
- **Fixed after reproducing (each with a red-then-green test).** (1) The host records a session with no variant requested as `variant: "default"`, so every comparison against `null` failed and every first request was refused; six comparison sites now go through `hostVariant`. (2) Planner sessions were created deny-all with no allows, although the prompt tells the planner to read the repository; planners now get `read`, `glob` and `grep` only. (3) A model call to a tool the session does not have is refused by the host (`tool.execution`, "No tool named ... is currently available") without running; that harmless refusal failed the whole planner stage. Only that exact refusal is tolerated now; any other tool outside the read-only set still fails the stage. (4) The host runs the plugin once per directory, and the coder works in `<project>.feature-pilot/<run id>`, so the instance serving it found no selections or policy and refused the coder's model ("not selected for the role"); settings, policy and spending now resolve to the project for that directory shape. (5) The planner prompt let a model write `"write": null` for a research step (the validator rightly rejected it) and invent a step role `validator`; it now says lists are `[]` for none and that only coder steps run in this version.
- **Observed, not changed.**
  - A refusal or a rejected plan shows only `stage_failed`. The host does record the refusal text on the session's final message, and the parser knows which rule failed, but neither reaches the run. Two of five fresh planning attempts were rejected (a null list, an invented role); a Resume asks again and the next one was accepted.
  - Reservations are only released by the provider's own charge record, and Ollama Cloud gives none per request, so they never release. This one small run left 22 reservations (about $3.43) on a $5 feature limit and 56 (about $4.77) on the monthly one, against roughly $0.009 of real use. The `glm-5.3-flash` 1M-token context makes each worst case about $0.2.
  - A plan whose coder steps depend on a `planner`-role step (a "design" step) is accepted, approved, and then pauses at `step_dependencies_unmet` with nothing spent, because no stage runs planner or reviewer steps. An existing test asserts this refusal, so it was left; the prompt now steers the planner away from it.
  - A `validate` step with no `execution` is run as a coder model turn although it is marked `inference: false` (about $0.002); the real validation is a separate stage.
  - Global user plugins and instructions apply inside plugin-created sessions (the host's default `build` agent): the planner tried a `skill` tool from the user's setup in every attempt.
  - The host reports `executed: false` even on read-only tool calls that completed, so that flag cannot be used to decide whether a tool ran. Models also wrote the main project's absolute paths into plan `resources` and `areas`.
  - Test sessions (more than twenty) and ledger entries (56 monthly reservations) are now in the user's real OpenCode data directory.
- **Not tested:** the Desktop panel (nothing rendered it), delivery to GitHub and the draft pull request, the repair loop (the reviewer never blocked), a Stop during a live stage, service plan steps (still gated), any other platform, provider or model, large repositories, and the host's compare-and-set storage path (stock 2.2.7 has none).

## 2026-11-13 — Relay: the panel opened in Desktop, then a compact layout

Platform: Windows 11, OpenCode Desktop; the version was not read at the time. (Corrected 2026-11-13: this entry first said 2.2.7. Read later the same day, the installed app and its bundled CLI were 2.3.0. The update was downloaded at 04:03 and the app folder changed at 04:24, about when Desktop was restarted for this report, so the panel was most likely seen on 2.3.0.) After the built plugin was added to the global `opencode.json` (a backup of the file was kept) and Desktop was restarted, the user reported that the **Open** command appeared and the panel opened. That was reported, not seen by the assistant. The same report said the panel had too much text and too many options.

- **Changed.** The visible name is now Relay (panel title, command, session titles `Relay: <role>`, pull request title, commit message and body, spending refusal messages, default branch prefix `relay/`). Internal ids keep the old name so saved settings, runs and worktrees are not orphaned. The panel is four tabs: Run (start a feature, run list, one run with a progress strip and its actions), Models (per-role chips and an add menu instead of a checkbox grid), Spend (budget bars, coder switch, model prices) and More (delivery, observed usage, recommendations, scenarios, model catalog, intelligence index, each collapsed). Long notes moved behind disclosures; the exact warning texts that tests pin are unchanged and one click away. Width 420 to 380. The Spend tab now loads the budget when opened instead of waiting for a button.
- **Checked, with fakes only.** The new layout was rendered in headless Chromium 155 through a Vite preview with a fake RPC and stand-in theme variables, at 380 px wide, light and dark. In that preview: every tab, all six More sections open with no console errors, adding a model to a role through the menu, the clarification question flow, the two-step publish confirmation, and the attention banner. One layout fault was found and fixed there: `overflow: hidden` on a `<details>` made Chromium size the box from stale content (344 px box, 370 px content) once its body was filled in after opening.
- **Not checked.** How it looks in Desktop with the host's real theme variables and fonts (the variable names were read out of the Desktop bundle; that plugin panels receive them was not confirmed); whether Desktop honours the new 380 px width; keyboard use of the tab strip and screen-reader behaviour in Desktop; widths below 380 px; the real RPC behind the Spend tab's automatic budget load; a long model list in the real catalog section.

## 2026-11-13 — read-only checks for the model-guidance plan (Windows 11, OpenCode 2.3.0)

Platform: Windows 11. The host version was read, not assumed: `opencode --version` printed 2.3.0, and the Desktop app's file version and its bundled `opencode-cli.version` agree. The repo still pins the `@opencode/*` packages at 2.2.7. Nothing in this entry was run in Desktop, and no plugin code changed.

- **Type files, 2.2.7 against 2.3.0** (both packages unpacked from npm into a scratch folder). `gui/registries.d.ts`, `promise/command.d.ts` and `promise/model.d.ts` are identical; `gui/host-apis.d.ts` differs only in comments; the schema's model `cost` shape is unchanged (`freeform` is the only addition to the model record). Changed elsewhere: `promise/session` gains a `fork` hook and `promise/integration` a `submit` field.
- **Installed Desktop app (its `app.asar`, read as text, never executed).** The composer pill registry is defined. The `/` menu list is built from the server's command list as well as the app's own. The session details screen has a "Total Cost" field. The model picker's texts are name, provider, context limit, input types, reasoning and the tags Free and Latest; there is no price text. The Usage screen's texts refer only to OpenCode Go and Console workspace budgets.
- **The user's real model list** (read with the bundled CLI's `api model.list` from the running service; only provider id, model id, name and cost were printed, because records can carry credentials). 38 models: 26 `ollama-cloud` and 12 `opencode`. All carry `cost` in USD per million tokens with a cached-input figure; 25 of the Ollama Cloud models are priced, 23 have a cached-input price above zero, and none has more than one tier. 13 are 0 in and 0 out: the 12 `opencode` free models and Ollama Cloud's `beam`, which has no price in models.dev, so a zero cannot be told from unknown. The record's own `canonical` field is empty for all 38.
- **Joining to an index by id** (the public OpenRouter and models.dev files, downloaded without a key into scratch folders). models.dev gives a `canonical_model_id` for 36 of the 38; 27 match an OpenRouter entry on it, and 26 of those carry `benchmarks.artificial_analysis.intelligence_index`. Exact name matching against OpenRouter's names matched 22.
- **Not tested:** the pill, `setModel`, either slash-command route and the panel on 2.3.0 (nothing was rendered or run); a real Artificial Analysis call (`ARTIFICIAL_ANALYSIS_API_KEY` is not set); local models and an OpenRouter provider (none connected); the smokes against a 2.3.0 CLI; whether OpenRouter's index field is documented, or may be shown in a product.

## 2026-11-13 — read-only checks for the `/relay` chat-router plan (Windows 11, OpenCode 2.3.0)

Platform: Windows 11. The host version was read again for this entry: `opencode --version` printed 2.3.0 and the bundled `opencode-cli.version` agrees. The repo still pins the `@opencode/*` packages at 2.2.7. No plugin code changed, no plugin was loaded for this entry and no model request was made. The only calls to the host were six `model.list` reads through the bundled CLI, and none of them returned a list (see the bullet on the background service).

- **What a server plugin is given (the 2.2.7 type files in `node_modules`).** `context.command.transform` adds a slash command whose `execute` receives `{ sessionID, prompt, delivery }`; `prompt` holds `text`, `files`, `agents` and `skills`, and `delivery` is `steer` or `queue`. `context.session` includes `switchModel`, `switchAgent`, `prompt`, `get`, `context` and the experimental `wait`. `context.experimental.generate` has `decisions` and `text`, described there as "Stateless generation with a model and a prompt: no session, history or tools."
- **Shapes.** `switchModel` takes `{ sessionID, model: { providerID, id, variant? } }` and `switchAgent` takes `{ sessionID, agent }`. `generate.decisions` takes a model, a list of inputs (text, json or file) and questions of type `predicate`, `choice` or `score`; a `choice` answer carries the chosen value, a probability for each choice and a confidence, and the result may carry `cost` and `tokens`. `generate.text` takes `{ prompt, model? }` and returns only `{ text }`, so a caller cannot cap the length of the answer. The session record (`SessionInfo`) carries the current `agent` and `model` and `time.busy` / `time.idle`. The session's message list has `model-switched` and `agent-switched` records beside the user and assistant messages.
- **Model types (the 2.2.7 schema and protocol files).** `Model.Type` is `chat`, `decision`, `image` or another string. `model.list` takes an optional `types` filter, described as "Only list models of these types. Defaults to chat, the only type offered for sessions." `src/inventory.ts` passes none, and the model list read earlier on 13 Nov passed none, so neither could have shown a decision model.
- **2.2.7 against 2.3.0** (both unpacked from npm into a scratch folder and compared as text). Of the 18 client types the plan would use, 17 are identical; `SessionMessageAssistant` gains `time.firstToken` in 2.3.0. `promise/command.d.ts`, `promise/plugin.d.ts`, `promise/storage.d.ts`, `gui/registries.d.ts` and the schema's `prompt-input.d.ts` and `session-inbox.d.ts` are identical. `promise/session.d.ts` differs only by the `fork` hook and a `metadata` field on request messages.
- **OpenCode's documentation** (read on 13 Nov; quoted, not run). On commands: "The executor receives the session, prompt attachments, and requested delivery mode." On switching: "Change the agent or model used by subsequent requests." On generate: "Generate with a selected model without creating a session, invoking tools, or adding to session history. These APIs may change." Its `generate.decisions` example names the model `opencode/jev-1.13`. It does not say which models can answer `generate.decisions`.
- **Google's Gemini Decision 1** (Google's announcement of 11 Nov 2026, read on 13 Nov). Model `gemini-decision-1` on the Gemini API, answering closed questions with a confidence, at $0.10 per million input tokens, with a key from Google AI Studio. The announcement lists OpenCode among integrations that are "rolling out". The model was not in the models.dev or OpenRouter files downloaded on the morning of 13 Nov, and the user has no Google provider connected.
- **Where Desktop loads Relay from** (the global `opencode.json`; only its plugin entries were printed). `~/feature-pilot-install/node_modules/feature-pilot`, a copy installed from a packed tarball on 13 Nov, not this repo's `dist`. A build in the repo therefore changes nothing in Desktop. The config lists six other plugins.
- **The host's background service on the afternoon of 13 Nov** (read from OpenCode's own log; nothing was changed). Six `model.list` reads between 19:40 and 19:46 UTC, the first asking for the `decision` type, were all answered `ServiceUnavailableError: Location plugins did not finish activating`, from this repo's folder and from the test project. The log shows the service (`serve --service`) started 18 times between 18:57:20 and 19:39:34 UTC, before the first of those reads at 19:40:04, against at most five starts in any earlier hour of the day. The last call to the host before 18:57 was a `model.list` read at 18:08. During the first read the CLI logged "Background service is unresponsive; recovery cannot preserve persistent terminals" and started the service again; a start also followed the reads at 19:42:39 and 19:45:27. The cause of the restarts was not found. No warning or error in the log names Relay after 12:46 UTC, when it was reinstalled. Another plugin in the global config, `opencode-mem@latest`, failed to load in every hour from 08:00 UTC (`Cannot find package '@libsql/client'`). No further calls were made to the service.
- **Subagents** (OpenCode's documentation, read on 13 Nov; quoted, not run). "A subagent uses its configured model, or inherits the parent session's model when none is configured." "Runs only in a child session through the `subagent` tool." An agent's model is set as `model: provider/model#variant`. In the 2.2.7 type files a plugin's `context.agent.transform` editor can `update` and `remove` an agent and set the default, but has no `add`; an agent record has `model`, `system`, `description`, `mode`, `steps` and `permissions`. The installed CLI's own texts say: "The `subagent` tool takes `agent` instead of `subagent_type` and `sessionID` instead of `task_id`." None of this was tried.
- **Session hooks** (2.2.7 type file `promise/session.d.ts`, read on 13 Nov; the 2.3.0 file differs only by a `fork` hook and message metadata; not run). `context` and `experimental.model.resolve` carry the chat's id, its agent and its model for each request. Of the resolve hook the file says: "Runs whenever a Session resolves the model for a request, before anything is built for it", and that a plugin may change the model "to serve this request with another model from the same provider". `experimental.idle` lists running helpers with `childSessionID`, `agent` and `description`. In the 2.3.0 type files the agent editor still has no `add`; the skill and command editors have one.
- **Superpowers 7.0.2 in the owner's OpenCode config** (its files read on 13 Nov; not run). Its OpenCode plugin tells the model to start every helper as `subagent` with `agent: "general"`, and names no way to choose a model for one helper. Its fix loop allows five rounds for each task, with a re-check limited to the earlier findings and the fix. Its plugin source warns that an error thrown inside a skill transform makes the host disable the whole plugin.
- **Not tested:** all of the plan's mechanism. In particular: whether the user's OpenCode offers any decision model; whether a command's `execute` is the only thing that sends the typed text; whether `switchModel` followed by `prompt` makes exactly one request, on the chosen model; what a switch does to an answer that is still being written; what `wait` does; whether `generate.decisions` accepts an ordinary chat model, or reaches `gemini-decision-1`; whether the plugin's own hooks see a stateless generate call; how Desktop shows the command, the switch and a failing command; whether plugin storage is shared between projects.

## 2026-11-13 — Stage 0 of the `/relay` plan: probes on an isolated 2.3.0 host (Windows 11, mock providers)

Platform: Windows 11, the OpenCode 2.3.0 CLI that ships inside the Desktop app (`opencode --version` printed 2.3.0), run as `opencode serve` on a loopback port with a throwaway server password, scratch `XDG_*` directories, a synthetic key and two mock OpenAI-compatible providers on one loopback server. A throwaway probe plugin was loaded from a scratch folder; it is not in the repo and no product code changed. Nothing in this entry ran in Desktop, with a real model, or with the owner's other plugins loaded. The repo still pins the `@opencode/*` packages at 2.2.7.

- **Step 1, the existing smoke.** `npm run smoke:host` against the 2.3.0 CLI printed "PASS: the packed plugin loaded in the real host, its RPC schemas and storage worked across a restart, and the driver made no model request".
- **Command.** `context.command.transform(editor => editor.add({ name, description, execute }))` works. `execute` receives `{ sessionID, prompt, delivery }`; `prompt` has `text`, `files`, `agents` and `skills`; `text` is what follows the command name; a file carries `uri`, `name` and `mention { start, end, text }`. Calling the command adds nothing to the chat by itself. A throw in `execute` reaches the caller as `CommandExecutionError { message, command }` and leaves the chat unchanged.
- **Switch and send.** Inside `execute`, `session.switchAgent` to `plan`, then `session.switchModel`, then `session.prompt({ ...prompt, sessionID, delivery })` made exactly one request, on the chosen model, with the attached file's content in it. Afterwards the chat has that agent and model. It works across providers. A variant makes the request carry `reasoning_effort`. Switching to `plan` adds the host's Plan-mode reminder to the next request, and switching away adds a "NO LONGER in Plan mode" one. Selecting an agent does not change the chat's model.
- **A busy chat.** A single answer that is being written is not cut off. In a turn with several steps, `switchModel` takes effect at once for the remaining steps of the running turn, with `steer` and with `queue`. A `steer` message joins the running turn at its next step; a `queue` message is answered after the turn. `session.wait` resolves when the chat goes idle (4.7 s in one run, 6.5 s in the web-screen run). `wait` while helpers still run in the background was not tried.
- **Decider calls.** `experimental.generate.decisions` with a chat model fails with `Generate.UnsupportedModelError` ("is a chat model, not a decision model") and makes no request. `generate.text` works with an ordinary model: one request, no system text, no tools. No session hook fires for a stateless call (neither `experimental.model.resolve` nor `model.request`), so the spend guard does not see it. A stateless call cannot be stopped: giving up after 2 s, or passing a signal, changed nothing; the call settled at 12 s and the mock saw no abort.
- **Decision models (step 4).** One read-only `model.list` with the `decision` type against the owner's running service (only ids, names and prices were printed; the reply's shape was checked) returned two: `ollama-cloud/clef:27b` (input 0.24, output 0, USD per million tokens) and `opencode/jev-1.13-free` (0 and 0). The isolated host, with no credentials, lists `opencode/jev-1.13-free`. No decision request was made.
- **Plugin storage** is shared between projects: a value set from one project was read from another.
- **Helpers on 2.3.0.** A helper always runs in the background: the parent's tool result says the subagent is working in the background, and a `<subagent ... state="completed|error">` message arrives later. Without routing, a helper inherits the chat's model. The `subagent` tool takes `agent`, `description`, `prompt`, `model` and `sessionID`; its text for `model` tells the calling model never to set it unless the user asks. For a helper chat's first request these hooks fire with the helper chat's id: `prompt` (the task text, changeable), `experimental.model.resolve` (`session.get` gives `parentID`), `context` and `model.request`. The permission hook fires in the parent chat with `action: 'subagent'` and the helper type only. `experimental.idle` lists the running helpers.
- **Three ways to give a check the Review model, all tried.**
  - Resolve hook: another model of the same provider works. A model of another provider fails the helper ("Model unavailable"), and `switchModel` called from that hook only changes later requests.
  - Helper type: agent files and a plugin-created type both work. `editor.update(id, fn)` on a missing id creates the agent (undocumented; the editor has no `add`). The type is only used when the calling model picks it, or when the tool hook rewrites `input.agent`.
  - Tool hook: `context.tool.hook('execute.before', ...)` fires for each tool call with the parent chat's id and the tool's input. Replacing `event.input` with one that names a `model` (`provider/model#variant`) starts the helper on that model from its first request, across providers, with the effort. Text appended to `input.prompt` reaches the helper. A helper that is left alone stays on the chat's model. A throw in `execute.before` stops the helper from starting, the calling model receives the thrown message as the tool's error, and the plugin stays active.
- **Other routes that worked.** In the helper chat's `prompt` hook, `switchModel` (any provider) and `session.instructions.entry.put` take effect before the first request. A per-chat instruction entry reaches the model at the end of the system text as `<context key="...">`. A line added to a tool's description in the `context` hook reaches the model.
- **The host's own web screen** (the app that `opencode serve` serves, opened in headless Chromium with the throwaway password; this is not Desktop). The plugin command is in the `/` menu with its description. For `/probe forward hello @a.txt` the command received `delivery: steer`, the text without the command name, and the file; the file's `mention` range (21 to 27) counts from the start of the typed line, command name included. The chat then showed a "Switched to Model Two" line, the sent message and the answer, and the agent and model under the chat box changed to Plan and Model Two. The typed command line itself is not shown. A command that throws shows a "Failed to send command" note and leaves the typed text in the box. A command typed while the chat was answering also arrived with `delivery: steer`; it waited 6.5 s in `wait` and then switched, and the running answer finished on the old model.
- **Isolation gaps.** With scratch `XDG_*` directories and a scratch project under `%TEMP%`, the host still listed 34 skills: 3 built in, 16 from `~/.agents/skills` and 15 from `~/.claude/skills`. It named them in the system text and in the `@` menu (sent only to the loopback mock). Pointing `USERPROFILE` and `HOME` at the scratch root did not change that; the cause was not found. The Plan-mode reminder and the `plan` agent's permissions name `~/.opencode/plan` in the real home; nothing was created there. The repo's own smokes use the same layout. Two early `--version` reads ran without the scratch directories and left two "cli starting" lines in the real profile's log.
- **The command for the Desktop check, tried here first.** A second throwaway plugin with one command and no hooks (`/relay-check`) was loaded beside the probe. It reads the chat's model and the host's model list, picks a model that is listed at 0 in and 0 out, switches to `plan` and that model, and forwards the prompt unchanged. With the mock models it made exactly one request for each call, with the file attached, and a second call moved the chat to the other mock model. Seen on the way: a model's `cost` is a list of price tiers; the mock models carry an empty list; the isolated host, with no credentials, lists 12 `opencode` chat models, and the three that were looked at each carry one tier of 0 and 0; a switch to the agent the chat is already on adds another `agent-switched` record. No request went to an `opencode` model, and the plugin is not installed anywhere.
- **Not tested:** Desktop (the command, the switch, an image); any real model, and a real decision request (speed, cost, the shape of the answer); the owner's other plugins loaded, Superpowers among them; an image attachment; `wait` while helpers run; a follow-up `subagent` call with `sessionID` through the tool hook; the terminal app; any other platform.

## 2026-11-14 — Stage 0, the Desktop check: one throwaway command in the owner's real OpenCode 2.3.0 (Windows 11, real models)

Platform: Windows 11, OpenCode Desktop 2.3.0 (the app's file version is 2.3.0.0, and the background service logged "cli starting" with `version=2.3.0`), the owner's real profile and real providers. `AGENTS.md` forbids testing in a real profile; the owner asked for this check ("yes run the desktop for real check"), and it covers this one step only. Loaded beside the test: Superpowers, `@upstash/context7-opencode`, `opencode-skills-collection`, `opencode-context-indicator`, the installed copy of Relay from 13 Nov, `@plannotator/opencode` (set to act on the `plan` agent) and `opencode-pty-v2`. `opencode-mem` failed to load, as it did before the check ("Cannot find package '@libsql/client'"; about 1,900 such lines in the service log).

What was added: one line in `~/.config/opencode/opencode.json` that loads a throwaway plugin with one command and no hooks, `/relay-check`. A message switches the chat to the `plan` agent and to a free `opencode` model, then sends the message once. The word `decide` asks the free decision model one `choice` question instead. The same file was tried in the isolated host first. The owner typed in Desktop, and the plugin wrote what it received to a local log (typed text and file names, never file contents). Afterwards the config was restored byte for byte (same SHA-256 as the backup), and the plugin, its log and the backup were deleted. A small test folder with the owner's two test chats remains at `~/feature-pilot-install/relay-check-project`.

- **Loading.** No Desktop restart was needed. The running service logged `config.updated` within a second of the edit and set the plugin up in the folder that was open about two seconds later. Under a minute after each of the two config edits (adding the line, removing it) the service process was replaced by a new one ("cli starting" with `serve --service`). The host also watches each local plugin's folder and entry file.
- **Plugins are set up again about once an hour.** With nothing changed, the service evicted the services of its open folders about every 61 to 68 minutes ("location services evicted", often several folders in the same second), and the next request loaded every plugin again in the same process, so the plugin's `setup` ran again. The log shows the same pattern through the night before the check. It looks like an idle timeout, which was not confirmed, and it is not known whether it can happen while a chat is answering. Anything a plugin holds only in memory is lost each time.
- **The command.** `/relay-check` ran when typed. `delivery` was `steer` for an idle chat. `prompt` had `text`, `files`, `agents` and `skills`, and `text` came without the command name. For `/relay-check wahts in @a.txt` the file arrived as `{ uri, name, mention }` with no type field, and `mention` was `{ start: 22, end: 28 }`: counted from the start of the typed line, command name included, as on the web screen.
- **Switch and send, with real models.** Four messages in two chats. Each time `switchAgent` to `plan` took 3 to 16 ms, `switchModel` 2 to 12 ms and `prompt` 3 to 39 ms, and each command called `prompt` once. The next command in the same chat found the chat on `plan` and on the model chosen before. The chats started on the owner's usual model (`ollama-cloud/deepseek-v4.1-flash:1017`, agent `build`) and were moved to `opencode/nemotron-3.5-super-vl-free` and `opencode/glm-5.3-flash-free`, both listed at 0. Requests cannot be counted at a real provider, so "once" rests on the plugin's log and on what the screen showed.
- **What Desktop showed** (the owner's screenshot after the first two messages). For each message: an "Updates" heading, a line "Switched to" with the model's name, the message without the command name, and one answer. The typed `/relay-check ...` line itself is not shown. The model named under the chat box changed. The answer to the `@a.txt` message quoted the file's text and the screenshot shows no tool call, so the attached content arrived. The screenshot shows no agent under the chat box (the host's web screen showed "Plan" beside the model), so the screen did not show that the chat had moved to `plan`.
- **A new chat** started on the owner's usual model and the `build` agent after the first chat had been switched. A switch in one chat does not change what a new chat starts with.
- **A line that does not start with `/` is not a command.** The owner typed `@red.png /relay-check whats in the pic`. It was sent as a plain message: the plugin logged nothing, the chat shows the whole line, and the model the chat was on (`opencode/glm-5.3-flash-free`) described the picture as red. So an `@`-mentioned picture reaches a model with image input in a plain message.
- **The decision model answered.** From the plugin, `model.list` with `types: ['decision']` listed `ollama-cloud/clef:27b` (price 0.24 in, 0 out) and `opencode/jev-1.13-free` (0 and 0). `experimental.generate.decisions` with `opencode/jev-1.13-free`, one text input and one `choice` question with three described choices returned `{ answers, cost, tokens, native }`, and the answer was `{ type: 'choice', name: 'mode', choice: 'execute', probabilities, confidence }`. The line was sent twice, eight seconds apart (one request was planned). The answers came after 144 ms and 166 ms, with `execute` at 0.98 and 0.99 and confidence 0.97 and 0.98, so the same input does not give exactly the same numbers. Both reported `cost: 0`, 418 input tokens and 38 output tokens, and the provider's own record said `billing_source: "free"`.
- **The owner's model list** held 38 chat models. Eleven of them are `opencode` models whose id ends in `-free`, each with a price of 0; four of those take no image input.
- **Not tested:** a picture sent through the command (pasted, dragged or `@`-mentioned), and what a pasted picture looks like in `prompt.files`; whether the command is listed in Desktop's `/` menu (the owner typed it and did not say); a command typed while the chat is answering; what Plannotator adds to a chat on `plan`; helpers started through Superpowers with real models, which was the second half of this step; the paid decision model `ollama-cloud/clef:27b`; a long message to the decider; a chat or a command that is running when the hourly eviction or a service restart happens; whether a chat in another folder was running when the service restarted (the log does not record chat messages; before the removal the service had written nothing for 25 seconds); the terminal app; macOS and Linux.

## 2026-11-14 — Stage 1 of the `/relay` plan, Task 1: the packages moved to 2.3.0, and the two packed-plugin smokes on an isolated 2.3.0 host (Windows 11, mock provider)

`@opencode/client`, `@opencode/plugin` and `@opencode/schema` went from 2.2.7 to 2.3.0 (`effect` stays 4.1.0). `npm run typecheck` passed with no change to the code. The CLI was the one bundled with Desktop (`opencode v2.3.0`). Each smoke packs the built plugin, installs it into a scratch project and starts an isolated `serve` with its own config, data, cache and state folders.

- **`npm run smoke:host`: PASS.** The packed plugin loaded (`features: server, gui`, state `active`), its RPC schemas and its storage worked across a restart, and the driver made no model request. Budget backend `local_file`. The host listed 12 models with no credentials.
- **`npm run smoke:host:model`: PASS.** On stock 2.3.0 the local-file ledger let one planner request reach the loopback mock model, refused one that did not fit its budget, and kept the reservation of `0.039` across a restart.
- **Plugin storage in 2.3.0** still has `get`, `set`, `remove` and `scan` only (`node_modules/@opencode/plugin/dist/promise/storage.d.ts`), so there is no `compareAndSet`, as on 2.2.7.
- **Not tested:** anything of Stage 1 (no `/relay` code existed yet), a real provider, the coder, the reviewer, the shell tool, a worktree run and the Desktop panel.

## 2026-11-14 — Stage 1 of the `/relay` plan, Tasks 7 and 8: `/relay` on an isolated 2.3.0 host (Windows 11, mock provider)

`npm run smoke:host:model` now also sends one `/relay` message. The CLI was the one bundled with Desktop (`opencode v2.3.0`), run with scratch config, data, cache and state folders and a throwaway password. The only provider with a key was the loopback mock. Nothing was installed in a real profile and no request reached a real provider.

- **The plugin loads with the command and the tool hook registered**, and the older parts of the smoke (one planner request, the refused one, the reservation across a restart) still pass.
- **A blank `/relay` is refused with the plugin's own words.** `client.session.command({ sessionID, name: 'relay', text: ' ' })` rejected with "Relay: type your message after /relay." So an error thrown inside a command's `execute` reaches the caller of `session.command`.
- **`/relay Say hello.` with no decider chosen made exactly one model request**, on the chat's own mock model, with the typed text as the last message. The record read back through `getRelay` was one decision: kind `chat`, this chat, no mode, no model, note `no decider chosen`. The chat stayed on its model.
- **`experimental.session.wait` on an idle chat returned at once** (5 ms).
- **A small model makes the host compact a new chat before its first turn.** The first runs of this part failed with two extra model requests. The chat was on a mock model that holds 8,000 tokens, and the two requests were the host's own ("You MUST summarize the conversation above…", then "The previous response did not fill in the required summary template…"), each with the host's system text and 12 tools. `/relay` had not sent twice. With a mock model that holds 200,000 tokens there is one request. Relay leaves a model out only when the attached files do not fit it, so a chat sent to a very small model can still be compacted by the host.
- **The isolated host with no login lists one decision model**, `opencode/jev-1.13-free`.
- **Not tested:** the decider on this host (no mock can be a decision model, so no decision request was made); a switch of agent or model through `/relay`; the review rules entry; a busy chat; a picture or a file through `/relay`; the tool hook with a real helper (no helper was started, so the hook has only run against fakes); a real provider; the Modes tab in Desktop; macOS and Linux.

## 2026-11-14 — Stage 1 of the `/relay` plan, Task 10: thirty made-up messages through a real decision model, from an isolated 2.3.0 host (Windows 11, no login)

The owner said yes on 14 Nov to this one step: made-up messages to the free decision model, from a separate OpenCode with no login, at most 90 requests. `npm run examples:decider` (`scripts/decider-examples.ts`) started the CLI bundled with Desktop (`opencode v2.3.0`) with scratch config, data, cache and state folders and a throwaway password, with no plugin and no credential. It sent the 30 labelled examples of `scripts/relay-examples.json`, one request each, through `experimental.generate.decisions` to `opencode/jev-1.13-free` (listed price 0 in and 0 out), and read each answer with Relay's own `decide`, `route` and `pickModel`. Two runs were made, 60 requests in all: run 1 in the file's order, run 2 starting at the sixteenth example. The third allowed run was not made. The owner's own OpenCode, settings and chats were not touched.

Each request held the made-up message, the name of the chat's agent (`plan` or `build`), for three examples one made-up file name with a size, "Attached pictures: 0", the mode question, and three line questions over one sample set of "use it for" lines (two lines for each mode).

Run 2 printed this. Run 1 printed the same counts in the script's earlier wording (it did not yet keep what the decider itself said), with a first request of 1187 ms and the other 29 at a median of 128 ms, the slowest 448 ms.

```
Decider: opencode/jev-1.13-free ($0 or not listed) on opencode v2.3.0; 30 requests from an isolated OpenCode with no login.
Right mode: 30 of 30. Gate 1 needs at least 27: pass.
Sent to Execute by mistake: 0. Gate 1 needs 0: pass.
Not-sure rule (under 60% sure means Plan): changed 1 of 30 answers; 1 became right, 0 became wrong.
Off the expected line: 1 of 30 (0 wrong line, 1 no line where one was expected, 0 a line where none was expected). Gate 1 allows 3: pass.
Time: first request 1181 ms; the other 29: median 132 ms, slowest 254 ms. Gate 1 needs under 1000 ms: first request MISS, the others pass.
Cost the host reported: $0 (30 of 30 requests reported one).
No answer: 0 of 30.
Mix-ups:
- line: "explain this" expected Plan line 2, got no line (the decider said none, 80% sure)
- rule: "how would you fix this?" is Plan only by the not-sure rule (the decider said Execute, 28% sure)
LIMIT: made-up messages, one sample set of lines, one decision model, one run. No chat, switch or plugin was involved.
```

- **An isolated host with no login can ask `opencode/jev-1.13-free`.** It answered all 60 requests, and the host reported a cost of 0 for each.
- **Mode: 30 of 30 in both runs.** Both runs gave the same mode and the same line for every example. The decider's confidence in the mode moved by at most 0.06 between the runs.
- **Nothing that is not Execute went to Execute, for one message only because of the not-sure rule.** For "how would you fix this?" the decider itself said Execute, 28% sure in run 2 (run 1: 26% sure, and its own answer was not kept). Under 60% means Plan, so it went to Plan. Three more Plan messages (rows 3, 6 and 10) were answered Plan with only 25% to 52%. "ok, do it" on a chat that is on `plan` got Execute with 64% both times, four points above the rule.
- **Line: 29 of 30 as labelled.** "explain this" was labelled Plan line 2, and the decider chose none both times (80% sure in run 2). The label was not changed after the runs; the owner decides which is right.
- **Time: the first request of a freshly started host took 1187 ms and 1181 ms, whichever example came first.** The other 58 took 102 to 448 ms. The time is measured around `decide`, and here that includes one loopback HTTP call which `/relay` inside the plugin does not make. Gate 1 asks for under 1 second: every request but the first one meets it. Whether the first `/relay` after OpenCode starts is as slow was not measured.

The 30 examples in the file's order. "Decider's own mode" is from run 2. Line 1 and line 2 are the sample lines of the expected mode: Plan 1 "hard thinking: architecture, design, comparing options and trade-offs", Plan 2 "understanding existing code: what it does, why it behaves this way, where something is", Execute 1 "small, quick edits: typos, renames, one-line fixes, config values", Execute 2 "larger work: new features, refactors, changes across several files", Review 1 "security: secrets, auth, injection, permissions", Review 2 "correctness: bugs, edge cases, missing tests".

| # | Message | Expected | The decider itself said (run 2), and how sure (run 1 / run 2) | Line answer (run 2) | ms (run 1 / run 2) |
|---|---|---|---|---|---|
| 1 | explain this | Plan, line 2 | Plan 100% / 100% **line off** | none 80% | 1187 / 113 |
| 2 | how would you fix this? (near miss) | Plan, no line | Execute 26% / 28% → Plan by the rule | none 76% | 128 / 102 |
| 3 | why is login slow? @src/auth.ts (with a file) | Plan, line 2 | Plan 28% / 25% | line 2 98% | 111 / 105 |
| 4 | what are the trade-offs between keeping sessions in redis and in postgres? | Plan, line 1 | Plan 100% / 100% | line 1 100% | 142 / 140 |
| 5 | should we split billing into its own service? give me the pros and cons (near miss) | Plan, line 1 | Plan 100% / 100% | line 1 100% | 149 / 172 |
| 6 | which of these two ways to fix the retry bug is safer? (near miss) | Plan, line 1 | Plan 37% / 38% | line 1 96% | 133 / 122 |
| 7 | what does the migration script change in the users table? (near miss) | Plan, line 2 | Plan 72% / 72% | line 2 98% | 184 / 141 |
| 8 | design a data model for team invitations with expiry and roles | Plan, line 1 | Plan 61% / 64% | line 1 100% | 136 / 120 |
| 9 | how should we restructure the checkout flow so it stops being flaky? compare two options (near miss) | Plan, line 1 | Plan 98% / 100% | line 1 100% | 128 / 188 |
| 10 | why does the fix for the timezone bug not work? (near miss) | Plan, line 2 | Plan 46% / 52% | line 2 88% | 125 / 173 |
| 11 | what would it take to move the public API from REST to gRPC? (near miss) | Plan, line 1 | Plan 100% / 100% | line 1 100% | 145 / 104 |
| 12 | Please find out why the login test fails and fix it. | Execute, no line | Execute 100% / 100% | none 49% | 155 / 107 |
| 13 | Review this and fix it | Execute, no line | Execute 92% / 94% | none 96% | 132 / 132 |
| 14 | ok, do it (follow-up, chat on plan) | Execute, no line | Execute 64% / 64% | none 98% | 130 / 115 |
| 15 | rename getUser to fetchUser in api.ts | Execute, line 1 | Execute 100% / 100% | line 1 100% | 117 / 143 |
| 16 | fix the typo in the README title | Execute, line 1 | Execute 100% / 100% | line 1 100% | 110 / 1181 |
| 17 | add CSV export to the reports page, with tests | Execute, line 2 | Execute 100% / 100% | line 2 100% | 105 / 153 |
| 18 | yes, go ahead with the refactor you proposed across the three services (follow-up, chat on plan) | Execute, line 2 | Execute 79% / 83% | line 2 100% | 161 / 182 |
| 19 | bump the request timeout to 30 seconds in config.yaml | Execute, line 1 | Execute 100% / 98% | line 1 100% | 124 / 125 |
| 20 | refactor the payment module to use the new client everywhere | Execute, line 2 | Execute 98% / 97% | line 2 100% | 129 / 110 |
| 21 | run the unit tests and tell me which ones fail | Execute, no line | Execute 88% / 88% | none 96% | 448 / 142 |
| 22 | looks right, apply it (follow-up, chat on plan) | Execute, no line | Execute 94% / 94% | none 50% | 114 / 218 |
| 23 | review my changes for security problems before I push | Review, line 1 | Review 100% / 100% | line 1 100% | 105 / 142 |
| 24 | check this diff for bugs and missed edge cases (with a file) | Review, line 2 | Review 100% / 100% | line 2 100% | 135 / 133 |
| 25 | does this PR leak any API keys or tokens? (with a file) | Review, line 1 | Review 100% / 100% | line 1 100% | 104 / 127 |
| 26 | look over the new upload handler and tell me what is wrong with it, don't change anything (near miss) | Review, line 2 | Review 100% / 100% | line 2 73% | 115 / 125 |
| 27 | is the SQL in reports.ts safe from injection? | Review, line 1 | Review 89% / 89% | line 1 100% | 214 / 121 |
| 28 | before I merge: did my fix for the null check cover every caller? (near miss) | Review, line 2 | Review 98% / 98% | line 2 100% | 128 / 138 |
| 29 | review the README wording for tone and clarity | Review, no line | Review 94% / 96% | none 100% | 102 / 110 |
| 30 | would this change break anything? just check, don't fix (near miss) | Review, line 2 | Review 100% / 100% | line 2 83% | 110 / 254 |

- **Both packed-plugin smokes passed again on this build** (`npm run smoke:host` and `npm run smoke:host:model`, the same CLI, scratch folders and the loopback mock provider only). They show what the Tasks 7 and 8 entry shows and nothing more.
- **Not tested:** the decider inside the plugin (`context.experimental.generate.decisions`), because no plugin was loaded; a switch of agent or model; a helper's task (all 30 are chat messages); pictures; a message over 4,000 characters; other lines, more than two lines for a mode, or a mode with one model (which asks no line question); any other decision model, `ollama-cloud/clef:27b` among them; other languages; a provider that limits or refuses requests; what the host puts on the wire for a decision request (no mock can be a decision model, so the request to the provider was never seen); macOS and Linux. The 30 labels and the sample lines are the builder's, and the owner has not checked them yet.

## 2026-11-15 — Stage 1 final whole-branch review and fix pass: both smokes re-run on the fixed build

A fresh reviewer (Opus 5.5) found two Critical and three Important issues in Tasks 1-10 (out-of-order `/relay` messages in one chat; a host call that never answers hanging `/relay`, the helper hook, and — through a storage queue Relay shared with the older pipeline — potentially the pipeline's own spend guard; an emoji at the 80-character file-name cut; a busy-wait that ran even when nothing needed changing; a privacy sentence silent on helper task text). All five were fixed, each with its own test (red then green); the whole suite and the ledger entries are in `docs/implementation-progress.md` and `.superpowers/sdd/2026-11-14-relay-stage-1/progress.md`. This entry is only about what ran against a real host afterward.

- **Both packed-plugin smokes passed again on the fixed build** (same CLI, `opencode v2.3.0`, scratch folders, loopback mock provider only; no real model, no Desktop, no login). `smoke:host`: "the packed plugin loaded in the real host, its RPC schemas and storage worked across a restart, and the driver made no model request." `smoke:host:model`: "on stock opencode v2.3.0 the local-file ledger let one planner request reach the mock model, refused one that did not fit its budget, and kept the reservation across a restart; /relay with no decider sent one message to the chat's own mock model and recorded it."
- **Not tested, added to the list above:** whether `switchAgent` changes the model when the target agent has its own configured model, with the owner's real agent configuration (Stage 0 saw no such change with stock agents on a fake host); the fix pass's new timeouts (`readMs`, Relay's own separate storage queue) under a real host's real timing, since no mock can make a call hang the way the fix pass's tests do with fakes.

## 2026-11-16 — the `prompt` hook for a per-chat Relay switch (isolated 2.3.0, Windows 11, mock provider)

The owner asked for a switch that sends every message in a chat through Relay (`/relay on`, `/relay off`, and a pill). Before designing it, two throwaway probes (not in the repo) ran on the CLI bundled with Desktop (`opencode v2.3.0`), with scratch config, data, cache and state folders, a throwaway password, a loopback mock provider with two models, and a probe plugin that registered `context.session.hook('prompt', ...)` and one command. No login, no real provider, no plugin of the owner's. Messages were sent with the client's `session.prompt` and `session.command`.

- **A model switch inside the `prompt` hook serves that same message.** The hook fired for "please SWITCH-TO-TWO now", called `session.switchModel`, and the request for that message went to the second model. The chat kept the new model for the next message.
- **An agent switch inside the hook also serves that same message.** On a chat created on `plan`, `session.switchAgent` to `build` inside the hook put the host's "no longer in Plan mode" reminder into that message's own request, and the chat stayed on `build`.
- **A plugin's own `session.prompt` fires the hook, with its metadata.** A command that sent its text with `metadata: { relayProbe: ... }` produced one hook event carrying that metadata, so a plugin can mark its own sends and skip them. The command invocation itself fired no hook.
- **A synthetic message does not fire the hook.** `session.synthetic` with `resume: true` reached the model with no hook event.
- **The hook fires when a message is submitted, also while the chat is busy.** With a 3-second turn running, a `queue` message and a `steer` message each fired the hook at once; a switch made there was in place for that message, which was answered after the running turn. `session.get` carries no busy flag. `session.wait` called inside the hook returned in about 1 ms on an idle chat and had not returned after 300 ms on a busy one, with no deadlock.
- **A hook that throws fails the message.** A probe bug made the hook throw; the client's `session.prompt` then failed with HTTP 500. A routing hook must catch everything.
- The prompt the hook sees has `text`, `files`, `agents` and `skills`, the same shape a command receives.
- **Not tested:** a helper's completion notice (assumed to arrive like a synthetic message, not checked); files or pictures through the hook; the terminal app's own screen; Desktop; a real provider; a multi-step turn while a switch lands mid-turn (Stage 0 found that a switch changes the remaining steps of a running turn); macOS and Linux.
- **The built switch on the same isolated host (later the same day).** `npm run smoke:host:model` now also sends `/relay on` in its `/relay` chat, a plain message, a `/relay` message, `/relay off` and one more plain message, all with no decider chosen (no mock can be a decision model, so nothing is switched). PASS: each message made exactly one model request; with the switch on, the plain message got one record and the `/relay` message one record, not two; with it off, the last message got none. `npm run smoke:host` also passed on this build. Not run: a switch to another model through the hook with a real decider, the pill, the terminal app.

## 2026-11-16 — Task 6: the live check in the owner's OpenCode Desktop 2.3.0 (Windows 11, Ollama Cloud models)

The owner said yes to fixing their stuck OpenCode and to my testing Relay in it ("Yes, fix and test"), with real Ollama models and a $2 limit. Desktop 2.3.0 (Electron 44.9.1) with its bundled CLI 2.3.0; Relay loaded from this repository's `dist/`. I drove Desktop through a debugging port bound to 127.0.0.1 (Desktop restarted with `--remote-debugging-port`, from an environment without Claude Code's variables) and restarted it normally afterwards.

**Why the panel, "Open Relay" and the Plugins list were missing.**
- At 14:20 local time Desktop judged the owner's background service unresponsive and replaced it. The new service failed to boot one second after the old process was killed: `SqlError: Failed to configure database (cause: SQLiteError: disk I/O error)`. The failed process stayed alive, kept port 28894 and answered Desktop's `/api/info` check with HTTP 500.
- Desktop's main process does not replace a service in that state: its start-up step throws "Background service failed to start" and retries every 2 seconds (931 times in its newest log alone). With no server, Desktop listed no plugins, so it never got Relay's panel; the terminal app could not connect either.
- The database then passed SQLite's `quick_check` (read-only). Ending the failed process let a fresh service start, and the Plugins list, the panel, the palette entry and the pill all appeared.
- Underneath: since at least 10 Nov, three days before Relay was first installed, the owner's service often takes 40 to 90 seconds to open a project, with nothing logged meanwhile. Desktop's 2-second health checks time out and Desktop replaces the service, often 10 to 19 times an hour. While that loop runs, Desktop's plugin listing failed ("fetch failed", "Plugin listing timed out after 30000 ms"), and during this check Desktop said for about 20 seconds that it could not reach the computer. The cause of the slow opening was not found. Loading the plugins, Relay included, took about half a second of it.

**What Desktop shows.** Settings → Extensions has three tabs: MCPs, Plugins and Skills. A plugin whose desktop UI Desktop has loaded gets Reload and a switch; the badges name only its other parts (`feature-pilot` showed "Server"). With no server the tab stays empty, with no error. "Open Relay" appears in the command palette (Ctrl+K) while a chat is open.

**The test, in the throwaway project `relay-live-test`, in one chat.** Modes tab: Plan `ollama-cloud/kimi-k3.1-pro`; Execute `ollama-cloud/glm-5.3` ("bigger changes across several files, new features") and `ollama-cloud/minimax-m3.1-flash` ("small quick fixes in one file"); Review `ollama-cloud/deepseek-v4-pro`; decider `ollama-cloud/clef:27b`. The settings were stored at once (`relay/settings`).

| Sent | Relay's record | What happened |
|---|---|---|
| Try box: "fix the typo in the README title" | Execute, minimax-m3.1-flash, 93% sure, line fit 98%, 1912 ms | (nothing sent to a chat) |
| switch on, plain: "In two sentences, what does src/calc.js do?" | Plan, kimi-k3.1-pro, 87% sure, 2184 ms | "Switched to Kimi K3.1 Pro", answered |
| `/relay fix the off-by-one bug in average() in src/calc.js` | Plan, kimi-k3.1-pro, 51% sure, "not sure, so Plan" | **wrong** (below). The `plan` agent called Plannotator's `submit_plan`, then edited the file, and was stopped |
| (fix built and loaded) `/relay make largest() in src/calc.js return 0 for an empty list` | Execute, minimax-m3.1-flash, 93% sure, line fit 96%, 549 ms | "Switched to MiniMax-M3.1-Flash", edited and checked the file |
| `/relay review src/calc.js and list any remaining bugs, briefly` | Review, deepseek-v4-pro, 91% sure, 899 ms | "Switched to deepseek-v4-pro", ended with "Verdict: approve" |
| pill → "Turn Relay off for this chat" | flag stored `false` | pill read "Relay off" |
| switch off, plain question | no record | stayed on deepseek-v4-pro, no switch line |
| `/relay on` | flag stored `true` | pill read "Relay on" about a second later; nothing went to a model |
| switch on, chat on `plan`, plain: "add a one-line comment above largest() …" | Execute, minimax-m3.1-flash, 90% sure, line fit 94%, 352 ms | edited the file |
| switch on, plain: "Start a helper (subagent) to check src/calc.js for bugs …" | chat: Review, deepseek-v4-pro, 71%; helper: Review, deepseek-v4-pro, 92%, 342 ms | the helper's own chat ran on `ollama-cloud/deepseek-v4-pro` (OpenCode's record), $0.016 |

**The bug: the agent's name pulled the decider to Plan.** The decider was told "The chat is on the agent: plan", and "plan" is also one of its answers. Relay's own request, sent to the decisions API with only the agent changed, for "fix the off-by-one bug in average() in src/calc.js": agent `plan` 0.510 sure of execute (twice), `build` 0.935, none 0.925. Three wordings over four messages:

| Message (agent) | agent's name | no agent line | "a read-only agent … cannot change files" |
|---|---|---|---|
| the fix (plan) | execute 0.51 | execute 0.92 | execute 0.90 |
| "ok, do it" (plan) | execute 0.80 | execute 0.90 | execute 0.88 |
| "what does src/calc.js do?" (plan / build) | plan 0.92 / 0.93 | plan 0.93 / 0.92 | plan 0.97 / 0.93 |
| "review src/calc.js and list any bugs" (plan / build) | review 0.91 / 0.94 | review 0.94 / 0.94 | review 0.92 / 0.93 |

Fixed in `src/decider.ts`: `plan` is described as a read-only agent and `build` as one that can change files; other agents are not mentioned, and no agent's name is sent. The panel and the README say so. The service reloaded the rebuilt `dist/` in place, without a restart, and the next fix request in a chat on `plan` went to Execute (rows above).

**Other findings.**
- With Plannotator installed, a turn on the `plan` agent submitted a plan and then edited a file in the same turn. Plan's "cannot change files" depends on the `plan` agent, which another plugin can change.
- `opencode run "/relay on"` does not run the command: it sent the text to the default model as a plain message (an archived session, $0). Slash commands belong to the interactive terminal app.
- Right after a decision, the Modes tab's "Last choice" line still showed the previous one, while the pill's menu showed the newest. Not followed up.

**Cost.** The test chat went from $0.01 to $0.22 (OpenCode's figure, the helper included). About 40 decider requests (Try box, the experiments above) at $0.24 per million input tokens came to about a cent. Far under the $2 limit.

**Not tested:** pictures and attached files through Relay; the bigger-changes Execute model (`glm-5.3` was never picked); the interactive terminal app (I could not type into it); a busy chat with the switch on; macOS and Linux.

## 2026-11-17 — Stage 2 and a live check with Claude models (Desktop 2.3.0 on Windows 11; the smoke on Linux, macOS and Windows)

The owner said: "yes use claude models like sonet or haiku and test extensively. make quick fixes. remove hide yes complete next steps and report to me". Desktop 2.3.0 with its bundled CLI 2.3.0; Relay loaded from this repository's `dist/`. I drove Desktop through a debugging port bound to 127.0.0.1, as on 16 Nov, and restarted it normally afterwards.

**The smoke on three systems (mock model, no decider).** CI run 44056649850 for b28c1f1, with the binary from `@opencode/cli-<os>-<arch>@2.3.0`: the smoke passed its checks on ubuntu-latest, macos-latest and windows-latest. The packed plugin loaded from `node_modules`; `/relay` with no decider sent one message to the chat's own model and recorded it; `/relay on` kept the switch across a server restart and placed each plain message once; `/relay off` stopped it. The Windows job then failed to delete its scratch folder (EBUSY), so the script now retries and only warns. Locally on Windows with Desktop's bundled CLI: PASS twice.

**The settings.** Plan `claude-agent/sonnet` (Sonnet 5.5); Execute `claude-agent/haiku` ("small quick fixes in one file") and `claude-agent/sonnet` ("bigger changes across several files, new features"); Review `claude-agent/sonnet`; decider `ollama-cloud/clef:27b`. The `claude-agent` provider (`aisdk:@opencode/claude-agent`) lists no price, so OpenCode showed no cost for these turns.

**The panel.** It now has no tabs. Prices sat beside each chosen model and in all 196 "Add a model" entries. "Cheapest first" put 48 "$0 or not listed" entries first, then 78 priced ones in ascending order (input, then output), then 70 "price not listed" ones last (every `claude-agent` model among them). Spot checks against the catalog: GLM-5.3 $1.40 in / $4.40 out, gpt-oss:20b $0.07 / $0.30. With no decider, the panel showed its warning, and the pill read "Relay on · no decider" with a warning icon. The pill's row opened the closed panel, and both warnings cleared when Clef was chosen again. The "Last choice" line updated by itself within 5 seconds of each decision.

**One new chat in `relay-live-test`, Relay on.**

| Sent | Relay's record | What happened |
|---|---|---|
| `/relay on` in a new chat | flag stored | the chat was created; nothing went to a model ($0.00) |
| "In two sentences, what does src/text.js do?" | Plan, Sonnet, 90% sure, 398 ms | "Switched to Sonnet 5.5"; answered, and named the planted bug |
| a one-line comment at the top of `src/text.js` | Execute, Haiku, 92%, line fit 97%, 471 ms | Haiku made exactly that edit |
| a new `src/stats.js` and `src/index.js` | Execute, Sonnet, 93%, line fit 96%, 437 ms | Sonnet created both files |
| "Review src/text.js and list any bugs you find." | Review, Sonnet, 92%, 553 ms | found the planted `slice(0)` bug on the first check; "Verdict: request changes" |
| "Fix the blocking bug the review found in src/text.js." | Execute, Haiku, 93%, line fit 94%, 750 ms | `slice(0)` became `slice(1)` |
| "Review src/text.js again and give your verdict." | Review, Sonnet, 86%, 470 ms | "This is the second check of this work … Verdict: approve." |
| `/relay what does @src/calc.js export? …` | Plan, Sonnet, 42%, "not sure, so Plan" | decided once (the send carried Relay's marker); the file arrived as a file part; answered correctly |
| `/relay do what the attached picture says.` with a pasted picture | Plan, Sonnet, 30%, "not sure, so Plan" | the picture never reached the chat (finding 2) |
| the same as a plain message, before the fix | 57%, "not sure, so the chat stays as it is" | Desktop had put the chat on deepseek-v4-pro (finding 1), which cannot read pictures |
| `/relay what does @assets/task.png say? …` | Plan, Sonnet, 80% | the picture arrived as an image part (`image/png`); Sonnet read it word for word |
| a long request, then a second message about 2 seconds later | the second: Execute, 93%, "the chat was still busy after 0.3 seconds" | nothing was switched mid-answer; the second message queued |
| (after the fixes) a small edit | Execute, Haiku | Desktop's model picker then read "Claude Agent / Haiku 5.5" |
| `/relay off`; `/relay` a question; an ordinary follow-up | Plan, Sonnet | the picker followed to Sonnet, and the follow-up was answered by Sonnet (on `build`, finding 1) |
| `/relay on`; a plain message with a pasted picture (after the fix) | Execute, Sonnet, 66%, "no line fits clearly, so the chat's model stays" | the picture counted; Sonnet read it and made the edit |
| "Start a helper (subagent) to check src/stats.js for bugs …" | chat: Review, Sonnet, 69% | Sonnet named a model in the helper call, so Relay left the helper alone (finding 3) |

A Superpowers run ("subagent-driven development", two small tasks) finished: two implementer helpers and four review helpers (two spec, two quality); `range()` was added and the new test file passed 15 of 15.

**Findings.**

1. Desktop sends its model picker's model and its agent with every message (in the message's `metadata.model` and `metadata.agent`), and OpenCode switches the chat to them before the plugin's `prompt` hook runs. The picker did not follow Relay's switches (seen with `claude-agent` models), so after a one-off `/relay` the next ordinary message went back to the picker's model (deepseek-v4-pro), and each switch showed two lines ("Switched to deepseek-v4-pro", then "Switched to Sonnet 5.5"). With Relay on, the hook switched again, so each message still reached Relay's pick. **Fixed:** the pill puts Relay's pick in the picker (`screen.composer.setModel`) once per new switch, while that chat is on screen; verified live. **Not fixable from a plugin:** the agent. The GUI API has no agent setter, so a message after a `/relay` to Plan or Review runs on `build`, with the model Relay chose.
2. Desktop 2.3.0 sends a pasted picture as an upload: an "Attached file: `<temp path>`" line in the text and an entry in `metadata.attachments`, with no file part. Relay counted file parts only, so a pasted picture could go to a model without image input. **Fixed:** the switch's hook counts uploads, pictures by their `image/*` type and other files by name and size; verified live. The `/relay` command never receives Desktop's uploads (its input holds the text, @-mentioned files and agents), so a picture pasted into a `/relay` message is lost before Relay sees it. An @-mentioned picture works.
3. Superpowers' subagent-driven development, run by Sonnet, named a model in every helper call (`claude-agent/sonnet`; its first try named `anthropic/claude-sonnet-5-5`, which is not connected here). By design Relay leaves such a helper alone, so none of the four checks was routed or recorded. They ran on Sonnet because the caller picked it, and Sonnet is also the Review model. A plain "start a helper to check …" from Sonnet also named its model. On 16 Nov deepseek-v4-pro started a helper without naming one, and Relay routed it.
4. A `/relay` message with an @-mention shows the mention's highlight seven characters late: OpenCode gives the command the text without "/relay " but keeps the mention's position in the whole line. Cosmetic; not changed.
5. Desktop replaced the background service twice during the check (09:36 and 09:40 UTC), again after the service went silent for over a minute while loading plugins for a project, as seen since 10 Nov. Relay's calls made while plugins were loading waited about 24.5 seconds and then failed with HTTP 400, and Desktop's window needed a reload to show the panel again.
6. A Desktop started with the debugging port passes the listening socket to the background service it starts. After Desktop was restarted normally, 127.0.0.1:9333 still accepted connections and answered nothing, until that service is next replaced.

**Cost.** The Claude turns used the owner's `claude-agent` provider, for which OpenCode lists no price. Clef made about 20 decisions, about a cent at $0.24 per million input tokens. Three turns went to deepseek-v4-pro before the picker fix; OpenCode showed $0.02 on that chat.

**Not tested:** the interactive terminal app; a real decider on Linux and macOS (CI uses a mock model and no decider); a helper started without a model by a Claude caller; the Try box with these settings.

**The README's install steps, as a new user would follow them** (Windows, a throwaway profile through `XDG_*` folders, Desktop's bundled CLI 2.3.0): a fresh clone from GitHub, `npm ci` (26 s), `npm run build` (6 s), the clone's folder written with forward slashes in the global `opencode.json`, then OpenCode started. It listed the plugin, and `/relay on` in a new chat turned the switch on. Run after b28c1f1 was pushed. CI then passed for 28c7259 and 65b35c2 on every job: the four checks on Linux and Windows, and the smoke on Linux, macOS and Windows.

## 2026-11-17 — Rename to relay-opencode, and the model table (Windows 11, OpenCode 2.3.0)

The owner said: "please rename i dont want feature-pilot name. 2: the model list is quite long can we make 2 list select provider than their models or model list like table model name, price, and context with search?"

**The rename.** The package, the plugin id and the RPC id are now `relay-opencode` (`opencode-relay` is taken on npm; `relay-opencode` was free on 17 Nov). The smoke ran locally with Desktop's bundled CLI 2.3.0 and passed: the packed `relay-opencode` loaded from `node_modules`, `/relay` with no decider sent one message to the mock model and recorded it, and `/relay on` and `/relay off` behaved as before.

**The owner's Desktop after the rename.** The owner's OpenCode loads this repository's `dist/`. The first build with the new id was at about 07:43 local time, and the owner's service reloaded its plugins then. At 07:45:18 OpenCode's terminal client reported "Event stream stalled", and the replacement service failed to boot at 07:45:25 with `Failed to configure database (… SQLiteError: disk I/O error)`. It kept port 28894 and answered `/api/info` with 500. Desktop logged "Background service failed to start" every one to two seconds: the same state as on 16 Nov. With the owner's yes, that one process was ended at 08:02. A fresh service answered `/api/info` with 200 about two minutes later and loaded Relay with no error, and the owner's Desktop was already calling Relay under its new id. By 08:13 the service had been replaced four more times after "Event stream stalled" reports from OpenCode's terminal client, the churn seen since 10 Nov. Settings saved under the old id do not carry over. The owner chose to set their models again rather than have them copied.

**The model table.** Checked in a plain Chromium page (Playwright) that mounts `src/gui.tsx`, built by Vite, with a stand-in for `@opencode/plugin/gui` and an in-memory RPC holding 55 made-up models, 53 of them usable. Results:

- The table opened with the search box focused and listed 53 rows by provider.
- Searching "son" left Sonnet 5.5, and "router 3" left the models whose names have a 3. A search with no match said so.
- Add put the model in with the default effort and marked its row "✓ in the list".
- The effort menu offered default, low, medium, high, xhigh and max, and saved "high". Add on the same model again added the default effort, and the first row's menu then disabled it.
- The provider filter left the 7 usable `ollama-cloud` models; a deprecated one and a switched-off one stayed hidden.
- Cheapest first put "$0 or not listed" first and "not listed" last. Largest context put the 1M models first.
- "no tools" showed on the model without tools.
- Escape and Done closed the table.
- The decider menu still saved Clef, and the no-decider warning went away.

**Two ways that did not work for checking the panel.**

1. `opencode serve` also serves OpenCode's web app, with a password login, but the web app loads no plugin panels or pills.
2. `OPENCODE_DESKTOP_TEST_ROOT=<folder>` starts a second, separate Desktop with its own app data and XDG folders, but its managed service wants the same fixed port as the owner's (28894). Port 28995 was then set in the test folder's `config/opencode/service.json`, and a service started there by hand listened on 28995. The second Desktop still failed within 100 ms with "Background service failed to start", the state the owner's service was in at the time. This is not understood. The second Desktop was closed, and the owner's was not touched.

**Not tested:** the table inside Desktop itself, and the terminal app.

## 2026-11-17 — The decider's table, checks from helpers that name a model, and the repository rename

The owner answered the three open questions with "yes do it".

**The decider's table.** The decider is now chosen from the same table as the modes' models: search, the provider filter, the three orders, and **Use** on a row. The chosen decider shows as a chip with its price, an effort menu when it has efforts, and × to remove it. Checked in the plain Chromium page from the entry above, with three usable decision models and one deprecated one:

- **+ Choose a decider** opened the table and closed a mode's table that was open.
- The table listed the three usable models; the deprecated one stayed hidden. The provider filter counted 1 each, and Largest context put the 131K model first.
- **Use** saved the decider, closed the table, and the no-decider warning went away.
- The effort menu offered default, low and high, and saved "high".
- **Change the decider** opened the table again, with the decider's row marked "✓ in use" and its button disabled.
- A saved decider that is no longer offered showed as "unavailable". × removed it, and the warning came back.

**Checks from helpers that name a model.** A helper whose task is a check now goes to the Review model even when the calling model named another. The record's note says what the caller asked for, for example "its caller asked for q/other". A helper that continues an earlier one is still left alone, and so is every helper that is not a check. Tests cover it, and the mutation check caught 5 of 5 breaks. It has **not** run in a live chat yet.

**The repository.** `AsadKhalil/orchestrator-plugin` was renamed to `AsadKhalil/relay-opencode` on GitHub. The old address answers with a 301 to the new one. `package.json`, the README and AGENTS.md now use the new address.

**Not tested:** the decider's table inside Desktop; a live helper started by a Claude model or by Superpowers since this change.

## 2026-11-17 and 18 — The owner's server froze again; Relay now loads from a fixed copy (Windows 11, Desktop 2.3.0)

At 09:34 on 17 Nov the two rebuilt files from the entry above were copied into this repository's `dist/`, which the owner's OpenCode then loaded. Twenty seconds later the long-running OpenCode terminal client reported "Event stream stalled", and a loop began.

- Each new server answered for a short while, booted the folders Desktop had open (five in one minute), and loaded all eight of the owner's plugins for each of them (36 plugin loads in that minute). Its requests began to time out (HTTP 499), it went silent, and it was replaced. This went on about every one to three minutes.
- At 11:04 a replacement failed to open the database ("disk I/O error") and stayed in the failed state, answering `/api/info` with 500. Desktop, restarted by the owner at 15:03, tried twice and then showed its error page.
- Relay was the last plugin each server loaded before it went silent. It is also last in the owner's plugin list, and the same overload has been seen since 10 Nov, before Relay existed. So Relay is not shown to be the cause.
- On 18 Nov, with the owner's yes, Relay was installed from a packed build of `feac56b` into a folder of its own, and the owner's `opencode.json` was pointed at it. Only that one entry changed, and a backup was kept beside the file. The stuck server was then ended.
- That copy loads in a throwaway OpenCode: Relay was listed after 10 s and answered `getRelay`. Desktop needs a restart from the owner to start a new server.

**Not yet seen:** the owner's Desktop on the fixed copy, and whether the freezes stop.

## 2026-11-18 — The intelligence index (Windows 11, OpenCode 2.3.0 CLI)

The owner said: "the model list have intelligence index missing how to add from artifiical analysis".

**The source, checked that day.** OpenRouter's public model list had 478 models, and 267 of them carried `benchmarks.artificial_analysis.intelligence_index`, for example Claude Sonnet 5.5 54.5, Haiku 5.5 36.5 and Opus 5.5 59.1.

**How many match.** Measured against models.dev's lists, matching by id or name in one form gave 15 of 27 Ollama Cloud models and 8 of 18 Anthropic models. Joining on models.dev's `canonical_model_id` gave 17 of 27, which was not worth its 6.7 MB download. OpenCode's model records carry `family` and `modelID` but no shared id.

**Real host.** A throwaway OpenCode 2.3.0 with no login loaded Relay from this repository and answered `listIntelligence`:

- It fetched OpenRouter's list and matched 4 of the 11 free models it listed, for example `opencode/inkling-2-small-free` at 30.6, matched to `thinkingmachines/inkling-2-small`.
- A second call used the stored copy: the same fetch time, in 16 ms.

**The panel.** Checked in the plain page with made-up scores:

- The table showed Model, Price, Context, Index and Add, and nothing overflowed its cell at the panel's width.
- "Highest index" put the models with the highest index first and those without one last.
- The tooltip named the matched OpenRouter model.
- A chosen model's line read "price not listed · index 54.5".
- The decider's table showed the index too.

**Not tested:** the index in the owner's Desktop, which runs the fixed copy from `feac56b` until it is updated.

## 2026-11-18 — What a reply took, the whole chat's fit, and stay or go (Windows 11, OpenCode 2.3.0 CLI, mock models and a mock decider)

The owner said: "can you test this for me 1. Record what each switch cost (tokens re-read, cost, seconds) in Recent choices. About a day. 2. Say in the README when Relay saves. In long chats use /relay at clear points, ask for checks through a helper, and try one model at two efforts first. No code. 3. Add a "stay or go" check after the decider. A step down happens only when it pays, and the whole chat must fit the model. Two to three days, after the first paid test stage."

Everything below ran on isolated OpenCode servers started from the Desktop's bundled CLI (it prints `opencode v2.3.0`; platform win32): scratch config, data, cache and state folders, a throwaway password, loopback ports, a synthetic key and a mock provider. No real model, key or profile was used, and nothing was paid. The paid stages of the cost report's test (its stages 1 and 2) were not run: they need the owner's yes. The report is `docs/research/2026-11-17-relay-cost-and-model-choice.md`.

**What a change does to the request (stage 0 of the report's test; no plugin loaded).** One chat, thirteen messages, one change before some of them. The mock kept every request whole. The system text was 28,970 characters and there were 13 tools in every request.

| Change before the message | System text | Tools | Earlier messages | What was added |
|---|---|---|---|---|
| none | same | same | all kept | the last answer and the new message |
| agent to `plan` | same | same | all kept | one user message: `<system-reminder> You are in Plan mode. …` |
| agent back to `build` | same | same | all kept | one user message: `<system-reminder> You are NO LONGER in Plan mode. …` |
| review rules put | same | same | all kept | one user message: `<system-update> <context key="relay-review-rules"> …` |
| review rules removed | same | same | all kept | one user message: `<system-update> The context under "relay-review-rules" no longer applies. …` |
| model to a second mock model | changed | same | all 21 kept | nothing else |
| model back to the first | as before the switch | same | all 23 kept | nothing else |
| effort to `high`, then back to the default | same | same | all kept | only `reasoning_effort` in the request |

The system text of two models differs only in the two lines under "# Your Model" that give the model's name and id, at character 1,499 of 28,970; after the switch back it was the same text as before. So of these changes only a change of model alters the start of the request. The mock speaks the OpenAI format: this shows the text of each request, not what a provider's cache does with it.

**What OpenCode keeps for each reply.**

- `session.prompt` returns the new message's entry, and its `id` is the id of the `user` message in `session.context` (11 of 11 messages).
- `session.context` gave every message of the chat, 41 entries for 11 messages: `user`, `assistant`, `idle`, `agent-switched`, `synthetic`, `system`, `model-switched`, and `compaction` with a `status`.
- An `assistant` entry carries `time` (`created`, `firstToken`, `streamed`, `completed`), `model`, `agent`, `tokens` (`input`, `output`, `reasoning`, `cache.read`, `cache.write`), `cost` and `finish`. `tokens.input` leaves out the tokens the provider reported as cached: a request of 11,344 tokens with 5,672 cached was kept as input 5,672 and cache read 5,672.
- The host works out `cost` from the model's listed price: 20,000 tokens read, 15,000 of them from a cache, and 5 written, at $2, $0.10 and $10 for a million, gave 0.01155.
- A reply in which the model first called a tool was kept as two `assistant` entries, one for each request.
- A custom model's `cost` in the config can be one entry, or a list with `tier: { type: 'context', size }`; the model list then gives them back as written.

**A mock can be a decision model.** Earlier sections say that none can. A model with `type: 'decision'` and `package: '@opencode/ai/providers/openai-compatible/decisions'` is listed as a decision model, and `experimental.generate.decisions` then sends `POST <baseURL>/systemone` with `{ state, questions: { <name>: { type: 'choice', instructions, criteria } }, model }` and reads `{ model, answers: { <name>: { type: 'choice', choice, probabilities, confidence } }, usage: { input_tokens, output_tokens, cost } }`. With the packages `@opencode/ai/providers/openai-compatible` and `@opencode/ai/providers/openai` the host answered "has no decision API opencode can call". The smoke now has such a mock, so it makes a real switch for the first time.

**The packed plugin (`npm run smoke:host:model`), passed on Windows, twice; the second run was on the final build.** After the push (commit `c33e4ba`), GitHub's checks passed it on Linux, macOS and Windows too, with the tests on Linux and Windows (run 44312055624). In this order:

- With no decider, `/relay` sent one message, and its record got what the reply took: 1 request, 10 tokens read new, none from a cache, a cost of 0 (the model lists no price), and the first word after 180.8 s in the first run and 80.3 s in the second. That was the first reply of a fresh server; the later ones took 0.6 to 1.6 s.
- The mock decision model was accepted as the decider. The model list gave the prices of `model-big` as 4, 20, 0.2 and 5 (input, output, cached read, cache write), with no steps.
- In a new chat on `model-big`, the line of the cheaper model was followed: the chat went to `build` and `model-cheap`, and the record reads 5,000 tokens read new, 15,000 from cache, $0.01155.
- The line of the dearer model was followed, a step up: 2,000 read new, 58,000 from cache, $0.0197.
- With the chat at 60,005 tokens, the model of 40,000 tokens was no longer offered to the decider (it was asked about lines 1 and 2 only). The line of the cheaper model did not pay, so the chat stayed on `model-big` and went to no other model. The record says: "moving this chat to smoke/model-cheap would cost about $0.10 to read it again and save about $0.09 over 6 requests, so the chat's model stays".
- With the switch on, a plain message was weighed the same way, and its record got its reply: 495 read new, 60,505 from cache.
- A reply with one tool call was recorded as 2 requests.
- Each message made exactly one decider request, and one model request (two for the reply with the tool call).

The tokens are what the mock reported, and the costs are what the host worked out from the mock models' made-up prices.

**A long chat (a throwaway probe with the packed plugin; not part of the smoke).** Relay reads the chat's entries before it decides, and again when the chat goes idle, and gives each read one second at most. One chat was grown with messages of about 20,000 characters each:

| Chat | Entries | Size of `session.context` | That read over HTTP | `/relay`, from the call to its return |
|---|---|---|---|---|
| new, then one message | not counted | not measured | not timed | 127 ms, then 61 ms |
| 60 long turns | 187 | 1.25 MB | 76 to 97 ms | 73 to 74 ms |
| 200 long turns | 613 | 4.16 MB | 175 to 308 ms | 116 to 123 ms |

At both sizes the line of the cheaper model got the stay note ("… would cost about $0.29 to read it again and save about $0.12 over 6 requests, so the chat's model stays" at 200 turns), which Relay can write only when it has read the chat in time, and each record got its reply. The second probe below was starting on the same machine during the 200-turn rows, so those times are upper figures.

**A compaction (a second throwaway probe).**

- OpenCode accepts a summary only when it uses the section headings of the template in its request ("## Objective", "## Requirements" and so on). A mock that answered with other text got a second request ("The previous response did not fill in the required summary template. …"), and then a `compaction` entry with `status: 'failed'` and the error "Compaction summary did not match the required template". The chat was as before, and Relay took its size from the last answer (31,005 tokens).
- A mock that filled in the template got `status: 'completed'` after one request. The entry carries `reason: 'manual'`, the model, the summary, a cost and token counts of its own, and `time.created` only.
- After that, `session.context` listed the chat from the compaction's own entry on: the three earlier messages and their answers were gone from it, and the next request carried the system text, the summary and the new message. So `session.context` holds what the chat has gathered since its last compaction, not its whole history.
- Relay then takes the chat's size as nothing until the next answer (4,005 tokens after it). The first message after a compaction is placed like one in a new chat: no cost check and no fit limit.
- A record whose message is compacted away before its reply is read keeps waiting until it leaves the list of 20. The chat is read once more each time it goes idle until then.

**Not tested:**

- Real models, real prices and a real cache: what a switch really costs (stage 1 of the report's test), and whether a provider's token fields fit what Relay reads, for example whether its `input` leaves out the tokens written to a cache.
- The numbers in the cost check (a cache of five minutes, 1,500 tokens in and 500 out for a request, 6 requests, the margin of 1.5). They are guesses until a real run.
- A real decider together with the new rules, and helpers. A helper's record names no message and gets no reply.
- A compaction that OpenCode starts by itself in the middle of a reply.
- The new line of Recent choices in Desktop. It was checked in tests only.
- The owner's Desktop, which runs the fixed copy from `feac56b`.

## 2026-11-18 — Before the paid cost test: what OpenCode sends to Anthropic, seen against a local stand-in (Windows 11, OpenCode 2.3.0 CLI)

**Nothing here was sent to Anthropic, and nothing was paid for.** The paid run (stage 1 of the cost report's test, which the owner agreed to on 18 Nov: "yes run paid test") has not happened yet. It waits for an Anthropic API key with a spending limit. This section is the free preparation for it.

**What ran.** A throwaway script (not in the repository) started an isolated OpenCode 2.3.0 with the packed plugin, a mock decision model on loopback, and OpenCode's own Anthropic provider. The provider's address was moved to a loopback stand-in for `POST /v1/messages` with `providers: { anthropic: { settings: { baseURL } } }` in the project's config: a partial entry is laid over the listed provider. The key was a placeholder. So the requests are the ones OpenCode builds for Anthropic, and every answer, token count and cache hit was made up by the stand-in, which kept a pretend cache for each model. The waits were cut to a twentieth. The script ran to its end twice: a chat grown to 30,000, 60,000 and 120,000 tokens (62 requests), and a chat that starts at 120,000 tokens (21 requests).

**The price list** (`model.list`). The provider `anthropic` is listed only when `ANTHROPIC_API_KEY` is set in the host's environment, and a placeholder is enough for the list. USD for a million tokens:

| Model | Input | Output | Cached read | Cache write |
|---|---|---|---|---|
| `claude-sonnet-5-5` | 2 | 10 | 0.1 | 2.5 |
| `claude-haiku-5-5`, a chat up to 100,000 tokens | 0.1 | 0.5 | 0.01 | 0.125 |
| `claude-haiku-5-5`, a chat above 100,000 tokens | 0.5 | 2.5 | 0.05 | 0.625 |
| `claude-opus-5-5` | 4 | 20 | 0.2 | 5 |

Each has a context of 1,000,000 tokens. Sonnet 5.5 has the efforts low, medium, high, xhigh and max; Haiku 5.5 has those and none.

**How OpenCode 2.3.0 builds a request to Anthropic.**

- The body has `model`, `system`, `messages`, `tools`, `stream`, `max_tokens` (128,000) and `thinking` (`{ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }`), with the beta headers `interleaved-thinking-2025-05-14` and `thinking-binding-controls-2026-08-01`.
- It marks four places for the cache and names no lifetime, so Anthropic's default of five minutes applies: the last tool, the first and the last block of the system text, and the last message. Relay's five minutes are this default.
- The system text has four blocks. The second names the model ("# Your Model", with its name, provider id and model id), so it differs from model to model. The other three and the tools were the same for Sonnet and Haiku.
- A change of agent (`build` to `plan`) adds a user message with a `<system-reminder>`. The system text and the tools stay as they were.
- Relay's review rules go in as a `system` message in the middle of the chat (`<context key="relay-review-rules">`), and taking them off adds another ("The context under "relay-review-rules" no longer applies. Disregard it."). Nothing earlier in the request changes.
- A change of effort adds a `system` message with no text and `output_config: { effort }`. The first time a chat gets an effort, the top-level `thinking` also gains `display: 'summarized'` and the beta `mid-conversation-output-config-2026-07-01` is added. A later change of effort changed neither. Relay takes a change of effort to cost nothing; whether the first one costs the cache is for the paid run.
- With the chat on Haiku at its default effort, that effort message is left out of the request. Back on Sonnet it is in its old place again, so Sonnet gets the text it read before.

**An isolated host still reads the home folder.** The four XDG folders do not cover it. With the real `USERPROFILE` passed through (as `scripts/smoke-host-model.mjs` does, and as the first probe here did), the system text of every request listed the 33 personal skills found under the real home folder (21,100 of its 28,970 characters), and named the working folder and the temp folder, which hold the Windows user name. The smoke talks only to a loopback mock, and GitHub's runners have no such skills, so nothing personal has left a machine. For a run against a real provider the host must also get a scratch `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP` and `TMP`, and a scratch root outside the profile. With those the system text was 7,464 characters (blocks of 1,494, 93, 5,639 and 238), with no skill list and no user name. The paid script does this, and its recorder does not pass on a request that names the Windows user.

**Keeping a real model to the scratch project.** The project's config denies `shell`, `webfetch`, `websearch`, `subagent`, `skill`, `question`, `external_directory` and `experimental_image_generate`. Config rules come after an agent's own rules, and the last match wins. The tools then offered were `edit`, `glob`, `grep`, `read`, `skill`, `write` and `execute`. Denying `execute` as well made the host offer its session and worktree tools one by one instead (`opencode_session_move`, `opencode_worktree_create` and others), so it is left allowed. The stand-in then asked for three things as a model would. A read of `C:\Windows\win.ini` and a write outside the project each ended in "Permission denied: external_directory", and no file was written. A shell call ended in "No tool named "shell" is currently available".

**What Relay recorded.** In both runs every `/relay` record got its reply (37 and 11 records), and each agreed with the stand-in's own figures for the reply's first request: read new is `input_tokens` plus `cache_creation_input_tokens`, from cache is `cache_read_input_tokens`, and the cost is those at the list prices, Haiku's step included. OpenCode's own counts and cost agreed for all 62 and 21 requests. With made-up figures this shows only that OpenCode and Relay pass on what the provider reports and price it by the list.

**The cost check with this price list** (arithmetic only; the chat on Sonnet, the line asking for Haiku, Haiku holding nothing of the chat):

| Chat | To read it again | Saved over 6 requests | Relay |
|---|---|---|---|
| 30,712 tokens | $0.0035 | $0.0665 | moved the chat to Haiku |
| 60,332 tokens | $0.0069 | $0.0825 | moved the chat to Haiku |
| 120,703 tokens | $0.0694 | $0.0756 | kept the chat on Sonnet |

Above 100,000 tokens Haiku's prices are five times higher, so the move stops paying there. The last row is from the second run. In the first run Haiku had answered in the same chat seconds before, because the waits were cut, so at 120,000 tokens Relay counted only what had been added since and moved the chat.

**One fix came out of it.** The note for the last row read "moving this chat to anthropic/claude-haiku-5-5 would cost about $0.07 to read it again and save about $0.08 over 6 requests, so the chat's model stays". On its own that looks wrong: the saving is the larger amount. The check asks for a saving of at least one and a half times the cost, and the note left that out. It now adds ", less than one and a half times that cost" when the saving is at least the cost. A test covers it, red before the change and green after.

**The smoke on this build (Windows), twice.** The first run stopped at its first message: the chat had not finished when the client gave up waiting for the answer's headers, after 300 s, on top of the up to 240 s the smoke waits for the model request. The second run passed, with the first word of that first reply after 96.6 s. The first reply of a fresh server with the smoke's mock provider has been slow on this machine all day (180.8 s and 80.3 s in the morning's runs), while the later replies took about a second, and the first reply through OpenCode's own Anthropic provider in the dry runs took about 2 s. The machine was busy (CPU at 76%). The cause was not looked for.

**Not tested** (all of it waits for the paid run):

- Anthropic's own figures and prices: what a change of agent, the review rules, an effort, a move to Haiku, and the way back to Sonnet after one, four and six minutes really read from the cache and cost.
- How real models behave in the test, and how many requests and tokens their replies to small tasks take. The stand-in answered every message with 12 tokens.
- The account's limits. Anthropic counts tokens read new and tokens written to a cache against a limit for each minute, and tokens read from a cache not at all (its rate-limits page, read on 18 Nov). A cold request of 120,000 tokens needs that much room at once, and a new account can start below the listed limits.

## 2026-11-18 — the npm package, installed by name

The owner published `relay-opencode` 0.1.0 to npm, built from commit 14814f3 (the published README is that commit's). npm held the release for review first. For about three minutes `npm view relay-opencode version` printed `0.0.0-stage`: a placeholder npm published under the owner's account, with two files. Its description is "Temporary package placeholder for staged publishing", and its README says the real version "has been submitted for review and is awaiting a staged release". Then 0.1.0 became `latest`. The placeholder stays in the version list.

In an isolated OpenCode 2.3.0 on Windows (the `@opencode/cli-windows-x64@2.3.0` binary from npm, scratch XDG folders, a throwaway server password, loopback only, no provider, no model request), a global `opencode.json` holding only `"plugins": ["relay-opencode"]` made OpenCode download `relay-opencode@latest` into its own cache (`opencode/npm/relay-opencode@latest/<number>/node_modules/relay-opencode`, version 0.1.0) and load it. `/relay` was among the commands. The plugin list showed Relay 113 seconds after the server started, most of it the download. An older 2.2.7 binary did the same in 271 seconds. Not tried: Desktop, macOS and Linux, a model request, and what OpenCode does when a newer version is published.

## 2026-11-18 — the README's screenshots

The screenshots in `docs/images/` show the panel's real code (`src/gui.tsx`, the same as in 0.1.0) mounted by Vite in a plain page, 380 px wide like Desktop's side panel, with a stand-in for `@opencode/plugin/gui` and an in-memory RPC, in headless Chrome at twice the pixel density. The model list, the deciders and the index scores are what Relay 0.1.0's own RPC returned from an isolated OpenCode 2.3.0 with Anthropic and OpenAI set up through synthetic keys: 129 models, `opencode/jev-1.13-free` as the only decision model, and 21 index matches (2.2.7 returned the same). No model request was made. The settings and the Recent choices rows are made up; their costs follow the listed prices. This is not Desktop: there the panel sits in Desktop's side panel, with Desktop's fonts and colours.
## 2026-11-18 — The owner's Desktop: the fixed copy holds today's build, Desktop moved itself to 2.3.2, and its service kept being replaced (Windows 11, Desktop 2.3.0, then 2.3.2)

**Leave given.** On 18 Nov the owner said "Yes, do it now" to this one step: close Desktop and end its background service, install today's build into the fixed copy, open Desktop again, and send one short `/relay` message in a new chat. It covers that step only.

**What was done.**

- Desktop was closed and its service was ended (12:37). The fixed copy under the OpenCode config folder was updated with `npm install` of a packed build of commit `01b59fb` ("changed 1 package"). Its other packages were left as they were: `package.json` and `package-lock.json` have not changed since `feac56b`, the build it held before.
- Desktop 2.3.0 was started again at 12:38, with a debugging port, and its service loaded the new copy.
- At 12:43 Desktop installed 2.3.2, which it had downloaded earlier, and started again by itself, without the debugging port. It was started again at 12:46, from Explorer, with the owner at the PC.
- On 2.3.2 the service log shows Relay loading from the fixed copy (`loading plugin`, then the watchers on `dist/index.js` and `dist/gui-experimental.cjs`), with no error or warning about it.

**Not done.** The panel was not opened and no `/relay` message was sent, so the new line in Recent choices ("First request of the reply: …") has still not been seen in Desktop. After the update there was no debugging port, the owner was using Desktop, and its service was not steady (below).

**Relay has no settings in the owner's OpenCode since the rename.** A copy of the service's database was read for table names, key names and sizes only, and then deleted. Relay's keys are all under the old id `feature-pilot`, last written on 17 Nov; there is none under `relay-opencode`. So in the owner's Desktop Relay has no modes and no decider until they are chosen again, as the note on the rename says.

**The service kept being replaced.**

- In an episode, about 55 seconds after a service starts, Desktop's window log has "event stream disconnected", "server thrashing detected" and "The server took too long to answer", and Desktop starts another service (`reason: 'missing'`). Each new service logs for two to four seconds, while it loads the plugins of one or two project folders, and then logs nothing. The service log has 37 service starts for the day, 27 of them after noon.
- Two episodes were seen: 12:20 to 12:55, and 15:57 to 16:01. The first began before the fixed copy was updated, so with the build of `feac56b`.
- The second began 54 seconds after a read request made for this check. Relay's settings were asked for through the service, for a project folder the service had not loaded yet. The service loaded that folder's eight plugins, answered "RPC is unavailable: relay-opencode", and never answered the next request. That service had run for three hours. If a chat was working in it then, the chat was cut off.
- Windows' event log has no crash and no hang for the service.
- The service that lasted (started 16:01) used 201 seconds of processor time in its first four and a half minutes, read 403 MB and wrote 365 MB, with no chat running. In its database the only thing that changed was the stored model catalog (`models-dev:v2:catalog`, 13 MB). It had loaded five project folders, the home folder among them, and loaded the eight plugins twelve times in its first five minutes.
- The PC was busy with other work at those times (90 to 100% processor load: a test run, a browser, Windows Defender).
- On the same PC, minutes later, an isolated OpenCode 2.3.2 with a scratch home was ready about ten seconds after its start.
- What Relay does when it is loaded: it registers its command, three hooks and its RPC, and does no work of its own (`src/index.ts`, `src/rpc.ts`). Its lines are the last in each run's log because it is the last plugin in the owner's list.
- The cause was not found.

Nothing more was sent to the owner's service after 15:57.

## 2026-11-18 — The cost test with real Claude models, through the Claude Agent provider and the Claude Code login (Windows 11, OpenCode 2.3.2 CLI, Claude Code 2.1.327)

**Leave given.** The owner, 18 Nov: "yes run paid test and do this  Real models, real prices and a real cache." No API key was given. Instead: "i already have cladue agent logged in you can use anthropic models". It covers this test only.

**How it ran.**

- An isolated OpenCode 2.3.2, the CLI that comes with Desktop 2.3.2. Its four XDG folders, its home folder and its temp folder were scratch folders in a scratch root outside the profile. It had a throwaway password, the packed build of commit `01b59fb`, and a mock decision model on loopback that answered what the script told it to.
- One real place was named: `CLAUDE_SECURESTORAGE_CONFIG_DIR` pointed Claude Code at the folder that holds its login. The Claude Agent integration was then connected through the API (`integration.connect.external`, method `claude-login`), as Desktop's Providers page does. The integration list fills a few seconds after the host's first answer.
- Claude Code kept its own files in the scratch home. Each scratch root was removed after its run. The real `.claude` folder was the same before and after: the number of project folders, no new config file, and the time of the login file.
- The model could use only the files of the scratch project. Shell, web, helpers, skills, questions and folders outside the project were denied, and it asked for none of them.
- No recorder stood between OpenCode and Anthropic: with a base URL set, the login would pass through it and the provider takes another path. So each count below is what OpenCode keeps for a request (`session.context`): tokens read new (input and written to cache), read from cache, and written out.
- Three runs, from 16:31 to 17:12: 49 answers and 91,324 tokens read new in all.

**What the provider lists.** `claude-agent/sonnet`, `haiku`, `opus` and `fable`, each with no price (`cost: []`), a context of 1,000,000 and five efforts. Each answer's cost is 0. Which version answers under each name is Claude Code's choice, and OpenCode does not keep it. Some answers carry the plan's own limit figures (`native.rateLimit`: the share used of the five-hour and the seven-day limit, and when each starts again). They were not used here, because other work ran on the same account. In the CLI's program text, the price source for this provider is none for a subscription login; with an API-key login of Claude Code it is the `anthropic` list (read, not tried).

**What Relay did.** `/relay` placed each of 20 messages, and each record got what its reply took: the requests, the tokens read new and from cache, and the wait for the first word. It shows no cost, because 0 can mean "not listed". When the line picked another model than the chat's, Relay moved the chat; within five minutes of the chat's last answer the record said "no price listed, so no cost check". On this route too, OpenCode keeps one entry for each request of a reply.

**One chat of about 30,000 tokens, with a real cache.** Tokens of the request that answered:

| Step | Model | Read new | From cache |
| --- | --- | --- | --- |
| One more request | Sonnet | 20 | 30,060 |
| Execute to Plan | Sonnet | 194 | 30,076 |
| Review rules on | Sonnet | 255 | 30,266 |
| Review rules off | Sonnet | 57 | 30,517 |
| Plan to Execute | Sonnet | 93 | 30,570 |
| Effort changed to low | Sonnet | 21 | 30,659 |
| Moved to Haiku, first request | Haiku | 24,706 | 6,232 |
| Second request on Haiku | Haiku | 76 | 30,880 |
| Back to Sonnet, 1 minute after its last request | Sonnet | 463 | 30,693 |
| Back to Sonnet, 4 minutes after | Sonnet | 503 | 31,096 |
| Back to Sonnet, 6 minutes after | Sonnet | 353 | 31,539 |

- A change of mode, the review rules and another effort left the cache whole.
- A change of model made the new model read the chat new, once. The tokens it still read from cache are the start that every chat shares (the tools and the system text): an earlier chat had left them in Haiku's cache.
- For that message, Recent choices ends: "First request of the reply: 24,706 tokens read new, 6,232 from cache, first word after 1.3 s. Requests in the reply: 1."
- Not explained: the first request of one new chat on Haiku read 3,194 tokens from cache, where other new chats read 6,232 or 7,012.

**How long a cache lasts on this route.** In the long chat, Sonnet read the whole chat from cache 6 minutes after its last request there (the last row of the table). Three more chats each read a file of their own and then got no request: after 6 minutes Haiku read 10,416 tokens from cache and 20 new; after 20 minutes Haiku read 10,448 tokens from cache and 20 new; after 20 minutes Sonnet read 9,643 tokens from cache and 20 new. So on this route a cache lasts longer than twenty minutes, for both models. Anthropic offers a lifetime of five minutes or of one hour, so this is the one-hour kind, which Claude Code must ask for; the request itself was not seen. OpenCode's own requests for the `anthropic` provider ask for five minutes.

**Six small tasks** in a toy folder of three files (add a function, fix a bug, rename across the folder; nothing could be run): the replies took 3, 2, 3, 3, 2, 3 requests. A request read 224 to 4,715 tokens new, 586 in the middle, and wrote 106 to 811 out, 212 in the middle. The highest read was a first request on Haiku that also read part of the shared start new. Haiku reported up to 362 reasoning tokens in a request; Sonnet almost none. The edits landed in the toy folders.

**Against the guesses in the cost check.**

- **Five minutes.** For the `anthropic` provider this is the lifetime OpenCode asks for (seen against a stand-in on 18 Nov) and Anthropic's default. No real five-minute expiry was seen, because no API key was used. On the Claude Agent route a cache lasts longer, and the check does not run there.
- **Counted from where.** Anthropic's documentation counts a cache's lifetime from the start of the request that wrote or read it; the time the answer takes counts against it. Relay counted from the end of the answer. Changed, test first: the age now runs from the start of the request. This comes from the documentation; no run showed it.
- **6 requests.** The toy tasks took 2 or 3. Not changed: the tasks were small and could run nothing, and Relay's own records take over after three replies of a line.
- **1,500 tokens new and 500 out for a request.** The toy tasks took about 586 and 212. Not changed, for the same reason.
- **One and a half.** A margin; one run cannot show it. Seen: the move to Haiku read a fifth less than the whole chat, because the shared start was already in Haiku's cache.

**At list prices.** Arithmetic only: nothing was charged on this route. OpenCode's prices for Claude Sonnet 5.5 and Haiku 5.5 are the ones in Anthropic's own price list (Sonnet $2 in, $10 out, $0.10 cache read, $2.50 cache write for a million tokens; Haiku $0.10 and $0.50 up to 100,000 tokens, with cache read at a tenth and cache write at one and a quarter). At those prices one more request on Sonnet in this chat costs $0.0031, the first request on Haiku $0.0032, each later request on Haiku $0.0003, and the request that brought the chat back to Sonnet $0.0043.

**Not tested.** A real bill. The `anthropic` provider with an API key, where the cost check runs. A real five-minute expiry. Chats above 32,000 tokens. Opus and Fable. A helper. Desktop. macOS and Linux.

**The mock check on OpenCode 2.3.2.** `npm run smoke:host:model` passed against the 2.3.2 CLI on Windows on the same day ("PASS: on stock opencode v2.3.2 (win32)"), with mock models and a mock decider.

## 2026-11-19 — Each record keeps the whole reply, the model that answered and its listed prices (Windows 11, OpenCode 2.3.2 CLI, mock models)

`npm run smoke:host:model` passed with the 2.3.2 CLI that comes with Desktop, isolated, with mock models and a mock decider ("PASS: on stock opencode v2.3.2 (win32)"). Each record's reply named the model that answered, added up every request, and held the prices the host's model list gave for that model:

- No decider, a model with no price in its config: `smoke/model-chat`, 10 tokens in, 5 out, and no price (all four prices null).
- A reply on `smoke/model-cheap`: 5,000 tokens in, 5 out, 15,000 from cache, $0.01155, at $2, $10, $0.10 and $2.50 for a million tokens (in, out, cache read, cache write).
- A reply of two requests (a tool call first) on `smoke/model-big`: 2,000 tokens in, 10 out, 122,000 from cache, $0.0326 for both requests ($0.0163 for the first), at $4, $20, $0.20 and $5.

The effort comes from each answer's `model.variant`. In the real Claude test of 18 Nov (OpenCode 2.3.2), the answers carried `low` after a change of effort and `default` otherwise, and they carried tokens written to a cache (`cache.write`).

**Not tested.** A model with efforts in this check (the mock models have none), reasoning tokens and tokens written to a cache (the mock reports neither), a reply that crosses a price step, a real model with the new record, and Desktop.

## 2026-11-19 — The proof test on OpenCode Go, in the owner's own OpenCode (Windows 11; Desktop's service 2.3.2; the owner's Relay copy, 0.1.0 built from `01b59fb`)

The owner wants numbers for two claims: Relay makes the same work cost less, and it uses less of a plan's 5-hour and weekly limits ("i want to prove 2 point with numbers first is cost second is less usage will be used as 5 hour or weekly limit exhausted too quick"). The design is `docs/superpowers/specs/2026-11-18-relay-proof-design.md`, and the plan is `docs/superpowers/plans/2026-11-19-relay-proof-test.md`.

The owner lifted the rule against testing in their profile for this test: "you can use my opencode as test environment, no need to create throway copy its lengthy process". Then: "i open the folder . i have go subscription . yes test it".

**What ran.**
- **The script:** `scripts/bench/run.ts`, through the owner's running service, in one folder of its own (`%USERPROFILE%\relay-bench`). The owner opened that folder in Desktop first.
- **What the model could do:** read and edit files in that folder only. Its `opencode.json` denies shell, web, helpers, skills, questions and outside folders.
- **The models:**
  - strong: `opencode-go/kimi-k3.1-pro` ($2 in, $10 out, $0.20 read from cache per million tokens; a $15 monthly limit on the Go plan);
  - cheap: `opencode-go/glm-5.3-flash` ($0.15, $0.50, $0.03; a $60 monthly limit);
  - decider: `opencode/jev-1.13-free`.
- **The exercises:** four Python exercises from Aider's polyglot benchmark: `wordy`, `book-store`, `affine-cipher` and `bowling`. Each ran as the same four messages (plan, build, review, fix) on four sides:
  - Relay off, on Kimi;
  - Relay on, with Plan and Review on Kimi and Execute on Flash;
  - Relay on, with Execute holding both, Flash for "small edits in one or two files" and Kimi for "bigger changes across several files";
  - Flash alone.
- **Scoring:** after each chat the script ran the exercise's tests, which the model never saw. A chat passes only if every test passes.
- **Settings:** Relay's settings were put back after every run.

| | Off | On, one model a mode | On, two for Execute | Cheap only |
|---|---:|---:|---:|---:|
| Tasks passed | 3 of 4 | 4 of 4 | 4 of 4 | 2 of 4 |
| Cost at list price | $1.1119 | $0.5828 | $1.0659 | $0.0764 |
| 5-hour limit used (estimated) | 37.1% | 18.0% | 35.5% | 0.6% |
| Weekly limit used (estimated) | 14.8% | 7.2% | 14.2% | 0.3% |
| Saved, against Off | - | 47.6% | 4.1% | 93.1% (passed fewer) |

**How far these numbers go.** Four exercises, one run each, so only a large gap means anything. The limit rows are estimates: each request's list cost divided by its model's monthly limit from Go's published list. They were not checked against Go's own meter or console. `npx tsx scripts/bench/report.ts` prints this table from the raw results files, and it leaves out the stopped pilot chat by itself.

- **Relay with one model a mode is the one large difference.** It cost 47.6% less than Relay off and used about half of the 5-hour limit (an estimated 18.0% against 37.1%), and it passed all four exercises; 4 of 4 against 3 of 4 is within the noise (see the next point). Relay off failed one: `wordy` raised "syntax error" where the test expects "unknown operation". The decider placed every message as intended:
  - each plan went to Kimi on the `plan` agent;
  - each "Implement it." and "Fix what the review found." went to Flash on `build`, with confidence 0.94 to 0.97;
  - each review went to Kimi.

  Kimi made 29 of the side's 76 requests, and Flash made 47.
- **Relay with two models for Execute ran as a second Relay off.** For every "Implement it." and "Fix what the review found." the decider fitted neither line. The record says "no line fits clearly, so the chat's model stays", so the chat stayed on Kimi. A short follow-up says nothing about size, and the decider sees only the message, not the plan before it. All 71 of this side's requests were Kimi's, as all of Relay off's were. So its 4.1% lower cost and its one more task passed are the difference between two runs of the same setup: gaps of that size mean nothing in this test.
- **The cheap model alone** cost 93.1% less but passed only `affine-cipher` and `bowling`, so the table marks its saving "passed fewer".
- **Cost.** OpenCode recorded a cost of 0 for every Go request. The table's costs are each request's tokens at Go's list prices (`scripts/bench/lib.ts`). The limit shares are each request's cost divided by its model's monthly limit, as Go's docs count them: the 5-hour limit is 20% of the month, the week 50%. OpenCode keeps reasoning apart from output: in 173 of the 297 requests the reasoning count was larger than the output count, so `output` cannot include it. The two are billed together as output.
- **The test's own use of the owner's Go plan:** about 93% of one 5-hour window, counted by the same arithmetic, pilots included.

**The owner's Plannotator plugin can hold Relay's Plan turns.**
- The owner's global config loads `@plannotator/opencode` with `workflow: plan-agent` and `planningAgents: ["plan"]`.
- In the first pilot, Relay put the first message on Plan, as it should. The model then called `submit_plan`, and the chat waited for a person to approve the plan until the script stopped it after 15 minutes. That chat is left out of the table.
- From then on, every test chat was created with `submit_plan` denied for that chat alone, so the call failed at once and the chat went on. Plannotator's instructions still reached the Relay sides' Plan and Review turns, which counts against Relay.
- **In everyday use** with this setting, a message Relay sends to Plan or Review can wait for the owner's approval, whenever the model calls `submit_plan`.

**Other things seen.**
- **The RPC client checks every answer against the method's output schema.** Another session's uncommitted change to `src/contract.ts` added reply fields that the owner's copy does not send. So the script now reads the contract from the installed copy.
- **The `wordy` results come from three runs of the script on the same morning,** with the same code for those sides apart from the `submit_plan` rule. Relay off runs on `build`, where Plannotator does not act.

**Not tested.**
- `variable-length-quantity` and `forth`: they did not fit in the one-window budget.
- More than one run of each exercise, so with four exercises only large differences mean anything.
- Chats longer than four messages, helpers, other Go models, and Go's console checked against the computed numbers.
- The Claude and Ollama parts of the design.

## 2026-11-19 (afternoon) — The proof test on Ollama Cloud in real dollars, and Go's last two exercises (Windows 11; Desktop's service 2.3.2; the owner's Relay copy, 0.1.0 built from `01b59fb`)

The owner, after the morning's results: "yes plan that and do more testing on opencode again i hava ollama , claude agent and open go you can use any models from these providers". They asked for two runs: Ollama in real dollars, capped at $2, and the last two exercises on Go. The runner is `scripts/bench/run.ts` as of `5eb479d`, in the same test folder and under the same rules as the morning. Only the Off, "one model a mode" and Cheap sides ran: until the decider fix (`docs/superpowers/plans/2026-11-19-relay-decider-last-reply.md`), "two for Execute" is a second Relay off.

**Ollama Cloud, in real dollars.**
- **Models:** strong `ollama-cloud/glm-5.3` ($1.40 in, $4.40 out, $0.26 read from cache per million tokens); cheap `ollama-cloud/glm-5.3-flash` ($0.15, $0.50, $0.03); decider `opencode/jev-1.13-free`.
- **Why these:** a big model and a small one of one family. The price gap (about nine times) is smaller than the Go pair's.

| | Off | On, one model a mode | Cheap only |
|---|---:|---:|---:|
| Tasks passed | 2 of 2 | 2 of 2 | 2 of 2 |
| Cost at list price | $0.8087 | $0.4674 | $0.0656 |
| Saved, against Off | - | 42.2% | 91.9% |

- **These are real dollars.** OpenCode recorded $1.341622 for the six chats, and the list-price arithmetic gives $1.34162389. Ollama's own billing page was not checked.
- **The decider placed every message as intended.**
  - Each plan and review went to GLM-5.3 on `plan`, with confidence 1.
  - Each "Implement it." and "Fix what the review found." went to Flash on `build`, with confidence 0.96 to 0.98.
- **Only two exercises fit the cap.** GLM-5.3's Off chats cost $0.33 and $0.48, more than estimated from the Go run's tokens. After `variable-length-quantity`, $1.34 was spent, and the next exercise would have passed $2.
- **How the run stopped.** The runner then checked the cap before each chat. So it would have started `wordy`'s Off chat (about $0.40) and stopped before `wordy`'s other sides, and nothing could have been compared with that chat.
  - To avoid paying for it, I held a locked file in the test folder while that exercise's last chat ran.
  - The runner's next folder reset failed. It put Relay's settings back (checked) and exited before any further chat started.
  - The runner now checks the limit before each task, counting the task's sides together.

**Go: the last two exercises.**
Same models, decider and settings as the morning.
- **The first attempt stopped after one chat.** One Kimi request lost its connection (ECONNRESET). OpenCode retried and the reply went on, but the runner stopped at any failed request.
  - The runner now stops only when a reply ends in a failure.
  - That chat (2.6% of a 5-hour window) is left out.
- **The second attempt:**
  - `variable-length-quantity`: Off passed ($0.1841), "one model a mode" passed ($0.3811), Cheap passed ($0.0091).
  - `forth`: Off failed ($0.3758), "one model a mode" passed ($0.2100), Cheap failed ($0.0139).
- **On `variable-length-quantity`, Relay cost twice as much as Off.**
  - Flash's build turn ran long: 10 requests and 37,522 output and reasoning tokens.
  - Kimi then read the whole chat again for the review: 40,435 tokens new in its first request. The review alone cost $0.2683, more than Off's whole chat.
  - This is the cost the 17 Nov research warns of: a switch makes the next model read the chat again, at its own price.

The six exercises together. `npx tsx scripts/bench/report.ts --sides off,on-one,cheap` prints this from the morning's files and this run's:

| | Off | On, one model a mode | Cheap only |
|---|---:|---:|---:|
| Tasks passed | 4 of 6 | 6 of 6 | 3 of 6 |
| Cost at list price | $1.6718 | $1.1738 | $0.0994 |
| 5-hour limit used (estimated) | 55.7% | 35.9% | 0.8% |
| Weekly limit used (estimated) | 22.3% | 14.4% | 0.3% |
| Saved, against Off | - | 29.8% | 94.1% (passed fewer) |

- **Relay with one model a mode** passed all six. It cost 29.8% less than Relay off and used about a third less of the estimated limits. On the morning's four exercises the saving was 47.6%; one exercise in six cost more with Relay.
- **The others:** Relay off failed `wordy` and `forth`. Flash alone failed three.
- **The test's own use of the owner's Go plan today:** about 26.5% of the month, by the same arithmetic. That is 132% of one 5-hour window, spread over two windows, and 52.9% of the weekly limit.

**OpenCode's service stopped answering, twice.**
- When: 15:12 and 20:16 UTC.
- Each time, a Relay RPC call (`listModels`, from the runner's check and from a model listing) went to the test folder after the service had evicted it (about an hour without use).
- The call booted the folder and got 400, "RPC is unavailable: relay-opencode", because the folder's plugins had not loaded yet. The plugins then loaded, Relay's last, and the service wrote nothing more. Desktop replaced it after about 1 and 8 minutes.
- The same folder booted without trouble when the owner opened it in the morning, and when Desktop booted it at 20:25.
- The cause is not known. `AGENTS.md` now counts an evicted folder as one the service has not loaded.

**Not tested.**
- On Ollama: the other four exercises (the cap), the "two for Execute" side, and Ollama's billing page.
- More than one run of each exercise.
- Claude: it needs an hour with no other Claude session of the owner's.
