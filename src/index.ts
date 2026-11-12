import { Plugin } from '@opencode/plugin';
import type { Session } from '@opencode/schema/session';
import { createOpenCodeHost } from './host.js';
import { restrictRoleAction } from './permissions.js';
import { registerInventory } from './rpc.js';
import { getSelections } from './settings.js';
import { listProjectModels } from './inventory.js';

type Role = 'planner' | 'coder' | 'reviewer' | 'unknown';
const prefix = 'owned-session/';

export async function createRuntime(context: Plugin.Context) {
    const roles = new Map<string, Role>();
    let after: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await context.storage.scan({ prefix, after });
      for (const entry of page.entries) {
        if (!entry.key.startsWith(prefix)) throw new Error('Invalid ownership storage key');
        const id = decodeURIComponent(entry.key.slice(prefix.length));
        if (!id) throw new Error('Invalid owned session ID');
        const role = await context.storage.get(`owned-role/${encodeURIComponent(id)}`);
        roles.set(id, typeof entry.value === 'string' && entry.value && (role === 'planner' || role === 'coder' || role === 'reviewer') ? role : 'unknown');
      }
      if (page.next && cursors.has(page.next)) throw new Error('Invalid ownership scan cursor');
      if (page.next) cursors.add(page.next);
      after = page.next;
    } while (after);
    // A second runtime can create a session after this instance scans storage.
    const roleFor = async (sessionID: string): Promise<Role | null> => {
      const cached = roles.get(sessionID); if (cached) return cached;
      let storageError: unknown;
      try {
        const owner = await context.storage.get(`${prefix}${encodeURIComponent(sessionID)}`);
        if (owner !== undefined) {
          const storedRole = await context.storage.get(`owned-role/${encodeURIComponent(sessionID)}`);
          const value: Role = typeof owner === 'string' && owner.trim() && (storedRole === 'planner' || storedRole === 'coder' || storedRole === 'reviewer') ? storedRole : 'unknown';
          roles.set(sessionID, value); return value;
        }
      } catch (error) { storageError = error; }
      const session = await context.session.get({ sessionID: sessionID as Session.ID });
      const metadata = session.metadata;
      if (!metadata || !Object.hasOwn(metadata, 'featurePilotRunID')) {
        if (storageError) throw storageError;
        return null;
      }
      const role = metadata.featurePilotRole;
      const value: Role = typeof metadata.featurePilotRunID === 'string' && metadata.featurePilotRunID.trim() && (role === 'planner' || role === 'coder' || role === 'reviewer') ? role : 'unknown';
      roles.set(sessionID, value); return value;
    };
    // Run operations share this adapter so new sessions enter the cache before prompts.
    const adapter = createOpenCodeHost(context, (id, role) => roles.set(id, role));
    const host = { ...adapter, async prepareStage(stage: Parameters<typeof adapter.prepareStage>[0]) {
      if (!['planner', 'coder', 'reviewer'].includes(stage.role)) throw new Error('Invalid stage role');
      const settings = await getSelections(context.storage, context.location.directory);
      if (!settings.roles[stage.role].some(choice => choice.providerID === stage.model.providerID && choice.id === stage.model.id && choice.variant === (stage.model.variant ?? null))) throw new Error('Model is not selected for this role');
      return adapter.prepareStage(stage);
    }, async submitStagePrompt(sessionID: string, runID: string, promptID: string, text: string) {
      const role = await adapter.roleForSession(sessionID);
      const { expected, current } = await adapter.stageModels(sessionID, runID);
      if (!current || current.providerID !== expected.providerID || current.id !== expected.id || (current.variant ?? null) !== (expected.variant ?? null)) throw new Error('Stage model changed; review required');
      if (!role || role === 'unknown') throw new Error('Stage role is unknown');
      const [settings, inventory] = await Promise.all([getSelections(context.storage, context.location.directory), listProjectModels(context)]);
      if (!settings.roles[role].some(choice => choice.providerID === expected.providerID && choice.id === expected.id && choice.variant === (expected.variant ?? null))) throw new Error('Model is not selected for this role');
      const model = inventory.find(item => item.providerID === expected.providerID && item.id === expected.id);
      if (!model || !model.enabled || model.status === 'deprecated' || (expected.variant !== undefined && !model.variants.includes(expected.variant))) throw new Error('Stage model is unavailable');
      return adapter.submitStagePrompt(sessionID, runID, promptID, text);
    } };
    const registration = await context.permission.hook('evaluate', async (event) => {
      await restrictRoleAction(event, roleFor);
    });
    let requestGuard;
    try {
      requestGuard = await context.session.hook('experimental.model.resolve', async (event) => {
        if (await roleFor(event.sessionID) !== null) throw new Error('Feature Pilot spending controls are not ready');
      });
    } catch (error) {
      await registration.dispose();
      throw error;
    }
    let inventory;
    try { inventory = await registerInventory(context); }
    catch (error) {
      try { await requestGuard.dispose(); } finally { await registration.dispose(); }
      throw error;
    }
    return { host, async dispose() {
      try { await inventory.dispose(); } finally {
        try { await requestGuard.dispose(); } finally { await registration.dispose(); }
      }
    } }; 
}

export default Plugin.define({
  id: 'feature-pilot',
  async setup(context) {
    const runtime = await createRuntime(context);
    return () => runtime.dispose();
  },
});
