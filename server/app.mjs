import express from 'express';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,copyFile,rename,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateArchive,readAppInfo,runZsign,signArguments,manifestXML} from './signing.mjs';
import {createAdminAuth} from './auth.mjs';
import {listPublishedApps} from './catalog.mjs';
import {prepareAppIcon} from './images.mjs';
import {publicOrigin} from './config.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
export async function createApp(options={}) {
  const port=Number(options.port || process.env.PORT || 4173);
  const host=options.host || process.env.HOST || '127.0.0.1';
  const token=options.token ?? process.env.ADMIN_TOKEN ?? '';
  const configuredBase=publicOrigin(options.baseURL);
  const baseURL=configuredBase || `http://127.0.0.1:${port}`;
  const data=path.resolve(options.dataDir || process.env.DATA_DIR || path.join(root,'data'));
  const privateRoot=path.join(data,'private'), publicRoot=path.join(data,'published');
  const binary=options.binary || process.env.ZSIGN_BIN || path.join(root,'tools','zsign',process.platform==='win32'?'zsign.exe':'zsign');
  const signer=options.signer || ((args,work)=>runZsign(binary,args,{cwd:work}));
  await mkdir(privateRoot,{recursive:true,mode:0o700}); await mkdir(publicRoot,{recursive:true});
  // Only one server should use a DATA_DIR. Remove interrupted uploads on startup.
  for(const name of await readdir(privateRoot)) if(/^[0-9a-f-]{36}$/.test(name)) await rm(path.join(privateRoot,name),{recursive:true,force:true});
  let busy=false; let signerReady=false; const jobs=new Map();
  try { await runZsign(binary,['--version'],{timeout:10000}); signerReady=true; } catch { /* shown by /api/health */ }
  if(options.signer) signerReady=true;
  const app=express(); app.disable('x-powered-by');
  app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');res.set('X-Frame-Options','DENY');next();});
  app.get('/healthz',(req,res)=>res.set('Cache-Control','no-store').status(signerReady?200:503).json({status:signerReady?'ok':'unavailable'}));
  const auth=await createAdminAuth({token,data,baseURL,port,secure:!!configuredBase,root});
  const {admin}=auth;
  auth.mount(app);
  app.get('/api/health',admin,(req,res)=>res.json({signerReady,otaReady:!!configuredBase,maxUploadMB:512,busy}));
  app.get('/api/admin/apps',admin,async(req,res)=>res.json({apps:await listPublishedApps(publicRoot)}));
  app.get('/api/apps',async(req,res)=>res.set('Cache-Control','no-store').json({apps:await listPublishedApps(publicRoot)}));
  app.get('/api/jobs/:id',admin,(req,res)=>{const job=jobs.get(req.params.id);return job?res.json(job):res.status(404).json({error:'Không tìm thấy phiên ký. Nếu máy chủ vừa khởi động lại, hãy dùng link trang cài đã lưu.'});});
  const validID=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
  app.get('/api/apps/:id',async(req,res)=>{
    if(!validID(req.params.id)) return res.status(404).json({error:'Không tìm thấy ứng dụng.'});
    try {const metadata=JSON.parse(await readFile(path.join(publicRoot,req.params.id,'app.json'),'utf8'));res.set('Cache-Control','no-store').json(metadata);} catch {res.status(404).json({error:'Không tìm thấy ứng dụng.'});}
  });
  app.get('/files/:id/:name',async(req,res)=>{
    if(!validID(req.params.id) || !/^(app\.ipa|manifest\.plist|icon\.png|preview-[0-4]\.(png|jpg))$/.test(req.params.name)) return res.sendStatus(404);
    const file=path.join(publicRoot,req.params.id,req.params.name);
    try {await stat(file);if(req.params.name==='manifest.plist') res.type('text/xml');if(req.params.name==='app.ipa') res.attachment('app.ipa');res.sendFile(file);} catch {res.sendStatus(404);}
  });
  const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,req.work),filename:(req,file,cb)=>cb(null,randomUUID()+path.extname(file.originalname).toLowerCase())});
  const upload=multer({storage,limits:{fileSize:512*1024**2,files:9,fields:12,fieldSize:12000,parts:21},fileFilter:(req,file,cb)=>{
    const ext=path.extname(file.originalname).toLowerCase();
    const extensions={ipa:['.ipa'],p12:['.p12'],profile:['.mobileprovision'],icon:['.png','.jpg','.jpeg'],screenshots:['.png','.jpg','.jpeg']};
    cb(extensions[file.fieldname]?.includes(ext)?null:new Error('Định dạng tệp không phù hợp.'),true);
  }}).fields([{name:'ipa',maxCount:1},{name:'p12',maxCount:1},{name:'profile',maxCount:1},{name:'icon',maxCount:1},{name:'screenshots',maxCount:5}]);
  const clearWork=async(work)=>{if(path.dirname(path.resolve(work))!==privateRoot) throw new Error('Unsafe private cleanup');await rm(work,{recursive:true,force:true});};
  app.post('/api/sign',admin,async(req,res)=>{
    if(!signerReady) return res.status(503).json({error:'Chưa có công cụ ký trên máy chủ. Chạy npm run setup:signer.'});
    if(busy) return res.status(429).json({error:'Máy chủ đang xử lý một ứng dụng. Hãy đợi phiên ký hiện tại hoàn tất.'});
    busy=true;
    const id=randomUUID();req.work=path.join(privateRoot,id);await mkdir(req.work,{mode:0o700});
    upload(req,res,async error=>{
      try {
        if(error) throw new Error(error instanceof multer.MulterError?'Tệp quá lớn hoặc số lượng tệp vượt giới hạn.':error.message);
        const files=req.files || {}; const body=req.body || {};
        for(const key of ['ipa','p12','profile']) if(!files[key]?.length) throw new Error('Cần đủ file IPA, chứng chỉ .p12 và hồ sơ .mobileprovision.');
        if(files.p12[0].size>1024**2 || files.profile[0].size>10*1024**2) throw new Error('Chứng chỉ hoặc hồ sơ có dung lượng quá lớn.');
        const text=(key,max)=>{if(body[key]!==undefined && typeof body[key]!=='string') throw new Error('Trường nhập không hợp lệ.');const value=(body[key] || '').trim();if(value.length>max || /\x00/.test(value)) throw new Error('Nội dung nhập vượt giới hạn.');return value;};
        const settings={name:text('name',60),bundleId:text('bundleId',200),version:text('version',24),subtitle:text('subtitle',100),description:text('description',3000),developer:text('developer',100),releaseNotes:text('releaseNotes',2000),category:text('category',30) || 'Tiện ích'};
        if(!['Năng suất','Sáng tạo','Giải trí','Tiện ích'].includes(settings.category)) throw new Error('Danh mục không hợp lệ.');
        if(settings.bundleId && !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(settings.bundleId)) throw new Error('Bundle ID không hợp lệ.');
        if(settings.version && !/^\d+(?:\.\d+){0,3}$/.test(settings.version)) throw new Error('Phiên bản không hợp lệ.');
        if(typeof body.password!=='string' || body.password.length>1024 || body.password.includes('\0')) throw new Error('Mật khẩu chứng chỉ không hợp lệ.');
        for(const image of [...(files.icon || []),...(files.screenshots || [])]) {
          if(image.size>8*1024**2) throw new Error('Mỗi ảnh tối đa 8 MB.');
          const bytes=await readFile(image.path); const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])); const jpg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
          if((path.extname(image.path)==='.png' && !png) || (path.extname(image.path)!=='.png' && !jpg)) throw new Error('Ảnh không đúng định dạng PNG/JPEG.');
          if(image.fieldname==='icon') {
            const normalized=path.join(req.work,'normalized-icon.png');
            await prepareAppIcon(image.path,normalized);
            image.path=normalized;
          }
        }
        await validateArchive(files.ipa[0].path);
        const work=req.work; const password=body.password; delete body.password;
        // The accepted job survives a closed browser; sensitive uploads are removed in finally.
        for(const [key,job] of jobs) if(Date.now()-job.createdAt>86400000) jobs.delete(key);
        jobs.set(id,{id,status:'signing',createdAt:Date.now()});
        res.status(202).json({id,status:'signing'});
        try {
          await mkdir(path.join(work,'result')); await mkdir(path.join(work,'metadata')); await mkdir(path.join(work,'unpack'));
          const args=signArguments({work,password,settings,files});
          try {await signer(args,work);} finally {args.fill('');}
          const meta=JSON.parse(await readFile(path.join(work,'metadata','metadata.json'),'utf8'));
          const info=await readAppInfo(path.join(work,'result','app.ipa'));
          const bundleId=info.CFBundleIdentifier, version=info.CFBundleShortVersionString || info.CFBundleVersion, buildVersion=info.CFBundleVersion, name=info.CFBundleDisplayName || info.CFBundleName;
          if(typeof name!=='string' || typeof version!=='string' || typeof bundleId!=='string' || !name || !version || !bundleId) throw new Error('Công cụ ký không trả về đủ thông tin ứng dụng.');
          const result=path.join(work,'result');const signed=await stat(path.join(result,'app.ipa'));if(signed.size<22) throw new Error('Không tạo được file IPA đã ký.');
          let iconImage='assets/app-default.svg';
          if(files.icon) {await copyFile(files.icon[0].path,path.join(result,'icon.png'));iconImage=`${baseURL}/files/${id}/icon.png`;}
          else if(typeof meta.IconName==='string' && /^[\w-]+\.png$/i.test(meta.IconName)) {await copyFile(path.join(work,'metadata',meta.IconName),path.join(result,'icon.png'));iconImage=`${baseURL}/files/${id}/icon.png`;}
          const screenshots=[];
          for(const [index,image] of (files.screenshots || []).entries()) {const ext=path.extname(image.path)==='.png'?'png':'jpg';const filename=`preview-${index}.${ext}`;await copyFile(image.path,path.join(result,filename));screenshots.push(`${baseURL}/files/${id}/${filename}`);}
          if(typeof buildVersion!=='string' || !buildVersion) throw new Error('Ứng dụng thiếu CFBundleVersion để tạo manifest.');
          const record={id,name,version,buildVersion,bundleId,minimumIOS:info.MinimumOSVersion || null,subtitle:settings.subtitle || 'Ứng dụng dành cho iPhone & iPad',description:settings.description,category:settings.category,developer:settings.developer || 'Nhà phát triển ứng dụng',iconImage,screenshots,size:signed.size,releaseNotes:settings.releaseNotes.split('\n').filter(Boolean),file:`${baseURL}/files/${id}/app.ipa`,manifestUrl:configuredBase?`${baseURL}/files/${id}/manifest.plist`:null,sample:false,generated:true,installUnavailable:!configuredBase?'Trang đang chạy cục bộ. Cần tên miền HTTPS để cài trực tiếp trên iPhone.':null};
          record.createdAt=Date.now();
          await writeFile(path.join(result,'app.json'),JSON.stringify(record,null,2));
          await writeFile(path.join(result,'manifest.plist'),manifestXML({baseURL,id,bundleId,version:buildVersion,name}));
          await rename(result,path.join(publicRoot,id));
          jobs.set(id,{id,status:'complete',createdAt:Date.now(),name,installUrl:`${baseURL}/index.html?job=${id}`,downloadUrl:record.file,otaReady:!!configuredBase});
        } catch(error) {jobs.set(id,{id,status:'failed',createdAt:Date.now(),error:error.message.startsWith('ENOENT')?'Không nhận được kết quả từ công cụ ký.':error.message});}
        finally {busy=false;await clearWork(work);}
      } catch(error) {busy=false;await clearWork(req.work);if(!res.headersSent) res.status(400).json({error:error.message});}
    });
  });
  const publicFiles=['index.html','appstore.css','app.js','apps.js','shared.js','favicon.svg','sign.css','sign.js','admin-apps.js','catalog.css','catalog.js','admin-login.css','admin-login.js'];
  const catalogPage=async(req,res)=>res.set('Cache-Control','no-store').type('html').send((await readFile(path.join(root,'catalog.html'),'utf8')).replace('data-source="static"','data-source="server"'));
  app.get('/',(req,res,next)=>req.query.job || req.query.app?res.sendFile(path.join(root,'index.html')):catalogPage(req,res).catch(next));
  app.get('/catalog.html',catalogPage);
  app.get('/admin',auth.page,(req,res)=>res.sendFile(path.join(root,'sign.html')));
  app.get(['/sign.html','/manage.html'],(req,res)=>res.redirect('/admin'));
  app.get('/apple',(req,res)=>res.redirect('/index.html'));
  app.get('/apple/',(req,res)=>res.redirect('/index.html'));
  for(const file of publicFiles) app.get('/'+file,(req,res)=>res.sendFile(path.join(root,file)));
  app.use('/assets',express.static(path.join(root,'assets'),{dotfiles:'deny',index:false}));
  app.use((req,res)=>res.status(404).json({error:'Không tìm thấy trang.'}));
  app.use((error,req,res,next)=>{if(!res.headersSent) res.status(500).json({error:'Máy chủ không xử lý được yêu cầu.'});});
  return {app,host,port};
}
