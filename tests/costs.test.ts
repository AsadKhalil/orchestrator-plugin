import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokenCost } from '../src/costs.js';

test('calculates input and billed output costs with decimal rates', () => {
  assert.equal(estimateTokenCost({ inputTokens: 10000, billedOutputTokens: 10000, inputRatePerMillion: '2', outputRatePerMillion: '10' }), '0.12');
  // Billed output already includes 9,000 reasoning tokens; they are not added a second time.
  assert.equal(estimateTokenCost({ inputTokens: 0, billedOutputTokens: 10000, inputRatePerMillion: '0', outputRatePerMillion: '10' }), '0.1');
});

test('rounds a positive sub-unit estimate upward and keeps zero exact', () => {
  assert.equal(estimateTokenCost({ inputTokens: 1, billedOutputTokens: 0, inputRatePerMillion: '0.000000000001', outputRatePerMillion: '0' }), '0.000000000001');
  assert.equal(estimateTokenCost({ inputTokens: 0, billedOutputTokens: 0, inputRatePerMillion: '2', outputRatePerMillion: '10' }), '0');
});

test('rejects invalid rates and token counts instead of silently undercounting', () => {
  for (const bad of ['-1', 'NaN', '1e-9', '0.0000000000001', '']) {
    assert.throws(() => estimateTokenCost({ inputTokens: 1, billedOutputTokens: 0, inputRatePerMillion: bad, outputRatePerMillion: '0' }));
  }
  for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
    assert.throws(() => estimateTokenCost({ inputTokens: bad, billedOutputTokens: 0, inputRatePerMillion: '1', outputRatePerMillion: '0' }));
  }
});

test('serializes competing reservations and reconciles idempotently', async () => {
  const { ReservationLedger } = await import('../src/costs.js');
  let saved: unknown;
  const store = { async get() { return saved; }, async set(value: unknown) { saved = structuredClone(value); } };
  const ledger = new ReservationLedger(store);
  const limits = { monthly: '1', feature: '1' };
  const results = await Promise.allSettled([
    ledger.reserve({ attemptID: 'a', runID: 'r', amount: '0.6' }, limits),
    ledger.reserve({ attemptID: 'b', runID: 'r', amount: '0.6' }, limits),
  ]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
  await ledger.reserve({ attemptID: 'a', runID: 'r', amount: '0.60' }, limits);
  await ledger.reconcile('a', '0.4');
  await ledger.reconcile('a', '0.40');
  await ledger.reserve({ attemptID: 'b', runID: 'r', amount: '0.6' }, limits);
  assert.equal((await ledger.snapshot()).length, 2);
  await assert.rejects(ledger.reconcile('a', '0.5'), /conflict/i);
});

test('holds unresolved requests and blocks later reservations after an overrun', async () => {
  const { ReservationLedger } = await import('../src/costs.js');
  let saved: unknown;
  const ledger = new ReservationLedger({ async get() { return saved; }, async set(v) { saved = structuredClone(v); } });
  await ledger.reserve({ attemptID: 'a', runID: 'r', amount: '0.8' }, { monthly: '1', feature: '1' });
  await assert.rejects(ledger.reserve({ attemptID: 'b', runID: 'other', amount: '0.3' }, { monthly: '1', feature: '1' }), /budget/i);
  await ledger.reconcile('a', '1.2');
  await assert.rejects(ledger.reserve({ attemptID: 'c', runID: 'r', amount: '0.01' }, { monthly: '1', feature: '2' }), /budget/i);
});

test('reports replayed attempt IDs so a caller can avoid dispatching twice', async () => {
  const { ReservationLedger } = await import('../src/costs.js');
  let saved: unknown;
  const ledger = new ReservationLedger({ async get() { return saved; }, async set(v) { saved = structuredClone(v); } });
  const request = { attemptID: 'a', runID: 'r', amount: '0.2' };
  const limits = { monthly: '1', feature: '1' };
  assert.equal(await ledger.reserve(request, limits), 'created');
  assert.equal(await ledger.reserve(request, limits), 'existing');
  await assert.rejects(ledger.reserve({ ...request, amount: '0.3' }, limits), /conflict/);
});

test('serializes different ledger instances sharing the same store', async () => {
  const { ReservationLedger } = await import('../src/costs.js');
  let saved: unknown;
  const store = { async get() { await new Promise(resolve => setTimeout(resolve, 2)); return structuredClone(saved); }, async set(value: unknown) { await new Promise(resolve => setTimeout(resolve, 2)); saved = structuredClone(value); } };
  const first = new ReservationLedger(store);
  const second = new ReservationLedger(store);
  const limits = { monthly: '1', feature: '1' };
  const results = await Promise.allSettled([
    first.reserve({ attemptID: 'a', runID: 'r1', amount: '0.6' }, limits),
    second.reserve({ attemptID: 'b', runID: 'r2', amount: '0.6' }, limits),
  ]);
  assert.deepEqual(results.map(item => item.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await first.snapshot()).length, 1);
});

test('rejects corrupt or duplicate stored reservations without overwriting them', async () => {
  const { ReservationLedger } = await import('../src/costs.js');
  const bad = [{ attemptID: 'a', runID: 'r', amount: '0.5', actual: null }, { attemptID: 'a', runID: 'r', amount: '0.2', actual: null }];
  let writes = 0;
  const ledger = new ReservationLedger({ async get() { return bad; }, async set() { writes++; } });
  await assert.rejects(ledger.reserve({ attemptID: 'new', runID: 'r', amount: '0.1' }, { monthly: '1', feature: '1' }), /Invalid reservation ledger/);
  assert.equal(writes, 0);
});

test('serializes ledger wrappers over the same backend in this runtime', async () => {
  const { ReservationLedger } = await import('../src/costs.js');
  let value: unknown;
  const wrap = () => ({ async get() { await new Promise(r => setTimeout(r, 2)); return structuredClone(value); }, async set(next: unknown) { await new Promise(r => setTimeout(r, 2)); value = structuredClone(next); } });
  const one = new ReservationLedger(wrap()), two = new ReservationLedger(wrap());
  const limits = { monthly: '1', feature: '1' };
  const results = await Promise.allSettled([one.reserve({ attemptID: 'a', runID: 'a', amount: '0.6' }, limits), two.reserve({ attemptID: 'b', runID: 'b', amount: '0.6' }, limits)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
});
