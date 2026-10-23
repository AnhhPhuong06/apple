import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import * as plist from 'plist';
import {createApp} from '../server/app.mjs';
import {uploadOrigin} from '../server/config.mjs';

const token='direct-upload-test-only-admin-password',headers={Authorization:'Bearer '+token},origin='https://apps.example.test',uploadBase='https://upload.example.test';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const close=server=>new Promise(resolve=>server.close(resolve));
async function listen(options){const {app}=await createApp(options),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {server,base:'http://127.0.0.1:'+server.address().port};}
async function ipa(){const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(plist.build({CFBundleName:'Direct Upload App',CFBundleIdentifier:'com.example.direct',CFBundleShortVersionString:'1.0',CFBundleVersion:'1'})),'Payload/App.app/Info.plist');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);return Buffer.concat(chunks);}

test('direct upload configuration requires a separate HTTPS origin and leaves default uploads unchanged',async()=>{
 assert.equal(uploadOrigin(undefined,{}),'');assert.equal(uploadOrigin(undefined,{UPLOAD_BASE_URL:uploadBase}),uploadBase);
 for(const url of ['http://upload.test','https://user:pass@upload.test','https://upload.test/path','https://upload.test?x=1'])assert.throws(()=>uploadOrigin(url,{}));
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-direct-config-'));
 try {await assert.rejects(createApp({dataDir,token,baseURL:'',uploadBaseURL:uploadBase}),/PUBLIC_BASE_URL/);await assert.rejects(createApp({dataDir,token,baseURL:origin,uploadBaseURL:origin}),/riêng/);}finally{await rm(dataDir,{recursive:true,force:true});}
});

test('direct upload uses origin-bound, session-scoped expiring tickets and preserves resume and admin isolation',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-direct-')),options={dataDir,token,baseURL:origin,uploadBaseURL:uploadBase,binary:path.join(dataDir,'no-signer')};let fixture=await listen(options);
 try {
  let {base}=fixture;const bytes=await ipa();
  const create=extra=>fetch(base+'/api/admin/uploads',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'direct.ipa',size:bytes.length,fingerprint:hash(bytes),...extra})});
  const session=await (await create()).json();assert.equal(session.parallel,6);assert.equal(session.transport.origin,uploadBase);assert.equal(session.transport.url,`${uploadBase}/api/transfer/${session.id}/chunks`);assert.ok(session.transport.expiresAt<=Date.now()+3600000);assert.ok(!JSON.stringify(session).includes(token));
  const pathname=`/api/transfer/${session.id}/chunks/0`,chunkHeaders={Origin:origin,'Content-Type':'application/octet-stream','X-Chunk-SHA256':hash(bytes),'X-AppSpace-Upload-Ticket':session.transport.ticket};
  const put=(extra={})=>fetch(base+pathname,{method:'PUT',headers:{...chunkHeaders,...extra},body:bytes});
  assert.equal((await fetch(base+'/api/transfer/ping',{headers:{Origin:'https://evil.test'}})).status,403);
  const probe=await fetch(base+'/api/transfer/ping',{headers:{Origin:origin}});assert.equal(probe.status,200);assert.equal(probe.headers.get('access-control-allow-origin'),origin);assert.equal(probe.headers.get('access-control-allow-credentials'),null);
  const preflight=await fetch(base+pathname,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type,x-chunk-sha256,x-appspace-upload-ticket'}});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/X-AppSpace-Upload-Ticket/);assert.ok(!/X-AppSpace-Admin/i.test(preflight.headers.get('access-control-allow-headers')));
  assert.equal((await put({Origin:'https://evil.test'})).status,403);assert.equal((await put({'X-AppSpace-Upload-Ticket':''})).status,403);assert.equal((await put({'X-AppSpace-Upload-Ticket':session.transport.ticket.slice(0,-1)+(session.transport.ticket.endsWith('a')?'b':'a')})).status,403);
  assert.equal((await put({'X-AppSpace-Upload-Ticket':'1000000000000.'+'a'.repeat(64)})).status,403);
  const other=await (await create({fingerprint:hash('different-session')})).json();assert.equal((await put({'X-AppSpace-Upload-Ticket':other.transport.ticket})).status,403);
  assert.equal((await fetch(base+'/api/admin/apps',{headers:{Authorization:'Bearer '+session.transport.ticket}})).status,401);assert.equal((await fetch(base+`/api/admin/uploads/${session.id}`,{method:'DELETE',headers:{Authorization:'Bearer '+session.transport.ticket}})).status,401);
  const response=await put();assert.equal(response.status,201,await response.clone().text());assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.deepEqual((await (await fetch(base+'/api/admin/uploads/'+session.id,{headers})).json()).received,[{index:0,hash:hash(bytes)}]);
  await close(fixture.server);fixture=await listen(options);base=fixture.base;
  assert.equal((await put()).status,403,'Old process tickets must be invalid after restart');
  const resumed=await (await fetch(base+'/api/admin/uploads/'+session.id,{headers})).json();assert.deepEqual(resumed.received,[{index:0,hash:hash(bytes)}]);assert.equal((await put({'X-AppSpace-Upload-Ticket':resumed.transport.ticket})).status,200);
  const body=new FormData();body.set('uploadId',session.id);const published=await fetch(base+'/api/admin/apps',{method:'POST',headers,body});assert.equal(published.status,201);const app=await published.json();assert.deepEqual(Buffer.from(await (await fetch(base+`/files/${app.id}/app.ipa`)).arrayBuffer()),bytes);assert.equal((await put({'X-AppSpace-Upload-Ticket':resumed.transport.ticket})).status,404);
  assert.deepEqual(await readdir(path.join(dataDir,'private')),[]);
 }finally{await close(fixture.server);await rm(dataDir,{recursive:true,force:true});}
});
