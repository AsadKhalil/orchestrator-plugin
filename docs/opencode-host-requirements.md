# What Feature Pilot needs from OpenCode

Feature Pilot keeps two things gated because stock OpenCode 2.2.7 does not give plugins what they need. Nothing here is a pull request; it is the list a contributor would work from. Every "recorded" statement points at `docs/compatibility.md`; anything not listed there is unverified.

## 1. Service steps (long-running process with a readiness probe)

Plan steps with `execution.kind: 'service'` (a dev server, a database for browser tests) pause with `unsupported_step`. One-shot `command` steps already work: they run in the foreground and need no job tracking. A service is different, because the plugin must start a process that outlives the tool call, decide when it is ready, and be certain it is gone when the run stops, fails or is cancelled. The plan forbids enabling that until the host can prove the last part.

### What stock 2.2.7 does (recorded)

| Need | Stock 2.2.7 |
|---|---|
| Start a background shell | Works: the native `shell` tool with `background: true` returns a shell ID and emits `shell.created` / `shell.exited`. |
| Inspect or stop it from the plugin | **Missing.** The plugin context exposes `shell.hook` only. The external client has `shell.get` and `shell.remove`, but a plugin has no authenticated route to that client. |
| Stop it through the session | **Does not work.** Interrupting the owning session returned `false` and the synthetic shell kept running. |
| Prove a shell belongs to a run | **Missing.** Shell metadata is supplied by the caller, so it is not evidence of ownership. |
| Learn that it exited | Events are ephemeral. Loss, replay after reconnect and immediate-exit races are unverified. |
| Avoid a paid model turn on exit | **No.** Background completion woke the session and triggered one `primary` model request (blocked in the test before inference). |

### What a host change would need to provide

1. **Plugin-context shell operations**, location-scoped: `get` (status, exit code), `output`, and `stop` that waits for the process to die and leaves its output readable. A `remove` is optional. A local prototype of `get`/`output`/`remove`/`stop` exists on a `v2.2.7` checkout (not in this repository). Its recorded macOS tests cover an ordinary child process and overlapping stop calls.
2. **Host-recorded ownership.** The plugin must be able to tag a shell when it creates it, and the host must store and return that tag itself (not copy caller metadata), so a stop can refuse a shell that another run or another plugin started.
3. **A stop that cleans up.** Documented, tested behaviour for descendants (including detached ones), kill failures, stop racing remove, process-ID reuse, and output retention while stopping.
4. **A durable way to learn the result.** Either replayable exit events or a status query that stays valid after the event was missed.
5. **Control over the wake-up.** Some way to mark a plugin-owned shell so its completion does not start a model turn, or a documented guarantee about when it does. Feature Pilot must account for every paid request.
6. **Platform coverage.** Everything above on Windows and Linux as well as macOS. Only macOS has any recorded result.

Item 1 plus 2 is the smallest change that lets Feature Pilot stop a service it started and refuse one it did not. Items 3 to 6 are what make that safe enough to turn on.

### What Feature Pilot would do once it exists

The run record already stores background jobs (intent, native handle, exit, readiness, deadline, deduplicated completions, stale-content rejection) and the stop path already tries to stop them. What is missing is the `Host` implementation behind those calls and removing the `unsupported_step` pre-scan in `src/orchestrator.ts` for services. It will not be switched on before the checks in section 3 pass on the pinned host.

## 2. Atomic storage

Plugin storage on stock 2.2.7 has no compare-and-set. Without a workaround the driver would pause with `budget_exhausted` before any model request, and autonomous runs would be refused: fail-closed, but **no run could reach a model**. The plugin now carries a workaround (a SQLite file it owns, used only when the host has no atomic storage; see `docs/compatibility.md`), so this is no longer a blocker for trying it, but it is still the right thing to fix upstream: the workaround is not protected from other programs running as the user, lives outside the host's own database, and its spend is not carried over when the host gains atomic storage. Spending limits, run revisions and prompt de-duplication all rely on compare-and-set. A local fork that adds it passed a two-server race test (`scripts/smoke-fork-cas.mjs`, recorded in `docs/compatibility.md`).

A host change would add an atomic `compareAndSet(key, previous, next)` to plugin storage with the same semantics across processes sharing one database.

## 3. Acceptance checks before enabling either

- Start a shell, kill the parent session, restart the host: the plugin can find the shell by its ownership tag and stop it, descendants included.
- Stop and completion racing each other leave one outcome and readable output.
- Two hosts on one database: exactly one compare-and-set wins.
- A background completion either starts no model turn or starts exactly one that the spending guard sees and reserves for.
- The above on Windows, Linux and macOS.

## 4. Not a request, but found on the way

- A handler that throws reaches the client only as `rpc.internal: "RPC call failed"`. Feature Pilot now returns a declared `rejected` error so the panel can show the message. A line in the plugin docs would save the next author the same discovery.

## Before opening anything upstream

Check OpenCode's own contribution guide for how it wants host API changes proposed (issue first, design note, or PR). Splitting the work is likely to be easier to review: plugin shell operations, host-recorded ownership, and atomic storage are independent.
