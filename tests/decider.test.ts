import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionRequest, capText, decide, MAX_CHARS, MAX_FILE_NAMES, TIMEOUT_MS, type DecideInput, type FileFact } from '../src/decider.js';

const judge = { providerID: 'd', id: 'judge', variant: null };
const chat: DecideInput = { kind: 'chat', text: 'fix the login test', agent: 'plan', files: [{ name: 'a.txt', bytes: 2048 }], images: 0, lines: {} };
const READ_ONLY = 'Before this message the chat was on a read-only agent, which explains and plans and cannot change files. ';
const choice = (name: string, value: unknown, confidence: unknown) => ({ type: 'choice', name, choice: value, probabilities: [], confidence });
const reply = (value: unknown, confidence: unknown, ...more: unknown[]) => ({ answers: [choice('mode', value, confidence), ...more], cost: 0, tokens: { input: 418, output: 38 } });

test('with no lines to ask about, the request is one choice question with the three modes', () => {
  const request = buildDecisionRequest(judge, chat);
  assert.deepEqual(request.model, { providerID: 'd', id: 'judge' });
  assert.deepEqual(request.input, [{ type: 'text', text: `The person's message: "fix the login test"\n${READ_ONLY}Attached files: a.txt (2 kB). Attached pictures: 0.` }]);
  assert.deepEqual(request.questions.map(q => [q.type, q.name, q.choices.map(c => c.value)]), [['choice', 'mode', ['plan', 'execute', 'review']]]);
  assert.match(request.questions[0].instructions, /Choose execute only when it clearly asks/);
  const helper = buildDecisionRequest({ ...judge, variant: 'fast' }, { kind: 'helper', text: 'Review the diff', agent: null, files: [], images: 0, lines: {} });
  assert.deepEqual(helper.model, { providerID: 'd', id: 'judge', variant: 'fast' });
  assert.equal(helper.input[0].text, 'A task that a model is handing to a helper: "Review the diff"');
});

test("the decider learns whether the chat's agent can change files, never the agent's name", () => {
  const second = (agent: string | null) => buildDecisionRequest(judge, { ...chat, agent }).input[0].text.split('\n')[1];
  assert.equal(second('plan'), `${READ_ONLY}Attached files: a.txt (2 kB). Attached pictures: 0.`);
  assert.equal(second('build'), 'Before this message the chat was on an agent that can change files. Attached files: a.txt (2 kB). Attached pictures: 0.');
  // "plan" is also one of the answers. Told "The chat is on the agent: plan", a real decider (clef:27b, 16 Nov) was 0.51 sure of execute for
  // "fix the off-by-one bug in average() in src/calc.js", so the unsure rule sent it to Plan; with this wording it was 0.90 sure.
  assert.doesNotMatch(second('plan'), /\bplan\b/);
  for (const agent of ['my-team-agent', 'general', null]) assert.equal(second(agent), 'Attached files: a.txt (2 kB). Attached pictures: 0.', `${agent}: no agent line, and no name`);
});

test('each mode with lines gets its own question: the lines as numbered choices, then none', () => {
  const request = buildDecisionRequest(judge, { ...chat, lines: { plan: ['hard design', 'screens'], review: ['security'] } });
  assert.deepEqual(request.questions.map(q => q.name), ['mode', 'plan_line', 'review_line']);
  assert.deepEqual(request.questions[1].choices, [{ value: '1', description: 'hard design' }, { value: '2', description: 'screens' }, { value: 'none', description: 'None of these fits clearly.' }]);
  assert.deepEqual(request.questions[2].choices.map(c => c.value), ['1', 'none']);
  assert.match(request.questions[1].instructions, /Choose none when no description fits clearly/);
  const many = buildDecisionRequest(judge, { ...chat, lines: { execute: Array.from({ length: 12 }, (_, index) => `line ${index}`) } });
  assert.deepEqual(many.questions[1].choices.map(c => c.value), ['1', '2', '3', '4', '5', '6', '7', '8', 'none'], 'never more than eight lines');
  assert.deepEqual(buildDecisionRequest(judge, { ...chat, lines: { plan: [] } }).questions.map(q => q.name), ['mode'], 'no lines, no question');
});

