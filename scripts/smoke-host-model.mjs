// Real-host smoke: the packed plugin, installed the way npm installs a package, in an isolated OpenCode 2.3.0 server that talks to a FREE
// loopback mock provider. No credential, paid provider or real profile is involved; the only key is a synthetic string the mock checks.
// Needs `npm run build` and RELAY_SMOKE_CLI pointing at an `opencode` 2.3.0 binary (default: `opencode` on the PATH).
// It checks that the plugin loads and lists models; sends one `/relay` message in a normal chat with no decider chosen (no switch, one request,
// one record, and what the reply took); turns that chat's switch on with `/relay on`, keeps it across a server restart, and checks what the
// `prompt` hook records; then turns it off with `/relay off`. Then, with a MOCK decision model as the decider and mock models that list prices:
// a real switch of agent and model, what each reply took as OpenCode kept it (the model that answered, every request added up, and that
// model's listed prices), the whole chat fitting the model, and the stay-or-go check.
// It does NOT exercise a real model or a real decider, a real cache, a helper, or the Desktop panel.
import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { OpenCode } from '@opencode/client/promise';

const execFile = promisify(execFileCallback);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.RELAY_SMOKE_CLI ?? 'opencode';
const password = 'synthetic-local-smoke', apiKey = 'synthetic-key-not-real';
if (!existsSync(join(repo, 'dist', 'index.js'))) throw new Error('Run `npm run build` first');
const root = await mkdtemp(join(tmpdir(), 'relay-model-')), project = join(root, 'project');
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'SystemRoot', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(baseEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
const sleep = ms => new Promise(done => setTimeout(done, ms));
// Installing the packed plugin pulls about 270 packages; on GitHub's Windows runners that took over four minutes once (18 Nov).
const npm = (args, cwd) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, shell: process.platform === 'win32', timeout: 600_000, env: baseEnv });
const free = async () => { const l = createServer(); l.listen(0, '127.0.0.1'); await once(l, 'listening'); const { port } = l.address(); await new Promise(d => l.close(d)); return port; };
const observed = []; const note = (label, value) => observed.push(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

// The mock provider: records each request and answers in the OpenAI-compatible streaming format.
const requests = [];
/** What each request looked like, cut short: enough to tell a chat turn from another kind of request, without the host's whole system text. */
const shapes = [];
/** What the mock says next: the tokens a chat request read (in all, and from a cache), and what the mock decider chooses. */
let usage = { prompt: 10, cached: 0 }, decision = { mode: 'execute', line: '1' };
/** The choices each decider request offered, by question name. */
const asked = [];
const mock = createHttpServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let input = {}; try { input = JSON.parse(body); } catch { /* ignore */ }
    if (req.url?.endsWith('/systemone')) {
      // The mock decider, in the System One format that OpenCode's own free decision model uses: one answer for each question, by its name.
      const questions = Object.entries(input.questions ?? {});
      asked.push(Object.fromEntries(questions.map(([name, question]) => [name, Object.keys(question.criteria ?? {})])));
      const answers = Object.fromEntries(questions.map(([name, question]) => {
        const keys = Object.keys(question.criteria ?? {}), choice = name === 'mode' ? decision.mode : decision.line;
        return [name, { type: 'choice', choice, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 0.93 : 0.07 / Math.max(1, keys.length - 1)])), confidence: 0.93 }];
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ model: input.model, answers, usage: { input_tokens: 400, output_tokens: 30, cost: 0 } }));
    }
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const text = message => typeof message?.content === 'string' ? message.content : Array.isArray(message?.content) ? message.content.map(part => part?.text ?? '').join(' ') : '';
    if (req.url?.endsWith('/chat/completions')) {
      requests.push({ model: input.model, stream: input.stream, authorized: req.headers.authorization === `Bearer ${apiKey}` });
      shapes.push({ model: input.model, roles: messages.map(message => message.role).join(','), tools: input.tools?.length ?? 0, system: text(messages.find(message => message.role === 'system')).slice(0, 60), last: text(messages.at(-1)).slice(0, 80) });
    }
    // A message that says TOOLCALL makes the mock ask for a file first, so that reply takes two requests.
    const tool = messages.at(-1)?.role === 'user' && text(messages.at(-1)).includes('TOOLCALL');
    const base = { id: 'chatcmpl-smoke', object: 'chat.completion.chunk', created: 1, model: input.model };
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_smoke_1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'a.txt' }) } }] } : { role: 'assistant', content: 'Hello from the mock model.' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: usage.prompt, completion_tokens: 5, total_tokens: usage.prompt + 5, prompt_tokens_details: { cached_tokens: usage.cached } } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
const mockPort = await free(); mock.listen(mockPort, '127.0.0.1'); await once(mock, 'listening');

