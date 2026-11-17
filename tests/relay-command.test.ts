import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { relayCommand, isPicture, fileSize, localPath } from '../src/relay-command.js';
import { chatSwitch, recentDecisions } from '../src/relay-store.js';
import { reviewRules } from '../src/router.js';
import { entry, fakeRelay } from './relay-fakes.js';

const typed = { text: 'fix the login test', files: [{ uri: 'file:///repo/a.txt', name: 'a.txt', mention: { start: 22, end: 28, text: '@a.txt' } }], agents: [], skills: [] };
type Fake = ReturnType<typeof fakeRelay>;
const run = (f: Fake, prompt: object = typed) => relayCommand(f.deps).execute({ sessionID: 'ses-1', prompt, delivery: 'steer' } as never);
const names = (f: Fake) => f.calls.map(call => call.name);
const input = (f: Fake, name: string) => f.calls.find(call => call.name === name)?.input as any;
const prompts = (f: Fake) => f.calls.filter(call => call.name === 'prompt').map(call => call.input);
const last = async (f: Fake) => (await recentDecisions({ get: async key => structuredClone(f.data.get(key)) }))[0];
// Relay marks its own send, so the hook of a chat whose switch is on leaves it alone. The host stores the metadata and does not send it to the model.
const sent = [{ ...typed, sessionID: 'ses-1', delivery: 'steer', metadata: { relay: 'sent' } }];
const switchedOn = (f: Fake, sessionID = 'ses-1') => chatSwitch({ get: async key => structuredClone(f.data.get(key)) }, sessionID);
const switches = (f: Fake) => names(f).filter(name => ['switchAgent', 'switchModel', 'put', 'remove'].includes(name));
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
/** Whether a promise settles (either way) within `ms`, instead of hanging. */
const settles = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  const late = Symbol('late');
  const result = await Promise.race([promise.then(() => true, () => true), new Promise(done => setTimeout(() => done(late), ms))]);
  return result !== late;
};
const asked = (f: Fake) => input(f, 'decisions').input[0].text.split('\n')[1] as string;
const execute = (...list: ReturnType<typeof entry>[]) => ({ modes: { plan: [entry('plan')], execute: list, review: [entry('review')] } });

test('a sure Execute decision switches the agent, then the model, then sends once, unchanged', async () => {
  const f = fakeRelay(); await run(f);
  assert.deepEqual(names(f).filter(name => name.startsWith('switch') || name === 'prompt'), ['switchAgent', 'switchModel', 'prompt']);
  assert.deepEqual(input(f, 'switchAgent'), { sessionID: 'ses-1', agent: 'build' });
  assert.deepEqual(input(f, 'switchModel'), { sessionID: 'ses-1', model: { providerID: 'p', id: 'exec', variant: 'high' } });
  assert.deepEqual(prompts(f), sent);
});

test('Review uses the plan agent and sets the rules before the send; Plan removes them', async () => {
  const review = fakeRelay({ chat: { agent: 'build' }, decision: { choice: 'review', confidence: 0.9 } }); await run(review);
  assert.deepEqual(input(review, 'switchAgent'), { sessionID: 'ses-1', agent: 'plan' });
  assert.deepEqual(input(review, 'put'), { sessionID: 'ses-1', key: 'relay-review-rules', value: reviewRules });
  assert.ok(names(review).indexOf('put') < names(review).indexOf('prompt'));
  const plan = fakeRelay({ decision: { choice: 'plan', confidence: 0.9 } }); await run(plan);
  assert.deepEqual(input(plan, 'remove'), { sessionID: 'ses-1', key: 'relay-review-rules' });
  assert.equal(names(plan).includes('put'), false);
});

test('not sure means Plan and never build; a model with no effort is sent without a variant key', async () => {
  const f = fakeRelay({ decision: { choice: 'execute', confidence: 0.59 } }); await run(f);
  assert.equal(names(f).includes('switchAgent'), false);          // the chat was on plan already
  assert.deepEqual(input(f, 'switchModel'), { sessionID: 'ses-1', model: { providerID: 'p', id: 'plan' } });
  assert.match((await last(f)).note!, /not sure, so Plan/);
  const g = fakeRelay({ chat: { agent: 'build' }, decision: { choice: 'execute', confidence: 0.59 } }); await run(g);
  assert.deepEqual(input(g, 'switchAgent'), { sessionID: 'ses-1', agent: 'plan' });
});

