import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { examplesReport, judge, modelRefusal, runExamples, scoreExamples, type Example, type ExampleSet, type Outcome } from '../scripts/decider-examples.js';
import { modes, USE_FOR_MAX, type Mode } from '../src/relay-store.js';
import { MAX_LINES, type DeciderAnswer, type LineAnswer } from '../src/router.js';

// No network and no host: the labelled set is read from the repo, and the scoring is fed made-up answers.
const set = JSON.parse(readFileSync(new URL('../scripts/relay-examples.json', import.meta.url), 'utf8')) as ExampleSet;
const answer = (mode: Mode, confidence: number, lines: Partial<Record<Mode, LineAnswer>> = {}): DeciderAnswer => ({ kind: 'answer', mode, confidence, lines, ms: 150, costUsd: '0' });
const tiny: ExampleSet = {
  lines: { plan: ['design', 'understand'], execute: ['small edits', 'large work'], review: ['security', 'correctness'] },
  examples: [
    { text: 'rename it', agent: 'build', expect: 'execute', line: 1 },
    { text: 'why is it slow?', agent: 'build', expect: 'plan', line: 2, nearMiss: true },
    { text: 'ok, do it', agent: 'plan', expect: 'execute', line: null, followUp: true },
    { text: 'check for leaks', agent: 'build', expect: 'review', line: 1 },
  ],
};
// Unless a test says otherwise, the decider itself said the mode that the router kept.
const outcome = (over: Partial<Outcome>): Outcome => ({ said: over.mode === undefined ? 'plan' : over.mode, mode: 'plan', confidence: 0.9, line: null, fit: null, lineSaid: null, ms: 150, costUsd: '0', note: null, ...over });

test('the example set has 30 labelled messages, 10 near misses, 3 follow-ups and one sample set of lines', () => {
  assert.equal(set.examples.length, 30);
  for (const mode of modes) {
    assert.ok(set.lines[mode].length >= 2 && set.lines[mode].length <= MAX_LINES, `${mode} has two to eight lines`);
    for (const line of set.lines[mode]) assert.ok(line.trim() === line && line.length > 0 && line.length <= USE_FOR_MAX);
    assert.ok(set.examples.filter(example => example.expect === mode).length >= 8, `${mode} has at least eight examples`);
    for (const [index] of set.lines[mode].entries()) assert.ok(set.examples.filter(example => example.expect === mode && example.line === index + 1).length >= 2, `${mode} line ${index + 1} is expected by at least two examples`);
  }
  for (const example of set.examples) {
    assert.ok(example.text.trim());
    assert.ok(['plan', 'build'].includes(example.agent));
    assert.ok(modes.includes(example.expect));
    assert.ok(example.line === null || (Number.isInteger(example.line) && example.line >= 1 && example.line <= set.lines[example.expect].length), `"${example.text}" names a line of its own mode, or none`);
    for (const file of example.files ?? []) assert.ok(file.name.trim() && Number.isInteger(file.bytes) && file.bytes! > 0);
  }
  const nearMisses = set.examples.filter(example => example.nearMiss);
  assert.ok(nearMisses.length >= 10);
  assert.equal(nearMisses.some(example => example.expect === 'execute'), false, 'a near miss is never Execute');
  const followUps = set.examples.filter(example => example.followUp);
  assert.ok(followUps.length >= 3);
  assert.ok(followUps.every(example => example.agent === 'plan' && example.expect === 'execute'), 'a follow-up is "do it" after a plan');
  assert.equal(new Set(set.examples.map(example => example.text)).size, 30);
  const none = set.examples.filter(example => example.line === null).length;
  assert.ok(none >= 3 && none <= 8, 'a few examples fit no line, most fit one');
});

