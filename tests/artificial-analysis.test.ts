import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AA_LIST_URL, aaFor, fetchAaModels, getPriceKey, loadAaModels, parseAaPage, setPriceKey, storedAaModels } from '../src/artificial-analysis.js';

// Made-up models shaped like Artificial Analysis's free model list (fields as its key returned them on 19 Nov 2026; no copied data).
const listed = (slug: string, name: string, creator = 'Z AI', released = '2026-08-01', extra: object = {}) => ({
  id: `id-${slug}`, name, slug, release_date: released, model_creator: { id: 'c', name: creator },
  evaluations: { artificial_analysis_intelligence_index: 30, artificial_analysis_coding_index: null },
  pricing: { price_1m_input_tokens: 1.5, price_1m_output_tokens: 4.5, price_1m_cache_hit_tokens: 0.25, price_1m_cache_write_tokens: null },
  performance: { median_output_tokens_per_second: 80 }, performance_v3: { mean_output_tokens_per_second: 60 }, ...extra,
});
const page = (data: unknown[], more: boolean) => ({ tier: 'free', intelligence_index_version: 5, pagination: { page: 1, page_size: 200, total_pages: 2, has_more: more }, data });
const KEY = 'aa_test_key_0123456789';
function store() {
  const map = new Map<string, unknown>();
  return { map, async get(key: string) { return structuredClone(map.get(key)); }, async set(key: string, value: unknown) { map.set(key, structuredClone(value)); }, async remove(key: string) { map.delete(key); } };
}
const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

test('a page becomes models with prices as USD strings and the index', () => {
  const { models, more } = parseAaPage(page([listed('glm-5-3', 'GLM-5.3 (Max)'), null, { name: 'no slug' }], true));
  assert.deepEqual(models, [{ slug: 'glm-5-3', name: 'GLM-5.3 (Max)', creator: 'Z AI', released: '2026-08-01', index: 30, prices: { inputPerMillion: '1.5', outputPerMillion: '4.5', cacheReadPerMillion: '0.25', cacheWritePerMillion: null } }]);
  assert.equal(more, true);
  assert.deepEqual(parseAaPage({ data: 'odd' }), { models: [], more: false });
  assert.equal(parseAaPage(page([listed('x', 'X', 'Z AI', '2026-08-01', { evaluations: {} })], false)).models[0].index, null, 'a model with no index');
});

test('every page is fetched with the key, and only from Artificial Analysis', async () => {
  const asked: { url: string; key: string | null }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    asked.push({ url, key: new Headers(init.headers).get('x-api-key') });
    return answer(200, url.endsWith('page=1') ? page([listed('a-1', 'A 1')], true) : page([listed('b-1', 'B 1')], false));
  }) as unknown as typeof fetch;
  const models = await fetchAaModels(KEY, fetcher);
  assert.deepEqual(models.map(model => model.slug), ['a-1', 'b-1']);
  assert.deepEqual(asked, [{ url: `${AA_LIST_URL}?page=1`, key: KEY }, { url: `${AA_LIST_URL}?page=2`, key: KEY }]);
  assert.equal(AA_LIST_URL, 'https://artificialanalysis.ai/api/v2/language/models/free');
});

