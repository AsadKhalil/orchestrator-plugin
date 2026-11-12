import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHostDiff } from '../src/diff.js';

const file = { file: 'new.txt', patch: 'diff --git a/new.txt b/new.txt\n@@ -0,0 +1 @@\n+new\n', additions: 1, deletions: 0, status: 'added' as const };
function host(diff = [file]) { const status = diff.map(({file, status, additions, deletions}) => ({file, status, additions, deletions})); return { location: { directory: '/repo' }, vcs: { async status() { return { location: { directory: '/repo' }, data: status }; }, async diff() { return { location: { directory: '/repo' }, data: diff }; } } }; }

test('returns host diff with untracked files requested but never treats it as a verified worktree hash', async () => {
  const ctx = host(); let args: unknown;
  const original = ctx.vcs.diff; ctx.vcs.diff = async (input?: unknown) => { args = input; return original(); };
  const result = await readHostDiff(ctx as never);
  assert.deepEqual(args, { location: { directory: '/repo' }, mode: 'working', untracked: 'files' });
  assert.equal(result.files[0].file, 'new.txt');
  assert.equal(result.verifiedWorktreeIdentity, false);
});

test('marks binary and content-less patches as incomplete, including unflagged large files', async () => {
  const binary = { ...file, file: 'new.bin', patch: 'diff --git a/new.bin b/new.bin\nBinary files /dev/null and b/new.bin differ\n', additions: 0 };
  const hidden = { ...file, file: 'large.txt', patch: 'Index: large.txt\n--- large.txt\n+++ large.txt\n', additions: 1000000 };
  const result = await readHostDiff(host([binary, hidden]) as never);
  assert.ok(result.warnings.includes('binary_content_omitted'));
  assert.ok(result.warnings.includes('patch_content_missing'));
});

test('detects inconsistent status and rejects another project or oversized data', async () => {
  const ctx = host(); let calls = 0;
  ctx.vcs.status = async () => ({ location: { directory: '/repo' }, data: ++calls === 1 ? [] : [{ file: 'new.txt', status: 'added' as const, additions: 1, deletions: 0 }] });
  assert.ok((await readHostDiff(ctx as never)).warnings.includes('status_changed'));
  const wrong = host(); wrong.location.directory = '/other';
  await assert.rejects(readHostDiff(wrong as never), /location/i);
  await assert.rejects(readHostDiff(host([{ ...file, patch: 'x'.repeat(2_000_001) }]) as never), /large/i);
});
