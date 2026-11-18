import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewHelperHook } from '../src/review-helper.js';
import { recentDecisions } from '../src/relay-store.js';
import { reviewRules } from '../src/router.js';
import { entry, fakeRelay } from './relay-fakes.js';

const call = (input: unknown, tool = 'subagent') => ({ tool, sessionID: 'ses-1', agent: 'build', messageID: 'msg-1', id: 'call-1', input });
const task = { agent: 'general', description: 'Check the diff', prompt: 'Review the changes in src/auth.ts for mistakes.' };
const check = { decision: { choice: 'review', confidence: 0.95 } };
type Fake = ReturnType<typeof fakeRelay>;
const asked = (f: Fake) => f.calls.find(item => item.name === 'decisions')?.input as any;
const last = async (f: Fake) => (await recentDecisions({ get: async key => structuredClone(f.data.get(key)) }))[0];
/** Settings whose Execute list has lines too, so a test can see that a helper is only asked about the Review lines. */
const reviewers = (...list: ReturnType<typeof entry>[]) => ({ modes: { plan: [entry('plan')], execute: [entry('exec', 'high', 'small changes'), entry('usual', null, 'large changes')], review: list } });
const started = async (options: object, input: object = task) => { const f = fakeRelay(options as never), event = call({ ...input }); await reviewHelperHook(f.deps)(event); return { f, input: event.input as typeof task & { model?: string } }; };
/** Whether a promise settles (either way) within `ms`, instead of hanging. */
const settles = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  const late = Symbol('late');
  const result = await Promise.race([promise.then(() => true, () => true), new Promise(done => setTimeout(() => done(late), ms))]);
  return result !== late;
};

test('a helper whose task is a check starts on the Review model and gets the rules', async () => {
  const { f, input } = await started(check);
  assert.deepEqual(input, { ...task, model: 'p/review', prompt: `${task.prompt}\n\n${reviewRules}` });
  assert.equal(asked(f).input[0].text, 'A task that a model is handing to a helper: "Review the changes in src/auth.ts for mistakes."');
  assert.deepEqual(asked(f).questions.map((question: { name: string }) => question.name), ['mode'], 'one Review model: nothing to choose');
  const record = await last(f);
  assert.deepEqual(Object.keys(record).sort(), ['at', 'confidence', 'costUsd', 'fit', 'kind', 'messageID', 'mode', 'model', 'ms', 'note', 'reply', 'sessionID']);
  assert.deepEqual([record.messageID, record.reply], [null, null], "a helper's record names no message, so nothing is read for it later");
  assert.deepEqual([record.kind, record.sessionID, record.mode, record.model, record.confidence, record.fit, record.costUsd, record.note], ['helper', 'ses-1', 'review', 'p/review', 0.95, null, '0', null]);
  assert.equal(/auth\.ts|Review the changes/.test(JSON.stringify(record)), false, 'the record holds no task text');
  assert.equal(f.calls.some(item => ['get', 'wait', 'switchAgent', 'switchModel', 'put', 'remove', 'prompt'].includes(item.name)), false, 'the calling chat is not touched');
});

test('with several Review models the line the decider chose picks the helper\'s model, and only the Review lines are asked about', async () => {
  const settings = reviewers(entry('review', null, 'small diffs'), entry('eyes', null, 'security and money code'), entry('usual'));
  const chosen = await started({ settings, decision: { choice: 'review', confidence: 0.9, lines: { review: { choice: '2', confidence: 0.8 } } } });
  assert.equal(chosen.input.model, 'p/eyes');
  assert.deepEqual(asked(chosen.f).questions.map((question: { name: string }) => question.name), ['mode', 'review_line']);
  assert.deepEqual(asked(chosen.f).questions[1].choices.map((item: { description: string }) => item.description), ['small diffs', 'security and money code', 'None of these fits clearly.']);
  const record = await last(chosen.f);
  assert.deepEqual([record.model, record.fit, record.note], ['p/eyes', 0.8, null]);
  // A helper has no model of its own to keep, so with no clear line the first Review model is used.
  const none = await started({ settings, decision: { choice: 'review', confidence: 0.9, lines: { review: { choice: 'none', confidence: 0.9 } } } });
  assert.equal(none.input.model, 'p/review');
  assert.deepEqual([(await last(none.f)).model, (await last(none.f)).fit, (await last(none.f)).note], ['p/review', null, 'no line fits clearly, so the first model is used']);
  const effort = await started({ ...check, settings: reviewers(entry('exec', 'high')) });
  assert.equal(effort.input.model, 'p/exec#high', 'the effort travels in the model name');
  const gone = await started({ ...check, settings: reviewers(entry('gone'), entry('eyes')) });
  assert.equal(gone.input.model, 'p/eyes', 'a Review model that is not offered is passed over');
});

