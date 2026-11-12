import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { validateRun, type Run } from './run.js';
import type { Destination } from './types.js';
import type { aggregateUsage } from './usage.js';
import { contentIdentity, snapshotDiff, type Exec, type Snapshot } from './worktree.js';

/** Aggregate spend for the run as produced by `aggregateUsage`; null means complete accounting is unavailable. */
export type Costs = ReturnType<typeof aggregateUsage> | null;

/** The allow-listed, secret-free view of a run. Every export and PR text is built from this (or the validated run), never from the raw object. */
function runReport(run: Run) {
  const validation = (item: NonNullable<NonNullable<typeof run.review>['pending']>['validation']) => ({ diffHash: item.diffHash, commands: item.commands.map(command => ({ command: command.command, exitCode: command.exitCode })) });
  return {
    format: 'feature-pilot-run-v1',
    run: { id: run.id, revision: run.revision, state: run.state, stopRequested: run.stopRequested, baseCommit: run.baseCommit },
    requirement: run.requirement,
    clarification: run.clarification.map(item => ({ id: item.id, question: item.question, answer: item.answer })),
    plan: run.plan,
    planHash: run.planHash,
    approval: run.approval && { type: run.approval.type, planHash: run.approval.planHash },
    review: run.review === null ? null : {
      reviewer: { providerID: run.review.reviewer.providerID, id: run.review.reviewer.id, variant: run.review.reviewer.variant, vendor: run.review.reviewer.vendor, modelVersion: run.review.reviewer.modelVersion },
      contributingVendors: run.review.contributingVendors, repairRounds: run.review.repairRounds,
      pending: run.review.pending && { diffHash: run.review.pending.diffHash, validation: validation(run.review.pending.validation) },
      reviews: run.review.reviews.map(item => ({ diffHash: item.diffHash, validation: validation(item.validation), verdict: item.verdict, findings: item.findings.map(f => ({ id: f.id, severity: f.severity, description: f.description, evidence: f.evidence })) })),
    },
  };
}

/** Construct a local preview from run artifacts only; no filesystem or network write occurs. */
export function exportRunPreview(value: unknown): string {
  const run = validateRun(value);
  const report = {
    ...runReport(run),
    limitations: { diff: 'not included; complete worktree identity is unverified', costs: 'not included; complete run accounting is unavailable', recommendation: 'not recorded' },
  };
  const text = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new Error('Run export too large');
  return text;
}

type Money = { knownUsd: string; unknownCount: number };
type CostSection = { status: 'unavailable'; note: string }
  | { status: 'recorded'; period: { calendarMonth: string; timeZone: string }; attempts: number; gross: Money; credit: Money; cash: Money; estimated: number; providerReported: number };
const money = (value: Money): Money => ({ knownUsd: value.knownUsd, unknownCount: value.unknownCount });
/** Copies only known fields. Unknown amounts stay counted as unknown; they are never folded into the known total as zero. */
function costSection(costs: Costs): CostSection {
  if (costs === null) return { status: 'unavailable', note: 'complete run accounting is unavailable; amounts are unknown, not zero' };
  const total = costs.total;
  return { status: 'recorded', period: { calendarMonth: costs.calendarMonth, timeZone: costs.timeZone }, attempts: total.attempts, gross: money(total.gross), credit: money(total.credit), cash: money(total.cash), estimated: total.estimated, providerReported: total.providerReported };
}

