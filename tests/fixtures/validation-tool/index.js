import { Plugin } from '@opencode/plugin';
import { newRun, setPlan, approvePlan, beginImplementation } from '../node_modules/feature-pilot/dist/run.js';
import { runApprovedValidation } from '../node_modules/feature-pilot/dist/validation.js';
export default Plugin.define({id:'validation-tool-probe',async setup(ctx){
 setTimeout(async()=>{try{
  const s=await ctx.session.create({title:'Validation tool probe',agent:'build',permissions:[{action:'shell',resource:'*',effect:'allow'}]});
  const tool=(await ctx.tool.list()).find(t=>t.id==='shell');
  const context={sessionID:s.id,agent:'build',messageID:'msg_validation_probe',id:'call_validation_probe',signal:new AbortController().signal,progress:async()=>{}};
  let run=newRun('validation-probe','Synthetic requirement','base');
  run=setPlan(run,run.revision,{steps:[{id:'synthetic-step',description:'Synthetic step',role:'coder',taskKind:'implement',dependsOn:[],resources:null,inference:true,completion:'Synthetic evidence',execution:null}],acceptance:[{id:'synthetic-criterion',description:'Synthetic criterion'}],areas:['src'],rollback:'Revert synthetic changes',questions:[],validationCommands:['printf synthetic-ok','exit 7']});
  run=approvePlan(run,run.revision,run.planHash);run=beginImplementation(run,run.revision);
  const report=await runApprovedValidation(run,{diffHash:'synthetic-diff',timeoutMs:5000,currentDiff:async()=> 'synthetic-diff',execute:(command,signal)=>tool.execute({command},{...context,signal})});
  console.log('VALIDATION_RUN',JSON.stringify({status:report.status,results:report.commands.map(c=>({status:c.status,exit:c.exitCode}))}));
  for(const [name,command] of [['success','printf synthetic-ok'],['failure','exit 7']]) {
   try{const value=await tool.execute({command},context);console.log('VALIDATION_TOOL',name,JSON.stringify(value));}
   catch(e){console.log('VALIDATION_TOOL_ERROR',name,JSON.stringify({message:e.message,error:String(e.error??e),metadata:e.metadata}));}
  }
 }catch(e){console.log('VALIDATION_PROBE_ERROR',String(e));}},1500);
}});
