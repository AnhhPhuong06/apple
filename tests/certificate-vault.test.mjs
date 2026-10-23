import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import yazl from 'yazl';
import * as plist from 'plist';
import {createApp} from '../server/app.mjs';
import {inspectIdentity} from '../server/certificate-check.mjs';
import {createCertificateVault} from '../server/certificate-vault.mjs';
import {certificateFixture} from './certificate-fixture.mjs';

const token='certificate-vault-integration-test-password';
async function makeIPA(build='4'){const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(plist.build({CFBundleIdentifier:'com.example.savedapp',CFBundleName:'Saved Certificate App',CFBundleVersion:build,CFBundleShortVersionString:'1.0'})),'Payload/App.app/Info.plist');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);return Buffer.concat(chunks);}
async function listen(options){const {app}=await createApp(options);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {server,base:'http://127.0.0.1:'+server.address().port};}
const close=server=>new Promise(resolve=>server.close(resolve));
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));

test('encrypted certificate vault supports reuse, checks, private access, restart and deletion without affecting apps',async()=>{
  const f=await certificateFixture(),dataDir=path.join(f.dir,'service-data');let revocation='unknown',signerCalls=0;
  const inspector=async options=>{const result=await inspectIdentity({...options,online:false});if(revocation!=='unknown')result.revocation={status:revocation,checkedAt:Date.now(),nextUpdate:Date.now()+600000,reason:'Verified test responder'};return result;};
  const signer=async(args,work)=>{signerCalls++;assert.equal(args[args.indexOf('-p')+1],f.password);assert.deepEqual(await readFile(args[args.indexOf('-k')+1]),await readFile(f.p12));assert.deepEqual(await readFile(args[args.indexOf('-m')+1]),await readFile(f.profilePath));await writeFile(path.join(work,'result','app.ipa'),await makeIPA(String(3+signerCalls)));await writeFile(path.join(work,'metadata','metadata.json'),'{}');};
  const options={dataDir,token,baseURL:'',certificatePolicy:f.policy,certificateInspector:inspector,signer};let fixture=await listen(options);
  const headers={Authorization:'Bearer '+token};
  async function upload(profile=f.profilePath,extraHeaders=headers){const body=new FormData();body.append('label','My encrypted signing identity');body.append('password',f.password);body.append('p12',new Blob([await readFile(f.p12)]),'identity.p12');body.append('profile',new Blob([await readFile(profile)]),'profile.mobileprovision');return fetch(fixture.base+'/api/admin/certificates',{method:'POST',headers:extraHeaders,body});}
  async function sign(id,extra={}){const data=new FormData();data.append('ipa',new Blob([await makeIPA()]),'app.ipa');data.append('certificateId',id);for(const [key,value] of Object.entries(extra))data.append(key,value);return fetch(fixture.base+'/api/sign',{method:'POST',headers,body:data});}
  try{
    assert.equal((await fetch(fixture.base+'/api/admin/certificates')).status,401);assert.equal((await upload(f.profilePath,{})).status,401);assert.equal((await upload(f.profilePath,{...headers,Origin:'https://evil.test'})).status,403);
    const savedResponse=await upload();assert.equal(savedResponse.status,201,await savedResponse.clone().text());const saved=await savedResponse.json();assert.equal(saved.status,'unknown');assert.equal(saved.usable,true);assert.equal(saved.teamId,'TEAM123');
    const list=await fetch(fixture.base+'/api/admin/certificates',{headers});assert.match(list.headers.get('cache-control'),/no-store/);const text=await list.text();assert.ok(!text.includes(f.password));const certs=JSON.parse(text).certificates;assert.equal(certs.length,1);for(const key of ['p12','profile','password','privateKey'])assert.equal(Object.hasOwn(certs[0],key),false);
    const vaultFile=path.join(dataDir,'certificates',saved.id+'.vault'),ciphertext=await readFile(vaultFile,'utf8');assert.ok(!ciphertext.includes(f.password));assert.ok(!ciphertext.includes('My encrypted signing identity'));assert.equal(JSON.parse(ciphertext).version,1);
    if(process.platform!=='win32')assert.equal((await stat(path.join(dataDir,'certificate-vault.key'))).mode & 0o777,0o600);
    for(const url of ['/data/certificate-vault.key',`/data/certificates/${saved.id}.vault`,`/api/admin/certificates/${saved.id}/download`,`/files/${saved.id}/identity.p12`])assert.equal((await fetch(fixture.base+url,{headers})).status,404,url);
    const signed=await sign(saved.id);assert.equal(signed.status,202);const job=await signed.json();let state;
    for(let i=0;i<100;i++){state=await (await fetch(fixture.base+'/api/jobs/'+job.id,{headers})).json();if(state.status!=='signing')break;await pause();}assert.equal(state.status,'complete',state.error);assert.equal(signerCalls,1);
    for(let i=0;i<100&&(await readdir(path.join(dataDir,'private'))).length;i++)await pause();assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
    const mismatch=await sign(saved.id,{bundleId:'com.other.app'});assert.equal(mismatch.status,400);assert.equal(signerCalls,1);
    const expired=await upload(await f.profile({ExpirationDate:new Date(Date.now()-86400000)}));assert.equal(expired.status,201);const expiredRecord=await expired.json();assert.equal(expiredRecord.status,'expired');assert.equal((await sign(expiredRecord.id)).status,400);
    revocation='revoked';const checked=await fetch(fixture.base+`/api/admin/certificates/${saved.id}/check`,{method:'POST',headers});assert.equal(checked.status,200);assert.equal((await checked.json()).status,'revoked');assert.equal((await sign(saved.id)).status,400);assert.equal(signerCalls,1);
    revocation='good';const refreshed=await (await fetch(fixture.base+`/api/admin/certificates/${saved.id}/check`,{method:'POST',headers})).json();assert.equal(refreshed.status,'good');assert.equal(refreshed.usable,true);
    const updated=await sign(saved.id,{targetAppId:job.id});assert.equal(updated.status,202);const updateJob=await updated.json();assert.notEqual(updateJob.id,job.id);
    for(let i=0;i<100;i++){state=await (await fetch(fixture.base+'/api/jobs/'+updateJob.id,{headers})).json();if(state.status!=='signing')break;await pause();}assert.equal(state.status,'complete',state.error);assert.equal(state.appId,job.id);assert.equal(state.updated,true);assert.equal(signerCalls,2);
    assert.equal((await (await fetch(fixture.base+'/api/apps/'+job.id)).json()).buildVersion,'5');assert.equal((await (await fetch(fixture.base+'/api/apps')).json()).apps.length,1);
    const login=await fetch(fixture.base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:token})});const Cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(fixture.base+`/api/admin/certificates/${saved.id}/check`,{method:'POST',headers:{Cookie}})).status,403);assert.equal((await fetch(fixture.base+`/api/admin/certificates/${saved.id}`,{method:'DELETE',headers:{Cookie}})).status,403);
    const keyBefore=await readFile(path.join(dataDir,'certificate-vault.key'));await close(fixture.server);fixture=await listen({...options,token:token+'-changed'});
    const changedHeaders={Authorization:'Bearer '+token+'-changed'};const persisted=await (await fetch(fixture.base+'/api/admin/certificates',{headers:changedHeaders})).json();assert.equal(persisted.certificates.length,2);assert.deepEqual(await readFile(path.join(dataDir,'certificate-vault.key')),keyBefore);
    const deleted=await fetch(fixture.base+`/api/admin/certificates/${saved.id}`,{method:'DELETE',headers:changedHeaders});assert.equal(deleted.status,200);assert.equal((await fetch(fixture.base+`/api/admin/certificates/${saved.id}/check`,{method:'POST',headers:changedHeaders})).status,404);assert.equal((await fetch(fixture.base+'/api/apps/'+job.id)).status,200);
    assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
    const vault=await createCertificateVault({data:dataDir,privateRoot:path.join(dataDir,'private'),inspector,policy:f.policy});
    const remaining=path.join(dataDir,'certificates',expiredRecord.id+'.vault');const original=await readFile(remaining,'utf8');const envelope=JSON.parse(original);const bytes=Buffer.from(envelope.ciphertext,'base64');bytes[0]^=1;envelope.ciphertext=bytes.toString('base64');await writeFile(remaining,JSON.stringify(envelope));await assert.rejects(vault.list(),/mã hóa/);await writeFile(remaining,original);
  }finally{await close(fixture.server);await f.close();}
});
