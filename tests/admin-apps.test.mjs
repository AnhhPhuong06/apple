import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import * as plist from 'plist';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';

const token='admin-app-management-test-password';
const headers={Authorization:'Bearer '+token};
async function ipa(info={}) {
  const zip=new yazl.ZipFile();
  zip.addBuffer(Buffer.from(plist.build({CFBundleIdentifier:'com.example.published',CFBundleDisplayName:'Published App',CFBundleShortVersionString:'2.3',CFBundleVersion:'31',MinimumOSVersion:'15.0',...info})),'Payload/App.app/Info.plist');
  zip.addBuffer(Buffer.from('unchanged application bytes'),'Payload/App.app/App');
  zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);return Buffer.concat(chunks);
}
function form(bytes,filename='app.ipa') {const data=new FormData();data.append('ipa',new Blob([bytes]),filename);data.append('description','My published app');return data;}
async function listen(options) {const {app}=await createApp(options);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {server,base:'http://127.0.0.1:'+server.address().port};}
const close=server=>new Promise(resolve=>server.close(resolve));

test('admin publishes an IPA without a signer, preserves its bytes, persists it, and deletes exactly one app',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-admin-apps-'));
  const options={dataDir,token,baseURL:'https://apps.example.test',binary:path.join(dataDir,'no-signer')};
  let fixture=await listen(options);
  try {
    let {base}=fixture;
    assert.equal((await (await fetch(base+'/api/health',{headers})).json()).signerReady,false);
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST'})).status,401);
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
    const bytes=await ipa();
    const data=form(bytes);data.append('category','Năng suất');data.append('developer','My Studio');
    const image=await sharp({create:{width:64,height:80,channels:3,background:'blue'}}).jpeg().toBuffer();data.append('icon',new Blob([image]),'icon.jpg');data.append('screenshots',new Blob([image]),'screen.jpg');
    const response=await fetch(base+'/api/admin/apps',{method:'POST',headers,body:data});
    assert.equal(response.status,201,await response.clone().text());
    const first=await response.json();
    assert.equal(first.name,'Published App');assert.equal(first.otaReady,true);
    const metadata=await (await fetch(base+'/api/apps/'+first.id)).json();
    assert.equal(metadata.version,'2.3');assert.equal(metadata.buildVersion,'31');assert.equal(metadata.minimumIOS,'15.0');assert.equal(metadata.description,'My published app');assert.equal(metadata.category,'Năng suất');assert.equal(metadata.developer,'My Studio');
    assert.deepEqual(Buffer.from(await (await fetch(base+`/files/${first.id}/app.ipa`)).arrayBuffer()),bytes);
    const manifest=plist.parse(await (await fetch(base+`/files/${first.id}/manifest.plist`)).text());
    assert.equal(manifest.items[0].metadata['bundle-version'],'31');
    assert.equal(manifest.items[0].assets[0].url,`https://apps.example.test/files/${first.id}/app.ipa`);
    assert.equal((await fetch(base+`/files/${first.id}/icon.png`)).status,200);assert.equal((await fetch(base+`/files/${first.id}/preview-0.jpg`)).status,200);
    const secondResponse=await fetch(base+'/api/admin/apps',{method:'POST',headers,body:form(await ipa({CFBundleDisplayName:'Other App'}))});assert.equal(secondResponse.status,201);const second=await secondResponse.json();
    assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
    await close(fixture.server);fixture=await listen(options);base=fixture.base;
    assert.equal((await (await fetch(base+'/api/apps')).json()).apps.length,2);
    assert.equal((await fetch(base+'/api/admin/apps/'+first.id,{method:'DELETE'})).status,401);
    assert.equal((await fetch(base+'/api/admin/apps/'+first.id,{method:'DELETE',headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await fetch(base+'/api/admin/apps/not-an-id',{method:'DELETE',headers})).status,404);
    assert.equal((await fetch(base+'/api/admin/apps/'+first.id,{method:'DELETE',headers})).status,200);
    for(const url of ['/api/apps/'+first.id,`/files/${first.id}/app.ipa`,`/files/${first.id}/manifest.plist`,`/files/${first.id}/icon.png`,`/files/${first.id}/preview-0.jpg`])assert.equal((await fetch(base+url)).status,404,url);
    assert.equal((await fetch(base+'/api/apps/'+second.id)).status,200);
    assert.deepEqual((await (await fetch(base+'/api/apps')).json()).apps.map(app=>app.id),[second.id]);
    assert.deepEqual(await readdir(path.join(dataDir,'published')),[second.id]);assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
    assert.equal(JSON.parse(await readFile(path.join(dataDir,'deleted-apps',first.id+'.json'),'utf8')).id,first.id);
    assert.equal((await fetch(base+'/api/admin/apps/'+first.id,{method:'DELETE',headers})).status,404);
    const adminList=await fetch(base+'/api/admin/apps',{headers});assert.match(adminList.headers.get('cache-control'),/no-store/);assert.equal((await adminList.json()).apps.length,1);
    assert.equal(JSON.parse(await readFile(path.join(dataDir,'published',second.id,'app.json'),'utf8')).name,'Other App');
  } finally {await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});

test('publish rejects invalid uploads and protects upload/deletion with cookie authentication and CSRF checks',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-admin-invalid-'));
  const fixture=await listen({dataDir,token,baseURL:'',signer:async()=>{throw Error('Publishing must never invoke the signer');}});
  const {base}=fixture;
  try {
    const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:token})});
    const Cookie=login.headers.get('set-cookie').split(';')[0];
    const bytes=await ipa();
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers:{Cookie},body:form(bytes)})).status,403);
    for(const invalid of [new FormData(),form(bytes,'app.apk'),form(Buffer.from('not an IPA')),form(await ipa({CFBundleVersion:undefined}))])assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:invalid})).status,400);
    const rewrite=form(bytes);rewrite.append('name','Change the signed name');assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:rewrite})).status,400);
    const withCertificate=form(bytes);withCertificate.append('p12',new Blob(['certificate']),'test.p12');assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:withCertificate})).status,400);
    const result=await fetch(base+'/api/admin/apps',{method:'POST',headers:{Cookie,'X-AppSpace-Admin':'1'},body:form(bytes)});assert.equal(result.status,201);const app=await result.json();assert.equal(app.otaReady,false);
    assert.equal((await fetch(base+'/api/admin/apps/'+app.id,{method:'DELETE',headers:{Cookie}})).status,403);
    assert.equal((await fetch(base+'/api/admin/apps/'+app.id,{method:'DELETE',headers:{Cookie,'X-AppSpace-Admin':'1'}})).status,200);
    assert.deepEqual(await readdir(path.join(dataDir,'published')),[]);assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
  } finally {await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});
