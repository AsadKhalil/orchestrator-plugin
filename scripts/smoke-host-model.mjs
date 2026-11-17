// Real-host smoke: the packed plugin, installed the way npm installs a package, in an isolated OpenCode 2.3.0 server that talks to a FREE
// loopback mock provider. No credential, paid provider or real profile is involved; the only key is a synthetic string the mock checks.
// Needs `npm run build` and FEATURE_PILOT_SMOKE_CLI pointing at an `opencode` 2.3.0 binary (default: `opencode` on the PATH).
// It checks that the plugin loads and lists models; sends one `/relay` message in a normal chat with no decider chosen (no switch, one request,
// one record); turns that chat's switch on with `/relay on`, keeps it across a server restart, and checks what the `prompt` hook records; then
// turns it off with `/relay off`. It does NOT exercise a real switch (that needs a decision model), a helper, or the Desktop panel.
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
const cli = process.env.FEATURE_PILOT_SMOKE_CLI ?? 'opencode';
const password = 'synthetic-local-smoke', apiKey = 'synthetic-key-not-real';
if (!existsSync(join(repo, 'dist', 'index.js'))) throw new Error('Run `npm run build` first');
const root = await mkdtemp(join(tmpdir(), 'feature-pilot-model-')), project = join(root, 'project');
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'SystemRoot', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(baseEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
const sleep = ms => new Promise(done => setTimeout(done, ms));
const npm = (args, cwd) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, shell: process.platform === 'win32', timeout: 240_000, env: baseEnv });
const free = async () => { const l = createServer(); l.listen(0, '127.0.0.1'); await once(l, 'listening'); const { port } = l.address(); await new Promise(d => l.close(d)); return port; };
const observed = []; const note = (label, value) => observed.push(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

// The mock provider: records each request and answers in the OpenAI-compatible streaming format.
const requests = [];
/** What each request looked like, cut short: enough to tell a chat turn from another kind of request, without the host's whole system text. */
const shapes = [];
const mock = createHttpServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let input = {}; try { input = JSON.parse(body); } catch { /* ignore */ }
    if (req.url?.endsWith('/chat/completions')) {
      requests.push({ model: input.model, stream: input.stream, authorized: req.headers.authorization === `Bearer ${apiKey}` });
      const messages = Array.isArray(input.messages) ? input.messages : [];
      const text = message => typeof message?.content === 'string' ? message.content : Array.isArray(message?.content) ? message.content.map(part => part?.text ?? '').join(' ') : '';
      shapes.push({ model: input.model, roles: messages.map(message => message.role).join(','), tools: input.tools?.length ?? 0, system: text(messages.find(message => message.role === 'system')).slice(0, 60), last: text(messages.at(-1)).slice(0, 80) });
    }
    const base = { id: 'chatcmpl-smoke', object: 'chat.completion.chunk', created: 1, model: input.model };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello from the mock model.' }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
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
  const loaded = () => (plugins?.data ?? []).some(item => JSON.stringify(item).includes('feature-pilot'));
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
  await writeFile(join(project, 'opencode.json'), JSON.stringify({
    plugins: ['./node_modules/feature-pilot'],
    // A normal chat carries the host's whole system text and tools, so the model needs room or the host compacts before the first turn.
    providers: { smoke: { name: 'Smoke', package: '@ai-sdk/openai-compatible', env: ['SMOKE_API_KEY'], settings: { baseURL: `http://127.0.0.1:${mockPort}/v1` },
      models: { 'model-chat': { name: 'Model Chat', limit: { context: 200000, output: 1000 } } } } },
  }));
  const { FeaturePilot } = await import(pathToFileURL(join(project, 'node_modules', 'feature-pilot', 'dist', 'rpc.js')).href);
  server = await start();
  const options = { location: { directory: project } };
  const rpc = () => server.client.rpc(FeaturePilot);

  // The mock model must show up, enabled, before a chat can use it.
  let found; const seen = Date.now() + 60_000;
  while (Date.now() < seen) { found = (await rpc().listModels({}, options)).models.find(model => model.providerID === 'smoke' && model.id === 'model-chat'); if (found?.enabled) break; await sleep(500); }
  assert.ok(found?.enabled, `smoke/model-chat did not become available: ${JSON.stringify(found)}`); note('mock model', { enabled: found.enabled, limit: found.limit });

  // `/relay` in a normal chat with no decider chosen: the real host has the command, the message reaches the chat's own (mock) model once,
  // the chat stays as it was, and the decision is recorded. The switch itself needs a decision model, which no mock can be, so it is not run here.
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

  const version = (await execFile(cli, ['--version'], { timeout: 20_000, env: isolated })).stdout.trim();
  console.log(`PASS: on stock ${version} (${process.platform}) the packed plugin loaded from node_modules; /relay with no decider sent one message to the chat's own mock model and recorded it; /relay on kept the switch across a restart and placed each plain message once; /relay off stopped it`);
  for (const line of observed) console.log(`OBSERVED ${line}`);
  console.log('LIMIT: mock provider only; no decision model (so no real switch), no helper, and no Desktop panel was exercised');
} catch (error) {
  for (const line of observed) console.error(`OBSERVED ${line}`);
  console.error(`MOCK REQUESTS: ${JSON.stringify(requests)}`);
  console.error(`MOCK REQUEST SHAPES: ${JSON.stringify(shapes)}`);
  if (server) console.error(`SERVER LOG TAIL:\n${server.log.slice(-1800)}`);
  throw error;
} finally {
  await stop(server); await new Promise(done => mock.close(done));
  await rm(root, { recursive: true, force: true });
}
