import { FeaturePilot } from './contract.js';
export { FeaturePilot } from './contract.js';
import type { Plugin } from '@opencode/plugin';
import { listProjectModels } from './inventory.js';
import { describeError } from './gui-model.js';
import { getPolicy, getSelections, savePolicy, saveSelections, type Roles } from './settings.js';
import { refreshOpenRouterPrices } from './prices.js';
import { fetchIntelligence } from './artificial-analysis.js';
import { createDraft, listDrafts, getDraft, answerDraft, approveDraft, acceptDraft, resumeDraft, exportDraft } from './drafts.js';
import { readObservedUsage } from './host-usage.js';
import { hostBudget, type BudgetHandle } from './budget-ledger.js';
import { budgetOpen } from './spending.js';
import { loadCatalog, type Quality, type Workload } from './catalog.js';
import { recommendRoutes } from './recommendation.js';
import { contributorsKey } from './host-ports.js';
import { getDelivery, saveDelivery } from './delivery-settings.js';
import { deliverDraft } from './deliver-draft.js';
import { projectRepository } from './drafts.js';
import type { Exec } from './worktree.js';
import type { createDriver } from './driver.js';
import type { Schema } from 'effect';


/** `driver` is created on first use; without it the panel can record drafts but not run them. */
export function registerInventory(context: Pick<Plugin.Context, 'rpc' | 'location' | 'model' | 'storage' | 'session'>, runner?: { driver(): ReturnType<typeof createDriver>; exec?: Exec }, budgetHandle?: BudgetHandle) {
  const handle = budgetHandle ?? hostBudget(context.storage), ledger = () => handle.ledger;
  const budget = async (runID: string | null) => {
    if (runID !== null) await getDraft(context, runID);
    const instance = ledger();
    if (!instance) return { directory: context.location.directory, available: false, backend: null, period: null, monthly: null, feature: null, monthlyUsage: null, featureUsage: null };
    return { directory: context.location.directory, available: true, backend: handle.backend, ...await instance.report(runID) };
  };
  const reservations = async (runID: string) => {
    await getDraft(context, runID);
    const instance = ledger(); if (!instance) throw new Error('Atomic host storage required');
    // Unsettled reservations come first so they can always be found and settled, however long the run was.
    const all = await instance.reservations(runID), open = all.filter(item => item.settledUsd === null), closed = all.filter(item => item.settledUsd !== null);
    return { directory: context.location.directory, reservations: [...open.slice(0, 200), ...closed.slice(-Math.max(0, 200 - open.length))].map(item => ({ attemptID: item.attemptID, period: item.period, reservedUsd: item.reservedUsd, settledUsd: item.settledUsd, evidenceKind: item.evidence?.kind ?? null, evidenceReference: item.evidence?.reference ?? null })) };
  };
  return context.rpc.register(FeaturePilot, guarded({
    getBudget: async input => budget((input as { runID: string | null }).runID),
    setBudget: async input => {
      const value = input as { scope: 'monthly' | 'feature'; runID: string | null; amount: string; revision: number };
      if (value.runID !== null) await getDraft(context, value.runID);
      if (value.scope === 'feature' && value.runID === null) throw new Error('Select a run');
      const instance = ledger(); if (!instance) throw new Error('Atomic host storage required');
      await instance.setLimit(value.scope, value.scope === 'feature' ? value.runID! : undefined, value.amount, value.revision);
      return budget(value.runID);
    },
    listIntelligence: async () => { try { return { directory: context.location.directory, ...await fetchIntelligence(process.env.ARTIFICIAL_ANALYSIS_API_KEY) }; } catch { throw new Error('Artificial Analysis data unavailable; check server configuration and API access'); } },
    exportDraft: async input => ({ directory: context.location.directory, preview: await exportDraft(context, (input as { id: string; revision: number }).id, (input as { id: string; revision: number }).revision) }),
    getDraft: async input => ({ directory: context.location.directory, run: await getDraft(context, (input as { id: string }).id) }),
    answerDraft: async input => { const value = input as { id: string; revision: number; answers: { id: string; answer: string }[] }; return { directory: context.location.directory, run: await answerDraft(context, value.id, value.revision, value.answers) }; },
    approveDraft: async input => { const value = input as { id: string; revision: number; planHash: string }; return { directory: context.location.directory, run: await approveDraft(context, value.id, value.revision, value.planHash) }; },
    driveDraft: async input => {
      const value = input as { id: string; autonomous: boolean };
      if (!runner) throw new Error('Run execution is not available');
      await getDraft(context, value.id);
      // Autonomous progression needs atomic budgets for the month and this feature; supervised runs are bounded by per-request reservations anyway.
      if (value.autonomous && !await budgetOpen(ledger(), value.id)) throw new Error('Autonomous runs need atomic monthly and feature budgets with budget remaining');
      const started = runner.driver().start(value.id, value.autonomous);
      return { directory: context.location.directory, started, run: await getDraft(context, value.id) };
    },
    stopDraft: async input => {
      const value = input as { id: string; revision: number };
      if (!runner) throw new Error('Run execution is not available');
      await getDraft(context, value.id);
      await runner.driver().stop(value.id, value.revision);
      return { directory: context.location.directory, run: await getDraft(context, value.id) };
    },
    acceptDraft: async input => { const value = input as { id: string; revision: number }; return { directory: context.location.directory, run: await acceptDraft(context, value.id, value.revision) }; },
    resumeDraft: async input => { const value = input as { id: string; revision: number }; return { directory: context.location.directory, run: await resumeDraft(context, value.id, value.revision) }; },
    createDraft: async input => ({ directory: context.location.directory, run: await createDraft(context, (input as { requirement: string }).requirement) }),
    listDrafts: async () => ({ directory: context.location.directory, runs: await listDrafts(context) }),
    observedUsage: async input => {
      const value = input as { month: string; timeZone: string };
      return { directory: context.location.directory, ...await readObservedUsage(context, value.month, value.timeZone) };
    },
    listModels: async () => ({ directory: context.location.directory, models: await listProjectModels(context) }),
    refreshPrices: async () => ({ directory: context.location.directory, ...await refreshOpenRouterPrices({ get: () => context.storage.get('openrouter-price-cache'), set: value => context.storage.set('openrouter-price-cache', value as unknown as Schema.Json) }, fetch, new Date().toISOString(), true) }),
    recommendRoutes: async input => {
      const value = input as { role: 'planner' | 'coder' | 'reviewer'; runID: string | null; minimumScore: number; indexVersion: string; scores: Quality[]; workload: Workload; remainingBudget: string; needs: { image: boolean; tools: boolean } };
      const [inventory, settings, policy] = await Promise.all([listProjectModels(context), getSelections(context.storage, context.location.directory), getPolicy(context.storage, context.location.directory)]);
      const now = new Date().toISOString();
      let excludedVendors: string[] = [];
      if (value.role === 'reviewer' && value.runID !== null) { await getDraft(context, value.runID); const recorded = await context.storage.get(contributorsKey(value.runID)); excludedVendors = typeof recorded === 'string' ? JSON.parse(recorded) : []; }
      const result = recommendRoutes(await loadCatalog({ listModels: async () => inventory }, policy, now), inventory, { ...value, selected: settings.roles[value.role], maxOutputTokens: policy.maxOutputTokens, excludedVendors, now });
      const view = (item: NonNullable<typeof result.selected>) => ({ providerID: item.providerID, id: item.id, variant: item.variant, vendor: item.vendor, estimatedCash: item.estimatedCash, reservationGross: item.reservationGross, priceVerified: item.priceVerified, score: item.quality?.value ?? null });
      return { directory: context.location.directory, snapshotID: result.snapshotID, selectionRevision: settings.revision, selected: result.selected ? view(result.selected) : null, alternatives: result.alternatives.map(view), excluded: result.excluded };
    },
    listReservations: async input => reservations((input as { runID: string }).runID),
    settleReservation: async input => {
      const value = input as { runID: string; attemptID: string; kind: 'provider_gross_charge' | 'confirmed_not_dispatched'; actualUsd: string; reference: string };
      await getDraft(context, value.runID);
      const instance = ledger(); if (!instance) throw new Error('Atomic host storage required');
      // Only the provider's own charge record (or proof nothing was sent) may release a reservation; the host's cost estimates never do.
      if (!(await instance.reservations(value.runID)).some(item => item.attemptID === value.attemptID)) throw new Error('Reservation not found for this run');
      await instance.reconcile(value.attemptID, value.kind === 'confirmed_not_dispatched' ? '0' : value.actualUsd, { kind: value.kind, reference: value.reference });
      return reservations(value.runID);
    },
    getDelivery: async () => ({ directory: context.location.directory, delivery: await getDelivery(context.storage, context.location.directory) }),
    saveDelivery: async input => {
      const value = input as { revision: number; publicationEnabled: boolean; github: unknown };
      return { directory: context.location.directory, delivery: await saveDelivery(context.storage as never, context.location.directory, value.revision, { publicationEnabled: value.publicationEnabled, github: value.github }) };
    },
    deliverDraft: async input => {
      const value = input as { id: string; revision: number; target: 'local' | 'github' };
      await getDraft(context, value.id);
      const result = await deliverDraft({ directory: context.location.directory, store: context.storage as never, repo: projectRepository(context), exec: runner?.exec }, value.id, value.revision, value.target);
      return { directory: context.location.directory, ...result, run: await getDraft(context, value.id) };
    },
    getPolicy: async () => ({ directory: context.location.directory, policy: await getPolicy(context.storage, context.location.directory) }),
    savePolicy: async input => {
      const value = input as { revision: number; maxOutputTokens: number; coderEnabled: boolean; routes: unknown };
      return { directory: context.location.directory, policy: await savePolicy(context.storage as never, context.location.directory, value.revision, { maxOutputTokens: value.maxOutputTokens, coderEnabled: value.coderEnabled, routes: value.routes }) };
    },
    getSelections: async () => ({ directory: context.location.directory, settings: await getSelections(context.storage, context.location.directory) }),
    saveSelections: async input => {
      const value = input as { revision: number; roles: Roles };
      return { directory: context.location.directory, settings: await saveSelections(context.storage, context.location.directory, value.revision, value.roles, await listProjectModels(context)) };
    },
  }));
}

type Call = { error: (type: 'rejected', message: string, data: unknown) => unknown };
/** A handler that throws reaches the client as "RPC call failed" in the real host; return its message as the declared 'rejected' error so the panel can show it. */
function guarded<H>(handlers: H): H {
  return Object.fromEntries(Object.entries(handlers as Record<string, (input: unknown, call: Call) => Promise<unknown>>).map(([name, handler]) => [name, async (input: unknown, call: Call) => {
    try { return await handler(input, call); } catch (error) { return call.error('rejected', describeError(error, 'The request failed.').slice(0, 500), {}); }
  }])) as H;
}

