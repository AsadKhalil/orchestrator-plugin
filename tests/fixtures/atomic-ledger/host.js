import { Plugin } from '@opencode/plugin';
import { AtomicReservationLedger } from '../node_modules/feature-pilot/dist/atomic-ledger.js';
export default Plugin.define({id:'sqlite-probe',async setup(){
 try { const db=new AtomicReservationLedger(process.env.FEATURE_PILOT_PROBE_DB); const request={attemptID:'synthetic',runID:'run',amount:'0.6'}; db.setLimit('monthly',undefined,'1',0); db.setLimit('feature','run','1',0); const first=db.reserve(request), replay=db.reserve(request); let exceeded=false; try {db.reserve({...request,attemptID:'other'});} catch(e) {exceeded=String(e).includes('Budget exceeded');} db.reconcile('synthetic','0.4',{kind:'provider_gross_charge',reference:'synthetic-line'}); console.log('ATOMIC_LEDGER_PROBE',JSON.stringify({first,replay,exceeded,actual:db.snapshot()[0].actual})); db.close(); } catch(e) { console.log('ATOMIC_LEDGER_ERROR',String(e)); }
}});
