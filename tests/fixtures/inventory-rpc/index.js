import { Plugin } from '@opencode/plugin';
import pilot from '../node_modules/feature-pilot/dist/index.js';
import { FeaturePilot } from '../node_modules/feature-pilot/dist/rpc.js';
export default Plugin.define({id:'feature-pilot-smoke-fixture',async setup(ctx){
 const cleanup=await pilot.setup(ctx);
 setTimeout(async()=>{try {
  const result=await ctx.rpc(FeaturePilot).listModels({});
  console.log('INVENTORY_RPC',JSON.stringify({count:result.models.length,hasSettings:result.models.some(m=>'settings' in m)}));
 } catch(e) {console.log('INVENTORY_RPC_ERROR',String(e));}},1500);
 return cleanup;
}});
