import { AtomicReservationLedger } from '../../../src/atomic-ledger.js';
const ledger = new AtomicReservationLedger(process.argv[2]);
try { ledger.reserve({ attemptID: process.argv[3], runID: process.argv[3], amount: '0.6' }); console.log('reserved'); }
catch (error) { if (!(error instanceof Error) || error.message !== 'Budget exceeded') throw error; console.log('exceeded'); }
finally { ledger.close(); }
