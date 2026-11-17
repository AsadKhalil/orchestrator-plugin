import { offered, type ModelChoice, type OfferedModel } from './settings.js';
import { modes, type Mode, type ModeChoice, type RelaySettings } from './relay-store.js';

// Pure rules: which of a mode's models can be used now, which "use it for" lines the decider is asked about, and what its answer means for the chat.
// Nothing here calls the host, and nothing here may import from `node:` (the panel bundles this file).

/** The error's own message when it has one, so a person sees why something was refused; else the fallback. */
export function describeError(error: unknown, fallback: string): string {
  const message = typeof error === 'string' ? error : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
  return message.trim() ? message : fallback;
}

/** Below this the decider is not sure of the mode, and the mode is Plan. */
export const UNSURE_BELOW = 0.6;
/** Below this the decider is not sure of the line, and no line counts as chosen. */
export const LINE_UNSURE_BELOW = 0.5;
export const MAX_LINES = 8;
export const REVIEW_RULES_KEY = 'relay-review-rules';
export const reviewRules = [
  'When you review work in this chat, follow these rules.',
  '1. Report a blocking finding only when you have concrete evidence of a defect or of an unmet requirement. Everything else is an advisory note, and a note never calls for another round.',
  '2. End every review with a verdict: "approve" or "request changes". Approve when no blocking finding remains.',
  '3. When you check work again after a fix, look only at whether the earlier blocking findings are fixed and whether the fix broke something. Do not start a new full review.',
  '4. One piece of work gets at most three checks. After the third, stop and list what is still open so the person can decide.',
].join('\n');
const labels = { plan: 'Plan', execute: 'Execute', review: 'Review' } as const;
export const modeLabel = (mode: Mode) => labels[mode];
/** Cuts text to at most `max` characters without ending inside a two-unit character (a surrogate pair). */
export function safeHead(text: string, max: number): string {
  const head = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}
/** A failure's message as part of a note: one line, at most 200 characters. */
export const brief = (error: unknown) => safeHead(describeError(error, 'unknown error').replace(/\s+/g, ' ').trim(), 200);

/** The decider's answer about one mode's lines. `index` points into `described(usable)`; null means it chose "none of these". */
export type LineAnswer = { index: number | null; confidence: number };
export type DeciderAnswer = { kind: 'answer'; mode: Mode; confidence: number; lines: Partial<Record<Mode, LineAnswer>>; ms: number; costUsd: string | null } | { kind: 'none'; reason: string; ms: number };
export type RoutableModel = OfferedModel & { capabilities: { input: readonly string[] }; limit: { context: number } };
/** What comes with the message: whether a picture does, and about how many tokens the attached files take. */
export type Attachment = { needsImage: boolean; tokens: number };
export type RouteResult = { switch: true; mode: Mode; agent: 'plan' | 'build'; model: ModelChoice; fit: number | null; note: string | null } | { switch: false; mode: Mode | null; note: string };

const plain = ({ providerID, id, variant }: ModelChoice): ModelChoice => ({ providerID, id, variant });
const same = (a: ModelChoice, b: ModelChoice) => a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;

/** The models of one mode's list that can be used now, in the person's order. When none can, the note says why. */
export function candidates(mode: Mode, list: readonly ModeChoice[], models: readonly RoutableModel[], attachment: Attachment): { usable: ModeChoice[]; note: string | null } {
  const label = modeLabel(mode), none = (note: string) => ({ usable: [], note });
  if (!list.length) return none(`no model chosen for ${label}`);
  const listed = list.flatMap(choice => { const model = offered(models, choice); return model ? [{ choice, model }] : []; });
  if (!listed.length) return none(`no chosen ${label} model is offered right now`);
  const seeing = attachment.needsImage ? listed.filter(item => item.model.capabilities.input.includes('image')) : listed;
  if (!seeing.length) return none(`no chosen ${label} model takes pictures`);
  // shortcut: only the attached files are counted, not the message or the chat so far, so a long chat can still overflow the chosen model. A model whose size is not listed (0) is kept.
  const fitting = seeing.filter(item => !(item.model.limit.context > 0 && attachment.tokens > item.model.limit.context));
  if (!fitting.length) return none(`the attached files are too big for every chosen ${label} model`);
  return { usable: fitting.map(item => item.choice), note: null };
}