test('a decider error, a slow decider and an unset decider each send unchanged with no switch and no wait', async () => {
  for (const [options, note] of [[{ decision: new Error('boom') }, /gave no answer: boom/], [{ decision: 'never', decideMs: 20 }, /took longer than/], [{ settings: { decider: null } }, /no decider chosen/]] as const) {
    const f = fakeRelay(options as never); await run(f);
    assert.deepEqual(switches(f), []); assert.equal(names(f).includes('wait'), false); assert.deepEqual(prompts(f), sent);
    const record = await last(f);
    assert.match(record.note!, note); assert.deepEqual([record.mode, record.model, record.confidence, record.fit], [null, null, null, null]);
  }
});

test('a failed switch still sends; a failed send is reported and not repeated', async () => {
  const f = fakeRelay({ fail: { switchAgent: new Error('no such agent'), switchModel: new Error('model gone') } }); await run(f);
  assert.deepEqual(prompts(f), sent);
  const record = await last(f);
  assert.match(record.note!, /agent not switched: no such agent; model not switched: model gone/); assert.equal(record.model, null, 'the chat is not on the chosen model');
  const g = fakeRelay({ fail: { prompt: new Error('inbox closed') } });
  await assert.rejects(run(g), /inbox closed/);
  assert.equal(prompts(g).length, 1);
  assert.match((await last(g)).note!, /the message could not be sent: inbox closed/);
  const h = fakeRelay({ decision: { choice: 'review', confidence: 0.9 }, fail: { put: new Error('entry refused') } }); await run(h);
  assert.deepEqual(prompts(h), sent); assert.match((await last(h)).note!, /review rules not set: entry refused/);
});

test('a picture goes only to a model with image input, and is neither sized nor named to the decider', async () => {
  const picture = { ...typed, files: [{ uri: 'file:///repo/red.png', name: 'red.png' }] };
  const none = fakeRelay(); await run(none, picture);
  assert.deepEqual(switches(none), []); assert.equal(prompts(none).length, 1);
  assert.match((await last(none)).note!, /no chosen Execute model takes pictures/);
  assert.equal(names(none).includes('size'), false);
  assert.equal(asked(none), 'Before this message the chat was on a read-only agent, which explains and plans and cannot change files. Attached files: none. Attached pictures: 1.');
  const second = fakeRelay({ settings: execute(entry('exec', 'high'), entry('eyes')) }); await run(second, picture);
  assert.deepEqual(input(second, 'switchModel').model, { providerID: 'p', id: 'eyes' });
  for (const file of [{ uri: 'data:image/png;base64,AAAA' }, { uri: 'file:///x/Shot.JPEG?v=1' }, { name: 'a.webp', uri: 'x' }]) assert.equal(isPicture(file), true);
  for (const file of [{ uri: 'file:///repo/a.txt', name: 'a.txt' }, { uri: 'file:///repo/png.md' }, {}]) assert.equal(isPicture(file), false);
});

test('a busy chat is waited for before any switch; after the ceiling, or when the wait fails, the message goes unchanged', async () => {
  const f = fakeRelay({ busyMs: 30 }); await run(f);
  assert.ok(names(f).indexOf('idle') < names(f).indexOf('switchAgent'));
  const stuck = fakeRelay({ busyMs: 300, waitMs: 20 }); await run(stuck);
  assert.deepEqual(switches(stuck), []); assert.deepEqual(prompts(stuck), sent);
  assert.equal((await last(stuck)).note, 'the chat was still busy after 0.02 seconds');
  const broken = fakeRelay({ fail: { wait: new Error('no such chat') } }); await run(broken);
  assert.deepEqual(switches(broken), []); assert.deepEqual(prompts(broken), sent);
  assert.equal((await last(broken)).note, 'could not wait for the chat: no such chat');
});

test('blank text is refused, and nothing is asked or sent', async () => {
  const f = fakeRelay(); await assert.rejects(run(f, { ...typed, text: '  \n' }), /type your message after \/relay/);
  assert.deepEqual(names(f), []);
});