test('a helper that names its own model still starts on a Review model when its task is a check, and the record says what it asked for', async () => {
  // The owner, 17 Nov 2026: checks go to the Review model even when the calling model names one (Claude callers and Superpowers always do).
  const named = await started(check, { ...task, model: 'q/other' });
  assert.deepEqual(named.input, { ...task, model: 'p/review', prompt: `${task.prompt}\n\n${reviewRules}` });
  assert.deepEqual([(await last(named.f)).model, (await last(named.f)).note], ['p/review', 'its caller asked for q/other']);
  const same = await started(check, { ...task, model: 'p/review' });
  assert.deepEqual([same.input.model, (await last(same.f)).note], ['p/review', null], 'asking for the Review model itself needs no note');
  const settings = reviewers(entry('review', null, 'small diffs'), entry('eyes', null, 'security and money code'));
  const unclear = await started({ settings, decision: { choice: 'review', confidence: 0.9, lines: { review: { choice: 'none', confidence: 0.9 } } } }, { ...task, model: 'q/other' });
  assert.deepEqual([unclear.input.model, (await last(unclear.f)).note], ['p/review', 'its caller asked for q/other; no line fits clearly, so the first model is used']);
});

test('every other helper is left as it is', async () => {
  for (const [options, input, decided, note] of [
    [{ decision: { choice: 'execute', confidence: 0.95 } }, task, true, 'not a check'],
    [{ decision: { choice: 'plan', confidence: 0.95 } }, task, true, 'not a check'],
    [{ decision: { choice: 'review', confidence: 0.59 } }, task, true, 'not sure it is a check'],
    [{ decision: new Error('boom') }, task, true, 'the decider gave no answer: boom'],
    [{ decision: { choice: 'execute', confidence: 0.95 } }, { ...task, model: 'q/other' }, true, 'not a check'],   // names a model, not a check
    [check, { ...task, sessionID: 'ses-child' }, false, null],                         // it continues an earlier helper
    [{ ...check, settings: { modes: { plan: [], execute: [], review: [] } } }, task, false, null],   // no Review model
    [{ ...check, settings: reviewers(entry('gone')) }, task, false, null],             // the only Review model is not offered
    [{ ...check, settings: { decider: null } }, task, false, null],                    // no decider
    [check, { agent: 'general' }, false, null],                                        // no task text
    [check, { ...task, prompt: '  ' }, false, null],                                   // blank task text
  ] as const) {
    const { f, input: after } = await started(options, input);
    assert.deepEqual(after, input, JSON.stringify(options));
    assert.equal(asked(f) !== undefined, decided, JSON.stringify(options));
    assert.equal((await last(f))?.note ?? null, note, JSON.stringify(options));
  }
  const unsure = await last((await started({ decision: { choice: 'review', confidence: 0.59 } })).f);
  assert.deepEqual([unsure.kind, unsure.mode, unsure.confidence, unsure.model, unsure.fit], ['helper', 'review', 0.59, null, null], 'the record keeps the decider\'s own answer');
});

test('an error inside the hook never stops a helper from starting, and the input is replaced, not changed in place', async () => {
  for (const [fail, note] of [[{ models: new Error('list failed') }, 'helper left alone: list failed'], [{ storageGet: new Error('storage offline') }, null], [{ storageSet: new Error('disk full') }, null]] as const) {
    const f = fakeRelay({ ...check, fail }), event = call({ ...task });
    await assert.doesNotReject(reviewHelperHook(f.deps)(event));
    assert.equal((await last(f))?.note ?? null, note);
    if (note) assert.deepEqual(event.input, task);
  }
  for (const input of [null, undefined, 'text', 7, []]) await assert.doesNotReject(reviewHelperHook(fakeRelay(check).deps)(call(input)));
  const frozen = call(Object.freeze({ ...task }));
  await reviewHelperHook(fakeRelay(check).deps)(frozen);
  assert.equal((frozen.input as { model: string }).model, 'p/review');
});

test('any other tool passes straight through, before anything is read', async () => {
  const f = fakeRelay(check), event = call({ command: 'ls' }, 'bash');
  await reviewHelperHook(f.deps)(event);
  assert.deepEqual([f.calls, event.input], [[], { command: 'ls' }]);
});

test('a host call that never answers lets the helper start as it was, instead of hanging the tool call', async () => {
  const f = fakeRelay({ ...check, readMs: 20 });
  f.deps.chatModels = () => new Promise(() => undefined);
  const event = call({ ...task });
  assert.equal(await settles(reviewHelperHook(f.deps)(event), 200), true, 'the hook must give up and return, not hang');
  assert.deepEqual(event.input, task, 'left alone');
  assert.match((await last(f))?.note ?? '', /helper left alone: did not answer within 0\.02 seconds/);
});

