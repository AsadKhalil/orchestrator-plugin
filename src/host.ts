import { createHash } from 'node:crypto';

/** A stage is prepared with all tools denied until host permissions are verified. */
type ModelRef = { providerID: string; id: string; variant?: string };
type Stage = { runID: string; role: 'planner' | 'coder' | 'reviewer'; model: ModelRef };
type CreateInput = {
  title: string;
  model: ModelRef;
  metadata: { featurePilotRunID: string; featurePilotRole: Stage['role'] };
  permissions: { action: string; resource: string; effect: 'deny' }[];
};

type InventoryModel = { providerID: string; id: string; enabled: boolean; status: string; variants: readonly string[] };
type HostContext = { listModels(): Promise<readonly InventoryModel[]>; session: { create(input: CreateInput): Promise<{ id: string }>; get?(input: { sessionID: string }): Promise<{ outcome?: 'succeeded' | 'failed' | 'interrupted'; model?: ModelRef }>; context?(input: { sessionID: string }): ReturnType<Plugin.Context['session']['context']>; prompt?(input: { sessionID: string; id: string; text: string; delivery: 'queue' }): Promise<unknown>; wait?(input: { sessionID: string }): Promise<void>; interrupt?(input: { sessionID: string; resume: false }): Promise<{ interrupted: boolean }> }; storage: { set(key: string, value: string): Promise<void>; get(key: string): Promise<unknown>; compareAndSet?(key: string, expected: undefined, value: string): Promise<boolean> } };

const ownershipKey = (id: string) => `owned-session/${encodeURIComponent(id)}`;
const roleKey = (id: string) => `owned-role/${encodeURIComponent(id)}`;
const modelKey = (id: string) => `owned-model/${encodeURIComponent(id)}`;
const promptKey = (id: string) => `prompt-intent/${encodeURIComponent(id)}`;
// shortcut: this serializes only this loaded module; add host-wide locking before dispatch is enabled.
let promptQueue: Promise<void> = Promise.resolve();

