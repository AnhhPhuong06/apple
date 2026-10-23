import {mkdir,readdir,readFile,writeFile,copyFile,lstat,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {manifestXML,readAppInfo,validateArchive} from '../server/signing.mjs';
import {publicOrigin} from '../server/config.mjs';

export async function importPublicApps(source,dataDir,origin) {
  const baseURL=publicOrigin(origin,{});if(!baseURL)throw new Error('An HTTPS origin is required.');
  const published=path.join(path.resolve(dataDir),'published');await mkdir(published,{recursive:true});
  let entries=[];try{entries=await readdir(source,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  let imported=0,skipped=0;
  for(const entry of entries) {
    if(!entry.isDirectory() || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.name))throw new Error('Unexpected exported app directory.');
    const id=entry.name,destination=path.join(published,id),from=path.join(source,id);
    try {await lstat(path.join(path.resolve(dataDir),'deleted-apps',id+'.json'));skipped++;continue;}catch(error){if(error.code!=='ENOENT')throw error;}
    try {await lstat(destination);skipped++;continue;}catch(error){if(error.code!=='ENOENT')throw error;}
    const temp=path.join(published,`.import-${randomUUID()}`);await mkdir(temp,{mode:0o700});
    try {
      const files=await readdir(from);
      for(const file of files) {
        if(!/^(app\.(json|ipa)|manifest\.plist|icon\.png|preview-[0-4]\.(png|jpg))$/.test(file) || !(await lstat(path.join(from,file))).isFile())throw new Error('Unexpected file in exported app.');
      }
      const original=JSON.parse(await readFile(path.join(from,'app.json'),'utf8'));
      if(original.id!==id)throw new Error('App ID does not match folder.');
      const ipa=path.join(from,'app.ipa');await validateArchive(ipa);const info=await readAppInfo(ipa);
      if(!info.CFBundleIdentifier || !info.CFBundleVersion || !(info.CFBundleDisplayName || info.CFBundleName))throw new Error('Invalid signed app metadata.');
      const imageFiles=files.filter(file=>/^(icon\.png|preview-[0-4]\.(png|jpg))$/.test(file));
      for(const file of ['app.ipa',...imageFiles])await copyFile(path.join(from,file),path.join(temp,file));
      const app={id,name:info.CFBundleDisplayName || info.CFBundleName,version:info.CFBundleShortVersionString || info.CFBundleVersion,buildVersion:info.CFBundleVersion,bundleId:info.CFBundleIdentifier,minimumIOS:info.MinimumOSVersion || null,subtitle:original.subtitle || '',description:original.description || '',category:original.category || 'Tiện ích',developer:original.developer || '',size:(await stat(ipa)).size,releaseNotes:Array.isArray(original.releaseNotes)?original.releaseNotes:[],createdAt:original.createdAt || Date.now(),sample:false,generated:true,iconImage:imageFiles.includes('icon.png')?`${baseURL}/files/${id}/icon.png`:'assets/app-default.svg',screenshots:imageFiles.filter(file=>file.startsWith('preview-')).sort().map(file=>`${baseURL}/files/${id}/${file}`),file:`${baseURL}/files/${id}/app.ipa`,manifestUrl:`${baseURL}/files/${id}/manifest.plist`};
      await writeFile(path.join(temp,'app.json'),JSON.stringify(app,null,2)+'\n');
      await writeFile(path.join(temp,'manifest.plist'),manifestXML({baseURL,id,bundleId:app.bundleId,version:app.buildVersion,name:app.name}));
      await rename(temp,destination);imported++;
    } finally {await rm(temp,{recursive:true,force:true});}
  }
  return {imported,skipped};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source,dataDir,origin]=process.argv.slice(2);
  if(!source || !dataDir || !origin)throw new Error('Usage: node deploy/import-public-apps.mjs SOURCE DATA_DIR https://domain');
  console.log(await importPublicApps(source,dataDir,origin));
}
