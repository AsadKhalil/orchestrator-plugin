import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUSY_CHECK_MS, relayAutoHook } from '../src/relay-auto.js';
import { recentDecisions } from '../src/relay-store.js';
import { reviewRules } from '../src/router.js';
import { fakeRelay } from './relay-fakes.js';

type Fake = ReturnType<typeof fakeRelay>;
const event = (text: string, metadata?: Record<string, unknown>, sessionID = 'ses-1') => ({ sessionID, messageID: 'msg-1', delivery: 'steer', prompt: { text, files: [], agents: [], skills: [] }, ...(metadata ? { metadata } : {}) });
const turnOn = (f: Fake, sessionID = 'ses-1') => { f.data.set(`relay/on/${sessionID}`, true); return f; };
const names = (f: Fake) => f.calls.map(call => call.name);
const switches = (f: Fake) => names(f).filter(name => ['switchAgent', 'switchModel', 'put', 'remove'].includes(name));
const last = async (f: Fake) => (await recentDecisions({ get: async key => structuredClone(f.data.get(key)) }))[0];
/** Whether a promise settles (either way) within `ms`, instead of hanging. */
const settles = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  const late = Symbol('late');
  const result = await Promise.race([promise.then(() => true, () => true), new Promise(done => setTimeout(() => done(late), ms))]);
  return result !== late;
};

test('with the switch on, a message is placed like /relay places one and recorded, and the hook itself sends nothing', async () => {
  const f = turnOn(fakeRelay());
  await relayAutoHook(f.deps)(event('fix the login test'));
  assert.deepEqual(switches(f), ['switchAgent', 'switchModel', 'remove']);
  assert.equal(names(f).includes('prompt'), false, 'the host sends the message, not the hook');
  const record = await last(f);
  assert.deepEqual([record.kind, record.sessionID, record.mode, record.model, record.note], ['chat', 'ses-1', 'execute', 'p/exec#high', null]);
  const review = turnOn(fakeRelay({ decision: { choice: 'review', confidence: 0.9 } }));
  await relayAutoHook(review.deps)(event('check my last change'));
  assert.deepEqual(review.calls.find(call => call.name === 'put')?.input, { sessionID: 'ses-1', key: 'relay-review-rules', value: reviewRules });
});

test('a chat with the switch off, a message /relay already placed, a blank message and a pipeline chat are left alone', async () => {
  for (const [label, f, input] of [
    ['off', fakeRelay(), event('fix the login test')],
    ['marked by /relay', turnOn(fakeRelay()), event('fix the login test', { relay: 'sent' })],
    ['blank', turnOn(fakeRelay()), event('   ')],
    ['pipeline chat', turnOn(fakeRelay({ owned: true })), event('fix the login test')],
  ] as const) {
    await relayAutoHook(f.deps)(input);
    assert.equal(names(f).includes('decisions'), false, `${label}: no decider request`);
    assert.deepEqual(switches(f), [], `${label}: nothing switched`);
    assert.equal(await last(f), undefined, `${label}: nothing recorded`);
  }
});

test('the switch is per chat', async () => {
  const f = turnOn(fakeRelay(), 'ses-1');
  await relayAutoHook(f.deps)(event('fix the login test', undefined, 'ses-2'));
  assert.equal(names(f).includes('decisions'), false);
});

test('with the switch on, an unsure answer keeps the chat as it is', async () => {
  const f = turnOn(fakeRelay({ decision: { choice: 'execute', confidence: 0.59 } }));
  await relayAutoHook(f.deps)(event('ok'));
  assert.deepEqual(switches(f), []);
  const record = await last(f);
  assert.deepEqual([record.mode, record.model, record.confidence, record.note], [null, null, 0.59, 'not sure, so the chat stays as it is']);
});

test('a busy chat is not waited for: nothing is switched and the record says why', async () => {
  assert.equal(BUSY_CHECK_MS, 300);
  const f = turnOn(fakeRelay({ busyMs: 2000 }));
  const started = Date.now();
  await relayAutoHook(f.deps)(event('fix the login test'));
  assert.ok(Date.now() - started < 1500, 'held for the short check only');
  assert.deepEqual(switches(f), []);
  assert.equal((await last(f)).note, 'the chat was still busy after 0.3 seconds');
});

test('a call that never answers or throws never holds the message long, and the hook never rejects', async () => {
  const flag = turnOn(fakeRelay({ readMs: 20 })), get = flag.deps.store.get;
  flag.deps.store.get = key => key.startsWith('relay/on/') ? new Promise(() => undefined) : get(key);
  assert.equal(await settles(relayAutoHook(flag.deps)(event('fix it')), 300), true, 'the switch read hangs');
  assert.equal(names(flag).includes('decisions'), false);
  const models = turnOn(fakeRelay({ readMs: 20 }));
  models.deps.chatModels = () => new Promise(() => undefined);
  assert.equal(await settles(relayAutoHook(models.deps)(event('fix it')), 300), true, 'the model list hangs');
  assert.match((await last(models)).note!, /did not answer within 0\.02 seconds/);
  const owned = turnOn(fakeRelay({ readMs: 20 }));
  owned.deps.owned = () => new Promise(() => undefined);
  assert.equal(await settles(relayAutoHook(owned.deps)(event('fix it')), 300), true, 'the ownership check hangs');
  assert.equal(names(owned).includes('decisions'), false);
  const switching = turnOn(fakeRelay({ readMs: 20 }));
  switching.deps.session.switchModel = () => new Promise(() => undefined);
  assert.equal(await settles(relayAutoHook(switching.deps)(event('fix it')), 300), true, 'a model switch never answers');
  const decider = turnOn(fakeRelay({ decision: 'never', decideMs: 20 }));
  assert.equal(await settles(relayAutoHook(decider.deps)(event('fix it')), 300), true, 'the decider hangs');
  for (const fail of [{ storageGet: new Error('storage offline') }, { get: new Error('no such chat') }, { switchModel: new Error('model gone') }, { storageSet: new Error('disk full') }] as const) {
    const f = turnOn(fakeRelay({ fail }));
    await assert.doesNotReject(relayAutoHook(f.deps)(event('fix it')), JSON.stringify(Object.keys(fail)));
  }
  await assert.doesNotReject(relayAutoHook(fakeRelay().deps)({ sessionID: 'ses-1' } as never), 'an event with no prompt');
});

// Last on purpose: a write that never finishes holds Relay's storage queue for the rest of this file.
test('a record write that never finishes does not hold the message', async () => {
  const record = turnOn(fakeRelay({ readMs: 2000 })), set = record.deps.store.set;   // a long limit, so waiting for the record would show
  record.deps.store.set = (key, value) => key === 'relay/decisions' ? new Promise(() => undefined) : set(key, value);
  assert.equal(await settles(relayAutoHook(record.deps)(event('fix it')), 300), true);
  assert.deepEqual(switches(record), ['switchAgent', 'switchModel', 'remove'], 'the message was still placed');
});