/** The usable models the decider is asked about: those with a line, at most eight. A line answer's index points into this list. */
export const described = (usable: readonly ModeChoice[]): ModeChoice[] => usable.filter(choice => choice.useFor !== '').slice(0, MAX_LINES);

/** The lines to ask about, for each mode where there is a choice to make: two or more usable models, and at least one line. */
export function linesFor(settings: Pick<RelaySettings, 'modes'>, models: readonly RoutableModel[], attachment: Attachment): Partial<Record<Mode, string[]>> {
  const lines: Partial<Record<Mode, string[]>> = {};
  for (const mode of modes) {
    const { usable } = candidates(mode, settings.modes[mode], models, attachment), asked = described(usable);
    if (usable.length > 1 && asked.length) lines[mode] = asked.map(choice => choice.useFor);
  }
  return lines;
}

/** One model out of a mode's usable ones (never empty). `current` is the model the chat is on, when that is known. */
export function pickModel(usable: readonly ModeChoice[], line: LineAnswer | undefined, current: ModelChoice | null): { model: ModelChoice; fit: number | null; note: string | null } {
  const asked = described(usable);
  if (usable.length === 1 || !asked.length) return { model: plain(usable[0]), fit: null, note: null };
  const chosen = line && line.index !== null ? asked[line.index] : undefined;
  if (line && chosen && line.confidence >= LINE_UNSURE_BELOW) return { model: plain(chosen), fit: line.confidence, note: null };
  const reason = line && (line.index === null || chosen) ? 'no line fits clearly' : 'no answer about the lines';
  const kept = current && usable.find(choice => same(choice, current));
  return kept ? { model: plain(kept), fit: null, note: `${reason}, so the chat's model stays` } : { model: plain(usable[0]), fit: null, note: `${reason}, so the first model is used` };
}

/** `unsure` says what an answer under UNSURE_BELOW means: Plan for `/relay`, no change for a chat whose switch is on. */
export function route(answer: DeciderAnswer, settings: Pick<RelaySettings, 'modes'>, models: readonly RoutableModel[], attachment: Attachment, current: ModelChoice | null, unsure: 'plan' | 'stay' = 'plan'): RouteResult {
  if (answer.kind === 'none') return { switch: false, mode: null, note: answer.reason };
  const doubtful = answer.confidence < UNSURE_BELOW;
  if (doubtful && unsure === 'stay') return { switch: false, mode: null, note: 'not sure, so the chat stays as it is' };
  const mode: Mode = doubtful ? 'plan' : answer.mode, notes = doubtful ? ['not sure, so Plan'] : [];
  const { usable, note } = candidates(mode, settings.modes[mode], models, attachment);
  if (note !== null) return { switch: false, mode, note: [...notes, note].join('; ') };
  const chosen = pickModel(usable, answer.lines[mode], current);
  if (chosen.note !== null) notes.push(chosen.note);
  return { switch: true, mode, agent: mode === 'execute' ? 'build' : 'plan', model: chosen.model, fit: chosen.fit, note: notes.length ? notes.join('; ') : null };
}

/** Whether a helper that checks work can be given a Review model at all, and if not, why. */
export function checksStatus(settings: Pick<RelaySettings, 'modes' | 'decider'>, models: readonly RoutableModel[]): { active: boolean; note: string | null } {
  if (!settings.decider) return { active: false, note: 'no decider chosen' };
  const { note } = candidates('review', settings.modes.review, models, { needsImage: false, tokens: 0 });
  return { active: note === null, note };
}
