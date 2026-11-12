import { Plugin } from '@opencode/plugin';
export default Plugin.define({id:'shell-stop-probe',async setup(ctx){const guard=await ctx.session.hook('experimental.model.resolve',async()=>{throw Error('synthetic inference blocked');});setTimeout(async()=>{try{
 const session=await ctx.session.create({title:'Synthetic shell stop',agent:'build',permissions:[{action:'shell',resource:'*',effect:'allow'}]});
 const tool=(await ctx.tool.list()).find(t=>t.id==='shell');const signal=new AbortController();
 const result=await tool.execute({command:'sleep 30',background:true,timeout:35000},{sessionID:session.id,agent:'build',messageID:'msg_stop_shell',id:'call_stop_shell',signal:signal.signal,progress:async()=>{}});
 const interrupted=await ctx.session.interrupt({sessionID:session.id,resume:false});console.log('SHELL_STOP_STARTED',JSON.stringify({shellID:result.output?.shellID,status:result.output?.status,sessionInterrupted:interrupted.interrupted}));
 }catch(e){console.log('SHELL_STOP_ERROR',String(e));}},1500);return ()=>guard.dispose();}});
