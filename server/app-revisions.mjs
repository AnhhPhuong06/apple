import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';

export const validAppID=id=>typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

export async function appSnapshot(publicRoot,id) {
  if(!validAppID(id))throw new Error('Không tìm thấy ứng dụng cần cập nhật.');
  const directory=path.join(publicRoot,id);
  try {
    const entry=await lstat(directory);
    if(!entry.isDirectory() || entry.isSymbolicLink())throw new Error('Invalid app directory');
    const record=JSON.parse(await readFile(path.join(directory,'app.json'),'utf8'));
    if(record.id!==id || (record.contentRevision && !validAppID(record.contentRevision)))throw new Error('Invalid app metadata');
    return {record,directory,files:record.contentRevision?path.join(directory,'revisions',record.contentRevision):directory};
  } catch {throw new Error('Không tìm thấy ứng dụng cần cập nhật. Hãy làm mới danh sách.');}
}

export async function updateTarget(publicRoot,body,settings) {
  if(body.targetAppId===undefined || body.targetAppId==='')return null;
  const target=await appSnapshot(publicRoot,body.targetAppId);
  if(settings.bundleId && settings.bundleId!==target.record.bundleId)throw new Error('Cập nhật phải giữ nguyên Bundle ID của app hiện tại.');
  for(const key of ['subtitle','description','developer','category'])if(body[key]===undefined)settings[key]=target.record[key] || settings[key];
  if(body.releaseNotes===undefined)settings.releaseNotes=(target.record.releaseNotes || []).join('\n');
  return target;
}

function compareVersion(a,b) {
  // Compare components as integers, without losing precision on large build numbers.
  if(typeof a!=='string' || typeof b!=='string' || a.length>64 || b.length>64 || !/^\d+(?:\.\d+){0,3}$/.test(a) || !/^\d+(?:\.\d+){0,3}$/.test(b))throw new Error('Phiên bản và build phải là các số, có thể phân cách bằng dấu chấm.');
  const left=a.split('.').map(BigInt),right=b.split('.').map(BigInt);
  for(let i=0;i<Math.max(left.length,right.length);i++) {const x=left[i] ?? 0n,y=right[i] ?? 0n;if(x!==y)return x>y?1:-1;}
  return 0;
}

export function validateUpdate(info,previous) {
  if(info.CFBundleIdentifier!==previous.bundleId)throw new Error('IPA mới phải có cùng Bundle ID với app đang cập nhật.');
  const version=info.CFBundleShortVersionString || info.CFBundleVersion;
  compareVersion(info.CFBundleVersion,info.CFBundleVersion);
  const compared=compareVersion(version,previous.version);
  if(compared<0 || (compared===0 && compareVersion(info.CFBundleVersion,previous.buildVersion)<=0))throw new Error('Hãy tải IPA có phiên bản mới hơn, hoặc cùng phiên bản với build cao hơn.');
}
