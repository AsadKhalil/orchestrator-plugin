import { costOf, formatUsd, parseUsd, storedUsd } from './costs.js';
import type { PriceStep } from './inventory.js';
import { offered, validateChoices, type ModelChoice, type OfferedModel } from './settings.js';

// What Relay keeps in plugin storage. The host shares plugin storage between projects, so there is one set of settings and one list of decisions.
// shortcut: one queue for this loaded module, so its own reads and writes never interleave. A second process writing the same keys is not
// held back by it; with no compare-and-set in stock storage, a save from two OpenCode processes in the same instant can still lose one.
let queue: Promise<void> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task); queue = result.then(() => undefined, () => undefined); return result;
}
export const modes = ['plan', 'execute', 'review'] as const;
export type Mode = typeof modes[number];
export const USE_FOR_MAX = 200;
/** A model chosen for a mode, with the person's own words for the kind of work it suits. An empty line means nothing was written. */
export type ModeChoice = ModelChoice & { useFor: string };
export type RelaySettings = { revision: number; modes: Record<Mode, ModeChoice[]>; decider: ModelChoice | null };
/** USD for one million tokens, as the host lists them; null is unknown. */
export type Prices = Omit<PriceStep, 'above'>;
/** Every request of a reply added up, as the host counts tokens (`input` is read new and not written to a cache), and the host's own cost. */
export type Totals = { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; costUsd: string | null };
/**
 * What the reply to a placed message took, read from the chat afterwards: the tokens its first request read new (not from a cache) and from
 * a cache, that request's cost, the seconds until its first word, and how many requests the whole reply made; the model and effort that
 * answered, the whole reply added up, and that model's listed prices for the size of the first request. A reply kept before 19 Nov 2026 has
 * no model, totals or prices.
 */
export type Reply = { requests: number; fresh: number; cached: number; costUsd: string | null; seconds: number | null; model: string | null; total: Totals | null; prices: Prices | null; pricesFrom: PriceSource | null };
/** Where a reply's prices came from: OpenCode's own list (what is paid), or Artificial Analysis's when OpenCode lists none. */
export type PriceSource = 'opencode' | 'artificial-analysis';
const sources: readonly PriceSource[] = ['opencode', 'artificial-analysis'];
type Kinds<T> = { input: T; output: T; cacheRead: T; cacheWrite: T };
/**
 * The totals of one model and effort over every reply Relay counted. `byPrice` is tokens times each reply's own price, by kind (output with
 * its reasoning), and null for a kind no reply had a price for; `prices` and `pricesFrom` are the last reply's.
 */
export type UsageRow = { model: string; messages: number; requests: number; input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; openCodeUsd: string | null; byPrice: Kinds<string | null>; prices: Prices | null; pricesFrom: PriceSource | null };
/** `since` is when the first reply was counted. */
export type Usage = { since: string | null; rows: UsageRow[] };
/**
 * One routing decision. It never holds the message text or a file name. `fit` is how sure the decider was about the "use it for" line.
 * `messageID` names the message the decision was made for, so that `reply` can be read once the chat has answered it.
 */
export type Decision = { at: string; sessionID: string; kind: 'chat' | 'helper'; mode: Mode | null; confidence: number | null; fit: number | null; model: string | null; ms: number; costUsd: string | null; note: string | null; messageID: string | null; reply: Reply | null };
export type RelayStore = { get(key: string): Promise<unknown>; set(key: string, value: RelaySettings | Decision[] | Usage | boolean): Promise<void>; compareAndSet?(key: string, expected: unknown, value: RelaySettings | Decision[]): Promise<boolean> };

const SETTINGS = 'relay/settings', DECISIONS = 'relay/decisions', USAGE = 'relay/usage', KEEP = 20;
const same = (a: ModelChoice, b: ModelChoice) => a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;
export const modelName = (choice: ModelChoice) => `${choice.providerID}/${choice.id}${choice.variant === null ? '' : `#${choice.variant}`}`;
/**
 * A variant as the host reports it, in a choice's terms. The host names "no variant requested" `default` (seen on 2.2.7, even for a model that has
 * no variants), while a choice uses `null`; compared raw, a chat on its default variant would never match a choice.
 */
