import {readFile,writeFile,stat,copyFile,rename,mkdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readAppInfo,manifestXML} from './signing.mjs';
import {prepareAppIcon} from './images.mjs';
import {validateUpdate} from './app-revisions.mjs';

export function presentationSettings(body={}) {
  const text=(key,max)=>{
    if(body[key]!==undefined && typeof body[key]!=='string')throw new Error('Trường nhập không hợp lệ.');
    const value=(body[key] || '').trim();
    if(value.length>max || /\x00/.test(value))throw new Error('Nội dung nhập vượt giới hạn.');
    return value;
  };
  const settings={name:text('name',60),bundleId:text('bundleId',200),version:text('version',24),subtitle:text('subtitle',100),description:text('description',3000),developer:text('developer',100),releaseNotes:text('releaseNotes',2000),category:text('category',30) || 'Tiện ích'};
  if(!['Năng suất','Sáng tạo','Giải trí','Tiện ích'].includes(settings.category))throw new Error('Danh mục không hợp lệ.');
  if(settings.bundleId && !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(settings.bundleId))throw new Error('Bundle ID không hợp lệ.');
  if(settings.version && !/^\d+(?:\.\d+){0,3}$/.test(settings.version))throw new Error('Phiên bản không hợp lệ.');
  return settings;
}

export async function prepareImages(files,work) {
  for(const image of [...(files.icon || []),...(files.screenshots || [])]) {
    if(image.size>8*1024**2)throw new Error('Mỗi ảnh tối đa 8 MB.');
    const bytes=await readFile(image.path);
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if((path.extname(image.path)==='.png' && !png) || (path.extname(image.path)!=='.png' && !jpg))throw new Error('Ảnh không đúng định dạng PNG/JPEG.');
    if(image.fieldname==='icon') {
      const normalized=path.join(work,'normalized-icon.png');
      await prepareAppIcon(image.path,normalized);
      image.path=normalized;
    }
  }
}

export async function publishResult({id,work,files,settings,baseURL,configuredBase,publicRoot,meta={},target=null,sourceInfo=null}) {
  const previous=target?.record;
  if(previous)id=previous.id;
  const revision=previous?randomUUID():null;
  const suffix=revision?'?revision='+revision:'';
  const fileURL=name=>`${baseURL}/files/${id}/${name}${suffix}`;
  const result=path.join(work,'result');
  const info=sourceInfo || await readAppInfo(path.join(result,'app.ipa'));
  const bundleId=info.CFBundleIdentifier,version=info.CFBundleShortVersionString || info.CFBundleVersion,buildVersion=info.CFBundleVersion,name=info.CFBundleDisplayName || info.CFBundleName;
  if([name,version,bundleId,buildVersion].some(value=>typeof value!=='string' || !value))throw new Error('IPA không có đủ tên, Bundle ID và phiên bản để tạo trang cài đặt.');
  if(previous)validateUpdate(info,previous);
  const signed=await stat(path.join(result,'app.ipa'));
  if(signed.size<22)throw new Error('Không có file IPA hợp lệ để phát hành.');
  let iconImage='assets/app-default.svg';
  if(files.icon) {await copyFile(files.icon[0].path,path.join(result,'icon.png'));iconImage=fileURL('icon.png');}
  else if(previous) {
    try {await copyFile(path.join(target.files,'icon.png'),path.join(result,'icon.png'));iconImage=fileURL('icon.png');}
    catch(error){if(error.code!=='ENOENT')throw error;iconImage=previous.iconImage || iconImage;}
  }
  else if(typeof meta.IconName==='string' && /^[\w-]+\.png$/i.test(meta.IconName)) {await copyFile(path.join(work,'metadata',meta.IconName),path.join(result,'icon.png'));iconImage=fileURL('icon.png');}
  const screenshots=[];
  for(const [index,image] of (files.screenshots || []).entries()) {
    const ext=path.extname(image.path)==='.png'?'png':'jpg';const filename=`preview-${index}.${ext}`;
    await copyFile(image.path,path.join(result,filename));screenshots.push(fileURL(filename));
  }
  if(previous && !files.screenshots)for(const image of previous.screenshots || []) {
    const filename=path.posix.basename(new URL(image,baseURL).pathname);
    if(!/^preview-[0-4]\.(png|jpg)$/.test(filename))continue;
    await copyFile(path.join(target.files,filename),path.join(result,filename));screenshots.push(fileURL(filename));
  }
  const record={id,name,version,buildVersion,bundleId,minimumIOS:info.MinimumOSVersion || null,subtitle:settings.subtitle || 'Ứng dụng dành cho iPhone & iPad',description:settings.description,category:settings.category,developer:settings.developer || 'Nhà phát triển ứng dụng',iconImage,screenshots,size:signed.size,releaseNotes:settings.releaseNotes.split('\n').filter(Boolean),file:`${baseURL}/files/${id}/app.ipa`,manifestUrl:configuredBase?`${baseURL}/files/${id}/manifest.plist`:null,sample:false,generated:true,installUnavailable:!configuredBase?'Trang đang chạy cục bộ. Cần tên miền HTTPS để cài trực tiếp trên iPhone.':null,createdAt:Date.now()};
  if(previous)Object.assign(record,{contentRevision:revision,createdAt:previous.createdAt || record.createdAt,updatedAt:Date.now(),file:fileURL('app.ipa'),manifestUrl:configuredBase?fileURL('manifest.plist'):null});
  record.releaseNotes=settings.releaseNotes.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  await writeFile(path.join(result,'app.json'),JSON.stringify(record,null,2));
  await writeFile(path.join(result,'manifest.plist'),manifestXML({baseURL,id,bundleId,version:buildVersion,name,revision}));
  if(previous) {
    const revisions=path.join(target.directory,'revisions');await mkdir(revisions,{recursive:true});
    const destination=path.join(revisions,revision),pointer=path.join(target.directory,`.update-${revision}.json`);
    let committed=false;
    try {
      await rename(result,destination);
      await writeFile(pointer,JSON.stringify(record,null,2),{flag:'wx'});
      // A single metadata rename commits the complete revision. Existing downloads remain available.
      await rename(pointer,path.join(target.directory,'app.json'));committed=true;
    } finally {
      await rm(pointer,{force:true});
      if(!committed)await rm(destination,{recursive:true,force:true});
    }
  } else await rename(result,path.join(publicRoot,id));
  return {id,appId:id,status:'complete',updated:!!previous,createdAt:record.updatedAt || record.createdAt,name,installUrl:`${baseURL}/index.html?job=${id}`,downloadUrl:record.file,otaReady:!!configuredBase};
}
