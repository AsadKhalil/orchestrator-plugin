import { DatabaseSync } from 'node:sqlite';
import { AtomicReservationLedger } from '../../../src/atomic-ledger.js';
const path = process.argv[2];
if (process.argv[3] === 'before-commit') {
  const db = new DatabaseSync(path);
  db.exec("BEGIN IMMEDIATE; INSERT INTO reservations VALUES ('aborted', 'run', '2026-01', '0.8', NULL)");
} else {
  const ledger = new AtomicReservationLedger(path, () => Date.parse('2026-01-01T12:00:00Z'));
  ledger.reserve({ attemptID: 'committed', runID: 'run', amount: '0.8' });
}
process.stdout.write('READY\n');
setInterval(() => {}, 1000);
