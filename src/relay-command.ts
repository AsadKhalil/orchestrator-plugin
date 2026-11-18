import { stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin } from '@opencode/plugin';
import type { PromptInput } from '@opencode/schema/prompt-input';
import type { Session } from '@opencode/schema/session';
import { LATE, within, type DecideInput } from './decider.js';
import type { ListedModel } from './inventory.js';
import { chatFacts } from './chat-facts.js';
import { getRelaySettings, modelName, recentDecisions, recordDecision, setChatSwitch, type Decision, type RelayStore } from './relay-store.js';
import { brief, linesFor, REVIEW_RULES_KEY, reviewRules, route, type DeciderAnswer } from './router.js';
import type { ModelChoice } from './settings.js';

// `/relay <message>` in a normal chat: ask the decider which mode, and which of that mode's models, fit the message; put the chat on that agent and model; send the message.
// The message is sent once and unchanged whatever goes wrong before the send, and the note in the record says what happened.

export type RelayDeps = {
  session: Pick<Plugin.Context['session'], 'get' | 'wait' | 'switchAgent' | 'switchModel' | 'prompt' | 'instructions' | 'context'>;
  store: RelayStore;
  chatModels: () => Promise<ListedModel[]>;
  decide: (decider: ModelChoice | null, input: DecideInput) => Promise<DeciderAnswer>;
  /** A file's size in bytes, or null when it is not a file on this machine. */
  fileSize: (uri: string) => Promise<number | null>;
  /** How long a busy chat is waited for before the message goes out unchanged. Default: two minutes. */
  waitMs?: number;
  /** How long reading one file's size may take. Default: one second. */
  sizeMs?: number;
  /** How long the settings, the chat or the model list may take before Relay gives up on them. Default: five seconds. */
  readMs?: number;
};
type Invocation = { readonly sessionID: Session.ID; readonly prompt: PromptInput.Prompt; readonly delivery: 'steer' | 'queue' };
type AttachedFile = { readonly uri?: string; readonly name?: string };

/**
 * A variant as the host reports it, in a choice's terms. The host names "no variant requested" `default` (seen on 2.2.7, even for a model that has
 * no variants), while a choice uses `null`; compared raw, a chat on its default variant would never match a choice.
 */
// shortcut: a model with a real variant literally named `default` is treated as having none, because the host reports both the same way.
export const hostVariant = (variant: string | null | undefined): string | null => (variant === undefined || variant === 'default' ? null : variant);

