import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, writeFileSync as write } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { step, criterion } from './fixtures/plan-data.js';
import { RunRepository } from '../src/run-store.js';
import { drive } from '../src/orchestrator.js';
import { chooseReviewer, chooseRoutes, contributorsKey, createHostPorts, worktreeKey } from '../src/host-ports.js';
import { coderProfile } from '../src/permissions.js';
import type { Roles, Route } from '../src/settings.js';

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const evidence = { sourceURL: 'https://example.com/p', checkedAt: '2026-11-12T00:00:00Z', kind: 'user_entered' as const, verified: false };
const route = (id: string, vendor: string, variant: string | null = null): Route => ({ providerID: 'p', id, variant, vendor, canonicalID: id, modelVersion: '1', rate: { inputPerMillion: '1', outputPerMillion: '2', cacheReadPerMillion: null, cacheWritePerMillion: null, billing: 'metered_api', serviceTier: 'standard', interactive: true, conditions: [], evidence } });
const choice = (id: string, variant: string | null = null) => ({ providerID: 'p', id, variant });
const routes = [route('plan', 'pv'), route('code', 'cv'), route('rev', 'rv'), route('rev-same', 'cv')];
const roles: Roles = { planner: [choice('plan')], coder: [choice('code')], reviewer: [choice('rev')] };

test('routes are chosen in the user order from rated routes only, and the reviewer must be independent', () => {
  assert.deepEqual(chooseRoutes({ ...roles, planner: [choice('unrated'), choice('plan')] }, routes), { planner: routes[0], coder: routes[1] });
  assert.deepEqual(chooseRoutes({ ...roles, planner: [choice('unrated')] }, routes), { missing: 'planner' });
  assert.deepEqual(chooseRoutes({ ...roles, coder: [] }, routes), { missing: 'coder' });
  assert.deepEqual(chooseRoutes({ ...roles, planner: [choice('plan', 'high')] }, routes), { missing: 'planner' }, 'a variant is its own route');
  assert.equal(chooseReviewer({ ...roles, reviewer: [choice('rev-same'), choice('rev')] }, routes, ['pv', 'cv']), routes[2], 'a same-vendor reviewer is skipped');
  assert.equal(chooseReviewer({ ...roles, reviewer: [choice('rev-same')] }, routes, ['pv', 'cv']), null);
  assert.equal(chooseReviewer(roles, routes, []), null, 'unknown contributors cannot prove independence');
});

type Hooks = { crash?: { role: string; left: number }; outcome?: (session: any) => 'default' | 'active' | 'failed' | 'interrupted'; unsent?: boolean; badReply?: boolean };
function fakeHost(onCoder?: (stage: any) => void, hooks: Hooks = {}) {
  const sessions = new Map<string, any>(), prepared: any[] = []; let n = 0;
  const host: any = {
    async prepareStage(stage: any) { const id = `ses_${++n}`; sessions.set(id, { ...stage }); prepared.push({ id, ...stage }); return id; },
    async submitStagePrompt(id: string, _run: string, promptID: string, text: string) { Object.assign(sessions.get(id), { promptID, text }); },
    async waitStage(id: string) { const s = sessions.get(id); if (s.role === 'coder' && onCoder) onCoder(s); if (hooks.crash && hooks.crash.role === s.role && hooks.crash.left > 0) { hooks.crash.left--; throw new Error('the process died after the prompt was sent'); } },
    async readStage(id: string) {
      const s = sessions.get(id), forced = hooks.outcome?.(s) ?? 'default';
      if (forced !== 'default') return { outcome: forced === 'active' ? undefined : forced, messages: [] };
      if (s.role !== 'reviewer') return { outcome: 'succeeded', messages: [] };
      const data = JSON.parse(s.text.split('Feature data (JSON):\n')[1]);
      const reply = { type: 'assistant', id: 'msg_reply', model: s.model, finish: 'stop', content: [{ type: 'text', text: hooks.badReply ? 'I approve, trust me' : JSON.stringify({ planHash: data.planHash, diffHash: data.diffHash, verdict: 'approve', findings: [] }) }] };
      return { outcome: 'succeeded', messages: [{ type: 'user', id: s.promptID, text: s.text }, reply] };
    },
    async ownsPrompt() { return !hooks.unsent; }, async roleForSession(id: string) { return sessions.get(id)?.role ?? null; },
    async stageModels(id: string) { const m = sessions.get(id).model; return { expected: m, current: m }; },
    async interrupt() { return { interrupted: true }; }, async ownsSession() { return true; },
  };
  return { host, prepared, sessions };
}

