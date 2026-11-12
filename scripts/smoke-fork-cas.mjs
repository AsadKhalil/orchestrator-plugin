import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client/promise';

const fork = resolve(dirname(fileURLToPath(import.meta.url)), '../../opencode-host-fork');
const root = await mkdtemp(join(tmpdir(), 'fp-fork-cas-')), project = join(root, 'project');
const password = 'synthetic-only', servers = [];
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const sleep = () => new Promise(resolve => setTimeout(resolve, 50));
try {
  await Promise.all(['project', 'config', 'data', 'cache', 'state'].map(name => mkdir(join(root, name), { recursive: true })));
  await writeFile(join(project, 'opencode.json'), JSON.stringify({ plugins: [join(fork, 'packages/core/test/fixture/plugin-cas-race')] }));
  Object.assign(env, { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_TEST_HOME: root, OPENCODE_SERVER_PASSWORD: password });
  async function start(role) {
    const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
    const address = listener.address(); if (!address || typeof address === 'string') throw Error('No loopback port');
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    const child = spawn(process.env.FEATURE_PILOT_BUN ?? 'bun', [join(fork, 'packages/cli/src/index.ts'), 'serve', '--hostname', '127.0.0.1', '--port', String(address.port)], { cwd: join(fork, 'packages/cli'), env: { ...env, FEATURE_PILOT_CAS_ROLE: role }, stdio: ['ignore', 'pipe', 'pipe'] });
    const instance = { child, log: '' }; servers.push(instance);
    child.stdout.on('data', chunk => { instance.log += chunk.toString(); }); child.stderr.on('data', chunk => { instance.log += chunk.toString(); });
    const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${address.port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
    const deadline = Date.now() + 30000; let initialized = false;
    while (Date.now() < deadline && !initialized) {
      if (child.exitCode !== null) throw Error(`Server ${role} exited: ${instance.log.slice(-500)}`);
      try { await client.plugin.list({ location: { directory: project } }, { signal: AbortSignal.timeout(1500) }); initialized = true; } catch { await sleep(); }
    }
    if (!initialized) throw Error(`Server ${role} did not initialize`);
    return instance;
  }
  const first = await start('a');
  const ready = Date.now() + 15000;
  while (!first.log.includes('CAS_RACE_READY_a') && Date.now() < ready) { if (first.log.includes('CAS_RACE_ERROR')) throw Error(first.log.slice(-500)); await sleep(); }
  if (!first.log.includes('CAS_RACE_READY_a')) throw Error(`First server not ready: ${first.log.slice(-500)}`);
  const second = await start('b');
  const finish = Date.now() + 25000;
  while ((!first.log.includes('PLANNER_RACE_RESULT_a') || !second.log.includes('PLANNER_RACE_RESULT_b')) && Date.now() < finish) {
    for (const instance of servers) if (instance.log.includes('CAS_RACE_ERROR') || instance.child.exitCode !== null) throw Error(`CAS probe failed: ${instance.log.slice(-600)}`);
    await sleep();
  }
  const outcomes = [first.log.match(/CAS_RACE_RESULT_a (updated 1|stale)/)?.[1], second.log.match(/CAS_RACE_RESULT_b (updated 1|stale)/)?.[1]];
  if (outcomes.filter(value => value === 'updated 1').length !== 1 || outcomes.filter(value => value === 'stale').length !== 1) throw Error(`Unexpected outcomes: ${JSON.stringify(outcomes)}`);
  const winner = outcomes[0] === 'updated 1' ? 'a' : 'b';
  if (!first.log.includes(`CAS_RACE_SAVED_a 1 Changed by ${winner}`) || !second.log.includes(`CAS_RACE_SAVED_b 1 Changed by ${winner}`)) throw Error('Servers disagree on the saved winner');
  const budgets = [first.log.match(/BUDGET_RACE_RESULT_a (reserved|exceeded)/)?.[1], second.log.match(/BUDGET_RACE_RESULT_b (reserved|exceeded)/)?.[1]];
  if (budgets.filter(value => value === 'reserved').length !== 1 || budgets.filter(value => value === 'exceeded').length !== 1 || !first.log.includes('BUDGET_RACE_SAVED_a 1') || !second.log.includes('BUDGET_RACE_SAVED_b 1')) throw Error(`Unexpected budget outcomes: ${JSON.stringify(budgets)}`);
  const selections = [first.log.match(/SELECTION_RACE_RESULT_a (saved|stale)/)?.[1], second.log.match(/SELECTION_RACE_RESULT_b (saved|stale)/)?.[1]];
  const selectionWinner = selections[0] === 'saved' ? 'a' : 'b';
  if (selections.filter(value => value === 'saved').length !== 1 || selections.filter(value => value === 'stale').length !== 1 || !first.log.includes(`SELECTION_RACE_SAVED_a 1 ${selectionWinner}`) || !second.log.includes(`SELECTION_RACE_SAVED_b 1 ${selectionWinner}`)) throw Error(`Unexpected selection outcomes: ${JSON.stringify(selections)}`);
  const prompts = [first.log.match(/PROMPT_RACE_RESULT_a (sent|duplicate)/)?.[1], second.log.match(/PROMPT_RACE_RESULT_b (sent|duplicate)/)?.[1]];
  if (prompts.filter(value => value === 'sent').length !== 1 || prompts.filter(value => value === 'duplicate').length !== 1) throw Error(`Unexpected prompt outcomes: ${JSON.stringify(prompts)}`);
  const planners = [first.log.match(/PLANNER_RACE_RESULT_a (owner|rejected)/)?.[1], second.log.match(/PLANNER_RACE_RESULT_b (owner|rejected)/)?.[1]];
  if (planners.filter(value => value === 'owner').length !== 1 || planners.filter(value => value === 'rejected').length !== 1) throw Error(`Unexpected planner outcomes: ${JSON.stringify(planners)}`);
  console.log('PASS: two isolated fork servers safely raced a run, budget, selections, prompt and planner checkpoint');
} finally {
  await Promise.all(servers.map(async ({ child }) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); const escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.kill('SIGTERM'); try { await exited; } finally { clearTimeout(escalation); }
  }));
  await rm(root, { recursive: true, force: true });
}
