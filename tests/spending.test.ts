import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicReservationLedger } from '../src/atomic-ledger.js';
import { createRetryGuard, createSpendGuard, requestCeiling, SpendDenied, type GuardDeps } from '../src/spending.js';
import type { Route } from '../src/settings.js';
import type { RateCard } from '../src/types.js';

const evidence = { sourceURL: 'https://example.com/pricing', checkedAt: '2026-11-12T00:00:00Z', kind: 'user_entered' as const, verified: false };
const rate = (over: Partial<RateCard> = {}): RateCard => ({ inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: null, cacheWritePerMillion: null, billing: 'metered_api', serviceTier: 'standard', interactive: true, conditions: [], evidence, ...over });
const route = (over: Partial<Route> = {}): Route => ({ providerID: 'p', id: 'm', variant: null, vendor: 'v', canonicalID: 'c', modelVersion: '1', rate: rate(), ...over });
const model = { providerID: 'p', id: 'm' };
const limit = { context: 200_000, output: 32_000 };

test('the ceiling is context at the input rate plus the full model output limit at the output rate', () => {
  // 200000 × $3/M = $0.60 and 32000 × $15/M = $0.48; the user allowance (8192) is not enforced anywhere, so it must not lower the reservation
  assert.deepEqual(requestCeiling(rate(), limit, 8192), { amount: '1.08', inputTokens: 200_000, outputTokens: 32_000 });
  assert.equal(requestCeiling(rate(), limit, 1).amount, '1.08', 'the allowance never lowers the worst case');
  assert.equal(requestCeiling(rate(), { context: 1000, output: 100 }, 8192).outputTokens, 100, 'model output limit wins when smaller');
  assert.equal(requestCeiling(rate({ inputPerMillion: '0', outputPerMillion: '0' }), limit, 8192).amount, '0');
});

test('a dearer cache-write rate raises the input bound and the result rounds up', () => {
  assert.equal(requestCeiling(rate({ cacheWritePerMillion: '3.75' }), limit, 8192).amount, '1.23');
  assert.equal(requestCeiling(rate({ cacheWritePerMillion: '1' }), limit, 8192).amount, '1.08', 'a cheaper cache write never lowers the bound');
  assert.equal(requestCeiling(rate({ inputPerMillion: '0.000001', outputPerMillion: '0' }), { context: 1, output: 1 }, 1).amount, '0.000000000001');
});

test('routes that a dollar budget cannot bound are refused rather than priced', () => {
  for (const bad of [rate({ billing: 'subscription' }), rate({ billing: 'local' }), rate({ conditions: ['over 200k tokens costs double'] })]) assert.throws(() => requestCeiling(bad, limit, 8192), (e: SpendDenied) => e instanceof SpendDenied && /billing_unbounded|rate_conditions/.test(e.code));
  assert.throws(() => requestCeiling(rate(), { context: 0, output: 10 }, 8192), (e: SpendDenied) => e.code === 'limit_unknown');
  assert.throws(() => requestCeiling(rate(), limit, 0), (e: SpendDenied) => e.code === 'limit_unknown');
});

