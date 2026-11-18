import { offered, type ModelChoice, type OfferedModel } from './settings.js';
import { modelName, modes, type Decision, type Mode, type ModeChoice, type RelaySettings } from './relay-store.js';
import { aboutUsd, parseUsd } from './costs.js';
import type { ModelCostView } from './inventory.js';

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
export type RoutableModel = OfferedModel & { capabilities: { input: readonly string[] }; limit: { context: number }; cost?: ModelCostView };
/** What is known of a chat: its size in tokens, and each model's latest answer in it, newest first, with the chat's size then and how long ago it was. */
export type ChatFacts = { tokens: number; answered: readonly { providerID: string; id: string; tokens: number; agoMs: number }[] };
/**
 * What comes with the message: whether a picture does, and about how many tokens the attached files take. For a message that goes to a chat
 * also what is known of that chat (null when it could not be read) and Relay's earlier records, for the usual number of requests.
 */
export type Attachment = { needsImage: boolean; tokens: number; chat?: ChatFacts | null; past?: readonly Pick<Decision, 'mode' | 'model' | 'reply'>[] };
export type RouteResult = { switch: true; mode: Mode; agent: 'plan' | 'build'; model: ModelChoice; fit: number | null; note: string | null } | { switch: false; mode: Mode | null; note: string };

const plain = ({ providerID, id, variant }: ModelChoice): ModelChoice => ({ providerID, id, variant });
const same = (a: ModelChoice, b: ModelChoice) => a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;

/**
 * How much of a model's window a chat may fill. OpenCode 2.3.0 compacts a chat before a request once less than 15% of the window is free,
 * or less than 16,000 tokens for a window of 32,000 or more (read in its source, not measured).
 */
const room = (window: number) => window - Math.max(Math.floor(window * 0.15), window >= 32_000 ? 16_000 : 0);

/** The models of one mode's list that can be used now, in the person's order. When none can, the note says why. `current` is the model the chat is on, when that is known. */
export function candidates(mode: Mode, list: readonly ModeChoice[], models: readonly RoutableModel[], attachment: Attachment, current: ModelChoice | null = null): { usable: ModeChoice[]; note: string | null } {
  const label = modeLabel(mode), none = (note: string) => ({ usable: [], note });
  if (!list.length) return none(`no model chosen for ${label}`);
  const listed = list.flatMap(choice => { const model = offered(models, choice); return model ? [{ choice, model }] : []; });
  if (!listed.length) return none(`no chosen ${label} model is offered right now`);
  const seeing = attachment.needsImage ? listed.filter(item => item.model.capabilities.input.includes('image')) : listed;
  if (!seeing.length) return none(`no chosen ${label} model takes pictures`);
  // shortcut: the new message itself is not counted, and a file is counted at four bytes to a token, so a chat close to a model's limit can still overflow it. A model whose size is not listed (0) is kept.
  const fitting = seeing.filter(item => !(item.model.limit.context > 0 && attachment.tokens > item.model.limit.context));
  if (!fitting.length) return none(`the attached files are too big for every chosen ${label} model`);
  // The whole chat must fit as well, with the attached files on top. The model the chat is on holds it already, whatever its effort.
  const whole = attachment.chat && attachment.chat.tokens > 0 ? attachment.chat.tokens + attachment.tokens : 0;
  const holding = fitting.filter(item => !(item.model.limit.context > 0 && whole > room(item.model.limit.context)) || (current !== null && item.choice.providerID === current.providerID && item.choice.id === current.id));
  if (!holding.length) return none(`this chat is too long for every chosen ${label} model`);
  return { usable: holding.map(item => item.choice), note: null };
}

/** The usable models the decider is asked about: those with a line, at most eight. A line answer's index points into this list. */
export const described = (usable: readonly ModeChoice[]): ModeChoice[] => usable.filter(choice => choice.useFor !== '').slice(0, MAX_LINES);

