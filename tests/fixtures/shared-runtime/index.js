import { Plugin } from '@opencode/plugin';
import { createRuntime } from '../node_modules/feature-pilot/dist/index.js';
export default Plugin.define({id:'feature-pilot-smoke-fixture',async setup(ctx){
  const runtime=await createRuntime(ctx);
  setTimeout(async()=>{try {
    let id=await ctx.storage.get('shared-runtime-probe');
    if(typeof id!=='string') {
      id=await runtime.host.prepareStage({runID:'shared-runtime',role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}});
      await ctx.storage.set('shared-runtime-probe',id);
      // Test-only: remove deny-all to isolate the hook's own decision.
      await ctx.session.update({sessionID:id,permissions:[]});
      console.log('SHARED_RUNTIME','created');
    } else console.log('SHARED_RUNTIME','restored');
    for(const [action,resource] of [['read','src/file.ts'],['shell','touch file'],['edit','src/file.ts']]) {
      try { await ctx.permission.assert({sessionID:id,action,resources:[resource]}); console.log('SHARED_RUNTIME',action,'allowed'); }
      catch { console.log('SHARED_RUNTIME',action,'denied'); }
    }
  } catch(e) {console.log('SHARED_RUNTIME_ERROR',String(e));} },1500);
  return ()=>runtime.dispose();
}});
