import { Plugin } from '@opencode/plugin';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { SqliteRunStore } from '../node_modules/feature-pilot/dist/sqlite-run-store.js';
export default Plugin.define({id:'sqlite-run-store-probe',async setup(){try {
 const one=new SqliteRunStore(process.env.FEATURE_PILOT_PROBE_DB, '/project'),two=new SqliteRunStore(process.env.FEATURE_PILOT_PROBE_DB, '/project'), first=new RunRepository(one),second=new RunRepository(two);
 const run=await first.create('synthetic','Original','base');await first.changeRequirement(run.id,run.revision,'Updated');let stale=false;
 try{await second.changeRequirement(run.id,run.revision,'Stale');}catch(e){stale=String(e).includes('Stale');}
 console.log('SQLITE_RUN_PROBE',JSON.stringify({stale,revision:(await second.get('synthetic')).revision}));one.close();two.close();
 }catch(e){console.log('SQLITE_RUN_ERROR',String(e));}}});
