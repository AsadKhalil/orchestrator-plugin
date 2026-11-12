import type { Plugin } from '@opencode/plugin';

/** Read a review diff, not a validated identity of everything that can affect a test. */
export async function readHostDiff(context: Pick<Plugin.Context, 'location' | 'vcs'>) {
  const directory = context.location.directory;
  const location = { directory };
  const before = await context.vcs.status({ location });
  const diff = await context.vcs.diff({ location, mode: 'working', untracked: 'files' });
  const after = await context.vcs.status({ location });
  if ([before.location.directory, diff.location.directory, after.location.directory].some(path => path !== directory)) throw new Error('Diff location mismatch');
  const warnings = new Set<string>(['worktree_identity_unverified']);
  const normalized = (items: typeof before.data) => JSON.stringify([...items].map(item => [item.file, item.status, item.additions, item.deletions]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  if (normalized(before.data) !== normalized(after.data)) warnings.add('status_changed');
  const statuses = new Map(after.data.map(item => [item.file, item.status]));
  if (statuses.size !== after.data.length || diff.data.length !== statuses.size || diff.data.some(item => statuses.get(item.file) !== item.status)) warnings.add('status_diff_mismatch');
  let bytes = 0;
  for (const file of diff.data) {
    if (typeof file.file !== 'string' || !file.file || typeof file.patch !== 'string') throw new Error('Invalid host diff');
    bytes += Buffer.byteLength(file.patch, 'utf8');
    if (bytes > 2_000_000) throw new Error('Host diff too large');
    if (file.more) warnings.add('patch_truncated');
    if (/^(?:Binary files .* differ|GIT binary patch)/m.test(file.patch)) warnings.add('binary_content_omitted');
    if (!/^@@ /m.test(file.patch)) warnings.add('patch_content_missing');
  }
  return { directory, files: diff.data, warnings: [...warnings], verifiedWorktreeIdentity: false as const };
}