export function createHost(context: HostContext, onOwned?: (id: string, role: Stage['role']) => void) {
  return {
    async prepareStage(stage: Stage): Promise<string> {
      if (!stage.runID.trim() || !stage.model.providerID.trim() || !stage.model.id.trim()) {
        throw new Error('A run ID and valid provider/model are required');
      }
      if (!['planner', 'coder', 'reviewer'].includes(stage.role)) throw new Error('Invalid stage role');
      const models = await context.listModels();
      const model = models.find(item => item.providerID === stage.model.providerID && item.id === stage.model.id);
      if (!model || !model.enabled || model.status === 'deprecated') throw new Error('Selected model is unavailable');
      if (stage.model.variant !== undefined && !model.variants.includes(stage.model.variant)) throw new Error('Selected model variant is unavailable');
      const session = await context.session.create({
        title: `Feature Pilot: ${stage.role}`,
        model: stage.model,
        metadata: { featurePilotRunID: stage.runID, featurePilotRole: stage.role },
        permissions: [{ action: '*', resource: '*', effect: 'deny' }],
      });
      if (!session.id) throw new Error('Host returned an empty session ID');
      // If this fails, no prompt has been sent; the orphan is never treated as owned.
      await context.storage.set(roleKey(session.id), stage.role);
      await context.storage.set(modelKey(session.id), JSON.stringify(stage.model));
      await context.storage.set(ownershipKey(session.id), stage.runID);
      onOwned?.(session.id, stage.role);
      return session.id;
    },
    async roleForSession(sessionID: string): Promise<Stage['role'] | 'unknown' | null> {
      if (!sessionID) return null;
      const owner = await context.storage.get(ownershipKey(sessionID));
      if (owner === undefined) return null;
      const role = await context.storage.get(roleKey(sessionID));
      if (typeof owner !== 'string' || !owner || (role !== 'planner' && role !== 'coder' && role !== 'reviewer')) return 'unknown';
      return role;
    },
    async stageModels(sessionID: string, runID: string) {
      if (!sessionID || !runID || (await context.storage.get(ownershipKey(sessionID))) !== runID) throw new Error('Session is not owned by this run');
      const raw = await context.storage.get(modelKey(sessionID));
      if (typeof raw !== 'string') throw new Error('Stage model is missing');
      let expected: ModelRef;
      try { expected = JSON.parse(raw); } catch { throw new Error('Invalid stage model'); }
      if (!expected || typeof expected.providerID !== 'string' || !expected.providerID.trim() || typeof expected.id !== 'string' || !expected.id.trim() || (expected.variant !== undefined && (typeof expected.variant !== 'string' || !expected.variant.trim()))) throw new Error('Invalid stage model');
      if (!context.session.get) throw new Error('Host session model is unavailable');
      return { expected, current: (await context.session.get({ sessionID })).model };
    },
    async submitStagePrompt(sessionID: string, runID: string, promptID: string, text: string) {
      if (!sessionID || !runID || (await context.storage.get(ownershipKey(sessionID))) !== runID) throw new Error('Session is not owned by this run');
      if (!promptID.startsWith('msg_') || promptID.length <= 4 || !text.trim()) throw new Error('A prompt ID and text are required');
      if (!context.session.prompt) throw new Error('Host prompting is unavailable');
      const record = JSON.stringify({ runID, sessionID, textHash: createHash('sha256').update(text).digest('hex') });
      const storage = context.storage;
      const write = promptQueue.then(async () => {
        if (typeof storage.compareAndSet === 'function') {
          const created = await storage.compareAndSet(promptKey(promptID), undefined, record);
          if (created === false) throw new Error('Prompt already recorded; reconciliation required');
          if (created !== true) throw new Error('Invalid compare-and-set response');
          return;
        }
        if (await storage.get(promptKey(promptID)) !== undefined) throw new Error('Prompt already recorded; reconciliation required');
        await storage.set(promptKey(promptID), record);
      });
      promptQueue = write.then(() => undefined, () => undefined);
      await write;
      return context.session.prompt({ sessionID, id: promptID, text, delivery: 'queue' });
    },
    async ownsPrompt(sessionID: string, runID: string, promptID: string, text: string): Promise<boolean> {
      if (!sessionID || !runID || !promptID || typeof text !== 'string' || (await context.storage.get(ownershipKey(sessionID))) !== runID) return false;
      const raw = await context.storage.get(promptKey(promptID));
      if (typeof raw !== 'string') return false;
      try { const record = JSON.parse(raw); return record.runID === runID && record.sessionID === sessionID && typeof record.textHash === 'string' && record.textHash === createHash('sha256').update(text).digest('hex'); } catch { return false; }
    },
    async waitStage(sessionID: string, runID: string) {
      if (!sessionID || !runID || (await context.storage.get(ownershipKey(sessionID))) !== runID) throw new Error('Session is not owned by this run');
      if (!context.session.wait) throw new Error('Host waiting is unavailable');
      return context.session.wait({ sessionID });
    },
    async readStage(sessionID: string, runID: string) {
      if (!sessionID || !runID || (await context.storage.get(ownershipKey(sessionID))) !== runID) throw new Error('Session is not owned by this run');
      if (!context.session.get || !context.session.context) throw new Error('Host stage reading is unavailable');
      const session = await context.session.get({ sessionID });
      const messages = await context.session.context({ sessionID });
      return { outcome: session.outcome, messages };
    },
    async interrupt(sessionID: string, runID: string): Promise<{ interrupted: boolean }> {
      if (!sessionID || !runID || (await context.storage.get(ownershipKey(sessionID))) !== runID) {
        throw new Error('Session is not owned by this run');
      }
      if (!context.session.interrupt) throw new Error('Host interrupt is unavailable');
      return context.session.interrupt({ sessionID, resume: false });
    },
    async ownsSession(sessionID: string, runID: string): Promise<boolean> {
      if (!sessionID || !runID) return false;
      return (await context.storage.get(ownershipKey(sessionID))) === runID;
    },
  };
}

import { Model, type Plugin } from '@opencode/plugin';
import { Schema } from 'effect';
import { Session } from '@opencode/schema/session';
import { listProjectModels } from './inventory.js';

/** Connects the narrow stage adapter to OpenCode's branded session API. */
export function createOpenCodeHost(context: Pick<Plugin.Context, 'session' | 'storage' | 'location' | 'model'>, onOwned?: (id: string, role: Stage['role']) => void) {
  return createHost({
    storage: context.storage,
    listModels: () => listProjectModels(context),
    session: {
      async prompt(input) { return context.session.prompt({ ...input, sessionID: Schema.decodeUnknownSync(Session.ID)(input.sessionID) }); },
      async wait(input) { return context.session.wait({ sessionID: Schema.decodeUnknownSync(Session.ID)(input.sessionID) }); },
      async get(input) { return context.session.get({ sessionID: Schema.decodeUnknownSync(Session.ID)(input.sessionID) }); },
      async context(input) { return context.session.context({ sessionID: Schema.decodeUnknownSync(Session.ID)(input.sessionID) }); },
      async interrupt(input) {
        return context.session.interrupt({ ...input, sessionID: Schema.decodeUnknownSync(Session.ID)(input.sessionID) });
      },
      async create(input) {
        return context.session.create({ ...input, model: Schema.decodeUnknownSync(Model.Ref)(input.model) });
      },
    },
  }, onOwned);
}
