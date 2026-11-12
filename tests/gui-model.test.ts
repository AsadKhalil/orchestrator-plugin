import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  budgetBackendNote, canPublish, deliveryFromSettings, deliveryOutcome, deliveryProblems, deliveryRequest, emptyDelivery, publishWarning,
  attentionExplanation, attentionTitle, autonomousNote, availableActions, buildRecommendRequest, canResume, coderWarning, describeError, emptyRecommendDraft, emptyRoute, emptyScore, emptySettle,
  evidenceLabel, exclusionExplanation, isIsoDate, isTerminal, isWaitingOnUser, parseScoreValue, parseTokenLimit, parseUsdInput, policyProblems, recommendError, recommendProblems, recommendationNote,
  reservationWarning, routeFromPolicy, routeToPolicy, runActionError, settleProblems, settleRequest, shouldPoll, stateLabel, truncate, validateRouteDraft, verdictLabel, type RecommendDraft, type RouteDraft,
} from '../src/gui-model.js';
import { parseUsd } from '../src/costs.js';
import { savePolicy } from '../src/settings.js';
import { saveDelivery } from '../src/delivery-settings.js';
import { CasReservationLedger } from '../src/cas-ledger.js';
import { loadCatalog } from '../src/catalog.js';
import { recommendRoutes } from '../src/recommendation.js';

const states = ['clarifying', 'planning', 'awaiting_approval', 'implementing', 'validating', 'reviewing', 'repairing', 'ready_for_acceptance', 'accepted', 'needs_attention', 'cancelled'];
const run = (over: Partial<{ state: string; planHash: string | null; attention: string | null; stopRequested: boolean }> = {}) => ({ state: 'planning', planHash: null, attention: null, stopRequested: false, ...over });
const valid = (): RouteDraft => ({ ...emptyRoute(), providerID: 'acme', id: 'model-1', vendor: 'acme', canonicalID: 'acme/model-1', modelVersion: '1', input: '2', output: '8', billing: 'metered_api', serviceTier: 'standard', kind: 'user_entered', sourceURL: 'https://example.com/pricing', checkedAt: '2026-11-12' });

test('stateLabel names every state and never hides an unknown one', () => {
  const labels = states.map(stateLabel);
  assert.equal(new Set(labels).size, states.length, 'labels are distinct');
  assert.equal(stateLabel('needs_attention'), 'Needs attention');
  assert.equal(stateLabel('ready_for_acceptance'), 'Ready for acceptance');
  assert.match(stateLabel('hologram'), /Unknown state \(hologram\)/);
  assert.match(stateLabel('constructor'), /Unknown state/, 'object prototype keys are not states');
  assert.match(stateLabel('__proto__'), /Unknown state/);
});

test('terminal, waiting and polling states are disjoint and cover the lifecycle', () => {
  const expected: Record<string, [boolean, boolean, boolean]> = { // terminal, waiting on user, poll
    clarifying: [false, true, false], awaiting_approval: [false, true, false], ready_for_acceptance: [false, true, false], needs_attention: [false, true, false],
    accepted: [true, false, false], cancelled: [true, false, false],
    planning: [false, false, true], implementing: [false, false, true], validating: [false, false, true], reviewing: [false, false, true], repairing: [false, false, true],
  };
  assert.deepEqual(Object.keys(expected).sort(), [...states].sort());
  for (const [state, [terminal, waiting, poll]] of Object.entries(expected)) {
    assert.equal(isTerminal(state), terminal, `${state} terminal`); assert.equal(isWaitingOnUser(state), waiting, `${state} waiting`); assert.equal(shouldPoll(state), poll, `${state} poll`);
  }
  assert.deepEqual([isTerminal('x'), isWaitingOnUser('x'), shouldPoll('x')], [false, false, false], 'an unknown state is never polled forever');
});

