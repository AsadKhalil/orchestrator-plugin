import type { ModelCostView } from './inventory.js';
import type { Decision, Prices, Reply, UsageRow } from './relay-store.js';
import { modeLabel } from './router.js';
import { MAX_CHARS, MAX_FILE_NAMES } from './decider.js';
import { costOf, formatUsd, parseUsd } from './costs.js';
import type { ModelChoice } from './settings.js';

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

/** A price in the model table, whose column header says it is per 1M tokens, input / output. */
export function priceCell(cost: Pick<ModelCostView, 'inputPerMillion' | 'outputPerMillion' | 'tiered'>): string {
  const { inputPerMillion: input, outputPerMillion: output } = cost;
  if (input === null && output === null) return 'not listed';
  if (input === '0' && output === '0') return '$0 or not listed';
  return `${usd(input)} / ${usd(output)}${cost.tiered ? ' (base tier)' : ''}`;
}

/** A context window the way people say it: 8K, 200K, 1M. Zero means the catalog does not list it, shown as a dash (the cell says why). */
export function contextLabel(tokens: number): string {
  if (!(tokens > 0)) return '—';
  if (tokens < 1000) return String(tokens);
  const thousands = Math.round(tokens / 1000);
  return thousands < 1000 ? `${thousands}K` : `${+(tokens / 1_000_000).toFixed(1)}M`;
}

/** An intelligence index as the table shows it: one decimal at most, and a dash when no index was found for the model. */
export const indexLabel = (index: number | null | undefined) => index === null || index === undefined ? '—' : String(Math.round(index * 10) / 10);

type TableModel = { providerID: string; id: string; name: string; cost: Pick<ModelCostView, 'inputPerMillion' | 'outputPerMillion'>; limit: { context: number }; index?: number | null };
export type TableOrder = 'provider' | 'price' | 'context' | 'index';
const orders: Record<TableOrder, (a: TableModel, b: TableModel) => number> = {
  provider: (a, b) => a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name),
  price: cheapestFirst,
  context: (a, b) => b.limit.context - a.limit.context || a.name.localeCompare(b.name),
  index: (a, b) => (b.index ?? -1) - (a.index ?? -1) || a.name.localeCompare(b.name),
};
/** The rows of the "Add a model" table: models with every typed word in their provider, id or name, of one provider when one is chosen, in the order chosen. */
export function modelRows<M extends TableModel>(models: readonly M[], view: { query: string; provider: string; order: TableOrder }): M[] {
  const words = view.query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(model => (!view.provider || model.providerID === view.provider) && words.every(word => `${model.providerID} ${model.id} ${model.name}`.toLowerCase().includes(word))).sort(orders[view.order]);
}

