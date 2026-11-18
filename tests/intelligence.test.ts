import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchIndexTable, indexFor, indexTable, modelKey } from '../src/intelligence.js';

const entry = (id: string, index: number | null, extra: Record<string, unknown> = {}) => ({ id, canonical_slug: id, name: id, benchmarks: { artificial_analysis: { intelligence_index: index } }, ...extra });
const body = { data: [
  entry('anthropic/claude-sonnet-5.5', 54.5), entry('anthropic/claude-sonnet-5.5:batch', 54.5), entry('anthropic/claude-haiku-5.5', 36.5),
  entry('z-ai/glm-5.3', 61), entry('moonshotai/kimi-k3.1-pro', 58.2), entry('openai/gpt-oss-20b', 33.4), entry('openai/gpt-oss-20b:free', 33.4),
  entry('vendor-a/twin-1', 40), entry('vendor-b/twin-1', 45), entry('vendor-x/alpha-lite-2', 20), entry('vendor-y/beta-lite-2', 25), entry('vendor/no-index', null), { id: 'vendor/no-benchmarks', name: 'x' },
] };

test('a model key drops the vendor, the case, the variant suffix and the punctuation', () => {
  assert.equal(modelKey('anthropic/claude-sonnet-5.5:batch'), 'claude-sonnet-5-5');
  assert.equal(modelKey('GLM-5.3'), 'glm-5-3');
  assert.equal(modelKey('gpt-oss:20b'), 'gpt-oss-20b');
  assert.equal(modelKey('Kimi K3.1 Pro'), 'kimi-k3-1-pro');
  assert.equal(modelKey('deepseek-v4.1-flash-free'), 'deepseek-v4-1-flash');
  assert.equal(modelKey('openai/gpt-oss-20b:free'), 'gpt-oss-20b');
});

test('the table keeps each model with an index once, and drops a key two different models share', () => {
  const table = indexTable(body);
  assert.deepEqual(table.get('claude-sonnet-5-5'), { id: 'anthropic/claude-sonnet-5.5', index: 54.5 }, 'the :batch twin is the same model');
  assert.deepEqual(table.get('gpt-oss-20b'), { id: 'openai/gpt-oss-20b', index: 33.4 });
  assert.equal(table.has('twin-1'), false, 'two vendors, two scores: no guess');
  assert.equal(table.has('no-index'), false);
  assert.equal(table.has('no-benchmarks'), false);
  assert.equal(indexTable({ nope: true }).size, 0);
  assert.equal(indexTable(null).size, 0);
});

test('a model is matched by its id, then its name, then by the one listed model whose id ends in it', () => {
  const table = indexTable(body);
  assert.deepEqual(indexFor({ id: 'glm-5.3', name: 'GLM-5.3' }, table), { index: 61, matched: 'z-ai/glm-5.3' });
  assert.deepEqual(indexFor({ id: 'gpt-oss:20b', name: 'gpt-oss:20b' }, table), { index: 33.4, matched: 'openai/gpt-oss-20b' });
  assert.deepEqual(indexFor({ id: 'opaque-1', name: 'Kimi K3.1 Pro' }, table), { index: 58.2, matched: 'moonshotai/kimi-k3.1-pro' });
  assert.deepEqual(indexFor({ id: 'sonnet', name: 'Sonnet 5.5' }, table), { index: 54.5, matched: 'anthropic/claude-sonnet-5.5' }, "OpenCode's claude-agent names its models like this");
  assert.equal(indexFor({ id: 'twin-1', name: 'Twin 1' }, table), null, 'ambiguous: no guess');
  assert.equal(indexFor({ id: '5.5', name: '5.5' }, table), null, 'too short to match by its end');
  assert.equal(indexFor({ id: 'pro', name: 'Pro' }, table), null, 'too short, even when only one listed model ends in it');
  assert.equal(indexFor({ id: 'lite-2', name: 'Lite 2' }, table), null, 'two listed models end in it: no guess');
  assert.equal(indexFor({ id: 'x1', name: 'Claude Sonnet' }, table), null, 'a name without its version is not any one version');
  assert.equal(indexFor({ id: 'unknown-model', name: 'Unknown' }, table), null);
});

test('the list is fetched once, refused when it is not a model list, too big, or late, and never with anything about the person', async () => {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (reply: () => Response) => (async (url: string, init?: RequestInit) => { asked.push({ url, init }); return reply(); }) as typeof fetch;
  const table = await fetchIndexTable(fetcher(() => new Response(JSON.stringify(body))));
  assert.equal(table.get('glm-5-3')?.index, 61);
  assert.deepEqual([asked[0]!.url, asked[0]!.init?.method ?? 'GET', asked[0]!.init?.headers], ['https://openrouter.ai/api/v1/models', 'GET', { accept: 'application/json' }]);
  await assert.rejects(fetchIndexTable(fetcher(() => new Response('nope', { status: 503 }))), /answered 503/);
  await assert.rejects(fetchIndexTable(fetcher(() => new Response('not json'))), /not a model list/);
  await assert.rejects(fetchIndexTable(fetcher(() => new Response(JSON.stringify({ data: 'x' })))), /not a model list/);
  await assert.rejects(fetchIndexTable(fetcher(() => new Response('x'.repeat(8_000_001)))), /too big/);
  await assert.rejects(fetchIndexTable(fetcher(() => new Response(JSON.stringify({ data: [entry('vendor/no-index', null)] })))), /carries no index/);
  const late = (async (_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
  await assert.rejects(fetchIndexTable(late, 50), /aborted/);
});
