import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestFirst, checksLine, contextLabel, decisionLine, indexLabel, modelRows, nextEffort, noDeciderNote, pickerModel, pillView, priceCell, priceLabel, privacyNote, recentLine, switchHint, tryLine } from '../src/relay-view.js';
import { buildDecisionRequest, MAX_CHARS, MAX_FILE_NAMES } from '../src/decider.js';

const chat = { kind: 'chat' as const, mode: 'execute' as const, model: 'p/exec#high' as string | null, confidence: 0.98 as number | null, fit: null as number | null, ms: 150, note: null as string | null };

test('a price is never called free', () => {
  assert.equal(priceLabel({ inputPerMillion: '0', outputPerMillion: '0', tiered: false }), '$0 or not listed');
  assert.equal(priceLabel({ inputPerMillion: null, outputPerMillion: null, tiered: false }), 'price not listed');
  assert.equal(priceLabel({ inputPerMillion: '0.24', outputPerMillion: '0', tiered: false }), '$0.24 in / $0 out per 1M tokens');
  assert.equal(priceLabel({ inputPerMillion: '1', outputPerMillion: null, tiered: true }), '$1 in / not listed out per 1M tokens (base tier)');
});

test('the last choice reads as one line', () => {
  assert.equal(decisionLine(undefined), 'No /relay message yet.');
  assert.equal(decisionLine(chat), 'Last choice: Execute, p/exec#high, 98% sure, 150 ms.');
  assert.equal(decisionLine({ ...chat, model: 'p/usual', confidence: 0.9, fit: 0.8 }), 'Last choice: Execute, p/usual, 90% sure, line fit 80%, 150 ms.');
  assert.equal(decisionLine({ ...chat, confidence: null }), 'Last choice: Execute, p/exec#high, 150 ms.');
  assert.equal(decisionLine({ ...chat, mode: 'plan', model: 'p/plan', confidence: 0.4, note: 'not sure, so Plan' }), 'Last choice: Plan, p/plan, 40% sure, 150 ms (not sure, so Plan).');
  assert.equal(decisionLine({ ...chat, mode: null, model: null, confidence: null, ms: 5000, note: 'the decider took longer than 5 seconds' }), 'Last choice: nothing switched (the decider took longer than 5 seconds).');
  assert.equal(decisionLine({ ...chat, model: null, note: 'no chosen Execute model takes pictures' }), 'Last choice: nothing switched (no chosen Execute model takes pictures).');
  assert.equal(decisionLine({ ...chat, kind: 'helper', mode: 'review', model: 'p/review', confidence: 0.95, ms: 160.4 }), 'Last choice (a helper): Review, p/review, 95% sure, 160 ms.');
  assert.equal(decisionLine({ ...chat, kind: 'helper', model: null, confidence: 0.9, note: 'not a check' }), 'Last choice (a helper): left as it was (not a check).');
});

test('a try in the test box reads as one line, with the cost', () => {
  assert.equal(tryLine({ mode: 'review', confidence: 0.97, model: 'p/m#high', fit: 0.8, ms: 150, costUsd: '0', note: null }), 'Review, p/m#high, 97% sure, line fit 80%, 150 ms, cost $0.');
  assert.equal(tryLine({ mode: 'plan', confidence: 0.4, model: null, fit: null, ms: 150, costUsd: null, note: 'not sure, so Plan; no model chosen for Plan' }), 'Plan, no model, 40% sure, 150 ms, cost not reported (not sure, so Plan; no model chosen for Plan).');
  assert.equal(tryLine({ mode: null, confidence: null, model: null, fit: null, ms: 5000, costUsd: null, note: 'the decider took longer than 5 seconds' }), 'No answer (the decider took longer than 5 seconds).');
});

