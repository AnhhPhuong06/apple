import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,lstat,rename,unlink,rm,chmod} from 'node:fs/promises';
import path from 'node:path';
import {inspectIdentity,identityStatus,matchesBundle} from './certificate-check.mjs';

export const certificateID=id=>typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
function vaultError(message,status=400){return Object.assign(new Error(message),{status});}
export async function createCertificateVault({data,privateRoot,inspector=inspectIdentity,policy}) {
  const directory=path.join(data,'certificates'),keyFile=path.join(data,'certificate-vault.key');
  await mkdir(directory,{recursive:true,mode:0o700});
  if((await lstat(directory)).isSymbolicLink())throw new Error('Kho chứng chỉ không được là liên kết thư mục.');
  let key;
  try {const info=await lstat(keyFile);if(!info.isFile() || info.isSymbolicLink())throw Error('Invalid vault key file');key=await readFile(keyFile);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    if((await readdir(directory)).some(name=>name.endsWith('.vault')))throw new Error('Kho chứng chỉ mất khóa mã hóa. Hãy khôi phục certificate-vault.key từ bản sao lưu.');
    const generated=randomBytes(32);
    try{await writeFile(keyFile,generated,{flag:'wx',mode:0o600});key=generated;}catch(error){if(error.code!=='EEXIST')throw error;key=await readFile(keyFile);}
  }
  if(key.length!==32)throw new Error('Khóa mã hóa kho chứng chỉ không hợp lệ.');
  await chmod(keyFile,0o600);await chmod(directory,0o700);
  let queue=Promise.resolve();
  const locked=fn=>{const operation=queue.then(fn);queue=operation.catch(()=>{});return operation;};
  function filename(id){if(!certificateID(id))throw vaultError('Không tìm thấy chứng chỉ.',404);const target=path.resolve(directory,id+'.vault');if(path.dirname(target)!==directory)throw vaultError('Không tìm thấy chứng chỉ.',404);return target;}
  async function load(id) {
    const target=filename(id);
    try{
      const entry=await lstat(target);if(!entry.isFile() || entry.isSymbolicLink() || entry.size>20*1024**2)throw Error();
      const envelope=JSON.parse(await readFile(target,'utf8'));
      if(envelope.version!==1)throw Error();
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
      decipher.setAAD(Buffer.from('appspace-certificate-v1:'+id));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
      const clear=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);
      try{const record=JSON.parse(clear.toString('utf8'));if(record.id!==id)throw Error();return record;}finally{clear.fill(0);}
    }catch(error){if(error.code==='ENOENT')throw vaultError('Không tìm thấy chứng chỉ.',404);throw vaultError('Không đọc được chứng chỉ đã mã hóa. Kiểm tra bản sao lưu và khóa kho.',500);}
  }
  async function persist(record) {
    const target=filename(record.id),temporary=path.join(directory,randomUUID()+'.tmp');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('appspace-certificate-v1:'+record.id));
    const clear=Buffer.from(JSON.stringify(record));
    let ciphertext;try{ciphertext=Buffer.concat([cipher.update(clear),cipher.final()]);}finally{clear.fill(0);}
    try{await writeFile(temporary,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}),{flag:'wx',mode:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
  }
  function publicRecord(record) {
    const m=record.inspection;
    return {id:record.id,label:record.label,createdAt:record.createdAt,checkedAt:m.checkedAt,name:m.name,teamId:m.teamId,serial:m.serial,fingerprint:m.fingerprint,profileName:m.profileName,profileUUID:m.profileUUID,applicationIdentifier:m.applicationIdentifier,bundlePattern:m.bundlePattern,distribution:m.distribution,deviceCount:m.deviceCount,notBefore:m.notBefore,expiresAt:m.expiresAt,profileExpiresAt:m.profileExpiresAt,revocation:m.revocation,...identityStatus(m)};
  }
  async function withFiles(record,fn) {
    const work=path.resolve(privateRoot,randomUUID());
    if(path.dirname(work)!==privateRoot)throw Error('Unsafe certificate work directory');
    await mkdir(work,{mode:0o700});
    try{const files=await writeCredentials(record,work);return await fn(files,work);}finally{await rm(work,{recursive:true,force:true});}
  }
  async function writeCredentials(record,work) {
    if(path.dirname(path.resolve(work))!==privateRoot)throw Error('Unsafe certificate destination');
    const p12=path.join(work,'saved-certificate.p12'),profile=path.join(work,'saved-profile.mobileprovision');
    await writeFile(p12,Buffer.from(record.p12,'base64'),{flag:'wx',mode:0o600});await writeFile(profile,Buffer.from(record.profile,'base64'),{flag:'wx',mode:0o600});
    return {p12,profile,password:record.password};
  }
  const check=id=>locked(async()=>{
    const record=await load(id);
    record.inspection=await withFiles(record,(files,work)=>inspector({...files,work,policy,online:true}));
    await persist(record);return publicRecord(record);
  });
  return {
    async list(){const result=[];for(const name of await readdir(directory)){if(!name.endsWith('.vault') || !certificateID(name.slice(0,-6)))continue;result.push(publicRecord(await load(name.slice(0,-6))));}return result.sort((a,b)=>b.createdAt-a.createdAt);},
    save:options=>locked(async()=>{
      if((await readdir(directory)).filter(name=>name.endsWith('.vault')).length>=100)throw vaultError('Kho tối đa 100 bộ chứng chỉ. Hãy xóa bộ không còn dùng.');
      const label=typeof options.label==='string'?options.label.trim():'';if(label.length>80 || /[\x00-\x1f]/.test(label))throw vaultError('Tên lưu chứng chỉ không hợp lệ.');
      const inspection=await inspector({...options,policy,online:true});
      const record={id:randomUUID(),label:label || inspection.name,createdAt:Date.now(),p12:(await readFile(options.p12)).toString('base64'),profile:(await readFile(options.profile)).toString('base64'),password:options.password,inspection};
      await persist(record);return publicRecord(record);
    }),
    check,
    remove:id=>locked(async()=>{await load(id);await unlink(filename(id));return {ok:true,id};}),
    async materialize(id,work,bundleId) {
      let record=await load(id);
      if(Date.now()-record.inspection.checkedAt>600000 && identityStatus(record.inspection).usable){await check(id);record=await load(id);}
      const status=identityStatus(record.inspection);
      if(!status.usable)throw vaultError(status.message);
      if(!matchesBundle(record.inspection.bundlePattern,bundleId))throw vaultError('Bundle ID của app không nằm trong phạm vi hồ sơ đã lưu. Chọn bộ chứng chỉ khác hoặc Bundle ID phù hợp.');
      return writeCredentials(record,work);
    }
  };
}
