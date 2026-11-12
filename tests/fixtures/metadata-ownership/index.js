import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../node_modules/feature-pilot/dist/index.js';
export default Plugin.define({id:'metadata-ownership-probe',async setup(ctx){const runtime=await createRuntime(ctx);setTimeout(async()=>{try{
 const model={providerID:'smoke',id:'model-one',variant:'high'};
 const owned=await ctx.session.create({title:'Synthetic owned',model,metadata:{featurePilotRunID:'synthetic',featurePilotRole:'planner'},permissions:[]});
 const normal=await ctx.session.create({title:'Synthetic ordinary',model,permissions:[]});
 let editDenied=false,ordinaryAllowed=false;try{await ctx.permission.assert({sessionID:owned.id,action:'edit',resources:['file.txt']});}catch{editDenied=true;}
 try{await ctx.permission.assert({sessionID:normal.id,action:'read',resources:['planner-readable.txt']});ordinaryAllowed=true;}catch{}
 await ctx.session.prompt({sessionID:owned.id,id:'msg_'+randomUUID(),text:'Synthetic owned prompt'});await ctx.session.wait({sessionID:owned.id});
 await ctx.session.prompt({sessionID:normal.id,id:'msg_'+randomUUID(),text:'Synthetic normal prompt'});await ctx.session.wait({sessionID:normal.id});
 console.log('METADATA_OWNERSHIP_PROBE',JSON.stringify({editDenied,ordinaryAllowed,ownedOutcome:(await ctx.session.get({sessionID:owned.id})).outcome,ordinaryOutcome:(await ctx.session.get({sessionID:normal.id})).outcome}));
 }catch(e){console.log('METADATA_OWNERSHIP_ERROR',String(e));}},1500);return ()=>runtime.dispose();}});
