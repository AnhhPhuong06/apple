import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

async function fixture(options={}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-auth-'));
  const {app}=await createApp({dataDir,baseURL:'',signer:async()=>{},...options});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {dataDir,base:'http://127.0.0.1:'+server.address().port,close:async()=>{await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}};
}
const password='test-admin-password-for-auth-123456';
const login=(base,value,extra={})=>fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({password:value})});

test('admin pages require login; public installation and downloads stay anonymous',async()=>{
  const f=await fixture({token:password});
  try {
    const publicHome=await fetch(f.base+'/');assert.equal(publicHome.status,200);const html=await publicHome.text();assert.ok(!html.includes('sign-form'));assert.ok(!html.includes('sign.html'));
    for(const url of ['/admin','/admin/','/sign.html','/manage.html']) {const response=await fetch(f.base+url);assert.equal(new URL(response.url).pathname,'/admin/login');assert.ok(!(await response.text()).includes('sign-form'));}
    for(const url of ['/api/health','/api/admin/session','/api/jobs/abc'])assert.equal((await fetch(f.base+url)).status,401);
    assert.equal((await fetch(f.base+'/api/sign',{method:'POST'})).status,401);
    assert.equal((await login(f.base,'wrong')).status,401);
    assert.equal((await login(f.base,password,{Origin:'https://untrusted.test'})).status,403);
    const response=await login(f.base,password);assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Max-Age=43200/);
    const Cookie=setCookie.split(';')[0];
    const adminPage=await fetch(f.base+'/admin',{headers:{Cookie}});assert.ok((await adminPage.text()).includes('sign-form'));assert.match(adminPage.headers.get('cache-control'),/no-store/);
    assert.equal((await fetch(f.base+'/api/health',{headers:{Cookie}})).status,200);
    assert.equal((await fetch(f.base+'/api/sign',{method:'POST',headers:{Cookie},body:new FormData()})).status,403);
    assert.equal((await fetch(f.base+'/api/sign',{method:'POST',headers:{Cookie,'X-AppSpace-Admin':'1'},body:new FormData()})).status,400);
    const id='12345678-1234-4123-8123-123456789abc';const dir=path.join(f.dataDir,'published',id);await mkdir(dir);
    await writeFile(path.join(dir,'app.json'),JSON.stringify({id,name:'Public app'}));await writeFile(path.join(dir,'app.ipa'),'signed fixture');await writeFile(path.join(dir,'manifest.plist'),'<plist/>');
    for(const url of ['/index.html?job='+id,'/api/apps/'+id,`/files/${id}/app.ipa`,`/files/${id}/manifest.plist`]) {const result=await fetch(f.base+url);assert.equal(result.status,200);assert.equal(result.headers.get('set-cookie'),null);}
    for(const url of ['/data/admin-key.txt','/server/auth.mjs','/.env',`/files/${id}/certificate.p12`])assert.equal((await fetch(f.base+url)).status,404);
    assert.equal((await fetch(f.base+'/api/admin/logout',{method:'POST',headers:{Cookie,'X-AppSpace-Admin':'1'}})).status,200);
    assert.equal((await fetch(f.base+'/api/health',{headers:{Cookie}})).status,401);
    assert.equal(new URL((await fetch(f.base+'/admin',{headers:{Cookie}})).url).pathname,'/admin/login');
    assert.equal((await fetch(f.base+'/api/apps/'+id)).status,200);
  } finally {await f.close();}
});

test('unconfigured local server generates a persistent password and still requires login',async()=>{
  const f=await fixture({token:''});try {
    const generated=(await readFile(path.join(f.dataDir,'admin-key.txt'),'utf8')).trim();assert.ok(generated.length>=24);
    assert.equal((await fetch(f.base+'/api/health')).status,401);assert.equal((await login(f.base,generated)).status,200);
    await createApp({dataDir:f.dataDir,token:'',baseURL:'',signer:async()=>{}});
    assert.equal((await readFile(path.join(f.dataDir,'admin-key.txt'),'utf8')).trim(),generated);
  } finally {await f.close();}
});

test('HTTPS login cookies are Secure and repeated bad passwords are limited',async()=>{
  const f=await fixture({token:password,baseURL:'https://apps.example.test'});try {
    const response=await login(f.base,password);assert.match(response.headers.get('set-cookie'),/; Secure/);
    for(let i=0;i<8;i++)assert.equal((await login(f.base,'wrong')).status,401);
    const blocked=await login(f.base,password);assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
  } finally {await f.close();}
});
