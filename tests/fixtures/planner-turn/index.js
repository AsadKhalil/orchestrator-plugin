import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { startPlannerTurn, inspectPlannerTurn } from '../node_modules/feature-pilot/dist/planner-turn.js';
export default Plugin.define({id:'planner-turn-probe',async setup(ctx){setTimeout(async()=>{try {
 const id=randomUUID(), repo=new RunRepository(ctx.storage), host=createOpenCodeHost(ctx); const run=await repo.create(id,'Synthetic feature','base');
 const saved=await startPlannerTurn(repo,host,ctx.storage,{runID:id,revision:run.revision,model:{providerID:'smoke',id:'model-one',variant:'high'}});
 const checkpoint=await inspectPlannerTurn(ctx.storage,id); console.log('PLANNER_TURN_PROBE',JSON.stringify({state:saved.state,questions:saved.clarification.length,checkpoint:checkpoint.phase}));
 }catch(e){console.log('PLANNER_TURN_ERROR',String(e));}},1500);}});