// Every run of the host binary, the version read included, gets the scratch directories, so nothing is read from or written to a real profile.
const isolated = { ...baseEnv, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_SERVER_PASSWORD: password, SMOKE_API_KEY: apiKey };
let server;
async function start() {
  const port = await free();
  const child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env: isolated, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, log: '' };
  child.stdout.on('data', chunk => { instance.log += chunk.toString(); }); child.stderr.on('data', chunk => { instance.log += chunk.toString(); });
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
  const deadline = Date.now() + 120_000; let plugins;
  const loaded = () => (plugins?.data ?? []).some(item => JSON.stringify(item).includes('relay-opencode'));
  while (Date.now() < deadline && !loaded()) {
    if (child.exitCode !== null) throw new Error(`OpenCode exited: ${instance.log.slice(-1500)}`);
    try { plugins = await client.plugin.list({ location: { directory: project } }, { signal: AbortSignal.timeout(2000) }); } catch { /* not ready */ }
    if (!loaded()) await sleep(300);
  }
  if (!loaded()) throw new Error(`Plugin did not load: ${instance.log.slice(-1500)}`);
  return { ...instance, client };
}
async function stop(instance) {
  const { child } = instance ?? {}; if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'), escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.kill('SIGTERM'); try { await exited; } finally { clearTimeout(escalation); }
}

