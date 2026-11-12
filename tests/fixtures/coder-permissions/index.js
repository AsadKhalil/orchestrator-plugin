import { Plugin } from '@opencode/plugin';
import { restrictRoleAction } from '../node_modules/feature-pilot/dist/permissions.js';
export default Plugin.define({id:'coder-permissions-probe', async setup(ctx) {
 const roles=new Map();
 const hook=await ctx.permission.hook('evaluate',event=>restrictRoleAction(event,async id=>roles.get(id)??null,{allowedActions:['read','edit','shell','subagent']}));
 setTimeout(async()=>{try{
  const rules=[{action:'edit',resource:'*',effect:'allow'},{action:'shell',resource:'*',effect:'allow'},{action:'subagent',resource:'*',effect:'allow'}];
  const coder=await ctx.session.create({title:'Coder permission probe',agent:'build',permissions:rules});roles.set(coder.id,'coder');
  const planner=await ctx.session.create({title:'Planner permission probe',agent:'build',permissions:rules});roles.set(planner.id,'planner');
  const denied=await ctx.session.create({title:'Native deny probe',agent:'build',permissions:[...rules,{action:'edit',resource:'*',effect:'deny'}]});roles.set(denied.id,'coder');
  const tools=await ctx.tool.list();
  const context=id=>({sessionID:id,agent:'build',messageID:'msg_coder_probe',id:'call_coder_probe',signal:new AbortController().signal,progress:async()=>{}});
  const invoke=async(name,input,id)=>{try{await tools.find(t=>t.id===name).execute(input,context(id));return 'allowed';}catch(e){return String(e.error??e).includes('BlockedError')?'denied':'error';}};
  const output={coderWrite:await invoke('write',{path:'coder-probe.txt',content:'synthetic'},coder.id),plannerWrite:await invoke('write',{path:'planner-probe.txt',content:'synthetic'},planner.id),nativeDeny:await invoke('write',{path:'denied-probe.txt',content:'synthetic'},denied.id),coderShell:await invoke('shell',{command:'touch coder-shell-probe.txt'},coder.id),coderSubagent:await invoke('subagent',{agent:'general',description:'probe',prompt:'do nothing'},coder.id)};
  console.log('CODER_PERMISSION_PROBE',JSON.stringify(output));
 }catch(e){console.log('CODER_PERMISSION_ERROR',String(e));}},1500);
 return ()=>hook.dispose();
}});
