import { Plugin } from '@opencode/plugin';
import { createRuntime } from '../node_modules/feature-pilot/dist/index.js';
export default Plugin.define({id:'feature-pilot-smoke-fixture',async setup(ctx){
 const runtime=await createRuntime(ctx); let owned;
 const hook=await ctx.session.hook('experimental.model.resolve',event=>{
  if(event.sessionID===owned) {console.log('BUDGET_PROBE_RESOLVE',event.kind); throw new Error('budget-probe-denied');}
 });
 setTimeout(async()=>{try {
  owned=await runtime.host.prepareStage({runID:'budget-probe',role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}});
  await ctx.session.prompt({sessionID:owned,text:'Synthetic test.'});
  await ctx.session.wait({sessionID:owned});
  try { await ctx.session.generate({sessionID:owned,prompt:'Synthetic summary.'}); } catch(e) { console.log('BUDGET_PROBE_GENERATE_ERROR',String(e).slice(0,150)); }
  try { await ctx.session.compact({sessionID:owned}); await ctx.session.wait({sessionID:owned}); console.log('BUDGET_PROBE_COMPACT_DONE'); } catch(e) { console.log('BUDGET_PROBE_COMPACT_ERROR',String(e).slice(0,150)); }
  const messages=await ctx.session.context({sessionID:owned});
  console.log('BUDGET_PROBE_STATE',JSON.stringify(messages.map(x=>({type:x.type,outcome:x.outcome}))));
 } catch(e){console.log('BUDGET_PROBE_ERROR',String(e));}},1500);
 return async()=>{await hook.dispose();await runtime.dispose();};
}});
