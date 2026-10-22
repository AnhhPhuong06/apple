import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import * as plist from 'plist';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {validateArchive,readAppInfo,manifestXML,signArguments} from '../server/signing.mjs';

const info={CFBundleIdentifier:'com.example.fixture',CFBundleName:'Fixture & App',CFBundleShortVersionString:'2.1',CFBundleVersion:'27',MinimumOSVersion:'15.0'};
async function zip(entries){const archive=new yazl.ZipFile();for(const [name,content,options] of entries)archive.addBuffer(Buffer.from(content),name,options);archive.end();const chunks=[];for await(const chunk of archive.outputStream)chunks.push(chunk);return Buffer.concat(chunks);}
const ipa=()=>zip([['Payload/Test.app/Info.plist',plist.build(info)],['Payload/Test.app/Test','fixture executable']]);
function form(bytes){const data=new FormData();data.append('ipa',new Blob([bytes]),'app.ipa');data.append('p12',new Blob(['certificate fixture']),'certificate.p12');data.append('profile',new Blob(['profile fixture']),'app.mobileprovision');data.append('password','test-password-never-publish');data.append('description','Custom description');return data;}
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));

test('reject unsafe archives, accept one app, and read actual build version',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'appspace-zip-'));try{
  const good=path.join(dir,'good.ipa');await writeFile(good,await ipa());await validateArchive(good);assert.equal((await readAppInfo(good)).CFBundleVersion,'27');
  const duplicate=path.join(dir,'two.ipa');await writeFile(duplicate,await zip([['Payload/A.app/Info.plist','a'],['Payload/B.app/Info.plist','b']]));await assert.rejects(validateArchive(duplicate),/đúng một/);
  const link=path.join(dir,'link.ipa');await writeFile(link,await zip([['Payload/A.app/Info.plist','a'],['Payload/A.app/link','../../secret',{mode:0o120777}]]));await assert.rejects(validateArchive(link),/liên kết/);
  const traversal=path.join(dir,'traversal.ipa');const bytes=await zip([['Payload/A.app/Info.plist','a'],['bad/file','x']]);await writeFile(traversal,Buffer.from(bytes.toString('latin1').replaceAll('bad/file','../filex'),'latin1'));await assert.rejects(validateArchive(traversal));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('signing API converts uploaded JPG/PNG icons and keeps JPG/PNG screenshots',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'appspace-image-api-'));const token='image-api-admin-token-123456789';let calls=0;
 const signer=async(args,work)=>{
  calls++;const iconPath=args[args.indexOf('-I')+1];const icon=await sharp(iconPath).metadata();assert.equal(icon.format,'png');assert.equal(icon.width,1024);assert.equal(icon.height,1024);
  await writeFile(path.join(work,'result','app.ipa'),await ipa());await writeFile(path.join(work,'metadata','metadata.json'),JSON.stringify({IconName:''}));
 };
 const {app}=await createApp({dataDir:dir,token,baseURL:'https://images.example.test',signer});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+token};
 const jpg=await sharp({create:{width:120,height:80,channels:3,background:'red'}}).jpeg().toBuffer();const png=await sharp({create:{width:80,height:120,channels:4,background:'blue'}}).png().toBuffer();
 try {
  for(const [ext,buffer] of [['JPG',jpg],['jpeg',jpg],['png',png]]) {
   const data=form(await ipa());data.append('icon',new Blob([buffer]),'icon.'+ext);data.append('screenshots',new Blob([jpg]),'screen.jpeg');data.append('screenshots',new Blob([png]),'screen.png');
   const response=await fetch(base+'/api/sign',{method:'POST',headers,body:data});assert.equal(response.status,202);const {id}=await response.json();let job;
   for(let i=0;i<200;i++){job=await (await fetch(base+'/api/jobs/'+id,{headers})).json();if(job.status!=='signing')break;await pause();}assert.equal(job.status,'complete',job.error);
   const record=await (await fetch(base+'/api/apps/'+id)).json();assert.match(record.iconImage,/\/icon\.png$/);assert.equal(record.screenshots.length,2);assert.match(record.screenshots[0],/\.jpg$/);assert.match(record.screenshots[1],/\.png$/);
   const output=Buffer.from(await (await fetch(base+`/files/${id}/icon.png`)).arrayBuffer());assert.equal((await sharp(output).metadata()).format,'png');
   for(let i=0;i<100&&(await readdir(path.join(dir,'private'))).length;i++)await pause();
  }
  const bad=form(await ipa());bad.append('icon',new Blob([Buffer.from([255,216,255,0])]),'bad.jpg');assert.equal((await fetch(base+'/api/sign',{method:'POST',headers,body:bad})).status,400);assert.equal(calls,3);assert.deepEqual(await readdir(path.join(dir,'private')),[]);
  const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});assert.equal((await fetch(base+'/api/health')).status,401);
 } finally {await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('manifest escapes values and signing options stay individual arguments',()=>{
 const xml=manifestXML({baseURL:'https://apps.example.test',id:'id',bundleId:'com.example.app',version:'27',name:'A & <B>'});const result=plist.parse(xml);assert.equal(result.items[0].metadata.title,'A & <B>');assert.equal(result.items[0].metadata['bundle-version'],'27');
 const args=signArguments({work:'/tmp/job',password:'a b & $(test)',settings:{name:'App name',bundleId:'com.example.app'},files:{p12:[{path:'cert.p12'}],profile:[{path:'profile.mobileprovision'}],ipa:[{path:'app.ipa'}]}});assert.equal(args[args.indexOf('-p')+1],'a b & $(test)');assert.equal(args[args.indexOf('-n')+1],'App name');
});

test('API publishes only completed results and cleans credentials on success and failure',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'appspace-service-'));const token='a-test-only-admin-token-123456789';let fail=false,calls=0;
 const signer=async(args,work)=>{calls++;if(fail)throw new Error('Fixture signing failure');await writeFile(path.join(work,'result','app.ipa'),await ipa());await writeFile(path.join(work,'metadata','metadata.json'),JSON.stringify({IconName:''}));};
 const {app}=await createApp({dataDir:dir,token,baseURL:'https://apps.example.test',signer});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port, headers={Authorization:'Bearer '+token};
 try{
  assert.equal((await fetch(base+'/api/sign',{method:'POST'})).status,401);
  assert.equal((await fetch(base+'/api/sign',{method:'POST',headers:{...headers,Origin:'https://evil.test'}})).status,403);
  assert.equal((await fetch(base+'/api/sign',{method:'POST',headers,body:new FormData()})).status,400);
  assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/server/app.mjs')).status,404);
  const response=await fetch(base+'/api/sign',{method:'POST',headers,body:form(await ipa())});assert.equal(response.status,202);const {id}=await response.json();
  let job;for(let i=0;i<100;i++){job=await (await fetch(base+'/api/jobs/'+id,{headers})).json();if(job.status!=='signing')break;await pause();}assert.equal(job.status,'complete');
  const record=await (await fetch(base+'/api/apps/'+id)).json();assert.equal(record.name,info.CFBundleName);assert.equal(record.version,'2.1');assert.equal(record.buildVersion,'27');assert.deepEqual(record.screenshots,[]);assert.equal(record.description,'Custom description');assert.equal(record.manifestUrl,`https://apps.example.test/files/${id}/manifest.plist`);
  const xml=await (await fetch(base+`/files/${id}/manifest.plist`)).text();assert.equal(plist.parse(xml).items[0].metadata['bundle-version'],'27');
  assert.equal((await fetch(base+`/files/${id}/app.ipa`)).status,200);assert.equal((await fetch(base+`/files/${id}/certificate.p12`)).status,404);assert.equal((await fetch(base+'/api/jobs/'+id)).status,401);
  for(let i=0;i<100&&(await readdir(path.join(dir,'private'))).length;i++)await pause();assert.deepEqual(await readdir(path.join(dir,'private')),[]);
  assert.ok(!(await readFile(path.join(dir,'published',id,'app.json'),'utf8')).includes('test-password'));
  fail=true;const failed=await (await fetch(base+'/api/sign',{method:'POST',headers,body:form(await ipa())})).json();
  for(let i=0;i<100;i++){job=await (await fetch(base+'/api/jobs/'+failed.id,{headers})).json();if(job.status!=='signing')break;await pause();}assert.equal(job.status,'failed');assert.equal((await fetch(base+'/api/apps/'+failed.id)).status,404);
  for(let i=0;i<100&&(await readdir(path.join(dir,'private'))).length;i++)await pause();assert.deepEqual(await readdir(path.join(dir,'private')),[]);assert.equal(calls,2);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
