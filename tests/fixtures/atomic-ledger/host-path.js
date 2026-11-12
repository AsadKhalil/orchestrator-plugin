import { Plugin } from '@opencode/plugin';
import { prepareLedgerPath } from '../node_modules/feature-pilot/dist/ledger-path.js';
import { AtomicReservationLedger } from '../node_modules/feature-pilot/dist/atomic-ledger.js';
export default Plugin.define({id:'sqlite-probe',async setup(){try { const path=await prepareLedgerPath(process.env.FEATURE_PILOT_PROBE_HOME); const db=new AtomicReservationLedger(path); const v=db.setLimit('monthly',undefined,'1',0); db.close(); console.log('LEDGER_PATH_PROBE',JSON.stringify({prepared:true,revision:v.revision})); } catch(e) {console.log('LEDGER_PATH_ERROR',String(e));}}});
