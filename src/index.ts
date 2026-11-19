import { Plugin } from '@opencode/plugin';
import { registerRpc } from './rpc.js';
import { listProjectModels } from './inventory.js';
import { relayCommand, fileSize, type RelayDeps } from './relay-command.js';
import { reviewHelperHook } from './review-helper.js';
import { relayAutoHook, relayReplyHook } from './relay-auto.js';
import { decide } from './decider.js';
import { storedAaModels } from './artificial-analysis.js';
import type { RelayStore } from './relay-store.js';

export async function createRuntime(context: Plugin.Context) {
  const disposers: (() => Promise<void>)[] = [];
  const dispose = async () => {
    let failure: unknown;
    for (const undo of disposers.reverse()) { try { await undo(); } catch (error) { failure ??= error; } }
    if (failure) throw failure;
  };
  try {
    const relayDeps: RelayDeps = {
      session: context.session, store: context.storage as unknown as RelayStore, chatModels: () => listProjectModels(context), fileSize,
      decide: (decider, input) => decide({ decisions: request => context.experimental.generate.decisions(request as never) }, decider, input),
    };
    // `/relay` in a chat. The host runs the callback again whenever it rebuilds its commands, so the command (and its per-chat queue) is made once.
    const relay = relayCommand(relayDeps);
    const command = await context.command.transform(editor => editor.add(relay));
    disposers.push(() => command.dispose());
    // A helper whose task is a check of work starts on a Review model. The hook sees every tool call and leaves all others alone.
    const helper = await context.tool.hook('execute.before', reviewHelperHook(relayDeps));
    disposers.push(() => helper.dispose());
    // The switch: in a chat where `/relay on` turned it on, every message is placed before it goes out. The hook sees every message and never throws.
    const auto = await context.session.hook('prompt', relayAutoHook(relayDeps));
    disposers.push(() => auto.dispose());
    // When a chat has finished its work, what the reply to a placed message took is read from the chat and kept with its record. No model is asked.
    const replies = await context.session.hook('experimental.idle', relayReplyHook({ ...relayDeps, borrowedPrices: () => storedAaModels(context.storage) }));
    disposers.push(() => replies.dispose());
    const rpc = await registerRpc(context);
    disposers.push(() => rpc.dispose());
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
  return { dispose };
}

export default Plugin.define({
  id: 'relay-opencode',
  async setup(context) {
    const runtime = await createRuntime(context);
    return () => runtime.dispose();
  },
});
