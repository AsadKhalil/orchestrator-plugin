import { Plugin } from '@opencode/plugin';
import { createRunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
export default Plugin.define({id:'stop-storage-probe',async setup(ctx){try{
 const repo=createRunRepository(ctx);let run;
 try{run=await repo.get('stop-probe');}catch(e){if(!String(e).includes('Run not found'))throw e;run=await repo.create('stop-probe','Synthetic feature','base');run=await repo.requestStop(run.id,run.revision);console.log('STOP_PROBE_CREATED',JSON.stringify({requested:run.stopRequested}));return;}
 let blocked=false;try{await repo.changeRequirement(run.id,run.revision,'changed');}catch(e){blocked=String(e).includes('Stop requested');}
 console.log('STOP_PROBE_RESTORED',JSON.stringify({requested:run.stopRequested,blocked}));
 }catch(e){console.log('STOP_PROBE_ERROR',String(e));}}});
