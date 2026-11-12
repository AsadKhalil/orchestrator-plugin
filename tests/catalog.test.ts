import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinQuality } from '../src/catalog.js';

const high = { variantID: 'high', effort: 'high', thinkingMode: null, thinkingBudgetTokens: null };
const low = { ...high, variantID: 'low', effort: 'low' };
const candidates = [
  { canonicalID: 'vendor/model', modelVersion: 'v1', reasoning: high },
  { canonicalID: 'vendor/model', modelVersion: 'v1', reasoning: low },
  { canonicalID: 'vendor/model', modelVersion: 'v1-q4', reasoning: high },
];
const score = { canonicalID: 'vendor/model', modelVersion: 'v1', testedReasoning: high, indexVersion: 'v5', value: 35, source: 'synthetic' };

test('joins a score only to the exact model version and tested effort', () => {
  const result = joinQuality(candidates, [score], 'v5');
  assert.equal(result[0].quality?.value, 35);
  assert.equal(result[1].quality, null);
  assert.equal(result[2].quality, null);
});

test('does not qualify unknown score, index, tested reasoning or mismatched methodology', () => {
  for (const quality of [{ ...score, value: null }, { ...score, indexVersion: null }, { ...score, testedReasoning: null }, { ...score, indexVersion: 'v4' }]) {
    assert.equal(joinQuality([candidates[0]], [quality], 'v5')[0].quality, null);
  }
});

test('does not choose between conflicting benchmark matches', () => {
  const result = joinQuality([candidates[0]], [score, { ...score, value: 36 }], 'v5');
  assert.equal(result[0].quality, null);
  assert.equal(result[0].qualityReason, 'ambiguous');
});

test('does not match malformed or non-finite source data', () => {
  for (const bad of [NaN, Infinity, -1]) assert.equal(joinQuality([candidates[0]], [{ ...score, value: bad }], 'v5')[0].quality, null);
  const malformed = { canonicalID: 'vendor/model', modelVersion: 'v1', reasoning: {} };
  assert.equal(joinQuality([malformed as unknown as typeof candidates[number]], [{ ...score, testedReasoning: {} } as never], 'v5')[0].quality, null);
});
