import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUSY_CHECK_MS, relayAutoHook, relayReplyHook } from '../src/relay-auto.js';
import { recentDecisions } from '../src/relay-store.js';
import { reviewRules } from '../src/router.js';
import { fakeModels, fakeRelay } from './relay-fakes.js';

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

test('a chat with the switch off, a message /relay already placed and a blank message are left alone', async () => {
  for (const [label, f, input] of [
    ['off', fakeRelay(), event('fix the login test')],
    ['marked by /relay', turnOn(fakeRelay()), event('fix the login test', { relay: 'sent' })],
    ['blank', turnOn(fakeRelay()), event('   ')],
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

test('with the switch on, a picture Desktop uploaded counts as a picture, and its other uploads as files', async () => {
  // Desktop 2.3.0 sends a pasted picture or file as an upload: a line with its path in the text, an entry in the message's metadata, and no file part (17 Nov).
  const asked = (f: Fake) => (f.calls.find(call => call.name === 'decisions')?.input as { input: { text: string }[] }).input[0].text.split('\n')[1];
  const entry = (id: string) => ({ providerID: 'p', id, variant: null, useFor: '' });
  const uploads = { attachments: [{ name: 'task.png', mime: 'image/png', path: '/tmp/uploads/1/task.png' }, { name: 'notes.txt', mime: 'text/plain', path: '/tmp/uploads/2/notes.txt' }] };
  const none = turnOn(fakeRelay());
  await relayAutoHook(none.deps)(event('do what the picture says', uploads));
  assert.equal(asked(none), 'Before this message the chat was on a read-only agent, which explains and plans and cannot change files. Attached files: notes.txt (2 kB). Attached pictures: 1.');
  assert.deepEqual(switches(none), [], 'no chosen Execute model takes pictures, so nothing is switched');
  assert.match((await last(none)).note!, /no chosen Execute model takes pictures/);
  const eyes = turnOn(fakeRelay({ settings: { modes: { plan: [entry('plan')], execute: [entry('exec'), entry('eyes')], review: [entry('review')] } } }));
  await relayAutoHook(eyes.deps)(event('do what the picture says', uploads));
  assert.deepEqual((eyes.calls.find(call => call.name === 'switchModel')?.input as { model: unknown }).model, { providerID: 'p', id: 'eyes' });
  for (const odd of [{ attachments: 'task.png' }, { attachments: [null, 3, { name: 'x.png', mime: 5, path: '/x.png' }, { name: 'y.png', mime: 'image/png' }] }]) {
    const f = turnOn(fakeRelay());
    await relayAutoHook(f.deps)(event('do what the picture says', odd));
    assert.match(asked(f), /Attached files: none\. Attached pictures: 0\.$/, JSON.stringify(odd));
  }
});

// What the reply took. The messages are shaped as OpenCode 2.3.0 gives them (18 Nov); `msg-1` is the id the hook's event carries.
const replied = (created: number) => [
  { id: 'msg-1', type: 'user', time: { created }, text: 'never read' },
  { id: 'a1', type: 'assistant', time: { created: created + 20, firstToken: created + 900, completed: created + 1500 }, model: { providerID: 'p', id: 'exec', variant: 'high' }, tokens: { input: 84_000, output: 300, reasoning: 0, cache: { read: 1200, write: 0 } }, cost: 0.21 },
  { id: 'a2', type: 'assistant', time: { created: created + 1600, firstToken: created + 1700, completed: created + 2000 }, model: { providerID: 'p', id: 'exec', variant: 'high' }, tokens: { input: 400, output: 80, reasoning: 0, cache: { read: 85_500, write: 0 } }, cost: 0.01 },
  { id: 'i1', type: 'idle', time: { created: created + 2010 } },
];
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

const prices = { inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: '0.3', cacheWritePerMillion: '3.75' };
const priced = fakeModels.map(model => model.id === 'exec' ? { ...model, cost: { ...model.cost, ...prices } } : model);
const total = { input: 84_400, output: 380, reasoning: 0, cacheRead: 86_700, cacheWrite: 0, costUsd: '0.22' };

test("when a chat goes idle, what the reply to each placed message took is read from the chat's own record and kept; no model is asked", async () => {
  const f = turnOn(fakeRelay({ messages: replied(1000), models: priced }));
  await relayAutoHook(f.deps)(event('fix the login test')); await sleep(20);   // the record is written after the hook returns
  assert.deepEqual([(await last(f)).messageID, (await last(f)).reply], ['msg-1', null], 'the record waits for its reply');
  f.calls.length = 0;
  await relayReplyHook(f.deps)({ sessionID: 'ses-1' });
  assert.deepEqual((await last(f)).reply, { requests: 2, fresh: 84_000, cached: 1200, costUsd: '0.21', seconds: 0.9, model: 'p/exec#high', total, prices, pricesFrom: 'opencode' });
  assert.deepEqual(names(f).filter(name => !name.startsWith('storage')), ['context', 'models'], 'one read of the chat and one of the model list, for the prices');
  f.calls.length = 0;
  await relayReplyHook(f.deps)({ sessionID: 'ses-1' });
  assert.equal(names(f).includes('context'), false, 'nothing waits, so the chat is not read again');
  await relayReplyHook(f.deps)({ sessionID: 'ses-2' });
  assert.equal(names(f).includes('context'), false, 'a chat with no record is not read');
});

test('a reply that is not there yet leaves its record waiting for the next time the chat goes idle', async () => {
  const messages: unknown[] = [];
  const f = turnOn(fakeRelay({ messages }));
  await relayAutoHook(f.deps)(event('fix the login test')); await sleep(20);
  await relayReplyHook(f.deps)({ sessionID: 'ses-1' });
  assert.deepEqual([(await last(f)).messageID, (await last(f)).reply], ['msg-1', null]);
  messages.push(...replied(1000));
  await relayReplyHook(f.deps)({ sessionID: 'ses-1' });
  assert.equal((await last(f)).reply?.requests, 2);
});

test('a model list that fails or is slow leaves the prices unknown, and the reply is still kept', async () => {
  for (const [label, list] of [['the list fails', async () => { throw new Error('no list'); }], ['the list never answers', () => new Promise<never>(() => undefined)]] as const) {
    const f = turnOn(fakeRelay({ messages: replied(1000), readMs: 100 }));
    await relayAutoHook(f.deps)(event('fix the login test')); await sleep(20);
    f.deps.chatModels = list;
    assert.equal(await settles(relayReplyHook(f.deps)({ sessionID: 'ses-1' }), 500), true, label);
    assert.deepEqual((await last(f)).reply, { requests: 2, fresh: 84_000, cached: 1200, costUsd: '0.21', seconds: 0.9, model: 'p/exec#high', total, prices: null, pricesFrom: null }, label);
  }
});

test("the idle hook prices a reply from Artificial Analysis's stored list when OpenCode lists no price, and keeps the reply when that list fails", async () => {
  const api = { inputPerMillion: '2', outputPerMillion: '10', cacheReadPerMillion: '0.1', cacheWritePerMillion: '2.5' }, unlisted = { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, cacheWritePerMillion: null };
  const lent = [{ slug: 'exec', name: 'Exec', creator: 'P', released: null, index: 40, prices: api }];
  const cases = [['a stored list', async () => lent, api, 'artificial-analysis'], ['a list that cannot be read', async () => { throw new Error('no store'); }, unlisted, null]] as const;
  for (const [label, borrowedPrices, prices, pricesFrom] of cases) {
    const f = turnOn(fakeRelay({ messages: replied(1000) }));
    await relayAutoHook(f.deps)(event('fix the login test')); await sleep(20);
    await relayReplyHook({ ...f.deps, borrowedPrices })({ sessionID: 'ses-1' });
    const reply = (await last(f)).reply;
    assert.deepEqual([reply?.prices, reply?.pricesFrom, reply?.requests], [prices, pricesFrom, 2], label);
  }
});

test('the idle hook never throws and never holds a chat for long', async () => {
  for (const [label, options] of [['the chat cannot be read', { fail: { context: new Error('no such chat') } }], ['the chat never answers', { messages: 'never' }], ['the record cannot be saved', { messages: replied(1000) }]] as const) {
    const f = turnOn(fakeRelay({ ...options, readMs: 60 }));
    await relayAutoHook(f.deps)(event('fix the login test')); await sleep(20);
    if (label === 'the record cannot be saved') f.deps.store.set = async () => { throw new Error('disk full'); };
    assert.equal(await settles(relayReplyHook(f.deps)({ sessionID: 'ses-1' }), 500), true, label);
    assert.equal((await last(f)).reply, null, label);
  }
  const broken = fakeRelay({ fail: { storageGet: new Error('storage is down') } });
  await assert.doesNotReject(relayReplyHook(broken.deps)({ sessionID: 'ses-1' }));
});

// Last on purpose: a write that never finishes holds Relay's storage queue for the rest of this file.
test('a record write that never finishes does not hold the message', async () => {
  const record = turnOn(fakeRelay({ readMs: 2000 })), set = record.deps.store.set;   // a long limit, so waiting for the record would show
  record.deps.store.set = (key, value) => key === 'relay/decisions' ? new Promise(() => undefined) : set(key, value);
  assert.equal(await settles(relayAutoHook(record.deps)(event('fix it')), 300), true);
  assert.deepEqual(switches(record), ['switchAgent', 'switchModel', 'remove'], 'the message was still placed');
});
