import {spawn} from 'node:child_process';
import {access,readFile,writeFile} from 'node:fs/promises';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import path from 'node:path';
import * as plist from 'plist';
import applePKI from './apple-pki.json' with {type:'json'};

const pemCertificates=value=>(value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map(pem=>new X509Certificate(pem));
export const applePolicy={roots:applePKI.roots.map(c=>c.pem),intermediates:applePKI.intermediates.map(c=>c.pem)};
export async function opensslBinary() {
  if(process.env.OPENSSL_BIN)return process.env.OPENSSL_BIN;
  if(process.platform==='win32')for(const candidate of [path.join(process.env.ProgramFiles || 'C:\\Program Files','Git','usr','bin','openssl.exe'),'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe']){try{await access(candidate);return candidate;}catch{}}
  return 'openssl';
}
export function runOpenSSL(binary,args,{input='',timeout=15000,maxOutput=16*1024**2}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const out=[],err=[];let size=0,failed=false;
    const fail=()=>{if(failed)return;failed=true;clearTimeout(timer);child.kill();reject(new Error('Không chạy được OpenSSL hoặc kiểm tra quá thời gian. Kiểm tra OPENSSL_BIN trên máy chủ.'));};
    const timer=setTimeout(fail,timeout);
    for(const [stream,parts] of [[child.stdout,out],[child.stderr,err]])stream.on('data',chunk=>{size+=chunk.length;if(size>maxOutput)fail();else parts.push(chunk);});
    child.once('error',fail);child.once('close',code=>{clearTimeout(timer);if(!failed)resolve({code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
function chainFor(certificate,candidates,roots,seen=new Set()) {
  if(seen.has(certificate.fingerprint256))return null;
  const nextSeen=new Set([...seen,certificate.fingerprint256]);
  if(nextSeen.size>6)return null;
  if(roots.some(root=>root.fingerprint256===certificate.fingerprint256))return [certificate];
  for(const issuer of candidates) {
    if(!issuer.ca || !certificate.checkIssued(issuer) || !certificate.verify(issuer.publicKey))continue;
    const chain=chainFor(issuer,candidates,roots,nextSeen);if(chain)return [certificate,...chain];
  }
  return null;
}
function unknown(reason){return {status:'unknown',checkedAt:Date.now(),nextUpdate:null,reason};}
export function parseOCSP(result,now=Date.now(),target) {
  // An unverified response must never turn into a positive or revoked result.
  if(result.code!==0 || !/Response verify OK/i.test(result.stderr))return unknown('Không xác minh được chữ ký phản hồi OCSP của Apple.');
  // Read the verified summary for the requested certificate, not a different
  // SingleResponse that might also be included in the OCSP response text.
  const index=target?result.stdout.lastIndexOf(target+': '):-1;
  if(index<0)return unknown('Phản hồi OCSP không có trạng thái của đúng chứng chỉ yêu cầu.');
  const summary=result.stdout.slice(index+target.length+2);
  const status=summary.match(/^(good|revoked|unknown)\b/i)?.[1]?.toLowerCase();
  const thisUpdate=Date.parse(summary.match(/This Update:\s*([^\r\n]+)/)?.[1] || '');
  const nextUpdate=Date.parse(summary.match(/Next Update:\s*([^\r\n]+)/)?.[1] || '');
  if(!Number.isFinite(thisUpdate) || thisUpdate>now+300000 || (Number.isFinite(nextUpdate)?nextUpdate<=now:now-thisUpdate>600000))return unknown('Phản hồi OCSP đã cũ hoặc không có thời gian hợp lệ.');
  if(!['good','revoked'].includes(status))return unknown('Apple chưa xác nhận trạng thái chứng chỉ này.');
  return {status,checkedAt:now,nextUpdate:Number.isFinite(nextUpdate)?nextUpdate:Math.min(thisUpdate+600000,now+600000),reason:status==='revoked'?'Apple xác nhận chứng chỉ đã bị thu hồi.':'Phản hồi OCSP hợp lệ: chưa bị thu hồi tại thời điểm kiểm tra.'};
}
export async function checkOCSP({binary,certificate,chain,roots,work,responseFile}) {
  if(!chain || chain.length<2)return unknown('Chưa có chuỗi chứng chỉ Apple hợp lệ để kiểm tra thu hồi.');
  const responder=(certificate.infoAccess || '').split('\n').find(line=>line.startsWith('OCSP - URI:'))?.slice(11).trim();
  if(!responseFile) {
    try {const url=new URL(responder);if(!['http:','https:'].includes(url.protocol) || !['ocsp.apple.com','ocsp2.apple.com'].includes(url.hostname) || url.username || url.password || (url.port && !['80','443'].includes(url.port)))throw Error();}
    catch{return unknown('Chứng chỉ không có địa chỉ OCSP Apple được hỗ trợ.');}
  }
  const leaf=path.join(work,'ocsp-certificate.pem'),issuer=path.join(work,'ocsp-issuer.pem'),ca=path.join(work,'ocsp-roots.pem'),other=path.join(work,'ocsp-chain.pem');
  await writeFile(leaf,certificate.toString());await writeFile(issuer,chain[1].toString());await writeFile(ca,roots.map(cert=>cert.toString()).join('\n'));await writeFile(other,chain.slice(1).map(cert=>cert.toString()).join('\n'));
  try {
    const args=['ocsp','-issuer',issuer,'-cert',leaf,'-CAfile',ca,'-no-CApath','-no-CAstore','-verify_other',other,'-no_nonce','-resp_text','-validity_period','300','-status_age','600'];
    if(responseFile)args.push('-respin',responseFile);else args.push('-url',responder,'-timeout','8');
    return parseOCSP(await runOpenSSL(binary,args,{timeout:12000}),Date.now(),leaf);
  }catch{return unknown('Không kết nối được máy chủ OCSP Apple. Chưa thể xác nhận còn sống hay đã thu hồi.');}
}

export async function inspectIdentity({p12,profile,password,work,binary,policy=applePolicy,online=true}) {
  if(typeof password!=='string' || password.length>1024 || /[\r\n\0]/.test(password))throw new Error('Mật khẩu .p12 không hợp lệ hoặc chứa ký tự xuống dòng.');
  binary ||= await opensslBinary();
  let decoded=await runOpenSSL(binary,['pkcs12','-in',p12,'-nodes','-passin','stdin'],{input:password+'\n'});
  if(decoded.code!==0 && /unsupported|legacy|RC2/i.test(decoded.stderr))decoded=await runOpenSSL(binary,['pkcs12','-legacy','-in',p12,'-nodes','-passin','stdin'],{input:password+'\n'});
  if(decoded.code!==0)throw new Error('Không mở được .p12. Kiểm tra file và mật khẩu chứng chỉ.');
  const certificates=pemCertificates(decoded.stdout);
  const keyPEM=decoded.stdout.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/)?.[0];
  if(!keyPEM)throw new Error('File .p12 không chứa khóa riêng để ký ứng dụng.');
  let key;try{key=createPrivateKey(keyPEM);}catch{throw new Error('Không đọc được khóa riêng trong .p12.');}
  const certificate=certificates.find(cert=>!cert.ca && cert.checkPrivateKey(key));
  decoded.stdout='';
  if(!certificate)throw new Error('Không có chứng chỉ khớp với khóa riêng trong .p12.');
  const roots=policy.roots.flatMap(pemCertificates),intermediates=policy.intermediates.flatMap(pemCertificates);
  const chain=chainFor(certificate,[...certificates,...intermediates,...roots],roots);
  const rootsFile=path.join(work,'profile-trusted-roots.pem'),issuersFile=path.join(work,'profile-issuers.pem');
  await writeFile(rootsFile,policy.roots.join('\n'));await writeFile(issuersFile,[...policy.intermediates,...certificates.map(cert=>cert.toString())].join('\n'));
  const profileSigner=path.join(work,'profile-signers.pem');
  // Apple's profile-signing policy checks the profile's own dates separately from
  // the CMS signer certificate's dates. Pin its purpose/name as well as the root.
  const cms=await runOpenSSL(binary,['cms','-verify','-inform','DER','-in',profile,'-CAfile',rootsFile,'-no-CApath','-no-CAstore','-certfile',issuersFile,'-purpose','any','-no_check_time','-signer',profileSigner]);
  if(cms.code!==0)throw new Error('Hồ sơ .mobileprovision không có chữ ký CMS hợp lệ từ Apple hoặc đã bị hỏng.');
  const signers=pemCertificates(await readFile(profileSigner,'utf8'));
  if(signers.length!==1 || !/(?:^|\n)CN=Apple iPhone OS Provisioning Profile Signing(?:\n|$)/.test(signers[0].subject) || !/(?:^|\n)O=Apple Inc\.(?:\n|$)/.test(signers[0].subject))throw new Error('Hồ sơ không được ký bởi chứng chỉ cấp provisioning profile của Apple.');
  let data;try{data=plist.parse(cms.stdout);}catch{throw new Error('Không đọc được nội dung .mobileprovision.');}
  const embedded=Array.isArray(data.DeveloperCertificates)?data.DeveloperCertificates:[];
  const profileMatches=embedded.some(bytes=>{try{return new X509Certificate(Buffer.from(bytes)).fingerprint256===certificate.fingerprint256;}catch{return false;}});
  const teamId=Array.isArray(data.TeamIdentifier)?data.TeamIdentifier[0]:null;
  const certTeam=certificate.subject.match(/(?:^|\n)OU=([^\n]+)/)?.[1];
  const applicationIdentifier=data.Entitlements?.['application-identifier'];
  const prefix=Array.isArray(data.ApplicationIdentifierPrefix)?data.ApplicationIdentifierPrefix[0]:teamId;
  const profileExpires=Date.parse(data.ExpirationDate),profileCreated=Date.parse(data.CreationDate);
  if(!teamId || typeof applicationIdentifier!=='string' || !prefix || !Number.isFinite(profileExpires) || !Number.isFinite(profileCreated))throw new Error('Hồ sơ thiếu Team ID, App ID hoặc thời hạn cấp phép.');
  const issues=[];
  if(!chain)issues.push('Không xác minh được chuỗi chứng chỉ đến Apple Root CA.');
  if(!certificate.keyUsage?.includes('1.3.6.1.5.5.7.3.3') || !/(?:Apple Development|Apple Distribution|iPhone Developer|iPhone Distribution):/.test(certificate.subject))issues.push('Chứng chỉ không thuộc loại ký ứng dụng iOS được hỗ trợ.');
  if(!profileMatches)issues.push('Chứng chỉ không nằm trong DeveloperCertificates của hồ sơ.');
  if(certTeam!==teamId)issues.push('Team ID của chứng chỉ và hồ sơ không khớp.');
  if(data.Entitlements?.['com.apple.developer.team-identifier'] && data.Entitlements['com.apple.developer.team-identifier']!==teamId)issues.push('Team ID trong quyền ứng dụng không khớp hồ sơ.');
  if(!applicationIdentifier.startsWith(prefix+'.'))issues.push('App ID không khớp tiền tố cấp phép.');
  const distribution=data.ProvisionsAllDevices?'enterprise':Array.isArray(data.ProvisionedDevices)?(data.Entitlements?.['get-task-allow']?'development':'ad-hoc'):'app-store';
  if(distribution==='app-store')issues.push('Hồ sơ App Store không dùng để cài IPA trực tiếp qua website.');
  const now=Date.now();
  const validity={notBefore:Date.parse(certificate.validFrom),expiresAt:Date.parse(certificate.validTo),profileCreatedAt:profileCreated,profileExpiresAt:profileExpires,chainValidFrom:chain?Math.max(...chain.map(cert=>Date.parse(cert.validFrom))):null,chainValidUntil:chain?Math.min(...chain.map(cert=>Date.parse(cert.validTo))):null};
  const metadata={name:certificate.subject.match(/(?:^|\n)CN=([^\n]+)/)?.[1] || 'Chứng chỉ iOS',teamId,serial:certificate.serialNumber,fingerprint:certificate.fingerprint256,profileName:typeof data.Name==='string'?data.Name:'Hồ sơ iOS',profileUUID:typeof data.UUID==='string'?data.UUID:'',applicationIdentifier,bundlePattern:applicationIdentifier.slice(prefix.length+1),deviceCount:Array.isArray(data.ProvisionedDevices)?data.ProvisionedDevices.length:null,distribution,...validity,issues};
  const revocation=online && identityStatus(metadata,now).usable?await checkOCSP({binary,certificate,chain,roots,work}):unknown('Chưa kiểm tra thu hồi trực tuyến.');
  return {...metadata,revocation,checkedAt:now};
}

export function identityStatus(metadata,now=Date.now()) {
  if(metadata.issues?.length)return {status:'invalid',usable:false,message:metadata.issues.join(' ')};
  if([metadata.expiresAt,metadata.profileExpiresAt,metadata.chainValidUntil].some(date=>!Number.isFinite(date) || date<=now))return {status:'expired',usable:false,message:'Chứng chỉ, hồ sơ hoặc chuỗi cấp phát đã hết hạn.'};
  if(metadata.notBefore>now || metadata.profileCreatedAt>now || metadata.chainValidFrom>now)return {status:'not-yet-valid',usable:false,message:'Chứng chỉ hoặc hồ sơ chưa đến ngày có hiệu lực.'};
  if(metadata.revocation?.status==='revoked')return {status:'revoked',usable:false,message:'Apple xác nhận chứng chỉ đã bị thu hồi.'};
  if(metadata.revocation?.status==='good' && now-metadata.revocation.checkedAt<600000 && metadata.revocation.nextUpdate>now)return {status:'good',usable:true,message:'Còn hạn, khớp hồ sơ và OCSP Apple xác nhận chưa bị thu hồi.'};
  return {status:'unknown',usable:true,message:'Còn hạn và khớp hồ sơ; chưa có xác nhận OCSP Apple mới. Có thể ký nhưng cần kiểm tra cài đặt trên thiết bị.'};
}

export function matchesBundle(pattern,bundleId) {
  if(typeof pattern!=='string' || typeof bundleId!=='string' || !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleId))return false;
  if(pattern==='*')return /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleId);
  if(pattern.endsWith('.*'))return bundleId.startsWith(pattern.slice(0,-1)) && bundleId.length>pattern.length-1;
  return pattern===bundleId;
}
