import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {certificateFixture} from './certificate-fixture.mjs';
import {inspectIdentity,identityStatus,checkOCSP,parseOCSP,matchesBundle,applePolicy} from '../server/certificate-check.mjs';

test('certificate check verifies P12 key, Apple profile signer purpose, matching profile and validity',async()=>{
  const f=await certificateFixture();
  const inspect=options=>inspectIdentity({p12:f.p12,profile:f.profilePath,password:f.password,work:f.work,binary:f.binary,policy:f.policy,online:false,...options});
  try{
    const result=await inspect();
    assert.equal(result.teamId,'TEAM123');assert.equal(result.bundlePattern,'com.example.*');assert.equal(result.deviceCount,2);assert.equal(result.distribution,'development');assert.deepEqual(result.issues,[]);assert.equal(identityStatus(result).status,'unknown');assert.equal(identityStatus(result).usable,true);
    await assert.rejects(inspect({password:'wrong'}),/mật khẩu/);
    await assert.rejects(inspect({profile:await f.profile({},true)}),/không được ký/);
    await assert.rejects(inspect({policy:applePolicy}),/CMS/);
    const mismatch=await inspect({profile:await f.profile({DeveloperCertificates:[f.root.raw]})});assert.equal(identityStatus(mismatch).status,'invalid');
    const expired=await inspect({profile:await f.profile({ExpirationDate:new Date(Date.now()-10000)})});assert.equal(identityStatus(expired).status,'expired');assert.equal(identityStatus(expired).usable,false);
    const future=await inspect({profile:await f.profile({CreationDate:new Date(Date.now()+86400000)})});assert.equal(identityStatus(future).status,'not-yet-valid');
    const appstore=await inspect({profile:await f.profile({ProvisionedDevices:undefined,Entitlements:{'application-identifier':'TEAM123.com.example.*','get-task-allow':false}})});assert.equal(identityStatus(appstore).status,'invalid');
    const bytes=await readFile(f.profilePath);bytes[bytes.length-1]^=1;const bad=f.file('tampered.mobileprovision');await writeFile(bad,bytes);await assert.rejects(inspect({profile:bad}),/CMS/);
    assert.ok(matchesBundle('com.example.*','com.example.app'));assert.ok(matchesBundle('*','com.other.app'));assert.ok(!matchesBundle('com.example.*','com.exampleevil.app'));assert.ok(!matchesBundle('com.example.app','com.example.other'));
  }finally{await f.close();}
});

test('OCSP uses signature verification and freshness; good, revoked, stale and tampered responses stay distinct',async()=>{
  const f=await certificateFixture();
  try{
    const cert=new X509Certificate(await readFile(f.file('identity.pem'))),root=new X509Certificate(await readFile(f.file('root.pem')));
    const utc=date=>date.toISOString().slice(2,19).replace(/[-:T]/g,'')+'Z';
    for(const revoked of [false,true]) {
      const index=f.file('ocsp-index'),response=f.file('ocsp-'+revoked+'.der');
      await writeFile(index,`${revoked?'R':'V'}\t${utc(new Date(cert.validTo))}\t${revoked?utc(new Date()):''}\t${cert.serialNumber}\tunknown\t/CN=Fixture\n`);
      await f.run(['ocsp','-index',index,'-rsigner',f.file('root.pem'),'-rkey',f.file('root.key'),'-CA',f.file('root.pem'),'-issuer',f.file('root.pem'),'-cert',f.file('identity.pem'),'-respout',response,'-resp_no_certs','-ndays','1']);
      const checked=await checkOCSP({binary:f.binary,certificate:cert,chain:[cert,root],roots:[root],work:f.work,responseFile:response});
      assert.equal(checked.status,revoked?'revoked':'good',checked.reason);
      const bytes=await readFile(response);bytes[bytes.length-1]^=1;const broken=f.file('bad-ocsp.der');await writeFile(broken,bytes);
      assert.equal((await checkOCSP({binary:f.binary,certificate:cert,chain:[cert,root],roots:[root],work:f.work,responseFile:broken})).status,'unknown');
    }
    assert.equal(parseOCSP({code:1,stderr:'Response Verify Failure',stdout:'Cert Status: good'}).status,'unknown');
    assert.equal(parseOCSP({code:0,stderr:'Response verify OK',stdout:'Cert Status: good\nThis Update: Jan 1 00:00:00 2020 GMT\nNext Update: Jan 2 00:00:00 2020 GMT'}).status,'unknown');
    const now=Date.now(),thisUpdate=new Date(now-1000).toUTCString(),nextUpdate=new Date(now+600000).toUTCString();
    assert.equal(parseOCSP({code:0,stderr:'Response verify OK',stdout:`Cert Status: good\nother.pem: good\n This Update: ${thisUpdate}\n Next Update: ${nextUpdate}\nleaf.pem: revoked\n This Update: ${thisUpdate}\n Next Update: ${nextUpdate}`},now,'leaf.pem').status,'revoked');
  }finally{await f.close();}
});
