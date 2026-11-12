import { isDeepStrictEqual } from 'node:util';
import type { Plugin } from '@opencode/plugin';
import { validateRun } from './run.js';
import { SqliteRunStore } from './sqlite-run-store.js';

type Context = Pick<Plugin.Context, 'storage' | 'location'>;

// shortcut: source storage has no transaction; require exclusive offline access until host-wide locking exists.
export async function migrateRuns(context: Context, destination: SqliteRunStore) {
  if (destination.projectID !== context.location.directory) throw new Error('Project identity mismatch');
  const root = `project-runs/${encodeURIComponent(context.location.directory)}/runs/`;
  async function snapshot() {
    let after: string | undefined;
    const cursors = new Set<string>(), keys = new Set<string>();
    do {
      const page = await context.storage.scan({ prefix: root, after });
      if (!Array.isArray(page.entries)) throw new Error('Invalid run scan');
      for (const entry of page.entries) {
        if (typeof entry.key !== 'string' || !entry.key.startsWith(root) || keys.has(entry.key) || keys.size >= 100) throw new Error('Invalid or excessive run records');
        const id = decodeURIComponent(entry.key.slice(root.length));
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid run identity');
        keys.add(entry.key);
      }
      if (page.next !== undefined && (typeof page.next !== 'string' || !page.next || cursors.has(page.next))) throw new Error('Invalid run cursor');
      if (page.next) cursors.add(page.next);
      after = page.next;
    } while (after);
    return Promise.all([...keys].sort().map(async key => {
      const run = validateRun(await context.storage.get(key));
      if (key !== root + encodeURIComponent(run.id)) throw new Error('Run identity mismatch');
      return run;
    }));
  }
  const first = await snapshot(), second = await snapshot();
  if (!isDeepStrictEqual(first, second)) throw new Error('Source runs changed during migration');
  return destination.importRuns(first);
}
