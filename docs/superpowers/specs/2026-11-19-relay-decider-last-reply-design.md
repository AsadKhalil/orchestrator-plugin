# Relay: the decider sees the last reply (design)

Status: on 2026-11-19 the owner chose "Both" when asked which fix to plan. The plan is `docs/superpowers/plans/2026-11-19-relay-decider-last-reply.md`. Choices made while writing are marked *(my call)*.

## Why

The proof test on 19 Nov (`docs/compatibility.md`) set Execute up with two models:
- the cheap one, "small edits in one or two files";
- the strong one, "bigger changes across several files".

The decider was asked eight times about "Implement it." or "Fix what the review found.". Each time it was sure the mode was Execute (0.94 to 0.97), but it fitted neither line. Relay then kept the chat's model, which was the strong one from the plan step. So that setup cost as much as Relay off.

A short follow-up says nothing about how big the work is. The reply before it, the plan or the review, does.

## Goals

1. The decider also gets the end of the chat's last reply, so it can tell small work from big.
2. When it still fits no line, Relay uses the first model in the mode's list, not the chat's current model.

## Non-goals

- No new setting. The "use it for" lines stay as they are.
- No reply for a helper's decision: a helper's task text is already the whole request *(my call)*.
- No change to the mode rules (Plan when the decider is not sure, and so on), to the cost check (`stayOrGo`), or to the caps on the message (4,000 characters), the lines and the file names.

## Anti-goals: a failure even if it works

- Sending more than the end of the last reply. Never earlier replies, the model's reasoning, tool calls or tool output, file contents or pictures.
- Sending the path of the home folder. It is replaced by `~`, for the same reason file names are cut to their last part today *(my call)*.
- A slower or failed message. If the chat's messages cannot be read in time, the decider is asked without the reply, as today.

## Approaches (put to the owner on 19 Nov)

- **A. The decider sees the last reply.** An informed choice, but it changes a privacy promise. When it still can't tell, the chat keeps its model.
- **B. The first model when unsure.** A tiny change, and nothing new leaves the computer. But a short follow-up always goes to the first model, and the second is used only when the message itself describes big work.
- **C. Both.** A, then B when the decider still fits no line. Picked by the owner.

## The design

1. **What the decider gets** (`src/decider.ts`). After the person's message comes one more line: `The end of the chat's last reply: "…"`.
   - The reply is the text the model wrote in its latest reply, over all of that reply's requests. Reasoning, tool calls and tool output are left out.
   - Only its last 1,500 characters are sent, cut so that no two-unit character is split.
   - The line is left out when there is no reply yet, or when the chat could not be read.
   - The line question asks the decider to judge the size of the work by both the message and the reply.
2. **Where the reply comes from** (`src/relay-command.ts`). Relay already reads the chat's messages for the cost check (`session.context`, within the same time limit). The reply is taken from there, and the home folder's path is replaced by `~`.
3. **No line fits** (`src/router.ts`, `pickModel`). The first usable model in the mode's list is used, with the note "no line fits clearly, so the first model is used" (or "no answer about the lines, …").
   - The cost check still weighs any move to a cheaper model. So a chat can still stay where it is when the move does not pay.
   - A move to a dearer model is always made, as today.
   - The list's order now matters: the first model is the default *(my call: this follows the owner's own order instead of picking by price)*.
4. **Docs.**
   - `docs/privacy.md`: what the decider is sent.
   - `docs/guide.md`: the first model is the default when no line fits.
   - `AGENTS.md`: the size caps.
   - A dated line in the 13 Nov spec, where it lists what the decider is given.

## Testing

- Unit tests first (TDD) for the three code changes, then the four checks.
- In the owner's OpenCode, after their yes to update their Relay copy, the proof test's "On, two for Execute" side runs again on Go, on the six exercises. It is compared with the Off, "one model a mode" and Cheap sides already run.
- Success: for these one-file exercises the decider picks the "small edits" line, so the side costs about as little as "one model a mode", with no fewer tasks passed.

## Left to the builder

The exact wording of the reply line and of the line question's instruction.
