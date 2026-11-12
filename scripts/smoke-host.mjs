// Real-host smoke: pack the built plugin, install it into a disposable project, start the real OpenCode server in isolation and call the
// plugin's RPC through the external client. No model request is made and no credential is used. Needs `npm run build` first and
// FEATURE_PILOT_SMOKE_CLI pointing at an `opencode` 2.2.7 binary. It proves loading, RPC schemas, storage across a restart and the
// pre-model behaviour of the driver; it does NOT prove the model workflow, permissions, the shell tool or the Desktop panel.
import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { OpenCode } from '@opencode/client/promise';

const execFile = promisify(execFileCallback);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.FEATURE_PILOT_SMOKE_CLI ?? 'opencode';
const password = 'synthetic-local-smoke';
if (!existsSync(join(repo, 'dist', 'index.js'))) throw new Error('Run `npm run build` first');
const root = await mkdtemp(join(tmpdir(), 'feature-pilot-host-')), project = join(root, 'project');
const ledgerFile = join(root, 'data', 'opencode', 'feature-pilot', 'ledger.sqlite');
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'SystemRoot', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(baseEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
const servers = [], observed = [];
const note = (label, value) => { observed.push(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const npm = (args, cwd) => execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, shell: process.platform === 'win32', timeout: 240_000, env: baseEnv });

async function start() {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No loopback port');
  await new Promise((done, fail) => listener.close(error => error ? fail(error) : done()));
  const env = { ...baseEnv, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_SERVER_PASSWORD: password };
  const child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(address.port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, log: '' }; servers.push(instance);
  child.stdout.on('data', chunk => { instance.log += chunk.toString(); }); child.stderr.on('data', chunk => { instance.log += chunk.toString(); });
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${address.port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
  const deadline = Date.now() + 40_000; let plugins;
  // The project's plugins load after the server answers, so wait for ours to appear rather than for the first reply.
  const loaded = () => (plugins?.data ?? []).some(item => JSON.stringify(item).includes('feature-pilot'));
  while (Date.now() < deadline && !loaded()) {
    if (child.exitCode !== null) throw new Error(`OpenCode exited: ${instance.log.slice(-1500)}`);
    try { plugins = await client.plugin.list({ location: { directory: project } }, { signal: AbortSignal.timeout(2000) }); } catch { /* not ready */ }
    if (!loaded()) await sleep(300);
  }
  if (!plugins) throw new Error(`OpenCode did not become ready: ${instance.log.slice(-1500)}`);
  return { ...instance, client, plugins };
}
async function stop(instance) {
  const { child } = instance; if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'), escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.kill('SIGTERM'); try { await exited; } finally { clearTimeout(escalation); }
}

try {
  await Promise.all(['project', 'config', 'data', 'cache', 'state'].map(name => mkdir(join(root, name), { recursive: true })));
  const git = async (...args) => (await execFile('git', ['-C', project, ...args], { timeout: 20_000, env: baseEnv })).stdout.trim();
  await git('init', '-q'); await writeFile(join(project, 'a.txt'), 'one\n'); await git('add', 'a.txt');
  await git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'synthetic baseline');
  const head = await git('rev-parse', 'HEAD');

  // Install the packed artifact exactly as a user would, with install scripts off.
  const pack = JSON.parse((await npm(['pack', '--json', '--pack-destination', root], repo)).stdout)[0];
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'smoke-project', private: true }));
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', join(root, pack.filename)], project);
  await writeFile(join(project, 'opencode.json'), JSON.stringify({ plugins: ['./node_modules/feature-pilot'] }));
  const { FeaturePilot } = await import(pathToFileURL(join(project, 'node_modules', 'feature-pilot', 'dist', 'rpc.js')).href);

  let server = await start();
  const entry = (server.plugins.data ?? server.plugins).find?.(item => JSON.stringify(item).includes('feature-pilot'));
  assert.ok(entry, `feature-pilot is not listed: ${JSON.stringify(server.plugins).slice(0, 500)}`);
  note('plugin entry', entry);
  const options = { location: { directory: project } };
  const rpc = () => server.client.rpc(FeaturePilot);

  // Defaults and schema validation of every simple call.
  const policy = await rpc().getPolicy({}, options);
  assert.deepEqual([policy.directory === project || policy.directory.length > 0, policy.policy.revision, policy.policy.coderEnabled, policy.policy.routes], [true, 0, false, []]);
  assert.deepEqual((await rpc().getDelivery({}, options)).delivery, { revision: 0, publicationEnabled: false, github: null });
  assert.equal((await rpc().getSelections({}, options)).settings.revision, 0);
  const models = await rpc().listModels({}, options); note('models visible without credentials', models.models.length);
  // Stock 2.2.7 has no compare-and-set, so the budget authority is the plugin's own SQLite file under the (isolated) data directory.
  const budget = await rpc().getBudget({ runID: null }, options);
  assert.deepEqual([budget.available, budget.backend, budget.monthly], [true, 'local_file', null]); note('budget backend', budget.backend);
  assert.ok(existsSync(ledgerFile), 'the first budget read created the ledger file inside the isolated data directory'); note('ledger file', ledgerFile.replace(root, '<tmp>'));

  // Delivery settings: validation and revision checks run in the real host.
  const github = { remote: 'origin', remoteURL: 'https://github.com/example/widgets.git', baseBranch: 'main', branchPrefix: 'feature-pilot/' };
  await assert.rejects(rpc().saveDelivery({ revision: 0, publicationEnabled: true, github: { ...github, remoteURL: 'https://user:token@github.com/o/r.git' } }, options), { type: 'rejected', message: /credential/i });
  assert.equal((await rpc().saveDelivery({ revision: 0, publicationEnabled: true, github }, options)).delivery.revision, 1);
  await assert.rejects(rpc().saveDelivery({ revision: 0, publicationEnabled: false, github }, options), { type: 'rejected', message: /stale/i });

  // Runs: creation captures the real HEAD; the driver pauses before any model request when it cannot start one.
  const created = (await rpc().createDraft({ requirement: 'Add a synthetic feature' }, options)).run;
  assert.equal(created.baseCommit, head); assert.equal(created.state, 'planning');
  assert.equal((await rpc().listDrafts({}, options)).runs.length, 1);
  const started = await rpc().driveDraft({ id: created.id, autonomous: false }, options); note('driveDraft started', started.started);
  let driven; const until = Date.now() + 15_000;
  while (Date.now() < until) { driven = (await rpc().getDraft({ id: created.id }, options)).run; if (driven.attention || driven.state !== 'planning') break; await sleep(250); }
  note('driver stopped with', driven.attention ?? driven.state);
  assert.equal(driven.attention, 'budget_exhausted', 'with no limits set the budget gate holds the run back');
  // The driver pauses on the budget gate before a planner session exists, so the host must hold no session at all.
  const sessions = await server.client.session.list({ location: options.location });
  const sessionCount = (sessions.data ?? sessions.items ?? sessions).length;
  assert.equal(sessionCount, 0, `unexpected sessions: ${JSON.stringify(sessions).slice(0, 300)}`); note('sessions created by the driver', sessionCount);
  // Stop is two-step: the request is stored at once and the driver finishes the cancellation afterwards.
  await rpc().stopDraft({ id: created.id, revision: driven.revision }, options);
  let stopped; const settle = Date.now() + 15_000;
  while (Date.now() < settle) { stopped = (await rpc().getDraft({ id: created.id }, options)).run; if (stopped.state === 'cancelled') break; await sleep(250); }
  assert.equal(stopped.state, 'cancelled', `run state after stop: ${stopped.state} (${stopped.attention ?? 'no attention'})`);

  // Delivery: a local export is written beside the project; a GitHub attempt is refused for a run that was never accepted.
  const finished = (await rpc().getDraft({ id: created.id }, options)).run;
  const exported = await rpc().deliverDraft({ id: created.id, revision: finished.revision, target: 'local' }, options);
  assert.equal(exported.status, 'exported'); for (const path of exported.paths) assert.ok(existsSync(path), path);
  assert.match(await readFile(exported.paths[1], 'utf8'), /synthetic feature/i);
  const refused = await rpc().deliverDraft({ id: created.id, revision: finished.revision, target: 'github' }, options);
  assert.equal(refused.status, 'refused'); note('github delivery on an unaccepted run', refused.reason);

  // Limits go into the plugin's own ledger file (inside the isolated data directory); a second run is driven with them set to see how far it gets.
  const second = (await rpc().createDraft({ requirement: 'Second synthetic feature' }, options)).run;
  assert.equal((await rpc().setBudget({ scope: 'monthly', runID: null, amount: '5', revision: 0 }, options)).monthly.revision, 1);
  assert.equal((await rpc().setBudget({ scope: 'feature', runID: second.id, amount: '1', revision: 0 }, options)).feature.revision, 1);
  await rpc().driveDraft({ id: second.id, autonomous: false }, options);
  let next; const wait = Date.now() + 15_000;
  while (Date.now() < wait) { next = (await rpc().getDraft({ id: second.id }, options)).run; if (next.attention || next.state !== 'planning') break; await sleep(250); }
  note('with limits set the driver stopped with', next.attention ?? next.state);
  assert.notEqual(next.attention, 'budget_exhausted', 'with limits set the budget gate no longer holds the run back');
  await rpc().stopDraft({ id: second.id, revision: next.revision }, options);

  // Storage survives a server restart.
  await stop(server); server = await start();
  assert.equal((await rpc().listDrafts({}, options)).runs.length, 2, 'the runs survived the restart');
  const kept = await rpc().getBudget({ runID: second.id }, options);
  assert.deepEqual([kept.backend, kept.monthly, kept.feature], ['local_file', { amount: '5', revision: 1 }, { amount: '1', revision: 1 }], 'the limits survived the restart');
  assert.equal((await rpc().getDelivery({}, options)).delivery.revision, 1, 'delivery settings survived the restart');
  const leftovers = await readdir(`${project}.feature-pilot`).catch(() => []); note('sibling directory entries', leftovers);

  console.log('PASS: the packed plugin loaded in the real host, its RPC schemas and storage worked across a restart, and the driver made no model request');
  for (const line of observed) console.log(`OBSERVED ${line}`);
  console.log('LIMIT: no provider, model turn, shell tool, worktree run, permission rule, atomic-storage budget gate or Desktop panel was exercised');
} catch (error) {
  for (const line of observed) console.error(`OBSERVED ${line}`);
  for (const { log } of servers) console.error(`SERVER LOG TAIL:\n${log.slice(-1500)}`);
  throw error;
} finally {
  await Promise.all(servers.map(stop));
  await rm(root, { recursive: true, force: true });
}