const one = (text: string) => text.replace(/\s+/g, ' ').trim();
const code = (text: string) => `\`${one(text).replace(/`/g, "'")}\``;
const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${line}`).join('\n');
const usd = (value: Money) => value.unknownCount ? `at least $${value.knownUsd} known; ${value.unknownCount} attempt(s) unknown` : `$${value.knownUsd}`;

function summaryText(report: ReturnType<typeof runReport>, costs: CostSection): string {
  const out = [`# Feature Pilot run ${one(report.run.id)}`, '', `- State: ${report.run.state}`, `- Base commit: ${code(report.run.baseCommit)}`, `- Plan hash: ${report.planHash ? code(report.planHash) : 'none'}`, `- Approval: ${report.approval?.type ?? 'none'}`, '', '## Requirement', '', quote(report.requirement), ''];
  if (report.clarification.length) out.push('## Clarifying questions', '', ...report.clarification.flatMap(q => [`- ${one(q.question)}`, `  - Answer: ${q.answer === null ? 'unanswered' : one(q.answer)}`]), '');
  if (report.plan) {
    out.push('## Approved plan', '', ...report.plan.steps.map(s => `- ${code(s.id)}: ${one(s.description)}`), '', '### Acceptance criteria', '', ...report.plan.acceptance.map(a => `- ${code(a.id)}: ${one(a.description)}`),
      '', '### Validation commands', '', ...report.plan.validationCommands.map(c => `- ${code(c)}`), '', `Rollback: ${one(report.plan.rollback)}`, '');
  }
  if (report.review) {
    const { reviewer } = report.review;
    out.push('## Review', '', `- Reviewer: ${code(`${reviewer.providerID}/${reviewer.id}`)} (vendor ${one(reviewer.vendor)})`, `- Repair rounds: ${report.review.repairRounds}`, '');
    report.review.reviews.forEach((item, index) => out.push(`### Review ${index + 1}: ${item.verdict}`, '', `- Reviewed content: ${code(item.diffHash)}`,
      ...item.validation.commands.map(c => `- Validation ${code(c.command)} exited ${c.exitCode}`), ...item.findings.map(f => `- ${f.severity} finding ${code(f.id)}: ${one(f.description)} (evidence: ${one(f.evidence)})`), ''));
  }
  out.push('## Costs', '');
  if (costs.status === 'unavailable') out.push(`Cost accounting is unavailable: ${costs.note}.`);
  else if (costs.attempts === 0) out.push('No billed attempts were recorded for the supplied period.');
  else out.push(`Period ${costs.period.calendarMonth} (${costs.period.timeZone}); ${costs.attempts} attempt(s): ${costs.estimated} estimated, ${costs.providerReported} provider_reported.`, '', `- Gross: ${usd(costs.gross)}`, `- Credit: ${usd(costs.credit)}`, `- Cash: ${usd(costs.cash)}`);
  out.push('', '## Not included', '', '- The diff itself, raw prompts, API keys and benchmark data.', '- A model recommendation rationale (not recorded on the run).', '');
  return out.join('\n');
}

export type ExportResult = { paths: string[]; sha256: string };
/**
 * Writes `<directory>/feature-pilot-<runID>/run.json` and `summary.md`. Existing identical files are accepted (retries);
 * existing different content is never overwritten. `sha256` is the digest of `run.json`.
 */