async function setup(options: { coderEnabled?: boolean; roles?: Roles; tools?: boolean; onCoder?: (stage: any) => void; shell?: (input: any, context: any) => Promise<unknown>; hooks?: Hooks; steps?: unknown[] } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'fp-ports-')), project = join(parent, 'proj');
  mkdirSync(project); git(project, 'init', '-q'); git(project, 'config', 'core.autocrlf', 'false'); writeFileSync(join(project, 'a.txt'), 'one\n'); git(project, 'add', '-A'); git(project, 'commit', '-qm', 'base');
  const records = new Map<string, unknown>(), store = { async get(k: string) { return records.get(k); }, async set(k: string, v: string) { records.set(k, v); } };
  const repo = new RunRepository({ async get(k: string) { return structuredClone(records.get(k)); }, async set(k: string, v: unknown) { records.set(k, structuredClone(v)); } });
  const base = git(project, 'rev-parse', 'HEAD');
  let run = await repo.create('run-1', 'Add a feature file', base);
  run = await repo.setPlan('run-1', run.revision, { steps: (options.steps ?? [step('Implement')]) as never, acceptance: [criterion('Works')], questions: [], areas: ['src'], rollback: 'revert', validationCommands: ['test'] });
  await repo.approve('run-1', run.revision, run.planHash!);
  records.set(contributorsKey('run-1'), JSON.stringify(['pv']));
  const fake = fakeHost(options.onCoder, options.hooks), shellCalls: any[] = [];
  const passed = { output: { status: 'completed', output: 'ok', truncated: false, exit: 0 }, metadata: { status: 'completed', truncated: false, exit: 0 } };
  const ports = createHostPorts({
    repo, host: fake.host, store, projectDir: project,
    roles: async () => options.roles ?? roles, policy: async () => ({ routes, coderEnabled: options.coderEnabled ?? true }),
    tools: async () => options.tools === false ? [] : [{ id: 'shell', async execute(input, context) { shellCalls.push({ input, context }); return options.shell ? options.shell(input, context) : passed; } }],
    budget: async () => true,
  });
  return { repo, ports, fake, shellCalls, project, parent, records, done: () => { try { git(project, 'worktree', 'prune'); } catch { /* best effort */ } rmSync(parent, { recursive: true, force: true }); } };
}