test('every attention reason the backend can emit has a plain-language explanation', () => {
  const source = ['orchestrator', 'host-ports', 'run'].map(name => readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')).join('\n');
  const found = new Set<string>();
  for (const pattern of [/\bpause\('([a-z_]+)'\)/g, /StageRefused\('([a-z_]+)'\)/g, /\?\s*error\.reason\s*:\s*'([a-z_]+)'/g, /reason: '([a-z_]+)'/g, /markNeedsAttention\(run, revision, '([a-z_]+)'/g]) for (const match of source.matchAll(pattern)) found.add(match[1]);
  // Reasons built from a template, expanded here. A new template fails this assertion so its values get an explanation too.
  const templates = [...source.matchAll(/(?:pause|StageRefused)\(`([^`]*)`\)/g)].map(match => match[1]).sort();
  assert.deepEqual(templates, ['no_route_for_${picked.missing}', 'planner_${result.reason}', 'validation_${report.status}'], 'a new templated attention reason needs an explanation in gui-model.ts');
  for (const status of ['failed', 'unknown', 'timed_out', 'stale']) found.add(`validation_${status}`);
  for (const role of ['planner', 'coder']) found.add(`no_route_for_${role}`);
  const planner = readFileSync(new URL('../src/planner-turn.ts', import.meta.url), 'utf8');
  for (const suffix of ['turn_active', 'session_unresolved']) { assert.ok(planner.includes(`'${suffix}'`), `planner-turn still reports ${suffix}`); found.add(`planner_${suffix}`); }
  for (const reason of ['coder_not_enabled', 'shell_not_enabled', 'shell_tool_unavailable', 'no_independent_reviewer', 'review_not_permitted', 'review_limit_reached', 'unsupported_step', 'budget_unavailable', 'stage_failed', 'worktree_unavailable', 'worktree_missing', 'worktree_changed_since_validation', 'diff_too_large_to_review', 'no_coder_step', 'validation_unavailable', 'step_dependencies_unmet', 'stop_requested', 'run_changed', 'coder_shares_reviewer_vendor', 'text_file_treated_as_binary', 'review_evidence_too_large', 'drive_error']) found.add(reason);
  assert.ok(found.size >= 20, `scanned the sources (${found.size} reasons)`);
  for (const reason of found) {
    const text = attentionExplanation(reason);
    assert.ok(text && text.length > 20, `${reason} has an explanation`);
    assert.doesNotMatch(text, /does not know/, `${reason} is not the generic fallback`);
  }
});

test('attentionExplanation: null stays null, unknown reasons keep the raw code, resumability is described honestly', () => {
  assert.equal(attentionExplanation(null), null);
  assert.match(attentionExplanation('brand_new_reason')!, /brand_new_reason/);
  assert.match(attentionExplanation('constructor')!, /constructor/, 'prototype keys fall back too');
  assert.match(attentionExplanation('review_limit_reached')!, /cannot be resumed/);
  assert.match(attentionExplanation('coder_not_enabled')!, /Spending & permissions/);
  assert.equal(attentionTitle('no_independent_reviewer'), 'no independent reviewer');
});

test('canResume: only the final review limit and a missing reason are not resumable', () => {
  assert.equal(canResume(null), false);
  assert.equal(canResume('review_limit_reached'), false);
  for (const reason of ['stage_failed', 'budget_exhausted', 'coder_not_enabled', 'validation_failed', 'something_new']) assert.equal(canResume(reason), true, reason);
});

test('availableActions follows the state', () => {
  const on = (value: ReturnType<typeof availableActions>) => Object.entries(value).filter(([, enabled]) => enabled).map(([name]) => name).sort();
  assert.deepEqual(on(availableActions(run({ state: 'planning' }))), ['export', 'run', 'runAutonomously', 'stop']);
  for (const state of ['implementing', 'validating', 'reviewing', 'repairing']) assert.deepEqual(on(availableActions(run({ state }))), ['export', 'run', 'runAutonomously', 'stop'], state);
  assert.deepEqual(on(availableActions(run({ state: 'clarifying' }))), ['export', 'stop']);
  assert.deepEqual(on(availableActions(run({ state: 'awaiting_approval', planHash: 'abc' }))), ['approve', 'export', 'runAutonomously', 'stop']);
  assert.deepEqual(on(availableActions(run({ state: 'ready_for_acceptance', planHash: 'abc' }))), ['accept', 'export', 'stop'], 'stop cancels a finished run; accept is refused after it');
  assert.deepEqual(on(availableActions(run({ state: 'needs_attention', attention: 'stage_failed' }))), ['export', 'resume', 'stop']);
  for (const state of ['accepted', 'cancelled']) assert.deepEqual(on(availableActions(run({ state }))), ['export'], state);
  assert.deepEqual(on(availableActions(run({ state: 'who_knows' }))), ['export']);
});

test('availableActions: approval needs a plan hash and review_limit_reached cannot be resumed', () => {
  assert.equal(availableActions(run({ state: 'awaiting_approval', planHash: null })).approve, false);
  assert.equal(availableActions(run({ state: 'awaiting_approval', planHash: null })).runAutonomously, false);
  assert.equal(availableActions(run({ state: 'planning', planHash: 'abc' })).approve, false);
  const final = availableActions(run({ state: 'needs_attention', attention: 'review_limit_reached' }));
  assert.equal(final.resume, false); assert.equal(final.stop, true, 'the run can still be stopped'); assert.equal(final.export, true);
  assert.equal(availableActions(run({ state: 'needs_attention', attention: null })).resume, false);
});

test('a run with a stop requested offers export only', () => {
  for (const state of states) {
    const actions = availableActions(run({ state, planHash: 'abc', attention: state === 'needs_attention' ? 'stage_failed' : null, stopRequested: true }));
    assert.deepEqual(actions, { run: false, runAutonomously: false, stop: false, accept: false, resume: false, approve: false, export: true }, state);
  }
});

test('parseUsdInput accepts plain decimals and returns the stored form', () => {
  const cases: [string, string][] = [['0', '0'], ['3', '3'], ['0.075', '0.075'], ['15.00', '15'], ['1.500', '1.5'], ['007.50', '7.5'], ['0.0', '0'], ['00', '0'], [' 2 ', '2'], ['999999999999.999999999999', '999999999999.999999999999']];
  for (const [input, output] of cases) { assert.equal(parseUsdInput(input), output, input); assert.doesNotThrow(() => parseUsd(output), `${output} is accepted by the backend parser`); }
});

test('parseUsdInput rejects everything else', () => {
  for (const bad of ['', ' ', '1e3', '1E3', '-1', '+1', '1.', '.5', '1.1234567890123', '1234567890123', '1,5', '1 000', '0x10', 'NaN', 'Infinity', '$3', '1_000', '１２', '1.2.3', '١٢']) assert.equal(parseUsdInput(bad), null, JSON.stringify(bad));
});

test('parseTokenLimit accepts 1 to 10,000,000 whole numbers only', () => {
  assert.equal(parseTokenLimit('8192'), 8192); assert.equal(parseTokenLimit('1'), 1); assert.equal(parseTokenLimit('10000000'), 10_000_000); assert.equal(parseTokenLimit(' 42 '), 42);
  for (const bad of ['', '0', '-1', '1.5', '1e3', '10000001', '99999999', '123456789', 'abc', '8,192']) assert.equal(parseTokenLimit(bad), null, JSON.stringify(bad));
});

test('isIsoDate accepts real dates and date-times and nothing else', () => {
  for (const good of ['2026-11-12', '2026-11-12T09:30:00Z', '2026-11-12T09:30Z', '2026-11-12T09:30:15.123+02:00', '2024-02-29']) assert.equal(isIsoDate(good), true, good);
  for (const bad of ['', 'yesterday', '2026-11', '12/11/2026', '2026-02-30', '2025-02-29', '2026-13-01', '2026-11-12T25:00:00Z', '2026-11-12T09:61Z', '2026-11-12 09:30', ' 2026-11-12', '2026-11-12T09:30', '2026-11-12T09:30:00']) assert.equal(isIsoDate(bad), false, JSON.stringify(bad));
});

test('emptyRoute pre-fills no rate, billing mode, evidence kind or date, and instances are independent', () => {
  const a = emptyRoute(), b = emptyRoute();
  for (const key of ['providerID', 'id', 'variant', 'vendor', 'canonicalID', 'modelVersion', 'input', 'output', 'cacheRead', 'cacheWrite', 'billing', 'serviceTier', 'kind', 'sourceURL', 'checkedAt'] as const) assert.equal(a[key], '', key);
  assert.equal(a.verified, false); assert.equal(a.conditions.length, 0);
  a.conditions.push('long context'); assert.deepEqual(b.conditions, [], 'conditions are not shared');
  const problems = validateRouteDraft(emptyRoute());
  for (const field of ['Provider ID', 'Model ID', 'Vendor', 'Canonical model ID', 'Model version', 'Service tier', 'Input rate', 'Output rate', 'billing mode', 'evidence kind', 'https://', 'Checked date']) assert.ok(problems.some(problem => problem.includes(field)), `reports ${field}`);
});

test('validateRouteDraft: a complete route is fine and cache rates may be empty or set', () => {
  assert.deepEqual(validateRouteDraft(valid()), []);
  assert.deepEqual(validateRouteDraft({ ...valid(), cacheRead: '0.3', cacheWrite: '3.75', variant: 'high', checkedAt: '2026-11-12T09:30:00Z' }), []);
  assert.deepEqual(validateRouteDraft({ ...valid(), providerID: '  p  ' }), []);
});

test('validateRouteDraft rejects bad decimals, non-https URLs, dates and choices', () => {
  for (const bad of ['1e3', '-1', '', '1.1234567890123', '3,5', 'free']) {
    assert.ok(validateRouteDraft({ ...valid(), input: bad }).some(p => p.startsWith('Input rate')), `input ${JSON.stringify(bad)}`);
    assert.ok(validateRouteDraft({ ...valid(), output: bad }).some(p => p.startsWith('Output rate')), `output ${JSON.stringify(bad)}`);
  }
  for (const bad of ['1e3', '-1', '1.1234567890123', 'free']) {
    assert.ok(validateRouteDraft({ ...valid(), cacheRead: bad }).some(p => p.startsWith('Cache read rate')), `cacheRead ${bad}`);
    assert.ok(validateRouteDraft({ ...valid(), cacheWrite: bad }).some(p => p.startsWith('Cache write rate')), `cacheWrite ${bad}`);
  }
  for (const bad of ['', 'http://example.com/p', 'ftp://example.com', 'https:/example.com', 'https://', 'example.com/pricing', 'javascript:alert(1)', 'HTTPS://example.com']) assert.ok(validateRouteDraft({ ...valid(), sourceURL: bad }).some(p => p.includes('https://')), `url ${JSON.stringify(bad)}`);
  for (const bad of ['', 'today', '2026-02-30', '11/12/2026']) assert.ok(validateRouteDraft({ ...valid(), checkedAt: bad }).some(p => p.includes('Checked date')), `date ${JSON.stringify(bad)}`);
  assert.ok(validateRouteDraft({ ...valid(), billing: 'free' }).some(p => p.includes('billing')));
  assert.ok(validateRouteDraft({ ...valid(), kind: 'rumour' }).some(p => p.includes('evidence kind')));
  assert.ok(validateRouteDraft({ ...valid(), vendor: '   ' }).some(p => p.includes('Vendor')));
  assert.ok(validateRouteDraft({ ...valid(), serviceTier: 'x'.repeat(101) }).some(p => p.includes('Service tier')));
});

test('policyProblems checks the output cap and duplicate routes', () => {
  assert.deepEqual(policyProblems('8192', [valid()]), []);
  assert.deepEqual(policyProblems('8192', []), []);
  assert.equal(policyProblems('0', [])[0], 'Max output tokens must be a whole number from 1 to 10,000,000.');
  assert.ok(policyProblems('8192', [valid(), valid()]).some(problem => problem.startsWith('Route 2:') && problem.includes('already')));
  assert.equal(policyProblems('8192', [valid(), { ...valid(), variant: 'high' }]).length, 0, 'a different variant is a different route');
  assert.ok(policyProblems('8192', [valid(), { ...valid(), input: 'x' }]).some(problem => problem.startsWith('Route 2: Input rate')));
});

test('routes convert to and from the policy shape without losing or altering saved facts', () => {
  const saved = { providerID: 'acme', id: 'm', variant: null, vendor: 'acme', canonicalID: 'acme/m', modelVersion: '2', rate: { inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: null, cacheWritePerMillion: '3.75', billing: 'subscription' as const, serviceTier: 'standard', interactive: false, conditions: ['long context'], evidence: { sourceURL: 'https://example.com/p', checkedAt: '2026-11-12T00:00:00Z', kind: 'official' as const, verified: true } } };
  const draft = routeFromPolicy(saved);
  assert.equal(draft.variant, ''); assert.equal(draft.cacheRead, ''); assert.equal(draft.cacheWrite, '3.75');
  assert.deepEqual(routeToPolicy(draft), saved, 'round trip');
  assert.notEqual(routeToPolicy(draft).rate.conditions, saved.rate.conditions, 'copies, never aliases');
  const edited = routeToPolicy({ ...valid(), providerID: ' p ', variant: ' high ', input: '007.50', cacheRead: '0.300', cacheWrite: '' });
  assert.equal(edited.providerID, 'p'); assert.equal(edited.variant, 'high'); assert.equal(edited.rate.inputPerMillion, '7.5'); assert.equal(edited.rate.cacheReadPerMillion, '0.3'); assert.equal(edited.rate.cacheWritePerMillion, null);
  assert.equal(routeToPolicy({ ...valid(), variant: '  ' }).variant, null);
  assert.equal(routeToPolicy(valid()).rate.evidence.verified, false, 'new routes are never marked verified');
  assert.deepEqual(routeToPolicy(valid()).rate.conditions, []);
  assert.equal(routeToPolicy({ ...valid(), input: '1e3' }).rate.inputPerMillion, '1e3', 'invalid values reach the backend unchanged so it refuses them');
});

test('a validated draft is accepted by the real backend policy validator, and its refusals are readable', async () => {
  const data = new Map<string, unknown>(), store = { async get(key: string) { return data.get(key); }, async set(key: string, value: unknown) { data.set(key, value); } };
  const body = (routes: unknown) => ({ maxOutputTokens: 8192, coderEnabled: false, routes });
  const saved = await savePolicy(store as never, '/project', 0, body([routeToPolicy({ ...valid(), variant: 'high', cacheWrite: '3.750', checkedAt: '2026-11-12T09:30:00Z' })]));
  assert.equal(saved.revision, 1); assert.equal(saved.routes[0].rate.cacheWritePerMillion, '3.75'); assert.equal(saved.routes[0].variant, 'high');
  await assert.rejects(savePolicy(store as never, '/project', 0, body([])), (error: unknown) => describeError(error, 'fallback') === 'Stale policy revision');
  await assert.rejects(savePolicy(store as never, '/project', 1, body([routeToPolicy({ ...valid(), input: '1e3' })])), (error: unknown) => describeError(error, 'fallback') === 'Invalid USD amount');
});

test('small text helpers', () => {
  assert.equal(verdictLabel('approve'), 'Approved'); assert.equal(verdictLabel('request_changes'), 'Changes requested'); assert.equal(verdictLabel('odd'), 'odd');
  assert.equal(truncate('  a\n\n b\t c ', 10), 'a b c');
  assert.equal(truncate('x'.repeat(100), 80).length, 80); assert.ok(truncate('x'.repeat(100), 80).endsWith('…'));
  assert.equal(truncate('x'.repeat(80), 80), 'x'.repeat(80));
  assert.equal(truncate('\u{1F600}'.repeat(10), 5), `${'\u{1F600}'.repeat(4)}…`, 'an emoji is never cut in half');
  assert.equal(truncate('abc', 1), '…'); assert.equal(truncate('', 5), '');
  assert.equal(describeError(new Error('Stale run revision'), 'x'), 'Stale run revision');
  assert.equal(describeError({ message: 'from rpc' }, 'x'), 'from rpc'); assert.equal(describeError('plain', 'x'), 'plain');
  for (const odd of [undefined, null, 42, {}, new Error('  ')]) assert.equal(describeError(odd, 'fallback'), 'fallback');
  assert.match(runActionError(new Error('Stale run revision')), /^Stale run revision\. .*reloaded/);
  assert.equal(runActionError(new Error('Stop requested')), 'Stop requested');
});

test('the exact warning and autonomous texts are fixed', () => {
  assert.equal(coderWarning, 'Turning this on lets the coder role edit files and run shell commands in a separate git worktree. The worktree is not a sandbox: shell commands run with your own account permissions and can reach files outside it. On OpenCode 2.2.7 a broad allow rule can override project deny rules, so only enable this in a disposable project. Off by default.');
  assert.equal(autonomousNote, 'Approves its own plan and continues without waiting. Needs monthly and feature budgets with budget left.');
});

test('the security-reviewed warning no longer calls the worktree isolated', () => {
  assert.doesNotMatch(coderWarning, /isolated/); assert.match(coderWarning, /not a sandbox/);
  for (const reason of ['validation_failed', 'worktree_missing', 'worktree_unavailable']) assert.doesNotMatch(attentionExplanation(reason)!, /isolated/, reason);
  assert.match(attentionExplanation('validation_failed')!, /run’s worktree/); assert.match(attentionExplanation('worktree_missing')!, /run’s worktree/);
});

test('the reservation and recommendation notices are fixed', () => {
  assert.equal(reservationWarning, "Only the provider's own charge record, or proof that nothing was sent, may release a reservation. Host-computed cost estimates never do. Until settled, a reservation counts at its worst case against your budgets.");
  assert.equal(recommendationNote, 'Scores are entered by you and are not verified. A score whose source is Artificial Analysis is refused unless permission is recorded. A recommendation is an estimate, not a bill, and nothing is saved or switched automatically.');
});

test('evidenceLabel names both settlement kinds and keeps anything else as is', () => {
  assert.equal(evidenceLabel(null), 'none'); assert.equal(evidenceLabel('confirmed_not_dispatched'), 'Confirmed never sent'); assert.match(evidenceLabel('provider_gross_charge'), /Provider.s own charge/); assert.equal(evidenceLabel('odd'), 'odd');
});

test('settleProblems: both kinds need a reference; only a provider charge needs an amount', () => {
  const ok = { kind: 'provider_gross_charge', actualUsd: '0.0123', reference: 'inv_123' };
  assert.deepEqual(settleProblems(ok), []);
  assert.deepEqual(settleProblems({ kind: 'confirmed_not_dispatched', actualUsd: 'ignored garbage', reference: 'no request in the provider log' }), []);
  const empty = settleProblems(emptySettle());
  assert.ok(empty.some(p => p.includes('Choose')) && empty.some(p => p.includes('reference')));
  for (const bad of ['', '1e3', '-1', '0.1234567890123', 'free', '1,5']) assert.ok(settleProblems({ ...ok, actualUsd: bad }).some(p => p.includes('USD amount')), JSON.stringify(bad));
  for (const bad of ['', '   ']) assert.ok(settleProblems({ ...ok, reference: bad }).some(p => p.includes('reference')), JSON.stringify(bad));
  assert.deepEqual(settleProblems({ ...ok, reference: 'x'.repeat(512) }), []);
  assert.ok(settleProblems({ ...ok, reference: 'x'.repeat(513) }).some(p => p.includes('512')));
  assert.ok(settleProblems({ ...ok, kind: 'host_estimate' }).some(p => p.includes('Choose')), 'a host estimate is not a settlement kind');
});

test('settleRequest is accepted by the real reservation ledger', async () => {
  let value: unknown; const storage = { async get() { return structuredClone(value); }, async compareAndSet(_key: string, expected: unknown, next: unknown) { if (JSON.stringify(value) !== JSON.stringify(expected)) return false; value = structuredClone(next); return true; } };
  const ledger = new CasReservationLedger(storage);
  await ledger.setLimit('monthly', undefined, '5', 0); await ledger.setLimit('feature', 'run-1', '5', 0);
  await ledger.reserve({ attemptID: 'a', runID: 'run-1', amount: '0.8' }); await ledger.reserve({ attemptID: 'b', runID: 'run-1', amount: '0.5' });
  const charge = settleRequest('run-1', 'a', { kind: 'provider_gross_charge', actualUsd: '00.7500', reference: '  inv_123  ' });
  assert.deepEqual(charge, { runID: 'run-1', attemptID: 'a', kind: 'provider_gross_charge', actualUsd: '0.75', reference: 'inv_123' });
  await ledger.reconcile(charge.attemptID, charge.actualUsd, { kind: charge.kind, reference: charge.reference });
  const unsent = settleRequest('run-1', 'b', { kind: 'confirmed_not_dispatched', actualUsd: 'anything', reference: 'provider log shows no request' });
  assert.equal(unsent.actualUsd, '0');
  await ledger.reconcile(unsent.attemptID, unsent.actualUsd, { kind: unsent.kind, reference: unsent.reference });
  const settled = await ledger.reservations('run-1');
  assert.deepEqual(settled.map(item => [item.attemptID, item.settledUsd, item.evidence?.kind]), [['a', '0.75', 'provider_gross_charge'], ['b', '0', 'confirmed_not_dispatched']]);
});

test('parseScoreValue accepts plain non-negative decimals only', () => {
  assert.equal(parseScoreValue('0'), 0); assert.equal(parseScoreValue(' 62.5 '), 62.5); assert.equal(parseScoreValue('007'), 7);
  for (const bad of ['', '-1', '+1', '1e3', 'NaN', 'Infinity', '5.', '.5', '1,5', '0x10', '1234567890123']) assert.equal(parseScoreValue(bad), null, JSON.stringify(bad));
});

const score = (over: Partial<ReturnType<typeof emptyScore>> = {}) => ({ ...emptyScore(), canonicalID: 'acme/m1', modelVersion: '1', value: '62.5', source: 'my own eval', ...over });
const rec = (over: Partial<RecommendDraft> = {}): RecommendDraft => ({ ...emptyRecommendDraft(), role: 'coder', minimumScore: '55', indexVersion: ' v4.0 ', scores: [score()], inputTokens: '50000', outputTokens: '4000', remainingBudget: '5.50', ...over });

test('recommendProblems accepts a complete draft and reports each bad field', () => {
  assert.deepEqual(recommendProblems(rec()), []);
  assert.deepEqual(recommendProblems(rec({ scores: [] })), [], 'no scores is allowed; every route will then be excluded as unscored');
  const empty = recommendProblems(emptyRecommendDraft());
  for (const field of ['Minimum score', 'Benchmark index version', 'Input tokens', 'Output tokens', 'Remaining budget']) assert.ok(empty.some(p => p.startsWith(field)), field);
  assert.ok(recommendProblems(rec({ role: 'ceo' })).includes('Choose a role.'));
  for (const bad of ['', '-1', '1e3', 'abc', '5.']) assert.ok(recommendProblems(rec({ minimumScore: bad })).some(p => p.startsWith('Minimum score')), `min ${JSON.stringify(bad)}`);
  for (const bad of ['0', '', 'abc', '1e3', '10000001', '-5', '1.5']) { assert.ok(recommendProblems(rec({ inputTokens: bad })).some(p => p.startsWith('Input tokens')), `in ${bad}`); assert.ok(recommendProblems(rec({ outputTokens: bad })).some(p => p.startsWith('Output tokens')), `out ${bad}`); }
  for (const bad of ['', '1e3', '-1', '1.1234567890123', '$5']) assert.ok(recommendProblems(rec({ remainingBudget: bad })).some(p => p.startsWith('Remaining budget')), `budget ${JSON.stringify(bad)}`);
  assert.ok(recommendProblems(rec({ indexVersion: '   ' })).some(p => p.startsWith('Benchmark index version')));
});

test('recommendProblems checks each score row and ambiguity between rows', () => {
  for (const [over, field] of [[{ canonicalID: ' ' }, 'Canonical model ID'], [{ modelVersion: '' }, 'Model version'], [{ source: '' }, 'Source'], [{ value: '' }, 'Value'], [{ value: '-1' }, 'Value'], [{ value: 'NaN' }, 'Value'], [{ value: 'Infinity' }, 'Value'], [{ value: '1e3' }, 'Value']] as const)
    assert.ok(recommendProblems(rec({ scores: [score(), score({ ...over, variant: 'other' })] })).some(p => p.startsWith('Score 2:') && p.includes(field)), JSON.stringify(over));
  assert.ok(recommendProblems(rec({ scores: [score(), score({ variant: ' ' })] })).some(p => p.startsWith('Score 2:') && p.includes('ambiguous')), 'blank and whitespace variants are the same default');
  assert.deepEqual(recommendProblems(rec({ scores: [score(), score({ variant: 'high' }), score({ modelVersion: '2' })] })), [], 'a different variant or version is a different row');
});

test('buildRecommendRequest builds the contract shape, or null for an invalid draft', () => {
  assert.equal(buildRecommendRequest(emptyRecommendDraft(), null), null);
  assert.equal(buildRecommendRequest(rec({ minimumScore: 'x' }), 'run-1'), null);
  const request = buildRecommendRequest(rec({ scores: [score(), score({ variant: ' high ', value: '70' })], image: true }), 'run-1')!;
  assert.deepEqual(request, {
    role: 'coder', runID: null, minimumScore: 55, indexVersion: 'v4.0',
    scores: [
      { canonicalID: 'acme/m1', modelVersion: '1', testedReasoning: { variantID: null, effort: null, thinkingMode: null, thinkingBudgetTokens: null }, indexVersion: 'v4.0', value: 62.5, source: 'my own eval' },
      { canonicalID: 'acme/m1', modelVersion: '1', testedReasoning: { variantID: 'high', effort: null, thinkingMode: null, thinkingBudgetTokens: null }, indexVersion: 'v4.0', value: 70, source: 'my own eval' },
    ],
    workload: { inputTokens: 50000, outputTokens: 4000 }, remainingBudget: '5.5', needs: { image: true, tools: false },
  });
  assert.equal(buildRecommendRequest(rec({ role: 'reviewer' }), 'run-1')!.runID, 'run-1', 'the reviewer uses the open run to exclude vendors that worked on it');
  assert.equal(buildRecommendRequest(rec({ role: 'reviewer' }), null)!.runID, null);
  for (const role of ['planner', 'coder']) assert.equal(buildRecommendRequest(rec({ role }), 'run-1')!.runID, null, `${role} ignores the open run`);
  request.scores[0].testedReasoning.variantID = 'changed';
  assert.equal(buildRecommendRequest(rec(), null)!.scores[0].testedReasoning.variantID, null, 'no shared state between builds');
});

test('the request has exactly the keys the contract requires', () => {
  const contract = readFileSync(new URL('../src/contract.ts', import.meta.url), 'utf8');
  const line = contract.split('\n').find(text => text.includes('recommendRoutes:'))!;
  const required = /required: \['role'([^\]]*)\]/.exec(line)![0].match(/'([A-Za-z]+)'/g)!.map(name => name.slice(1, -1));
  assert.deepEqual(Object.keys(buildRecommendRequest(rec(), null)!).sort(), [...required].sort());
  for (const kind of ['provider_gross_charge', 'confirmed_not_dispatched']) assert.ok(contract.includes(`'${kind}'`), kind);
});

test('a built request works with the real recommender: default and named variants match their own scores', async () => {
  const route = (over: Partial<RouteDraft>) => routeToPolicy({ ...valid(), providerID: 'acme', canonicalID: 'acme/m1', modelVersion: '1', checkedAt: '2026-11-12', ...over });
  const policy = { routes: [route({ id: 'm1' }), route({ id: 'm1', variant: 'high', input: '4', output: '16' }), route({ id: 'm2', canonicalID: 'acme/m2' })] };
  const model = (id: string, variants: string[]) => ({ providerID: 'acme', id, enabled: true, status: 'active', variants, limit: { context: 200000, output: 8192 }, capabilities: { input: ['text'], output: ['text'], tools: true } });
  const inventory = [model('m1', ['high']), model('m2', [])], now = '2026-11-12T10:00:00.000Z';
  const request = buildRecommendRequest(rec({ scores: [score({ value: '70' }), score({ variant: 'high', value: '80' })] }), null)!;
  const refs = [{ providerID: 'acme', id: 'm1', variant: null }, { providerID: 'acme', id: 'm1', variant: 'high' }, { providerID: 'acme', id: 'm2', variant: null }];
  const result = recommendRoutes(await loadCatalog({ listModels: async () => inventory }, policy, now), inventory, { ...request, selected: refs, maxOutputTokens: 8192, excludedVendors: [], now });
  assert.equal(result.selected?.id, 'm1'); assert.equal(result.selected?.variant, null); assert.equal(result.selected?.estimatedCash, '0.132');
  assert.deepEqual(result.alternatives.map(item => [item.id, item.variant, item.quality?.value]), [['m1', null, 70], ['m1', 'high', 80]]);
  assert.deepEqual(result.excluded.map(item => [item.id, item.reasons]), [['m2', ['quality_unknown']]]);
  for (const item of result.excluded) for (const reason of item.reasons) assert.doesNotMatch(exclusionExplanation(reason), /does not know/);
});

test('every route exclusion reason the backend can emit has a plain-language explanation', () => {
  const read = (name: string) => readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const catalog = read('catalog'), found = new Set([...read('policy').matchAll(/reasons\.push\('([a-z_]+)'\)/g)].map(match => match[1]));
  const union = /export type ExclusionReason = ([^;]+);/.exec(catalog)![1].match(/'([a-z_]+)'/g)!.map(name => name.slice(1, -1));
  assert.ok(read('recommendation').includes('rate_${rateReasons.get('), 'the recommender still prefixes rate-check reasons with rate_');
  for (const reason of union) { found.add(reason); found.add(`rate_${reason}`); }
  assert.ok(found.size >= 25, `scanned the sources (${found.size} reasons)`);
  for (const reason of found) {
    const text = exclusionExplanation(reason);
    assert.ok(text.length > 20, reason); assert.doesNotMatch(text, /does not know/, `${reason} is not the generic fallback`);
  }
  assert.match(exclusionExplanation('quality_below_floor'), /minimum score/); assert.match(exclusionExplanation('rate_rate_stale'), /7 days/); assert.match(exclusionExplanation('rate_billing_unbounded'), /metered API/);
  assert.equal(exclusionExplanation('rate_unavailable'), exclusionExplanation('unavailable'));
});

test('unknown exclusion reasons keep their raw code', () => {
  for (const reason of ['brand_new', 'constructor', '__proto__', 'rate_constructor', 'rate_not_selected', 'rate_']) assert.ok(exclusionExplanation(reason).includes(`(${reason})`), reason);
  assert.ok(exclusionExplanation('').includes('does not know'));
});

test('recommendError shows the backend message and explains a refused benchmark source', () => {
  assert.equal(recommendError(new Error('Invalid selection policy')), 'Invalid selection policy');
  assert.match(recommendError(new Error('benchmark_source_not_authorized')), /^benchmark_source_not_authorized: .*Artificial Analysis/);
  assert.equal(recommendError(undefined), 'The recommendation could not be calculated.');
});

test('delivery drafts: client checks agree with the backend, publishing needs an accepted run, and outcomes are stated plainly', async () => {
  const store = { data: new Map<string, unknown>(), async get(key: string) { return this.data.get(key); }, async set(key: string, value: unknown) { this.data.set(key, value); } };
  const draft = (over: Partial<ReturnType<typeof emptyDelivery>> = {}) => ({ ...emptyDelivery(), publicationEnabled: true, remoteURL: 'https://github.com/o/r.git', ...over });
  const cases: [string, ReturnType<typeof emptyDelivery>][] = [
    ['good', draft()], ['scp-style url', draft({ remoteURL: 'git@github.com:o/r.git' })], ['credentials', draft({ remoteURL: 'https://u:t@github.com/o/r.git' })], ['option-like remote', draft({ remote: '--upload-pack=x' })],
    ['dotdot branch', draft({ baseBranch: '../main' })], ['prefix without slash', draft({ branchPrefix: 'fp' })], ['no url', draft({ remoteURL: '' })], ['whitespace url', draft({ remoteURL: 'https://a b' })], ['off and empty', { ...emptyDelivery() }],
  ];
  let revision = 0;
  for (const [name, value] of cases) {
    const problems = deliveryProblems(value);
    const saved = await saveDelivery(store as never, '/repo', revision, deliveryRequest(value, revision)).then(result => result, () => null);
    assert.equal(saved !== null, problems.length === 0, `${name}: client ${JSON.stringify(problems)} vs backend ${saved !== null ? 'accepted' : 'rejected'}`);
    if (saved) revision = saved.revision;
  }
  assert.deepEqual(deliveryFromSettings({ publicationEnabled: false, github: null }), emptyDelivery());
  assert.equal(deliveryRequest(emptyDelivery(), 3).github, null, 'publication off with no destination clears it');
  assert.equal(canPublish('accepted'), true); for (const state of ['ready_for_acceptance', 'implementing', 'needs_attention', 'cancelled']) assert.equal(canPublish(state), false, state);
  assert.match(publishWarning, /DRAFT/); assert.match(publishWarning, /never merges/i);
  const base = { reason: null, paths: [], branch: null, commit: null, prUrl: null, reusedPR: null };
  assert.match(deliveryOutcome({ ...base, status: 'delivered', branch: 'feature-pilot/abc', prUrl: 'https://github.com/o/r/pull/1', reusedPR: false }), /opened.*pull\/1.*Nothing was merged/);
  assert.match(deliveryOutcome({ ...base, status: 'delivered', branch: 'b', prUrl: 'https://github.com/o/r/pull/1', reusedPR: true }), /already existed/);
  assert.match(deliveryOutcome({ ...base, status: 'needs_attention', reason: 'push failed', branch: 'b', commit: 'a'.repeat(40) }), /Check the branch and pull request.*nothing is retried/s);
  assert.match(deliveryOutcome({ ...base, status: 'refused', reason: 'Publication is not enabled for this project' }), /^Not delivered: Publication is not enabled/);
  assert.match(deliveryOutcome({ ...base, status: 'exported', paths: ['/x/run.json', '/x/summary.md'] }), /Exported 2 files/);
});

test('the panel says where budgets live and warns about the local file', () => {
  assert.match(budgetBackendNote('host'), /OpenCode’s own atomic storage/);
  assert.match(budgetBackendNote('local_file'), /local file[\s\S]*any program running as you can edit/);
  assert.match(budgetBackendNote(null), /no paid request can be allowed/);
});