test('the decider is told the names and sizes of at most ten files, and never a folder', () => {
  const second = (files: FileFact[], images = 0) => buildDecisionRequest(judge, { ...chat, files, images }).input[0].text.split('\n')[1];
  assert.equal(MAX_FILE_NAMES, 10);
  assert.equal(second([]), `${READ_ONLY}Attached files: none. Attached pictures: 0.`);
  assert.equal(second([{ name: 'a.txt', bytes: 999 }, { name: 'notes.md', bytes: null }, { name: 'big.log', bytes: 12_345_678 }], 2), `${READ_ONLY}Attached files: a.txt (999 B), notes.md (size unknown), big.log (12 MB). Attached pictures: 2.`);
  assert.equal(second([{ name: 'C:\\Users\\someone\\private folder\\plan.md', bytes: 1500 }, { name: '/home/someone/src/app.ts', bytes: 0 }]), `${READ_ONLY}Attached files: plan.md (2 kB), app.ts (0 B). Attached pictures: 0.`);
  const many = second(Array.from({ length: 13 }, (_, index) => ({ name: `f${index}.ts`, bytes: 10 })));
  assert.match(many, /f9\.ts \(10 B\) and 3 more\. Attached pictures: 0\.$/);
  assert.equal(many.includes('f10.ts'), false);
  assert.equal(second([{ name: 'a\nb\t  c.txt', bytes: 1 }]), `${READ_ONLY}Attached files: a b c.txt (1 B). Attached pictures: 0.`);
  assert.match(second([{ name: `${'n'.repeat(100)}.txt`, bytes: 1 }]), new RegExp(`files: ${'n'.repeat(80)} \\(1 B\\)\\.`));
  const text = second([{ name: `${'n'.repeat(79)}\u{1F600}.txt`, bytes: 1 }]);   // the 80-character cut would otherwise fall inside the emoji
  assert.doesNotThrow(() => encodeURIComponent(text));
  assert.match(text, new RegExp(`files: ${'n'.repeat(79)} \\(1 B\\)\\.`));
});

test('text over 4,000 characters keeps the first 2,000 and the last 2,000, and never half a character', () => {
  assert.equal(MAX_CHARS, 4000);
  assert.equal(capText('a'.repeat(4000)), 'a'.repeat(4000));
  assert.equal(capText('a'.repeat(3000) + 'b'.repeat(3000)), 'a'.repeat(2000) + '\n[...]\n' + 'b'.repeat(2000));
  const emoji = capText('x' + '😀'.repeat(2500) + 'y');   // both cuts fall inside a two-unit character
  assert.doesNotThrow(() => encodeURIComponent(emoji));   // it throws on half a character
  assert.ok(emoji.length <= 4000 + '\n[...]\n'.length);
  const sent = buildDecisionRequest(judge, { ...chat, text: 'a'.repeat(3000) + 'b'.repeat(3000) }).input[0].text;
  assert.equal(sent.split('"')[1], 'a'.repeat(2000) + '\n[...]\n' + 'b'.repeat(2000), 'the cut text is what is sent');
});

