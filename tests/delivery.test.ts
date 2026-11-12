import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { exportRunPreview, exportRun, deliverRun, buildPullRequestBody, type DeliveryDeps, type DeliveryRecord } from '../src/delivery.js';
import { newRun, setPlan, approvePlan, beginImplementation, beginValidation, recordStepOutcome, startReview, recordReview, askQuestions, answerQuestions, acceptRun, type Run } from '../src/run.js';
import { aggregateUsage } from '../src/usage.js';
import { contentIdentity, type Exec } from '../src/worktree.js';
import type { Destination } from '../src/types.js';
import { step, criterion } from './fixtures/plan-data.js';

test('exports saved artifacts while omitting unrelated fields and labelling unknowns', () => {
  let run=newRun('run','Feature','base'); run=setPlan(run,run.revision,{steps:[step('Implement')],acceptance:[criterion('Works')],questions:[],areas:['src'],rollback:'revert',validationCommands:['test']});
  run=approvePlan(run,run.revision,run.planHash!);run=beginImplementation(run,run.revision);run=recordStepOutcome(run,run.revision,{stepID:'implement',inputContentVersion:'base',contentVersion:'diff',evidence:'do-not-export-private-outcome'});run=beginValidation(run,run.revision);
  run=startReview(run,run.revision,{planHash:run.planHash!,diffHash:'diff',validation:{diffHash:'diff',commands:[{command:'test',exitCode:0}]},reviewer:{providerID:'p',id:'m',variant:null,vendor:'review',modelVersion:'v1'},contributingVendors:['coder'],budgetAvailable:true});
  run=recordReview(run,run.revision,{planHash:run.planHash!,diffHash:'diff',verdict:'approve',findings:[]});
  (run as any).apiKey='secret-top-level';(run.approval as any).apiKey='secret-approval';(run.review!.reviewer as any).apiKey='secret-reviewer';(run.review!.reviews[0] as any).apiKey='secret-review';(run.review!.reviews[0].validation.commands[0] as any).apiKey='secret-command';
  const raw=exportRunPreview(run), report=JSON.parse(raw);
  assert.equal(report.requirement,'Feature');assert.equal(report.planHash,run.planHash);assert.equal(report.review.reviews[0].verdict,'approve');
  assert.match(report.limitations.costs,/unavailable/i);assert.match(report.limitations.diff,/not included/i);
  assert.equal(raw.includes('secret-'),false);assert.equal(raw.includes('do-not-export-private-outcome'),false);
});

test('rejects corrupted run records instead of producing a misleading export',()=>{
  const run=newRun('r','Feature','base');(run as any).stopRequested='no';assert.throws(()=>exportRunPreview(run),/invalid/i);
});

// ---- Task 9: export and authorized draft PR delivery ----
import { branch, runID, title, git, fixture, reviewedRun, ready, usage, mixedCosts, harness, target, deps, type Fixture, type Harness } from './fixtures/delivery-fixture.js';
const ghCalls = (h: Harness, sub: string) => h.state.calls.filter(c => c.file === 'gh' && c.args[1] === sub);
const gitCalls = (h: Harness, sub: string) => h.state.calls.filter(c => c.file === 'git' && c.args[0] === sub);
const nothingCommitted = (f: Fixture) => { assert.equal(git(f.dir, 'rev-parse', 'HEAD'), f.base); assert.equal(git(f.dir, 'branch', '--list', branch), ''); assert.equal(git(f.remote, 'branch', '--list'), ''); };

