import { Plugin } from '@opencode/plugin';
import { createRunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
export default Plugin.define({id:'feature-pilot-smoke-fixture',async setup(ctx){
 try {
  const repo=createRunRepository(ctx); let run;
  try { run=await repo.get('approval-smoke-v2'); console.log('APPROVAL_PROBE','restored',run.state); }
  catch(e) {
   if(!String(e).includes('Run not found')) throw e;
   run=await repo.create('approval-smoke-v2','Synthetic requirement','test-base');
   run=await repo.setPlan(run.id,run.revision,{steps:[{id:'synthetic-step',description:'Synthetic step',role:'coder',taskKind:'implement',dependsOn:[],resources:null,inference:true,completion:'Synthetic evidence',execution:null}],acceptance:[{id:'synthetic-criterion',description:'Synthetic criterion'}],areas:['src'],rollback:'Revert synthetic changes',questions:[],validationCommands:['synthetic-check']});
   run=await repo.approve(run.id,run.revision,run.planHash);
   console.log('APPROVAL_PROBE','created',run.state);
  }
 } catch(e) {console.log('APPROVAL_PROBE_ERROR',String(e));}
}});