test('a run flows through worktree, coder, validation and an independent review using the host stages', async () => {
  let during: string[] = [];
  const s = await setup({ onCoder: stage => { writeFileSync(join(stage.work.directory, 'feature.txt'), 'new feature\n'); } });
  try {
    const original = s.fake.host.waitStage; s.fake.host.waitStage = async (id: string, run: string) => { during = s.ports.activeSessions('run-1'); return original(id, run); };
    const run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.state, 'ready_for_acceptance');
    const worktree = join(s.parent, 'proj.feature-pilot', 'run-1');
    const coder = s.fake.prepared.find(item => item.role === 'coder' && item.work.allow.length > 1), validationSession = s.fake.prepared.find(item => item.role === 'coder' && item.work.allow.join() === 'shell');
    assert.deepEqual(coder.work, { directory: worktree, allow: coderProfile.allowedActions }); assert.deepEqual(coder.model, { providerID: 'p', id: 'code' });
    assert.deepEqual(s.shellCalls.map(c => [c.input.command, c.context.sessionID]), [['test', validationSession.id]]);
    assert.equal(s.fake.prepared.filter(item => item.role === 'reviewer').length, 1); assert.equal(s.fake.prepared.find(item => item.role === 'reviewer').work, undefined, 'the reviewer gets no worktree or write access');
    const reviewerPrompt = [...s.fake.sessions.values()].find(item => item.role === 'reviewer').text;
    assert.match(reviewerPrompt, /feature\.txt/); assert.match(reviewerPrompt, /new feature/, 'untracked work is part of the reviewed diff');
    assert.deepEqual(run.review?.contributingVendors, ['pv', 'cv']); assert.equal(run.review?.reviewer.vendor, 'rv');
    assert.equal(JSON.parse(s.records.get(contributorsKey('run-1')) as string).join(), 'pv,cv');
    assert.equal(s.records.get(worktreeKey('run-1')), worktree);
    assert.equal(git(s.project, 'status', '--porcelain'), '', 'the user checkout is untouched'); assert.equal(during.length, 1, 'the in-flight coder session is tracked for stop');
    assert.deepEqual(s.ports.activeSessions('run-1'), []);
  } finally { s.done(); }
});

test('the coder and shell validation stay off until the operator enables them', async () => {
  const s = await setup({ coderEnabled: false });
  try {
    const run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.state, 'needs_attention'); assert.equal(run.attention?.reason, 'coder_not_enabled');
    assert.equal(s.fake.prepared.length, 0, 'no session was created'); assert.equal(s.shellCalls.length, 0);
  } finally { s.done(); }
});

test('review pauses when no independent reviewer exists', async () => {
  const s = await setup({ roles: { ...roles, reviewer: [choice('rev-same')] }, onCoder: stage => writeFileSync(join(stage.work.directory, 'f.txt'), 'x\n') });
  try {
    const run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.attention?.reason, 'no_independent_reviewer'); assert.equal(s.fake.prepared.filter(item => item.role === 'reviewer').length, 0);
  } finally { s.done(); }
});

test('review refuses a worktree that changed after validation and sends nothing to the reviewer', async () => {
  const s = await setup({ onCoder: stage => writeFileSync(join(stage.work.directory, 'f.txt'), 'x\n') });
  try {
    const review = s.ports.review; s.ports.review = async run => { writeFileSync(join(s.parent, 'proj.feature-pilot', 'run-1', 'sneaky.txt'), 'late\n'); return review(run); };
    const run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.attention?.reason, 'worktree_changed_since_validation'); assert.equal(s.fake.prepared.filter(item => item.role === 'reviewer').length, 0);
  } finally { s.done(); }
});

test('validation is unavailable without the host shell tool, and drift during validation is stale', async () => {
  const none = await setup({ tools: false, onCoder: stage => writeFileSync(join(stage.work.directory, 'f.txt'), 'x\n') });
  try { assert.equal((await drive(none.repo, none.ports, 'run-1')).attention?.reason, 'shell_tool_unavailable'); } finally { none.done(); }
  const drift = await setup({ onCoder: stage => writeFileSync(join(stage.work.directory, 'f.txt'), 'x\n') });
  try {
    const original = drift.ports.validate; drift.ports.validate = async (run, identity) => { const dir = join(drift.parent, 'proj.feature-pilot', 'run-1'); writeFileSync(join(dir, 'late.txt'), 'changed during validation\n'); return original(run, identity); };
    assert.equal((await drive(drift.repo, drift.ports, 'run-1')).attention?.reason, 'validation_stale');
  } finally { drift.done(); }
});

