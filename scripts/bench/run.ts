// The proof test's runner (design: docs/superpowers/specs/2026-11-18-relay-proof-design.md; plan: docs/superpowers/plans/2026-11-19-relay-proof-test.md).
// THIS SENDS REAL REQUESTS through the owner's own OpenCode to OpenCode Go models, and uses their Go allowance. Run it only with the owner's yes.
// It works in one test folder that the owner has opened in Desktop (RELAY_BENCH_DIR, by default relay-bench in the home folder), and sends the
// service no request about any other folder. It sets Relay's settings for each side and puts back the ones it found, even after an error.
// Usage: npx tsx scripts/bench/run.ts --plan go|go-plus --out <folder> [--tasks a,b] [--sides off,on-one,on-two,cheap] [--budget <percent of a 5-hour window>] [--check]
import { execFile as execFileCallback } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { OpenCode } from '@opencode/client/promise';
import { formatUsd, parseUsd } from '../../src/costs.js';
import { permissionAnswer, resetFolder } from './folder.js';
import { MONTH, monthShare, requestCost, shares, SIDES, type Cost, type Side, type Tokens } from './lib.js';

const execFile = promisify(execFileCallback);
const { values: flags } = parseArgs({ options: { plan: { type: 'string' }, out: { type: 'string' }, tasks: { type: 'string' }, sides: { type: 'string' }, check: { type: 'boolean' }, budget: { type: 'string' } } });
const plan = flags.plan;
if (plan !== 'go' && plan !== 'go-plus') throw new Error('Say which Go plan: --plan go or --plan go-plus');
if (!flags.out) throw new Error('Say where the results go: --out <folder>');
const out = flags.out;
const budget = BigInt(flags.budget ?? '100');   // percent of one 5-hour window this run may use
if (budget <= 0n || budget > 100n) throw new Error('--budget is a percent of one 5-hour window, 1 to 100');
const folder = process.env.RELAY_BENCH_DIR ?? join(homedir(), 'relay-bench'), python = process.env.RELAY_BENCH_PYTHON ?? 'python';
const taskRoot = fileURLToPath(new URL('./tasks/', import.meta.url));
const TASKS = ['affine-cipher', 'variable-length-quantity', 'wordy', 'book-store', 'bowling', 'forth'];
const tasks = flags.tasks ? flags.tasks.split(',') : TASKS;
const sides = (flags.sides ? flags.sides.split(',') : [...SIDES]) as Side[];
for (const task of tasks) if (!TASKS.includes(task)) throw new Error(`Unknown task ${task}`);
for (const side of sides) if (!SIDES.includes(side)) throw new Error(`Unknown side ${side}`);

type Choice = { providerID: string; id: string; variant: null };
const choice = (providerID: string, id: string): Choice => ({ providerID, id, variant: null });
const STRONG = choice('opencode-go', 'kimi-k3.1-pro'), CHEAP = choice('opencode-go', 'glm-5.3-flash'), DECIDER = choice('opencode', 'jev-1.13-free');
// Each model's monthly limit on Go, from https://opencode.ai/inference/go/v1/models (`go.monthly_usage`, read on 18 Nov 2026).
const MONTHLY: Record<'go' | 'go-plus', Record<string, string>> = { go: { 'kimi-k3.1-pro': '15', 'glm-5.3-flash': '60' }, 'go-plus': { 'kimi-k3.1-pro': '60', 'glm-5.3-flash': '180' } };
const SETTINGS = {
  'on-one': { plan: [STRONG], execute: [CHEAP], review: [STRONG] },
  'on-two': { plan: [STRONG], execute: [{ ...CHEAP, useFor: 'small edits in one or two files' }, { ...STRONG, useFor: 'bigger changes across several files' }], review: [STRONG] },
};
const MESSAGE_LIMIT_MS = 15 * 60_000, TEST_LIMIT_MS = 120_000;
const messages = (module: string) => [
  `Read the exercise in instructions.md and the stub ${module}.py, and plan the solution. Don't write any code yet.`,
  'Implement it.',
  "Review the implementation for mistakes and missed cases. Don't change anything.",
  'Fix what the review found.',
];

