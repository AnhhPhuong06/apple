import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import * as plist from 'plist';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {appSnapshot} from '../server/app-revisions.mjs';

const token='app-update-integration-test-password',headers={Authorization:'Bearer '+token};
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
async function ipa(version='1.0',build='10',bundle='com.example.update') {
  const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(plist.build({CFBundleName:'Update App',CFBundleIdentifier:bundle,CFBundleShortVersionString:version,CFBundleVersion:build})),'Payload/App.app/Info.plist');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);return Buffer.concat(chunks);
}
function upload(bytes,target) {const body=new FormData();body.append('ipa',new Blob([bytes]),'app.ipa');if(target)body.append('targetAppId',target);return body;}
async function listen(options) {const {app}=await createApp(options),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {server,base:'http://127.0.0.1:'+server.address().port};}
const close=server=>new Promise(resolve=>server.close(resolve));
async function jobState(base,id) {for(let i=0;i<200;i++){const state=await (await fetch(base+'/api/jobs/'+id,{headers})).json();if(state.status!=='signing')return state;await pause();}throw Error('Signing timed out');}

test('pre-signed updates keep app ID/link and images, reject wrong or older IPAs, and survive restart without partial publication',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-update-')),options={dataDir,token,baseURL:'https://apps.example.test',binary:path.join(dataDir,'no-signer')};let fixture=await listen(options);
  try {
    let {base}=fixture;
    const initial=upload(await ipa());initial.append('description','Keep this description');initial.append('developer','Original Studio');initial.append('category','Giải trí');
    const image=await sharp({create:{width:40,height:50,channels:3,background:'green'}}).png().toBuffer();initial.append('icon',new Blob([image]),'icon.png');initial.append('screenshots',new Blob([image]),'preview.png');
    const created=await fetch(base+'/api/admin/apps',{method:'POST',headers,body:initial});assert.equal(created.status,201);const app=await created.json(),id=app.id;
    const original=await (await fetch(base+'/api/apps/'+id)).json();
    const bytes=await ipa('1.1','1'),body=upload(bytes,id);body.append('releaseNotes','New features\nFixes');
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',body:upload(bytes,id)})).status,401);
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:upload(bytes,id)})).status,403);
    const response=await fetch(base+'/api/admin/apps',{method:'POST',headers,body});assert.equal(response.status,201,await response.clone().text());const updated=await response.json();
    assert.equal(updated.id,id);assert.equal(updated.appId,id);assert.equal(updated.updated,true);assert.equal(updated.installUrl,app.installUrl);
    let record=await (await fetch(base+'/api/apps/'+id)).json();assert.equal(record.version,'1.1');assert.equal(record.buildVersion,'1');assert.equal(record.createdAt,original.createdAt);assert.ok(record.updatedAt>=original.createdAt);assert.equal(record.description,original.description);assert.equal(record.developer,original.developer);assert.equal(record.category,original.category);assert.deepEqual(record.releaseNotes,['New features','Fixes']);
    const local=url=>base+new URL(url).pathname+new URL(url).search;
    assert.deepEqual(Buffer.from(await (await fetch(local(record.file))).arrayBuffer()),bytes);assert.equal((await fetch(local(record.iconImage))).status,200);assert.equal((await fetch(local(record.screenshots[0]))).status,200);
    const manifest=plist.parse(await (await fetch(local(record.manifestUrl))).text());assert.equal(manifest.items[0].metadata['bundle-version'],'1');assert.equal(manifest.items[0].assets[0].url,record.file);
    const firstRevision=record.file;
    for(const invalid of [await ipa('1.1','1'),await ipa('1.0','999'),await ipa('1.2','1','com.other.app'),Buffer.from('bad zip')]) {
      const rejected=await fetch(base+'/api/admin/apps',{method:'POST',headers,body:upload(invalid,id)});assert.equal(rejected.status,400,await rejected.clone().text());assert.deepEqual(await (await fetch(base+'/api/apps/'+id)).json(),record);
    }
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:upload(bytes,'../../private')})).status,400);
    // Same marketing version with a higher build is also a valid update.
    const newer=await ipa('1.1','2');assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:upload(newer,id)})).status,201);
    assert.deepEqual(Buffer.from(await (await fetch(local(firstRevision))).arrayBuffer()),bytes);
    assert.deepEqual(Buffer.from(await (await fetch(base+`/files/${id}/app.ipa`)).arrayBuffer()),newer);
    assert.equal((await fetch(base+`/files/${id}/app.ipa?revision=../../private`)).status,404);
    const list=(await (await fetch(base+'/api/apps')).json()).apps;assert.equal(list.length,1);assert.equal(list[0].id,id);assert.equal(list[0].buildVersion,'2');assert.ok(list[0].updatedAt);
    const snapshot=await appSnapshot(path.join(dataDir,'published'),id);assert.deepEqual(await readFile(path.join(snapshot.files,'app.ipa')),newer);
    // Simulate an interrupted staging operation: no metadata pointer means no publication.
    const orphan='00000000-0000-4000-8000-000000000001';await mkdir(path.join(dataDir,'published',id,'revisions',orphan));await writeFile(path.join(dataDir,'published',id,'revisions',orphan,'app.ipa'),'incomplete');
    await close(fixture.server);fixture=await listen(options);base=fixture.base;
    record=await (await fetch(base+'/api/apps/'+id)).json();assert.equal(record.buildVersion,'2');assert.deepEqual(Buffer.from(await (await fetch(base+`/files/${id}/app.ipa`)).arrayBuffer()),newer);
    assert.equal((await fetch(base+`/files/${id}/app.ipa?revision=${orphan}`)).status,404);
    assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
    assert.equal((await fetch(base+'/api/admin/apps/'+id,{method:'DELETE',headers})).status,200);assert.equal((await fetch(local(firstRevision))).status,404);assert.deepEqual(await readdir(path.join(dataDir,'published')),[]);
  }finally{await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});

