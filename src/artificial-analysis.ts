import { usdString } from './costs.js';
import { modelKey } from './intelligence.js';
import type { Prices } from './relay-store.js';

// Artificial Analysis's free model list: each model's prices and intelligence index, with a key the owner saves in the panel. The key is sent
// only to this address, in `x-api-key`, and never shown, returned, recorded or written into a note. Read with the owner's test key on 19 Nov
// 2026: 763 models in four pages of 200, one entry for each effort (`claude-sonnet-5-5` is Max, `claude-sonnet-5-5-high` is High).

export const AA_LIST_URL = 'https://artificialanalysis.ai/api/v2/language/models/free';
export const AA_SOURCE = 'Artificial Analysis Intelligence Index, from Artificial Analysis';
/** Artificial Analysis asks for this credit wherever its data is shown. */
export const AA_CREDIT = 'Prices and index: Artificial Analysis (artificialanalysis.ai)';
const MAX_PAGES = 5, MAX_CHARS = 8_000_000, DAY_MS = 24 * 3600_000;
const LIST_KEY = 'relay/aa-models', PRICE_KEY = 'relay/aa-key';

export type AaModel = { slug: string; name: string; creator: string; released: string | null; index: number | null; prices: Prices };
type Store = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; remove(key: string): Promise<void> };

const price = (value: unknown) => typeof value === 'number' ? usdString(value) : null;
const text = (value: unknown) => typeof value === 'string' ? value : null;
/** One page of the list: its models, and whether another page follows. An entry with no slug or name is left out. */
export function parseAaPage(body: unknown): { models: AaModel[]; more: boolean } {
  const page = body as { data?: unknown; pagination?: { has_more?: unknown } } | null;
  const data: unknown[] = Array.isArray(page?.data) ? page.data : [];
  const models = data.flatMap(item => {
    const model = item as { slug?: unknown; name?: unknown; model_creator?: { name?: unknown }; release_date?: unknown; evaluations?: { artificial_analysis_intelligence_index?: unknown }; pricing?: Record<string, unknown> } | null;
    if (!model || typeof model.slug !== 'string' || typeof model.name !== 'string') return [];
    const index = model.evaluations?.artificial_analysis_intelligence_index, pricing = model.pricing ?? {};
    return [{
      slug: model.slug, name: model.name, creator: text(model.model_creator?.name) ?? '', released: text(model.release_date), index: typeof index === 'number' && Number.isFinite(index) ? index : null,
      prices: { inputPerMillion: price(pricing.price_1m_input_tokens), outputPerMillion: price(pricing.price_1m_output_tokens), cacheReadPerMillion: price(pricing.price_1m_cache_hit_tokens), cacheWritePerMillion: price(pricing.price_1m_cache_write_tokens) },
    }];
  });
  return { models, more: page?.pagination?.has_more === true };
}

const refusals: Record<number, string> = { 401: 'the key was refused', 403: 'the key may not read this list', 429: "today's 100 requests are used up" };
/** Every page of the list (five at most). An error names what went wrong, never the key. */
export async function fetchAaModels(key: string, fetcher: typeof fetch = fetch, ms = 15_000): Promise<AaModel[]> {
  const models: AaModel[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetcher(`${AA_LIST_URL}?page=${page}`, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
    if (!response.ok) throw new Error(refusals[response.status] ?? `Artificial Analysis answered ${response.status}`);
    const body = await response.text();
    if (body.length > MAX_CHARS) throw new Error('the list is too big');
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new Error('the reply is not a model list'); }
    const found = parseAaPage(parsed);
    models.push(...found.models);
    if (!found.more) break;
  }
  if (!models.length) throw new Error('the list has no models');
  return models;
}

