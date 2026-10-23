import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context={window:{}};
vm.runInNewContext(await readFile(new URL('../app-data.js',import.meta.url),'utf8'),context);
const resolve=context.window.AppDetails.resolve;
const sample={id:'sample',name:'Sample app',sample:true};
const first={id:'first',name:'First app'},second={id:'second',name:'Second app'};

test('both job and app links select only the requested record, without relying on generated flag',async()=>{
 for(const param of ['job','app'])for(const app of [first,second]) {
  const result=await resolve(new URLSearchParams({[param]:app.id}),[sample,first,second],()=>{throw Error('Must not request API');});assert.equal(result,app);
 }
});

test('IDs missing from the catalog load the same ID from the server for either link format',async()=>{
 for(const param of ['job','app']) {
  const calls=[];const result=await resolve(new URLSearchParams({[param]:'server-app'}),[sample,first],async id=>{calls.push(id);return {id,name:'Server app'};});
  assert.equal(result.name,'Server app');assert.deepEqual(calls,['server-app']);
 }
});

test('missing, invalid, conflicting or unknown app links never fall back to another app',async()=>{
 for(const query of ['', 'app=', 'job=', 'job=first&app=second', 'app=..%2Fsecret'])await assert.rejects(resolve(new URLSearchParams(query),[sample,first],()=>{throw Error('No request allowed');}));
 for(const response of [null,{},sample,{id:'unknown',name:''},{id:'unknown',name:'   '}])await assert.rejects(resolve(new URLSearchParams('app=unknown'),[sample,first],async()=>response));
 await assert.rejects(resolve(new URLSearchParams('job=unknown'),[sample,first],async()=>{throw Error('Network failed');}));
 await assert.rejects(resolve(new URLSearchParams('app=unknown&demo=1'),[sample,first],async()=>{throw Error('Missing');}));
});

test('sample data is selected only by an explicit demo request or its own ID',async()=>{
 assert.equal(await resolve(new URLSearchParams('demo=1'),[first,sample],async()=>null),sample);
 assert.equal(await resolve(new URLSearchParams('app=sample'),[first,sample],async()=>null),sample);
 await assert.rejects(resolve(new URLSearchParams('demo=1'),[first],async()=>null));
});

test('generic detail HTML has no app-specific content or enabled install button before loading',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/Ngọc Rồng|Ngọc Rồng Hot Studio|assets\/app-icon\.png|assets\/preview-[1-3]\.jpg/);
 const installButtons=[...html.matchAll(/<button\b[^>]*data-install[^>]*>/g)];assert.equal(installButtons.length,2);assert.ok(installButtons.every(([tag])=>tag.includes('disabled')));
});
