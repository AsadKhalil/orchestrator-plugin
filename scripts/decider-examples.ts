// The labelled examples in scripts/relay-examples.json, sent through a real decision model, to measure the decider.
// THIS MAKES REAL REQUESTS: one for each example (at most 30), to the model in RELAY_EXAMPLES_MODEL (default opencode/jev-1.13-free),
// from an isolated OpenCode with scratch config, data, cache and state folders, a throwaway password, no login and no plugin.
// Run it only with the owner's yes. It refuses a model whose listed price is not 0 unless RELAY_EXAMPLES_PAID=1, and it stops
// when the model does not answer. Needs RELAY_SMOKE_CLI pointing at an `opencode` 2.3.0 binary.
// RELAY_EXAMPLES_OUT=<file> keeps the outcomes. RELAY_EXAMPLES_FROM=<file> prints the report for kept outcomes again, with no request,
// so a corrected label can be scored without asking the model again. RELAY_EXAMPLES_SET=<file> uses another labelled set
// (your own lines, or the same examples in another order) instead of scripts/relay-examples.json.
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { OpenCode } from '@opencode/client/promise';
import { formatUsd, parseUsd } from '../src/costs.js';
import { decide, TIMEOUT_MS, type DecisionsHost, type DecisionsRequest, type FileFact } from '../src/decider.js';
import { listProjectModels, type ListedModel } from '../src/inventory.js';
import { modes, type Mode, type ModeChoice } from '../src/relay-store.js';
import { priceLabel } from '../src/relay-view.js';
import { candidates, linesFor, modeLabel, pickModel, route, UNSURE_BELOW, type DeciderAnswer, type LineAnswer, type RoutableModel } from '../src/router.js';
import type { ModelChoice } from '../src/settings.js';

export type Example = { text: string; agent: 'plan' | 'build'; expect: Mode; line: number | null; nearMiss?: true; followUp?: true; files?: FileFact[] };
/** `lines` is one sample of what a person might write for each mode's models; an example's `line` counts from 1 in its own mode's lines, or is null when none fits. */
export type ExampleSet = { lines: Record<Mode, string[]>; examples: Example[] };
/**
 * What the router makes of one answer. `said` is the decider's own mode and `mode` the one after the 0.6 rule.
 * `lineSaid` is the decider's own answer about the expected mode's lines and `line` the line picked after the 0.5 rule (counted from 1).
 */
export type Outcome = { mode: Mode | null; said: Mode | null; confidence: number | null; line: number | null; fit: number | null; lineSaid: LineAnswer | null; ms: number; costUsd: string | null; note: string | null };
/** `changed` counts the answers the not-sure rule turned into Plan: `rescued` of them became right and `spoiled` of them became wrong. */
export type Summary = { total: number; rightMode: number; toExecute: number; changed: number; rescued: number; spoiled: number; offLine: number; wrongLine: number; noLine: number; extraLine: number; noAnswer: number; firstMs: number | null; medianMs: number | null; slowestMs: number | null; costUsd: string; costReported: number; mixups: string[] };

const MAX_REQUESTS = 30;
const nothing = { needsImage: false, tokens: 0 };
/** The sample lines as settings: one made-up model for each line, every one of them usable. */
function sample(set: ExampleSet) {
  const lists = modes.map(mode => [mode, set.lines[mode].map((useFor, index): ModeChoice => ({ providerID: 'sample', id: `${mode}-${index + 1}`, variant: null, useFor }))] as const);
  const models: RoutableModel[] = lists.flatMap(([, list]) => list.map(({ providerID, id }) => ({ providerID, id, enabled: true, status: 'active', variants: [], capabilities: { input: ['text'] }, limit: { context: 0 } })));
  return { settings: { modes: Object.fromEntries(lists) as Record<Mode, ModeChoice[]> }, models };
}

/** The line is read from the question about the expected mode's lines, so a wrong mode does not hide how well the lines are told apart. */
export function judge(set: ExampleSet, example: Example, answer: DeciderAnswer): Outcome {
  const { settings, models } = sample(set), answered = answer.kind === 'answer', lineSaid = answered ? answer.lines[example.expect] ?? null : null;
  const picked = pickModel(candidates(example.expect, settings.modes[example.expect], models, nothing).usable, lineSaid ?? undefined, null);
  return {
    mode: route(answer, settings, models, nothing, null).mode, said: answered ? answer.mode : null, confidence: answered ? answer.confidence : null,
    line: picked.fit === null ? null : Number(picked.model.id.split('-')[1]), fit: picked.fit, lineSaid,
    ms: answer.ms, costUsd: answered ? answer.costUsd : null, note: answered ? null : answer.reason,
  };
}

const percent = (value: number | null) => `${Math.round((value ?? 0) * 100)}%`;
const lineSaidNote = (said: LineAnswer | null) => said === null ? '' : ` (the decider said ${said.index === null ? 'none' : `line ${said.index + 1}`}, ${percent(said.confidence)} sure)`;
/**
 * The first request is timed apart from the others: it can include the host's first use of the provider.
 * In `mixups`, a `rule:` entry is an answer the decider itself got wrong and the not-sure rule put right.
 */