test('/relay on and /relay off turn the switch for this chat, in any case and with spaces around, and send nothing', async () => {
  const f = fakeRelay();
  for (const [text, on] of [['on', true], ['  OFF ', false], ['On', true], ['off', false], ['ON', true]] as const) {
    await run(f, { ...typed, text, files: [] });
    assert.equal(await switchedOn(f), on, JSON.stringify(text));
  }
  assert.deepEqual(prompts(f), []); assert.equal(names(f).includes('decisions'), false, 'a toggle asks the decider nothing');
  assert.equal(await last(f), undefined, 'a toggle is not a decision');
  assert.equal(await switchedOn(f, 'ses-2'), false, 'only this chat');
  const h = fakeRelay(); await run(h, { ...typed, text: 'on second thought, fix the login test' });
  assert.deepEqual([prompts(h).length, await switchedOn(h)], [1, false], 'anything more than on or off is a message');
});

test('a toggle waits its turn in the chat, after a /relay message typed before it', async () => {
  const f = fakeRelay({ busyMs: 20 });
  const command = relayCommand(f.deps), go = (text: string) => command.execute({ sessionID: 'ses-1', prompt: { ...typed, text }, delivery: 'steer' } as never);
  await Promise.all([go('fix the login test'), go('on')]);
  const order = f.calls.filter(call => call.name === 'prompt' || (call.name === 'storageSet' && call.input === 'relay/on/ses-1')).map(call => call.name);
  assert.deepEqual(order, ['prompt', 'storageSet']);
});

test('a chat already on the chosen agent and model is not switched again, and is not waited for either', async () => {
  const f = fakeRelay({ chat: { agent: 'build', model: { providerID: 'p', id: 'exec', variant: 'high' } }, busyMs: 1000, waitMs: 20 }); await run(f);
  const g = fakeRelay({ chat: { agent: 'plan', model: { providerID: 'p', id: 'plan', variant: 'default' } }, decision: { choice: 'plan', confidence: 0.9 }, busyMs: 1000, waitMs: 20 }); await run(g);
  for (const fake of [f, g]) { assert.equal(names(fake).some(name => name.startsWith('switch') || name === 'wait'), false, 'nothing to switch, so the chat is not waited for'); assert.equal(prompts(fake).length, 1); }
  assert.deepEqual([(await last(f)).model, (await last(g)).model], ['p/exec#high', 'p/plan']);
});

test('two /relay messages in one chat run one after the other, each on its own model', async () => {
  const f = fakeRelay({ busyMs: 20, decision: request => ({ choice: request.input[0].text.includes('first') ? 'execute' : 'plan', confidence: 0.9 }) });
  const command = relayCommand(f.deps), go = (text: string) => command.execute({ sessionID: 'ses-1', prompt: { ...typed, text }, delivery: 'steer' } as never);
  await Promise.all([go('first'), go('second')]);
  assert.deepEqual(f.calls.filter(call => ['switchModel', 'prompt'].includes(call.name)).map(call => call.name === 'prompt' ? (call.input as any).text : (call.input as any).model.id), ['exec', 'first', 'plan', 'second']);
  assert.deepEqual([f.chat.agent, f.chat.model.id], ['plan', 'plan'], 'the second message saw what the first one did to the chat, so it left build');
  const g = fakeRelay({ fail: { prompt: new Error('inbox closed') } }), failing = relayCommand(g.deps);
  await assert.rejects(failing.execute({ sessionID: 'ses-1', prompt: typed, delivery: 'steer' } as never), /inbox closed/);
  await assert.rejects(failing.execute({ sessionID: 'ses-1', prompt: typed, delivery: 'steer' } as never), /inbox closed/);
  assert.equal(prompts(g).length, 2, 'a failed message does not block the next one in that chat');
});

test('the one typed first is sent first, even when its own chat read answers later than the second one\'s', async () => {
  const h = fakeRelay({ decision: request => ({ choice: request.input[0].text.includes('first') ? 'execute' : 'plan', confidence: 0.9 }) });
  let nth = 0; const get = h.deps.session.get;
  h.deps.session = { ...h.deps.session, get: async input => { const mine = ++nth; await sleep(mine === 1 ? 40 : 0); return get(input); } };
  const slow = relayCommand(h.deps), goSlow = (text: string) => slow.execute({ sessionID: 'ses-1', prompt: { ...typed, text }, delivery: 'steer' } as never);
  await Promise.all([goSlow('first'), goSlow('second')]);
  assert.deepEqual(prompts(h).map(p => (p as { text: string }).text), ['first', 'second']);
});

