import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {listPublishedApps} from '../server/catalog.mjs';
import {createApp} from '../server/app.mjs';

test('multiple apps keep separate links; persisted lists exclude broken records and private fields',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'appspace-catalog-'));
 const directory=path.join(dataDir,'published');await mkdir(directory);
 const ids=['12345678-1234-4123-8123-123456789abc','22345678-1234-4123-8123-123456789abc'];
 try {
  assert.deepEqual(await listPublishedApps(directory),[]);
  for(const [i,id] of ids.entries()) {await mkdir(path.join(directory,id));await writeFile(path.join(directory,id,'app.json'),JSON.stringify({id,name:'Same Name',version:i?'2.0':'1.0',category:i?'Năng suất':'Giải trí',iconImage:`https://example.com/${i}.png`,createdAt:1000+i,password:'private-secret',certificate:'private.p12'}));}
  await mkdir(path.join(directory,'32345678-1234-4123-8123-123456789abc'));await writeFile(path.join(directory,'32345678-1234-4123-8123-123456789abc','app.json'),'{invalid');
  const apps=await listPublishedApps(directory);assert.equal(apps.length,2);assert.equal(apps[0].id,ids[1]);assert.notEqual(apps[0].installUrl,apps[1].installUrl);assert.notEqual(apps[0].iconImage,apps[1].iconImage);assert.ok(!JSON.stringify(apps).includes('private'));
  const token='catalog-test-token-1234567890';
  const {app}=await createApp({dataDir,token,baseURL:'',signer:async()=>{}});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  try {
    const publicList=await fetch(base+'/api/apps');assert.equal(publicList.status,200);assert.deepEqual((await publicList.json()).apps,apps);
    assert.equal((await fetch(base+'/api/admin/apps')).status,401);
    const adminList=await fetch(base+'/api/admin/apps',{headers:{Authorization:'Bearer '+token}});assert.deepEqual((await adminList.json()).apps,apps);
    for(const id of ids)assert.equal((await (await fetch(base+'/api/apps/'+id)).json()).id,id);
    const home=await (await fetch(base+'/')).text();assert.ok(home.includes('data-source="server"'));assert.ok(home.includes('catalog-grid'));assert.ok(!home.includes('sign-form'));
  }finally {await new Promise(resolve=>server.close(resolve));}
 }finally {await rm(dataDir,{recursive:true,force:true});}
});
