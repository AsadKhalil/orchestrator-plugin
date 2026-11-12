import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportRunPreview } from '../src/delivery.js';
import { newRun, setPlan, approvePlan, beginImplementation, recordStepOutcome, startReview, recordReview } from '../src/run.js';
import { step, criterion } from './fixtures/plan-data.js';

test('exports saved artifacts while omitting unrelated fields and labelling unknowns', () => {
  let run=newRun('run','Feature','base'); run=setPlan(run,run.revision,{steps:[step('Implement')],acceptance:[criterion('Works')],questions:[],areas:['src'],rollback:'revert',validationCommands:['test']});
  run=approvePlan(run,run.revision,run.planHash!);run=beginImplementation(run,run.revision);run=recordStepOutcome(run,run.revision,{stepID:'implement',inputContentVersion:'base',contentVersion:'diff',evidence:'do-not-export-private-outcome'});
  run=startReview(run,run.revision,{planHash:run.planHash!,diffHash:'diff',validation:{diffHash:'diff',commands:[{command:'test',exitCode:0}]},reviewer:{providerID:'p',id:'m',variant:null,vendor:'review',modelVersion:'v1'},contributingVendors:['coder'],budgetAvailable:true});
  run=recordReview(run,run.revision,{planHash:run.planHash!,diffHash:'diff',verdict:'approve',findings:[]});
  (run as any).apiKey='secret-top-level';(run.approval as any).apiKey='secret-approval';(run.review!.reviewer as any).apiKey='secret-reviewer';(run.review!.reviews[0] as any).apiKey='secret-review';(run.review!.reviews[0].validation.commands[0] as any).apiKey='secret-command';
  const raw=exportRunPreview(run), report=JSON.parse(raw);
  assert.equal(report.requirement,'Feature');assert.equal(report.planHash,run.planHash);assert.equal(report.review.reviews[0].verdict,'approve');
  assert.match(report.limitations.costs,/unavailable/i);assert.match(report.limitations.diff,/not included/i);
  assert.equal(raw.includes('secret-'),false);assert.equal(raw.includes('do-not-export-private-outcome'),false);
});

test('rejects corrupted run records instead of producing a misleading export',()=>{
  const run=newRun('r','Feature','base');(run as any).stopRequested='no';assert.throws(()=>exportRunPreview(run),/invalid/i);
});
