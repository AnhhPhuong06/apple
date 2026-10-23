import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yazl from 'yazl';
import * as plist from 'plist';
import {importPublicApps} from '../deploy/import-public-apps.mjs';

test('VPS imports signed public apps with new HTTPS URLs and never overwrites an existing app',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'appspace-vps-import-'));
 try {
  const source=path.join(directory,'source'),data=path.join(directory,'data');await mkdir(source);
  const id='12345678-1234-4123-8123-123456789abc',appDir=path.join(source,id);await mkdir(appDir);
  const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(plist.build({CFBundleIdentifier:'com.example.test',CFBundleName:'My App',CFBundleVersion:'17',CFBundleShortVersionString:'2.0'})),'Payload/App.app/Info.plist');zip.end();const chunks=[];for await(const chunk of zip.outputStream)chunks.push(chunk);const ipa=Buffer.concat(chunks);
  await writeFile(path.join(appDir,'app.ipa'),ipa);await writeFile(path.join(appDir,'app.json'),JSON.stringify({id,name:'My App',password:'not-public',file:'http://localhost/app.ipa',description:'App description'}));await writeFile(path.join(appDir,'icon.png'),'icon');
  assert.deepEqual(await importPublicApps(source,data,'https://apps.example.test'),{imported:1,skipped:0});
  const destination=path.join(data,'published',id);const record=JSON.parse(await readFile(path.join(destination,'app.json'),'utf8'));assert.equal(record.name,'My App');assert.equal(record.version,'2.0');assert.equal(record.buildVersion,'17');assert.equal(record.file,`https://apps.example.test/files/${id}/app.ipa`);assert.equal(record.password,undefined);assert.equal(record.description,'App description');assert.deepEqual(await readFile(path.join(destination,'app.ipa')),ipa);
  const xml=plist.parse(await readFile(path.join(destination,'manifest.plist'),'utf8'));assert.equal(xml.items[0].metadata['bundle-version'],'17');assert.equal(xml.items[0].assets[0].url,record.file);
  assert.deepEqual(await importPublicApps(source,data,'https://other.example.test'),{imported:0,skipped:1});assert.deepEqual(JSON.parse(await readFile(path.join(destination,'app.json'),'utf8')),record);
  await assert.rejects(importPublicApps(source,data,'http://example.test'));
  await mkdir(path.join(data,'deleted-apps'));await writeFile(path.join(data,'deleted-apps',id+'.json'),JSON.stringify({id,deletedAt:Date.now()}));
  assert.equal(path.dirname(destination),path.join(data,'published'));await rm(destination,{recursive:true});
  assert.deepEqual(await importPublicApps(source,data,'https://apps.example.test'),{imported:0,skipped:1});
  await assert.rejects(readFile(path.join(destination,'app.json')),error=>error.code==='ENOENT');
 }finally {await rm(directory,{recursive:true,force:true});}
});
