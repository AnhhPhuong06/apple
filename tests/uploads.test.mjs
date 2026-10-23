import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,writeFile,copyFile,readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import * as plist from 'plist';
import {createApp} from '../server/app.mjs';
import {uploadChunkSize} from '../server/uploads.mjs';

const token='chunk-upload-test-only-admin-password',headers={Authorization:'Bearer '+token},hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const close=server=>new Promise(resolve=>server.close(resolve));
async function listen(options){const {app}=await createApp(options),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {server,base:'http://127.0.0.1:'+server.address().port};}
async function ipa(large=false){const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(plist.build({CFBundleIdentifier:'com.example.chunks',CFBundleName:'Chunk Upload App',CFBundleShortVersionString:'1.0',CFBundleVersion:'1'})),'Payload/App.app/Info.plist');if(large)zip.addBuffer(randomBytes(uploadChunkSize*2+317),'Payload/App.app/App',{compress:false});zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);return Buffer.concat(chunks);}
const create=(base,bytes,extra={})=>fetch(base+'/api/admin/uploads',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({size:bytes.length,name:'app.ipa',fingerprint:hash(bytes),...extra})});
function chunk(base,id,index,bytes,extra={}){return fetch(base+`/api/admin/uploads/${id}/chunks/${index}`,{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','X-Chunk-SHA256':hash(bytes),...extra},body:bytes});}
function form(id){const body=new FormData();body.append('uploadId',id);return body;}

test('parallel out-of-order IPA ranges resume after restart, are private, and publish byte-for-byte without merging',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-chunks-')),options={dataDir,token,baseURL:'',binary:path.join(dataDir,'no-signer')};let fixture=await listen(options);
  try {
    let {base}=fixture;const bytes=await ipa(true),created=await create(base,bytes);assert.equal(created.status,201);const session=await created.json();assert.equal(session.chunkSize,uploadChunkSize);assert.equal(session.parallel,3);
    const parts=Array.from({length:Math.ceil(bytes.length/uploadChunkSize)},(_,index)=>bytes.subarray(index*uploadChunkSize,(index+1)*uploadChunkSize));assert.equal(parts.length,3);
    const responses=await Promise.all([2,0].map(index=>chunk(base,session.id,index,parts[index])));assert.deepEqual(responses.map(response=>response.status),[201,201]);
    assert.equal((await fetch(base+'/api/admin/uploads/'+session.id)).status,401);assert.equal((await fetch(base+`/data/uploads/${session.id}/app.ipa`)).status,404);
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:form(session.id)})).status,400);
    await close(fixture.server);fixture=await listen(options);base=fixture.base;
    const resumed=await (await create(base,bytes)).json();assert.equal(resumed.id,session.id);assert.deepEqual(resumed.received.map(part=>part.index).sort(),[0,2]);assert.deepEqual(resumed.received.map(part=>part.hash).sort(),[hash(parts[0]),hash(parts[2])].sort());
    assert.equal((await chunk(base,session.id,1,parts[1])).status,201);assert.equal((await chunk(base,session.id,1,parts[1])).status,200);
    const response=await fetch(base+'/api/admin/apps',{method:'POST',headers,body:form(session.id)});assert.equal(response.status,201,await response.clone().text());const app=await response.json();
    assert.deepEqual(Buffer.from(await (await fetch(base+`/files/${app.id}/app.ipa`)).arrayBuffer()),bytes);assert.equal((await fetch(base+'/api/admin/uploads/'+session.id,{headers})).status,404);assert.deepEqual(await readdir(path.join(dataDir,'uploads')),[]);assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
  }finally{await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});