test('delivers exactly the reviewed content, untracked files included, as one commit and a draft PR built from structured argv', async () => {
  const f = fixture();
  try {
    const { identity, run } = await ready(f, { advisory: true }), h = harness(f);
    const result = await deliverRun(run, target(f), deps(f, h, { costs: mixedCosts() }));
    assert.equal(result.status, 'delivered'); if (result.status !== 'delivered') return;
    assert.equal(result.branch, branch); assert.equal(result.reusedPR, false); assert.equal(result.prUrl, 'https://github.com/example/widgets/pull/1');
    const pushed = `refs/heads/${branch}`;
    assert.equal(`tree:${git(f.remote, 'rev-parse', `${pushed}^{tree}`)}`, identity, 'pushed tree is the reviewed content');
    assert.deepEqual(git(f.remote, 'ls-tree', '-r', '--name-only', pushed).split('\n'), ['.gitignore', 'a.txt', 'sub/new.txt'], 'the untracked file is delivered');
    assert.equal(git(f.remote, 'rev-list', '--count', `${f.base}..${pushed}`), '1'); assert.equal(git(f.remote, 'rev-parse', `${pushed}^`), f.base);
    assert.equal(git(f.remote, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', pushed), 'Config User <config@example.invalid>|Config User <config@example.invalid>', 'identity comes from git config');
    assert.equal(git(f.dir, 'status', '--porcelain'), ''); assert.equal(existsSync(join(f.dir, 'pwned')), false, 'model text was never interpolated into a shell');
    const create = ghCalls(h, 'create'); assert.equal(create.length, 1);
    assert.deepEqual(create[0].args, ['pr', 'create', '--draft', '--base', 'main', '--head', branch, '--title', title, '--body-file', create[0].args[10]]);
    assert.equal(existsSync(create[0].args[10]), false, 'the body file is removed');
    assert.deepEqual(gitCalls(h, 'push').map(c => c.args), [['push', 'origin', `${pushed}:${pushed}`]]);
    const everyArg = h.state.calls.flatMap(c => c.args);
    for (const forbidden of ['--force', '-f', '--force-with-lease', 'merge', '--auto', '--admin', 'deploy']) assert.equal(everyArg.includes(forbidden), false, forbidden);
    assert.ok(h.state.calls.every(c => c.file === 'git' || c.file === 'gh'));
    const body = h.state.bodies[0];
    assert.match(body, /widget-renders.*Widget renders/); assert.match(body, /Widget is keyboard accessible/); assert.match(body, /`sub\/new\.txt`/); assert.match(body, /`npm test` exited 0/);
    assert.match(body, /adv1.*Rename the helper/); assert.match(body, /1 estimated, 1 provider_reported/); assert.match(body, /human must review/i); assert.doesNotMatch(body, /private-outcome|\$\d/);
    const order = ['record:committed', 'git push origin', 'gh pr create', 'record:delivered'].map(e => h.state.events.indexOf(e));
    assert.ok(order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `identity is recorded before pushing and the PR URL after creation: ${order}`);
    assert.deepEqual(h.state.records.map(r => [r.phase, r.prUrl]), [['committed', null], ['delivered', result.prUrl]]);
  } finally { f.done(); }
});

test('an accepted run is deliverable too', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f);
    const result = await deliverRun(acceptRun(run, run.revision), target(f), deps(f, h));
    assert.equal(result.status, 'delivered');
  } finally { f.done(); }
});

test('refuses when publication is disabled, the run is unfinished, or names are not plain', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f);
    assert.deepEqual(await deliverRun(run, target(f), deps(f, h, { publicationEnabled: false })), { status: 'refused', reason: 'Publication is not enabled for this project' });
    const early = await deliverRun(newRun(runID, 'Feature', f.base), target(f), deps(f, h)); assert.equal(early.status, 'refused'); assert.match((early as { reason: string }).reason, /planning/);
    for (const over of [{ remote: '--upload-pack=evil' }, { baseBranch: '../main' }, { branchPrefix: '-x/' }]) assert.equal((await deliverRun(run, target(f, over), deps(f, h))).status, 'refused');
    assert.equal(h.state.calls.length, 0, 'no command ran'); nothingCommitted(f);
  } finally { f.done(); }
});

test('refuses a remote that is not the authorized one', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f);
    const result = await deliverRun(run, target(f, { remoteURL: 'https://github.com/someone-else/widgets.git' }), deps(f, h));
    assert.equal(result.status, 'refused'); assert.match((result as { reason: string }).reason, /remote/i);
    assert.equal(h.state.calls.some(c => c.file === 'gh' || c.args[0] === 'commit' || c.args[0] === 'push'), false); nothingCommitted(f);
  } finally { f.done(); }
});

