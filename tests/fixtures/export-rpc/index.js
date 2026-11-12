import { Plugin } from '@opencode/plugin';
import { FeaturePilot, registerInventory } from '../node_modules/feature-pilot/dist/rpc.js';
export default Plugin.define({id:'export-rpc-probe',async setup(ctx){const registration=await registerInventory(ctx);setTimeout(async()=>{try{
 const rpc=ctx.rpc(FeaturePilot), draft=await rpc.createDraft({requirement:'Synthetic feature'});
 const result=await rpc.exportDraft({id:draft.run.id,revision:draft.run.revision}),json=JSON.parse(result.preview);
 console.log('EXPORT_RPC_PROBE',JSON.stringify({requirement:json.requirement,approval:json.approval,diff:json.limitations.diff,costs:json.limitations.costs}));
 }catch(e){console.log('EXPORT_RPC_ERROR',String(e));}},500);return ()=>registration.dispose();}});