const PICTURE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const bare = (uri: string) => uri.replace(/[?#].*$/, '');
/** The host gives no type for an attached file, so a picture is told by its address or its name. */
export function isPicture(file: AttachedFile): boolean {
  const uri = file.uri ?? '';
  return uri.startsWith('data:image/') || PICTURE.test(file.name ?? '') || (!uri.startsWith('data:') && PICTURE.test(bare(uri)));
}
export type Upload = { readonly name: string; readonly mime: string; readonly path: string };
/**
 * Desktop 2.3.0 sends a pasted picture or file as an upload: a line with its path in the text, an entry in the message's metadata, and no
 * file part (seen on 17 Nov). Only well-formed entries count; the metadata comes from the client.
 */
export function uploadsOf(metadata: unknown): Upload[] {
  const list = (metadata as { attachments?: unknown } | null | undefined)?.attachments;
  return Array.isArray(list) ? list.filter((item): item is Upload => !!item && typeof item === 'object' && typeof item.name === 'string' && typeof item.mime === 'string' && typeof item.path === 'string') : [];
}
const isImage = (upload: Upload) => upload.mime.startsWith('image/');

/** What the decider may be told of a file: its name, else its address without what follows a ? or #. Never the content that a `data:` address holds. */
const nameOf = (file: AttachedFile) => file.name ?? (file.uri && !file.uri.startsWith('data:') ? bare(file.uri) : '');

/** The path of a file on this machine, or null. A `file:` address that names another machine is never opened: on Windows that would be a network call. */
export function localPath(uri: string): string | null {
  try { const url = new URL(uri); return url.protocol === 'file:' && !url.host ? fileURLToPath(url) : null; } catch { return null; }
}
export async function fileSize(uri: string): Promise<number | null> {
  const path = localPath(uri);
  return path === null ? null : (await stat(path)).size;
}

export type Timing = { readonly waitMs: number; readonly sizeMs: number; readonly readMs: number };
export type Placed = { outcome: Pick<Decision, 'mode' | 'confidence' | 'fit' | 'model' | 'ms' | 'costUsd'>; notes: string[] };
export const timingOf = (deps: Pick<RelayDeps, 'waitMs' | 'sizeMs' | 'readMs'>): Timing => ({ waitMs: deps.waitMs ?? 120_000, sizeMs: deps.sizeMs ?? 1000, readMs: deps.readMs ?? 5000 });

/**
 * Decides which mode and model fit one message and puts the chat on them. It never throws: what goes wrong becomes a note, and the chat
 * stays as it is from there on. `unsure` is what an answer under 0.6 means; `timing.waitMs` is how long a busy chat is waited for.
 */
export async function placeMessage(deps: RelayDeps, timing: Timing, input: { readonly sessionID: Session.ID; readonly prompt: PromptInput.Prompt; readonly unsure: 'plan' | 'stay'; readonly uploads?: readonly Upload[] }): Promise<Placed> {
  const { sessionID, prompt } = input, { waitMs, sizeMs, readMs } = timing;
  const outcome: Placed['outcome'] = { mode: null, confidence: null, fit: null, model: null, ms: 0, costUsd: null };
  const notes: string[] = [];
  const attempt = async (what: string, work: () => Promise<unknown>): Promise<boolean> => {
    try { await work(); return true; } catch (error) { notes.push(`${what}: ${brief(error)}`); return false; }
  };
  const sized = async (uri: string): Promise<number | null> => {
    try { const bytes = await within(() => deps.fileSize(uri), sizeMs); return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? bytes : null; } catch { return null; }
  };
  /** Null when the chat is idle, else why it cannot be switched now. */
  const idle = async (): Promise<string | null> => {
    try { return await within(() => deps.session.wait({ sessionID }), waitMs) === LATE ? `the chat was still busy after ${waitMs / 1000} seconds` : null; }
    catch (error) { return `could not wait for the chat: ${brief(error)}`; }
  };
  const reading = async <T>(what: string, work: () => Promise<T>): Promise<T> => {
    try { return await work(); } catch (error) { throw new Error(`${what} could not be read: ${brief(error)}`); }
  };
  /** For the cost check only: the chat's messages and Relay's earlier records. Null when they fail or take longer than the other reads may, and then the line is simply followed. */
  const spare = async <T>(work: () => Promise<T>): Promise<T | null> => {
    try { const value = await within(work, Math.min(readMs / 2, 1000)); return value === LATE ? null : value; } catch { return null; }
  };
  const place = async (): Promise<void> => {
    const read = await within(() => Promise.all([
      reading('the settings', () => getRelaySettings(deps.store)), reading('the chat', () => deps.session.get({ sessionID })), reading('the model list', deps.chatModels),
      spare(() => deps.session.context({ sessionID })), spare(() => recentDecisions(deps.store)),
    ]), readMs);
    if (read === LATE) { notes.push(`Relay's settings, the chat or the model list did not answer within ${readMs / 1000} seconds`); return; }
    const [settings, chat, models, messages, past] = read;
    const files: readonly AttachedFile[] = prompt.files ?? [], uploads = input.uploads ?? [];
    const pictures = files.filter(isPicture).length + uploads.filter(isImage).length;
    const facts = await Promise.all([
      ...files.filter(file => !isPicture(file)).map(async file => ({ name: nameOf(file), bytes: file.uri ? await sized(file.uri) : null })),
      ...uploads.filter(upload => !isImage(upload)).map(async upload => ({ name: upload.name, bytes: await sized(pathToFileURL(upload.path).href) })),
    ]);
    // shortcut: four bytes to a token. Dense text takes more, so a file close to a model's size can still be too big for it.
    const attachment = { needsImage: pictures > 0, tokens: Math.ceil(facts.reduce((sum, file) => sum + (file.bytes ?? 0), 0) / 4), chat: messages === null ? null : chatFacts(messages, Date.now()), past: past ?? [] };
    const current = chat.model ? { providerID: chat.model.providerID, id: chat.model.id, variant: hostVariant(chat.model.variant) } : null;
    const answer = await deps.decide(settings.decider, { kind: 'chat', text: prompt.text, agent: chat.agent ?? null, files: facts, images: pictures, lines: linesFor(settings, models, attachment, current) });
    const result = route(answer, settings, models, attachment, current, input.unsure);
    Object.assign(outcome, { mode: result.mode, ms: answer.ms }, answer.kind === 'answer' ? { confidence: answer.confidence, costUsd: answer.costUsd } : {});
    if (result.note !== null) notes.push(result.note);
    if (!result.switch) return;
    const { providerID, id, variant } = result.model;
    const agentChanges = chat.agent !== result.agent;
    const modelChanges = !(current !== null && current.providerID === providerID && current.id === id && current.variant === variant);
    if (agentChanges || modelChanges) {
      // Nothing about a chat is changed while it is working, and nothing needs changing here unless the agent or the model actually differs.
      const busy = await idle();
      if (busy !== null) { notes.push(busy); return; }
    }
    if (agentChanges) await attempt('agent not switched', () => deps.session.switchAgent({ sessionID, agent: result.agent }));
    const on = !modelChanges || await attempt('model not switched', () => deps.session.switchModel({ sessionID, model: { providerID, id, ...(variant === null ? {} : { variant }) } }));
    if (on) Object.assign(outcome, { model: modelName(result.model), fit: result.fit });
    if (result.mode === 'review') await attempt('review rules not set', () => deps.session.instructions.entry.put({ sessionID, key: REVIEW_RULES_KEY, value: reviewRules }));
    // shortcut: a failed remove is not reported. Rules that stay only say how to review, and there may be none to remove.
    else try { await deps.session.instructions.entry.remove({ sessionID, key: REVIEW_RULES_KEY }); } catch { /* see the shortcut above */ }
  };
  try { await place(); } catch (error) { notes.push(brief(error)); }
  return { outcome, notes };
}

/** The record is for the panel; losing it must not fail a message that was sent. `messageID` is the message's id in the chat, when the host gave one. */
export async function recordPlaced(deps: Pick<RelayDeps, 'store'>, sessionID: string, { outcome, notes }: Placed, messageID: string | null = null): Promise<void> {
  try { await recordDecision(deps.store, { at: new Date().toISOString(), sessionID, kind: 'chat', ...outcome, note: notes.length ? notes.join('; ') : null, messageID }); } catch { /* not recorded */ }
}

export function relayCommand(deps: RelayDeps) {
  const timing = timingOf(deps), { readMs } = timing;
  const turns = new Map<string, Promise<void>>();

  async function relay({ sessionID, prompt, delivery }: Invocation): Promise<void> {
    const placed = await placeMessage(deps, timing, { sessionID, prompt, unsure: 'plan' });
    let failure: { error: unknown } | undefined, sent: unknown;
    // The marker tells the hook of a chat whose switch is on that this message is placed already. The host keeps it with the message and does not send it to the model.
    try { sent = await deps.session.prompt({ ...prompt, sessionID, delivery, metadata: { relay: 'sent' } }); } catch (error) { failure = { error }; placed.notes.push(`the message could not be sent: ${brief(error)}`); }
    // The send gives back the new message's entry; its id is the message's id in the chat (seen on 2.3.0, 18 Nov).
    const messageID = (sent as { id?: unknown } | null | undefined)?.id;
    await recordPlaced(deps, sessionID, placed, typeof messageID === 'string' ? messageID : null);
    if (failure) throw failure.error;
  }

  return {
    name: 'relay',
    description: 'Relay: pick the model for this message (plan, execute or review) and send it. /relay on or /relay off: do it for every message in this chat',
    async execute(input: Invocation): Promise<void> {
      if (!input.prompt.text.trim()) throw new Error('Relay: type your message after /relay.');
      const word = input.prompt.text.trim().toLowerCase(), toggle = word === 'on' ? true : word === 'off' ? false : null;
      // One at a time in a chat: the next message waits for this one, whether this one works or not.
      // The queue is joined here, before anything is awaited, so two calls join it in the order they were made, not in the order their own checks happen to answer.
      const turn = (turns.get(input.sessionID) ?? Promise.resolve()).then(async () => {
        if (toggle === null) return relay(input);
        // `/relay on` or `/relay off`: the switch for this chat. Nothing is sent, and nothing is decided.
        if (await within(() => setChatSwitch(deps.store, input.sessionID, toggle), readMs) === LATE) throw new Error(`Relay: the switch could not be saved within ${readMs / 1000} seconds.`);
      });
      const settled = turn.then(() => undefined, () => undefined);
      turns.set(input.sessionID, settled);
      void settled.then(() => { if (turns.get(input.sessionID) === settled) turns.delete(input.sessionID); });
      return turn;
    },
  };
}
