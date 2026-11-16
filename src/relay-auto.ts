import type { PromptInput } from '@opencode/schema/prompt-input';
import type { Session } from '@opencode/schema/session';
import { within } from './decider.js';
import { placeMessage, recordPlaced, timingOf, type RelayDeps } from './relay-command.js';
import { chatSwitch } from './relay-store.js';

// The switch. In a chat where `/relay on` (or the pill) turned it on, every message the person sends is placed the way `/relay` places one,
// inside the host's `prompt` hook, before the message goes out (a switch made there serves that message: probe, 16 Nov). The host sends the
// message; this never does. It never throws, because a throw fails the person's message; what goes wrong becomes a note in the record.

/** How long a chat may take to show it is idle before it counts as busy and is left as it is. */
export const BUSY_CHECK_MS = 300;
type PromptEvent = { readonly sessionID: string; readonly prompt?: PromptInput.Prompt; readonly metadata?: Record<string, unknown> };

export function relayAutoHook(deps: RelayDeps) {
  const timing = { ...timingOf(deps), waitMs: BUSY_CHECK_MS };
  // The switch is read for every message in every chat, so a slow store must not hold them all for long.
  const flagMs = Math.min(timing.readMs, 1000);
  return async (event: PromptEvent): Promise<void> => {
    try {
      // `/relay` placed this message already and marked its send.
      if (event.metadata?.relay !== undefined || !event.prompt?.text?.trim()) return;
      const sessionID = event.sessionID as Session.ID, prompt = event.prompt;
      if (await within(() => chatSwitch(deps.store, sessionID), flagMs) !== true) return;
      // shortcut: the hook holds a message for at most three read limits; work still running then goes on without it, so a host call that
      // answers very late could switch the chat during the reply. The hook also does not wait for a `/relay` of the same chat that is still running.
      await within(async () => {
        if (await within(() => deps.owned(sessionID), timing.readMs) !== false) return;
        const placed = await placeMessage(deps, timing, { sessionID, prompt, unsure: 'stay' });
        // The record is for the panel; the message does not wait for it. recordPlaced never rejects.
        void recordPlaced(deps, sessionID, placed);
      }, timing.readMs * 3);
    } catch { /* never fail the person's message */ }
  };
}
