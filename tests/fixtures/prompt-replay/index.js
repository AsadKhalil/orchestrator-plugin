import { randomUUID } from 'node:crypto';
import { Plugin } from '@opencode/plugin';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
export default Plugin.define({id:'prompt-replay-probe',async setup(ctx){
 setTimeout(async()=>{try{
  const host=createOpenCodeHost(ctx);
  const model={providerID:'smoke',id:'model-one',variant:'high'};
  const sessionID=await host.prepareStage({runID:'replay-probe',role:'planner',model});
  const id='msg_probe_'+randomUUID();
  const prompt=(sessionID,text)=>ctx.session.prompt({sessionID,id,text,delivery:'queue'});
  await prompt(sessionID,'Reply with a short greeting.');
  await ctx.session.wait({sessionID});
  await prompt(sessionID,'Reply with a short greeting.');
  await ctx.session.wait({sessionID});
  let changed; try { await prompt(sessionID,'A different prompt.'); changed='accepted'; } catch(e) { changed=String(e); }
  const other=await host.prepareStage({runID:'replay-probe',role:'planner',model});
  let otherSession; try { await prompt(other,'Reply with a short greeting.'); otherSession='accepted'; } catch(e) { otherSession=String(e); }
  const result=await host.readStage(sessionID,'replay-probe');
  console.log('PROMPT_REPLAY',JSON.stringify({changed,otherSession,userMessages:result.messages.filter(m=>m.type==='user').length,assistantMessages:result.messages.filter(m=>m.type==='assistant').length}));
 }catch(e){console.log('PROMPT_REPLAY_ERROR',String(e));}},1500);
}});
