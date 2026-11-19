import { Rpc } from '@opencode/plugin/rpc';

const choice = { type: 'object', properties: { providerID: { type: 'string' }, id: { type: 'string' }, variant: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['providerID', 'id', 'variant'], additionalProperties: false } as const;
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
const prices = { inputPerMillion: nullableString, outputPerMillion: nullableString, cacheReadPerMillion: nullableString, cacheWritePerMillion: nullableString } as const;
const priceNames = ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion'] as const;
/** One model as the panel sees it: display fields only, never the host's record. Prices are USD for one million tokens; null is unknown. `steps` are the prices for chats over a size. */
const modelItem = {
  type: 'object', properties: {
    providerID: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, enabled: { type: 'boolean' }, status: { type: 'string' },
    variants: { type: 'array', items: { type: 'string' } },
    capabilities: { type: 'object', properties: { input: { type: 'array', items: { type: 'string' } }, output: { type: 'array', items: { type: 'string' } }, tools: { type: 'boolean' } }, required: ['input', 'output', 'tools'], additionalProperties: false },
    limit: { type: 'object', properties: { context: { type: 'number' }, output: { type: 'number' } }, required: ['context', 'output'], additionalProperties: false },
    cost: { type: 'object', properties: { ...prices, tiered: { type: 'boolean' }, steps: { type: 'array', items: { type: 'object', properties: { above: { type: 'number' }, ...prices }, required: ['above', ...priceNames], additionalProperties: false } } }, required: [...priceNames, 'tiered', 'steps'], additionalProperties: false },
  }, required: ['providerID', 'id', 'name', 'enabled', 'status', 'variants', 'capabilities', 'limit', 'cost'], additionalProperties: false,
} as const;
// One set of settings for every project (the host shares plugin storage), the last decisions, and the panel's test box.
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] } as const;
const nullableMode = { anyOf: [{ type: 'string', enum: ['plan', 'execute', 'review'] }, { type: 'null' }] } as const;
const nullableChoice = { anyOf: [choice, { type: 'null' }] } as const;
/** A model chosen for a mode, with the person's "use it for" line. The line is optional in what the panel sends and always present in what comes back. */
const modeChoice = { type: 'object', properties: { ...choice.properties, useFor: { type: 'string' } }, required: ['providerID', 'id', 'variant', 'useFor'], additionalProperties: false } as const;
const modeChoiceInput = { type: 'object', properties: { ...choice.properties, useFor: { type: 'string' } }, required: ['providerID', 'id', 'variant'], additionalProperties: false } as const;
const modeLists = { type: 'object', properties: { plan: { type: 'array', items: modeChoice }, execute: { type: 'array', items: modeChoice }, review: { type: 'array', items: modeChoice } }, required: ['plan', 'execute', 'review'], additionalProperties: false } as const;
const modeListsInput = { type: 'object', properties: { plan: { type: 'array', items: modeChoiceInput }, execute: { type: 'array', items: modeChoiceInput }, review: { type: 'array', items: modeChoiceInput } }, required: ['plan', 'execute', 'review'], additionalProperties: false } as const;
/** Where a reply's prices came from: OpenCode's own list, or Artificial Analysis's when OpenCode lists none. */
const priceSource = { anyOf: [{ type: 'string', enum: ['opencode', 'artificial-analysis'] }, { type: 'null' }] } as const;
const priceList = { type: 'object', properties: prices, required: [...priceNames], additionalProperties: false } as const;
const totals = { type: 'object', properties: { input: { type: 'number' }, output: { type: 'number' }, reasoning: { type: 'number' }, cacheRead: { type: 'number' }, cacheWrite: { type: 'number' }, costUsd: nullableString }, required: ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'costUsd'], additionalProperties: false } as const;
/** What the reply to a placed message took; null until the chat has answered it. `total` and `prices` are null in a reply kept before 19 Nov 2026. */
const reply = {
  type: 'object', properties: { requests: { type: 'number' }, fresh: { type: 'number' }, cached: { type: 'number' }, costUsd: nullableString, seconds: nullableNumber, model: nullableString, total: { anyOf: [totals, { type: 'null' }] }, prices: { anyOf: [priceList, { type: 'null' }] }, pricesFrom: priceSource },
  required: ['requests', 'fresh', 'cached', 'costUsd', 'seconds', 'model', 'total', 'prices', 'pricesFrom'], additionalProperties: false,
} as const;
const decision = { type: 'object', properties: { at: { type: 'string' }, sessionID: { type: 'string' }, kind: { type: 'string', enum: ['chat', 'helper'] }, mode: nullableMode, confidence: nullableNumber, fit: nullableNumber, model: nullableString, ms: { type: 'number' }, costUsd: nullableString, note: nullableString, messageID: nullableString, reply: { anyOf: [reply, { type: 'null' }] } }, required: ['at', 'sessionID', 'kind', 'mode', 'confidence', 'fit', 'model', 'ms', 'costUsd', 'note', 'messageID', 'reply'], additionalProperties: false } as const;
const relayOutput = { type: 'object', properties: {
  directory: { type: 'string' },
  settings: { type: 'object', properties: { revision: { type: 'integer', minimum: 0 }, modes: modeLists, decider: nullableChoice }, required: ['revision', 'modes', 'decider'], additionalProperties: false },
  decisions: { type: 'array', items: decision }, deciders: { type: 'array', items: modelItem },
  checks: { type: 'object', properties: { active: { type: 'boolean' }, note: nullableString }, required: ['active', 'note'], additionalProperties: false },
}, required: ['directory', 'settings', 'decisions', 'deciders', 'checks'], additionalProperties: false } as const;
/** The host reports any exception thrown by a handler as an opaque "RPC call failed", so a refusal the panel must show is returned as this declared error instead. */
const errors = { rejected: { type: 'object', properties: {}, additionalProperties: false } } as const;
const nothing = { type: 'object', properties: {}, additionalProperties: false } as const;