// The RPC client checks each answer against the contract, so the contract comes from the Relay copy the owner's OpenCode runs, not from
// src/, which can be ahead of it (RELAY_BENCH_RPC overrides).
const installedRpc = process.env.RELAY_BENCH_RPC ?? join(homedir(), '.config', 'opencode', 'relay', 'node_modules', 'relay-opencode', 'dist', 'rpc.js');
const { RelayRpc } = await import(pathToFileURL(installedRpc).href);

// ---- The owner's running service: its address and password from its own file. The password is never printed. ----
const service = JSON.parse(readFileSync(join(homedir(), '.local', 'state', 'opencode', 'service.json'), 'utf8')) as { url: string; password: string };
const authorization = `Basic ${Buffer.from(`opencode:${service.password}`).toString('base64')}`;
const client = OpenCode.make({ baseUrl: service.url, headers: { authorization } });
// The RPC client types its answers as unknown; they follow src/contract.ts.
const location = { directory: folder }, options = { location }, rpc = client.rpc(RelayRpc) as any;
const items = (value: unknown): any[] => (Array.isArray(value) ? value : ((value as { data?: unknown[] } | null)?.data ?? []));
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const same = (a: string, b: string) => a.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase() === b.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const info = await (await fetch(`${service.url}/api/info`, { headers: { authorization }, signal: AbortSignal.timeout(30_000) })).json() as { version?: string };
const opencodeVersion = info.version ?? 'unknown';

/** Runs an exercise's tests in `dir`: passed when unittest exits 0. The last 2,000 characters of what it printed are kept. */
async function runTests(dir: string, module: string): Promise<{ passed: boolean; tail: string }> {
  try {
    const { stdout, stderr } = await execFile(python, ['-E', '-s', '-m', 'unittest', `${module}_test`], { cwd: dir, timeout: TEST_LIMIT_MS, maxBuffer: 20 * 1024 * 1024 });
    return { passed: true, tail: `${stdout}${stderr}`.slice(-2000) };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; killed?: boolean };
    return { passed: false, tail: `${failed.stdout ?? ''}${failed.stderr ?? ''}${failed.killed ? `\n[stopped after ${TEST_LIMIT_MS / 1000} s]` : ''}`.slice(-2000) };
  }
}

