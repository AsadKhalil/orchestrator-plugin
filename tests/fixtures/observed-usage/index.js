import { Plugin } from '@opencode/plugin';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { FeaturePilot, registerInventory } from '../node_modules/feature-pilot/dist/rpc.js';
import { randomUUID } from 'node:crypto';
export default Plugin.define({id:'observed-usage-probe',async setup(ctx){
 const registration=await registerInventory(ctx);
 setTimeout(async()=>{try {
  const host=createOpenCodeHost(ctx);
  const id=await host.prepareStage({runID:'usage-probe',role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}});
  await ctx.session.prompt({sessionID:id,id:'msg_usage_'+randomUUID(),text:'Reply with a short greeting.'});await ctx.session.wait({sessionID:id});
  const report=await ctx.rpc(FeaturePilot).observedUsage({month:new Date().toISOString().slice(0,7),timeZone:'UTC'});
  console.log('OBSERVED_USAGE_PROBE',JSON.stringify({attempts:report.summary.total.attempts,grossUnknown:report.summary.total.gross.unknownCount,cashUnknown:report.summary.total.cash.unknownCount,complete:report.coverage.complete}));
 }catch(e){console.log('OBSERVED_USAGE_ERROR',String(e));}},1500);
 return ()=>registration.dispose();
}});
