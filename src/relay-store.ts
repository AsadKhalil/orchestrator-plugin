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
/** One routing decision. It never holds the message text or a file name. `fit` is how sure the decider was about the "use it for" line. */
export type Decision = { at: string; sessionID: string; kind: 'chat' | 'helper'; mode: Mode | null; confidence: number | null; fit: number | null; model: string | null; ms: number; costUsd: string | null; note: string | null };
export type RelayStore = { get(key: string): Promise<unknown>; set(key: string, value: RelaySettings | Decision[] | boolean): Promise<void>; compareAndSet?(key: string, expected: unknown, value: RelaySettings | Decision[]): Promise<boolean> };

const SETTINGS = 'relay/settings', DECISIONS = 'relay/decisions', KEEP = 20;
const same = (a: ModelChoice, b: ModelChoice) => a.providerID === b.providerID && a.id === b.id && a.variant === b.variant;
export const modelName = (choice: ModelChoice) => `${choice.providerID}/${choice.id}${choice.variant === null ? '' : `#${choice.variant}`}`;

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

/** A stored record as the panel may show it, or null when it cannot be read. A field this version does not know is dropped, and a missing one reads as unknown. */
function readable(value: unknown): Decision | null {
  const item = value as Partial<Record<keyof Decision, unknown>> | null;
  if (!item || typeof item !== 'object' || typeof item.at !== 'string' || typeof item.sessionID !== 'string' || (item.kind !== 'chat' && item.kind !== 'helper') || typeof item.ms !== 'number') return null;
  const number = (field: unknown) => typeof field === 'number' && Number.isFinite(field) ? field : null, text = (field: unknown) => typeof field === 'string' ? field : null;
  return { at: item.at, sessionID: item.sessionID, kind: item.kind, mode: modes.find(mode => mode === item.mode) ?? null, confidence: number(item.confidence), fit: number(item.fit), model: text(item.model), ms: item.ms, costUsd: text(item.costUsd), note: text(item.note) };
}
const stored = async (store: Pick<RelayStore, 'get'>): Promise<Decision[]> => {
  const value = await store.get(DECISIONS);
  return Array.isArray(value) ? value.map(readable).filter(item => item !== null) : [];
};

export function recordDecision(store: RelayStore, decision: Decision): Promise<void> {
  // shortcut: one stored list. Two project folders deciding in the same instant can lose one record; give each record its own key if that ever matters.
  return serial(async () => store.set(DECISIONS, [...await stored(store), decision].slice(-KEEP)));
}
/** Newest first, at most 20. */
export function recentDecisions(store: Pick<RelayStore, 'get'>): Promise<Decision[]> { return serial(async () => (await stored(store)).reverse()); }

// The switch: whether every message in one chat goes through Relay. One key per chat, so turning it on or off is one write and needs no queue.
const switchKey = (sessionID: string) => `relay/on/${encodeURIComponent(sessionID)}`;
/** Only a stored `true` counts as on. */
export async function chatSwitch(store: Pick<RelayStore, 'get'>, sessionID: string): Promise<boolean> { return (await store.get(switchKey(sessionID))) === true; }
export function setChatSwitch(store: Pick<RelayStore, 'set'>, sessionID: string, on: boolean): Promise<void> { return store.set(switchKey(sessionID), on); }