test('an example is judged by the router: the 0.6 rule for the mode, the 0.5 rule for the line of the expected mode', () => {
  const [rename, slow] = tiny.examples;
  assert.deepEqual(judge(tiny, rename, answer('execute', 0.98, { execute: { index: 0, confidence: 0.8 } })), { mode: 'execute', said: 'execute', confidence: 0.98, line: 1, fit: 0.8, lineSaid: { index: 0, confidence: 0.8 }, ms: 150, costUsd: '0', note: null });
  assert.deepEqual((({ mode, said, lineSaid }) => [mode, said, lineSaid])(judge(tiny, rename, answer('execute', 0.59))), ['plan', 'execute', null], 'not sure means Plan, and what the decider itself said is kept');
  assert.deepEqual(judge(tiny, rename, answer('execute', 0.9, { execute: { index: 1, confidence: 0.49 } })).lineSaid, { index: 1, confidence: 0.49 }, 'the line answer is kept even when it is under the 0.5 rule');
  assert.deepEqual([judge(tiny, rename, answer('execute', 0.9, { execute: { index: 1, confidence: 0.49 } })).line, judge(tiny, rename, answer('execute', 0.9, { execute: { index: 1, confidence: 0.5 } })).line], [null, 2]);
  assert.equal(judge(tiny, rename, answer('execute', 0.9, { execute: { index: null, confidence: 0.9 } })).line, null, 'the decider chose none');
  // The mode is wrong, and the line is still read from the question about the expected mode's lines.
  assert.deepEqual((({ mode, line }) => ({ mode, line }))(judge(tiny, slow, answer('execute', 0.9, { plan: { index: 1, confidence: 0.7 }, execute: { index: 0, confidence: 0.9 } }))), { mode: 'execute', line: 2 });
  assert.deepEqual(judge(tiny, slow, { kind: 'none', reason: 'the decider took longer than 5 seconds', ms: 5000 }), { mode: null, said: null, confidence: null, line: null, fit: null, lineSaid: null, ms: 5000, costUsd: null, note: 'the decider took longer than 5 seconds' });
});

test('the score says what the not-sure rule did: the answers it made right and the answers it made wrong', () => {
  const five: ExampleSet = { ...tiny, examples: [...tiny.examples, { text: 'explain it', agent: 'build', expect: 'plan', line: null }] };
  const summary = scoreExamples(five, [
    outcome({ mode: 'plan', said: 'execute', confidence: 0.55, line: 1, fit: 0.9 }),   // the decider was right but not sure, so Plan: made wrong
    outcome({ mode: 'plan', said: 'execute', confidence: 0.3, line: 2, fit: 0.9 }),    // the decider was wrong and not sure, so Plan: made right
    outcome({ mode: 'plan', said: 'plan', confidence: 0.4 }),                          // wrong either way, and the rule changed nothing
    outcome({ mode: 'plan', said: 'execute', confidence: 0.5, line: 1, fit: 0.9 }),    // wrong either way, and the rule changed it
    outcome({ mode: 'plan', said: 'review', confidence: 0.2 }),                        // made right
  ]);
  assert.deepEqual([summary.rightMode, summary.changed, summary.rescued, summary.spoiled], [2, 4, 2, 1]);
  assert.deepEqual(summary.mixups, [
    'mode: "rename it" expected Execute, got Plan (the decider said Execute, 55% sure)',
    'rule: "why is it slow?" is Plan only by the not-sure rule (the decider said Execute, 30% sure)',
    'mode: "ok, do it" expected Execute, got Plan (40% sure)',
    'mode: "check for leaks" expected Review, got Plan (the decider said Execute, 50% sure)',
    'rule: "explain it" is Plan only by the not-sure rule (the decider said Review, 20% sure)',
  ]);
  assert.match(examplesReport(summary), /^Not-sure rule \(under 60% sure means Plan\): changed 4 of 5 answers; 2 became right, 1 became wrong\.$/m);
});