/** What "Add" puts in a mode's list for this model: the default effort when it is not in the list yet, else the first effort that is not; undefined when every one is. */
export function nextEffort(chosen: readonly ModelChoice[], model: { providerID: string; id: string; variants: readonly string[] }): string | null | undefined {
  return [null, ...model.variants].find(variant => !chosen.some(choice => choice.providerID === model.providerID && choice.id === model.id && choice.variant === variant));
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
const amount = (tokens: number) => Math.round(tokens).toLocaleString('en-US');
/** A cost of 0 can mean "not listed", so it is left out, like a cost that was not reported. */
const cost = (usd: string | null) => usd === null || usd === '0' ? [] : [`$${usd}`];
/** $0 for both input and output can mean "not listed", as with no price at all. A price that is not listed is left out. */
const priced = (prices: Prices) => (prices.inputPerMillion ?? '0') === '0' && (prices.outputPerMillion ?? '0') === '0' ? ' Price: $0 or not listed.'
  : ` Prices for a million tokens: ${([[prices.inputPerMillion, 'in'], [prices.outputPerMillion, 'out'], [prices.cacheReadPerMillion, 'cache read'], [prices.cacheWritePerMillion, 'cache write']] as const).flatMap(([usd, what]) => usd === null ? [] : [`$${usd} ${what}`]).join(', ')}.`;
/** What the reply took, once it is known: the whole reply and the model that gave it, that model's prices, then the reply's first request. */
const took = (reply: Reply | null | undefined) => {
  if (!reply) return '';
  const { total, requests } = reply;
  const whole = total === null ? ` Requests in the reply: ${requests}.` : ` Reply${reply.model === null ? '' : ` from ${reply.model}`}: ${[
    `${requests} request${requests === 1 ? '' : 's'}`, `${amount(total.input)} tokens in`, `${amount(total.output)} out`, ...(total.reasoning > 0 ? [`${amount(total.reasoning)} reasoning`] : []),
    `${amount(total.cacheRead)} read from cache`, `${amount(total.cacheWrite)} written to cache`, ...cost(total.costUsd),
  ].join(', ')}.`;
  return `${whole}${reply.prices === null ? '' : priced(reply.prices)} First request: ${[
    `${amount(reply.fresh)} tokens read new`, `${amount(reply.cached)} from cache`, ...cost(reply.costUsd), ...(reply.seconds === null ? [] : [`first word after ${reply.seconds} s`]),
  ].join(', ')}.`;
};
/** One row of Recent choices. The time is left out: the panel shows it in the viewer's own clock. */
export const recentLine = (decision: Shown & Pick<Decision, 'kind'> & { reply?: Reply | null }) => `${noted(`${decision.kind === 'helper' ? 'Helper' : 'Chat'}: ${outcome(decision)}`, decision.note)}${took(decision.reply)}`;

const kinds = [['input', 'in', 'inputPerMillion'], ['output', 'out', 'outputPerMillion'], ['cacheRead', 'cache read', 'cacheReadPerMillion'], ['cacheWrite', 'cache write', 'cacheWritePerMillion']] as const;
/**
 * One row of Usage by model: the model and its effort, the counts, the cost by price (marked * when Artificial Analysis gave the prices), and
 * how each kind of token was priced. Output is priced with its reasoning. OpenCode's own cost is added when it is more than $0.
 */
export function usageCells(row: UsageRow) {
  const hash = row.model.lastIndexOf('#'), costs = kinds.flatMap(([kind]) => { const usd = row.byPrice[kind]; return usd === null ? [] : [parseUsd(usd)]; });
  const byPrice = !costs.length ? [] : kinds.flatMap(([kind, label, price]) => {
    const tokens = kind === 'output' ? `${amount(row.output)}${row.reasoning > 0 ? ` + ${amount(row.reasoning)} reasoning` : ''}` : amount(row[kind]);
    const usd = row.byPrice[kind], per = row.prices?.[price] ?? null, count = kind === 'output' ? row.output + row.reasoning : row[kind];
    if (usd !== null && per !== null && costOf(count, per) === parseUsd(usd)) return [`${label} ${tokens} x $${per} a million = $${usd}`];
    if (usd !== null) return [`${label} ${tokens}: $${usd} by each reply's own price${per === null ? '' : ` (the last was $${per} a million)`}`];
    return count > 0 ? [`${label} ${tokens}: no price listed`] : [];
  });
  return {
    model: hash < 0 ? row.model : row.model.slice(0, hash), effort: hash < 0 ? '-' : row.model.slice(hash + 1), requests: amount(row.requests), input: amount(row.input), output: amount(row.output),
    cacheRead: amount(row.cacheRead), cacheWrite: amount(row.cacheWrite), cost: costs.length ? `$${formatUsd(costs.reduce((sum, usd) => sum + usd, 0n))}${row.pricesFrom === 'artificial-analysis' ? '*' : ''}` : 'not listed',
    byPrice: [...byPrice, ...(row.openCodeUsd !== null && row.openCodeUsd !== '0' ? [`OpenCode's own cost: $${row.openCodeUsd}`] : [])],
  };
}
/** What `/relay-stats` shows: a table of every model and effort, how each one's cost was worked out, and the credit Artificial Analysis asks for. */
export function usageText(view: { since: string | null; rows: readonly UsageRow[]; credit: string | null }): string {
  if (!view.rows.length) return 'No reply counted yet. Relay counts every message it places: /relay, or any message in a chat with Relay on.';
  const cells = view.rows.map(usageCells);
  const table = [['model', 'effort', 'requests', 'in', 'out', 'cache read', 'cache write', 'cost'], ...cells.map(cell => [cell.model, cell.effort, cell.requests, cell.input, cell.output, cell.cacheRead, cell.cacheWrite, cell.cost])];
  const widths = table[0].map((_, column) => Math.max(...table.map(line => line[column].length)));
  const lines = table.map(line => line.map((cell, column) => column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])).join('  ').trimEnd());
  const blocks = view.rows.flatMap((row, at) => cells[at].byPrice.length ? [`${row.model}, cost by price:`, ...cells[at].byPrice.map(line => `  ${line}`)] : []);
  const footer = [...(view.rows.some(row => row.pricesFrom === 'artificial-analysis') ? ['* at Artificial Analysis prices, all or in part'] : []), ...(view.credit ? [view.credit] : [])];
  const since = view.since ? `, since ${view.since.slice(0, 10)} ${view.since.slice(11, 16)} UTC` : '';
  return [`Relay: usage by model${since}`, '', ...lines, ...(blocks.length ? ['', ...blocks] : []), ...(footer.length ? ['', ...footer] : [])].join('\n');
}

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
