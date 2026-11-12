import { Plugin } from '@opencode/plugin';
import { createRunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
export default Plugin.define({id:'clarification-storage-probe',async setup(ctx){
 try {
  const repo=createRunRepository(ctx);let run;
  try { run=await repo.get('clarification-probe'); }
  catch(e) { if(!String(e).includes('Run not found')) throw e; run=await repo.create('clarification-probe','Synthetic requirement','test-base');run=await repo.askQuestions(run.id,run.revision,[{id:'q1',question:'Synthetic question?'}]);console.log('CLARIFICATION_PROBE','created',run.state);return; }
  if(run.state==='clarifying') { run=await repo.answerQuestions(run.id,run.revision,[{id:'q1',answer:'Synthetic answer'}]);console.log('CLARIFICATION_PROBE','answered',run.state); }
  else console.log('CLARIFICATION_PROBE','restored',run.state,run.clarification.length);
 }catch(e){console.log('CLARIFICATION_PROBE_ERROR',String(e));}
}});
