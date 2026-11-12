import { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHost } from '../node_modules/feature-pilot/dist/host.js';
import { RunRepository } from '../node_modules/feature-pilot/dist/run-store.js';
import { saveReviewerReply } from '../node_modules/feature-pilot/dist/planner-handoff.js';
export default Plugin.define({id:'reviewer-handoff-probe',async setup(ctx){setTimeout(async()=>{try{
 const id=randomUUID(),repo=new RunRepository(ctx.storage),host=createOpenCodeHost(ctx);let run=await repo.create(id,'Synthetic feature','base');
 const step={id:'implement',description:'Implement',role:'coder',taskKind:'implement',dependsOn:[],resources:null,inference:true,completion:'done',execution:null};
 run=await repo.setPlan(id,run.revision,{steps:[step],acceptance:[{id:'a',description:'works'}],questions:[],areas:['src'],rollback:'revert',validationCommands:['test']});run=await repo.approve(id,run.revision,run.planHash);run=await repo.begin(id,run.revision);run=await repo.recordStepOutcome(id,run.revision,{stepID:'implement',inputContentVersion:'base',contentVersion:'synthetic-diff',evidence:'synthetic'});
 run=await repo.startReview(id,run.revision,{planHash:run.planHash,diffHash:'synthetic-diff',validation:{diffHash:'synthetic-diff',commands:[{command:'test',exitCode:0}]},reviewer:{providerID:'smoke',id:'model-one',variant:'high',vendor:'review',modelVersion:'v1'},contributingVendors:['coder'],budgetAvailable:true});
 const sessionID=await host.prepareStage({runID:id,role:'reviewer',model:{providerID:'smoke',id:'model-one',variant:'high'}}),promptID='msg_'+randomUUID();
 await host.submitStagePrompt(sessionID,id,promptID,`Synthetic review plan hash: ${run.planHash}`);await host.waitStage(sessionID,id);
 const saved=await saveReviewerReply(repo,host,{runID:id,revision:run.revision,sessionID,promptID});console.log('REVIEWER_HANDOFF_PROBE',JSON.stringify({state:saved.state,reviews:saved.review.reviews.length}));
 }catch(e){console.log('REVIEWER_HANDOFF_ERROR',String(e));}},1500);}});