export function scoreExamples(set: ExampleSet, outcomes: readonly Outcome[]): Summary {
  if (outcomes.length !== set.examples.length) throw new Error(`${set.examples.length} examples but ${outcomes.length} outcomes`);
  const count = { rightMode: 0, toExecute: 0, changed: 0, rescued: 0, spoiled: 0, wrongLine: 0, noLine: 0, extraLine: 0, noAnswer: 0, costReported: 0 }, mixups: string[] = [];
  let cost = 0n;
  set.examples.forEach((example, index) => {
    const got = outcomes[index], label = modeLabel(example.expect), said = got.said;
    // The not-sure rule only ever turns an answer into Plan.
    const changed = said !== null && said !== got.mode, sure = `${changed ? `the decider said ${modeLabel(said)}, ` : ''}${percent(got.confidence)} sure`;
    if (got.mode === null) count.noAnswer++;
    if (changed) count.changed++;
    if (got.mode === example.expect) {
      count.rightMode++;
      if (changed) { count.rescued++; mixups.push(`rule: "${example.text}" is ${label} only by the not-sure rule (${sure})`); }
    } else {
      if (changed && said === example.expect) count.spoiled++;
      mixups.push(`mode: "${example.text}" expected ${label}, got ${got.mode === null ? `no answer (${got.note})` : `${modeLabel(got.mode)} (${sure})`}`);
    }
    if (example.expect !== 'execute' && got.mode === 'execute') count.toExecute++;
    if (got.line !== example.line) {
      count[example.line === null ? 'extraLine' : got.line === null ? 'noLine' : 'wrongLine']++;
      mixups.push(`line: "${example.text}" expected ${example.line === null ? `no ${label} line` : `${label} line ${example.line}`}, got ${got.line === null ? `no line${lineSaidNote(got.lineSaid)}` : `line ${got.line} (fit ${percent(got.fit)})`}`);
    }
    if (got.costUsd !== null) { cost += parseUsd(got.costUsd); count.costReported++; }
  });
  const rest = outcomes.slice(1).map(item => item.ms).sort((a, b) => a - b);
  return {
    total: outcomes.length, ...count, offLine: count.wrongLine + count.noLine + count.extraLine,
    firstMs: outcomes[0]?.ms ?? null, medianMs: rest.length ? rest[Math.floor((rest.length - 1) / 2)] : null, slowestMs: rest.length ? rest[rest.length - 1] : null,
    costUsd: formatUsd(cost), mixups,
  };
}

const verdict = (ok: boolean) => ok ? 'pass' : 'MISS';
/** The four lines of Gate 1 that the examples measure and what the not-sure rule did, then the cost, the unanswered and each mix-up. */
export function examplesReport(s: Summary): string {
  return [
    `Right mode: ${s.rightMode} of ${s.total}. Gate 1 needs at least 27: ${verdict(s.rightMode >= 27)}.`,
    `Sent to Execute by mistake: ${s.toExecute}. Gate 1 needs 0: ${verdict(s.toExecute === 0)}.`,
    `Not-sure rule (under ${percent(UNSURE_BELOW)} sure means Plan): changed ${s.changed} of ${s.total} answers; ${s.rescued} became right, ${s.spoiled} became wrong.`,
    `Off the expected line: ${s.offLine} of ${s.total} (${s.wrongLine} wrong line, ${s.noLine} no line where one was expected, ${s.extraLine} a line where none was expected). Gate 1 allows 3: ${verdict(s.offLine <= 3)}.`,
    `Time: first request ${s.firstMs} ms; the other ${s.total - 1}: median ${s.medianMs} ms, slowest ${s.slowestMs} ms. Gate 1 needs under 1000 ms: first request ${verdict((s.firstMs ?? 0) < 1000)}, the others ${verdict((s.slowestMs ?? 0) < 1000)}.`,
    `Cost the host reported: $${s.costUsd} (${s.costReported} of ${s.total} requests reported one).`,
    `No answer: ${s.noAnswer} of ${s.total}.`,
    s.mixups.length ? `Mix-ups:\n${s.mixups.map(line => `- ${line}`).join('\n')}` : 'Mix-ups: none.',
  ].join('\n');
}

