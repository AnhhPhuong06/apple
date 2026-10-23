import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';

export async function listPublishedApps(directory) {
  const apps=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(!entry.isDirectory() || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.name))continue;
    try {
      const file=path.join(directory,entry.name,'app.json');
      const app=JSON.parse(await readFile(file,'utf8'));
      if(app.id!==entry.name || typeof app.name!=='string')continue;
      const fileInfo=await stat(file);
      // Return only information needed by the lists, never signer inputs or arbitrary metadata.
      apps.push({id:app.id,name:app.name,subtitle:app.subtitle || '',version:app.version || '',buildVersion:app.buildVersion || '',developer:app.developer || '',category:app.category || 'Tiện ích',iconImage:app.iconImage || 'assets/app-default.svg',size:app.size || null,createdAt:Number.isFinite(app.createdAt)?app.createdAt:fileInfo.mtimeMs,updatedAt:app.updatedAt || null,generated:true,installUrl:`index.html?job=${encodeURIComponent(app.id)}`,otaReady:!!app.manifestUrl});
    } catch(error) {if(error.code==='ENOENT' || error instanceof SyntaxError)continue;throw error;}
  }
  return apps.sort((a,b)=>(b.updatedAt || b.createdAt)-(a.updatedAt || a.createdAt) || a.id.localeCompare(b.id));
}
