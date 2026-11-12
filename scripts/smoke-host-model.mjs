// Real-host model-turn smoke: the packed plugin in an isolated OpenCode 2.2.7 server talking to a FREE loopback mock provider.
// It proves that, on a host without atomic storage, the local-file budget ledger lets a planner turn reach a model and that a budget too
// small for the worst case stops a request before it is sent. No credential, paid provider or real profile is involved; the only key is a
// synthetic string the mock checks. Needs `npm run build` and FEATURE_PILOT_SMOKE_CLI pointing at an `opencode` 2.2.7 binary.
// It does NOT exercise the coder, reviewer, shell tool, permissions beyond the planner's, or the Desktop panel.
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

// The mock provider: records each request and answers a planner question reply in the OpenAI-compatible streaming format.
const requests = [];
const mock = createHttpServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let input = {}; try { input = JSON.parse(body); } catch { /* ignore */ }
    if (req.url?.endsWith('/chat/completions')) requests.push({ model: input.model, effort: input.reasoning_effort, stream: input.stream, authorized: req.headers.authorization === `Bearer ${apiKey}` });
    const reply = JSON.stringify({ kind: 'questions', questions: [{ id: 'q1', question: 'Which option should the feature use?' }] });
    const base = { id: 'chatcmpl-smoke', object: 'chat.completion.chunk', created: 1, model: input.model };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
const mockPort = await free(); mock.listen(mockPort, '127.0.0.1'); await once(mock, 'listening');

