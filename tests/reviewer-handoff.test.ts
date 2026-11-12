import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRepository } from '../src/run-store.js';
import { saveReviewerReply } from '../src/planner-handoff.js';
import { step, criterion } from './fixtures/plan-data.js';

async function setup() {
  const records=new Map<string,unknown>(),repo=new RunRepository({async get(k){return structuredClone(records.get(k));},async set(k,v){records.set(k,structuredClone(v));}});
  let run=await repo.create('run','Feature','base'); run=await repo.setPlan(run.id,run.revision,{steps:[step('Implement')],acceptance:[criterion('Works')],questions:[],areas:['src'],rollback:'Revert',validationCommands:['test']});
  run=await repo.approve(run.id,run.revision,run.planHash!);run=await repo.begin(run.id,run.revision);run=await repo.recordStepOutcome(run.id,run.revision,{stepID:'implement',inputContentVersion:'base',contentVersion:'diff',evidence:'done'});
  const reviewer={providerID:'p',id:'m',variant:'high',vendor:'reviewer',modelVersion:'v1'};
  run=await repo.startReview(run.id,run.revision,{planHash:run.planHash!,diffHash:'diff',validation:{diffHash:'diff',commands:[{command:'test',exitCode:0}]},reviewer,contributingVendors:['coder'],budgetAvailable:true});
  const model={providerID:'p',id:'m',variant:'high'};
  const reply={type:'assistant',id:'msg_assistant',model,finish:'stop',content:[{type:'text',text:JSON.stringify({planHash:run.planHash,diffHash:'diff',verdict:'approve',findings:[]})}]};
  const host={async ownsPrompt(){return true;},async roleForSession(){return 'reviewer';},async stageModels(){return {expected:model,current:model};},async readStage(){return {outcome:'succeeded',messages:[{type:'user',id:'msg_prompt',text:'prompt'},reply]};}};
  return {repo,run,host,reply,input:{runID:'run',revision:run.revision,sessionID:'ses_1',promptID:'msg_prompt'}};
}

test('saves a matching owned independent reviewer response once',async()=>{
 const {repo,host,input}=await setup(); const saved=await saveReviewerReply(repo,host as never,input);
 assert.equal(saved.state,'ready_for_acceptance');assert.equal(saved.review?.reviews.length,1);
 await assert.rejects(saveReviewerReply(repo,host as never,input),/stale/i);
});

test('rejects wrong reviewer role, pinned model and mismatched review output',async()=>{
 for(const mode of ['role','pinned','diff','unowned']) {
  const {repo,host,reply,input}=await setup();
  if(mode==='role')host.roleForSession=async()=>'planner';
  if(mode==='pinned')host.stageModels=async()=>({expected:{providerID:'p',id:'other',variant:'high'},current:{providerID:'p',id:'other',variant:'high'}});
  if(mode==='diff')reply.content[0].text=JSON.stringify({planHash:'x',diffHash:'wrong',verdict:'approve',findings:[]});
  if(mode==='unowned')host.ownsPrompt=async()=>false;
  await assert.rejects(saveReviewerReply(repo,host as never,input));assert.equal((await repo.get('run')).state,'reviewing');
 }
});
