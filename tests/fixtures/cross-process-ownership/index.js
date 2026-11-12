import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../node_modules/feature-pilot/dist/index.js';
export default Plugin.define({id:'cross-process-ownership',async setup(ctx){
 const mode=process.env.FEATURE_PILOT_PROBE_ROLE;
 if(mode==='watcher') {
  const runtime=await createRuntime(ctx);console.log('CROSS_OWNERSHIP_WATCHING');
  const deadline=Date.now()+90000;
  const poll=setInterval(async()=>{try {
   const id=await ctx.storage.get('shared-id');if(typeof id!=='string'){if(Date.now()>deadline){clearInterval(poll);console.log('CROSS_OWNERSHIP_TIMEOUT');}return;}
   clearInterval(poll);let editDenied=false;try{await ctx.permission.assert({sessionID:id,action:'edit',resources:['x']});}catch{editDenied=true;}
   await ctx.session.prompt({sessionID:id,id:'msg_'+randomUUID(),text:'Synthetic owned request'});await ctx.session.wait({sessionID:id});
   console.log('CROSS_OWNERSHIP_WATCHER',JSON.stringify({editDenied,outcome:(await ctx.session.get({sessionID:id})).outcome}));
  }catch(e){clearInterval(poll);console.log('CROSS_OWNERSHIP_WATCHER_ERROR',String(e));}},250);
  return async()=>{clearInterval(poll);await runtime.dispose();};
 }
 setTimeout(async()=>{try{const session=await ctx.session.create({title:'Synthetic cross process',model:{providerID:'smoke',id:'model-one',variant:'high'},metadata:{},permissions:[]});
 await ctx.storage.set(`owned-role/${encodeURIComponent(session.id)}`,'planner');await ctx.storage.set(`owned-session/${encodeURIComponent(session.id)}`,'run');await ctx.storage.set('shared-id',session.id);console.log('CROSS_OWNERSHIP_CREATED');
 }catch(e){console.log('CROSS_OWNERSHIP_CREATOR_ERROR',String(e));}},1500);
}});
