import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { startPlannerTurn, inspectPlannerTurn, reconcilePlannerTurn } from '../node_modules/feature-pilot/dist/planner-turn.js';
export default Plugin.define({id:'planner-recovery-probe',async setup(ctx){setTimeout(async()=>{try {
 const id=randomUUID(), repo=new RunRepository(ctx.storage), actual=createOpenCodeHost(ctx), run=await repo.create(id,'Synthetic feature','base');
 const broken={...actual,async waitStage(){throw Error('synthetic disconnect');}};
 try {await startPlannerTurn(repo,broken,ctx.storage,{runID:id,revision:run.revision,model:{providerID:'smoke',id:'model-one',variant:'high'}});}catch(e){if(!String(e).includes('synthetic disconnect'))throw e;}
 const checkpoint=await inspectPlannerTurn(ctx.storage,id);await actual.waitStage(checkpoint.sessionID,id);
 const recovered=await reconcilePlannerTurn(new RunRepository(ctx.storage),createOpenCodeHost(ctx),ctx.storage,id);
 console.log('PLANNER_RECOVERY_PROBE',JSON.stringify({status:recovered.status,state:(await repo.get(id)).state,checkpoint:(await inspectPlannerTurn(ctx.storage,id)).phase}));
 }catch(e){console.log('PLANNER_RECOVERY_ERROR',String(e));}},1500);}});
