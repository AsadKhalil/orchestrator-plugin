import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerInventory, FeaturePilot } from '../src/rpc.js';
import { newRun } from '../src/run.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBudgetLedger } from '../src/budget-ledger.js';
import { recordDecision } from '../src/relay-store.js';

/** What the real host does with a handler: it supplies the typed-error factory, and the client sees a returned error as a rejected call (a thrown one only as "RPC call failed"). */
class HostError extends Error { constructor(readonly type: string, message: string, readonly data: unknown) { super(message); } }
function asClient(handlers: unknown): any {
  const call = { signal: new AbortController().signal, error: (type: string, message: string, data: unknown) => new HostError(type, message, data) };
  return Object.fromEntries(Object.entries(handlers as Record<string, (input: unknown, call: unknown) => Promise<unknown>>).map(([name, handler]) => [name, async (input: unknown) => {
    const result = await handler(input, call); if (result instanceof HostError) throw result; return result;
  }]));
}

/** The real host refuses an output that does not fit the method's declared schema. This checks the shape keywords the contract uses and lists what does not fit. */
function fits(schema: any, value: unknown, path = 'output'): string[] {
  if (schema.anyOf) return schema.anyOf.some((option: unknown) => fits(option, value, path).length === 0) ? [] : [`${path}: fits no option`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: not one of ${schema.enum.join(', ')}`];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : schema.type === 'integer' && Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type && type !== schema.type) return [`${path}: ${type}, not ${schema.type}`];
  if (type === 'array') return (value as unknown[]).flatMap((item, index) => fits(schema.items ?? {}, item, `${path}[${index}]`));
  if (type !== 'object') return [];
  const properties = schema.properties ?? {}, object = value as Record<string, unknown>;
  return [
    ...(schema.required ?? []).filter((key: string) => !(key in object)).map((key: string) => `${path}.${key}: missing`),
    ...Object.keys(object).filter(key => schema.additionalProperties === false && !(key in properties)).map(key => `${path}.${key}: not declared`),
    ...Object.entries(object).flatMap(([key, item]) => properties[key] ? fits(properties[key], item, `${path}.${key}`) : []),
  ];
}

test('budget settings require atomic storage and reject stale revisions', async () => {
  let handlers: any; const data = new Map<string, unknown>();
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async compareAndSet(key: string, previous: unknown, next: unknown) { if (JSON.stringify(data.get(key)) !== JSON.stringify(previous)) return false; data.set(key, structuredClone(next)); return true; } };
  const context = { location: { directory: '/repo' }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } };
  await registerInventory(context as never);
  assert.equal((await handlers.getBudget({ runID: null })).available, true);
  assert.deepEqual((await handlers.setBudget({ scope: 'monthly', runID: null, amount: '12.50', revision: 0 })).monthly, { amount: '12.5', revision: 1 });
  await assert.rejects(handlers.setBudget({ scope: 'monthly', runID: null, amount: '20', revision: 0 }), /stale/i);
  await assert.rejects(handlers.setBudget({ scope: 'feature', runID: null, amount: '2', revision: 0 }), /select/i);
  await assert.rejects(handlers.getBudget({ runID: 'missing' }), /not found/i);
  const runID = '00000000-0000-4000-8000-000000000001';
  data.set(`project-runs/${encodeURIComponent('/repo')}/runs/${runID}`, newRun(runID, 'Synthetic', 'base'));
  assert.deepEqual((await handlers.setBudget({ scope: 'feature', runID, amount: '2', revision: 0 })).feature, { amount: '2', revision: 1 });
  assert.equal((await handlers.getBudget({ runID })).feature.amount, '2');
  await registerInventory({ ...context, location: { directory: '/other' } } as never);
  await assert.rejects(handlers.getBudget({ runID }), /not found/i);
  const withoutAtomic = { ...context, storage: { async get() { return undefined; } } };
  await registerInventory(withoutAtomic as never);
  assert.equal((await handlers.getBudget({ runID: null })).available, false);
  await assert.rejects(handlers.setBudget({ scope: 'monthly', runID: null, amount: '1', revision: 0 }), /atomic/i);
});

test('registers a read-only inventory endpoint that does not return provider secrets', async () => {
  let handler: (() => Promise<unknown>) | undefined;
  const ctx = {
    location: { directory: '/repo' },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'Model', enabled: true, status: 'active', variants: [{ id: 'high', settings: { apiKey: 'hidden' } }], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 }, settings: { apiKey: 'secret' } }] }; } },
    rpc: { async register(_definition: unknown, handlers: { listModels: () => Promise<unknown> }) { handler = (asClient(handlers) as { listModels: () => Promise<unknown> }).listModels; return { async dispose() {} }; } },
  };
  await registerInventory(ctx as never);
  assert.ok(handler);
  const result = await handler();
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('hidden'), false);
  assert.equal((result as any).directory, '/repo');
  assert.equal((result as any).models[0].id, 'm');
  assert.deepEqual((result as any).models[0].cost, { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, tiered: false });
  assert.deepEqual(fits(FeaturePilot.methods.listModels.output, result), [], 'the real host refuses an output its contract does not declare');
});

test('settings RPC saves only available project routes and rejects stale edits', async () => {
  let handlers: any;
  const data = new Map<string, unknown>();
  const context = {
    location: { directory: '/repo' },
    storage: { async get(k: string) { return data.get(k); }, async set(k: string, v: unknown) { data.set(k, v); } },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'Model', enabled: true, status: 'active', variants: [{ id: 'high' }], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } }] }; } },
    rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } },
  };
  await registerInventory(context as never);
  const initial = await handlers.getSelections({});
  assert.equal(initial.directory, '/repo');
  const roles = { planner: [{ providerID: 'p', id: 'm', variant: 'high' }], coder: [], reviewer: [] };
  assert.equal((await handlers.saveSelections({ revision: 0, roles })).settings.revision, 1);
  await assert.rejects(handlers.saveSelections({ revision: 0, roles }), /stale/i);
  await assert.rejects(handlers.saveSelections({ revision: 1, roles: { ...roles, coder: [{ providerID: 'forged', id: 'm', variant: null }] } }), /unavailable/i);
});

test('price refresh RPC uses only public OpenRouter data and returns display-only rates', async () => {
  let handlers: any; const records = new Map<string, unknown>();
  const context = { location: { directory: '/repo' }, storage: { async get(k: string) { return records.get(k); }, async set(k: string, v: unknown) { records.set(k, v); } }, model: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } };
  const original = globalThis.fetch; let requested = '';
  globalThis.fetch = (async (url: string | URL | Request) => { requested = String(url); return new Response(JSON.stringify({ data: [{ id: 'vendor/model', pricing: { prompt: '0.000002', completion: '0.00001' } }] })); }) as typeof fetch;
  try {
    await registerInventory(context as never);
    const result = await handlers.refreshPrices({});
    assert.equal(requested, 'https://openrouter.ai/api/v1/models');
    assert.equal(result.directory, '/repo');
    assert.equal(result.snapshot.models[0].inputPerMillionUsd, '2');
    assert.equal(result.snapshot.models[0].usableForBudget, false);
  } finally { globalThis.fetch = original; }
});

test('usage RPC returns aggregate observations with explicit incomplete coverage', async () => {
  let handlers: any;
  const context = { location: { directory: '/repo' }, storage: { async scan() { return { entries: [{key:'owned-session/ses_1',value:'r'}] }; }, async get() { return 'coder'; } }, session: { async get() { return { location: { directory: '/repo' } }; }, async context() { return [{type:'assistant',id:'msg_1',model:{providerID:'p',id:'m'},time:{created:Date.parse('2026-01-02T00:00:00Z')},cost:0.12,content:[{type:'text',text:'private code'}]}]; } }, model: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h);return { async dispose() {} }; } } };
  await registerInventory(context as never);
  const result = await handlers.observedUsage({ month:'2026-01', timeZone:'UTC' });
  assert.equal(result.directory, '/repo'); assert.equal(result.coverage.complete, false);
  assert.equal(result.summary.total.gross.knownUsd, '0.12');
  assert.equal(JSON.stringify(result).includes('private code'), false);
});

test('intelligence RPC does not expose credentials or upstream errors', async () => {
  let handlers:any; const context={location:{directory:'/repo'},storage:{},model:{},rpc:{async register(_d:unknown,h:unknown){handlers = asClient(h);return {async dispose(){}};}}};
  const originalFetch=globalThis.fetch, old=process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  process.env.ARTIFICIAL_ANALYSIS_API_KEY='synthetic-secret';
  globalThis.fetch=(async()=>{throw new Error('upstream synthetic-secret');}) as typeof fetch;
  try {await registerInventory(context as never);await assert.rejects(handlers.listIntelligence({}),error=>error instanceof Error && !error.message.includes('synthetic-secret'));}
  finally {globalThis.fetch=originalFetch;if(old===undefined)delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;else process.env.ARTIFICIAL_ANALYSIS_API_KEY=old;}
});

test('policy rates round-trip over RPC with revision checks and project scoping', async () => {
  let handlers: any; const data = new Map<string, unknown>();
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async set(key: string, value: unknown) { data.set(key, structuredClone(value)); } };
  const context = { location: { directory: '/repo' }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } };
  await registerInventory(context as never);
  assert.deepEqual((await handlers.getPolicy({})).policy, { revision: 0, maxOutputTokens: 8192, coderEnabled: false, routes: [] });
  const route = { providerID: 'p', id: 'm', variant: null, vendor: 'acme', canonicalID: 'acme-1', modelVersion: '1', rate: { inputPerMillion: '3.0', outputPerMillion: '15', cacheReadPerMillion: null, cacheWritePerMillion: null, billing: 'metered_api', serviceTier: 'standard', interactive: true, conditions: [], evidence: { sourceURL: 'https://example.com/p', checkedAt: '2026-11-12T00:00:00Z', kind: 'user_entered', verified: false } } };
  const saved = (await handlers.savePolicy({ revision: 0, maxOutputTokens: 4096, coderEnabled: false, routes: [route] })).policy;
  assert.equal(saved.revision, 1); assert.equal(saved.routes[0].rate.inputPerMillion, '3');
  await assert.rejects(handlers.savePolicy({ revision: 0, maxOutputTokens: 1, coderEnabled: false, routes: [] }), /stale/i);
  await assert.rejects(handlers.savePolicy({ revision: 1, maxOutputTokens: 1, coderEnabled: false, routes: [{ ...route, rate: { ...route.rate, evidence: { ...route.rate.evidence, sourceURL: 'http://insecure.example' } } }] }), /evidence/i);
  assert.equal((await handlers.getPolicy({})).policy.revision, 1, 'a rejected save leaves the policy alone');
});

test('driveDraft starts a run once, refuses autonomy without open atomic budgets, and stopDraft reaches the driver', async () => {
  let handlers: any; const data = new Map<string, unknown>(); const started: [string, boolean][] = [], stopped: [string, number][] = [];
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async set(key: string, value: unknown) { data.set(key, structuredClone(value)); }, async compareAndSet(key: string, previous: unknown, next: unknown) { if (JSON.stringify(data.get(key)) !== JSON.stringify(previous)) return false; data.set(key, structuredClone(next)); return true; } };
  const context = { location: { directory: '/repo' }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } };
  const driver = { start(id: string, autonomous: boolean) { started.push([id, autonomous]); return started.length === 1; }, async stop(id: string, revision: number) { stopped.push([id, revision]); }, isActive: () => false, idle: async () => {} };
  const id = '00000000-0000-4000-8000-000000000002';
  data.set(`project-runs/${encodeURIComponent('/repo')}/runs/${id}`, newRun(id, 'Synthetic', 'base'));
  await registerInventory(context as never, { driver: () => driver as never });
  const first = await handlers.driveDraft({ id, autonomous: false });
  assert.equal(first.started, true); assert.equal(first.run.id, id);
  assert.equal((await handlers.driveDraft({ id, autonomous: false })).started, false, 'a second start reports it was already running');
  await assert.rejects(handlers.driveDraft({ id, autonomous: true }), /autonomous.*budget/i);
  await assert.rejects(handlers.driveDraft({ id: 'missing', autonomous: false }), /not found/i);
  await handlers.setBudget({ scope: 'monthly', runID: null, amount: '10', revision: 0 });
  await handlers.setBudget({ scope: 'feature', runID: id, amount: '2', revision: 0 });
  assert.equal((await handlers.driveDraft({ id, autonomous: true })).started, false);
  assert.deepEqual(started, [[id, false], [id, false], [id, true]]);
  await handlers.stopDraft({ id, revision: 0 }); assert.deepEqual(stopped, [[id, 0]]);
  await registerInventory(context as never); await assert.rejects(handlers.driveDraft({ id, autonomous: false }), /not available/i);
});

test('recommendRoutes ranks the saved selection with the saved policy rates and refuses unauthorized benchmark sources', async () => {
  let handlers: any; const data = new Map<string, unknown>();
  const storage = { async get(k: string) { return structuredClone(data.get(k)); }, async set(k: string, v: unknown) { data.set(k, structuredClone(v)); }, async compareAndSet(k: string, previous: unknown, next: unknown) { if (JSON.stringify(data.get(k)) !== JSON.stringify(previous)) return false; data.set(k, structuredClone(next)); return true; } };
  const context = {
    location: { directory: '/repo' }, storage, session: {},
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'M', enabled: true, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 200000, output: 16000 } }] }; } },
    rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } },
  };
  await registerInventory(context as never);
  const rate = { inputPerMillion: '1', outputPerMillion: '2', cacheReadPerMillion: null, cacheWritePerMillion: null, billing: 'metered_api', serviceTier: 'standard', interactive: true, conditions: [], evidence: { sourceURL: 'https://example.com/p', checkedAt: new Date().toISOString(), kind: 'user_entered', verified: false } };
  await handlers.savePolicy({ revision: 0, maxOutputTokens: 8192, coderEnabled: false, routes: [{ providerID: 'p', id: 'm', variant: null, vendor: 'v', canonicalID: 'c', modelVersion: '1', rate }] });
  await handlers.saveSelections({ revision: 0, roles: { planner: [], coder: [{ providerID: 'p', id: 'm', variant: null }], reviewer: [] } });
  const ask = (source: string) => handlers.recommendRoutes({ role: 'coder', runID: null, minimumScore: 1, indexVersion: 'v1', scores: [{ canonicalID: 'c', modelVersion: '1', testedReasoning: { variantID: null, effort: null, thinkingMode: null, thinkingBudgetTokens: null }, indexVersion: 'v1', value: 80, source }], workload: { inputTokens: 1000, outputTokens: 1000 }, remainingBudget: '1', needs: { image: false, tools: true } });
  const result = await ask('my-notes');
  assert.equal(result.selected.id, 'm'); assert.equal(result.selected.estimatedCash, '0.003'); assert.equal(result.selected.score, 80); assert.equal(result.selectionRevision, 1); assert.deepEqual(result.excluded, []);
  await assert.rejects(ask('Artificial Analysis'), /benchmark_source_not_authorized/);
  await assert.rejects(handlers.recommendRoutes({ role: 'reviewer', runID: 'missing', minimumScore: 1, indexVersion: 'v1', scores: [], workload: { inputTokens: 1, outputTokens: 1 }, remainingBudget: '1', needs: { image: false, tools: false } }), /not found/i);
});

test('reservations are listed per run and released only with provider evidence', async () => {
  let handlers: any; const data = new Map<string, unknown>();
  const storage = { async get(k: string) { return structuredClone(data.get(k)); }, async set(k: string, v: unknown) { data.set(k, structuredClone(v)); }, async compareAndSet(k: string, previous: unknown, next: unknown) { if (JSON.stringify(data.get(k)) !== JSON.stringify(previous)) return false; data.set(k, structuredClone(next)); return true; } };
  const context = { location: { directory: '/repo' }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } };
  const id = '00000000-0000-4000-8000-000000000003', other = '00000000-0000-4000-8000-000000000004';
  for (const run of [id, other]) data.set(`project-runs/${encodeURIComponent('/repo')}/runs/${run}`, newRun(run, 'Synthetic', 'base'));
  await registerInventory(context as never);
  await handlers.setBudget({ scope: 'monthly', runID: null, amount: '10', revision: 0 });
  await handlers.setBudget({ scope: 'feature', runID: id, amount: '2', revision: 0 });
  const { CasReservationLedger } = await import('../src/cas-ledger.js'); const ledger = new CasReservationLedger(storage as never);
  await ledger.reserve({ attemptID: 'a1', runID: id, amount: '0.5' }); await ledger.reserve({ attemptID: 'a2', runID: id, amount: '0.5' });
  assert.deepEqual((await handlers.listReservations({ runID: id })).reservations.map((r: any) => [r.attemptID, r.reservedUsd, r.settledUsd]), [['a1', '0.5', null], ['a2', '0.5', null]]);
  assert.deepEqual((await handlers.listReservations({ runID: other })).reservations, []);
  await assert.rejects(handlers.settleReservation({ runID: other, attemptID: 'a1', kind: 'provider_gross_charge', actualUsd: '0.1', reference: 'inv' }), /not found for this run/i);
  await assert.rejects(handlers.settleReservation({ runID: id, attemptID: 'a1', kind: 'provider_gross_charge', actualUsd: '0.1', reference: '  ' }), /evidence/i);
  const settled = await handlers.settleReservation({ runID: id, attemptID: 'a1', kind: 'provider_gross_charge', actualUsd: '0.12', reference: 'invoice-line-7' });
  const settledRow = settled.reservations.find((row: any) => row.attemptID === 'a1'); assert.deepEqual(settled.reservations.map((row: any) => row.attemptID), ['a2', 'a1'], 'unsettled reservations are listed first');
  assert.deepEqual(settledRow, { attemptID: 'a1', period: settledRow.period, reservedUsd: '0.5', settledUsd: '0.12', evidenceKind: 'provider_gross_charge', evidenceReference: 'invoice-line-7' });
  assert.equal((await handlers.getBudget({ runID: id })).featureUsage.committedUsd, '0.62', 'the settled amount replaces its reservation; the other stays at its worst case');
  await assert.rejects(handlers.settleReservation({ runID: id, attemptID: 'a1', kind: 'provider_gross_charge', actualUsd: '0.2', reference: 'invoice-line-7' }), /conflict/i);
  await handlers.settleReservation({ runID: id, attemptID: 'a2', kind: 'confirmed_not_dispatched', actualUsd: '99', reference: 'host-log-123' });
  assert.equal((await handlers.getBudget({ runID: id })).featureUsage.committedUsd, '0.12', 'not-dispatched settles at zero regardless of the amount field');
  await assert.rejects(handlers.listReservations({ runID: 'missing' }), /not found/i);
});

test('delivery settings round-trip over RPC, publication stays refused until enabled, and a local export is written beside the worktrees', async () => {
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'fp-rpc-delivery-')); let handlers: any; const data = new Map<string, unknown>();
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async set(key: string, value: unknown) { data.set(key, structuredClone(value)); }, async compareAndSet(key: string, previous: unknown, next: unknown) { if (JSON.stringify(data.get(key)) !== JSON.stringify(previous)) return false; data.set(key, structuredClone(next)); return true; } };
  const context = { location: { directory: dir }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } };
  const id = '00000000-0000-4000-8000-000000000003';
  data.set(`project-runs/${encodeURIComponent(dir)}/runs/${id}`, newRun(id, 'Synthetic', 'base'));
  try {
    await registerInventory(context as never);
    assert.deepEqual((await handlers.getDelivery({})).delivery, { revision: 0, publicationEnabled: false, github: null });
    const refused = await handlers.deliverDraft({ id, revision: 0, target: 'github' });
    assert.equal(refused.status, 'refused'); assert.match(refused.reason, /not enabled/i); assert.equal(refused.run.id, id);
    await assert.rejects(handlers.saveDelivery({ revision: 0, publicationEnabled: true, github: { remote: 'origin', remoteURL: 'https://tok:en@github.com/o/r.git', baseBranch: 'main', branchPrefix: 'feature-pilot/' } }), /credentials/i);
    const github = { remote: 'origin', remoteURL: 'https://github.com/o/r.git', baseBranch: 'main', branchPrefix: 'feature-pilot/' };
    assert.deepEqual((await handlers.saveDelivery({ revision: 0, publicationEnabled: true, github })).delivery, { revision: 1, publicationEnabled: true, github });
    await assert.rejects(handlers.saveDelivery({ revision: 0, publicationEnabled: false, github }), /stale/i);
    const notAccepted = await handlers.deliverDraft({ id, revision: 0, target: 'github' });
    assert.equal(notAccepted.status, 'refused'); assert.match(notAccepted.reason, /accept the run/i);
    await assert.rejects(handlers.deliverDraft({ id: 'missing', revision: 0, target: 'github' }), /not found/i);
    await assert.rejects(handlers.deliverDraft({ id, revision: 9, target: 'local' }), /stale/i);
    const local = await handlers.deliverDraft({ id, revision: 0, target: 'local' });
    assert.equal(local.status, 'exported'); assert.ok(local.paths.every((path: string) => path.startsWith(`${dir}.feature-pilot`) && existsSync(path)));
    await registerInventory({ ...context, location: { directory: `${dir}-other` } } as never);
    await assert.rejects(handlers.deliverDraft({ id, revision: 0, target: 'local' }), /not found/i);
    assert.deepEqual((await handlers.getDelivery({})).delivery, { revision: 0, publicationEnabled: false, github: null }, 'another project has its own settings');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(`${dir}.feature-pilot`, { recursive: true, force: true }); }
});

test('a refusal reaches the client as the declared rejected error with its message, not as a thrown handler error', async () => {
  let handlers: any; const data = new Map<string, unknown>();
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async compareAndSet(key: string, previous: unknown, next: unknown) { if (JSON.stringify(data.get(key)) !== JSON.stringify(previous)) return false; data.set(key, structuredClone(next)); return true; }, async set() {} };
  await registerInventory({ location: { directory: '/repo' }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } } as never);
  await assert.rejects(handlers.getBudget({ runID: 'missing' }), { type: 'rejected', message: /not found/i });
  // Every method must declare the error, or the real host would drop the message and the panel could not explain a refusal.
  const { FeaturePilot } = await import('../src/contract.js');
  const missing = Object.entries(FeaturePilot.methods).filter(([, method]) => !(method as { errors?: Record<string, unknown> }).errors?.rejected).map(([name]) => name);
  assert.deepEqual(missing, []);
});

test('getBudget names where the limits live, and the local file ledger enforces revisions and refuses nothing it should allow', async () => {
  const plain = { async get() { return undefined; }, async set() {} };
  const atomic = { ...plain, async compareAndSet() { return true; } };
  const connect = async (storage: unknown, handle?: Awaited<ReturnType<typeof openBudgetLedger>>) => {
    let handlers: any;
    await registerInventory({ location: { directory: '/repo' }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } } } as never, undefined, handle);
    return handlers;
  };
  assert.equal((await (await connect(plain)).getBudget({ runID: null })).backend, null);
  assert.deepEqual(await (await connect(plain)).getBudget({ runID: null }).then((value: { available: boolean }) => value.available), false);
  assert.equal((await (await connect(atomic)).getBudget({ runID: null })).backend, 'host');
  const root = await mkdtemp(join(tmpdir(), 'fp-rpc-ledger-')); const handle = await openBudgetLedger(plain, root);
  try {
    const handlers = await connect(plain, handle);
    const before = await handlers.getBudget({ runID: null });
    assert.deepEqual([before.available, before.backend, before.monthly], [true, 'local_file', null]);
    assert.equal((await handlers.setBudget({ scope: 'monthly', runID: null, amount: '12.50', revision: 0 })).monthly.revision, 1);
    await assert.rejects(handlers.setBudget({ scope: 'monthly', runID: null, amount: '20', revision: 0 }), { type: 'rejected', message: /stale/i });
    assert.deepEqual((await handlers.getBudget({ runID: null })).monthly, { amount: '12.5', revision: 1 });
  } finally { handle.close(); await rm(root, { recursive: true, force: true }); }
});

// ---- Relay: the settings every project shares, and the panel's test box ----
const relayHigh = { providerID: 'p', id: 'm', variant: 'high' }, relayDeep = { providerID: 'p', id: 'deep', variant: null }, relayJudge = { providerID: 'd', id: 'judge', variant: null };
const noModes = { plan: [], execute: [], review: [] };
const picked = (name: string, value: unknown, confidence: number) => ({ type: 'choice', name, choice: value, probabilities: [], confidence });
/** Two project folders on one host: plugin storage is shared, the chat models are p/m (effort high) and p/deep, and the only decision model is d/judge. */
function relayHost() {
  const data = new Map<string, unknown>(), requests: any[] = [];
  let reply: unknown = { answers: [picked('mode', 'review', 0.97)], cost: 0 };
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async set(key: string, value: unknown) { data.set(key, structuredClone(value)); } };
  const listed = (providerID: string, id: string, variants: string[] = []) => ({ providerID, id, name: id, enabled: true, status: 'active', variants: variants.map(variant => ({ id: variant })), capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 1000, output: 10 }, cost: [{ input: 0.24, output: 0, cache: { read: 0, write: 0 } }], headers: { authorization: 'secret' } });
  const connect = async (directory: string) => {
    let handlers: any;
    await registerInventory({
      location: { directory }, storage, session: {},
      model: { async list(input: { types?: string[] }) { return { data: input.types?.includes('decision') ? [listed('d', 'judge')] : [listed('p', 'm', ['high']), listed('p', 'deep')] }; } },
      experimental: { generate: { async decisions(request: unknown) { requests.push(request); return reply; } } },
      rpc: { async register(_d: unknown, h: unknown) { handlers = asClient(h); return { async dispose() {} }; } },
    } as never);
    return handlers;
  };
  return { storage, requests, connect, answer(next: unknown) { reply = next; } };
}

test('getRelay and saveRelay keep one set of settings for every project, and fit what they declare', async () => {
  const host = relayHost(), one = await host.connect('/one'), two = await host.connect('/two');
  const input = { revision: 0, modes: { ...noModes, review: [{ ...relayHigh, useFor: ' checks  for mistakes ' }, relayDeep] }, decider: relayJudge };
  assert.deepEqual(fits(FeaturePilot.methods.saveRelay.input, input), [], 'what the panel sends fits the declared input');
  const saved = await one.saveRelay(input);
  assert.equal(saved.settings.revision, 1);
  assert.deepEqual(saved.settings.modes.review, [{ ...relayHigh, useFor: 'checks for mistakes' }, { ...relayDeep, useFor: '' }]);
  await recordDecision(host.storage, { at: '2026-11-14T00:00:00.000Z', sessionID: 'ses-1', kind: 'chat', mode: 'review', confidence: 0.97, fit: null, model: 'p/m#high', ms: 150, costUsd: '0', note: null });
  const seen = await two.getRelay({});
  assert.equal(seen.directory, '/two');
  assert.deepEqual(seen.settings, saved.settings);
  assert.deepEqual(seen.deciders.map((model: { providerID: string; id: string; cost: { inputPerMillion: string } }) => `${model.providerID}/${model.id} ${model.cost.inputPerMillion}`), ['d/judge 0.24']);
  assert.deepEqual([seen.checks, seen.decisions.length, seen.decisions[0].model], [{ active: true, note: null }, 1, 'p/m#high']);
  assert.equal(JSON.stringify(seen).includes('secret'), false);
  assert.deepEqual([fits(FeaturePilot.methods.getRelay.output, seen), fits(FeaturePilot.methods.saveRelay.output, saved)], [[], []]);
  await assert.rejects(one.saveRelay({ revision: 0, modes: noModes, decider: null }), { type: 'rejected', message: /stale/i });
  await assert.rejects(one.saveRelay({ revision: 1, modes: noModes, decider: relayHigh }), { type: 'rejected', message: /decision model/i });
  await assert.rejects(one.saveRelay({ revision: 1, modes: { ...noModes, plan: [{ ...relayHigh, useFor: 'x'.repeat(201) }] }, decider: relayJudge }), { type: 'rejected', message: /at most 200 characters/ });
  const cleared = await two.saveRelay({ revision: 1, modes: noModes, decider: null });
  assert.deepEqual([cleared.settings.revision, cleared.checks], [2, { active: false, note: 'no decider chosen' }]);
});

test('testDecider asks the chosen decider once and reports what Relay would do', async () => {
  const host = relayHost(), one = await host.connect('/one');
  await one.saveRelay({ revision: 0, modes: { ...noModes, review: [{ ...relayHigh, useFor: 'checks for mistakes' }, relayDeep] }, decider: relayJudge });
  host.answer({ answers: [picked('mode', 'review', 0.97), picked('review_line', '1', 0.8)], cost: 0 });
  const sure = await one.testDecider({ text: 'check my diff' });
  assert.deepEqual({ ...sure, ms: 0 }, { directory: '/one', mode: 'review', confidence: 0.97, model: 'p/m#high', fit: 0.8, ms: 0, costUsd: '0', note: null });
  assert.deepEqual(fits(FeaturePilot.methods.testDecider.output, sure), []);
  assert.equal(host.requests.length, 1);
  assert.deepEqual(host.requests[0].model, { providerID: 'd', id: 'judge' });
  assert.deepEqual(host.requests[0].questions.map((question: { name: string }) => question.name), ['mode', 'review_line']);
  assert.equal(/p\/m|deep|0\.24/.test(JSON.stringify(host.requests[0])), false, 'the decider is never told a model name or a price');
  host.answer({ answers: [picked('mode', 'execute', 0.4)], cost: 0 });
  const unsure = await one.testDecider({ text: 'hmm' });
  assert.deepEqual({ ...unsure, ms: 0 }, { directory: '/one', mode: 'plan', confidence: 0.4, model: null, fit: null, ms: 0, costUsd: '0', note: 'not sure, so Plan; no model chosen for Plan' });
  host.answer({ answers: [] });
  const silent = await one.testDecider({ text: 'hello' });
  assert.deepEqual({ ...silent, ms: 0 }, { directory: '/one', mode: null, confidence: null, model: null, fit: null, ms: 0, costUsd: null, note: "the decider's answer could not be read" });
  assert.deepEqual([fits(FeaturePilot.methods.testDecider.output, unsure), fits(FeaturePilot.methods.testDecider.output, silent)], [[], []]);
  await assert.rejects(one.testDecider({ text: '  ' }), { type: 'rejected', message: /sample message/i });
  assert.equal(host.requests.length, 3);
  assert.deepEqual((await one.getRelay({})).decisions, [], 'a try in the test box is not recorded');
});
