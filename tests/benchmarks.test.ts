import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeScores, noPermission } from '../src/benchmarks.js';
import type { Quality } from '../src/catalog.js';

const score = (source: string): Quality => ({ canonicalID: 'c', modelVersion: '1', testedReasoning: null, indexVersion: 'v1', value: 70, source });

test('user-entered scores are always allowed', () => {
  const scores = [score('user_entered')];
  assert.deepEqual(authorizeScores(scores), { ok: true, scores });
});

test('Artificial Analysis scores are refused without recorded written permission, however the source is spelled', () => {
  for (const source of ['artificial-analysis', 'Artificial Analysis index v4', 'artificial_analysis', 'ARTIFICIAL ANALYSIS']) {
    assert.deepEqual(authorizeScores([score('user_entered'), score(source)]), { ok: false, reason: 'benchmark_source_not_authorized' }, source);
  }
  assert.equal(authorizeScores([score('Artificial Analysis')], noPermission).ok, false);
});

test('recorded permission allows them', () => {
  assert.equal(authorizeScores([score('Artificial Analysis')], { artificialAnalysis: true }).ok, true);
});