test('a refused key or a used-up day keeps the stored copy and says why, without the key', async () => {
  const day = 24 * 3600_000, now = Date.parse('2026-11-19T12:00:00Z');
  for (const [status, why] of [[401, 'the key was refused'], [429, "today's 100 requests are used up"], [500, 'Artificial Analysis answered 500']] as const) {
    const db = store();
    db.map.set('relay/aa-models', { fetchedAt: new Date(now - day - 1).toISOString(), models: parseAaPage(page([listed('old-1', 'Old 1')], false)).models });
    const loaded = await loadAaModels(db, KEY, (async () => answer(status, { error: `bad key ${KEY}` })) as unknown as typeof fetch, now);
    assert.deepEqual(loaded.models.map(model => model.slug), ['old-1'], `${status}: the stored copy`);
    assert.match(loaded.note ?? '', new RegExp(why.replace(/[()]/g, '\\$&')), `${status}: the reason`);
    assert.equal(JSON.stringify(loaded).includes(KEY), false, `${status}: the key is in no note`);
  }
  const none = await loadAaModels(store(), KEY, (async () => answer(401)) as unknown as typeof fetch, now);
  assert.deepEqual([none.models, none.fetchedAt, none.note], [[], null, 'could not load the list from Artificial Analysis: the key was refused']);
  let fetched = 0;
  const fresh = store();
  fresh.map.set('relay/aa-models', { fetchedAt: new Date(now - day + 60_000).toISOString(), models: parseAaPage(page([listed('new-1', 'New 1')], false)).models });
  const kept = await loadAaModels(fresh, KEY, (async () => { fetched++; return answer(500); }) as unknown as typeof fetch, now);
  assert.deepEqual([kept.models.map(model => model.slug), kept.note, fetched], [['new-1'], null, 0], 'a copy under a day old is used without asking again');
  const saved = store();
  await loadAaModels(saved, KEY, (async () => answer(200, page([listed('n-1', 'N 1')], false))) as unknown as typeof fetch, now);
  assert.deepEqual((await storedAaModels(saved)).map(model => model.slug), ['n-1'], 'a fresh list is stored for the idle hook, which never fetches');
  assert.deepEqual(await storedAaModels({ async get() { return 'garbage'; } }), []);
});

test('matching: by slug or name, the effort first, and the newest Claude for the subscription login', () => {
  const { models } = parseAaPage(page([
    listed('glm-5-3', 'GLM-5.3 (Max)'), listed('mimo-v2-5-pro', 'MiMo V2.5 Pro'),
    listed('claude-sonnet-5-5', 'Claude Sonnet 5.5 (Max)', 'Anthropic', '2026-09-28'), listed('claude-sonnet-5-5-high', 'Claude Sonnet 5.5 (High)', 'Anthropic', '2026-09-28'),
    listed('claude-sonnet-5', 'Claude Sonnet 5 (Max)', 'Anthropic', '2026-06-01'), listed('claude-sonnet-5-high', 'Claude Sonnet 5 (High)', 'Anthropic', '2026-06-01'),
    listed('dup', 'Dup One'), listed('dup-two', 'Dup'),
  ], false));
  const slug = (providerID: string, id: string, variant: string | null = null, name = id) => aaFor({ providerID, id, name, variant }, models)?.slug ?? null;
  assert.equal(slug('opencode-go', 'glm-5.3'), 'glm-5-3');
  assert.equal(slug('opencode-go', 'mimo-v2.5', null, 'MiMo V2.5'), null, 'a near name is not a match');
  assert.equal(slug('claude-agent', 'sonnet', 'high'), 'claude-sonnet-5-5-high');
  assert.equal(slug('claude-agent', 'sonnet'), 'claude-sonnet-5-5', 'no effort: the base entry');
  assert.equal(slug('claude-agent', 'sonnet', 'low'), 'claude-sonnet-5-5', 'an effort it does not list: the base entry, whose prices are the same');
  assert.equal(slug('claude-agent', 'opus'), null, 'no Opus in this list');
  assert.equal(slug('anthropic', 'claude-sonnet-5-5', 'high'), 'claude-sonnet-5-5-high');
  assert.equal(slug('p', 'dup'), null, 'a key two models share matches nothing');
});

test('the key is kept, refused when it cannot be one, and removed with the stored list', async () => {
  const db = store();
  assert.equal(await getPriceKey(db), null);
  await setPriceKey(db, `  ${KEY} `);
  assert.equal(await getPriceKey(db), KEY);
  for (const odd of ['  ', 'has a space', 'x'.repeat(201), 'short']) await assert.rejects(setPriceKey(db, odd), (error: Error) => /does not look like/.test(error.message) && !error.message.includes(odd.trim() || '\u0000'));
  db.map.set('relay/aa-models', { fetchedAt: '2026-11-19T00:00:00.000Z', models: [] });
  await setPriceKey(db, null);
  assert.deepEqual([await getPriceKey(db), [...db.map.keys()]], [null, []], 'the key and the stored list are gone');
  assert.equal(await getPriceKey({ async get() { return 7; } }), null);
});