test('the score counts right modes, mistaken Execute, lines other than the expected one, times and cost', () => {
  const summary = scoreExamples(tiny, [
    outcome({ mode: 'execute', line: 2, fit: 0.7, ms: 900, costUsd: '0.001' }),          // right mode, wrong line
    outcome({ mode: 'execute', confidence: 0.8, line: null, lineSaid: { index: 1, confidence: 0.4 }, ms: 200, costUsd: '0.002' }),   // sent to Execute by mistake, and no line where one was expected
    outcome({ mode: 'execute', line: 1, fit: 0.6, ms: 100, costUsd: null }),                // right mode, a line where none was expected
    outcome({ mode: null, confidence: null, line: null, lineSaid: null, ms: 800, costUsd: null, note: 'the decider gave no answer: 429' }),    // no answer
  ]);
  // The first request is timed apart: 900 ms is not the slowest of "the others".
  assert.deepEqual({ ...summary, mixups: [] }, { total: 4, rightMode: 2, toExecute: 1, changed: 0, rescued: 0, spoiled: 0, offLine: 4, wrongLine: 1, noLine: 2, extraLine: 1, noAnswer: 1, firstMs: 900, medianMs: 200, slowestMs: 800, costUsd: '0.003', costReported: 2, mixups: [] });
  assert.deepEqual(summary.mixups, [
    'line: "rename it" expected Execute line 1, got line 2 (fit 70%)',
    'mode: "why is it slow?" expected Plan, got Execute (80% sure)',
    'line: "why is it slow?" expected Plan line 2, got no line (the decider said line 2, 40% sure)',
    'line: "ok, do it" expected no Execute line, got line 1 (fit 60%)',
    'mode: "check for leaks" expected Review, got no answer (the decider gave no answer: 429)',
    'line: "check for leaks" expected Review line 1, got no line',
  ]);
  // "None" is an answer too, and the report says how sure the decider was of it.
  assert.deepEqual(scoreExamples({ ...tiny, examples: [tiny.examples[0]] }, [outcome({ mode: 'execute', lineSaid: { index: null, confidence: 0.95 } })]).mixups, ['line: "rename it" expected Execute line 1, got no line (the decider said none, 95% sure)']);
  assert.throws(() => scoreExamples(tiny, []), /4 examples but 0 outcomes/);
});

test('the report says each Gate 1 line and whether it passes', () => {
  const good: Example[] = Array.from({ length: 30 }, (_, index) => ({ text: `message ${index}`, agent: 'build', expect: 'plan', line: null }));
  const passing = examplesReport(scoreExamples({ ...tiny, examples: good }, good.map(() => outcome({}))));
  assert.match(passing, /^Right mode: 30 of 30\. Gate 1 needs at least 27: pass\.$/m);
  assert.match(passing, /^Sent to Execute by mistake: 0\. Gate 1 needs 0: pass\.$/m);
  assert.match(passing, /^Off the expected line: 0 of 30 \(0 wrong line, 0 no line where one was expected, 0 a line where none was expected\)\. Gate 1 allows 3: pass\.$/m);
  assert.match(passing, /^Not-sure rule \(under 60% sure means Plan\): changed 0 of 30 answers; 0 became right, 0 became wrong\.$/m);
  assert.match(passing, /^Time: first request 150 ms; the other 29: median 150 ms, slowest 150 ms\. Gate 1 needs under 1000 ms: first request pass, the others pass\.$/m);
  assert.match(passing, /^Cost the host reported: \$0 \(30 of 30 requests reported one\)\.$/m);
  assert.match(passing, /^No answer: 0 of 30\.$/m);
  assert.match(passing, /^Mix-ups: none\.$/m);
  const failing = examplesReport(scoreExamples({ ...tiny, examples: good }, good.map((_, index) => outcome(index < 4 ? { mode: 'execute', line: 1, fit: 0.9, ms: index === 0 ? 1000 : 150 } : {}))));
  assert.match(failing, /^Right mode: 26 of 30\. Gate 1 needs at least 27: MISS\.$/m);
  assert.match(failing, /^Sent to Execute by mistake: 4\. Gate 1 needs 0: MISS\.$/m);
  assert.match(failing, /a line where none was expected\)\. Gate 1 allows 3: MISS\.$/m);
  // The first request after the host starts can be a cold start, so it gets its own verdict.
  assert.match(failing, /^Time: first request 1000 ms; .*under 1000 ms: first request MISS, the others pass\.$/m);
  assert.match(examplesReport(scoreExamples({ ...tiny, examples: good }, good.map((_, index) => outcome({ ms: index === 7 ? 1000 : 150 })))), /^Time: first request 150 ms; the other 29: median 150 ms, slowest 1000 ms\. Gate 1 needs under 1000 ms: first request pass, the others MISS\.$/m);
  assert.match(failing, /^Mix-ups:\n- mode: "message 0" expected Plan, got Execute \(90% sure\)$/m);
});

// ---- The run itself, against a made-up host: how many requests go out, and when it stops ----
const picked = (name: string, choice: string, confidence: number) => ({ type: 'choice', name, choice, probabilities: [], confidence });
const judgeModel = { providerID: 'd', id: 'judge', variant: null };
function fakeHost(reply: (count: number) => unknown) {
  const requests: any[] = [];
  return { requests, async decisions(request: unknown) { requests.push(request); const value = reply(requests.length); if (value instanceof Error) throw value; return value; } };
}

