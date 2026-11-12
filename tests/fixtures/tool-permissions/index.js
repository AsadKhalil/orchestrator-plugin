import { Plugin } from '@opencode/plugin';
import { createRuntime } from '../node_modules/feature-pilot/dist/index.js';
export default Plugin.define({id:'feature-pilot-smoke-fixture',async setup(ctx){
 const runtime=await createRuntime(ctx);
 setTimeout(async()=>{try {
  const id=await runtime.host.prepareStage({runID:'tool-probe',role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}});
  await ctx.session.update({sessionID:id,permissions:[]});
  const tools=await ctx.tool.list();
  console.log('TOOL_PROBE_LIST',JSON.stringify(tools.map(x=>x.id)));
  for (const t of tools.filter(x=>['execute','subagent'].includes(x.id))) console.log('TOOL_PROBE_SCHEMA',t.id,JSON.stringify(Object.keys(t)));
  const toolContext={sessionID:id,agent:'plan',messageID:'msg_tool_probe',id:'call_tool_probe',signal:new AbortController().signal,progress:async()=>{}};
  const control = await ctx.session.create({title:'tool control',permissions:[{action:'shell',resource:'*',effect:'allow'}]});
  try { const result=await tools.find(x=>x.id==='shell').execute({command:'touch tool-probe-control'}, {...toolContext,sessionID:control.id,agent:'build'}); console.log('TOOL_PROBE_CONTROL',JSON.stringify(result).slice(0,150)); } catch(e) { console.log('TOOL_PROBE_CONTROL_ERROR',JSON.stringify({message:e.message,cause:String(e.error)})); }
  for(const [name,input] of [['shell',{command:'touch tool-probe-shell'}],['write',{path:'tool-probe-write',content:'unexpected'}],['subagent',{agent:'general',description:'probe',prompt:'do nothing'}],['browser_navigate',{tabID:'tab_00000000-0000-0000-0000-000000000000',url:'http://127.0.0.1:9'}]]) {
   const tool=tools.find(x=>x.id===name); if(!tool){console.log('TOOL_PROBE',name,'missing');continue;}
   try {const r=await tool.execute(input,toolContext);console.log('TOOL_PROBE',name,'result',JSON.stringify(r).slice(0,250));}
   catch(e){console.log('TOOL_PROBE',name,'error',JSON.stringify({message:e.message,cause:String(e.error),metadata:e.metadata}));}
  }
 } catch(e){console.log('TOOL_PROBE_ERROR',String(e));}},1500);
 return ()=>runtime.dispose();
}});
