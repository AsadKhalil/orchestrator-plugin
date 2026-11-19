import { aaFor, type AaModel } from './artificial-analysis.js';
import { formatUsd, parseUsd, pricesAt, usdString } from './costs.js';
import type { ListedModel } from './inventory.js';
import { hostVariant, modelName, type Prices, type Reply } from './relay-store.js';
import type { ChatFacts } from './router.js';

// What Relay reads from a chat's own messages, as `session.context` gives them (OpenCode 2.3.0, seen on an isolated host on 18 Nov 2026).
// No model is asked, and no text of a message is read. The messages come from the host, so every field is checked before it is used.

type Message = {
  id?: unknown; type?: unknown; status?: unknown; cost?: unknown; time?: { created?: unknown; firstToken?: unknown; completed?: unknown };
  model?: { providerID?: unknown; id?: unknown; variant?: unknown }; tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } };
};
const list = (messages: unknown): Message[] => Array.isArray(messages) ? messages.filter(message => message && typeof message === 'object') : [];
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
/**
 * What one answer read and wrote, or null when it carries no counts (an answer that was stopped). The host's `input` leaves out the tokens
 * read from a cache, and tokens written to a cache were read new, so both of those are "fresh".
 */
const counts = (message: Message) => message.type === 'assistant' && message.tokens
  ? { fresh: count(message.tokens.input) + count(message.tokens.cache?.write), cached: count(message.tokens.cache?.read), output: count(message.tokens.output) } : null;

/**
 * What the reply to one message took, or null while it cannot be read: no such message, no answer to it yet, or an answer with no counts.
 * `models` gives the prices of the model that answered. When it lists no price for that model, Artificial Analysis's `borrowed` list does,
 * if it has the model; otherwise the prices are unknown.
 */
export function replyOf(messages: unknown, messageID: string, models: readonly (Pick<ListedModel, 'providerID' | 'id' | 'cost'> & { name?: string })[] | null = null, borrowed: readonly AaModel[] | null = null): Reply | null {
  const all = list(messages), at = all.findIndex(message => message.type === 'user' && message.id === messageID);
  if (at < 0) return null;
  const rest = all.slice(at + 1), next = rest.findIndex(message => message.type === 'user');
  // The host keeps one assistant message for each request to the model (a reply with one tool call gave two, on 2.3.0).
  const answers = (next < 0 ? rest : rest.slice(0, next)).filter(message => message.type === 'assistant'), first = answers[0], read = first && counts(first);
  if (!read) return null;
  const asked = all[at].time?.created, word = first.time?.firstToken;
  const { providerID, id, variant } = first.model ?? {}, named = typeof providerID === 'string' && typeof id === 'string';
  const listed = named ? models?.find(model => model.providerID === providerID && model.id === id) : undefined;
  const add = (pick: (tokens: NonNullable<Message['tokens']>) => unknown) => answers.reduce((sum, answer) => sum + (answer.tokens ? count(pick(answer.tokens)) : 0), 0);
  const costs = answers.map(answer => usdString(answer.cost));
  // shortcut: the prices for the size of the first request. Later requests of a long reply can cross a price step; the host's own cost below counts each request at its own step.
  const prices = listed ? pricesAt(listed.cost, read.fresh + read.cached) : null, own = prices && listedPrice(prices) ? prices : null;
  const effort = hostVariant(typeof variant === 'string' ? variant : undefined);
  // Only a model the list was read for and shows no price at all borrows one: $0 can mean free, and an unread list says nothing.
  const unlisted = models !== null && (!prices || Object.values(prices).every(price => price === null));
  const lent = unlisted && named && borrowed ? aaFor({ providerID, id, name: listed?.name ?? id, variant: effort }, borrowed)?.prices ?? null : null;
  return {
    requests: answers.length, fresh: read.fresh, cached: read.cached, costUsd: usdString(first.cost), seconds: typeof asked === 'number' && typeof word === 'number' && word >= asked ? Math.round((word - asked) / 100) / 10 : null,
    model: named ? modelName({ providerID, id, variant: effort }) : null,
    total: {
      input: add(tokens => tokens.input), output: add(tokens => tokens.output), reasoning: add(tokens => tokens.reasoning), cacheRead: add(tokens => tokens.cache?.read), cacheWrite: add(tokens => tokens.cache?.write),
      costUsd: costs.every((cost): cost is string => cost !== null) ? formatUsd(costs.reduce((sum, cost) => sum + parseUsd(cost), 0n)) : null,
    },
    prices: own ?? lent ?? prices, pricesFrom: own ? 'opencode' : lent ? 'artificial-analysis' : null,
  };
}
/** Whether OpenCode lists a price: $0 for both input and output can mean "not listed". */
const listedPrice = (prices: Prices) => [prices.inputPerMillion, prices.outputPerMillion].some(price => price !== null && price !== '0');

/**
 * The chat's size (what its latest finished answer read and wrote) and each model's latest finished answer, newest first. A finished
 * compaction starts the chat again: nothing is held by any model then, and the size counts as nothing until the next answer. The host
 * lists a compacted chat from the compaction's own entry on (2.3.0); the reset here covers a host that still lists what came before.
 */
export function chatFacts(messages: unknown, now: number): ChatFacts {
  let answered: ChatFacts['answered'] = [];
  for (const message of list(messages)) {
    if (message.type === 'compaction' && message.status === 'completed') { answered = []; continue; }
    const read = counts(message), { created, completed: done } = message.time ?? {}, { providerID, id } = message.model ?? {};
    if (!read || typeof done !== 'number' || typeof providerID !== 'string' || typeof id !== 'string') continue;
    // The age runs from the start of the request, as Anthropic counts a cache's lifetime: the time an answer takes counts against it.
    answered = [{ providerID, id, tokens: read.fresh + read.cached + read.output, agoMs: Math.max(0, now - (typeof created === 'number' ? created : done)) }, ...answered.filter(other => other.providerID !== providerID || other.id !== id)];
  }
  return { tokens: answered[0]?.tokens ?? 0, answered };
}
