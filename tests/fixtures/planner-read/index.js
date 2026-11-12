import { Plugin } from '@opencode/plugin';
import { restrictRoleAction } from '../node_modules/feature-pilot/dist/permissions.js';
export default Plugin.define({id:'planner-read-probe',async setup(ctx){
 const roles=new Map();const hook=await ctx.permission.hook('evaluate',event=>restrictRoleAction(event,async id=>roles.get(id)??null));
 setTimeout(async()=>{try {
  const session=await ctx.session.create({title:'Planner read probe',agent:'build',permissions:[]});roles.set(session.id,'planner');
  const tools=await ctx.tool.list(), tool=tools.find(t=>t.id==='read');
  console.log('PLANNER_READ_SCHEMA',JSON.stringify({keys:Object.keys(tool??{}),parameters:tool?.parameters}));
  const context={sessionID:session.id,agent:'build',messageID:'msg_planner_probe',id:'call_planner_probe',signal:AbortSignal.timeout(3000),progress:async()=>{}};
  const invoke=async(name,input)=>{try {const out=await tools.find(t=>t.id===name).execute(input,context);return {state:'allowed',containsMarker:JSON.stringify(out).includes('synthetic-readable')};}catch(e){return {state:'error',cause:String(e.error??e)};}};
  const read=await invoke('read',{path:'planner-readable.txt'}),write=await invoke('write',{path:'planner-forbidden.txt',content:'bad'}),shell=await invoke('shell',{command:'touch planner-shell-forbidden'});
  console.log('PLANNER_READ_PROBE',JSON.stringify({read,write,shell}));
 }catch(e){console.log('PLANNER_READ_ERROR',String(e));}},1500);return ()=>hook.dispose();}});
