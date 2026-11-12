import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRates, formatReport, parseRates, officialPricePages } from '../scripts/check-prices.js';
import { parseOpenRouterPrices } from '../src/prices.js';

// Fixture catalog only; no network.
const catalog = parseOpenRouterPrices({ data: [
  { id: 'openai/same', pricing: { prompt: '0.000002', completion: '0.00001' } },
  { id: 'openai/moved', pricing: { prompt: '0.0000025', completion: '0.00001', input_cache_read: '0.000001' } },
  { id: 'anthropic/tiered', pricing: { prompt: '0.000003', completion: '0.000015', overrides: [{ min_prompt_tokens: 200000, prompt: '0.000006' }] } },
  { id: 'openrouter/auto', pricing: { prompt: '0', completion: '0' } },
] }, '2026-11-12T00:00:00.000Z');
const rate = (providerID: string, id: string, inputPerMillion: string, outputPerMillion: string) => ({ providerID, id, inputPerMillion, outputPerMillion, sourceURL: 'https://example.test/p' });

test('reports changed, missing and unchanged rates with exact signed deltas', () => {
  const rows = compareRates([
    rate('openai', 'same', '2', '10'), rate('openai', 'moved', '2', '10.5'), rate('openai', 'gone', '1', '1'),
    rate('openrouter', 'auto', '1', '1'), rate('anthropic', 'tiered', '3', '15'),
  ], catalog);
  assert.deepEqual(rows.map(r => r.status), ['unchanged', 'changed', 'missing', 'missing', 'unchanged']);
  assert.deepEqual(rows[1].input, { proposed: '2', catalog: '2.5', delta: '+0.5' });
  assert.deepEqual(rows[1].output, { proposed: '10.5', catalog: '10', delta: '-0.5' });
  assert.match(rows[1].note ?? '', /input_cache_read/);
  assert.equal(rows[2].input.delta, null);
  assert.match(rows[3].note ?? '', /router/);
  assert.match(rows[4].note ?? '', /conditional/);
});

test('rate files are validated as exact decimal strings and cannot contain duplicates', () => {
  assert.throws(() => parseRates([]), /non-empty/);
  assert.throws(() => parseRates([{ ...rate('a', 'b', '1', '1'), inputPerMillion: 1 }]), /inputPerMillion/);
  assert.throws(() => parseRates([rate('a', 'b', '1e3', '1')]), /decimal/);
  assert.throws(() => parseRates([rate('a', 'b', '1', '1'), rate('a', 'b', '2', '2')]), /duplicate/);
  assert.equal(parseRates([rate('a', 'b', '0.000000000001', '1')])[0].inputPerMillion, '0.000000000001');
});

test('the report states that nothing is written and lists the official pages to verify by hand', () => {
  const report = formatReport(compareRates([rate('openai', 'moved', '2', '10')], catalog), 'fixture');
  assert.match(report, /Nothing was written/);
  for (const [, url] of officialPricePages) assert.ok(report.includes(url));
  assert.equal(officialPricePages.length, 4);
});
