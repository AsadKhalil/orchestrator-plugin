import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CasReservationLedger } from '../src/cas-ledger.js';

function store() {
  let value: unknown;
  return { async get() { return structuredClone(value); }, async compareAndSet(_key: string, expected: unknown, next: unknown) { if (JSON.stringify(value) !== JSON.stringify(expected)) return false; value = structuredClone(next); return true; } };
}

test('competing reservations share durable limits and cannot overspend', async () => {
  const storage = store(), first = new CasReservationLedger(storage), second = new CasReservationLedger(storage);
  await first.setLimit('monthly', undefined, '1', 0); await first.setLimit('feature', 'a', '1', 0); await first.setLimit('feature', 'b', '1', 0);
  const outcomes = await Promise.allSettled([first.reserve({attemptID:'a',runID:'a',amount:'0.8'}), second.reserve({attemptID:'b',runID:'b',amount:'0.8'})]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  assert.equal((await first.snapshot()).reservations.length, 1);
  await assert.rejects(second.setLimit('monthly', undefined, '2', 0), /stale/i);
});

test('carries pending reservations across months until final evidence is supplied', async () => {
  let now = Date.parse('2026-01-31T23:59:59.999Z');
  const ledger = new CasReservationLedger(store(), () => now);
  await ledger.setLimit('monthly', undefined, '1', 0); await ledger.setLimit('feature', 'one', '1', 0); await ledger.setLimit('feature', 'two', '1', 0);
  const request = { attemptID:'a', runID:'one', amount:'0.8' };
  assert.equal(await ledger.reserve(request), 'created'); now = Date.parse('2026-02-01T00:00:00Z');
  assert.equal(await ledger.reserve(request), 'existing');
  const pending = await ledger.report('one');
  assert.equal(pending.period, '2026-02');
  assert.deepEqual(pending.monthlyUsage, { committedUsd:'0.8', pendingUsd:'0.8', pendingCount:1, remainingUsd:'0.2', overLimitUsd:'0' });
  assert.deepEqual(pending.featureUsage, pending.monthlyUsage);
  await assert.rejects(ledger.reserve({attemptID:'b',runID:'two',amount:'0.3'}), /budget/i);
  assert.throws(() => ledger.reconcile('a','0',undefined as never), /evidence/i);
  await ledger.reconcile('a','0.8',{kind:'provider_gross_charge',reference:'synthetic'});
  assert.equal((await ledger.report('one')).monthlyUsage.committedUsd, '0');
  assert.equal((await ledger.report('one')).featureUsage?.committedUsd, '0.8');
  assert.equal(await ledger.reserve({attemptID:'b',runID:'two',amount:'0.3'}), 'created');
  await assert.rejects(ledger.reconcile('a','0.7',{kind:'provider_gross_charge',reference:'synthetic'}), /conflict/i);
});

test('reports missing limits and amounts over a subsequently lowered cap', async () => {
  const ledger = new CasReservationLedger(store());
  assert.equal((await ledger.report(null)).monthlyUsage.remainingUsd, null);
  await ledger.setLimit('monthly', undefined, '1', 0); await ledger.setLimit('feature', 'r', '1', 0);
  await ledger.reserve({ attemptID:'a',runID:'r',amount:'0.8' }); await ledger.setLimit('monthly', undefined, '0.5', 1);
  const report = await ledger.report('r');
  assert.equal(report.monthlyUsage.remainingUsd, '0'); assert.equal(report.monthlyUsage.overLimitUsd, '0.3');
  assert.equal(report.featureUsage?.remainingUsd, '0.2');
});

test('requires atomic host storage and safely handles special run IDs', async () => {
  assert.throws(() => new CasReservationLedger({} as never), /atomic/i);
  const ledger = new CasReservationLedger(store());
  await ledger.setLimit('monthly', undefined, '1', 0); await ledger.setLimit('feature', '__proto__', '1', 0);
  assert.equal(await ledger.reserve({attemptID:'a',runID:'__proto__',amount:'1'}), 'created');
});
