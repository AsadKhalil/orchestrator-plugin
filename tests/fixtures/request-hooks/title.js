import { Plugin } from '@opencode/plugin';
export default Plugin.define({id:'feature-pilot-smoke-fixture',async setup(ctx){
 let owned;
 const hook=await ctx.session.hook('experimental.model.resolve',event=>{
  if(event.sessionID===owned) {console.log('TITLE_PROBE_RESOLVE',event.kind); if(event.kind==='title') throw new Error('title-probe-denied');}
 });
 setTimeout(async()=>{try {
  const s=await ctx.session.create({model:{providerID:'smoke',id:'model-one',variant:'high'}});owned=s.id;
  await ctx.session.prompt({sessionID:owned,text:'Synthetic title check.'});
  await ctx.session.wait({sessionID:owned});
  console.log('TITLE_PROBE_DONE');
 } catch(e){console.log('TITLE_PROBE_ERROR',String(e));}},1500);
 return ()=>hook.dispose();
}});
