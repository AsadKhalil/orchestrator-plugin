import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerInventory } from '../src/rpc.js';
import { newRun } from '../src/run.js';

test('budget settings require atomic storage and reject stale revisions', async () => {
  let handlers: any; const data = new Map<string, unknown>();
  const storage = { async get(key: string) { return structuredClone(data.get(key)); }, async compareAndSet(key: string, previous: unknown, next: unknown) { if (JSON.stringify(data.get(key)) !== JSON.stringify(previous)) return false; data.set(key, structuredClone(next)); return true; } };
  const context = { location: { directory: '/repo' }, storage, model: {}, session: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = h; return { async dispose() {} }; } } };
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
    rpc: { async register(_definition: unknown, handlers: { listModels: () => Promise<unknown> }) { handler = handlers.listModels; return { async dispose() {} }; } },
  };
  await registerInventory(ctx as never);
  assert.ok(handler);
  const result = await handler();
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('hidden'), false);
  assert.equal((result as any).directory, '/repo');
  assert.equal((result as any).models[0].id, 'm');
});

test('settings RPC saves only available project routes and rejects stale edits', async () => {
  let handlers: any;
  const data = new Map<string, unknown>();
  const context = {
    location: { directory: '/repo' },
    storage: { async get(k: string) { return data.get(k); }, async set(k: string, v: unknown) { data.set(k, v); } },
    model: { async list() { return { data: [{ providerID: 'p', id: 'm', name: 'Model', enabled: true, status: 'active', variants: [{ id: 'high' }], capabilities: { input: ['text'], output: ['text'], tools: true }, limit: { context: 100, output: 10 } }] }; } },
    rpc: { async register(_d: unknown, h: unknown) { handlers = h; return { async dispose() {} }; } },
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
  const context = { location: { directory: '/repo' }, storage: { async get(k: string) { return records.get(k); }, async set(k: string, v: unknown) { records.set(k, v); } }, model: {}, rpc: { async register(_d: unknown, h: unknown) { handlers = h; return { async dispose() {} }; } } };
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
  const context = { location: { directory: '/repo' }, storage: { async scan() { return { entries: [{key:'owned-session/ses_1',value:'r'}] }; }, async get() { return 'coder'; } }, session: { async get() { return { location: { directory: '/repo' } }; }, async context() { return [{type:'assistant',id:'msg_1',model:{providerID:'p',id:'m'},time:{created:Date.parse('2026-01-02T00:00:00Z')},cost:0.12,content:[{type:'text',text:'private code'}]}]; } }, model: {}, rpc: { async register(_d: unknown, h: unknown) { handlers=h;return { async dispose() {} }; } } };
  await registerInventory(context as never);
  const result = await handlers.observedUsage({ month:'2026-01', timeZone:'UTC' });
  assert.equal(result.directory, '/repo'); assert.equal(result.coverage.complete, false);
  assert.equal(result.summary.total.gross.knownUsd, '0.12');
  assert.equal(JSON.stringify(result).includes('private code'), false);
});

test('intelligence RPC does not expose credentials or upstream errors', async () => {
  let handlers:any; const context={location:{directory:'/repo'},storage:{},model:{},rpc:{async register(_d:unknown,h:unknown){handlers=h;return {async dispose(){}};}}};
  const originalFetch=globalThis.fetch, old=process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  process.env.ARTIFICIAL_ANALYSIS_API_KEY='synthetic-secret';
  globalThis.fetch=(async()=>{throw new Error('upstream synthetic-secret');}) as typeof fetch;
  try {await registerInventory(context as never);await assert.rejects(handlers.listIntelligence({}),error=>error instanceof Error && !error.message.includes('synthetic-secret'));}
  finally {globalThis.fetch=originalFetch;if(old===undefined)delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;else process.env.ARTIFICIAL_ANALYSIS_API_KEY=old;}
});
