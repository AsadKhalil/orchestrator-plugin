import { randomUUID } from 'node:crypto';
import { Plugin } from '@opencode/plugin';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
export default Plugin.define({id:'stage-probe',async setup(ctx){
 setTimeout(async()=>{try{
  const host=createOpenCodeHost(ctx);
  const sessionID=await host.prepareStage({runID:'stage-probe',role:'planner',model:{providerID:'smoke',id:'model-one',variant:'high'}});
  await host.submitStagePrompt(sessionID,'stage-probe','msg_probe_'+randomUUID(),'Reply with a short greeting.');
  await host.waitStage(sessionID,'stage-probe');
  const result=await host.readStage(sessionID,'stage-probe');
  const assistant=result.messages.find(m=>m.type==='assistant');
  let denied=false; try{await host.readStage(sessionID,'wrong-run');}catch{denied=true;}
  console.log('ADAPTER_READ',JSON.stringify({outcome:result.outcome,assistant:assistant&&{type:assistant.type,model:assistant.model,finish:assistant.finish,tokens:assistant.tokens,cost:assistant.cost},wrongRunDenied:denied}));
 }catch(e){console.log('ADAPTER_ERROR',String(e));}},1500);
}});