test('chunk validation, failed publication, quotas, expiry and cookie CSRF cannot bypass authenticated upload checks',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-chunk-errors-')),options={dataDir,token,baseURL:'',binary:path.join(dataDir,'no-signer')};let fixture=await listen(options);
  try {
    const {base}=fixture,bytes=await ipa();
    assert.equal((await create(base,bytes,{size:513*1024**2})).status,400);assert.equal((await create(base,bytes,{name:'app.exe'})).status,400);
    assert.equal((await fetch(base+'/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:token})}),Cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+'/api/admin/uploads',{method:'POST',headers:{Cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
    const session=await (await create(base,bytes)).json();
    assert.equal((await chunk(base,session.id,0,bytes,{'X-Chunk-SHA256':'0'.repeat(64)})).status,400);assert.deepEqual((await (await fetch(base+'/api/admin/uploads/'+session.id,{headers})).json()).received,[]);
    assert.equal((await chunk(base,session.id,0,bytes.subarray(1))).status,400);assert.equal((await chunk(base,session.id,99,bytes)).status,400);
    assert.equal((await fetch(base+`/api/admin/uploads/${session.id}/chunks/0`,{method:'PUT',headers:{Cookie,'Content-Type':'application/octet-stream','X-Chunk-SHA256':hash(bytes)},body:bytes})).status,403);
    assert.equal((await chunk(base,session.id,0,bytes)).status,201);
    const invalid=form(session.id);invalid.append('name','Cannot edit signed IPA');assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:invalid})).status,400);
    assert.equal((await fetch(base+'/api/admin/uploads/'+session.id,{headers})).status,200);assert.deepEqual(await readFile(path.join(dataDir,'uploads',session.id,'app.ipa')),bytes);
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:form(session.id)})).status,201);
    const sessions=[];for(let i=0;i<4;i++){const response=await create(base,bytes,{fingerprint:hash('session-'+i)});assert.equal(response.status,201);sessions.push(await response.json());}
    assert.equal((await create(base,bytes,{fingerprint:hash('quota-full')})).status,429);
    assert.equal((await fetch(base+'/api/admin/uploads/'+sessions[0].id,{method:'DELETE',headers:{Cookie}})).status,403);
    assert.equal((await fetch(base+'/api/admin/uploads/'+sessions[0].id,{method:'DELETE',headers})).status,200);assert.equal((await create(base,bytes,{fingerprint:hash('quota-free')})).status,201);
    const expired=path.join(dataDir,'uploads',sessions[1].id,'session.json'),record=JSON.parse(await readFile(expired,'utf8'));record.expiresAt=Date.now()-1;await writeFile(expired,JSON.stringify(record));
    await close(fixture.server);fixture=await listen(options);assert.equal((await fetch(fixture.base+'/api/admin/uploads/'+sessions[1].id,{headers})).status,404);assert.ok(!(await readdir(path.join(dataDir,'uploads'))).includes(sessions[1].id));
  }finally{await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});

test('failed signing releases the cached IPA so retry signs it without another transfer',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-chunk-sign-'));let fail=true;
  const signer=async(args,work)=>{if(fail)throw Error('Test signer failure');await copyFile(args.at(-1),path.join(work,'result','app.ipa'));await writeFile(path.join(work,'metadata','metadata.json'),'{}');};
  const fixture=await listen({dataDir,token,baseURL:'',signer}),{base}=fixture;
  try {
    const bytes=await ipa(),session=await (await create(base,bytes)).json();assert.equal((await chunk(base,session.id,0,bytes)).status,201);
    for(const expected of ['failed','complete']) {
      const body=form(session.id);body.append('p12',new Blob(['test certificate']),'cert.p12');body.append('profile',new Blob(['test profile']),'test.mobileprovision');body.append('password','test');
      const response=await fetch(base+'/api/sign',{method:'POST',headers,body});assert.equal(response.status,202,await response.clone().text());const job=await response.json();let state;
      for(let i=0;i<100;i++){state=await (await fetch(base+'/api/jobs/'+job.id,{headers})).json();if(state.status!=='signing')break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(state.status,expected,state.error);
      for(let i=0;i<100&&(await readdir(path.join(dataDir,'private'))).length;i++)await new Promise(resolve=>setTimeout(resolve,20));
      if(expected==='failed')assert.equal((await fetch(base+'/api/admin/uploads/'+session.id,{headers})).status,200);else assert.equal((await fetch(base+'/api/admin/uploads/'+session.id,{headers})).status,404);
      fail=false;
    }
  }finally{await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});