test('an unfinished planner turn is restarted only when its prompt was never sent, and refused while it may still be running', async () => {
  const unsent = await setup();
  try {
    await unsent.repo.create('run-2', 'Add search', git(unsent.project, 'rev-parse', 'HEAD')); unsent.records.set(contributorsKey('run-2'), JSON.stringify([]));
    unsent.records.set('planner-turn/run-2', JSON.stringify({ runID: 'run-2', revision: 0, phase: 'creating', sessionID: null, promptID: null }));
    await drive(unsent.repo, unsent.ports, 'run-2');
    assert.equal(unsent.fake.prepared.filter(item => item.role === 'planner').length, 1, 'nothing had been sent, so a fresh planner session starts');
  } finally { unsent.done(); }
  const running = await setup();
  try {
    await running.repo.create('run-2', 'Add search', git(running.project, 'rev-parse', 'HEAD')); running.records.set(contributorsKey('run-2'), JSON.stringify([]));
    running.records.set('planner-turn/run-2', JSON.stringify({ runID: 'run-2', revision: 0, phase: 'submitted', sessionID: 'ses_old', promptID: 'msg_old' }));
    running.fake.sessions.set('ses_old', { role: 'planner' }); running.fake.host.readStage = async () => ({ outcome: 'running', messages: [] });
    const run = await drive(running.repo, running.ports, 'run-2');
    assert.equal(run.attention?.reason, 'planner_session_unresolved'); assert.equal(running.fake.prepared.filter(item => item.role === 'planner').length, 0, 'no second prompt while the first may still be running');
  } finally { running.done(); }
});

test('a link the coder plants in the worktree cannot pull an outside file into the reviewer prompt', async t => {
  const secret = 'TOP-SECRET-OUTSIDE-CONTENT';
  const s = await setup({ onCoder: stage => {
    write(join(stage.work.directory, 'real.txt'), 'legit change\n');
    write(join(s.parent, 'outside.txt'), `${secret}\n`);
    try { symlinkSync(join(s.parent, 'outside.txt'), join(stage.work.directory, 'link.txt'), 'file'); } catch { stage.noSymlink = true; }
  } });
  try {
    const run = await drive(s.repo, s.ports, 'run-1');
    const prompt = [...s.fake.sessions.values()].find(item => item.role === 'reviewer')?.text ?? '';
    if ([...s.fake.sessions.values()].some(item => item.noSymlink)) return t.skip('this account cannot create symlinks');
    assert.ok(run.state === 'ready_for_acceptance' || prompt.length > 0, 'the review still ran');
    assert.match(prompt, /legit change/); assert.equal(prompt.includes(secret), false, 'outside content must never reach the reviewer');
  } finally { s.done(); }
});

test('a stop requested while a stage session is being prepared prevents the paid prompt from being sent', async () => {
  const s = await setup({ onCoder: stage => writeFileSync(join(stage.work.directory, 'f.txt'), 'x\n') });
  try {
    const prepare = s.fake.host.prepareStage; let stopped = false;
    s.fake.host.prepareStage = async (stage: any) => { const id = await prepare(stage); if (stage.role === 'coder' && !stopped) { stopped = true; await s.repo.requestStop('run-1', (await s.repo.get('run-1')).revision); } return id; };
    const run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.state, 'cancelled');
    assert.equal([...s.fake.sessions.values()].filter(item => item.text !== undefined).length, 0, 'no prompt was dispatched after the stop');
    assert.equal(JSON.parse(String(s.records.get('stage-turn/run-1/coder'))).phase, 'abandoned', 'a turn that never sent anything is not left looking unfinished');
  } finally { s.done(); }
});

test('a repair coder from the vendor that reviewed the run is refused before spending', async () => {
  const s = await setup({ onCoder: stage => writeFileSync(join(stage.work.directory, 'f.txt'), 'x\n') });
  try {
    const first = await drive(s.repo, s.ports, 'run-1'); assert.equal(first.state, 'ready_for_acceptance');
    // the user later switches the coder to a model from the reviewer's vendor
    const sameVendor: Roles = { ...roles, coder: [choice('code-from-reviewer-vendor')] };
    routes.push(route('code-from-reviewer-vendor', 'rv'));
    const ports2 = createHostPorts({ repo: s.repo, host: s.fake.host, store: { get: async k => s.records.get(k), set: async (k, v) => { s.records.set(k, v); } }, projectDir: s.project, roles: async () => sameVendor, policy: async () => ({ routes, coderEnabled: true }), tools: async () => [], budget: async () => true });
    const before = s.fake.prepared.length;
    await assert.rejects(ports2.code({ ...first, review: first.review } as never, null), (error: any) => error.reason === 'coder_shares_reviewer_vendor');
    assert.equal(s.fake.prepared.length, before, 'no session was created');
  } finally { routes.pop(); s.done(); }
});

