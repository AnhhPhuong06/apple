import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
import * as plist from 'plist';
import {opensslBinary,runOpenSSL} from '../server/certificate-check.mjs';

export async function certificateFixture() {
  const dir=await mkdtemp(path.join(os.tmpdir(),'appspace-certificate-test-')),binary=await opensslBinary();
  const file=name=>path.join(dir,name);
  const run=async(args,input='')=>{const result=await runOpenSSL(binary,args,{input});if(result.code!==0)throw Error('OpenSSL test fixture failed: '+args[0]);return result;};
  try{
    await run(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',file('root.key'),'-out',file('root.pem'),'-days','3650','-subj','/CN=Fixture Root/O=Test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,digitalSignature,keyCertSign,cRLSign']);
    await writeFile(file('leaf.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\nauthorityInfoAccess=OCSP;URI:http://ocsp.apple.com/fixture\n');
    for(const [name,subject] of [['identity','/CN=Apple Distribution: Fixture/OU=TEAM123/O=Test Developer'],['profile-signer','/CN=Apple iPhone OS Provisioning Profile Signing/O=Apple Inc.']]) {
      await run(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',file(name+'.key'),'-out',file(name+'.csr'),'-subj',subject]);
      await run(['x509','-req','-in',file(name+'.csr'),'-CA',file('root.pem'),'-CAkey',file('root.key'),'-CAcreateserial','-out',file(name+'.pem'),'-days','365','-extfile',file('leaf.cnf')]);
    }
    const password='fixture-password-$-and-&-never-public';
    await run(['pkcs12','-export','-inkey',file('identity.key'),'-in',file('identity.pem'),'-certfile',file('root.pem'),'-out',file('identity.p12'),'-passout','stdin'],password+'\n');
    const certificate=new X509Certificate(await readFile(file('identity.pem'))),root=new X509Certificate(await readFile(file('root.pem')));
    const policy={roots:[root.toString()],intermediates:[]};
    let counter=0;
    async function profile(overrides={},developerSigned=false) {
      const n=counter++,xml=file(`profile-${n}.plist`),output=file(`profile-${n}.mobileprovision`),now=Date.now();
      const value={Name:'Fixture Provisioning Profile',UUID:'fixture-profile-uuid',TeamIdentifier:['TEAM123'],ApplicationIdentifierPrefix:['TEAM123'],CreationDate:new Date(now-60000),ExpirationDate:new Date(now+180*86400000),DeveloperCertificates:[certificate.raw],ProvisionedDevices:['fixture-device-1','fixture-device-2'],Entitlements:{'application-identifier':'TEAM123.com.example.*','com.apple.developer.team-identifier':'TEAM123','get-task-allow':true},...overrides};
      await writeFile(xml,plist.build(value));
      const signer=developerSigned?'identity':'profile-signer';
      await run(['cms','-sign','-binary','-in',xml,'-signer',file(signer+'.pem'),'-inkey',file(signer+'.key'),'-certfile',file('root.pem'),'-outform','DER','-nodetach','-out',output]);
      return output;
    }
    const profilePath=await profile(),work=file('work');await mkdir(work);
    for(const name of ['root.key','identity.key','profile-signer.key','identity.p12'])await chmod(file(name),0o600);
    return {dir,file,run,binary,password,certificate,root,policy,profile,profilePath,p12:file('identity.p12'),work,close:()=>rm(dir,{recursive:true,force:true})};
  }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