export async function exportRun(value: Run, costs: Costs, destination: Extract<Destination, { kind: 'local' }>): Promise<ExportResult> {
  const run = validateRun(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(run.id) || run.id.includes('..')) throw new Error('Run ID is not safe to use as a directory name');
  if (typeof destination?.directory !== 'string' || !destination.directory.trim()) throw new Error('Export directory is required');
  const report = runReport(run), cost = costSection(costs);
  const json = JSON.stringify({ ...report, costs: cost, limitations: { diff: 'not included; the reviewed change is in the delivered branch or the local worktree', recommendation: 'not recorded' } }, null, 2) + '\n';
  if (Buffer.byteLength(json, 'utf8') > 2_000_000) throw new Error('Run export too large');
  const directory = join(resolve(destination.directory), `feature-pilot-${run.id}`);
  const files = [[join(directory, 'run.json'), json], [join(directory, 'summary.md'), summaryText(report, cost) + '\n']] as const;
  const conflict = (path: string) => new Error(`${basename(path)} already exists with different content; refusing to overwrite`);
  const matches = async (path: string, text: string) => {
    try { return (await readFile(path, 'utf8')) === text; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [path, text] of files) if (await matches(path, text) === false) throw conflict(path);
  for (const [path, text] of files) {
    try { await writeFile(path, text, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (!(await matches(path, text))) throw conflict(path); }
  }
  return { paths: files.map(([path]) => path), sha256: createHash('sha256').update(json).digest('hex') };
}

/** Markdown for the draft PR. Built only from the validated run, so prompts, keys and unknown fields cannot appear. Dollar amounts are deliberately not published. */
export function buildPullRequestBody(value: Run, costs: Costs, files: readonly string[] = []): string {
  const run = validateRun(value);
  const last = run.review?.reviews.at(-1);
  const advisories = last?.findings.filter(f => f.severity === 'advisory') ?? [];
  const total = costs?.total;
  const lines = [
    `Draft opened by Feature Pilot for run ${code(run.id)}. **A human must review this change before it is merged.** Nothing has been merged or deployed.`,
    '', '## Acceptance criteria', '', ...(run.plan?.acceptance ?? []).map(a => `- ${code(a.id)}: ${one(a.description)}`),
    '', '## Changed files', '', ...(files.length ? files.slice(0, 200).map(f => `- ${code(f)}`) : ['- File list not provided.']), ...(files.length > 200 ? [`- ...and ${files.length - 200} more`] : []),
    '', '## Test evidence', '', ...(last ? last.validation.commands.map(c => `- ${code(c.command)} exited ${c.exitCode}`) : ['- None recorded.']),
    '', '## Unresolved advisory findings', '', ...(advisories.length ? advisories.map(f => `- ${code(f.id)}: ${one(f.description)} (evidence: ${one(f.evidence).slice(0, 500)})`) : ['- None.']),
    '', '## Cost provenance', '',
    ...(!total ? ['- Cost accounting is unavailable; amounts are unknown.']
      : total.attempts === 0 ? ['- No billed attempts were recorded.']
      : [`- ${total.attempts} model attempt(s): ${total.estimated} estimated, ${total.providerReported} provider_reported.`, `- Unknown amounts (gross / credit / cash): ${total.gross.unknownCount} / ${total.credit.unknownCount} / ${total.cash.unknownCount}.`]),
    '',
  ];
  const body = lines.join('\n');
  return body.length > 60_000 ? `${body.slice(0, 60_000)}\n\n(truncated)\n` : body;
}

/** Persisted delivery identity. `committed` is saved before pushing; `delivered` after the pull request exists. */
export type DeliveryRecord = { branch: string; commit: string; prUrl: string | null; phase: 'committed' | 'delivered' };
export type DeliveryResult =
  | { status: 'exported'; paths: string[]; sha256: string }
  | { status: 'delivered'; branch: string; commit: string; prUrl: string; reusedPR: boolean }
  | { status: 'needs_attention'; reason: string; record: DeliveryRecord | null }
  | { status: 'refused'; reason: string };
export type DeliveryDeps = {
  /** Every git and gh invocation goes through this, as structured argv; nothing is ever run through a shell. */
  exec: Exec;
  /** Directory of the reviewed worktree. */
  worktree: string;
  publicationEnabled: boolean;
  identity?: (directory: string) => Promise<string>;
  snapshot?: (directory: string, baseCommit: string) => Promise<Pick<Snapshot, 'identity' | 'files'>>;
  record: (record: DeliveryRecord) => Promise<void>;
  previous: DeliveryRecord | null;
  costs?: Costs;
};

const safe = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/\/\/[^/@\s]*@/g, '//***@').replace(/\s+/g, ' ').slice(0, 300);
export const plainName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !/\.\.|\/\/|\/\.|[./]$|\.lock$/.test(name);
/** Inherited variables that would point git at another repository or index; credentials and user config variables are kept. */
const redirects = /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX)$/;
function envFor(tool: 'git' | 'gh'): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!redirects.test(key) && key !== 'GH_REPO') env[key] = value;
  return tool === 'git' ? { ...env, GIT_TERMINAL_PROMPT: '0' } : { ...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };
}
/** File names from `git diff --numstat -z`, parsed exactly as `snapshotDiff` parses them so the two lists are comparable. */
const listed = (output: string) => output.split('\0').filter(Boolean).flatMap(entry => { const match = /^(\S+)\t(\S+)\t(.*)$/s.exec(entry); return match ? [match[3]] : []; }).sort();
function parsePullRequests(text: string): { url: string; headRefOid: string }[] {
  const value: unknown = JSON.parse(text.trim() || '[]');
  if (!Array.isArray(value) || value.some(item => !item || typeof item.url !== 'string' || typeof item.headRefOid !== 'string')) throw new Error('Unexpected gh pr list output');
  return value;
}

/**
 * Local destinations are exported. A GitHub destination commits exactly the reviewed content on this run's own branch, pushes it
 * (never forced) and opens a DRAFT pull request; it never merges, enables auto-merge or deploys. Anything ambiguous after a side
 * effect becomes `needs_attention` with the known identity attached; side effects are never retried blindly.
 */