function setup(options: { feature?: string; monthly?: string; configure?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fp-spend-')), ledger = new AtomicReservationLedger(join(dir, 'ledger.sqlite'));
  if (options.configure !== false) { ledger.setLimit('monthly', undefined, options.monthly ?? '100', 0); ledger.setLimit('feature', 'run-1', options.feature ?? '1.5', 0); }
  let n = 0;
  const deps: GuardDeps = {
    roleFor: async id => id === 'ses_owned' ? 'coder' : id === 'ses_odd' ? 'unknown' : null,
    runFor: async id => id === 'ses_owned' ? 'run-1' : null,
    routes: async () => ({ maxOutputTokens: 8192, routes: [route()] }),
    limitFor: async () => limit,
    selected: async () => true,
    ledger: () => ledger,
    newID: () => String(++n),
  };
  return { ledger, deps, guard: createSpendGuard(deps), done: () => { ledger.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const ask = (guard: ReturnType<typeof createSpendGuard>, sessionID = 'ses_owned', m: { providerID: string; id: string; variant?: string | null } = model) => guard({ sessionID, kind: 'primary', model: m });
const code = (expected: string) => (e: unknown) => e instanceof SpendDenied && e.code === expected;

test('an owned request reserves its ceiling and the ledger holds exactly that', async () => {
  const s = setup();
  try {
    await ask(s.guard);
    const rows = s.ledger.snapshot();
    assert.equal(rows.length, 1); assert.equal(rows[0].amount, '1.08'); assert.equal(rows[0].runID, 'run-1'); assert.equal(rows[0].actual, null);
    assert.equal(rows[0].attemptID, 'ses_owned:1');
  } finally { s.done(); }
});

test('sessions the plugin does not own are never touched or reserved', async () => {
  const s = setup();
  try { await ask(s.guard, 'ses_someone_else'); assert.equal(s.ledger.snapshot().length, 0); } finally { s.done(); }
});

test('the feature budget caps total worst-case spend and later requests are refused before dispatch', async () => {
  const s = setup({ feature: '2.5' });
  try {
    await ask(s.guard); await ask(s.guard);
    await assert.rejects(ask(s.guard), code('budget_exceeded'));
    assert.equal(s.ledger.snapshot().length, 2, 'the refused request reserved nothing');
  } finally { s.done(); }
});

test('the monthly budget also caps spend', async () => {
  const s = setup({ monthly: '1.5', feature: '50' });
  try { await ask(s.guard); await assert.rejects(ask(s.guard), code('budget_exceeded')); } finally { s.done(); }
});

test('concurrent requests cannot jointly exceed the budget', async () => {
  const s = setup({ feature: '2.5' });
  try {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => ask(s.guard)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    assert.equal(s.ledger.snapshot().length, 2);
  } finally { s.done(); }
});

test('missing limits, rates, selection, roles, runs or a ledger all fail closed without reserving', async () => {
  const s = setup();
  try {
    const guardWith = (over: Partial<GuardDeps>) => createSpendGuard({ ...s.deps, ...over });
    await assert.rejects(ask(guardWith({ ledger: () => null })), code('ledger_unavailable'));
    await assert.rejects(ask(guardWith({ routes: async () => ({ maxOutputTokens: 8192, routes: [] }) })), code('rate_unknown'));
    await assert.rejects(ask(s.guard, 'ses_owned', { ...model, variant: 'high' }), code('rate_unknown'), 'a different variant is a different route');
    await assert.rejects(ask(guardWith({ limitFor: async () => null })), code('limit_unknown'));
    await assert.rejects(ask(guardWith({ selected: async () => false })), code('model_not_selected'));
    await assert.rejects(ask(s.guard, 'ses_odd'), code('unknown_role'));
    await assert.rejects(s.guard({ sessionID: 'ses_owned', kind: 'primary' } as never), code('invalid_request'));
    await assert.rejects(ask(guardWith({ runFor: async () => null })), code('unknown_run'));
    await assert.rejects(ask(guardWith({ routes: async () => ({ maxOutputTokens: 8192, routes: [route({ rate: rate({ billing: 'subscription' }) })] }) })), code('billing_unbounded'));
    assert.equal(s.ledger.snapshot().length, 0);
  } finally { s.done(); }
});

test('unset budgets and ledger failures refuse the request', async () => {
  const unset = setup({ configure: false });
  try { await assert.rejects(ask(unset.guard), code('budget_unset')); } finally { unset.done(); }
  const s = setup();
  try { await assert.rejects(ask(createSpendGuard({ ...s.deps, ledger: () => ({ reserve: () => { throw new Error('disk on fire'); } }) })), code('ledger_error')); } finally { s.done(); }
});

test('auxiliary requests (title, compaction, generate) reserve like primary ones', async () => {
  const s = setup({ feature: '10' });
  try {
    for (const kind of ['title', 'compaction', 'generate'] as const) await s.guard({ sessionID: 'ses_owned', kind, model });
    assert.equal(s.ledger.snapshot().length, 3);
  } finally { s.done(); }
});

test('retries are capped for owned sessions and can only become stricter', async () => {
  const roleFor: GuardDeps['roleFor'] = async id => id === 'ses_owned' ? 'coder' : null;
  const guard = createRetryGuard(roleFor, 2);
  const make = (sessionID: string, attempt: number, retry = true) => ({ sessionID, attempt, decision: retry ? { retry: true, delay: 1 } : { retry: false } as { retry: boolean } });
  const first = make('ses_owned', 1); await guard(first); assert.equal(first.decision.retry, true);
  const third = make('ses_owned', 2); await guard(third); assert.equal(third.decision.retry, false);
  const bad = make('ses_owned', Number.NaN); await guard(bad); assert.equal(bad.decision.retry, false);
  const foreign = make('ses_other', 99); await guard(foreign); assert.equal(foreign.decision.retry, true, 'other sessions keep host behaviour');
  const already = make('ses_owned', 0, false); await guard(already); assert.equal(already.decision.retry, false);
});

import { CasReservationLedger } from '../src/cas-ledger.js';
import { budgetOpen } from '../src/spending.js';

test('budgetOpen needs a ledger, both limits and something left in each', async () => {
  const data = new Map<string, unknown>();
  const store = { async get(k: string) { return structuredClone(data.get(k)); }, async compareAndSet(k: string, expected: unknown, next: unknown) { if (JSON.stringify(data.get(k)) !== JSON.stringify(expected)) return false; data.set(k, structuredClone(next)); return true; } };
  const ledger = new CasReservationLedger(store as never);
  assert.equal(await budgetOpen(null, 'run-1'), false, 'no atomic ledger');
  assert.equal(await budgetOpen(ledger, 'run-1'), false, 'limits not set');
  await ledger.setLimit('monthly', undefined, '10', 0); assert.equal(await budgetOpen(ledger, 'run-1'), false, 'feature limit not set');
  await ledger.setLimit('feature', 'run-1', '1', 0); assert.equal(await budgetOpen(ledger, 'run-1'), true);
  await ledger.reserve({ attemptID: 'a1', runID: 'run-1', amount: '1' }); assert.equal(await budgetOpen(ledger, 'run-1'), false, 'feature budget fully reserved');
});