try {
  await Promise.all(['project', 'config', 'data', 'cache', 'state'].map(name => mkdir(join(root, name), { recursive: true })));
  const git = async (...args) => (await execFile('git', ['-C', project, ...args], { timeout: 20_000, env: baseEnv })).stdout.trim();
  await git('init', '-q'); await writeFile(join(project, 'a.txt'), 'one\n'); await git('add', 'a.txt');
  await git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'synthetic baseline');
  const pack = JSON.parse((await npm(['pack', '--json', '--pack-destination', root], repo)).stdout)[0];
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'smoke-project', private: true }));
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', join(root, pack.filename)], project);
  const price = (input, output, read, write) => ({ input, output, cache: { read, write } });
  await writeFile(join(project, 'opencode.json'), JSON.stringify({
    plugins: ['./node_modules/relay-opencode'],
    // A normal chat carries the host's whole system text and tools, so the model needs room or the host compacts before the first turn.
    providers: { smoke: { name: 'Smoke', package: '@ai-sdk/openai-compatible', env: ['SMOKE_API_KEY'], settings: { baseURL: `http://127.0.0.1:${mockPort}/v1` },
      models: {
        'model-chat': { name: 'Model Chat', limit: { context: 200000, output: 1000 } },
        // Priced like the worked example in the cost report: a dear model and one at half its price. `model-small` holds 40,000 tokens.
        'model-big': { name: 'Model Big', limit: { context: 200000, output: 1000 }, cost: price(4, 20, 0.2, 5) },
        'model-cheap': { name: 'Model Cheap', limit: { context: 200000, output: 1000 }, cost: price(2, 10, 0.1, 2.5) },
        'model-small': { name: 'Model Small', limit: { context: 40000, output: 1000 }, cost: price(0.1, 0.5, 0.01, 0.125) },
        // A mock decision model. With this package the host calls it at /systemone (found on 18 Nov; a chat model cannot be a decider).
        'model-judge': { name: 'Model Judge', type: 'decision', package: '@opencode/ai/providers/openai-compatible/decisions', limit: { context: 32000, output: 1000 } },
      } } },
  }));
  const { RelayRpc } = await import(pathToFileURL(join(project, 'node_modules', 'relay-opencode', 'dist', 'rpc.js')).href);
  server = await start();
  const options = { location: { directory: project } };
  const rpc = () => server.client.rpc(RelayRpc);

  // The mock model must show up, enabled, before a chat can use it.
  let found; const seen = Date.now() + 60_000;
  while (Date.now() < seen) { found = (await rpc().listModels({}, options)).models.find(model => model.providerID === 'smoke' && model.id === 'model-chat'); if (found?.enabled) break; await sleep(500); }
  assert.ok(found?.enabled, `smoke/model-chat did not become available: ${JSON.stringify(found)}`); note('mock model', { enabled: found.enabled, limit: found.limit });

  /** The records of one chat, newest first, once there are more than `had` of them and the newest says what its reply took (or after 30 seconds). */
  const recordsOf = async (sessionID, had = -1) => {
    const until = Date.now() + 30_000; let mine = [];
    do { mine = (await rpc().getRelayDecisions({}, options)).decisions.filter(item => item.sessionID === sessionID); if (mine.length > had && mine[0]?.reply) break; await sleep(500); } while (Date.now() < until);
    return mine;
  };

  // `/relay` in a normal chat with no decider chosen: the real host has the command, the message reaches the chat's own (mock) model once,
  // the chat stays as it was, and the decision is recorded with what the reply took.
  const chat = await server.client.session.create({ model: { providerID: 'smoke', id: 'model-chat' }, location: options.location, title: 'relay smoke' });
  const before = requests.length;
  const refusal = await server.client.session.command({ sessionID: chat.id, name: 'relay', text: ' ' }).then(() => null, error => error);
  note('blank /relay was refused with', String(refusal?.message ?? refusal));
  assert.match(`${refusal?.message} ${JSON.stringify(refusal)}`, /type your message after \/relay/);
  await server.client.session.command({ sessionID: chat.id, name: 'relay', text: 'Say hello.' });
  const answered = Date.now() + 240_000;
  while (Date.now() < answered && requests.length === before) await sleep(300);
  await server.client.experimental.session.wait({ sessionID: chat.id }); await sleep(1000);
  assert.equal(requests.length, before + 1, `/relay made ${requests.length - before} model requests, expected exactly one`);
  assert.deepEqual({ model: requests[before].model, authorized: requests[before].authorized }, { model: 'model-chat', authorized: true });
  assert.ok(shapes[before].last.includes('Say hello.'), `the typed text did not arrive as the last message: ${shapes[before].last}`);
  const relayed = await rpc().getRelay({}, options);
  assert.deepEqual(relayed.decisions.map(item => [item.kind, item.sessionID, item.mode, item.model, item.note]), [['chat', chat.id, null, null, 'no decider chosen']]);
  assert.deepEqual([relayed.settings.revision, relayed.checks], [0, { active: false, note: 'no decider chosen' }]);
  note('decision models this host lists', relayed.deciders.map(model => `${model.providerID}/${model.id}`));
  // What the reply took is read from the chat when it goes idle: the mock reported 10 tokens read, none from a cache, and this model lists no price.
  const [unplaced] = await recordsOf(chat.id);
  note('what the reply to /relay took', unplaced?.reply);
  assert.deepEqual([unplaced?.reply?.requests, unplaced?.reply?.fresh, unplaced?.reply?.cached, unplaced?.reply?.costUsd, typeof unplaced?.reply?.seconds], [1, 10, 0, '0', 'number']);
  const unpriced = { inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, cacheWritePerMillion: null };
  assert.deepEqual([unplaced?.reply?.model, unplaced?.reply?.total, unplaced?.reply?.prices], ['smoke/model-chat', { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, costUsd: '0' }, unpriced]);
  const idleFrom = Date.now(); await server.client.experimental.session.wait({ sessionID: chat.id });
  note('wait on an idle chat took (ms)', Date.now() - idleFrom);
  assert.ok(Date.now() - idleFrom < 5000, 'wait on an idle chat must return at once');
  const settled = await server.client.session.get({ sessionID: chat.id });
  assert.deepEqual([settled.model?.providerID, settled.model?.id], ['smoke', 'model-chat'], 'with no decider the chat stays on its own model');

  // The switch: `/relay on` makes the `prompt` hook place every message of this chat; `/relay off` stops it. With no decider nothing is switched,
  // but each placed message is recorded, and a `/relay` message is decided once, not twice. One model request for each message either way.
  const records = async () => (await rpc().getRelay({}, options)).decisions.filter(item => item.sessionID === chat.id).length;
  const send = async (work, label) => {
    const from = requests.length; await work();
    const until = Date.now() + 240_000; while (Date.now() < until && requests.length === from) await sleep(300);
    await server.client.experimental.session.wait({ sessionID: chat.id }); await sleep(1000);
    assert.equal(requests.length, from + 1, `${label}: ${requests.length - from} model requests, expected exactly one`);
  };
  await server.client.session.command({ sessionID: chat.id, name: 'relay', text: 'on' });
  assert.equal((await rpc().getRelayChat({ sessionID: chat.id }, options)).on, true, '/relay on turned the switch on');
  // The switch lives in plugin storage, not in memory, so it outlives a server restart.
  await stop(server); server = await start();
  assert.equal((await rpc().getRelayChat({ sessionID: chat.id }, options)).on, true, 'the switch survived a server restart');
  const before1 = await records();
  await send(() => server.client.session.prompt({ sessionID: chat.id, text: 'A plain message with the switch on.' }), 'plain message, switch on');
  assert.equal(await records(), before1 + 1, 'the hook placed and recorded the plain message');
  await send(() => server.client.session.command({ sessionID: chat.id, name: 'relay', text: 'Say hi again.' }), '/relay with the switch on');
  assert.equal(await records(), before1 + 2, 'a /relay message with the switch on is decided once');
  await server.client.session.command({ sessionID: chat.id, name: 'relay', text: 'off' });
  assert.equal((await rpc().getRelayChat({ sessionID: chat.id }, options)).on, false, '/relay off turned it off');
  await send(() => server.client.session.prompt({ sessionID: chat.id, text: 'A plain message with the switch off.' }), 'plain message, switch off');
  assert.equal(await records(), before1 + 2, 'with the switch off nothing is placed');
  note('switch', 'on: kept across a restart, one record per plain message, a /relay message decided once; off: none');

  // ---- With a decider (a mock decision model): a real switch, what each reply took, the whole chat fitting the model, and stay or go. ----
  const of = id => ({ providerID: 'smoke', id, variant: null });
  const saved = await rpc().saveRelay({ revision: 0, decider: of('model-judge'), modes: {
    plan: [{ ...of('model-big'), useFor: 'thinking and design' }], review: [{ ...of('model-big'), useFor: '' }],
    execute: [{ ...of('model-big'), useFor: 'large changes across many files' }, { ...of('model-cheap'), useFor: 'small, clear changes' }, { ...of('model-small'), useFor: 'one-line fixes' }],
  } }, options);
  assert.equal(saved.settings.decider?.id, 'model-judge', 'the mock decision model was accepted as the decider');
  const big = (await rpc().listModels({}, options)).models.find(model => model.providerID === 'smoke' && model.id === 'model-big');
  note('the prices Relay reads for model-big', big?.cost);
  assert.deepEqual(big?.cost, { inputPerMillion: '4', outputPerMillion: '20', cacheReadPerMillion: '0.2', cacheWritePerMillion: '5', tiered: false, steps: [] });

  const long = await server.client.session.create({ model: { providerID: 'smoke', id: 'model-big' }, location: options.location, title: 'relay smoke: stay or go' });
  const relay = text => server.client.session.command({ sessionID: long.id, name: 'relay', text });
  /** One message in the long chat: the mock decider chooses `choose`, the mock model reports `reads`, and the chat's newest record comes back once it says what the reply took. */
  const turn = async (label, choose, reads, work, modelRequests = 1) => {
    decision = choose; usage = reads;
    const from = requests.length, deciderRequests = asked.length, had = (await recordsOf(long.id)).length;
    await work();
    const until = Date.now() + 240_000; while (Date.now() < until && requests.length < from + modelRequests) await sleep(300);
    await server.client.experimental.session.wait({ sessionID: long.id });
    const [record] = await recordsOf(long.id, had);
    note(label, { model: record?.model, note: record?.note, reply: record?.reply, sentTo: requests.slice(from).map(request => request.model), linesAsked: asked.at(-1)?.execute_line });
    assert.equal(requests.length, from + modelRequests, `${label}: ${requests.length - from} model requests, expected ${modelRequests}`);
    assert.equal(asked.length, deciderRequests + 1, `${label}: ${asked.length - deciderRequests} decider requests, expected exactly one`);
    assert.ok(record?.reply, `${label}: the record does not say what the reply took: ${JSON.stringify(record)}`);
    return record;
  };

  // A new chat has nothing to lose, so the line is followed: Execute puts the chat on the `build` agent and on the cheaper model.
  const down = await turn('new chat, the line of the cheaper model', { mode: 'execute', line: '2' }, { prompt: 20_000, cached: 15_000 }, () => relay('Rename the variable.'));
  assert.deepEqual([down.mode, down.model, down.note, requests.at(-1).model], ['execute', 'smoke/model-cheap', null, 'model-cheap']);
  assert.deepEqual(asked.at(-1).execute_line, ['1', '2', '3', 'none'], 'a new chat fits all three Execute models');
  const moved = await server.client.session.get({ sessionID: long.id });
  assert.deepEqual([moved.agent, moved.model?.id], ['build', 'model-cheap']);
  // The mock reported 20,000 tokens read, 15,000 of them from a cache, and 5 written, at $2 / $0.10 / $10 for a million.
  assert.deepEqual({ ...down.reply, seconds: typeof down.reply.seconds }, {
    requests: 1, fresh: 5000, cached: 15_000, costUsd: '0.01155', seconds: 'number', model: 'smoke/model-cheap', total: { input: 5000, output: 5, reasoning: 0, cacheRead: 15_000, cacheWrite: 0, costUsd: '0.01155' },
    prices: { inputPerMillion: '2', outputPerMillion: '10', cacheReadPerMillion: '0.1', cacheWritePerMillion: '2.5' },
  });

  // A step up is what the line asked for: it is made, and the record says what it took.
  const up = await turn('the line of the dearer model: a step up', { mode: 'execute', line: '1' }, { prompt: 60_000, cached: 58_000 }, () => relay('Now the large change.'));
  assert.deepEqual([up.model, up.note, requests.at(-1).model, up.reply.fresh, up.reply.cached], ['smoke/model-big', null, 'model-big', 2000, 58_000]);

  // The chat now holds 60,005 tokens. It does not fit the model of 40,000, so that model's line is not asked about; and the step down to the
  // cheaper model does not pay (it would read 40,000 tokens again, having answered at 20,005), so the chat's model stays for this message.
  const stayed = "moving this chat to smoke/model-cheap would cost about $0.10 to read it again and save about $0.09 over 6 requests, so the chat's model stays";
  const stay = await turn('long chat, the line of the cheaper model: a step down that does not pay', { mode: 'execute', line: '2' }, { prompt: 60_500, cached: 60_005 }, () => relay('Rename one more variable.'));
  assert.deepEqual(asked.at(-1).execute_line, ['1', '2', 'none'], 'the model the chat does not fit is not offered to the decider');
  assert.deepEqual([stay.mode, stay.model, stay.note, requests.at(-1).model], ['execute', 'smoke/model-big', stayed, 'model-big']);

  // The switch's hook weighs a plain message the same way, and its record names the message, so its reply is read too.
  await relay('on');
  const plain = await turn('switch on, a plain message, the line of the cheaper model', { mode: 'execute', line: '2' }, { prompt: 61_000, cached: 60_505 }, () => server.client.session.prompt({ sessionID: long.id, text: 'And one more rename.' }));
  assert.deepEqual([plain.model, plain.note, requests.at(-1).model, plain.reply.requests, plain.reply.fresh, plain.reply.cached], ['smoke/model-big', stayed, 'model-big', 1, 495, 60_505]);
  await relay('off');

  // A reply in which the model first reads a file takes two requests, and is counted as two.
  const tooled = await turn('a reply with a tool call', { mode: 'execute', line: '1' }, { prompt: 62_000, cached: 61_000 }, () => relay('TOOLCALL: read a.txt, then answer.'), 2);
  assert.deepEqual([tooled.reply.requests, tooled.reply.fresh, tooled.reply.cached], [2, 1000, 61_000]);
  // The whole reply adds up both requests (each read 62,000 tokens, 61,000 of them from a cache, and wrote 5), at $4 / $0.20 / $20 for a million.
  assert.deepEqual([tooled.reply.model, tooled.reply.total, tooled.reply.prices], ['smoke/model-big', { input: 2000, output: 10, reasoning: 0, cacheRead: 122_000, cacheWrite: 0, costUsd: '0.0326' }, { inputPerMillion: '4', outputPerMillion: '20', cacheReadPerMillion: '0.2', cacheWritePerMillion: '5' }]);

  const version = (await execFile(cli, ['--version'], { timeout: 20_000, env: isolated })).stdout.trim();
  console.log(`PASS: on stock ${version} (${process.platform}) the packed plugin loaded from node_modules; /relay with no decider sent one message to the chat's own mock model and recorded it and what its reply took; /relay on kept the switch across a restart and placed each plain message once; /relay off stopped it; with a mock decider, /relay switched the agent and the model, a chat too long for a model was not offered it, a step down that did not pay left the chat on its model, and each record says what the reply took: the model that answered, every request added up, and that model's listed prices`);
  for (const line of observed) console.log(`OBSERVED ${line}`);
  console.log('LIMIT: mock models and a mock decider only, so the tokens, prices and cache reads are what the mock reported, not what a provider charged; no real cache, no helper, and no Desktop panel was exercised');
} catch (error) {
  for (const line of observed) console.error(`OBSERVED ${line}`);
  console.error(`MOCK REQUESTS: ${JSON.stringify(requests)}`);
  console.error(`MOCK REQUEST SHAPES: ${JSON.stringify(shapes)}`);
  if (server) console.error(`SERVER LOG TAIL:\n${server.log.slice(-1800)}`);
  throw error;
} finally {
  await stop(server); await new Promise(done => mock.close(done));
  // On Windows the folder can stay locked for a moment after the server exits (EBUSY in CI, 17 Nov); a leftover scratch folder is not a failure.
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(error => console.warn(`WARN: could not remove the scratch folder: ${error?.code ?? error}`));
}
