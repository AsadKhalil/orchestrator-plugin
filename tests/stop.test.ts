import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRepository } from '../src/run-store.js';
import { requestRunStop } from '../src/stop.js';
import { step, criterion } from './fixtures/plan-data.js';

async function setup() {
 const data=new Map<string,unknown>(),store={async get(k:string){return data.get(k);},async set(k:string,v:string){data.set(k,v);}};
 const repo=new RunRepository({async get(k){return structuredClone(data.get(k));},async set(k,v){data.set(k,structuredClone(v));}});
 let run=await repo.create('r','Feature','base');const action={...step('Test','test'),taskKind:'validate' as const,inference:false,execution:{kind:'command' as const,command:'test',deadlineMs:1000,readyProbe:null}};
 run=await repo.setPlan('r',run.revision,{steps:[action],acceptance:[criterion('Works')],questions:[],areas:['src'],rollback:'revert',validationCommands:['test']});run=await repo.approve('r',run.revision,run.planHash!);run=await repo.begin('r',run.revision);
 run=await repo.recordJobIntent('r',run.revision,'test',{id:'job',sessionID:'ses_job',contentVersion:'v1',now:1000});
 run=await repo.recordJobHandle('r',run.revision,'job',{output:{status:'running',shellID:'sh_1'},metadata:{status:'running',shellID:'sh_1'}});
 await store.set('planner-turn/r',JSON.stringify({runID:'r',revision:0,phase:'submitted',sessionID:'ses_planner',promptID:'msg_x'}));
 return {repo,store,run};
}

test('records stop before interrupting only owned sessions and never claims process cleanup',async()=>{
 const {repo,store,run}=await setup(),calls:string[]=[];
 const host={async ownsSession(id:string){return id==='ses_job';},async interrupt(id:string){assert.equal((await repo.get('r')).stopRequested,true);calls.push(id);return {interrupted:true};}};
 const result=await requestRunStop(repo,host as never,store,'r',run.revision);
 assert.deepEqual(calls,['ses_job']);assert.equal(result.run.stopRequested,true);assert.equal(result.processCleanup,'unverified');
 assert.deepEqual(result.interruptions.map(item=>item.status),['requested','not_owned']);assert.equal(result.run.jobs[0].status,'running');
});

test('keeps stop durable if ownership checks or checkpoint reads fail',async()=>{
 const {repo,store,run}=await setup();const host={async ownsSession(){throw Error('offline');},async interrupt(){throw Error('must not call');}};
 const result=await requestRunStop(repo,host as never,{async get(){throw Error('offline');}},'r',run.revision);
 assert.equal(result.run.stopRequested,true);assert.equal(result.checkpoint,'unavailable');assert.equal(result.interruptions[0].status,'unavailable');
 assert.equal((await repo.get('r')).stopRequested,true);
});

test('requests shell stop only for a recorded job in an owned session',async()=>{
 const {repo,store,run}=await setup(),calls:unknown[]=[];
 const host={async ownsSession(id:string){return id==='ses_job';},async interrupt(){return {interrupted:false};}};
 const shell={async stop(input:{id:string;sessionID:string}){assert.equal((await repo.get('r')).stopRequested,true);calls.push(input);return {data:{status:'killed'}};}};
 const result=await requestRunStop(repo,host as never,store,'r',run.revision,shell);
 assert.deepEqual(calls,[{id:'sh_1',sessionID:'ses_job'}]);assert.deepEqual(result.shells,[{jobID:'job',status:'stopped'}]);
 assert.equal(result.processCleanup,'unverified');assert.equal(result.run.jobs[0].status,'running');
});

test('does not request shell stop when the owning session is unverified',async()=>{
 const {repo,store,run}=await setup();let called=false;
 const host={async ownsSession(){return false;},async interrupt(){throw Error('unexpected');}};
 const result=await requestRunStop(repo,host as never,store,'r',run.revision,{async stop(){called=true;return {data:{status:'killed'}};}});
 assert.equal(called,false);assert.deepEqual(result.shells,[{jobID:'job',status:'not_owned'}]);
});
