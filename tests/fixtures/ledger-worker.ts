// A separate process that hammers the shared local ledger file with small reservations and prints how many were created.
// Used by local-ledger.test.ts. Contention retries are the caller's job (the ledger gives up after 32 tries), so they are retried here.
import { CasReservationLedger } from '../../src/cas-ledger.js';
import { createLocalStore } from '../../src/local-ledger.js';

const [root, runID, prefix, amount, attempts] = process.argv.slice(2);
const store = createLocalStore(root), ledger = new CasReservationLedger(store as never);
let created = 0;
try {
  for (let index = 0; index < Number(attempts); index++) {
    for (;;) {
      try { if (await ledger.reserve({ attemptID: `${prefix}-${index}`, runID, amount }) === 'created') created++; break; }
      catch (error) { const message = error instanceof Error ? error.message : ''; if (message === 'Budget exceeded') break; if (message !== 'Budget contention; retry') throw error; }
    }
  }
  console.log(created);
} finally { store.close(); }
