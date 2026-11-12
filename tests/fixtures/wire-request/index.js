import { Plugin } from '@opencode/plugin';
import { createRuntime } from '../node_modules/feature-pilot/dist/index.js';
export default Plugin.define({id:'feature-pilot-smoke-fixture',async setup(ctx){
 const runtime=await createRuntime(ctx);
 setTimeout(async()=>{ try {
   const id=await runtime.host.prepareStage({runID:'wire-probe',role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}});
   await ctx.session.prompt({sessionID:id,text:'Reply with a short greeting.'});
   await ctx.session.wait({sessionID:id});
   const messages=await ctx.session.context({sessionID:id});
   console.log('WIRE_PROBE_COMPLETED', JSON.stringify({messages:messages.length, shapes:messages.map(m=>({keys:Object.keys(m),role:m.role,usage:m.tokens,cost:m.cost}))}));
 } catch(e){console.log('WIRE_PROBE_ERROR',String(e));}},1500);
 return ()=>runtime.dispose();
}});