async function check(): Promise<void> {
  const problems: string[] = [];
  const projects = items(await client.project.list({}));
  if (!projects.some(project => same(String(project.canonical ?? project.directory ?? ''), folder))) problems.push(`OpenCode has no project for ${folder}: open it in Desktop first`);
  else {
    // Only now, with the folder known to the service, is it asked anything about it.
    const models = items((await rpc.listModels({}, options)).models);
    for (const wanted of [STRONG, CHEAP]) {
      const found = models.find(model => model.providerID === wanted.providerID && model.id === wanted.id);
      if (!found?.enabled) problems.push(`${wanted.providerID}/${wanted.id} is ${found ? `listed but ${found.status}` : 'not listed'}`);
    }
    const relay = await rpc.getRelay({}, options);
    if (!items(relay.deciders).some(model => model.providerID === DECIDER.providerID && model.id === DECIDER.id)) problems.push(`the decider ${DECIDER.providerID}/${DECIDER.id} is not among the decision models`);
  }
  const version = await execFile(python, ['--version'], { timeout: 30_000 }).then(result => `${result.stdout}${result.stderr}`.trim(), () => null);
  if (!version) problems.push(`Python does not run as "${python}"`);
  for (const task of tasks) {
    const module = task.replaceAll('-', '_'), scratch = mkdtempSync(join(tmpdir(), 'relay-bench-stub-'));
    try {
      for (const name of [`${module}.py`, `${module}_test.py`]) copyFileSync(join(taskRoot, task, name), join(scratch, name));
      if ((await runTests(scratch, module)).passed) problems.push(`${task}: the untouched stub passes its own tests`);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  console.log(problems.length > 0 ? `NOT READY:\n- ${problems.join('\n- ')}` : `PASS: OpenCode ${opencodeVersion}; the folder ${folder} is a project; ${STRONG.id} and ${CHEAP.id} are enabled; ${DECIDER.id} can decide; ${version}; each of ${tasks.length} stubs fails its tests`);
}

type Entry = { model: string; agent: string; tokens: Tokens; openCodeCost: number; cost: string; month: string; created: number; completed: number | null; error: unknown };
type Chat = { task: string; side: Side; sessionID: string; passed: boolean; testTail: string; seconds: number; stopped: string | null; entries: Entry[]; decisions: { mode: string | null; model: string | null; confidence: number | null; note: string | null }[] };

/** Waits until the chat has gone idle after `before` entries, answering its permission questions meanwhile. Returns why it gave up, or null. */
async function untilIdle(sessionID: string, before: number): Promise<string | null> {
  const deadline = Date.now() + MESSAGE_LIMIT_MS;
  while (Date.now() < deadline) {
    for (const request of items(await client.permission.request.list({ location }).catch(() => []))) {
      if (request.sessionID !== sessionID) continue;
      const decision = permissionAnswer({ action: String(request.action), resources: items(request.resources).map(String) }, folder);
      await client.permission.reply({ sessionID, requestID: request.id, decision, message: decision === 'reject' ? 'Not allowed in this test.' : undefined }).catch(() => {});
    }
    if (items(await client.session.context({ sessionID })).slice(before).some(entry => entry.type === 'idle')) return null;
    await sleep(2000);
  }
  await client.session.interrupt({ sessionID }).catch(() => {});
  return `no answer within ${MESSAGE_LIMIT_MS / 60_000} minutes`;
}

function entryOf(entry: any, prices: Map<string, Cost>): Entry {
  const model = `${entry.model?.providerID}/${entry.model?.id}`, t = entry.tokens ?? {};
  const tokens: Tokens = { input: t.input ?? 0, output: t.output ?? 0, reasoning: t.reasoning ?? 0, cache: { read: t.cache?.read ?? 0, write: t.cache?.write ?? 0 } };
  const price = prices.get(model), cost = price ? requestCost(tokens, price) : 0n, monthly = MONTHLY[plan as 'go' | 'go-plus'][entry.model?.id];
  return { model, agent: entry.agent, tokens, openCodeCost: entry.cost ?? 0, cost: formatUsd(cost), month: (monthly ? monthShare(cost, monthly) : 0n).toString(), created: entry.time?.created, completed: entry.time?.completed ?? null, error: entry.error ?? null };
}

async function runChat(task: string, side: Side, prices: Map<string, Cost>): Promise<Chat> {
  const module = task.replaceAll('-', '_'), source = join(taskRoot, task), began = Date.now();
  resetFolder(folder, { 'instructions.md': readFileSync(join(source, 'instructions.md'), 'utf8'), [`${module}.py`]: readFileSync(join(source, `${module}.py`), 'utf8') });
  const on = side === 'on-one' || side === 'on-two';
  if (on) await rpc.saveRelay({ revision: (await rpc.getRelay({}, options)).settings.revision, decider: DECIDER, modes: SETTINGS[side] }, options);
  const start = side === 'cheap' ? CHEAP : STRONG;
  // The owner's Plannotator plugin watches the `plan` agent and makes each plan wait for a person's approval (`submit_plan`), which an
  // unattended test cannot give: each test chat is created with that tool denied, so a call fails at once and the chat goes on.
  const permissions = [{ action: 'submit_plan', resource: '*', effect: 'deny' as const }];
  const { id: sessionID } = await client.session.create({ model: { providerID: start.providerID, id: start.id }, location, title: `relay-bench ${task} ${side}`, permissions });
  if (on) await client.session.command({ sessionID, name: 'relay', text: 'on' });
  let stopped: string | null = null;
  for (const text of messages(module)) {
    const before = items(await client.session.context({ sessionID })).length;
    await client.session.prompt({ sessionID, text });
    stopped = await untilIdle(sessionID, before);
    if (stopped) break;
  }
  const entries = items(await client.session.context({ sessionID })).filter(entry => entry.type === 'assistant').map(entry => entryOf(entry, prices));
  const failed = entries.find(entry => entry.error);
  if (!stopped && failed) stopped = `a request failed: ${JSON.stringify(failed.error).slice(0, 300)}`;
  const decisions = items((await rpc.getRelayDecisions({}, options)).decisions).filter(record => record.sessionID === sessionID).reverse()
    .map(record => ({ mode: record.mode, model: record.model, confidence: record.confidence, note: record.note }));
  if (on) await rpc.setRelayChat({ sessionID, on: false }, options);
  copyFileSync(join(source, `${module}_test.py`), join(folder, `${module}_test.py`));
  const tests = await runTests(folder, module);
  return { task, side, sessionID, passed: tests.passed, testTail: tests.tail, seconds: Math.round((Date.now() - began) / 1000), stopped, entries, decisions };
}

async function run(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const before = await rpc.getRelay({}, options);
  const listed = items((await rpc.listModels({}, options)).models);
  const prices = new Map<string, Cost>(listed.filter(model => [STRONG, CHEAP].some(wanted => model.providerID === wanted.providerID && model.id === wanted.id)).map(model => [`${model.providerID}/${model.id}`, model.cost]));
  const results = { startedAt: new Date().toISOString(), opencodeVersion, plan, folder, models: { strong: `${STRONG.providerID}/${STRONG.id}`, cheap: `${CHEAP.providerID}/${CHEAP.id}`, decider: `${DECIDER.providerID}/${DECIDER.id}` },
    prices: Object.fromEntries(prices), settingsBefore: before.settings, stoppedBecause: null as string | null, chats: [] as Chat[] };
  const save = () => writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  const monthOf = (chat: Chat) => chat.entries.reduce((sum, entry) => sum + BigInt(entry.month), 0n);
  try {
    outer: for (const task of tasks) for (const side of sides) {
      // This run may use `--budget` percent of one 5-hour window (default 100; a 5-hour window is a fifth of the month). The next chat is taken to cost as much as the dearest chat so far.
      const spent = results.chats.reduce((sum, chat) => sum + monthOf(chat), 0n), next = results.chats.reduce((most, chat) => (monthOf(chat) > most ? monthOf(chat) : most), 0n);
      if ((spent + next) * 5n * 100n > budget * MONTH) { results.stoppedBecause = `the next chat could pass the budget of ${budget}% of a 5-hour window (${shares(spent).fiveHour}% used)`; break outer; }
      const chat = await runChat(task, side, prices);
      results.chats.push(chat); save();
      const cost = chat.entries.reduce((sum, entry) => sum + parseUsd(entry.cost), 0n);
      console.log(`${task} ${side}: ${chat.passed ? 'passed' : 'failed'}; ${chat.entries.length} requests; $${formatUsd(cost)} at list price; ${shares(monthOf(chat)).fiveHour}% of a 5-hour window; ${chat.seconds} s${chat.stopped ? `; STOPPED: ${chat.stopped}` : ''}`);
      if (chat.stopped) { results.stoppedBecause = `${task} ${side}: ${chat.stopped}`; break outer; }
    }
  } finally {
    const now = await rpc.getRelay({}, options);
    await rpc.saveRelay({ revision: now.settings.revision, modes: before.settings.modes, decider: before.settings.decider }, options);
    save();
    console.log(`Relay's settings are back as they were (revision ${now.settings.revision + 1}). Results: ${join(out, 'results.json')}${results.stoppedBecause ? `. Stopped: ${results.stoppedBecause}` : ''}`);
  }
}

await (flags.check ? check() : run());