test('an oversized diff pauses while validating, so the run can still be amended, and no reviewer is prompted', async () => {
  const s = await setup({ onCoder: stage => writeFileSync(join(stage.work.directory, 'big.txt'), 'x'.repeat(40) + '\n'.repeat(1) + 'y'.repeat(600_000) + '\n') });
  try {
    const run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.attention?.reason, 'diff_too_large_to_review'); assert.equal(run.attention?.resumeState, 'validating');
    assert.equal(s.fake.prepared.filter(item => item.role === 'reviewer').length, 0);
  } finally { s.done(); }
});

test('source that git would show as binary is refused, but a real binary asset is listed to the reviewer as not shown', async () => {
  const hidden = await setup({ onCoder: stage => writeFileSync(join(stage.work.directory, 'evil.js'), Buffer.concat([Buffer.from('// '), Buffer.from([0]), Buffer.from('\nrequire("child_process")\n')])) });
  try { const run = await drive(hidden.repo, hidden.ports, 'run-1'); assert.equal(run.attention?.reason, 'text_file_treated_as_binary'); assert.equal(hidden.fake.prepared.filter(item => item.role === 'reviewer').length, 0); } finally { hidden.done(); }
  const asset = await setup({ onCoder: stage => { writeFileSync(join(stage.work.directory, 'logo.png'), Buffer.from([137, 80, 78, 71, 0, 1, 2, 3])); writeFileSync(join(stage.work.directory, 'ok.txt'), 'fine\n'); } });
  try {
    const run = await drive(asset.repo, asset.ports, 'run-1'); assert.equal(run.state, 'ready_for_acceptance');
    const prompt = [...asset.fake.sessions.values()].find(item => item.role === 'reviewer').text; assert.match(prompt, /Binary files not shown to you \(1\): logo\.png/);
  } finally { asset.done(); }
});

test('a failed planner turn does not strand the run: resuming asks again instead of refusing forever', async () => {
  const s = await setup();
  try {
    await s.repo.create('run-3', 'Add search', git(s.project, 'rev-parse', 'HEAD')); s.records.set(contributorsKey('run-3'), JSON.stringify([]));
    let run = await drive(s.repo, s.ports, 'run-3');   // the fake host returns no usable planner reply
    assert.equal(run.attention?.reason, 'stage_failed');
    const planners = () => s.fake.prepared.filter(item => item.role === 'planner').length;
    assert.equal(planners(), 1);
    run = await s.repo.resume('run-3', run.revision);
    run = await drive(s.repo, s.ports, 'run-3');
    assert.notEqual(run.attention?.reason, 'planner_run_changed', 'the pause/resume revision bump must not make the checkpoint unusable');
    assert.equal(planners(), 2, 'resume asked the planner again with a fresh session');
    run = await s.repo.resume('run-3', run.revision); run = await drive(s.repo, s.ports, 'run-3');
    assert.equal(planners(), 3, 'and again on every later resume, never stuck');
  } finally { s.done(); }
});

