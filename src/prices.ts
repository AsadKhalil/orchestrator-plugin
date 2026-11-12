import { formatUsd, parseUsd } from './costs.js';

const url = 'https://openrouter.ai/api/v1/models';
const maxBytes = 4_000_000;
const day = 86_400_000;
type Price = { id: string; inputPerMillionUsd: string | null; outputPerMillionUsd: string | null; conditional: boolean; dynamicRouter: boolean; extraPriceFields: string[]; usableForBudget: false };
type Snapshot = { source: typeof url; checkedAt: string; models: Price[] };
type Cache = { get(): Promise<unknown>; set(value: { checkedAt: string; payload: unknown }): Promise<void> };
function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new Error('Invalid timestamp');
  return result;
}
function perMillion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { return formatUsd(parseUsd(value) * 1_000_000n); } catch { return null; }
}
/** Base OpenRouter catalog prices are display-only, not a bound for any provider bill. */
export function parseOpenRouterPrices(payload: unknown, checkedAt: string): Snapshot {
  timestamp(checkedAt);
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data) || !(payload as { data: unknown[] }).data.length) throw new Error('Invalid price catalog');
  const ids = new Set<string>();
  const models: Price[] = (payload as { data: unknown[] }).data.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid model');
    const model = item as { id?: unknown; pricing?: unknown };
    if (typeof model.id !== 'string' || !model.id.trim() || ids.has(model.id)) throw new Error('Invalid model identity');
    ids.add(model.id);
    const pricing = model.pricing && typeof model.pricing === 'object' && !Array.isArray(model.pricing) ? model.pricing as Record<string, unknown> : {};
    const dynamicRouter = model.id.startsWith('openrouter/');
    const conditional = 'overrides' in pricing && (!Array.isArray(pricing.overrides) || pricing.overrides.length > 0);
    return { id: model.id, inputPerMillionUsd: dynamicRouter ? null : perMillion(pricing.prompt), outputPerMillionUsd: dynamicRouter ? null : perMillion(pricing.completion), conditional, dynamicRouter,
      extraPriceFields: Object.keys(pricing).filter(k => !['prompt', 'completion', 'overrides'].includes(k)).sort(), usableForBudget: false as const };
  });
  return { source: url, checkedAt, models };
}
export async function readBounded(response: Response): Promise<unknown> {
  const header = response.headers.get('content-length');
  if (header && (!/^\d+$/.test(header) || Number(header) > maxBytes)) throw new Error('Response too large');
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error('Response too large'); } chunks.push(item.value); }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(data));
}
/** Fetches public catalog data without credentials. Stale records are labelled and never used as budget bounds. */
export async function refreshOpenRouterPrices(cache: Cache, fetcher: typeof fetch, now: string, force = false): Promise<{ status: 'fresh' | 'stale'; snapshot: Snapshot }> {
  const nowMs = timestamp(now); let cached: Snapshot | undefined;
  try { const value = await cache.get() as { checkedAt?: unknown; payload?: unknown } | undefined; if (value && typeof value.checkedAt === 'string') { const age = nowMs - timestamp(value.checkedAt); if (age >= 0 && age <= 7 * day) cached = parseOpenRouterPrices(value.payload, value.checkedAt); } } catch { /* Invalid cached data cannot establish a price. */ }
  if (cached && nowMs - timestamp(cached.checkedAt) < day && !force) return { status: 'fresh', snapshot: cached };
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await readBounded(response), snapshot = parseOpenRouterPrices(payload, now);
    await cache.set({ checkedAt: now, payload });
    return { status: 'fresh', snapshot };
  } catch {
    if (cached) return { status: 'stale', snapshot: cached };
    throw new Error('OpenRouter price catalog unavailable');
  }
}
