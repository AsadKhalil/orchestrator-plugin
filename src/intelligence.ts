// The intelligence index beside each model: Artificial Analysis's number, as OpenRouter's public model list carries it. No key is needed and
// nothing about the person is sent: one plain GET of the public list. OpenCode's model records share no id with that list, so a model is
// matched by its id, its API id or its name, after both sides are put in one form; a key two different models would share matches nothing.

export const INDEX_SOURCE = 'Artificial Analysis Intelligence Index, from OpenRouter\'s public model list';
const LIST_URL = 'https://openrouter.ai/api/v1/models';
const MAX_CHARS = 8_000_000;
/** OpenRouter lists some models again under a suffix (":batch", ":free" …), and OpenCode marks free copies with "-free"; they are the same model. */
const VARIANT = /(:(batch|free|extended|thinking|beta|nitro|floor|exacto)|-free)$/;

export type IndexTable = Map<string, { id: string; index: number }>;

/** One form for a model's id or name: no vendor, lower case, no variant suffix, and dashes for dots, colons, underscores and spaces. */
export function modelKey(text: string): string {
  return (text.toLowerCase().split('/').pop() ?? '').trim().replace(VARIANT, '').replace(/[._:\s]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The models in OpenRouter's reply that carry an index, by key. A key that two different models would share is left out. */
export function indexTable(reply: unknown): IndexTable {
  const table: IndexTable = new Map(), clash = new Set<string>();
  const data = (reply as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return table;
  for (const item of data as { id?: unknown; canonical_slug?: unknown; benchmarks?: { artificial_analysis?: { intelligence_index?: unknown } } }[]) {
    const index = item?.benchmarks?.artificial_analysis?.intelligence_index;
    if (typeof item?.id !== 'string' || typeof index !== 'number' || !Number.isFinite(index)) continue;
    const id = item.id.replace(VARIANT, '');
    for (const name of [item.id, item.canonical_slug]) {
      if (typeof name !== 'string') continue;
      const key = modelKey(name), found = table.get(key);
      if (!key || clash.has(key)) continue;
      if (found && found.id !== id) { table.delete(key); clash.add(key); continue; }
      table.set(key, { id, index });
    }
  }
  return table;
}

/** A model's index: by its id or its name, then by the one listed model whose key ends in its key. Null when none fits clearly. */
export function indexFor(model: { id: string; name: string }, table: IndexTable): { index: number; matched: string } | null {
  const keys = [model.id, model.name].map(modelKey).filter(Boolean);
  for (const key of keys) { const found = table.get(key); if (found) return { index: found.index, matched: found.id }; }
  for (const key of keys) {
    if (key.length < 5) continue;
    const ends = new Map<string, number>();
    for (const [listed, found] of table) if (listed.endsWith(`-${key}`)) ends.set(found.id, found.index);
    if (ends.size === 1) { const [[matched, index]] = [...ends]; return { index: index!, matched: matched! }; }
  }
  return null;
}

/** Fetches OpenRouter's public model list (one GET, no key, nothing about the person) and keeps the models that carry an index. */
export async function fetchIndexTable(fetcher: typeof fetch = fetch, ms = 15_000): Promise<IndexTable> {
  const response = await fetcher(LIST_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CHARS) throw new Error('the model list is too big');
  let reply: unknown;
  try { reply = JSON.parse(text); } catch { throw new Error('the reply is not a model list'); }
  if (!Array.isArray((reply as { data?: unknown } | null)?.data)) throw new Error('the reply is not a model list');
  const table = indexTable(reply);
  // A list with no index at all is more likely a change on OpenRouter's side than a fact, so it never replaces a stored copy.
  if (!table.size) throw new Error('the list carries no index');
  return table;
}

const CACHE_KEY = 'relay/intelligence', DAY_MS = 24 * 3600_000;
type Cache = { fetchedAt: string; rows: [string, string, number][] };
type CacheStore = { get(key: string): Promise<unknown>; set(key: string, value: Cache): Promise<void> };
const decodeCache = (value: unknown): Cache | null => {
  const cache = value as Cache | null;
  return cache && typeof cache.fetchedAt === 'string' && Number.isFinite(Date.parse(cache.fetchedAt)) && Array.isArray(cache.rows)
    && cache.rows.every(row => Array.isArray(row) && row.length === 3 && typeof row[0] === 'string' && typeof row[1] === 'string' && typeof row[2] === 'number') ? cache : null;
};
const fromRows = (rows: Cache['rows']): IndexTable => new Map(rows.map(([key, id, index]) => [key, { id, index }]));

/** The index table: the stored copy while it is under a day old, else a fresh fetch, stored; when that fails, the older copy with a note. */
export async function loadIndexTable(store: CacheStore, fetcher: typeof fetch, now: number): Promise<{ table: IndexTable; fetchedAt: string | null; note: string | null }> {
  let saved: Cache | null = null;
  try { saved = decodeCache(await store.get(CACHE_KEY)); } catch { /* read as no copy */ }
  if (saved && now - Date.parse(saved.fetchedAt) < DAY_MS) return { table: fromRows(saved.rows), fetchedAt: saved.fetchedAt, note: null };
  try {
    const table = await fetchIndexTable(fetcher), fetchedAt = new Date(now).toISOString();
    try { await store.set(CACHE_KEY, { fetchedAt, rows: [...table].map(([key, found]): [string, string, number] => [key, found.id, found.index]) }); } catch { /* shown anyway, fetched again next time */ }
    return { table, fetchedAt, note: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return saved ? { table: fromRows(saved.rows), fetchedAt: saved.fetchedAt, note: `could not refresh the index: ${reason}` } : { table: new Map(), fetchedAt: null, note: `could not load the index: ${reason}` };
  }
}
