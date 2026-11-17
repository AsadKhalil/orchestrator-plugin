import type { ModelCostView } from './inventory.js';
import type { Decision } from './relay-store.js';
import { modeLabel } from './router.js';
import { MAX_CHARS, MAX_FILE_NAMES } from './decider.js';
import { parseUsd } from './costs.js';

// What the Modes tab says in words. Pure, so it runs under node:test; the panel bundles it, so nothing here may import from `node:`.

const usd = (value: string | null) => value === null ? 'not listed' : `$${value}`;
/** A listed price of 0 can mean free or not known, so it is never called free. */
export function priceLabel(cost: Pick<ModelCostView, 'inputPerMillion' | 'outputPerMillion' | 'tiered'>): string {
  const { inputPerMillion: input, outputPerMillion: output } = cost;
  if (input === null && output === null) return 'price not listed';
  if (input === '0' && output === '0') return '$0 or not listed';
  return `${usd(input)} in / ${usd(output)} out per 1M tokens${cost.tiered ? ' (base tier)' : ''}`;
}

const exact = (value: string | null): bigint | null => { if (value === null) return null; try { return parseUsd(value); } catch { return null; } };
const known = (a: bigint | null, b: bigint | null) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
/** For the "Add a model" menu: the input price, then the output price, compared exactly; a price not listed sorts last. "$0 or not listed" counts as $0. */
export function cheapestFirst(a: { name: string; cost: Pick<ModelCostView, 'inputPerMillion' | 'outputPerMillion'> }, b: { name: string; cost: Pick<ModelCostView, 'inputPerMillion' | 'outputPerMillion'> }): number {
  return known(exact(a.cost.inputPerMillion), exact(b.cost.inputPerMillion)) || known(exact(a.cost.outputPerMillion), exact(b.cost.outputPerMillion)) || a.name.localeCompare(b.name);
}

type Shown = Pick<Decision, 'mode' | 'model' | 'confidence' | 'fit' | 'ms' | 'note'>;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const facts = (item: Shown & { mode: NonNullable<Shown['mode']> }, model: string) =>
  [modeLabel(item.mode), model, ...(item.confidence === null ? [] : [`${percent(item.confidence)} sure`]), ...(item.fit === null ? [] : [`line fit ${percent(item.fit)}`]), `${Math.round(item.ms)} ms`].join(', ');
const noted = (text: string, note: string | null) => `${text}${note === null ? '' : ` (${note})`}.`;

/** What one decision did. A chat or helper that stayed on its own model is said to be left alone. */
const outcome = (decision: Shown & Pick<Decision, 'kind'>) => {
  const { mode, model } = decision;
  return mode !== null && model !== null ? facts({ ...decision, mode }, model) : decision.kind === 'helper' ? 'left as it was' : 'nothing switched';
};
/** The newest decision as one line, with the reason when nothing was switched. */
export function decisionLine(decision: (Shown & Pick<Decision, 'kind'>) | undefined): string {
  if (!decision) return 'No /relay message yet.';
  return noted(`Last choice${decision.kind === 'helper' ? ' (a helper)' : ''}: ${outcome(decision)}`, decision.note);
}
/** One row of Recent choices. The time is left out: the panel shows it in the viewer's own clock. */
export const recentLine = (decision: Shown & Pick<Decision, 'kind'>) => noted(`${decision.kind === 'helper' ? 'Helper' : 'Chat'}: ${outcome(decision)}`, decision.note);

/** What the test box shows for one try: what Relay would do with the sample message. */
export function tryLine(result: Shown & Pick<Decision, 'costUsd'>): string {
  const { mode } = result;
  if (mode === null) return noted('No answer', result.note);
  return noted(`${facts({ ...result, mode }, result.model ?? 'no model')}, cost ${result.costUsd === null ? 'not reported' : `$${result.costUsd}`}`, result.note);
}

/** What leaves the machine to make a choice, and to whom. It names everything `describe` in `decider.ts` puts in a request, with that file's own limits. */
export const privacyNote = (providerID: string | null) =>
  `To choose, Relay sends to ${providerID ?? "the decider's provider"}: your message text (at most ${MAX_CHARS.toLocaleString('en-US')} characters), the names and sizes of attached files (the first ${MAX_FILE_NAMES}), how many pictures are attached, whether the chat's agent can change files, and the lines you wrote above. Never the contents of files, pictures or earlier messages. While a decider and a Review model are chosen, the task text of each helper that a model starts is sent the same way — written by the calling model, so it may itself quote code, files or earlier chat, and the person does not see it before it goes out.`;

/**
 * The model to put in Desktop's model picker after Relay switched a chat. Desktop sends the picker's model with every message (seen on
 * 2.3.0, 17 Nov), so a picker left on the old model would undo the switch on the next one. Null for a helper's record and when nothing was switched.
 */
// shortcut: the record keeps the model as "provider/id#variant", so an id that itself holds a "#" and has no variant is cut at that "#".
export function pickerModel(decision: Pick<Decision, 'kind' | 'model'>): { providerID: string; modelID: string; variant?: string } | null {
  if (decision.kind !== 'chat' || decision.model === null) return null;
  const slash = decision.model.indexOf('/'); if (slash <= 0) return null;
  const rest = decision.model.slice(slash + 1), hash = rest.lastIndexOf('#');
  const modelID = hash < 0 ? rest : rest.slice(0, hash), variant = hash < 0 ? undefined : rest.slice(hash + 1);
  if (!modelID || variant === '') return null;
  return { providerID: decision.model.slice(0, slash), modelID, ...(variant === undefined ? {} : { variant }) };
}

export const noDeciderNote = "No decider chosen. Until you choose one below, /relay and Relay on send every message to the chat's current model without switching.";

type PillRow = { id: 'toggle' | 'decider' | 'last'; label: string; tone?: 'warning' };
/**
 * The pill above a chat box: whether every message in that chat goes through Relay, the row that turns it, and the chat's last choice.
 * With no decider chosen Relay switches nothing, so the pill says so; switched on, its capsule says it too, with a warning icon.
 */
export function pillView(state: { on: boolean; last: (Shown & Pick<Decision, 'kind'>) | null; decider: boolean }): { label: string; icon?: 'circle-exclamation'; tone: 'success' | 'warning' | undefined; rows: PillRow[] } {
  const { on, last, decider } = state, unswitched = last !== null && last.model === null, warn = on && !decider;
  return {
    label: on ? (decider ? 'Relay on' : 'Relay on · no decider') : 'Relay off',
    ...(warn ? { icon: 'circle-exclamation' as const } : {}),
    tone: warn ? 'warning' : on ? 'success' : undefined,
    rows: [
      { id: 'toggle', label: on ? 'Turn Relay off for this chat' : 'Turn Relay on for this chat' },
      ...(decider ? [] : [{ id: 'decider' as const, label: 'No decider chosen, so Relay switches nothing. Open Relay to choose one.', tone: 'warning' as const }]),
      { id: 'last', label: last === null ? 'No choice in this chat yet.' : decisionLine(last), ...(unswitched ? { tone: 'warning' as const } : {}) },
    ],
  };
}

export const switchHint = 'To send every message in one chat through Relay, type /relay on in that chat or use the Relay pill above its chat box; /relay off turns it off. In the terminal app, /relay on and /relay off work the same way, without the pill.';

export const checksLine = (checks: { active: boolean; note: string | null }) =>
  checks.active ? 'Helpers that check work start on a Review model.' : `Helpers that check work keep the chat's model: ${checks.note ?? 'not set up'}.`;
