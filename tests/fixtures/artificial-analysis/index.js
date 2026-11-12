import { Plugin } from '@opencode/plugin';
import { FeaturePilot, registerInventory } from '../node_modules/feature-pilot/dist/rpc.js';
export default Plugin.define({id:'aa-rpc-probe',async setup(ctx){const registration=await registerInventory(ctx);setTimeout(async()=>{const original=globalThis.fetch;try{
 let calls=0;globalThis.fetch=async(_url,options)=>{calls++;if(options.headers['x-api-key']!=='synthetic-key')throw Error('wrong synthetic key');return new Response(JSON.stringify({tier:'free',intelligence_index_version:5,pagination:{page:calls,has_more:calls===1},data:[{id:'synthetic-'+calls,slug:'model-'+calls,name:'Synthetic '+calls,model_creator:{name:'Fixture'},evaluations:{artificial_analysis_intelligence_index:calls===1?35:null}}]}));};
 const result=await ctx.rpc(FeaturePilot).listIntelligence({});console.log('AA_RPC_PROBE',JSON.stringify({count:result.entries.length,version:result.indexVersion,unknown:result.entries.filter(x=>x.score===null).length,secretLeaked:JSON.stringify(result).includes('synthetic-key')}));
 }catch(e){console.log('AA_RPC_ERROR',String(e));}finally{globalThis.fetch=original;}},500);return ()=>registration.dispose();}});