// shortcut: a model with a real variant literally named `default` is treated as having none, because the host reports both the same way.
export const hostVariant = (variant: string | null | undefined): string | null => (variant === undefined || variant === 'default' ? null : variant);

function entries(value: unknown): ModeChoice[] {
  if (!Array.isArray(value)) throw new Error('Invalid mode choices');
  const parts = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid model choice');
    const { useFor = '', ...choice } = item as { useFor?: unknown };
    if (typeof useFor !== 'string') throw new Error('Invalid "use it for" line');
    const line = useFor.replace(/\s+/g, ' ').trim();
    if (line.length > USE_FOR_MAX) throw new Error(`A "use it for" line can have at most ${USE_FOR_MAX} characters`);
    return { choice, line };
  });
  return validateChoices(parts.map(part => part.choice)).map((choice, index) => ({ ...choice, useFor: parts[index].line }));
}
function shape(value: unknown, keys: string): Pick<RelaySettings, 'modes' | 'decider'> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys) throw new Error('Invalid Relay settings');
  const { modes: lists, decider } = value as { modes: Record<Mode, unknown>; decider: unknown };
  if (!lists || typeof lists !== 'object' || Array.isArray(lists) || Object.keys(lists).sort().join(',') !== 'execute,plan,review') throw new Error('Invalid modes');
  return { modes: { plan: entries(lists.plan), execute: entries(lists.execute), review: entries(lists.review) }, decider: decider === null ? null : validateChoices([decider])[0] };
}
function decode(value: unknown): RelaySettings {
  if (value === undefined) return { revision: 0, modes: { plan: [], execute: [], review: [] }, decider: null };
  const revision = (value as { revision?: unknown } | null)?.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid Relay settings');
  return { revision, ...shape(value, 'decider,modes,revision') };
}

export function getRelaySettings(store: Pick<RelayStore, 'get'>): Promise<RelaySettings> { return serial(async () => decode(await store.get(SETTINGS))); }

/** A choice that was already saved may stay when it is no longer offered; a new one must be offered now. Only a decision model can be the decider. */
export function saveRelaySettings(store: RelayStore, revision: number, input: unknown, chatModels: readonly OfferedModel[], decisionModels: readonly OfferedModel[]): Promise<RelaySettings> {
  return serial(async () => {
    const next = shape(input, 'decider,modes'), raw = await store.get(SETTINGS), previous = decode(raw);
    if (!Number.isSafeInteger(revision) || revision !== previous.revision || revision === Number.MAX_SAFE_INTEGER) throw new Error('Stale settings revision');
    for (const mode of modes) for (const choice of next.modes[mode]) {
      if (!previous.modes[mode].some(old => same(old, choice)) && !offered(chatModels, choice)) throw new Error('Selected model or variant is unavailable');
    }
    if (next.decider && !(previous.decider && same(previous.decider, next.decider)) && !offered(decisionModels, next.decider)) throw new Error('The decider must be a decision model that is offered');
    const saved = { revision: revision + 1, ...next };
    if (typeof store.compareAndSet === 'function') {
      const updated = await store.compareAndSet(SETTINGS, raw, saved);
      if (updated === false) throw new Error('Stale settings revision');
      if (updated !== true) throw new Error('Invalid compare-and-set response');
    } else await store.set(SETTINGS, saved);
    return structuredClone(saved);
  });
}

