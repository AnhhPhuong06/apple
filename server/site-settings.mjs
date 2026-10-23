import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function validateSiteSettings(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || typeof value.logoUrl!=='string')throw new Error('Link logo không hợp lệ.');
  const logoUrl=value.logoUrl.trim();
  if(!logoUrl)return {logoUrl:''};
  try {
    if(logoUrl.length>2048 || /[\s\\]/.test(logoUrl))throw new Error();
    const url=new URL(logoUrl);
    if(url.protocol!=='https:' || url.username || url.password || url.hash)throw new Error();
    return {logoUrl:url.href};
  } catch {throw new Error('Dùng link HTTPS trực tiếp đến ảnh logo, không kèm tài khoản hoặc mật khẩu.');}
}

export async function readSiteSettings(data,root) {
  for(const file of [path.join(data,'site-settings.json'),path.join(root,'site-settings.json')]) {
    try{return validateSiteSettings(JSON.parse(await readFile(file,'utf8')));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {logoUrl:''};
}

export async function saveSiteSettings(data,value) {
  const settings=validateSiteSettings(value);
  const temporary=path.join(data,`site-settings-${randomUUID()}.tmp`);
  try {await writeFile(temporary,JSON.stringify(settings,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temporary,path.join(data,'site-settings.json'));}
  finally {await rm(temporary,{force:true});}
  return settings;
}
