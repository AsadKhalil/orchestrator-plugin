import type { PromptInput } from '@opencode/schema/prompt-input';
import type { Session } from '@opencode/schema/session';
import { within } from './decider.js';
import { replyOf } from './chat-facts.js';
import { placeMessage, recordPlaced, timingOf, uploadsOf, type RelayDeps } from './relay-command.js';
import { chatSwitch, saveReplies, waitingReplies } from './relay-store.js';

// The switch. In a chat where `/relay on` (or the pill) turned it on, every message the person sends is placed the way `/relay` places one,
// inside the host's `prompt` hook, before the message goes out (a switch made there serves that message: probe, 16 Nov). The host sends the
// message; this never does. It never throws, because a throw fails the person's message; what goes wrong becomes a note in the record.

/** How long a chat may take to show it is idle before it counts as busy and is left as it is. */
export const BUSY_CHECK_MS = 300;
type PromptEvent = { readonly sessionID: string; readonly messageID?: string; readonly prompt?: PromptInput.Prompt; readonly metadata?: Record<string, unknown> };

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
        const placed = await placeMessage(deps, timing, { sessionID, prompt, unsure: 'stay', uploads: uploadsOf(event.metadata) });
        // The record is for the panel; the message does not wait for it. recordPlaced never rejects.
        void recordPlaced(deps, sessionID, placed, typeof event.messageID === 'string' ? event.messageID : null);
      }, timing.readMs * 3);
    } catch { /* never fail the person's message */ }
  };
}

/**
 * What a reply took. When a chat has finished its work, the host runs this just before the chat goes idle. For each record of that chat
 * that still waits, the reply is read from the chat's own messages and kept with the record, with the prices the model list gives for the
 * model that answered. No model is asked. It never throws, and it holds the chat for one second at most; a chat with no waiting record costs
 * one read of storage.
 */
export function relayReplyHook(deps: Pick<RelayDeps, 'session' | 'store' | 'readMs' | 'chatModels'>) {
  const limitMs = Math.min(timingOf(deps).readMs, 1000);
  return async (event: { readonly sessionID: string }): Promise<void> => {
    try {
      await within(async () => {
        const waiting = await waitingReplies(deps.store, event.sessionID);
        if (!waiting.length) return;
        // A model list that fails, or takes more than half the time, leaves the prices unknown; the reply is kept all the same.
        const [messages, models] = await Promise.all([deps.session.context({ sessionID: event.sessionID as Session.ID }), within(deps.chatModels, limitMs / 2).catch(() => null)]);
        const listed = Array.isArray(models) ? models : null;
        const replies = new Map(waiting.flatMap(messageID => { const reply = replyOf(messages, messageID, listed); return reply ? [[messageID, reply] as const] : []; }));
        if (replies.size) await saveReplies(deps.store, event.sessionID, replies);
      }, limitMs);
    } catch { /* the record is for the panel; the chat goes idle whatever happens here */ }
  };
}
