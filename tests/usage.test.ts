import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsage } from '../src/usage.js';

const base = { attemptID: 'a', revision: 1, startedAt: '2026-01-31T20:00:00.000Z', grossUsd: '0.2', creditUsd: '0.05', cashUsd: '0.15', provenance: 'estimated' as const, providerID: 'p', modelID: 'm', effort: 'high', role: 'coder', projectID: 'project' };

test('buckets request starts by reporting timezone and aggregates costs', () => {
  const result = aggregateUsage([base, { ...base, attemptID: 'b', startedAt: '2026-02-01T20:00:00.000Z', grossUsd: null, creditUsd: null, cashUsd: null }], '2026-02', 'Asia/Karachi');
  assert.equal(result.days[0].date, '2026-02-01');
  assert.equal(result.days[1].date, '2026-02-02');
  assert.equal(result.total.gross.knownUsd, '0.2');
  assert.equal(result.total.gross.unknownCount, 1);
  assert.equal(result.total.cash.knownUsd, '0.15');
  assert.equal(result.total.cash.unknownCount, 1);
});

test('deduplicates repeated events and applies late correction to the original day', () => {
  const revised = { ...base, revision: 2, grossUsd: '0.3', cashUsd: '0.25', provenance: 'provider_reported' as const };
  const result = aggregateUsage([base, base, revised], '2026-02', 'Asia/Karachi');
  assert.equal(result.total.attempts, 1);
  assert.equal(result.days[0].date, '2026-02-01');
  assert.equal(result.total.gross.knownUsd, '0.3');
  assert.equal(result.total.providerReported, 1);
});

test('rejects conflicting replays, identity changes and invalid reporting data', () => {
  assert.throws(() => aggregateUsage([base, { ...base, grossUsd: '0.8' }], '2026-02', 'UTC'), /conflict/i);
  assert.throws(() => aggregateUsage([base, { ...base, revision: 2, startedAt: '2026-02-03T00:00:00.000Z' }], '2026-02', 'UTC'), /identity/i);
  assert.throws(() => aggregateUsage([base], '2026-13', 'UTC'));
  assert.throws(() => aggregateUsage([base], '2026-02', 'Not/AZone'));
});

test('detects a conflicting old revision even after a newer correction', () => {
  const revised = { ...base, revision: 2, grossUsd: '0.3' };
  assert.throws(() => aggregateUsage([base, revised, { ...base, grossUsd: '0.8' }], '2026-02', 'UTC'), /conflict/i);
});

test('uses the actual timezone across daylight-saving transitions', () => {
  const before = { ...base, attemptID: 'x', startedAt: '2026-03-08T07:59:00.000Z' };
  const after = { ...base, attemptID: 'y', startedAt: '2026-03-09T05:01:00.000Z' };
  const result = aggregateUsage([before, after], '2026-03', 'America/New_York');
  assert.deepEqual(result.days.map(day => day.date), ['2026-03-08', '2026-03-09']);
  assert.equal(result.total.gross.knownUsd, '0.4');
});
