import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentIdentity, snapshotDiff } from '../src/worktree.js';

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'fp-wt-'));
  git(dir, 'init', '-q'); git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(dir, 'a.txt'), 'one\n'); writeFileSync(join(dir, 'big.txt'), 'x'.repeat(5000) + '\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return { dir, base: git(dir, 'rev-parse', 'HEAD'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('identity changes for tracked edits, new files, binary files, deletions and same-length large-file edits', async () => {
  const r = repo();
  try {
    const clean = await contentIdentity(r.dir);
    assert.equal(clean, await contentIdentity(r.dir), 'stable for identical content');
    writeFileSync(join(r.dir, 'a.txt'), 'two\n'); const edited = await contentIdentity(r.dir); assert.notEqual(edited, clean);
    writeFileSync(join(r.dir, 'new.txt'), 'untracked\n'); const added = await contentIdentity(r.dir); assert.notEqual(added, edited);
    writeFileSync(join(r.dir, 'blob.bin'), Buffer.from([0, 1, 2, 3])); const binary = await contentIdentity(r.dir); assert.notEqual(binary, added);
    writeFileSync(join(r.dir, 'blob.bin'), Buffer.from([0, 1, 2, 4])); assert.notEqual(await contentIdentity(r.dir), binary, 'same-size binary edit is detected');
    writeFileSync(join(r.dir, 'big.txt'), 'y'.repeat(5000) + '\n'); const big = await contentIdentity(r.dir);
    writeFileSync(join(r.dir, 'big.txt'), 'z'.repeat(5000) + '\n'); assert.notEqual(await contentIdentity(r.dir), big, 'same-length large edit is detected');
    rmSync(join(r.dir, 'a.txt')); assert.notEqual(await contentIdentity(r.dir), big, 'deletion is detected');
  } finally { r.done(); }
});

test('ignored files do not affect identity and the real index is left untouched', async () => {
  const r = repo();
  try {
    const before = await contentIdentity(r.dir), status = git(r.dir, 'status', '--porcelain');
    writeFileSync(join(r.dir, 'ignored.txt'), 'noise');
    assert.equal(await contentIdentity(r.dir), before);
    writeFileSync(join(r.dir, 'a.txt'), 'changed\n'); await contentIdentity(r.dir);
    assert.equal(git(r.dir, 'diff', '--cached', '--name-only'), '', 'nothing was staged in the real index'); assert.equal(git(r.dir, 'diff', '--name-only'), 'a.txt'); assert.equal(status, '');
  } finally { r.done(); }
});

test('the identity of committed work equals the tree of the resulting commit', async () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, 'a.txt'), 'delivered\n'); mkdirSync(join(r.dir, 'sub')); writeFileSync(join(r.dir, 'sub', 'b.txt'), 'nested\n');
    const identity = await contentIdentity(r.dir);
    git(r.dir, 'add', '-A'); git(r.dir, 'commit', '-qm', 'work');
    assert.equal(identity, `tree:${git(r.dir, 'rev-parse', 'HEAD^{tree}')}`);
  } finally { r.done(); }
});

test('snapshot diff includes untracked files, flags binary content and bounds the output', async () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, 'a.txt'), 'two\n'); writeFileSync(join(r.dir, 'new.txt'), 'brand new\n'); writeFileSync(join(r.dir, 'blob.bin'), Buffer.from([0, 255, 0, 255]));
    const snap = await snapshotDiff(r.dir, r.base);
    assert.equal(snap.identity, await contentIdentity(r.dir));
    assert.match(snap.patch, /\+two/); assert.match(snap.patch, /\+brand new/);
    assert.deepEqual(snap.files.sort(), ['a.txt', 'blob.bin', 'new.txt']);
    assert.deepEqual(snap.binaryFiles, ['blob.bin']); assert.ok(snap.warnings.includes('binary_content_omitted'));
    const small = await snapshotDiff(r.dir, r.base, { maxPatchBytes: 40 });
    assert.equal(small.truncated, true); assert.ok(small.warnings.includes('patch_truncated')); assert.ok(Buffer.byteLength(small.patch) <= 40);
    await assert.rejects(snapshotDiff(r.dir, 'not-a-commit'), /baseline|commit/i);
    assert.equal(readFileSync(join(r.dir, 'a.txt'), 'utf8'), 'two\n');
  } finally { r.done(); }
});

test('a directory that is not a git worktree is rejected rather than given an identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-nogit-'));
  try { await assert.rejects(contentIdentity(dir), /git|worktree|repository/i); } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { verifyBaselineWorktree } from '../src/worktree.js';

