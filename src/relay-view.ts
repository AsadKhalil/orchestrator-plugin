import type { ModelCostView } from './inventory.js';
import type { Decision } from './relay-store.js';
import { modeLabel } from './router.js';
import { MAX_CHARS, MAX_FILE_NAMES } from './decider.js';

// What the Modes tab says in words. Pure, so it runs under node:test; the panel bundles it, so nothing here may import from `node:`.

const usd = (value: string | null) => value === null ? 'not listed' : `$${value}`;
/** A listed price of 0 can mean free or not known, so it is never called free. */
export function priceLabel(cost: Pick<ModelCostView, 'inputPerMillion' | 'outputPerMillion' | 'tiered'>): string {
  const { inputPerMillion: input, outputPerMillion: output } = cost;
  if (input === null && output === null) return 'price not listed';
  if (input === '0' && output === '0') return '$0 or not listed';
  return `${usd(input)} in / ${usd(output)} out per 1M tokens${cost.tiered ? ' (base tier)' : ''}`;
}

type Shown = Pick<Decision, 'mode' | 'model' | 'confidence' | 'fit' | 'ms' | 'note'>;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const facts = (item: Shown & { mode: NonNullable<Shown['mode']> }, model: string) =>
  [modeLabel(item.mode), model, ...(item.confidence === null ? [] : [`${percent(item.confidence)} sure`]), ...(item.fit === null ? [] : [`line fit ${percent(item.fit)}`]), `${Math.round(item.ms)} ms`].join(', ');
const noted = (text: string, note: string | null) => `${text}${note === null ? '' : ` (${note})`}.`;

/** The newest decision as one line. A chat or helper that stayed on its own model is said to be left alone, with the reason. */
export function decisionLine(decision: (Shown & Pick<Decision, 'kind'>) | undefined): string {
  if (!decision) return 'No /relay message yet.';
  const helper = decision.kind === 'helper', { mode, model } = decision;
  return noted(`Last choice${helper ? ' (a helper)' : ''}: ${mode !== null && model !== null ? facts({ ...decision, mode }, model) : helper ? 'left as it was' : 'nothing switched'}`, decision.note);
}

/** What the test box shows for one try: what Relay would do with the sample message. */
export function tryLine(result: Shown & Pick<Decision, 'costUsd'>): string {
  const { mode } = result;
  if (mode === null) return noted('No answer', result.note);
  return noted(`${facts({ ...result, mode }, result.model ?? 'no model')}, cost ${result.costUsd === null ? 'not reported' : `$${result.costUsd}`}`, result.note);
}

/** What leaves the machine to make a choice, and to whom. It names everything `describe` in `decider.ts` puts in a request, with that file's own limits. */
export const privacyNote = (providerID: string | null) =>
  `To choose, Relay sends to ${providerID ?? "the decider's provider"}: your message text (at most ${MAX_CHARS.toLocaleString('en-US')} characters), the names and sizes of attached files (the first ${MAX_FILE_NAMES}), how many pictures are attached, the name of the chat's agent, and the lines you wrote above. Never the contents of files, pictures or earlier messages. While a decider and a Review model are chosen, the task text of each helper that a model starts is sent the same way — written by the calling model, so it may itself quote code, files or earlier chat, and the person does not see it before it goes out.`;

export const checksLine = (checks: { active: boolean; note: string | null }) =>
  checks.active ? 'Helpers that check work start on a Review model.' : `Helpers that check work keep the chat's model: ${checks.note ?? 'not set up'}.`;