/** The lines to ask about, for each mode where there is a choice to make: two or more usable models, and at least one line. */
export function linesFor(settings: Pick<RelaySettings, 'modes'>, models: readonly RoutableModel[], attachment: Attachment, current: ModelChoice | null = null): Partial<Record<Mode, string[]>> {
  const lines: Partial<Record<Mode, string[]>> = {};
  for (const mode of modes) {
    const { usable } = candidates(mode, settings.modes[mode], models, attachment, current), asked = described(usable);
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

// Stay or go: a step down to a cheaper model is made only when it pays. Arithmetic only, on whole numbers; no model is asked. The method
// and its worked examples are in docs/research/2026-11-17-relay-cost-and-model-choice.md (section 4.2). Nothing in it has been measured.
// shortcut: a cache is taken to live five minutes, OpenCode's default. A longer lifetime set in OpenCode is not read, so a chat that was idle for more than five minutes is always moved.
const CACHE_MS = 5 * 60_000;
// shortcut: each coming request is taken to read 1,500 new tokens and write 500, and a line with fewer than three records to take 6 requests, until Relay's records give real averages.
const NEW_IN = 1500n, NEW_OUT = 500n, USUAL_REQUESTS = 6;
type Price = { read: bigint; write: bigint; output: bigint };

/** A model's prices for a chat of `tokens`, in trillionths of a dollar per million tokens. Null when there is nothing to compare: no price, or $0, which can mean "not listed". */
function priceFor(cost: ModelCostView | undefined, tokens: number): Price | null {
  if (!cost) return null;
  const at = [...cost.steps].reverse().find(step => tokens > step.above) ?? cost;
  if (at.inputPerMillion === null || at.outputPerMillion === null) return null;
  try {
    const input = parseUsd(at.inputPerMillion), output = parseUsd(at.outputPerMillion);
    if (input === 0n && output === 0n) return null;
    const read = at.cacheReadPerMillion === null ? 0n : parseUsd(at.cacheReadPerMillion), write = at.cacheWritePerMillion === null ? 0n : parseUsd(at.cacheWritePerMillion);
    // With no cached-read price the model is taken to have no cache; with no cache-write price, writing costs what input costs.
    return { read: read > 0n ? read : input, write: write > input ? write : input, output };
  } catch { return null; }
}

/** Whether the chat's model stays for this message although the line chose `pick`, with the note for the record. Only a move between two models of this mode's list is weighed. */
function stayOrGo(mode: Mode, pick: ModelChoice, current: ModelChoice | null, usable: readonly ModeChoice[], models: readonly RoutableModel[], attachment: Attachment): { stay: boolean; note: string | null } {
  const go = (note: string | null = null) => ({ stay: false, note }), { chat } = attachment;
  const is = (model: { providerID: string; id: string }, choice: ModelChoice) => model.providerID === choice.providerID && model.id === choice.id;
  if (chat === undefined || current === null || is(pick, current) || !usable.some(choice => same(choice, current))) return go();
  if (chat === null) return go("the chat's size could not be read, so no cost check");
  // Nothing to lose: a new chat, one that was just compacted, a last answer from another model, or a cache that has run out.
  const last = chat.answered[0];
  if (!last || !is(last, current) || last.agoMs > CACHE_MS) return go();
  const size = Math.max(0, Math.round(chat.tokens)), priceOf = (choice: ModelChoice) => priceFor(models.find(model => is(model, choice))?.cost, size);
  const from = priceOf(current), to = priceOf(pick);
  if (!from || !to) return go('no price listed, so no cost check');
  // Tokens times a price for a million tokens, so every amount here is a million times too big until it is shown.
  const request = (price: Price) => BigInt(size) * price.read + NEW_IN * price.write + NEW_OUT * price.output, less = request(from) - request(to);
  if (less <= 0n) return go();   // a step up: the line asked for the stronger model
  const name = modelName(pick), took = (attachment.past ?? []).flatMap(item => item.mode === mode && item.model === name && item.reply ? [item.reply.requests] : []).sort((a, b) => a - b);
  const requests = took.length >= 3 ? Math.max(1, Math.round(took[Math.floor((took.length - 1) / 2)])) : USUAL_REQUESTS;
  // What the pick must read again: the whole chat, or only what was added since it last answered here, while its cache lives.
  const held = chat.answered.find(item => is(item, pick) && item.agoMs <= CACHE_MS)?.tokens ?? 0;
  const saving = BigInt(requests) * less, extra = BigInt(Math.max(0, size - Math.round(held))) * (to.write - to.read);
  if (2n * saving >= 3n * extra) return go();   // it pays when the saving is at least one and a half times the extra
  return { stay: true, note: `moving this chat to ${name} would cost ${aboutUsd(extra / 1_000_000n)} to read it again and save ${aboutUsd(saving / 1_000_000n)} over ${requests} requests${saving >= extra ? ', less than one and a half times that cost' : ''}, so the chat's model stays` };
}

/** `unsure` says what an answer under UNSURE_BELOW means: Plan for `/relay`, no change for a chat whose switch is on. */
export function route(answer: DeciderAnswer, settings: Pick<RelaySettings, 'modes'>, models: readonly RoutableModel[], attachment: Attachment, current: ModelChoice | null, unsure: 'plan' | 'stay' = 'plan'): RouteResult {
  if (answer.kind === 'none') return { switch: false, mode: null, note: answer.reason };
  const doubtful = answer.confidence < UNSURE_BELOW;
  if (doubtful && unsure === 'stay') return { switch: false, mode: null, note: 'not sure, so the chat stays as it is' };
  const mode: Mode = doubtful ? 'plan' : answer.mode, notes = doubtful ? ['not sure, so Plan'] : [];
  const { usable, note } = candidates(mode, settings.modes[mode], models, attachment, current);
  if (note !== null) return { switch: false, mode, note: [...notes, note].join('; ') };
  const chosen = pickModel(usable, answer.lines[mode], current), weighed = stayOrGo(mode, chosen.model, current, usable, models, attachment);
  for (const said of [chosen.note, weighed.note]) if (said !== null) notes.push(said);
  // Whichever model is used, the mode still sets the agent and the review rules.
  const kept = weighed.stay && current !== null;
  return { switch: true, mode, agent: mode === 'execute' ? 'build' : 'plan', model: kept ? plain(current) : chosen.model, fit: kept ? null : chosen.fit, note: notes.length ? notes.join('; ') : null };
}

/** Whether a helper that checks work can be given a Review model at all, and if not, why. */
export function checksStatus(settings: Pick<RelaySettings, 'modes' | 'decider'>, models: readonly RoutableModel[]): { active: boolean; note: string | null } {
  if (!settings.decider) return { active: false, note: 'no decider chosen' };
  const { note } = candidates('review', settings.modes.review, models, { needsImage: false, tokens: 0 });
  return { active: note === null, note };
}