let server;
async function start() {
  const port = await free();
  const env = { ...baseEnv, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_SERVER_PASSWORD: password, SMOKE_API_KEY: apiKey };
  const child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, log: '' };
  child.stdout.on('data', chunk => { instance.log += chunk.toString(); }); child.stderr.on('data', chunk => { instance.log += chunk.toString(); });
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
  const deadline = Date.now() + 60_000; let plugins;
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
    providers: { smoke: { name: 'Smoke', package: '@ai-sdk/openai-compatible', env: ['SMOKE_API_KEY'], settings: { baseURL: `http://127.0.0.1:${mockPort}/v1` },
      models: { 'model-one': { name: 'Model One', limit: { context: 8000, output: 1000 }, variants: [{ id: 'high', settings: { reasoningEffort: 'high' } }] }, 'model-two': { name: 'Model Two', limit: { context: 8000, output: 1000 } } } } },
  }));
  const { FeaturePilot } = await import(pathToFileURL(join(project, 'node_modules', 'feature-pilot', 'dist', 'rpc.js')).href);
  server = await start();
  const options = { location: { directory: project } };
  const rpc = () => server.client.rpc(FeaturePilot);

  // The mock model must show up, enabled, with its variant, before anything can be selected.
  let found; const seen = Date.now() + 60_000;
  while (Date.now() < seen) { const models = (await rpc().listModels({}, options)).models; found = models.find(model => model.providerID === 'smoke' && model.id === 'model-one'); if (found?.enabled && models.some(model => model.providerID === 'smoke' && model.id === 'model-two' && model.enabled)) break; await sleep(500); }
  assert.ok(found?.enabled, `smoke/model-one did not become available: ${JSON.stringify(found)}`); note('mock model', { enabled: found.enabled, variants: found.variants, limit: found.limit });

  const choice = { providerID: 'smoke', id: 'model-one', variant: 'high' }, reviewer = { providerID: 'smoke', id: 'model-two', variant: null };
  // The run needs a route for every role before it plans; the reviewer uses a different (pretend) vendor.
  await rpc().saveSelections({ revision: 0, roles: { planner: [choice], coder: [choice], reviewer: [reviewer] } }, options);
  const rate = { inputPerMillion: '3', outputPerMillion: '15', cacheReadPerMillion: null, cacheWritePerMillion: null, billing: 'metered_api', serviceTier: 'standard', interactive: true, conditions: [], evidence: { sourceURL: 'https://example.com/synthetic-price', checkedAt: '2026-11-12T00:00:00Z', kind: 'user_entered', verified: false } };
  await rpc().savePolicy({ revision: 0, maxOutputTokens: 1000, coderEnabled: false, routes: [{ ...choice, vendor: 'smoke', canonicalID: 'smoke-model-one', modelVersion: '1', rate }, { ...reviewer, vendor: 'other', canonicalID: 'other-model-two', modelVersion: '1', rate }] }, options);
  // Worst case of one request = 8000 context tokens x $3/M + 1000 output tokens x $15/M = $0.039.
  assert.equal((await rpc().setBudget({ scope: 'monthly', runID: null, amount: '5', revision: 0 }, options)).monthly.revision, 1);

  const drive = async (requirement, featureBudget) => {
    const run = (await rpc().createDraft({ requirement }, options)).run;
    await rpc().setBudget({ scope: 'feature', runID: run.id, amount: featureBudget, revision: 0 }, options);
    await rpc().driveDraft({ id: run.id, autonomous: false }, options);
    let state; const until = Date.now() + 240_000; // the host's first use of a provider can take over a minute
    while (Date.now() < until) { state = (await rpc().getDraft({ id: run.id }, options)).run; if (state.attention || !['planning'].includes(state.state)) break; await sleep(300); }
    return { run, state };
  };

  // A budget below the worst case must stop the request before it is sent.
  const tight = await drive('Tight budget feature', '0.01');
  note('tight budget run stopped with', tight.state.attention ?? tight.state.state);
  assert.equal(requests.length, 0, 'a budget below the worst case must not let a request out');
  assert.ok(tight.state.attention, 'the tight run should have paused with a reason');
  await rpc().stopDraft({ id: tight.run.id, revision: tight.state.revision }, options);

  // A budget above the worst case lets exactly one planner request through, recorded in the local ledger.
  const funded = await drive('Funded feature', '1');
  note('funded run stopped with', funded.state.attention ?? funded.state.state);
  assert.equal(requests.length, 1, `expected exactly one request, got ${requests.length}`);
  assert.deepEqual(requests[0], { model: 'model-one', effort: 'high', stream: true, authorized: true });
  const budget = await rpc().getBudget({ runID: funded.run.id }, options);
  note('ledger after the turn', { backend: budget.backend, featureUsage: budget.featureUsage, monthlyUsage: budget.monthlyUsage });
  assert.equal(funded.state.state, 'clarifying', `the planner's question reply was not accepted: ${funded.state.state}/${funded.state.attention}`);
  assert.match(JSON.stringify(funded.state.clarification), /Which option should the feature use/);
  assert.equal(budget.backend, 'local_file'); assert.equal(budget.featureUsage.pendingCount, 1);
  assert.equal(budget.featureUsage.pendingUsd, '0.039', 'the reservation is the worst case for one request');
  assert.equal(budget.monthlyUsage.pendingCount, 1, 'the refused request left no reservation behind');
  assert.ok(existsSync(join(root, 'data', 'opencode', 'feature-pilot', 'ledger.sqlite')));

  // The reservation outlives a server restart (it is in the file, not in memory), so spend cannot be forgotten.
  await stop(server); server = await start();
  const after = await rpc().getBudget({ runID: funded.run.id }, options);
  assert.deepEqual([after.featureUsage.pendingCount, after.featureUsage.pendingUsd], [1, '0.039'], 'the reservation survived the restart');

  console.log('PASS: on stock 2.2.7 the local-file ledger let one planner request reach the mock model, refused one that did not fit its budget, and kept the reservation across a restart');
  for (const line of observed) console.log(`OBSERVED ${line}`);
  console.log('LIMIT: mock provider only; no coder, reviewer, shell tool, worktree run, real pricing or Desktop panel was exercised');
} catch (error) {
  for (const line of observed) console.error(`OBSERVED ${line}`);
  console.error(`MOCK REQUESTS: ${JSON.stringify(requests)}`);
  if (server) console.error(`SERVER LOG TAIL:\n${server.log.slice(-1800)}`);
  throw error;
} finally {
  await stop(server); await new Promise(done => mock.close(done));
  await rm(root, { recursive: true, force: true });
}
