import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortModelInventory } from '../src/model-sort.js';
const models = [{ providerID:'other',id:'a',name:'A' },{ providerID:'openrouter',id:'expensive',name:'Expensive' },{ providerID:'openrouter',id:'cheap',name:'Cheap' },{ providerID:'openrouter',id:'unknown',name:'Unknown' }];
const prices = [{id:'expensive',inputPerMillionUsd:'1.000000000002',outputPerMillionUsd:'1',dynamicRouter:false},{id:'cheap',inputPerMillionUsd:'1.000000000001',outputPerMillionUsd:'2',dynamicRouter:false},{id:'unknown',inputPerMillionUsd:'0',outputPerMillionUsd:'0',dynamicRouter:true}];
test('sorts exact base rates and places unknown providers and dynamic routes last without mutating selections', () => {
  assert.deepEqual(sortModelInventory(models,prices,'input').map(m=>m.id),['cheap','expensive','unknown','a']);
  assert.deepEqual(sortModelInventory(models,prices,'output').slice(0,2).map(m=>m.id),['expensive','cheap']);
  assert.equal(models[0].id,'a');
  assert.deepEqual(sortModelInventory(models,[],'provider').map(m=>m.id),['cheap','expensive','unknown','a']);
});