test('a worktree is accepted only when it is a clean checkout of exactly the baseline commit', async () => {
  const r = repo(), dir = mkdtempSync(join(tmpdir(), 'fp-wt-linked-')), linked = join(dir, 'wt');
  try {
    git(r.dir, 'worktree', 'add', '--detach', linked, r.base);
    assert.equal(await verifyBaselineWorktree(linked, r.base), `tree:${git(r.dir, 'rev-parse', `${r.base}^{tree}`)}`);
    writeFileSync(join(linked, 'untracked.txt'), 'x'); await assert.rejects(verifyBaselineWorktree(linked, r.base), /differs/i);
    rmSync(join(linked, 'untracked.txt')); writeFileSync(join(linked, 'a.txt'), 'edited\n'); await assert.rejects(verifyBaselineWorktree(linked, r.base), /differs/i);
    git(linked, 'checkout', '-q', '--', 'a.txt');
    writeFileSync(join(r.dir, 'later.txt'), 'later\n'); git(r.dir, 'add', '-A'); git(r.dir, 'commit', '-qm', 'later');
    await assert.rejects(verifyBaselineWorktree(r.dir, r.base), /not at the baseline/i, 'a moved HEAD is not the baseline');
    await assert.rejects(verifyBaselineWorktree(linked, 'abc'), /full baseline/i);
    await assert.rejects(verifyBaselineWorktree(dir, r.base), /not a git worktree/i);
  } finally { git(r.dir, 'worktree', 'prune'); rmSync(dir, { recursive: true, force: true }); r.done(); }
});

import { createGitWorktree } from '../src/worktree.js';

test('creates the run worktree beside the project, repeats safely, and refuses a leftover that was modified', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'fp-parent-')), project = join(parent, 'proj');
  mkdirSync(project); git(project, 'init', '-q'); git(project, 'config', 'core.autocrlf', 'false'); writeFileSync(join(project, 'a.txt'), 'one\n'); git(project, 'add', '-A'); git(project, 'commit', '-qm', 'base');
  const base = git(project, 'rev-parse', 'HEAD'), runID = '00000000-0000-4000-8000-0000000000aa';
  try {
    const { directory } = await createGitWorktree(project, runID, base);
    assert.equal(directory, join(parent, 'proj.feature-pilot', runID));
    assert.equal(git(directory, 'rev-parse', 'HEAD'), base); assert.equal(git(project, 'status', '--porcelain'), '', 'the user checkout is untouched');
    assert.equal((await createGitWorktree(project, runID, base)).directory, directory, 'a repeat adopts the untouched leftover');
    writeFileSync(join(directory, 'a.txt'), 'edited\n');
    await assert.rejects(createGitWorktree(project, runID, base), /differs/i);
    await assert.rejects(createGitWorktree(project, '../escape', base), /invalid run id/i);
    await assert.rejects(createGitWorktree(project, runID, 'main'), /full baseline/i);
  } finally { try { git(project, 'worktree', 'prune'); } catch {} rmSync(parent, { recursive: true, force: true }); }
});

import { symlinkSync } from 'node:fs';

test('a snapshot refuses a worktree with a link that leads outside it, so outside files never reach a reviewer', async t => {
  const root = mkdtempSync(join(tmpdir(), 'fp-link-')), repo = join(root, 'repo'), outside = join(root, 'outside');
  mkdirSync(repo); mkdirSync(outside); git(repo, 'init', '-q'); git(repo, 'config', 'core.autocrlf', 'false'); writeFileSync(join(repo, 'a.txt'), 'one\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE-SECRET\n');
  try {
    const base = git(repo, 'rev-parse', 'HEAD');
    writeFileSync(join(repo, 'b.txt'), 'inside\n'); assert.ok((await snapshotDiff(repo, base)).files.includes('b.txt'), 'ordinary changes are unaffected');
    try { symlinkSync(outside, join(repo, 'jn'), 'junction'); } catch { return t.skip('this account cannot create links'); }
    await assert.rejects(snapshotDiff(repo, base), /leads outside/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a rename is reported as its old and new path so every changed file is checked and shown', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'fp-rename-'));
  try {
    git(repo, 'init', '-q'); git(repo, 'config', 'core.autocrlf', 'false'); writeFileSync(join(repo, 'old.txt'), 'line1\nline2\nline3\nline4\nline5\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
    const base = git(repo, 'rev-parse', 'HEAD'); git(repo, 'mv', 'old.txt', 'new.txt');
    const snap = await snapshotDiff(repo, base);
    assert.deepEqual([...snap.files].sort(), ['new.txt', 'old.txt'], 'no empty path from a rename entry');
    assert.match(snap.patch, /new\.txt/); assert.match(snap.patch, /line1/, 'the renamed file content is in the patch');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