test('refuses content drift after review and a moved branch, committing nothing', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f);
    writeFileSync(join(f.dir, 'a.txt'), 'edited after review\n');
    const drifted = await deliverRun(run, target(f), deps(f, h)); assert.equal(drifted.status, 'refused'); assert.match((drifted as { reason: string }).reason, /after review/);
    writeFileSync(join(f.dir, 'a.txt'), 'two\n');
    git(f.dir, 'add', '-A'); git(f.dir, 'commit', '-qm', 'someone committed the work already');
    const moved = await deliverRun(run, target(f), deps(f, h)); assert.equal(moved.status, 'refused'); assert.match((moved as { reason: string }).reason, /base commit/);
    assert.equal(h.state.calls.some(c => c.file === 'gh' || c.args[0] === 'push'), false); assert.equal(git(f.remote, 'branch', '--list'), '');
  } finally { f.done(); }
});

test('refuses unrelated staged files and commits nothing', async () => {
  const f = fixture();
  try {
    const { identity, run } = await ready(f), h = harness(f);
    writeFileSync(join(f.dir, 'ignored.txt'), 'not part of the review\n'); git(f.dir, 'add', '-f', 'ignored.txt');
    assert.equal(await contentIdentity(f.dir), identity, 'the review identity does not see the force-added ignored file');
    const result = await deliverRun(run, target(f), deps(f, h));
    assert.equal(result.status, 'refused'); assert.match((result as { reason: string }).reason, /staged files differ/);
    assert.equal(gitCalls(h, 'commit').length, 0); assert.equal(git(f.dir, 'rev-parse', 'HEAD'), f.base); assert.equal(git(f.dir, 'branch', '--list', branch), ''); assert.equal(git(f.remote, 'branch', '--list'), '');
  } finally { f.done(); }
});

test('missing GitHub credentials pause before any side effect', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f, { authenticated: false });
    const result = await deliverRun(run, target(f), deps(f, h));
    assert.equal(result.status, 'needs_attention'); assert.match((result as { reason: string }).reason, /credentials/i); assert.equal((result as { record: unknown }).record, null);
    assert.equal(h.state.records.length, 0); assert.equal(gitCalls(h, 'commit').length, 0); assert.equal(gitCalls(h, 'push').length, 0); nothingCommitted(f);
    assert.equal(readFileSync(join(f.dir, 'a.txt'), 'utf8'), 'two\n'); assert.equal(readFileSync(join(f.dir, 'sub', 'new.txt'), 'utf8'), 'untracked\n');
  } finally { f.done(); }
});

test('a failed push is ambiguous: needs attention, record and local commit preserved, no PR and no retry', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f, { pushFails: true });
    const result = await deliverRun(run, target(f), deps(f, h));
    assert.equal(result.status, 'needs_attention'); if (result.status !== 'needs_attention') return;
    assert.match(result.reason, /git push/); assert.equal(gitCalls(h, 'push').length, 1); assert.equal(ghCalls(h, 'create').length, 0);
    const local = git(f.dir, 'rev-parse', `refs/heads/${branch}`);
    assert.deepEqual(result.record, { branch, commit: local, prUrl: null, phase: 'committed' }); assert.deepEqual(h.state.records, [result.record]);
    assert.equal(readFileSync(join(f.dir, 'a.txt'), 'utf8'), 'two\n');
  } finally { f.done(); }
});

test('retry after a crash between push and PR creation creates exactly one PR and no second commit', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f, { createFails: 'before' });
    const first = await deliverRun(run, target(f), deps(f, h));
    assert.equal(first.status, 'needs_attention'); if (first.status !== 'needs_attention') return;
    assert.match(first.reason, /gh pr create/); assert.equal(h.state.prs.length, 0); assert.equal(first.record?.phase, 'committed');
    assert.equal(git(f.remote, 'rev-parse', `refs/heads/${branch}`), first.record?.commit, 'the push had completed');
    h.state.createFails = undefined;
    const second = await deliverRun(run, target(f), deps(f, h, { previous: first.record }));
    assert.equal(second.status, 'delivered'); if (second.status !== 'delivered') return;
    assert.equal(second.reusedPR, false); assert.equal(second.commit, first.record?.commit); assert.equal(h.state.prs.length, 1);
    assert.equal(gitCalls(h, 'commit').length, 1, 'the commit was not repeated'); assert.equal(git(f.remote, 'rev-list', '--count', `${f.base}..refs/heads/${branch}`), '1');
    assert.equal(h.state.records.at(-1)?.phase, 'delivered');
  } finally { f.done(); }
});

