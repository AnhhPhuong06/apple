import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../server/app.mjs';
import {readSiteSettings,validateSiteSettings} from '../server/site-settings.mjs';

test('logo settings accept direct HTTPS URLs and exclude unrelated values',()=>{
  assert.deepEqual(validateSiteSettings({logoUrl:'  https://cdn.example.com/logo.JPG?size=200  ',password:'private'}),{logoUrl:'https://cdn.example.com/logo.JPG?size=200'});
  assert.deepEqual(validateSiteSettings({logoUrl:''}),{logoUrl:''});
  for(const logoUrl of ['http://example.com/logo.png','javascript:alert(1)','data:image/png;base64,abc','//example.com/x.png','https://user:secret@example.com/logo.png','https://example.com/a.png#x','https://example.com/a b.png','https://example.com/'+ 'x'.repeat(2050),null,{}])assert.throws(()=>validateSiteSettings({logoUrl}));
});

test('only admin can save the public website logo, settings survive restart and can be reset',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-logo-'));const token='website-logo-admin-token-123456';
  const {app}=await createApp({dataDir,token,baseURL:'',signer:async()=>{}});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const put=(body,requestHeaders=headers)=>fetch(base+'/api/admin/site-settings',{method:'PUT',headers:requestHeaders,body:JSON.stringify(body)});
  try {
    const initial=await fetch(base+'/site-settings.json');assert.equal(initial.status,200);assert.deepEqual(await initial.json(),{logoUrl:''});
    const logoUrl='https://images.example.test/logo.png';
    assert.equal((await put({logoUrl},{'Content-Type':'application/json'})).status,401);
    assert.equal((await put({logoUrl},{...headers,Origin:'https://untrusted.test'})).status,403);
    assert.equal((await put({logoUrl:'javascript:alert(1)'})).status,400);
    const response=await put({logoUrl,password:'not-saved'});assert.equal(response.status,200);assert.deepEqual(await response.json(),{logoUrl});
    const publicSettings=await fetch(base+'/site-settings.json');assert.match(publicSettings.headers.get('cache-control'),/no-store/);assert.deepEqual(await publicSettings.json(),{logoUrl});
    const stored=JSON.parse(await readFile(path.join(dataDir,'site-settings.json'),'utf8'));assert.deepEqual(stored,{logoUrl});
    assert.deepEqual(await readSiteSettings(dataDir,path.join(dataDir,'missing-root')),{logoUrl});
    assert.equal((await fetch(base+'/data/site-settings.json')).status,404);
    assert.equal((await put({logoUrl:42})).status,400);assert.deepEqual(await (await fetch(base+'/site-settings.json')).json(),{logoUrl});
    assert.equal((await put({logoUrl:''})).status,200);assert.deepEqual(await (await fetch(base+'/site-settings.json')).json(),{logoUrl:''});
  } finally {await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});
