import { RunRepository } from '../../../src/run-store.js';
import { SqliteRunStore } from '../../../src/sqlite-run-store.js';
const store = new SqliteRunStore(process.argv[2], '/project'), repo = new RunRepository(store);
try { await repo.changeRequirement('run', 0, `Requirement ${process.argv[3]}`); console.log('updated'); }
catch (error) { if (!(error instanceof Error) || !/stale/i.test(error.message)) throw error; console.log('stale'); }
finally { store.close(); }
