import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/** Prepare a private POSIX ledger location beneath an existing user-owned state directory. */
export async function prepareLedgerPath(stateHome: string): Promise<string> {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') throw new Error('Private ledger path is unsupported on this platform');
  if (typeof stateHome !== 'string' || !isAbsolute(stateHome)) throw new Error('State directory must be absolute');
  const uid = process.getuid();
  const root = await lstat(stateHome);
  if (!root.isDirectory() || root.uid !== uid || (root.mode & 0o022) !== 0) throw new Error('Unsafe state directory');
  const dir = join(stateHome, 'feature-pilot');
  try { await mkdir(dir, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700) throw new Error('Unsafe ledger directory');
  const path = join(dir, 'ledger.sqlite');
  let file;
  try { file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
  }
  try {
    const [fd, entry] = await Promise.all([file.stat(), lstat(path)]);
    if (!fd.isFile() || !entry.isFile() || fd.dev !== entry.dev || fd.ino !== entry.ino || fd.uid !== uid || fd.nlink !== 1 || (fd.mode & 0o777) !== 0o600) throw new Error('Unsafe ledger file');
  } finally { await file.close(); }
  // shortcut: SQLite reopens this pathname; bind the validated inode before trusting untrusted local users.
  return path;
}
