import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { validateRun, type newRun } from './run.js';
type Run = ReturnType<typeof newRun>;

/** Run transitions use one SQLite transaction; the caller must select a private shared local database. */
export class SqliteRunStore {
  private db: DatabaseSync;
  constructor(path: string, private readonly project: string) {
    if (typeof path !== 'string' || !path.trim()) throw new Error('Database path required');
    if (typeof project !== 'string' || !project.trim()) throw new Error('Project identity required');
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=5000');
      const legacy = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_records'").get();
      if (legacy && this.db.prepare('SELECT 1 FROM run_records LIMIT 1').get()) throw new Error('Legacy run data requires migration');
      this.db.exec('CREATE TABLE IF NOT EXISTS project_run_records (project TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(project, key))');
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  get projectID() { return this.project; }
  async importRuns(input: Run[]): Promise<{ inserted: number; unchanged: number }> {
    if (!Array.isArray(input) || input.length > 100) throw new Error('Invalid run import');
    const ids = new Set<string>();
    const records = input.map(raw => {
      const run = validateRun(raw), key = `runs/${encodeURIComponent(run.id)}`, value = JSON.stringify(run);
      if (ids.has(key)) throw new Error('Duplicate run identity');
      if (Buffer.byteLength(value, 'utf8') > 2_000_000) throw new Error('Run record too large');
      ids.add(key); return { run, key, value };
    });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let inserted = 0, unchanged = 0;
      const insert = this.db.prepare('INSERT INTO project_run_records (project, key, value) VALUES (?, ?, ?)');
      for (const { run, key, value } of records) {
        const existing = this.read(key);
        if (existing !== undefined) {
          if (!isDeepStrictEqual(validateRun(existing), run)) throw new Error('Conflicting run in destination');
          unchanged++;
        } else { insert.run(this.project, key, value); inserted++; }
      }
      const total = this.db.prepare('SELECT COUNT(*) AS count FROM project_run_records WHERE project = ?').get(this.project);
      if (typeof total?.count !== 'number' || total.count > 100) throw new Error('Too many stored runs');
      this.db.exec('COMMIT'); return { inserted, unchanged };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private read(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM project_run_records WHERE project = ? AND key = ?').get(this.project, key);
    if (!row) return undefined;
    if (typeof row.value !== 'string') throw new Error('Invalid stored run');
    try { return JSON.parse(row.value); } catch { throw new Error('Invalid stored run'); }
  }
  async get(key: string): Promise<unknown> { return this.read(key); }
  async list(): Promise<Run[]> {
    const rows = this.db.prepare('SELECT key, value FROM project_run_records WHERE project = ? ORDER BY key LIMIT 101').all(this.project);
    if (rows.length > 100) throw new Error('Too many stored runs');
    return rows.map(row => {
      if (typeof row.key !== 'string' || typeof row.value !== 'string') throw new Error('Invalid stored run');
      let raw: unknown; try { raw = JSON.parse(row.value); } catch { throw new Error('Invalid stored run'); }
      const run = validateRun(raw);
      if (row.key !== `runs/${encodeURIComponent(run.id)}`) throw new Error('Run identity mismatch');
      return run;
    });
  }
  async set(_key: string, _value: Run): Promise<void> { throw new Error('Run writes require a transaction'); }
  async mutate(key: string, change: (value: unknown) => Run): Promise<Run> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = validateRun(change(this.read(key)));
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new Error('Run record too large');
      this.db.prepare('INSERT INTO project_run_records (project, key, value) VALUES (?, ?, ?) ON CONFLICT(project, key) DO UPDATE SET value=excluded.value').run(this.project, key, text);
      this.db.exec('COMMIT'); return value;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