/** Why this model must not be asked, or null. A model with a listed price, or with none listed, needs the paid switch. */
export function modelRefusal(providerID: string, id: string, listed: readonly ListedModel[], paid: boolean): string | null {
  const name = `${providerID}/${id}`, found = listed.find(model => model.providerID === providerID && model.id === id);
  if (!found) return `The isolated OpenCode does not list ${name} as a decision model. It lists: ${listed.map(model => `${model.providerID}/${model.id}`).join(', ') || 'none'}.`;
  if (!found.enabled) return `${name} is listed but not enabled in the isolated OpenCode, which has no login.`;
  if (!paid && !(found.cost.inputPerMillion === '0' && found.cost.outputPerMillion === '0')) return `${name} has a listed price (${priceLabel(found.cost)}). Set RELAY_EXAMPLES_PAID=1 to run it anyway.`;
  return null;
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
/** One request for each example, in order, and at most 30. It stops when the model cannot be reached: no answer to the first request, or to three in a row. */
export async function runExamples(set: ExampleSet, host: DecisionsHost, decider: ModelChoice, pauseMs = 300): Promise<Outcome[]> {
  if (set.examples.length > MAX_REQUESTS) throw new Error(`One run sends at most ${MAX_REQUESTS} examples`);
  const { settings, models } = sample(set), lines = linesFor(settings, models, nothing), outcomes: Outcome[] = [];
  let silent = 0;
  for (const [index, example] of set.examples.entries()) {
    // The host's first use of a provider can be slow, so the first example may take up to a minute. Every later one has /relay's own limit.
    const answer = await decide(host, decider, { kind: 'chat', text: example.text, agent: example.agent, files: example.files ?? [], images: 0, lines }, index === 0 ? 60_000 : TIMEOUT_MS);
    outcomes.push(judge(set, example, answer));
    silent = answer.kind === 'none' ? silent + 1 : 0;
    if (answer.kind === 'none' && (silent === outcomes.length || silent >= 3)) throw new Error(`Stopped after ${outcomes.length} request(s): the model did not answer (${answer.reason}).`);
    if (pauseMs) await sleep(pauseMs);
  }
  return outcomes;
}

async function main() {
  const set =JSON.parse(readFileSync(process.env.RELAY_EXAMPLES_SET ?? new URL('./relay-examples.json', import.meta.url), 'utf8')) as ExampleSet;
  if (process.env.RELAY_EXAMPLES_FROM) { console.log(examplesReport(scoreExamples(set, JSON.parse(readFileSync(process.env.RELAY_EXAMPLES_FROM, 'utf8')) as Outcome[]))); return; }

  const cli = process.env.RELAY_SMOKE_CLI ?? 'opencode', password = 'synthetic-local-examples';
  const [providerID, ...idParts] = (process.env.RELAY_EXAMPLES_MODEL ?? 'opencode/jev-1.13-free').split('/'), id = idParts.join('/');
  const root = await mkdtemp(join(tmpdir(), 'relay-examples-')), project = join(root, 'project');
  // Every run of the host binary gets the scratch folders and no credential, so nothing is read from or written to a real profile.
  const kept = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'SystemRoot', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'];
  const isolated = { ...Object.fromEntries(kept.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), OPENCODE_SERVER_PASSWORD: password };
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await Promise.all(['project', 'config', 'data', 'cache', 'state'].map(name => mkdir(join(root, name), { recursive: true })));
    const version = (await promisify(execFileCallback)(cli, ['--version'], { timeout: 20_000, env: isolated })).stdout.trim();
    const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
    const { port } = listener.address() as { port: number }; await new Promise(done => listener.close(done));
    let log = '';
    child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env: isolated, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', chunk => { log += chunk.toString(); }); child.stderr?.on('data', chunk => { log += chunk.toString(); });
    const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
    // Model records can carry credentials, so the list is read through the plugin's own filter and nothing else of it is printed.
    const deciders = async () => listProjectModels({ location: { directory: project }, model: client.model } as never, 'decision');
    let listed: Awaited<ReturnType<typeof deciders>> | undefined;
    for (const deadline = Date.now() + 60_000; Date.now() < deadline && !listed;) {
      if (child.exitCode !== null) throw new Error(`OpenCode exited: ${log.slice(-800)}`);
      try { listed = await deciders(); } catch { await sleep(300); }
    }
    if (!listed) throw new Error(`OpenCode did not answer within a minute: ${log.slice(-800)}`);
    const refusal = modelRefusal(providerID, id, listed, process.env.RELAY_EXAMPLES_PAID === '1');
    if (refusal) throw new Error(refusal);
    const price = priceLabel(listed.find(model => model.providerID === providerID && model.id === id)!.cost);

    const host = { async decisions(request: DecisionsRequest) {
      const result = await client.experimental.generate.decisions(request as never) as { answers?: unknown; data?: unknown };
      return result.answers === undefined && result.data !== undefined ? result.data : result;
    } };
    const outcomes = await runExamples(set, host, { providerID, id, variant: null });
    if (process.env.RELAY_EXAMPLES_OUT) writeFileSync(process.env.RELAY_EXAMPLES_OUT, JSON.stringify(outcomes, null, 1));
    console.log(`Decider: ${providerID}/${id} (${price}) on ${version}; ${outcomes.length} requests from an isolated OpenCode with no login.`);
    console.log(examplesReport(scoreExamples(set, outcomes)));
    console.log('LIMIT: made-up messages, one sample set of lines, one decision model, one run. No chat, switch or plugin was involved.');
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'), escalation = setTimeout(() => child?.kill('SIGKILL'), 5000);
      child.kill('SIGTERM'); try { await exited; } finally { clearTimeout(escalation); }
    }
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