const number = (field: unknown) => typeof field === 'number' && Number.isFinite(field) ? field : null, text = (field: unknown) => typeof field === 'string' ? field : null;
const sourceOf = (field: unknown) => sources.find(source => source === field) ?? null;
function pricesOf(field: unknown): Prices | null {
  const listed = field && typeof field === 'object' ? field as Partial<Record<keyof Prices, unknown>> : null;
  return listed && { inputPerMillion: text(listed.inputPerMillion), outputPerMillion: text(listed.outputPerMillion), cacheReadPerMillion: text(listed.cacheReadPerMillion), cacheWritePerMillion: text(listed.cacheWritePerMillion) };
}
/** A stored record as the panel may show it, or null when it cannot be read. A field this version does not know is dropped, and a missing one reads as unknown. */
function readable(value: unknown): Decision | null {
  const item = value as Partial<Record<keyof Decision, unknown>> | null;
  if (!item || typeof item !== 'object' || typeof item.at !== 'string' || typeof item.sessionID !== 'string' || (item.kind !== 'chat' && item.kind !== 'helper') || typeof item.ms !== 'number') return null;
  const took =(item.reply && typeof item.reply === 'object' ? item.reply : {}) as Partial<Record<keyof Reply, unknown>>, requests = number(took.requests), fresh = number(took.fresh), cached = number(took.cached);
  const sum = (took.total && typeof took.total === 'object' ? took.total : {}) as Partial<Record<keyof Totals, unknown>>;
  const [input, output, reasoning, cacheRead, cacheWrite] = [sum.input, sum.output, sum.reasoning, sum.cacheRead, sum.cacheWrite].map(number);
  const total = input === null || output === null || reasoning === null || cacheRead === null || cacheWrite === null ? null : { input, output, reasoning, cacheRead, cacheWrite, costUsd: text(sum.costUsd) };
  const reply = requests === null || fresh === null || cached === null ? null : { requests, fresh, cached, costUsd: text(took.costUsd), seconds: number(took.seconds), model: text(took.model), total, prices: pricesOf(took.prices), pricesFrom: sourceOf(took.pricesFrom) };
  return { at: item.at, sessionID: item.sessionID, kind: item.kind, mode: modes.find(mode => mode === item.mode) ?? null, confidence: number(item.confidence), fit: number(item.fit), model: text(item.model), ms: item.ms, costUsd: text(item.costUsd), note: text(item.note), messageID: text(item.messageID), reply };
}
const stored = async (store: Pick<RelayStore, 'get'>): Promise<Decision[]> => {
  const value = await store.get(DECISIONS);
  return Array.isArray(value) ? value.map(readable).filter(item => item !== null) : [];
};

/** A new record has no reply yet; one made for a message of a chat names that message. */
export function recordDecision(store: RelayStore, decision: Omit<Decision, 'messageID' | 'reply'> & { messageID?: string | null }): Promise<void> {
  // shortcut: one stored list. Two project folders deciding in the same instant can lose one record; give each record its own key if that ever matters.
  return serial(async () => store.set(DECISIONS, [...await stored(store), { messageID: null, ...decision, reply: null }].slice(-KEEP)));
}
const waits = (item: Decision, sessionID: string): item is Decision & { messageID: string } => item.sessionID === sessionID && item.messageID !== null && item.reply === null;
/** The messages of one chat whose records still wait for what the reply took. */
export function waitingReplies(store: Pick<RelayStore, 'get'>, sessionID: string): Promise<string[]> {
  return serial(async () => (await stored(store)).flatMap(item => waits(item, sessionID) ? [item.messageID] : []));
}
/** Keeps what the replies took, by message, with the records of one chat that still wait for it. A reply that was kept once is not replaced. */
// shortcut: a record whose reply can never be read (an answer that was stopped, a message that was taken back or compacted away before
// its reply was read) waits until it leaves the list of 20, so its chat is read once more each time it goes idle.
// Each reply kept here is also added to the totals of its model and effort. The record is written first, so a reply is counted at most once.
// shortcut: two OpenCode processes that keep the same reply in the same instant can each count it; give each count a key of its own if that ever matters.
export function saveReplies(store: RelayStore, sessionID: string, replies: ReadonlyMap<string, Reply>, now = Date.now()): Promise<void> {
  return serial(async () => {
    const kept: Reply[] = [];
    await store.set(DECISIONS, (await stored(store)).map(item => {
      if (!waits(item, sessionID)) return item;
      const reply = replies.get(item.messageID) ?? null;
      if (reply) kept.push(reply);
      return { ...item, reply };
    }));
    if (kept.length) await store.set(USAGE, counted(await storedUsage(store), kept, now));
  });
}

