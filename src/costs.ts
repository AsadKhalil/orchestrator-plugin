import type { ModelCostView, PriceStep } from './inventory.js';

const SCALE = 1_000_000_000_000n;

/** The prices of a request that reads `tokens`: the largest step below that size, else the base price, as the host prices a request (2.3.0). */
export function pricesAt(cost: ModelCostView, tokens: number): Omit<PriceStep, 'above'> {
  const { inputPerMillion, outputPerMillion, cacheReadPerMillion, cacheWritePerMillion } = [...cost.steps].reverse().find(step => tokens > step.above) ?? cost;
  return { inputPerMillion, outputPerMillion, cacheReadPerMillion, cacheWritePerMillion };
}

/** A price as the host reports it (a number of USD) becomes a USD string. Anything that is not a plain amount, or is too small to show in six decimals, is unknown. */
export function usdString(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1e21) return null;
  const text = value.toFixed(6).replace(/\.?0+$/, '');
  return text === '0' && value !== 0 ? null : text;
}

/** A USD string as a whole number of trillionths of a dollar, so that prices compare exactly. Money is never a float. */
export function parseUsd(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value)) throw new Error('Invalid USD amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
}
export function formatUsd(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}
/** An amount for a sentence: rounded to the cent, and "under $0.01" when that leaves nothing. */
export function aboutUsd(value: bigint): string {
  const cents = (value + SCALE / 200n) / (SCALE / 100n);
  return cents === 0n ? 'under $0.01' : `about $${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
