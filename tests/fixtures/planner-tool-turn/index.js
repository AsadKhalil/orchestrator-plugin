import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { savePlannerReply } from '../node_modules/feature-pilot/dist/planner-handoff.js';
import { restrictRoleAction } from '../node_modules/feature-pilot/dist/permissions.js';
export default Plugin.define({id:'planner-tool-turn-probe',async setup(ctx){const roles=new Map(),hook=await ctx.permission.hook('evaluate',event=>restrictRoleAction(event,async id=>roles.get(id)??null));setTimeout(async()=>{try{
 const host=createOpenCodeHost(ctx), repo=new RunRepository(ctx.storage), id=randomUUID(), run=await repo.create(id,'Synthetic feature','base'), sessionID=await host.prepareStage({runID:id,role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}}); roles.set(sessionID,'planner');await ctx.session.update({sessionID,permissions:[]});
 const promptID='msg_'+randomUUID(); await host.submitStagePrompt(sessionID,id,promptID,'Read planner-readable.txt then return a question.');await host.waitStage(sessionID,id);const result=await host.readStage(sessionID,id);
 const saved=await savePlannerReply(repo,host,{runID:id,revision:run.revision,sessionID,promptID});
 console.log('PLANNER_TOOL_SAVED',JSON.stringify({state:saved.state,questions:saved.clarification.length}));
 console.log('PLANNER_TOOL_TURN',JSON.stringify({outcome:result.outcome,messages:result.messages.map(m=>({type:m.type,finish:m.finish,contents:m.content?.map(p=>({type:p.type,name:p.name,status:p.state?.status}))}))}));
 }catch(e){console.log('PLANNER_TOOL_ERROR',String(e));}},1500);return ()=>hook.dispose();}});
