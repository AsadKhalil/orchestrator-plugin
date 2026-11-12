import { FeaturePilot } from './contract.js';
export { FeaturePilot } from './contract.js';
import type { Plugin } from '@opencode/plugin';
import { listProjectModels } from './inventory.js';
import { getSelections, saveSelections, type Roles } from './settings.js';
import { refreshOpenRouterPrices } from './prices.js';
import { fetchIntelligence } from './artificial-analysis.js';
import { createDraft, listDrafts, getDraft, answerDraft, approveDraft, exportDraft } from './drafts.js';
import { readObservedUsage } from './host-usage.js';
import { CasReservationLedger } from './cas-ledger.js';
import type { Schema } from 'effect';


export function registerInventory(context: Pick<Plugin.Context, 'rpc' | 'location' | 'model' | 'storage' | 'session'>) {
  const ledger = () => typeof (context.storage as { compareAndSet?: unknown }).compareAndSet === 'function' ? new CasReservationLedger(context.storage as never) : null;
  const budget = async (runID: string | null) => {
    if (runID !== null) await getDraft(context, runID);
    const instance = ledger();
    if (!instance) return { directory: context.location.directory, available: false, period: null, monthly: null, feature: null, monthlyUsage: null, featureUsage: null };
    return { directory: context.location.directory, available: true, ...await instance.report(runID) };
  };
  return context.rpc.register(FeaturePilot, {
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
    createDraft: async input => ({ directory: context.location.directory, run: await createDraft(context, (input as { requirement: string }).requirement) }),
    listDrafts: async () => ({ directory: context.location.directory, runs: await listDrafts(context) }),
    observedUsage: async input => {
      const value = input as { month: string; timeZone: string };
      return { directory: context.location.directory, ...await readObservedUsage(context, value.month, value.timeZone) };
    },
    listModels: async () => ({ directory: context.location.directory, models: await listProjectModels(context) }),
    refreshPrices: async () => ({ directory: context.location.directory, ...await refreshOpenRouterPrices({ get: () => context.storage.get('openrouter-price-cache'), set: value => context.storage.set('openrouter-price-cache', value as unknown as Schema.Json) }, fetch, new Date().toISOString(), true) }),
    getSelections: async () => ({ directory: context.location.directory, settings: await getSelections(context.storage, context.location.directory) }),
    saveSelections: async input => {
      const value = input as { revision: number; roles: Roles };
      return { directory: context.location.directory, settings: await saveSelections(context.storage, context.location.directory, value.revision, value.roles, await listProjectModels(context)) };
    },
  });
}