test('a readable answer becomes the mode, the confidence, the cost and the lines', async () => {
  const answer = await decide({ decisions: async () => reply('review', 0.97) }, judge, chat);
  assert.deepEqual({ ...answer, ms: 0 }, { kind: 'answer', mode: 'review', confidence: 0.97, lines: {}, costUsd: '0', ms: 0 });
  const lines = { plan: ['a', 'b'], execute: ['c'], review: ['d', 'e', 'f'] };
  const answers = [choice('review_line', '3', 0.6), choice('plan_line', '2', 0.8), choice('mode', 'plan', 0.9), choice('execute_line', 'none', 0.7)];
  const full = await decide({ decisions: async () => ({ answers, cost: 0.000012 }) }, judge, { ...chat, lines });
  assert.deepEqual({ ...full, ms: 0 }, { kind: 'answer', mode: 'plan', confidence: 0.9, lines: { plan: { index: 1, confidence: 0.8 }, execute: { index: null, confidence: 0.7 }, review: { index: 2, confidence: 0.6 } }, costUsd: '0.000012', ms: 0 });
  assert.equal(((await decide({ decisions: async () => ({ answers: [choice('mode', 'plan', 0.9)] }) }, judge, chat)) as { costUsd: unknown }).costUsd, null, 'no cost reported is unknown, not zero');
});

test('a line answer that cannot be used is left out, and the mode still counts', async () => {
  const lines = { plan: ['a', 'b'] };
  const unusable = [choice('plan_line', '3', 0.9), choice('plan_line', '0', 0.9), choice('plan_line', 2, 0.9), choice('plan_line', true, 0.9), choice('plan_line', '1', 1.5), choice('plan_line', '1', '0.9'), choice('plan_line', '1', Number.NaN),
    { type: 'error', name: 'plan_line', reason: 'refused' }, choice('other_line', '1', 0.9), choice('review_line', '1', 0.9), choice('review_line', 'none', 0.9), null, 'plan_line'];
  for (const extra of unusable) {
    const answer = await decide({ decisions: async () => reply('plan', 0.9, extra) }, judge, { ...chat, lines });
    assert.deepEqual({ ...answer, ms: 0 }, { kind: 'answer', mode: 'plan', confidence: 0.9, lines: {}, costUsd: '0', ms: 0 }, JSON.stringify(extra));
  }
});

test('anything else counts as no answer', async () => {
  const none = async (result: () => Promise<unknown>, decider: typeof judge | null = judge) => { const a = await decide({ decisions: result }, decider, chat); assert.equal(a.kind, 'none'); return (a as { reason: string }).reason; };
  assert.equal(await none(async () => { throw new Error('must not be called'); }, null), 'no decider chosen');
  assert.equal(await none(async () => { throw new Error('ProviderRequestError: 503'); }), 'the decider gave no answer: ProviderRequestError: 503');
  assert.equal(await none(() => { throw new Error('thrown before a promise existed'); }), 'the decider gave no answer: thrown before a promise existed');
  assert.equal(await none(async () => { throw new Error(`long\n${'x'.repeat(400)}`); }), `the decider gave no answer: long ${'x'.repeat(195)}`);
  assert.equal(await none(async () => ({ answers: [{ type: 'error', name: 'mode', reason: 'refused' }] })), 'the decider gave no answer: refused');
  for (const bad of [reply('unsure', 0.9), reply(true, 0.9), reply('plan', 1.2), reply('plan', -0.1), reply('plan', Number.NaN), reply('plan', '0.9'), { answers: [] }, { answers: [null] }, { answers: [{ ...choice('mode', 'plan', 0.9), name: 'other' }] }, { answers: [{ ...choice('mode', 'plan', 0.9), type: 'score' }] }, null, 'plan', undefined])
    assert.equal(await none(async () => bad), "the decider's answer could not be read");
});

test('it gives up after the time limit and ignores a late answer and a late failure', async () => {
  assert.equal(TIMEOUT_MS, 5000);
  let calls = 0;
  const slow = { decisions: () => { const nth = ++calls; return new Promise((done, fail) => setTimeout(() => nth === 1 ? done(reply('execute', 0.99)) : fail(new Error('late')), 40)); } };
  for (const _ of [1, 2]) { const a = await decide(slow, judge, chat, 10); assert.deepEqual([a.kind, (a as { reason: string }).reason], ['none', 'the decider took longer than 0.01 seconds']); }
  await new Promise(done => setTimeout(done, 60));   // the late failure must not surface as an unhandled rejection
});
