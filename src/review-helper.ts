import { LATE, within } from './decider.js';
import type { RelayDeps } from './relay-command.js';
import { getRelaySettings, modelName, recordDecision, type Decision } from './relay-store.js';
import { brief, candidates, checksStatus, linesFor, pickModel, reviewRules, UNSURE_BELOW } from './router.js';

// A helper (an OpenCode subagent) whose task is a check of work starts on a Review model, with the review rules added to its task.
// Every other helper stays exactly as the calling model asked for it, and nothing here may stop a helper from starting.

type ToolCall = { tool: string; sessionID: string; input: unknown };
const nothingAttached = { needsImage: false, tokens: 0 };
const given = (value: unknown) => value !== undefined && value !== null && value !== '';

export function reviewHelperHook(deps: Pick<RelayDeps, 'store' | 'chatModels' | 'decide' | 'owned' | 'readMs'>) {
  const readMs = deps.readMs ?? 5000;
  /** The record is for the panel; losing it must never fail a helper. */
  const record = async (sessionID: string, fields: Partial<Decision>): Promise<void> => {
    try { await recordDecision(deps.store, { at: new Date().toISOString(), sessionID, kind: 'helper', mode: null, confidence: null, fit: null, model: null, ms: 0, costUsd: null, note: null, ...fields }); } catch { /* not recorded */ }
  };
  return async (event: ToolCall): Promise<void> => {
    if (event.tool !== 'subagent') return;
    try {
      const input = event.input as { prompt?: unknown; model?: unknown; sessionID?: unknown } | null;
      // A call that names its model, or that continues an earlier helper, is left to whoever made that choice.
      if (!input || typeof input !== 'object' || typeof input.prompt !== 'string' || !input.prompt.trim() || given(input.model) || given(input.sessionID)) return;
      const owned = await within(() => deps.owned(event.sessionID), readMs);
      if (owned === LATE) throw new Error(`did not answer within ${readMs / 1000} seconds`);
      if (owned) return;
      const read = await within(() => Promise.all([getRelaySettings(deps.store), deps.chatModels()]), readMs);
      if (read === LATE) throw new Error(`did not answer within ${readMs / 1000} seconds`);
      const [settings, models] = read;
      if (!checksStatus(settings, models).active) return;
      const lines = linesFor(settings, models, nothingAttached).review;
      const answer = await deps.decide(settings.decider, { kind: 'helper', text: input.prompt, agent: null, files: [], images: 0, lines: lines ? { review: lines } : {} });
      if (answer.kind === 'none') return await record(event.sessionID, { ms: answer.ms, note: answer.reason });
      const decided = { mode: answer.mode, confidence: answer.confidence, ms: answer.ms, costUsd: answer.costUsd };
      if (answer.mode !== 'review') return await record(event.sessionID, { ...decided, note: 'not a check' });
      if (answer.confidence < UNSURE_BELOW) return await record(event.sessionID, { ...decided, note: 'not sure it is a check' });
      // A helper has no model of its own to keep, so with no clear line the first usable Review model is used.
      const picked = pickModel(candidates('review', settings.modes.review, models, nothingAttached).usable, answer.lines.review, null), model = modelName(picked.model);
      event.input = { ...input, model, prompt: `${input.prompt}\n\n${reviewRules}` };
      await record(event.sessionID, { ...decided, model, fit: picked.fit, note: picked.note });
    } catch (error) { await record(event.sessionID, { note: `helper left alone: ${brief(error)}` }); }
  };
}