test('signed update keeps old app available while signing, blocks deletion, and preserves it on signer or metadata failure',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-signed-update-'));let release,fail=false,output=await ipa('2.0','20');
  const signer=async(args,work)=>{await new Promise(resolve=>{release=resolve;});if(fail)throw Error('Test signer failed');await writeFile(path.join(work,'result','app.ipa'),output);await writeFile(path.join(work,'metadata','metadata.json'),'{}');};
  const fixture=await listen({dataDir,token,baseURL:'https://apps.example.test',signer}),{base}=fixture;
  try {
    const oldBytes=await ipa(),created=await (await fetch(base+'/api/admin/apps',{method:'POST',headers,body:upload(oldBytes)})).json();
    const sign=async()=>{const body=upload(await ipa('2.0','20'),created.id);body.append('p12',new Blob(['fixture']),'cert.p12');body.append('profile',new Blob(['fixture']),'profile.mobileprovision');body.append('password','test-only');const result=await fetch(base+'/api/sign',{method:'POST',headers,body});assert.equal(result.status,202,await result.clone().text());return result.json();};
    for(const failure of ['signer','bundle','success']) {
      fail=failure==='signer';output=await ipa('2.0','20',failure==='bundle'?'com.other.app':'com.example.update');release=null;
      const job=await sign();for(let i=0;i<100&&!release;i++)await pause();assert.ok(release);
      assert.notEqual(job.id,created.id);assert.equal((await fetch(base+'/api/admin/apps/'+created.id,{method:'DELETE',headers})).status,409);
      assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:upload(output,created.id)})).status,429);
      assert.deepEqual(Buffer.from(await (await fetch(base+`/files/${created.id}/app.ipa`)).arrayBuffer()),oldBytes);
      release();const state=await jobState(base,job.id);
      if(failure==='success'){assert.equal(state.status,'complete',state.error);assert.equal(state.id,job.id);assert.equal(state.appId,created.id);assert.equal(state.installUrl,created.installUrl);assert.equal((await (await fetch(base+'/api/apps/'+created.id)).json()).version,'2.0');}
      else{assert.equal(state.status,'failed');assert.equal((await (await fetch(base+'/api/apps/'+created.id)).json()).version,'1.0');}
      for(let i=0;i<100&&(await readdir(path.join(dataDir,'private'))).length;i++)await pause();
    }
    assert.equal((await (await fetch(base+'/api/apps')).json()).apps.length,1);assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
  }finally{release?.();await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});
