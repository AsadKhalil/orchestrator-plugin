import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { startPlannerTurn, inspectPlannerTurn } from '../node_modules/feature-pilot/dist/planner-turn.js';
import { requestRunStop } from '../node_modules/feature-pilot/dist/stop.js';
export default Plugin.define({id:'stop-active-probe',async setup(ctx){setTimeout(async()=>{try{
 const id=randomUUID(),repo=new RunRepository(ctx.storage),host=createOpenCodeHost(ctx),run=await repo.create(id,'Synthetic feature','base');
 const running=startPlannerTurn(repo,host,ctx.storage,{runID:id,revision:run.revision,model:{providerID:'smoke',id:'model-one',variant:'high'}}).catch(()=>null);
 let checkpoint;for(let i=0;i<100;i++){checkpoint=await inspectPlannerTurn(ctx.storage,id);if(checkpoint?.phase==='submitted'){const session=await ctx.session.get({sessionID:checkpoint.sessionID});if(session.time.busy)break;}await new Promise(r=>setTimeout(r,100));}
 if(checkpoint?.phase!=='submitted')throw Error('No submitted session');
 const result=await requestRunStop(repo,host,ctx.storage,id,run.revision);await running;
 console.log('STOP_ACTIVE_PROBE',JSON.stringify({requested:result.run.stopRequested,interrupt:result.interruptions[0]?.status,cleanup:result.processCleanup,outcome:(await ctx.session.get({sessionID:checkpoint.sessionID})).outcome}));
 }catch(e){console.log('STOP_ACTIVE_ERROR',String(e));}},1500);}});