test('stop aborts a validation command that is running and the run is cancelled without waiting for its deadline', async () => {
  let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; }); let signalSeen: AbortSignal | undefined;
  const s = await setup({ onCoder: stage => writeFileSync(join(stage.work.directory, 'f.txt'), 'x\n'), shell: (_input, context) => { signalSeen = context.signal; began(); return new Promise(() => { /* never finishes on its own */ }); } });
  try {
    const driven = drive(s.repo, s.ports, 'run-1');
    await started;
    await s.repo.requestStop('run-1', (await s.repo.get('run-1')).revision);
    s.ports.abort('run-1');
    const run = await Promise.race([driven, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('validation was not aborted')), 5000))]);
    assert.equal(run.state, 'cancelled'); assert.equal(signalSeen?.aborted, true, 'the host tool was also given an aborted signal');
  } finally { s.done(); }
});

const coderFiles = (stage: any) => writeFileSync(join(stage.work.directory, 'feature.txt'), 'new feature\n');
const turnsOf = (s: Awaited<ReturnType<typeof setup>>, role: string) => [...s.fake.sessions.values()].filter(item => item.role === role && item.text !== undefined).length; // sessions that were sent a prompt (validation also opens a coder-role shell session)
const resumeAndDrive = async (s: Awaited<ReturnType<typeof setup>>) => { const run = await s.repo.get('run-1'); await s.repo.resume('run-1', run.revision); return drive(s.repo, s.ports, 'run-1'); };

test('a crash after the coder prompt was sent is reconciled on resume: the finished turn is reused, not paid for again', async () => {
  const s = await setup({ onCoder: coderFiles, hooks: { crash: { role: 'coder', left: 1 } } });
  try {
    let run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.attention?.reason, 'stage_failed'); assert.equal(turnsOf(s, 'coder'), 1);
    run = await resumeAndDrive(s);
    assert.equal(turnsOf(s, 'coder'), 1, 'no second coding session or prompt'); assert.equal(run.state, 'ready_for_acceptance');
  } finally { s.done(); }
});

test('an earlier coder turn that failed is asked again, and one that may still be running is never asked twice', async () => {
  let failedPrompt = '';
  const failing = await setup({ onCoder: coderFiles, hooks: { crash: { role: 'coder', left: 1 }, outcome: session => session.promptID === failedPrompt ? 'failed' : 'default' } });
  try {
    let run = await drive(failing.repo, failing.ports, 'run-1');
    failedPrompt = [...failing.fake.sessions.values()][0].promptID;
    run = await resumeAndDrive(failing);
    assert.equal(turnsOf(failing, 'coder'), 2, 'the failed turn was abandoned and a fresh one started'); assert.equal(run.state, 'ready_for_acceptance');
  } finally { failing.done(); }
  const running = await setup({ onCoder: coderFiles, hooks: { crash: { role: 'coder', left: 1 }, outcome: () => 'active' } });
  try {
    await drive(running.repo, running.ports, 'run-1');
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = await resumeAndDrive(running);
      assert.equal(run.attention?.reason, 'coder_turn_unresolved'); assert.equal(turnsOf(running, 'coder'), 1, 'nothing more was sent');
    }
  } finally { running.done(); }
});

test('a coder turn whose prompt provably never reached the session is restarted instead of stranding the run', async () => {
  const hooks: Hooks = { crash: { role: 'coder', left: 1 }, outcome: () => 'active', unsent: true };
  const s = await setup({ onCoder: coderFiles, hooks });
  try {
    await drive(s.repo, s.ports, 'run-1');
    const key = 'stage-turn/run-1/coder', turn = JSON.parse(String(s.records.get(key)));
    s.records.set(key, JSON.stringify({ ...turn, phase: 'dispatching' }));
    hooks.outcome = session => session.promptID === turn.promptID ? 'active' : 'default'; hooks.unsent = false;
    const unsentHost = s.fake.host.ownsPrompt; s.fake.host.ownsPrompt = async (id: string, ...rest: any[]) => id === 'ses_1' ? false : unsentHost(id, ...rest);
    const run = await resumeAndDrive(s);
    assert.equal(turnsOf(s, 'coder'), 2, 'a fresh turn replaced the one that was never sent'); assert.equal(run.state, 'ready_for_acceptance');
  } finally { s.done(); }
});