test('a run sends each example once, with every line question, and never more than 30', async () => {
  const host = fakeHost(() => ({ answers: [picked('mode', 'execute', 0.9), picked('execute_line', '1', 0.8), picked('plan_line', '2', 0.7), picked('review_line', 'none', 0.9)], cost: 0 }));
  const outcomes = await runExamples(tiny, host, judgeModel, 0);
  assert.deepEqual(outcomes.map(({ mode, line, costUsd }) => [mode, line, costUsd]), [['execute', 1, '0'], ['execute', 2, '0'], ['execute', 1, '0'], ['execute', null, '0']]);
  assert.equal(host.requests.length, 4);
  assert.deepEqual(host.requests.map(request => request.model), Array(4).fill({ providerID: 'd', id: 'judge' }));
  assert.deepEqual(host.requests[0].questions.map((question: { name: string }) => question.name), ['mode', 'plan_line', 'execute_line', 'review_line']);
  assert.match(host.requests[2].input[0].text, /"ok, do it"\nBefore this message the chat was on a read-only agent, which explains and plans and cannot change files\. Attached files: none\. Attached pictures: 0\./);
  const tooMany = fakeHost(() => ({ answers: [] }));
  await assert.rejects(runExamples({ ...tiny, examples: Array.from({ length: 31 }, (_, index) => ({ ...tiny.examples[0], text: `message ${index}` })) }, tooMany, judgeModel, 0), /at most 30 examples/);
  assert.equal(tooMany.requests.length, 0, 'nothing is sent when the set is too big');
});

test('a run stops when the model cannot be reached: no answer to the first request, or to three in a row', async () => {
  const dead = fakeHost(() => new Error('401 unauthorized'));
  await assert.rejects(runExamples(set, dead, judgeModel, 0), /Stopped after 1 request\(s\): the model did not answer \(the decider gave no answer: 401 unauthorized\)/);
  assert.equal(dead.requests.length, 1);
  const limited = fakeHost(count => count <= 2 ? { answers: [picked('mode', 'plan', 0.9)], cost: 0 } : new Error('429 too many requests'));
  await assert.rejects(runExamples(set, limited, judgeModel, 0), /Stopped after 5 request\(s\)/);
  assert.equal(limited.requests.length, 5);
  // Misses with answers between them do not stop the run: only three in a row do.
  const flaky = fakeHost(count => [2, 4, 6].includes(count) ? new Error('502') : { answers: [picked('mode', 'plan', 0.9)], cost: 0 });
  assert.equal((await runExamples(set, flaky, judgeModel, 0)).length, 30);
});

test('a model is refused before any request unless it is listed, enabled and free (or the paid switch is on)', () => {
  const model = (id: string, enabled: boolean, input: string | null, output: string | null) => ({ providerID: 'd', id, name: id, enabled, status: 'active', variants: [], capabilities: { input: ['text'], output: ['text'], tools: false }, limit: { context: 1000, output: 100 }, cost: { inputPerMillion: input, outputPerMillion: output, cacheReadPerMillion: null, cacheWritePerMillion: null, tiered: false, steps: [] } });
  const listed = [model('free', true, '0', '0'), model('off', false, '0', '0'), model('paid', true, '0.24', '0'), model('unknown', true, null, null)];
  assert.equal(modelRefusal('d', 'free', listed, false), null);
  assert.match(modelRefusal('d', 'gone', listed, false)!, /does not list d\/gone as a decision model\. It lists: d\/free, d\/off, d\/paid, d\/unknown\./);
  assert.match(modelRefusal('d', 'off', listed, false)!, /not enabled/);
  assert.match(modelRefusal('d', 'paid', listed, false)!, /has a listed price \(\$0\.24 in \/ \$0 out per 1M tokens\)\. Set RELAY_EXAMPLES_PAID=1/);
  assert.match(modelRefusal('d', 'unknown', listed, false)!, /price not listed/, 'an unknown price is not a free one');
  assert.equal(modelRefusal('d', 'paid', listed, true), null);
  assert.match(modelRefusal('d', 'off', listed, true)!, /not enabled/, 'the paid switch does not enable a model');
});
