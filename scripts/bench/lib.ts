// The proof test's arithmetic and its table (docs/superpowers/specs/2026-11-18-relay-proof-design.md). Money is whole trillionths of a dollar.
import { parseUsd } from '../../src/costs.js';

export type Side = 'off' | 'on-one' | 'on-two' | 'cheap';
export const SIDES: readonly Side[] = ['off', 'on-one', 'on-two', 'cheap'];
const LABELS: Record<Side, string> = { off: 'Off', 'on-one': 'On, one model a mode', 'on-two': 'On, two for Execute', cheap: 'Cheap only' };

/** A request's tokens as OpenCode keeps them on an assistant entry of `session.context`. */
export type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
type PriceSet = { inputPerMillion: string | null; outputPerMillion: string | null; cacheReadPerMillion: string | null; cacheWritePerMillion: string | null };
/** A model's prices as Relay's `listModels` gives them: USD for a million tokens, and the prices for chats over a size. */
export type Cost = PriceSet & { steps: (PriceSet & { above: number })[] };

/** What one request cost at the list price, in trillionths of a dollar. Output is billed with its reasoning. */
export function requestCost(tokens: Tokens, cost: Cost): bigint {
  const prompt = tokens.input + tokens.cache.read + tokens.cache.write;
  const at = [...cost.steps].reverse().find(step => prompt > step.above) ?? cost;
  const usd = (price: string | null) => (price === null ? null : parseUsd(price));
  const input = usd(at.inputPerMillion) ?? 0n;
  const sum = BigInt(tokens.input) * input + BigInt(tokens.cache.read) * (usd(at.cacheReadPerMillion) ?? input)
    + BigInt(tokens.cache.write) * (usd(at.cacheWritePerMillion) ?? input) + BigInt(tokens.output + tokens.reasoning) * (usd(at.outputPerMillion) ?? 0n);
  return sum / 1_000_000n;
}

/** `part` of `whole` in percent, to one decimal, rounded half up. */
const percent = (part: bigint, whole: bigint) => { const tenths = (part * 2000n + whole) / (2n * whole); return `${tenths / 10n}.${tenths % 10n}`; };

export const MONTH = 1_000_000_000_000n;   // a month's whole allowance, so a share of it is in trillionths

/** The share of OpenCode Go's monthly allowance that `cost` (list price) uses on a model whose monthly limit is `monthlyUsd`. Go's docs: "$1.50 of usage on a model with a $15 limit uses 10% of your monthly allowance". */
export function monthShare(cost: bigint, monthlyUsd: string): bigint {
  return (cost * MONTH) / parseUsd(monthlyUsd);
}
/** A share of the month in percent of the month, of the 5-hour limit (20% of the month) and of the weekly limit (50%). */
export const shares = (month: bigint) => ({ month: percent(month, MONTH), fiveHour: percent(month * 5n, MONTH), week: percent(month * 2n, MONTH) });
export function limitShare(cost: bigint, monthlyUsd: string): { month: string; fiveHour: string; week: string } {
  return shares(monthShare(cost, monthlyUsd));
}

/** One chat: its cost at list price, and its share of the month summed request by request, each at its own model's monthly limit. */
export type ChatResult = { task: string; side: Side; passed: boolean; cost: bigint; month: bigint };
export type SideTotal = { passed: number; tasks: number; cost: bigint; month: bigint };

/** Each side's tasks passed, tasks run, cost and share of the month, in the order of SIDES. */
export function sideTotals(chats: ChatResult[]): Map<Side, SideTotal> {
  const totals = new Map<Side, SideTotal>();
  for (const side of SIDES) {
    const mine = chats.filter(chat => chat.side === side);
    const sum = (pick: (chat: ChatResult) => bigint) => mine.reduce((total, chat) => total + pick(chat), 0n);
    if (mine.length > 0) totals.set(side, { passed: mine.filter(chat => chat.passed).length, tasks: mine.length, cost: sum(chat => chat.cost), month: sum(chat => chat.month) });
  }
  return totals;
}

/** Dollars to four decimals, rounded half up. */
const dollars = (cost: bigint) => { const units = (cost + 50_000_000n) / 100_000_000n; return `$${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`; };

/** The result table in Markdown: one column for each side that ran. */
export function table(totals: Map<Side, SideTotal>): string {
  const sides = [...totals.keys()], off = totals.get('off');
  const row = (name: string, cell: (side: Side) => string) => `| ${name} | ${sides.map(cell).join(' | ')} |`;
  const saved = (side: Side) => {
    const cost = totals.get(side)!.cost;
    if (side === 'off' || !off || off.cost === 0n) return '-';
    return off.cost >= cost ? `${percent(off.cost - cost, off.cost)}%` : `-${percent(cost - off.cost, off.cost)}%`;
  };
  return [
    `| | ${sides.map(side => LABELS[side]).join(' | ')} |`,
    `|---|${sides.map(() => '---:').join('|')}|`,
    row('Tasks passed', side => `${totals.get(side)!.passed} of ${totals.get(side)!.tasks}`),
    row('Cost at list price', side => dollars(totals.get(side)!.cost)),
    row('5-hour limit used', side => `${shares(totals.get(side)!.month).fiveHour}%`),
    row('Weekly limit used', side => `${shares(totals.get(side)!.month).week}%`),
    row('Saved, against Off', saved),
  ].join('\n');
}
