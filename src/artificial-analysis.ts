import { readBounded } from './prices.js';
const endpoint = 'https://artificialanalysis.ai/api/v2/language/models/free';
type Entry = { id: string; slug: string; name: string; creator: string; score: number | null };
/** User-keyed, display-only observations. Model identity and tested effort are not established here. */
export async function fetchIntelligence(apiKey: string | undefined, fetcher: typeof fetch = fetch) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Artificial Analysis API key is unavailable');
  const entries: Entry[] = [], seen = new Set<string>(); let version: number | undefined;
  for (let page = 1; page <= 10; page++) {
    const response = await fetcher(`${endpoint}?page=${page}`, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Artificial Analysis request failed');
    const body = await readBounded(response) as { intelligence_index_version?: unknown; pagination?: { page?: unknown; has_more?: unknown }; data?: unknown };
    if (!body || typeof body !== 'object' || typeof body.intelligence_index_version !== 'number' || !Number.isFinite(body.intelligence_index_version) || body.intelligence_index_version < 0 || !body.pagination || body.pagination.page !== page || typeof body.pagination.has_more !== 'boolean' || !Array.isArray(body.data) || body.data.length > 1000) throw new Error('Invalid Artificial Analysis response');
    if (version !== undefined && version !== body.intelligence_index_version) throw new Error('Artificial Analysis index version changed between pages');
    version = body.intelligence_index_version;
    for (const raw of body.data) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Artificial Analysis model');
      const item = raw as { id?: unknown; slug?: unknown; name?: unknown; model_creator?: { name?: unknown }; evaluations?: { artificial_analysis_intelligence_index?: unknown } };
      if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 300 || seen.has(item.id) || typeof item.slug !== 'string' || !item.slug.trim() || item.slug.length > 300 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 || typeof item.model_creator?.name !== 'string' || !item.model_creator.name.trim() || item.model_creator.name.length > 300) throw new Error('Invalid Artificial Analysis identity');
      const score = item.evaluations?.artificial_analysis_intelligence_index;
      if (!(score === null || typeof score === 'number' && Number.isFinite(score) && score >= 0)) throw new Error('Invalid Artificial Analysis score');
      seen.add(item.id); entries.push({ id: item.id, slug: item.slug, name: item.name, creator: item.model_creator.name, score });
    }
    if (!body.pagination.has_more) return { source: 'Artificial Analysis' as const, indexVersion: version, entries };
  }
  throw new Error('Artificial Analysis catalog exceeds page limit');
}
