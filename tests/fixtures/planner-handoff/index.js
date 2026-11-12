import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { savePlannerReply } from '../node_modules/feature-pilot/dist/planner-handoff.js';
export default Plugin.define({id:'planner-handoff-probe',async setup(ctx){setTimeout(async()=>{try {
 const host=createOpenCodeHost(ctx), repo=new RunRepository(ctx.storage), id=randomUUID(), run=await repo.create(id,'Synthetic feature','base');
 const sessionID=await host.prepareStage({runID:id,role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}}), promptID='msg_'+randomUUID();
 await host.submitStagePrompt(sessionID,id,promptID,'Return the synthetic question.');await host.waitStage(sessionID,id);
 const saved=await savePlannerReply(repo,host,{runID:id,revision:run.revision,sessionID,promptID});
 console.log('PLANNER_HANDOFF_PROBE',JSON.stringify({state:saved.state,questions:saved.clarification.length}));
 }catch(e){console.log('PLANNER_HANDOFF_ERROR',String(e));}},1500);}});