test('retry when the PR already exists reuses it and creates none', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f, { createFails: 'after' });
    const first = await deliverRun(run, target(f), deps(f, h));
    assert.equal(first.status, 'needs_attention'); if (first.status !== 'needs_attention') return;
    assert.equal(h.state.prs.length, 1, 'the PR was created even though the call reported failure');
    h.state.createFails = undefined;
    const second = await deliverRun(run, target(f), deps(f, h, { previous: first.record }));
    assert.equal(second.status, 'delivered'); if (second.status !== 'delivered') return;
    assert.equal(second.reusedPR, true); assert.equal(second.prUrl, h.state.prs[0].url);
    const third = await deliverRun(run, target(f), deps(f, h, { previous: h.state.records.at(-1)! }));
    assert.equal(third.status, 'delivered');
    assert.equal(ghCalls(h, 'create').length, 1, 'exactly one creation across all attempts'); assert.equal(gitCalls(h, 'push').length, 1, 'nothing was pushed again'); assert.equal(h.state.prs.length, 1);
  } finally { f.done(); }
});

test('a pre-existing run branch without a delivery record is not trusted', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f);
    git(f.dir, 'branch', branch);
    const result = await deliverRun(run, target(f), deps(f, h));
    assert.equal(result.status, 'needs_attention'); assert.match((result as { reason: string }).reason, /already exists/);
    assert.equal(h.state.calls.some(c => c.file === 'gh' || c.args[0] === 'push' || c.args[0] === 'commit'), false);
  } finally { f.done(); }
});