test('a crash after the review prompt was sent reuses that review; an unusable reply is not reused', async () => {
  const crashing = await setup({ onCoder: coderFiles, hooks: { crash: { role: 'reviewer', left: 1 } } });
  try {
    let run = await drive(crashing.repo, crashing.ports, 'run-1');
    assert.equal(run.attention?.reason, 'stage_failed'); assert.equal(turnsOf(crashing, 'reviewer'), 1);
    run = await resumeAndDrive(crashing);
    assert.equal(turnsOf(crashing, 'reviewer'), 1, 'the sent review was read, not requested again'); assert.equal(run.state, 'ready_for_acceptance');
  } finally { crashing.done(); }
  const hooks: Hooks = { badReply: true }, bad = await setup({ onCoder: coderFiles, hooks });
  try {
    let run = await drive(bad.repo, bad.ports, 'run-1');
    assert.notEqual(run.state, 'ready_for_acceptance'); assert.equal(turnsOf(bad, 'reviewer'), 1);
    hooks.badReply = false; run = await resumeAndDrive(bad);
    assert.equal(turnsOf(bad, 'reviewer'), 2, 'a bad reply is abandoned so the next attempt asks again'); assert.equal(run.state, 'ready_for_acceptance');
  } finally { bad.done(); }
});

const migrateStep = (deadlineMs = 5000) => ({ ...step('Migrate', 'migrate'), inference: false, dependsOn: [] as string[], execution: { kind: 'command' as const, command: 'npm run migrate', deadlineMs, readyProbe: null } });

test('a one-shot command step runs through the host shell tool in the run worktree and is recorded as an outcome', async () => {
  const s = await setup({ steps: [step('Implement'), migrateStep()], onCoder: coderFiles });
  try {
    const run = await drive(s.repo, s.ports, 'run-1');
    assert.equal(run.state, 'ready_for_acceptance', JSON.stringify(run.attention));
    assert.deepEqual(s.shellCalls.map(call => call.input.command), ['npm run migrate', 'test'], 'the approved step command, then the approved validation command');
    const shellSession = s.fake.sessions.get(s.shellCalls[0].context.sessionID);
    assert.equal(shellSession.work.directory, await s.repo.get('run-1').then(() => s.records.get(worktreeKey('run-1'))), 'the shell session is scoped to the run worktree');
    assert.deepEqual(run.jobs, []); assert.ok(run.outcomes.some(item => item.stepID === 'migrate'));
  } finally { s.done(); }
});

test('a command step needs the shell opt-in, and a command that overruns its deadline pauses instead of passing', async () => {
  const off = await setup({ steps: [migrateStep()], coderEnabled: false });
  try {
    const run = await drive(off.repo, off.ports, 'run-1');
    assert.equal(run.attention?.reason, 'shell_not_enabled'); assert.equal(off.shellCalls.length, 0, 'nothing was executed');
  } finally { off.done(); }
  let signal: AbortSignal | undefined;
  const slow = await setup({ steps: [migrateStep(60)], shell: (_input, context) => { signal = context.signal; return new Promise(() => { /* never finishes */ }); } });
  try {
    const run = await drive(slow.repo, slow.ports, 'run-1');
    assert.equal(run.attention?.reason, 'step_command_timed_out'); assert.equal(signal?.aborted, true, 'the host tool was told to stop');
    assert.equal(run.outcomes.length, 0);
  } finally { slow.done(); }
});

test('stop ends a running command step at once', async () => {
  let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  const s = await setup({ steps: [migrateStep(3_600_000)], shell: () => { began(); return new Promise(() => { /* never finishes */ }); } });
  try {
    const driven = drive(s.repo, s.ports, 'run-1'); await started;
    await s.repo.requestStop('run-1', (await s.repo.get('run-1')).revision); s.ports.abort('run-1');
    const run = await Promise.race([driven, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('command step was not aborted')), 5000))]);
    assert.equal(run.state, 'cancelled');
  } finally { s.done(); }
});
