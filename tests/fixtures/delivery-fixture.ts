import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DeliveryDeps, DeliveryRecord } from '../../src/delivery.js';
import { newRun, setPlan, approvePlan, beginImplementation, beginValidation, recordStepOutcome, startReview, recordReview, askQuestions, answerQuestions, type Run } from '../../src/run.js';
import { aggregateUsage } from '../../src/usage.js';
import { contentIdentity, type Exec } from '../../src/worktree.js';
import type { Destination } from '../../src/types.js';
import { step, criterion } from './plan-data.js';
import assert from 'node:assert/strict';

/** A real repository with a bare remote and a scripted gh, shared by the delivery tests. */
export const execAsync = promisify(execFile);
export const isolation = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
export const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, ...isolation }, encoding: 'utf8' }).trim();
export const branch = 'feature-pilot/abcdef012345';
export const runID = 'abcdef012345-run';
export const title = 'Feature Pilot: Add the widget; "$(touch pwned)" `x`';

/** A real repository with a bare remote. The reviewed work is a tracked edit plus an untracked file in a new directory. */
export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fp-delivery-'));
  const remote = join(root, 'remote.git').replace(/\\/g, '/'), dir = join(root, 'work');
  mkdirSync(dir); git(root, 'init', '-q', '--bare', remote); git(dir, 'init', '-q');
  for (const [key, value] of [['core.autocrlf', 'false'], ['user.name', 'Config User'], ['user.email', 'config@example.invalid'], ['commit.gpgsign', 'false']]) git(dir, 'config', key, value);
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n'); writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base'); git(dir, 'remote', 'add', 'origin', remote);
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'a.txt'), 'two\n'); mkdirSync(join(dir, 'sub')); writeFileSync(join(dir, 'sub', 'new.txt'), 'untracked\n');
  return { root, dir, remote, base, done: () => rmSync(root, { recursive: true, force: true }) };
}
export type Fixture = ReturnType<typeof fixture>;

export function reviewedRun(id: string, base: string, diffHash: string, options: { advisory?: boolean } = {}): Run {
  let run = newRun(id, 'Add the widget; "$(touch pwned)" `x`', base);
  run = askQuestions(run, run.revision, [{ id: 'q1', question: 'Who can use it?' }]);
  run = answerQuestions(run, run.revision, [{ id: 'q1', answer: 'Staff only' }]);
  run = setPlan(run, run.revision, { steps: [step('Implement')], acceptance: [criterion('Widget renders'), criterion('Widget is keyboard accessible')], questions: [{ question: 'Who can use it?', answer: 'Staff only' }], areas: ['src'], rollback: 'revert', validationCommands: ['npm test'] });
  run = approvePlan(run, run.revision, run.planHash!); run = beginImplementation(run, run.revision);
  run = recordStepOutcome(run, run.revision, { stepID: 'implement', inputContentVersion: base, contentVersion: diffHash, evidence: 'private-outcome' });
  run = beginValidation(run, run.revision);
  run = startReview(run, run.revision, { planHash: run.planHash!, diffHash, validation: { diffHash, commands: [{ command: 'npm test', exitCode: 0 }] }, reviewer: { providerID: 'p', id: 'm', variant: null, vendor: 'review', modelVersion: 'v1' }, contributingVendors: ['coder'], budgetAvailable: true });
  return recordReview(run, run.revision, { planHash: run.planHash!, diffHash, verdict: 'approve', findings: options.advisory ? [{ id: 'adv1', severity: 'advisory', description: 'Rename the helper', evidence: 'src/widget.ts:12' }] : [] });
}
export async function ready(f: Fixture, options: { advisory?: boolean } = {}) {
  const identity = await contentIdentity(f.dir);
  return { identity, run: reviewedRun(runID, f.base, identity, options) };
}
export const usage = (attemptID: string, grossUsd: string | null, provenance: 'estimated' | 'provider_reported' = 'estimated') => ({ attemptID, revision: 0, startedAt: '2026-01-15T10:00:00.000Z', grossUsd, creditUsd: null, cashUsd: grossUsd, provenance, providerID: 'p', modelID: 'm', effort: null, role: 'coder', projectID: 'proj' });
export const mixedCosts = () => aggregateUsage([usage('a1', '1.5'), usage('a2', null, 'provider_reported')], '2026-01', 'UTC');

export type Pr = { head: string; number: number; url: string; headRefOid: string };
/** Records every call. git is real (so commits and pushes really happen); gh is scripted and "creates" PRs in memory. */
export function harness(f: Fixture, script: { authenticated?: boolean; createFails?: 'before' | 'after'; pushFails?: boolean } = {}) {
  const state = { authenticated: true, createFails: undefined as 'before' | 'after' | undefined, pushFails: false, ...script, prs: [] as Pr[], bodies: [] as string[], calls: [] as { file: string; args: string[] }[], events: [] as string[], records: [] as DeliveryRecord[] };
  const exec: Exec = async (file, args, opt) => {
    state.calls.push({ file, args: [...args] }); state.events.push(`${file} ${args.slice(0, 2).join(' ')}`);
    if (file === 'gh') {
      const flag = (name: string) => args[args.indexOf(name) + 1];
      if (args[0] === 'auth') { if (!state.authenticated) throw new Error('You are not logged into any GitHub hosts'); return { stdout: 'Logged in', stderr: '' }; }
      if (args[1] === 'list') return { stdout: JSON.stringify(state.prs.filter(p => p.head === flag('--head')).map(({ number, url, headRefOid }) => ({ number, url, headRefOid }))), stderr: '' };
      if (args[1] === 'create') {
        if (state.createFails === 'before') throw new Error('network down');
        state.bodies.push(readFileSync(flag('--body-file'), 'utf8'));
        const head = flag('--head'), number = state.prs.length + 1, url = `https://github.com/example/widgets/pull/${number}`;
        state.prs.push({ head, number, url, headRefOid: git(f.remote, 'rev-parse', `refs/heads/${head}`) });
        if (state.createFails === 'after') throw new Error('connection lost after the PR was created');
        return { stdout: `\n${url}\n`, stderr: '' };
      }
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    }
    if (state.pushFails && args[0] === 'push') throw new Error('remote rejected the push');
    const { stdout, stderr } = await execAsync(file, [...args], { cwd: opt.cwd, env: { ...(opt.env ?? process.env), ...isolation }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { stdout, stderr };
  };
  return { state, exec };
}
export type Harness = ReturnType<typeof harness>;
export const target = (f: Fixture, over: Partial<Extract<Destination, { kind: 'github' }>> = {}): Destination => ({ kind: 'github', remote: 'origin', remoteURL: f.remote, baseBranch: 'main', branchPrefix: 'feature-pilot/', ...over });
export const deps = (f: Fixture, h: Harness, extra: Partial<DeliveryDeps> = {}): DeliveryDeps => ({ exec: h.exec, worktree: f.dir, publicationEnabled: true, previous: null, record: async r => { h.state.events.push(`record:${r.phase}`); h.state.records.push(structuredClone(r)); }, ...extra });