export const RelayRpc = Rpc.define({
  id: 'relay-opencode',
  events: {},
  methods: {
    getRelay: { errors, input: nothing, output: relayOutput },
    saveRelay: { errors, input: { type: 'object', properties: { revision: { type: 'integer', minimum: 0 }, modes: modeListsInput, decider: nullableChoice }, required: ['revision', 'modes', 'decider'], additionalProperties: false }, output: relayOutput },
    /** The pill: one chat's switch, that chat's newest record, and whether a decider is chosen at all. */
    getRelayChat: { errors, input: { type: 'object', properties: { sessionID: { type: 'string' } }, required: ['sessionID'], additionalProperties: false }, output: { type: 'object', properties: { on: { type: 'boolean' }, last: { anyOf: [decision, { type: 'null' }] }, decider: { type: 'boolean' } }, required: ['on', 'last', 'decider'], additionalProperties: false } },
    /** The panel's Recent choices, newest first. Storage only, so the panel can ask every few seconds. */
    getRelayDecisions: { errors, input: nothing, output: { type: 'object', properties: { directory: { type: 'string' }, decisions: { type: 'array', items: decision } }, required: ['directory', 'decisions'], additionalProperties: false } },
    setRelayChat: { errors, input: { type: 'object', properties: { sessionID: { type: 'string' }, on: { type: 'boolean' } }, required: ['sessionID', 'on'], additionalProperties: false }, output: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'], additionalProperties: false } },
    /** What Relay would do with a sample message: the mode after the 0.6 rule, the model it would pick, and the note. Nothing is switched, sent or recorded. */
    testDecider: { errors, input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, output: { type: 'object', properties: { directory: { type: 'string' }, mode: nullableMode, confidence: nullableNumber, model: nullableString, fit: nullableNumber, ms: { type: 'number' }, costUsd: nullableString, note: nullableString }, required: ['directory', 'mode', 'confidence', 'model', 'fit', 'ms', 'costUsd', 'note'], additionalProperties: false } },
    listModels: { errors, input: nothing, output: { type: 'object', properties: { directory: { type: 'string' }, models: { type: 'array', items: modelItem } }, required: ['directory', 'models'], additionalProperties: false } },
    /** The intelligence index of each listed model that could be matched, with where it came from, when it was fetched, and why it may be old or missing. */
    listIntelligence: { errors, input: nothing, output: { type: 'object', properties: {
      directory: { type: 'string' }, source: { type: 'string' }, fetchedAt: nullableString, note: nullableString,
      scores: { type: 'array', items: { type: 'object', properties: { providerID: { type: 'string' }, id: { type: 'string' }, index: { type: 'number' }, matched: { type: 'string' } }, required: ['providerID', 'id', 'index', 'matched'], additionalProperties: false } },
    }, required: ['directory', 'source', 'fetchedAt', 'note', 'scores'], additionalProperties: false } },
  },
});