const storedModel = (value: unknown): AaModel | null => {
  const model = value as Partial<Record<keyof AaModel, unknown>> | null, prices = model?.prices as Partial<Record<keyof Prices, unknown>> | null | undefined;
  if (!model || typeof model.slug !== 'string' || typeof model.name !== 'string' || !prices || typeof prices !== 'object') return null;
  return {
    slug: model.slug, name: model.name, creator: text(model.creator) ?? '', released: text(model.released), index: typeof model.index === 'number' && Number.isFinite(model.index) ? model.index : null,
    prices: { inputPerMillion: text(prices.inputPerMillion), outputPerMillion: text(prices.outputPerMillion), cacheReadPerMillion: text(prices.cacheReadPerMillion), cacheWritePerMillion: text(prices.cacheWritePerMillion) },
  };
};
async function stored(store: Pick<Store, 'get'>): Promise<{ fetchedAt: string; models: AaModel[] } | null> {
  const value = await store.get(LIST_KEY) as { fetchedAt?: unknown; models?: unknown } | null;
  if (!value || typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt)) || !Array.isArray(value.models)) return null;
  return { fetchedAt: value.fetchedAt, models: value.models.map(storedModel).filter(model => model !== null) };
}
/** The stored list, with no request: what the idle hook reads. */
export async function storedAaModels(store: Pick<Store, 'get'>): Promise<AaModel[]> {
  try { return (await stored(store))?.models ?? []; } catch { return []; }
}
/** The list: the stored copy while it is under a day old, else a fresh fetch, stored; when that fails, the older copy with a note. */
export async function loadAaModels(store: Pick<Store, 'get' | 'set'>, key: string, fetcher: typeof fetch, now: number): Promise<{ models: AaModel[]; fetchedAt: string | null; note: string | null }> {
  let saved: Awaited<ReturnType<typeof stored>> = null;
  try { saved = await stored(store); } catch { /* read as no copy */ }
  if (saved && now - Date.parse(saved.fetchedAt) < DAY_MS) return { ...saved, note: null };
  try {
    const models = await fetchAaModels(key, fetcher), fetchedAt = new Date(now).toISOString();
    try { await store.set(LIST_KEY, { fetchedAt, models }); } catch { /* shown anyway, fetched again next time */ }
    return { models, fetchedAt, note: null };
  } catch (error) {
    const reason = error instanceof Error && !error.message.includes(key) ? error.message : 'the request failed';
    return saved ? { ...saved, note: `could not refresh the list from Artificial Analysis: ${reason}` } : { models: [], fetchedAt: null, note: `could not load the list from Artificial Analysis: ${reason}` };
  }
}

// The subscription login's models are named by family only; Claude Code picks the version, so the newest in the list stands for it.
const FAMILIES = new Set(['sonnet', 'haiku', 'opus', 'fable']);
/**
 * The listed model that is `model` at its effort: an exact match of the id or name, as `modelKey` writes them, with the effort first and then
 * without it. A key that two different models share matches nothing.
 */
export function aaFor(model: { providerID: string; id: string; name: string; variant: string | null }, models: readonly AaModel[]): AaModel | null {
  const table = new Map<string, AaModel | null>();
  for (const listed of models) for (const name of [listed.slug, listed.name]) {
    const key = modelKey(name), found = table.get(key);
    if (key && found !== null) table.set(key, found && found.slug !== listed.slug ? null : listed);
  }
  let ids = [model.id, model.name];
  if (model.providerID === 'claude-agent' && FAMILIES.has(model.id)) {
    const base = new RegExp(`^claude-${model.id}-[\\d-]+$`);
    const newest = models.filter(listed => listed.creator === 'Anthropic' && base.test(listed.slug)).sort((a, b) => (b.released ?? '').localeCompare(a.released ?? '') || a.slug.length - b.slug.length)[0];
    if (!newest) return null;
    ids = [newest.slug];
  }
  const keys = [...(model.variant ? ids.map(id => modelKey(`${id}-${model.variant}`)) : []), ...ids.map(modelKey)];
  for (const key of keys) { const found = table.get(key); if (found) return found; }
  return null;
}

const KEY_SHAPE = /^\S{8,200}$/;
/** The saved key, or null. */
export async function getPriceKey(store: Pick<Store, 'get'>): Promise<string | null> {
  const value = await store.get(PRICE_KEY);
  return typeof value === 'string' && KEY_SHAPE.test(value) ? value : null;
}
/** Saves the key, or with null removes it and the list fetched with it. The refusal never repeats what was typed. */
export async function setPriceKey(store: Store, key: string | null): Promise<void> {
  if (key === null) { await store.remove(PRICE_KEY); await store.remove(LIST_KEY); return; }
  const trimmed = key.trim();
  if (!KEY_SHAPE.test(trimmed)) throw new Error('That does not look like an Artificial Analysis key: it should be one word of 8 to 200 characters.');
  await store.set(PRICE_KEY, trimmed);
}