export async function deliverRun(value: Run, destination: Destination, deps: DeliveryDeps): Promise<DeliveryResult> {
  if (destination.kind === 'local') {
    try { return { status: 'exported', ...(await exportRun(value, deps.costs ?? null, destination)) }; }
    catch (error) { return { status: 'refused', reason: safe(error) }; }
  }
  const refused = (reason: string): DeliveryResult => ({ status: 'refused', reason });
  if (!deps.publicationEnabled) return refused('Publication is not enabled for this project');
  let run: Run;
  try { run = validateRun(value); } catch { return refused('Invalid run record'); }
  if (run.state !== 'ready_for_acceptance' && run.state !== 'accepted') return refused(`Run is ${run.state}; it must be reviewed and validated before delivery`);
  const reviewed = run.review?.reviews.at(-1);
  if (!reviewed) return refused('No completed review');
  const { remote, remoteURL, baseBranch } = destination, branch = `${destination.branchPrefix}${run.id.slice(0, 12)}`;
  if (![remote, baseBranch, branch].every(plainName)) return refused('Remote, base branch or run branch is not a plain name');

  const tool = (file: 'git' | 'gh', timeout: number) => async (...args: string[]) => (await deps.exec(file, args, { cwd: deps.worktree, timeout, env: envFor(file), maxBuffer: 64 * 1024 * 1024 })).stdout;
  const git = tool('git', 30_000), push = tool('git', 120_000), gh = tool('gh', 60_000);
  const line = async (...args: string[]) => (await git(...args)).trim();

  try { if (await line('remote', 'get-url', remote) !== remoteURL) return refused('The configured remote does not match the authorized destination'); }
  catch { return refused('The remote is not configured in this worktree'); }
  let files: string[];
  try {
    const identity = await (deps.identity ?? (directory => contentIdentity(directory, deps.exec)))(deps.worktree);
    if (identity !== reviewed.diffHash) return refused('The worktree changed after review; its content no longer matches the reviewed diff');
    const snap = await (deps.snapshot ?? ((directory, base) => snapshotDiff(directory, base, {}, deps.exec)))(deps.worktree, run.baseCommit);
    if (snap.identity !== reviewed.diffHash) return refused('The worktree changed while its diff was read');
    files = [...snap.files].sort();
  } catch (error) { return refused(`Cannot verify the worktree: ${safe(error)}`); }
  if (!files.length) return refused('There are no changes to deliver');

  const title = `Feature Pilot: ${one(run.requirement.replace(/[\u0000-\u001f\u007f]/g, ' ')).slice(0, 60)}`;
  let known = deps.previous, commit = '', step = 'reading the local branch';
  const attention = (reason: string): DeliveryResult => ({ status: 'needs_attention', reason, record: known });
  const finish = async (prUrl: string, reusedPR: boolean): Promise<DeliveryResult> => {
    known = { branch, commit, prUrl, phase: 'delivered' };
    try { await deps.record(known); } catch (error) { return attention(`Pull request ${prUrl} exists but the delivery record could not be saved: ${safe(error)}`); }
    return { status: 'delivered', branch, commit, prUrl, reusedPR };
  };
  try {
    const local = await line('for-each-ref', '--format=%(objectname)', `refs/heads/${branch}`);
    if (local) {
      if (deps.previous?.branch !== branch || deps.previous.commit !== local) return attention('The run branch already exists locally but does not match the recorded delivery');
      if (`tree:${await line('rev-parse', `${local}^{tree}`)}` !== reviewed.diffHash || await line('rev-parse', `${local}^`) !== run.baseCommit) return attention('The recorded commit does not match the reviewed content');
      commit = local;
    } else {
      if (deps.previous) return attention('The recorded delivery branch is missing locally');
      if (await line('rev-parse', 'HEAD') !== run.baseCommit) return refused('The worktree HEAD is not the run base commit');
    }

    try { await gh('auth', 'status'); } catch (error) { return attention(`GitHub CLI credentials are missing or invalid: ${safe(error)}`); }
    step = 'gh pr list';
    const existing = parsePullRequests(await gh('pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url,headRefOid'));
    if (existing.length) {
      const match = existing.find(item => item.headRefOid === local);
      if (!local || !match) return attention('A pull request for this run branch exists but does not match the local delivery commit');
      return await finish(match.url, true);
    }
    if (deps.previous?.prUrl) return attention('The recorded pull request was not found');

    if (!local) {
      step = 'git add';
      await git('add', '-A', '--', '.');
      if (JSON.stringify(listed(await git('diff', '--cached', '--no-ext-diff', '--no-color', '--numstat', '-z', run.baseCommit))) !== JSON.stringify(files)) return refused('The staged files differ from the reviewed files; nothing was committed');
      step = 'git commit';
      await git('checkout', '-b', branch);
      await git('commit', '-q', '-m', title, '-m', `Feature Pilot run ${run.id}\nPlan hash: ${run.planHash}`);
      commit = await line('rev-parse', 'HEAD');
      if (`tree:${await line('rev-parse', 'HEAD^{tree}')}` !== reviewed.diffHash) return attention('The commit content differs from the reviewed content (a hook or filter changed it); nothing was pushed');
      known = { branch, commit, prUrl: null, phase: 'committed' };
      step = 'saving the delivery record';
      await deps.record(known);
    }

    step = 'git push';
    await push('push', remote, `refs/heads/${branch}:refs/heads/${branch}`);
    step = 'gh pr create';
    const scratch = await mkdtemp(join(tmpdir(), 'feature-pilot-pr-'));
    let output: string;
    try {
      const bodyFile = join(scratch, 'body.md');
      await writeFile(bodyFile, buildPullRequestBody(run, deps.costs ?? null, files), { mode: 0o600 });
      output = await gh('pr', 'create', '--draft', '--base', baseBranch, '--head', branch, '--title', title, '--body-file', bodyFile);
    } finally { await rm(scratch, { recursive: true, force: true }); }
    const prUrl = output.trim().split(/\r?\n/).pop() ?? '';
    if (!/^https:\/\/\S+$/.test(prUrl)) return attention('The pull request may have been created but its URL could not be read; a retry will look it up');
    return await finish(prUrl, false);
  } catch (error) { return attention(`Could not complete ${step}: ${safe(error)}`); }
}
