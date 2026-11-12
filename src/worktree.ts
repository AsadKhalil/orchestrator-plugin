import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export type Exec = (file: string, args: readonly string[], options: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv; maxBuffer?: number }) => Promise<{ stdout: string; stderr: string }>;
export const defaultExec: Exec = (file, args, options) => run(file, [...args], { ...options, encoding: 'utf8' });
const timeout = 30_000;

/** Inherited GIT_* variables (hooks, alternate directories) must not redirect these reads. */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extra };
}

/**
 * The coder can write in the worktree, and on Windows git follows a directory junction. A link that leads outside the worktree would
 * therefore pull outside files into a diff that is sent to another vendor, so such a worktree is refused rather than reviewed.
 */
async function assertNoEscapingLinks(directory: string, files: readonly string[]) {
  const root = await realpath(directory);
  for (const name of files) {
    let real: string;
    try { real = await realpath(join(directory, name)); } catch { continue; } // deleted: the diff carries no content for it
    if (real !== root && !real.startsWith(root + sep)) throw new Error(`Worktree contains a link that leads outside it: ${name}`);
  }
}

/** Stage everything into a throwaway index, so the user's real index and working tree are never modified, then hand it to `use`. */
async function withTemporaryIndex<T>(directory: string, exec: Exec, use: (git: (...args: string[]) => Promise<string>) => Promise<T>): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), 'feature-pilot-index-'));
  const env = cleanEnv({ GIT_INDEX_FILE: join(scratch, 'index') });
  const git = async (...args: string[]) => (await exec('git', args, { cwd: directory, timeout, env, maxBuffer: 64 * 1024 * 1024 })).stdout;
  try {
    try { await git('rev-parse', '--is-inside-work-tree'); } catch { throw new Error('Not a git worktree; content identity is unavailable'); }
    await git('read-tree', 'HEAD');
    await git('add', '-A', '--', '.');
    return await use(git);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/**
 * Complete content identity of a worktree: the git tree of every tracked and untracked, non-ignored file, including binary and
 * very large files and deletions. Ignored files are excluded by design (they are not part of any diff or commit); a test
 * that depends on ignored files should declare them as plan resources.
 */
export async function contentIdentity(directory: string, exec: Exec = defaultExec): Promise<string> {
  return withTemporaryIndex(directory, exec, async git => `tree:${(await git('write-tree')).trim()}`);
}

export type Snapshot = { identity: string; patch: string; files: string[]; binaryFiles: string[]; truncated: boolean; warnings: string[] };

/** The change since `baseCommit`, including untracked files, with the same identity `contentIdentity` reports. */
export async function snapshotDiff(directory: string, baseCommit: string, options: { maxPatchBytes?: number } = {}, exec: Exec = defaultExec): Promise<Snapshot> {
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(baseCommit)) throw new Error('A full baseline commit hash is required');
  const limit = options.maxPatchBytes ?? 900_000;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid patch limit');
  return withTemporaryIndex(directory, exec, async git => {
    try { await git('cat-file', '-e', `${baseCommit}^{commit}`); } catch { throw new Error('Baseline commit is not present in this worktree'); }
    const identity = `tree:${(await git('write-tree')).trim()}`;
    const names = await git('diff', '--cached', '--no-ext-diff', '--no-color', '--no-renames', '--numstat', '-z', baseCommit);
    const files: string[] = [], binaryFiles: string[] = [];
    for (const entry of names.split('\0').filter(Boolean)) {
      const match = /^(\S+)\t(\S+)\t(.*)$/s.exec(entry); if (!match) continue; // a rename's extra path fields are not separate entries
      files.push(match[3]); if (match[1] === '-' && match[2] === '-') binaryFiles.push(match[3]);
    }
    await assertNoEscapingLinks(directory, files);
    const full = await git('diff', '--cached', '--no-ext-diff', '--no-color', '--no-renames', baseCommit);
    const bytes = Buffer.from(full, 'utf8'), truncated = bytes.length > limit;
    const warnings: string[] = [];
    if (truncated) warnings.push('patch_truncated');
    if (binaryFiles.length) warnings.push('binary_content_omitted');
    return { identity, patch: truncated ? bytes.subarray(0, limit).toString('utf8').replace(/�$/, '') : full, files, binaryFiles, truncated, warnings };
  });
}

/**
 * Check, rather than trust, that a host-created worktree is a clean checkout of exactly the baseline commit. Returns the identity
 * (git tree) of that baseline so later changes can be compared against it.
 */
export async function verifyBaselineWorktree(directory: string, baseCommit: string, exec: Exec = defaultExec): Promise<string> {
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(baseCommit)) throw new Error('A full baseline commit hash is required');
  const git = async (...args: string[]) => (await exec('git', args, { cwd: directory, timeout, env: cleanEnv(), maxBuffer: 1024 * 1024 })).stdout.trim();
  let head: string;
  try { head = await git('rev-parse', 'HEAD'); } catch { throw new Error('Not a git worktree; the baseline cannot be verified'); }
  if (head !== baseCommit) throw new Error('Worktree is not at the baseline commit');
  const expected = `tree:${await git('rev-parse', `${baseCommit}^{tree}`)}`;
  if (await contentIdentity(directory, exec) !== expected) throw new Error('Worktree differs from the baseline commit');
  return expected;
}

/**
 * Create the run's isolated worktree with plain git: a detached checkout of exactly the baseline commit in a sibling directory,
 * so nothing in the user's own checkout changes. Safe to repeat: an existing directory is adopted only if it is a clean baseline.
 * The plugin never removes it; the work it holds is the run's artifact.
 */
export async function createGitWorktree(projectDir: string, runID: string, baseCommit: string, exec: Exec = defaultExec): Promise<{ directory: string }> {
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(baseCommit)) throw new Error('A full baseline commit hash is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runID)) throw new Error('Invalid run ID for a worktree path');
  const directory = join(dirname(projectDir), `${basename(projectDir)}.feature-pilot`, runID);
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  try { await exec('git', ['worktree', 'add', '--detach', directory, baseCommit], { cwd: projectDir, timeout, env: cleanEnv(), maxBuffer: 1024 * 1024 }); }
  catch (error) {
    if (!await stat(directory).then(item => item.isDirectory(), () => false)) throw error;
    await verifyBaselineWorktree(directory, baseCommit, exec); // adopt a leftover from an interrupted attempt only if it is untouched
  }
  return { directory };
}