test('the panel says what is sent to the decider and to whom, with the limits the decider really has', () => {
  assert.equal(privacyNote('opencode'), "To choose, Relay sends to opencode: your message text (at most 4,000 characters), the names and sizes of attached files (the first 10), how many pictures are attached, whether the chat's agent can change files, and the lines you wrote above. Never the contents of files, pictures or earlier messages. While a decider and a Review model are chosen, the task text of each helper that a model starts is sent the same way — written by the calling model, so it may itself quote code, files or earlier chat, and the person does not see it before it goes out.");
  assert.match(privacyNote(null), /^To choose, Relay sends to the decider's provider: your message text/);
  assert.deepEqual([MAX_CHARS, MAX_FILE_NAMES], [4000, 10]);
  // Everything the request carries is something the sentence names: the text, file names with sizes, a count of pictures, what the agent can do and the lines.
  const request = buildDecisionRequest({ providerID: 'opencode', id: 'judge', variant: null }, { kind: 'chat', text: 'fix the test', agent: 'build', files: [{ name: 'C:/home/me/notes.txt', bytes: 2048 }], images: 2, lines: { plan: ['deep design', 'quick questions'] } });
  assert.deepEqual(request.input, [{ type: 'text', text: 'The person\'s message: "fix the test"\nBefore this message the chat was on an agent that can change files. Attached files: notes.txt (2 kB). Attached pictures: 2.' }]);
  assert.deepEqual(request.questions.map(question => question.name), ['mode', 'plan_line']);
  assert.deepEqual(request.questions[1].choices.map(choice => choice.description), ['deep design', 'quick questions', 'None of these fits clearly.']);
});

test('the pill says whether every message in this chat goes through Relay, offers to turn it, and shows the last choice there', () => {
  assert.deepEqual(pillView({ on: false, last: null, decider: true }), { label: 'Relay off', tone: undefined, rows: [{ id: 'toggle', label: 'Turn Relay on for this chat' }, { id: 'last', label: 'No choice in this chat yet.' }] });
  const on = pillView({ on: true, last: chat, decider: true });
  assert.deepEqual([on.label, on.tone, on.rows[0].label, on.rows[1].label, on.rows[1].tone], ['Relay on', 'success', 'Turn Relay off for this chat', 'Last choice: Execute, p/exec#high, 98% sure, 150 ms.', undefined]);
  assert.equal(pillView({ on: true, last: { ...chat, model: null, note: 'the chat was still busy after 0.3 seconds' }, decider: true }).rows[1].tone, 'warning', 'nothing was switched');
});

test('the Modes tab says how to turn Relay on for every message in one chat', () => {
  assert.equal(switchHint, 'To send every message in one chat through Relay, type /relay on in that chat or use the Relay pill above its chat box; /relay off turns it off. In the terminal app, /relay on and /relay off work the same way, without the pill.');
});

test('the panel says whether helpers that check work get a Review model', () => {
  assert.equal(checksLine({ active: true, note: null }), 'Helpers that check work start on a Review model.');
  assert.equal(checksLine({ active: false, note: 'no decider chosen' }), "Helpers that check work keep the chat's model: no decider chosen.");
  assert.equal(checksLine({ active: false, note: null }), "Helpers that check work keep the chat's model: not set up.");
});

test('with no decider chosen the pill says that Relay switches nothing, and offers to open the panel', () => {
  const on = pillView({ on: true, last: null, decider: false });
  assert.deepEqual([on.label, on.icon, on.tone], ['Relay on · no decider', 'circle-exclamation', 'warning']);
  assert.deepEqual(on.rows.map(row => [row.id, row.tone ?? null]), [['toggle', null], ['decider', 'warning'], ['last', null]]);
  assert.equal(on.rows[1].label, 'No decider chosen, so Relay switches nothing. Open Relay to choose one.');
  const off = pillView({ on: false, last: null, decider: false });
  assert.deepEqual([off.label, off.icon, off.tone, off.rows[1].id], ['Relay off', undefined, undefined, 'decider'], 'switched off, the capsule stays quiet; the menu still says why /relay would switch nothing');
  assert.equal(pillView({ on: true, last: null, decider: true }).icon, undefined);
});

test('the panel warns, before anything else, when no decider is chosen', () => {
  assert.equal(noDeciderNote, "No decider chosen. Until you choose one below, /relay and Relay on send every message to the chat's current model without switching.");
});

test('a recent choice reads as one line, and says whether it was for a chat or a helper', () => {
  assert.equal(recentLine(chat), 'Chat: Execute, p/exec#high, 98% sure, 150 ms.');
  assert.equal(recentLine({ ...chat, kind: 'helper', mode: 'review', model: 'p/review', confidence: 0.92, ms: 342 }), 'Helper: Review, p/review, 92% sure, 342 ms.');
  assert.equal(recentLine({ ...chat, mode: null, model: null, confidence: null, note: 'no decider chosen' }), 'Chat: nothing switched (no decider chosen).');
  assert.equal(recentLine({ ...chat, kind: 'helper', model: null, note: 'not a check' }), 'Helper: left as it was (not a check).');
});

test('a recent choice says what its reply took, once that is known', () => {
  const prices = { inputPerMillion: '3' as string | null, outputPerMillion: '15' as string | null, cacheReadPerMillion: '0.3' as string | null, cacheWritePerMillion: '3.75' as string | null };
  const took = {
    requests: 14, fresh: 84_000, cached: 1200, costUsd: '0.21' as string | null, seconds: 9.2 as number | null, model: 'p/exec#high' as string | null,
    total: { input: 84_400, output: 380, reasoning: 0, cacheRead: 86_700, cacheWrite: 0, costUsd: '0.22' as string | null }, prices: prices as typeof prices | null,
  };
  assert.equal(recentLine({ ...chat, reply: took }), 'Chat: Execute, p/exec#high, 98% sure, 150 ms. Reply from p/exec#high: 14 requests, 84,400 tokens in, 380 out, 86,700 read from cache, 0 written to cache, $0.22. Prices for a million tokens: $3 in, $15 out, $0.3 cache read, $3.75 cache write. First request: 84,000 tokens read new, 1,200 from cache, $0.21, first word after 9.2 s.');
  const unlisted = { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, cacheWritePerMillion: null };
  assert.equal(recentLine({ ...chat, note: 'not sure, so Plan', reply: { ...took, requests: 1, costUsd: null, seconds: null, model: null, total: { ...took.total, reasoning: 120, costUsd: '0' }, prices: unlisted } }),
    'Chat: Execute, p/exec#high, 98% sure, 150 ms (not sure, so Plan). Reply: 1 request, 84,400 tokens in, 380 out, 120 reasoning, 86,700 read from cache, 0 written to cache. Price: $0 or not listed. First request: 84,000 tokens read new, 1,200 from cache.', 'a cost of 0 can mean not listed, so it is not shown');
  assert.equal(recentLine({ ...chat, reply: { ...took, prices: { ...prices, inputPerMillion: '0', outputPerMillion: '0' } } }), recentLine({ ...chat, reply: { ...took, prices: unlisted } }), 'a price of $0 can mean not listed');
  assert.match(recentLine({ ...chat, reply: { ...took, prices: { ...prices, cacheWritePerMillion: null } } }), / \$0\.3 cache read\. First request/, 'a price that is not listed is left out');
  assert.equal(recentLine({ ...chat, reply: { ...took, model: null, total: null, prices: null } }), 'Chat: Execute, p/exec#high, 98% sure, 150 ms. Requests in the reply: 14. First request: 84,000 tokens read new, 1,200 from cache, $0.21, first word after 9.2 s.', 'a reply kept before 19 Nov 2026');
  assert.equal(recentLine({ ...chat, reply: null }), recentLine(chat));
});

test('cheapest first sorts by the input price, then the output price, compared exactly, with prices not listed last', () => {
  const model = (name: string, input: string | null, output: string | null) => ({ name, cost: { inputPerMillion: input, outputPerMillion: output, tiered: false } });
  const list = [model('none', null, null), model('b', '0.3', '1.2'), model('zero', '0', '0'), model('a', '0.3', '0.6'), model('tiny', '0.000001', '0'), model('big', '10', '30'), model('half', null, '1'), model('a2', '0.3', '0.6')];
  assert.deepEqual([...list].sort(cheapestFirst).map(item => item.name), ['zero', 'tiny', 'a', 'a2', 'b', 'big', 'half', 'none']);
  // Prices are compared as exact decimals: the same price written two ways ties, and the name decides.
  assert.equal(cheapestFirst(model('x', '0.3', '0'), model('y', '0.30', '0')), 'x'.localeCompare('y'));
});

test("the model to put in Desktop's picker after Relay switched a chat, and none after anything else", () => {
  // Desktop sends its picker's model with every message, so a picker left behind would undo Relay's switch on the next one (17 Nov).
  assert.deepEqual(pickerModel({ ...chat, model: 'claude-agent/sonnet' }), { providerID: 'claude-agent', modelID: 'sonnet' });
  assert.deepEqual(pickerModel(chat), { providerID: 'p', modelID: 'exec', variant: 'high' });
  assert.deepEqual(pickerModel({ ...chat, model: 'openrouter/anthropic/claude-x' }), { providerID: 'openrouter', modelID: 'anthropic/claude-x' }, 'only the first slash ends the provider');
  assert.equal(pickerModel({ ...chat, kind: 'helper' }), null, "a helper's model is not the chat's");
  assert.equal(pickerModel({ ...chat, model: null }), null, 'nothing was switched');
  for (const odd of ['noslash', '/m', 'p/', 'p/#high', 'p/m#']) assert.equal(pickerModel({ ...chat, model: odd }), null, odd);
});

test('a context window reads the way people say it, and one that is not listed is a dash, like a missing index', () => {
  assert.deepEqual([0, -1, Number.NaN, 512, 8192, 32768, 131072, 200000, 999_499, 999_500, 1_000_000, 1_048_576, 1_500_000, 2_000_000].map(contextLabel),
    ['—', '—', '—', '512', '8K', '33K', '131K', '200K', '999K', '1M', '1M', '1M', '1.5M', '2M']);
});

test('a price in the model table is short, and still never called free', () => {
  assert.equal(priceCell({ inputPerMillion: '3', outputPerMillion: '15', tiered: false }), '$3 / $15');
  assert.equal(priceCell({ inputPerMillion: '0', outputPerMillion: '0', tiered: false }), '$0 or not listed');
  assert.equal(priceCell({ inputPerMillion: null, outputPerMillion: null, tiered: false }), 'not listed');
  assert.equal(priceCell({ inputPerMillion: '1', outputPerMillion: null, tiered: true }), '$1 / not listed (base tier)');
});

test('the model table keeps the models that have every word typed in their name, id or provider, of one provider if chosen, in the order chosen', () => {
  const model = (providerID: string, id: string, name: string, input: string | null, context: number) => ({ providerID, id, name, cost: { inputPerMillion: input, outputPerMillion: input, cacheReadPerMillion: null, tiered: false }, limit: { context, output: 0 } });
  const models = [model('zeta', 'glm-5.3', 'GLM-5.3', '1.4', 200000), model('acme', 'acme-large', 'Acme Large', '3', 200000), model('acme', 'acme-mini', 'Acme Mini', '0.25', 128000), model('local', 'llama', 'Llama Local', null, 0), model('acme', 'acme-huge', 'Acme Huge', '15', 1000000)];
  const names = (query: string, provider: string, order: 'provider' | 'price' | 'context') => modelRows(models, { query, provider, order }).map(row => row.name);
  assert.deepEqual(names('', '', 'provider'), ['Acme Huge', 'Acme Large', 'Acme Mini', 'Llama Local', 'GLM-5.3'], 'by provider, then by name');
  assert.deepEqual(names('  ACME   l ', '', 'provider'), ['Acme Large'], 'every word, in any case, with extra spaces ignored');
  assert.deepEqual(names('5.3', '', 'provider'), ['GLM-5.3']);
  assert.deepEqual(names('zeta', '', 'provider'), ['GLM-5.3'], 'the provider counts as a word of the model');
  assert.deepEqual(modelRows([model('p', 'm1', 'Mega Model', '1', 1000)], { query: 'mega', provider: '', order: 'provider' }).map(row => row.name), ['Mega Model'], 'a word found only in the name, in another case');
  assert.deepEqual(names('', 'acme', 'price'), ['Acme Mini', 'Acme Large', 'Acme Huge']);
  assert.deepEqual(names('', '', 'price'), ['Acme Mini', 'GLM-5.3', 'Acme Large', 'Acme Huge', 'Llama Local'], 'cheapest first, a price not listed last');
  assert.deepEqual(names('', '', 'context'), ['Acme Huge', 'Acme Large', 'GLM-5.3', 'Acme Mini', 'Llama Local'], 'largest context first, a context not listed last');
  assert.deepEqual(names('nothing like it', '', 'provider'), []);
  assert.equal(models[0]!.name, 'GLM-5.3', 'the list it was given is left as it was');
});

test('Add puts in the default effort first, then each effort not in the list yet, and nothing once every effort is in', () => {
  const model = { providerID: 'acme', id: 'acme-large', variants: ['low', 'high'] };
  const pick = (variant: string | null) => ({ providerID: 'acme', id: 'acme-large', variant });
  assert.equal(nextEffort([], model), null);
  assert.equal(nextEffort([pick(null)], model), 'low');
  assert.equal(nextEffort([pick(null), pick('low')], model), 'high');
  assert.equal(nextEffort([pick('low')], model), null);
  assert.equal(nextEffort([pick(null), pick('low'), pick('high')], model), undefined);
  assert.equal(nextEffort([{ providerID: 'other', id: 'acme-large', variant: null }], model), null, 'the same id from another provider is another model');
  assert.equal(nextEffort([pick(null)], { ...model, variants: [] }), undefined);
});

test('the table can be ordered by the intelligence index, highest first, with models that have none last', () => {
  const model = (name: string, index: number | null) => ({ providerID: 'p', id: name.toLowerCase(), name, cost: { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, tiered: false }, limit: { context: 0, output: 0 }, index });
  const rows = modelRows([model('Low', 20.5), model('None', null), model('High', 61), model('Also', 20.5)], { query: '', provider: '', order: 'index' });
  assert.deepEqual(rows.map(row => row.name), ['High', 'Also', 'Low', 'None']);
  assert.deepEqual([indexLabel(54.5), indexLabel(61), indexLabel(33.44), indexLabel(null), indexLabel(undefined)], ['54.5', '61', '33.4', '—', '—']);
});
