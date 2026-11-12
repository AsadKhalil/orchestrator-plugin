import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchIntelligence } from '../src/artificial-analysis.js';
const model = (id:string,score:number|null) => ({id,slug:`slug-${id}`,name:`Model ${id}`,model_creator:{name:'Synthetic'},evaluations:{artificial_analysis_intelligence_index:score},secret:'must-not-leak'});
const page = (n:number,more:boolean,version=5) => ({tier:'free',intelligence_index_version:version,pagination:{page:n,has_more:more},data:[model(String(n),n===1?35:null)]});

test('fetches paginated user-keyed data without returning keys or extra fields',async()=>{
 const calls:string[]=[];const fake=(async(url:string|URL|Request,init?:RequestInit)=>{calls.push(String(url));assert.equal((init?.headers as Record<string,string>)['x-api-key'],'synthetic-key');assert.equal(init?.redirect,'error');return new Response(JSON.stringify(page(calls.length,calls.length===1)));}) as typeof fetch;
 const result=await fetchIntelligence('synthetic-key',fake);assert.equal(calls.length,2);assert.equal(result.indexVersion,5);assert.equal(result.entries[1].score,null);
 assert.equal(JSON.stringify(result).includes('synthetic-key'),false);assert.equal(JSON.stringify(result).includes('must-not-leak'),false);
});

test('rejects missing keys, failed pages, inconsistent versions and duplicate identities',async()=>{
 let calls=0;const never=(async()=>{calls++;return new Response('');}) as typeof fetch;
 await assert.rejects(fetchIntelligence(undefined,never),/key/i);assert.equal(calls,0);
 await assert.rejects(fetchIntelligence('key',async()=>new Response('',{status:429})),/failed/i);
 let n=0;await assert.rejects(fetchIntelligence('key',async()=>new Response(JSON.stringify(page(++n,n===1,n===1?5:6)))),/version/i);
 n=0;await assert.rejects(fetchIntelligence('key',async()=>{n++;return new Response(JSON.stringify({...page(n,n===1),data:[model('same',1)]}));}),/identity/i);
});

test('rejects missing or malformed scores instead of inventing zero',async()=>{
 const invalid=page(1,false);invalid.data[0].evaluations.artificial_analysis_intelligence_index=NaN;
 await assert.rejects(fetchIntelligence('key',async()=>new Response(JSON.stringify({...invalid,data:[{...invalid.data[0],evaluations:{}}]}))),/score/i);
});