test('a commit whose content differs from the reviewed content is never pushed', async () => {
  const f = fixture();
  try {
    const { run } = await ready(f), h = harness(f);
    writeFileSync(join(f.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho sneaky >> a.txt\ngit add a.txt\n', { mode: 0o755 });
    const result = await deliverRun(run, target(f), deps(f, h));
    assert.equal(result.status, 'needs_attention'); assert.match((result as { reason: string }).reason, /differs from the reviewed content/);
    assert.equal(gitCalls(h, 'push').length, 0); assert.equal(h.state.records.length, 0); assert.equal(git(f.remote, 'branch', '--list'), '');
  } finally { f.done(); }
});

test('local destinations are exported through deliverRun', async () => {
  const f = fixture(), out = mkdtempSync(join(tmpdir(), 'fp-out-'));
  try {
    const { run } = await ready(f), h = harness(f);
    const result = await deliverRun(run, { kind: 'local', directory: out }, deps(f, h, { publicationEnabled: false }));
    assert.equal(result.status, 'exported'); if (result.status !== 'exported') return;
    assert.ok(result.paths.every(p => existsSync(p))); assert.equal(h.state.calls.length, 0);
  } finally { f.done(); rmSync(out, { recursive: true, force: true }); }
});

test('exportRun writes allow-listed artifacts, labels unknown costs, and never overwrites different content', async () => {
  const out = mkdtempSync(join(tmpdir(), 'fp-export-')), second = mkdtempSync(join(tmpdir(), 'fp-export-'));
  try {
    const run = reviewedRun('run-1', 'base', 'diff', { advisory: true }) as any;
    run.apiKey = 'secret-top-level'; run.prompt = 'secret-raw-prompt'; run.benchmark = { score: 'secret-benchmark' }; run.approval.token = 'secret-approval';
    run.review.reviewer.apiKey = 'secret-reviewer'; run.review.reviews[0].apiKey = 'secret-review'; run.review.reviews[0].validation.commands[0].apiKey = 'secret-command';
    const costs = mixedCosts() as any; costs.total.apiKey = 'secret-costs'; costs.total.gross.apiKey = 'secret-gross'; costs.breakdown.model = [{ key: 'secret-benchmark-by-model' }];
    const destination = { kind: 'local' as const, directory: out };
    const result = await exportRun(run, costs, destination);
    const [jsonPath, summaryPath] = result.paths, jsonText = readFileSync(jsonPath, 'utf8'), summary = readFileSync(summaryPath, 'utf8'), report = JSON.parse(jsonText);
    assert.ok(jsonPath.endsWith(join('feature-pilot-run-1', 'run.json')) && summaryPath.endsWith(join('feature-pilot-run-1', 'summary.md')));
    assert.equal(result.sha256, createHash('sha256').update(jsonText).digest('hex'));
    assert.equal(report.requirement, run.requirement); assert.equal(report.planHash, run.planHash); assert.equal(report.approval.type, 'human'); assert.equal(report.run.baseCommit, 'base');
    assert.equal(report.clarification[0].answer, 'Staff only'); assert.equal(report.review.reviews[0].verdict, 'approve'); assert.equal(report.review.reviews[0].findings[0].severity, 'advisory');
    assert.deepEqual(report.review.reviews[0].validation.commands, [{ command: 'npm test', exitCode: 0 }]);
    assert.deepEqual(report.costs.gross, { knownUsd: '1.5', unknownCount: 1 }); assert.equal(report.costs.credit.unknownCount, 2); assert.equal(report.costs.estimated, 1); assert.equal(report.costs.providerReported, 1);
    for (const text of ['Staff only', 'npm test', run.planHash, 'at least $1.5 known; 1 attempt(s) unknown', 'at least $0 known; 2 attempt(s) unknown', '1 estimated, 1 provider_reported', 'Rename the helper']) assert.ok(summary.includes(text), text);
    for (const text of [jsonText, summary]) { assert.doesNotMatch(text, /secret-/); assert.equal(text.includes('private-outcome'), false); }
    if (process.platform !== 'win32') assert.equal(statSync(join(out, 'feature-pilot-run-1')).mode & 0o777, 0o700);
    assert.deepEqual(await exportRun(run, costs, destination), result, 'an identical re-export is accepted');
    await assert.rejects(exportRun(run, null, destination), /different content/); assert.equal(readFileSync(jsonPath, 'utf8'), jsonText);
    await exportRun(run, null, { kind: 'local', directory: second });
    const none = JSON.parse(readFileSync(join(second, 'feature-pilot-run-1', 'run.json'), 'utf8')); assert.equal(none.costs.status, 'unavailable');
    assert.match(readFileSync(join(second, 'feature-pilot-run-1', 'summary.md'), 'utf8'), /unknown, not zero/);
    await assert.rejects(exportRun(reviewedRun('../evil', 'base', 'diff'), null, destination), /not safe/);
  } finally { rmSync(out, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); }
});

test('the pull request body has the required sections and no private data', () => {
  const run = reviewedRun('run-1', 'base', 'diff', { advisory: true }) as any;
  run.apiKey = 'secret-top-level'; run.prompt = 'secret-raw-prompt';
  const body = buildPullRequestBody(run, mixedCosts(), ['a.txt', 'sub/new.txt']);
  for (const heading of ['## Acceptance criteria', '## Changed files', '## Test evidence', '## Unresolved advisory findings', '## Cost provenance']) assert.ok(body.includes(heading), heading);
  assert.match(body, /`widget-renders`: Widget renders/); assert.match(body, /`a\.txt`/); assert.match(body, /`npm test` exited 0/); assert.match(body, /`adv1`: Rename the helper/);
  assert.match(body, /2 model attempt\(s\): 1 estimated, 1 provider_reported/); assert.match(body, /Unknown amounts \(gross \/ credit \/ cash\): 1 \/ 2 \/ 1/); assert.match(body, /human must review/i);
  assert.doesNotMatch(body, /secret-|private-outcome|\$\d/);
  assert.match(buildPullRequestBody(reviewedRun('run-2', 'base', 'diff'), null, ['a.txt']), /Cost accounting is unavailable; amounts are unknown/);
  assert.match(buildPullRequestBody(reviewedRun('run-2', 'base', 'diff'), null), /None\./);
});
