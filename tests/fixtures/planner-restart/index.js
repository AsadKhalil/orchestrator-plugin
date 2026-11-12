import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { startPlannerTurn, inspectPlannerTurn, reconcilePlannerTurn } from '../node_modules/feature-pilot/dist/planner-turn.js';
export default Plugin.define({id:'planner-restart-probe',async setup(ctx){setTimeout(async()=>{try {
 const repo=new RunRepository(ctx.storage), host=createOpenCodeHost(ctx); let id=await ctx.storage.get('probe-id');
 if(!id){id=randomUUID();await ctx.storage.set('probe-id',id);const run=await repo.create(id,'Synthetic feature','base');const broken={...host,async waitStage(){throw Error('synthetic disconnect');}};
  try {await startPlannerTurn(repo,broken,ctx.storage,{runID:id,revision:run.revision,model:{providerID:'smoke',id:'model-one',variant:'high'}});}catch(e){if(!String(e).includes('synthetic disconnect'))throw e;}
  const checkpoint=await inspectPlannerTurn(ctx.storage,id);await host.waitStage(checkpoint.sessionID,id);console.log('PLANNER_RESTART_PHASE1',JSON.stringify({checkpoint:checkpoint.phase}));
 } else {const recovered=await reconcilePlannerTurn(repo,host,ctx.storage,id);console.log('PLANNER_RESTART_PHASE2',JSON.stringify({status:recovered.status,state:(await repo.get(id)).state,checkpoint:(await inspectPlannerTurn(ctx.storage,id)).phase}));}
 }catch(e){console.log('PLANNER_RESTART_ERROR',String(e));}},1500);}});
