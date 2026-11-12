import { Plugin } from '@opencode/plugin';
import { FeaturePilot, registerInventory } from '../node_modules/feature-pilot/dist/rpc.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
export default Plugin.define({id:'draft-probe',async setup(ctx){const reg=await registerInventory(ctx);setTimeout(async()=>{try {
 const rpc=ctx.rpc(FeaturePilot), created=await rpc.createDraft({requirement:'Synthetic approval'}), prefix=`project-runs/${encodeURIComponent(ctx.location.directory)}/`;
 const repo=new RunRepository({get:k=>ctx.storage.get(prefix+k),set:(k,v)=>ctx.storage.set(prefix+k,v)});
 let run=await repo.askQuestions(created.run.id,created.run.revision,[{id:'q',question:'Which option?'}]);
 const answered=await rpc.answerDraft({id:run.id,revision:run.revision,answers:[{id:'q',answer:'A'}]});
 const step={id:'implement',description:'Implement',role:'coder',taskKind:'implement',dependsOn:[],resources:null,inference:true,completion:'done',execution:null};
 run=await repo.setPlan(run.id,answered.run.revision,{steps:[step],acceptance:[{id:'a',description:'works'}],questions:[{question:'Which option?',answer:'A'}],areas:['src'],rollback:'revert',validationCommands:['test']});
 const shown=await rpc.getDraft({id:run.id});const result=await rpc.approveDraft({id:run.id,revision:shown.run.revision,planHash:shown.run.planHash});
 console.log('DRAFT_APPROVAL_PROBE',JSON.stringify({answered:answered.run.clarification[0].answer,hasPlan:!!shown.run.planJson,state:result.run.state}));
 }catch(e){console.log('DRAFT_APPROVAL_ERROR',String(e));}},500);return ()=>reg.dispose();}});