test('a host call that never answers still sends the message once, and does not jam a later message in the same chat', async () => {
  const f = fakeRelay({ readMs: 20 });
  f.deps.chatModels = () => new Promise(() => undefined);
  const command = relayCommand(f.deps);
  const first = command.execute({ sessionID: 'ses-1', prompt: typed, delivery: 'steer' } as never);
  assert.equal(await settles(first, 200), true, 'the first call must give up and send, not hang');
  const second = command.execute({ sessionID: 'ses-1', prompt: { ...typed, text: 'second' }, delivery: 'steer' } as never);
  assert.equal(await settles(second, 200), true, 'a later call in the same chat must not be jammed by the first');
  assert.deepEqual(prompts(f).map(p => (p as { text: string }).text), ['fix the login test', 'second']);
  assert.match((await last(f)).note!, /did not answer within 0\.02 seconds/);
});

test('a failure of storage, the chat lookup or the model list still sends once, unchanged', async () => {
  for (const [fail, note] of [[{ storageGet: new Error('storage offline') }, null], [{ get: new Error('no such chat') }, /the chat could not be read: no such chat/], [{ models: new Error('list failed') }, /the model list could not be read: list failed/], [{ storageSet: new Error('disk full') }, null], [{ remove: new Error('no') }, null]] as const) {
    const f = fakeRelay({ fail }); await run(f);
    assert.deepEqual(prompts(f), sent);
    if (note) { assert.deepEqual(switches(f), []); assert.match((await last(f)).note!, note); }
  }
  const offline = fakeRelay({ fail: { storageGet: new Error('storage offline') } }); await run(offline);
  assert.deepEqual([switches(offline), names(offline).includes('decisions')], [[], false], 'with no settings nothing is decided or switched');
  const quiet = fakeRelay({ fail: { remove: new Error('no entry') } }); await run(quiet);
  assert.equal((await last(quiet)).note, null, 'a failed remove is not reported');
});