const kinds = [['input', 'inputPerMillion'], ['output', 'outputPerMillion'], ['cacheRead', 'cacheReadPerMillion'], ['cacheWrite', 'cacheWritePerMillion']] as const;
const plus = (sum: string | null, more: bigint | null) => more === null ? sum : formatUsd((sum === null ? 0n : parseUsd(sum)) + more);
/** The totals with these replies added; a reply with no totals (kept before 19 Nov 2026) adds nothing. */
function counted(usage: Usage, replies: readonly Reply[], now: number): Usage {
  const rows = new Map(usage.rows.map(row => [row.model, row]));
  for (const reply of replies) {
    const { total } = reply;
    if (!total) continue;
    const model = reply.model ?? 'unknown model', none = { input: null, output: null, cacheRead: null, cacheWrite: null };
    const row = rows.get(model) ?? { model, messages: 0, requests: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, openCodeUsd: '0', byPrice: none, prices: null, pricesFrom: null };
    // Reasoning is billed at the output price, as in scripts/bench/lib.ts.
    const tokens = { input: total.input, output: total.output + total.reasoning, cacheRead: total.cacheRead, cacheWrite: total.cacheWrite };
    const byPrice = Object.fromEntries(kinds.map(([kind, price]) => [kind, plus(row.byPrice[kind], costOf(tokens[kind], reply.prices?.[price] ?? null))])) as UsageRow['byPrice'];
    const cost = storedUsd(total.costUsd);
    rows.set(model, {
      model, messages: row.messages + 1, requests: row.requests + reply.requests, input: row.input + total.input, output: row.output + total.output, reasoning: row.reasoning + total.reasoning,
      cacheRead: row.cacheRead + total.cacheRead, cacheWrite: row.cacheWrite + total.cacheWrite, openCodeUsd: cost === null ? null : plus(row.openCodeUsd, parseUsd(cost)),
      byPrice, prices: reply.prices, pricesFrom: reply.pricesFrom,
    });
  }
  return { since: usage.since ?? new Date(now).toISOString(), rows: [...rows.values()] };
}
function usageRow(value: unknown): UsageRow | null {
  const row = value as Partial<Record<keyof UsageRow, unknown>> | null;
  if (!row || typeof row !== 'object' || typeof row.model !== 'string') return null;
  const [messages, requests, input, output, reasoning, cacheRead, cacheWrite] = [row.messages, row.requests, row.input, row.output, row.reasoning, row.cacheRead, row.cacheWrite].map(number);
  if (messages === null || requests === null || input === null || output === null || reasoning === null || cacheRead === null || cacheWrite === null) return null;
  const byPrice = (row.byPrice && typeof row.byPrice === 'object' ? row.byPrice : {}) as Partial<Record<keyof UsageRow['byPrice'], unknown>>;
  return {
    model: row.model, messages, requests, input, output, reasoning, cacheRead, cacheWrite, openCodeUsd: storedUsd(row.openCodeUsd),
    byPrice: { input: storedUsd(byPrice.input), output: storedUsd(byPrice.output), cacheRead: storedUsd(byPrice.cacheRead), cacheWrite: storedUsd(byPrice.cacheWrite) },
    prices: pricesOf(row.prices), pricesFrom: sourceOf(row.pricesFrom),
  };
}
async function storedUsage(store: Pick<RelayStore, 'get'>): Promise<Usage> {
  const value = await store.get(USAGE) as { since?: unknown; rows?: unknown } | null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.rows)) return { since: null, rows: [] };
  return { since: text(value.since), rows: value.rows.map(usageRow).filter(row => row !== null) };
}
/** The totals of every reply Relay counted, by model and effort, in the order of their names. */
export function getUsage(store: Pick<RelayStore, 'get'>): Promise<Usage> {
  return serial(async () => { const usage = await storedUsage(store); return { ...usage, rows: usage.rows.sort((a, b) => a.model < b.model ? -1 : a.model > b.model ? 1 : 0) }; });
}
/** Newest first, at most 20. */
export function recentDecisions(store: Pick<RelayStore, 'get'>): Promise<Decision[]> { return serial(async () => (await stored(store)).reverse()); }

// The switch: whether every message in one chat goes through Relay. One key per chat, so turning it on or off is one write and needs no queue.
const switchKey = (sessionID: string) => `relay/on/${encodeURIComponent(sessionID)}`;
/** Only a stored `true` counts as on. */
export async function chatSwitch(store: Pick<RelayStore, 'get'>, sessionID: string): Promise<boolean> { return (await store.get(switchKey(sessionID))) === true; }
export function setChatSwitch(store: Pick<RelayStore, 'set'>, sessionID: string, on: boolean): Promise<void> { return store.set(switchKey(sessionID), on); }
