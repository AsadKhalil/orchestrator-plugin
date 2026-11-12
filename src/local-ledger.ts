import { lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { prepareLedgerPath } from './ledger-path.js';

/** The minimal atomic store the budget ledger needs; the same shape as the host's compare-and-set storage. */
export type LocalStore = { get(key: string): Promise<unknown>; compareAndSet(key: string, previous: unknown, next: unknown): Promise<boolean>; close(): void };
type SqliteModule = { DatabaseSync: typeof DatabaseSync };

/** OpenCode's own data-directory convention, so the file sits beside the host's database and follows an XDG override. */
export function defaultLedgerRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const base = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share');
  return join(base, 'opencode');
}

/**
 * Create `<root>/feature-pilot/ledger.sqlite`'s directory and refuse anything that is not a plain directory and file.
 * POSIX checks owner and permissions (see ledger-path.ts). Windows has no such check here: it relies on the user profile's default
 * access rules, so any program running as this user can read and edit the file.
 */
export async function prepareLocalLedgerPath(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  if (process.platform !== 'win32') return prepareLedgerPath(root);
  const dir = join(root, 'feature-pilot');
  await mkdir(dir, { recursive: true });
  const directory = await lstat(dir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe ledger directory');
  const path = join(dir, 'ledger.sqlite');
  const file = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (file && (!file.isFile() || file.isSymbolicLink())) throw new Error('Unsafe ledger file');
  return path;
}

/**
 * An atomic key-value store in one SQLite file, for hosts whose own storage cannot compare-and-set. `BEGIN IMMEDIATE` takes the write
 * lock before the comparison, so concurrent OpenCode processes sharing the file cannot both win. Opened on first use, so a plugin that
 * never needs a budget never touches the disk; a failed open is retried next time rather than remembered.
 */
export function createLocalStore(root: string, load: () => Promise<SqliteModule> = () => import('node:sqlite') as Promise<SqliteModule>): LocalStore {
  let opened: Promise<DatabaseSync> | undefined;
  const open = () => opened ??= (async () => {
    const [{ DatabaseSync: Database }, path] = await Promise.all([load(), prepareLocalLedgerPath(root)]);
    const db = new Database(path);
    try { db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)'); } catch (error) { db.close(); throw error; }
    return db;
  })().catch(error => { opened = undefined; throw error; });
  const read = (db: DatabaseSync, key: string): unknown => {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row === undefined ? undefined : JSON.parse(String(row.value));
  };
  return {
    async get(key) { return read(await open(), key); },
    async compareAndSet(key, previous, next) {
      const db = await open();
      db.exec('BEGIN IMMEDIATE');
      try {
        if (JSON.stringify(read(db, key)) !== JSON.stringify(previous)) { db.exec('ROLLBACK'); return false; }
        db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(next));
        db.exec('COMMIT'); return true;
      } catch (error) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
    },
    close() { void opened?.then(db => db.close(), () => undefined); opened = undefined; },
  };
}