test("the decider gets the text, whether the chat's agent can change files, and the names and sizes of the files; the record holds no message text and no file name", async () => {
  const f = fakeRelay(); await run(f);
  const request = JSON.stringify(input(f, 'decisions'));
  assert.match(request, /fix the login test/);
  assert.equal(asked(f), 'Before this message the chat was on a read-only agent, which explains and plans and cannot change files. Attached files: a.txt (2 kB). Attached pictures: 0.');
  assert.equal(/file:\/\/|\/repo|@a\.txt|\busual\b|\bexec\b|#high/.test(request), false, 'no address, no folder, no model name');
  assert.deepEqual(input(f, 'decisions').questions.map((question: { name: string }) => question.name), ['mode'], 'one model in each mode: nothing to choose');
  const record = await last(f);
  assert.deepEqual(Object.keys(record).sort(), ['at', 'confidence', 'costUsd', 'fit', 'kind', 'mode', 'model', 'ms', 'note', 'sessionID']);
  assert.deepEqual([record.kind, record.sessionID, record.mode, record.model, record.confidence, record.fit, record.costUsd, record.note], ['chat', 'ses-1', 'execute', 'p/exec#high', 0.98, null, '0', null]);
  assert.equal(/login|a\.txt/.test(JSON.stringify(record)), false);
});

test('in a mode with several models the line the decider chose picks the model', async () => {
  const settings = execute(entry('exec', 'high', 'small, clear changes'), entry('usual', null, 'large changes across many files'), entry('eyes'));
  const f = fakeRelay({ settings, chat: { model: { providerID: 'p', id: 'plan' } }, decision: { choice: 'execute', confidence: 0.9, lines: { execute: { choice: '2', confidence: 0.8 } } } }); await run(f);
  const question = input(f, 'decisions').questions[1];
  assert.deepEqual([question.name, question.choices], ['execute_line', [{ value: '1', description: 'small, clear changes' }, { value: '2', description: 'large changes across many files' }, { value: 'none', description: 'None of these fits clearly.' }]]);
  assert.deepEqual(input(f, 'switchModel').model, { providerID: 'p', id: 'usual' });
  const record = await last(f);
  assert.deepEqual([record.mode, record.model, record.fit, record.note], ['execute', 'p/usual', 0.8, null]);
});

test('when no line fits, the chat keeps its model if the mode lists it, and else the first is used', async () => {
  const settings = execute(entry('exec', 'high', 'small, clear changes'), entry('usual', null, 'large changes across many files'));
  const decision = { choice: 'execute', confidence: 0.9, lines: { execute: { choice: 'none', confidence: 0.9 } } };
  const stays = fakeRelay({ settings, decision }); await run(stays);          // the chat is on p/usual
  assert.deepEqual(switches(stays), ['switchAgent', 'remove']);
  assert.deepEqual([(await last(stays)).model, (await last(stays)).note], ['p/usual', 'no line fits clearly, so the chat\'s model stays']);
  const moves = fakeRelay({ settings, decision, chat: { model: { providerID: 'p', id: 'plan' } } }); await run(moves);
  assert.deepEqual(input(moves, 'switchModel').model, { providerID: 'p', id: 'exec', variant: 'high' });
  assert.equal((await last(moves)).note, 'no line fits clearly, so the first model is used');
  const silent = fakeRelay({ settings, decision: { choice: 'execute', confidence: 0.9 } }); await run(silent);
  assert.equal((await last(silent)).note, 'no answer about the lines, so the chat\'s model stays');
});

test('files that do not fit leave a model out; a size that cannot be read counts as nothing, and reading gives up after its limit', async () => {
  const settings = execute(entry('small'), entry('exec', 'high'));
  const big = fakeRelay({ settings, sizes: { 'file:///repo/a.txt': 8000 } }); await run(big);       // about 2,000 tokens; p/small holds 1,000
  assert.deepEqual(input(big, 'switchModel').model, { providerID: 'p', id: 'exec', variant: 'high' });
  assert.match(asked(big), /a\.txt \(8 kB\)/);
  const only = fakeRelay({ settings: execute(entry('small')), sizes: { 'file:///repo/a.txt': 8000 } }); await run(only);
  assert.deepEqual([switches(only), (await last(only)).note], [[], 'the attached files are too big for every chosen Execute model']);
  for (const size of [null, new Error('no such file'), 'never'] as const) {
    const started = Date.now(), f = fakeRelay({ settings, sizes: { 'file:///repo/a.txt': size }, sizeMs: 30 }); await run(f);
    assert.deepEqual(input(f, 'switchModel').model, { providerID: 'p', id: 'small' }, String(size));
    assert.match(asked(f), /a\.txt \(size unknown\)/);
    assert.deepEqual(prompts(f), sent); assert.ok(Date.now() - started < 1000);
  }
});

test('a file with no name is named by the last part of its address, never by its content or by what follows a ? or #', async () => {
  const f = fakeRelay(); await run(f, { ...typed, files: [{ uri: 'file:///repo/src/notes.md' }, {}, { uri: 'data:text/plain;base64,SGVsbG8=' }, { uri: 'https://example.test/docs/guide.md?token=hidden#top' }] });
  assert.match(asked(f), /Attached files: notes\.md \(2 kB\), file \(size unknown\), file \(2 kB\), guide\.md \(2 kB\)\./);
  assert.equal(/SGVsbG8|hidden|example\.test/.test(JSON.stringify(input(f, 'decisions'))), false);
});

test('only a file on this machine is sized: an address that names another machine is never opened', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'relay-size-')), file = join(folder, 'five.txt');
  try {
    writeFileSync(file, 'hello');
    assert.equal(await fileSize(pathToFileURL(file).href), 5);
    assert.equal(localPath(pathToFileURL(file).href), file);
    for (const uri of ['file://server/share/a.txt', 'https://example.test/a.txt', 'data:text/plain,hi', 'not an address', '']) { assert.equal(localPath(uri), null, uri); assert.equal(await fileSize(uri), null, uri); }
    await assert.rejects(fileSize(pathToFileURL(join(folder, 'missing.txt')).href));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
