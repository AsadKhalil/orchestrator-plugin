import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksLine, decisionLine, pillView, priceLabel, privacyNote, switchHint, tryLine } from '../src/relay-view.js';
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
  assert.equal(privacyNote('opencode'), "To choose, Relay sends to opencode: your message text (at most 4,000 characters), the names and sizes of attached files (the first 10), how many pictures are attached, the name of the chat's agent, and the lines you wrote above. Never the contents of files, pictures or earlier messages. While a decider and a Review model are chosen, the task text of each helper that a model starts is sent the same way — written by the calling model, so it may itself quote code, files or earlier chat, and the person does not see it before it goes out.");
  assert.match(privacyNote(null), /^To choose, Relay sends to the decider's provider: your message text/);
  assert.deepEqual([MAX_CHARS, MAX_FILE_NAMES], [4000, 10]);
  // Everything the request carries is something the sentence names: the text, file names with sizes, a count of pictures, the agent and the lines.
  const request = buildDecisionRequest({ providerID: 'opencode', id: 'judge', variant: null }, { kind: 'chat', text: 'fix the test', agent: 'build', files: [{ name: 'C:/home/me/notes.txt', bytes: 2048 }], images: 2, lines: { plan: ['deep design', 'quick questions'] } });
  assert.deepEqual(request.input, [{ type: 'text', text: 'The person\'s message: "fix the test"\nThe chat is on the agent: build. Attached files: notes.txt (2 kB). Attached pictures: 2.' }]);
  assert.deepEqual(request.questions.map(question => question.name), ['mode', 'plan_line']);
  assert.deepEqual(request.questions[1].choices.map(choice => choice.description), ['deep design', 'quick questions', 'None of these fits clearly.']);
});

test('the pill says whether every message in this chat goes through Relay, offers to turn it, and shows the last choice there', () => {
  assert.deepEqual(pillView({ on: false, last: null }), { label: 'Relay off', tone: undefined, rows: [{ id: 'toggle', label: 'Turn Relay on for this chat' }, { id: 'last', label: 'No choice in this chat yet.' }] });
  const on = pillView({ on: true, last: chat });
  assert.deepEqual([on.label, on.tone, on.rows[0].label, on.rows[1].label, on.rows[1].tone], ['Relay on', 'success', 'Turn Relay off for this chat', 'Last choice: Execute, p/exec#high, 98% sure, 150 ms.', undefined]);
  assert.equal(pillView({ on: true, last: { ...chat, model: null, note: 'the chat was still busy after 0.3 seconds' } }).rows[1].tone, 'warning', 'nothing was switched');
});

test('the Modes tab says how to turn Relay on for every message in one chat', () => {
  assert.equal(switchHint, 'To send every message in one chat through Relay, type /relay on in that chat or use the Relay pill above its chat box; /relay off turns it off. In the terminal app, /relay on and /relay off work the same way, without the pill.');
});

test('the panel says whether helpers that check work get a Review model', () => {
  assert.equal(checksLine({ active: true, note: null }), 'Helpers that check work start on a Review model.');
  assert.equal(checksLine({ active: false, note: 'no decider chosen' }), "Helpers that check work keep the chat's model: no decider chosen.");
  assert.equal(checksLine({ active: false, note: null }), "Helpers that check work keep the chat's model: not set up.");
});
