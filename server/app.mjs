import express from 'express';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,lstat,copyFile,rename,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateArchive,readAppInfo,runZsign,signArguments} from './signing.mjs';
import {createAdminAuth} from './auth.mjs';
import {listPublishedApps} from './catalog.mjs';
import {presentationSettings,prepareImages,publishResult} from './publishing.mjs';
import {publicOrigin} from './config.mjs';
import {readSiteSettings,saveSiteSettings} from './site-settings.mjs';
import {createCertificateVault} from './certificate-vault.mjs';
import {mountCertificateRoutes} from './certificates.mjs';
import {appSnapshot,updateTarget,validAppID} from './app-revisions.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
export async function createApp(options={}) {
  const port=Number(options.port || process.env.PORT || 4173);
  const host=options.host || process.env.HOST || '127.0.0.1';
  const token=options.token ?? process.env.ADMIN_TOKEN ?? '';
  const configuredBase=publicOrigin(options.baseURL);
  const baseURL=configuredBase || `http://127.0.0.1:${port}`;
  const data=path.resolve(options.dataDir || process.env.DATA_DIR || path.join(root,'data'));
  const privateRoot=path.join(data,'private'), publicRoot=path.join(data,'published'),deletedRoot=path.join(data,'deleted-apps');
  const binary=options.binary || process.env.ZSIGN_BIN || path.join(root,'tools','zsign',process.platform==='win32'?'zsign.exe':'zsign');
  const signer=options.signer || ((args,work)=>runZsign(binary,args,{cwd:work}));
  await mkdir(privateRoot,{recursive:true,mode:0o700}); await mkdir(publicRoot,{recursive:true});await mkdir(deletedRoot,{recursive:true,mode:0o700});
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
  const vault=await createCertificateVault({data,privateRoot,inspector:options.certificateInspector,policy:options.certificatePolicy});
  mountCertificateRoutes(app,{admin,vault,privateRoot});
  app.get('/site-settings.json',async(req,res)=>res.set('Cache-Control','no-store').json(await readSiteSettings(data,root)));
  app.put('/api/admin/site-settings',admin,express.json({limit:'4kb'}),async(req,res,next)=>{
    try {res.json(await saveSiteSettings(data,req.body));}
    catch(error){if(error.code)return next(error);res.status(400).json({error:error.message});}
  });
  app.get('/api/health',admin,(req,res)=>res.json({signerReady,otaReady:!!configuredBase,maxUploadMB:512,busy}));
  app.get('/api/admin/apps',admin,async(req,res)=>res.json({apps:await listPublishedApps(publicRoot)}));
  app.get('/api/apps',async(req,res)=>res.set('Cache-Control','no-store').json({apps:await listPublishedApps(publicRoot)}));
  app.get('/api/jobs/:id',admin,(req,res)=>{const job=jobs.get(req.params.id);return job?res.json(job):res.status(404).json({error:'Không tìm thấy phiên ký. Nếu máy chủ vừa khởi động lại, hãy dùng link trang cài đã lưu.'});});
  const validID=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
  app.delete('/api/admin/apps/:id',admin,async(req,res,next)=>{
    if(busy)return res.status(409).json({error:'Hãy chờ xử lý ứng dụng hoàn tất rồi xóa app.'});
    const id=req.params.id;
    if(!validID(id))return res.status(404).json({error:'Không tìm thấy ứng dụng.'});
    const directory=path.resolve(publicRoot,id);
    if(path.dirname(directory)!==publicRoot)return res.status(404).json({error:'Không tìm thấy ứng dụng.'});
    busy=true;
    try {
      const entry=await lstat(directory);
      if(!entry.isDirectory() || entry.isSymbolicLink())return res.status(404).json({error:'Không tìm thấy ứng dụng.'});
      // Unpublish atomically before removing files, so public routes stop serving the app.
      const trash=path.resolve(privateRoot,randomUUID());
      if(path.dirname(trash)!==privateRoot)throw new Error('Unsafe deletion path');
      // Keep a tombstone so a later VPS update does not reimport a removed bundled app.
      try{await writeFile(path.join(deletedRoot,id+'.json'),JSON.stringify({id,deletedAt:Date.now()}),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
      await rename(directory,trash);
      jobs.delete(id);
      try {await rm(trash,{recursive:true,force:true});}
      catch {console.warn('App unpublished; pending file cleanup will retry at the next server start.');}
      res.json({ok:true,id});
    } catch(error) {if(error.code==='ENOENT')return res.status(404).json({error:'Không tìm thấy ứng dụng.'});next(error);}finally{busy=false;}
  });
  app.get('/api/apps/:id',async(req,res)=>{
    if(!validID(req.params.id)) return res.status(404).json({error:'Không tìm thấy ứng dụng.'});
    try {const metadata=JSON.parse(await readFile(path.join(publicRoot,req.params.id,'app.json'),'utf8'));res.set('Cache-Control','no-store').json(metadata);} catch {res.status(404).json({error:'Không tìm thấy ứng dụng.'});}
  });
  app.get('/files/:id/:name',async(req,res)=>{
    if(!validID(req.params.id) || !/^(app\.ipa|manifest\.plist|icon\.png|preview-[0-4]\.(png|jpg))$/.test(req.params.name)) return res.sendStatus(404);
    try {
      const snapshot=await appSnapshot(publicRoot,req.params.id),revision=req.query.revision;
      if(revision!==undefined && !validAppID(revision))return res.sendStatus(404);
      const directory=revision?path.join(snapshot.directory,'revisions',revision):snapshot.files;
      if(revision && revision!==snapshot.record.contentRevision) {
        const metadata=JSON.parse(await readFile(path.join(directory,'app.json'),'utf8'));
        if(metadata.id!==req.params.id || metadata.contentRevision!==revision)return res.sendStatus(404);
      }
      const file=path.join(directory,req.params.name);await stat(file);
      res.set('Cache-Control','no-store');
      if(req.params.name==='manifest.plist')res.type('text/xml');if(req.params.name==='app.ipa')res.attachment('app.ipa');res.sendFile(file);
    } catch {res.sendStatus(404);}
  });
  const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,req.work),filename:(req,file,cb)=>cb(null,randomUUID()+path.extname(file.originalname).toLowerCase())});
  const upload=multer({storage,limits:{fileSize:512*1024**2,files:9,fields:12,fieldSize:12000,parts:21},fileFilter:(req,file,cb)=>{
    const ext=path.extname(file.originalname).toLowerCase();
    const extensions={ipa:['.ipa'],p12:['.p12'],profile:['.mobileprovision'],icon:['.png','.jpg','.jpeg'],screenshots:['.png','.jpg','.jpeg']};
    cb(extensions[file.fieldname]?.includes(ext)?null:new Error('Định dạng tệp không phù hợp.'),true);
  }}).fields([{name:'ipa',maxCount:1},{name:'p12',maxCount:1},{name:'profile',maxCount:1},{name:'icon',maxCount:1},{name:'screenshots',maxCount:5}]);
  const clearWork=async(work)=>{if(path.dirname(path.resolve(work))!==privateRoot) throw new Error('Unsafe private cleanup');await rm(work,{recursive:true,force:true});};
  app.post('/api/admin/apps',admin,async(req,res)=>{
    if(busy)return res.status(429).json({error:'Máy chủ đang xử lý một ứng dụng. Hãy đợi hoàn tất rồi thêm app.'});
    busy=true;
    const id=randomUUID();req.work=path.join(privateRoot,id);
    try {await mkdir(req.work,{mode:0o700});}catch {busy=false;return res.status(500).json({error:'Không tạo được thư mục tải lên.'});}
    upload(req,res,async error=>{
      let result,failure;
      try {
        if(error)throw new Error(error instanceof multer.MulterError?'Tệp quá lớn hoặc số lượng tệp vượt giới hạn.':error.message);
        const files=req.files || {},body=req.body || {};
        if(!files.ipa?.length)throw new Error('Hãy chọn file IPA đã ký để thêm ứng dụng.');
        if(files.p12 || files.profile || body.password)throw new Error('Đăng IPA đã ký không cần chứng chỉ hoặc mật khẩu. Dùng chế độ ký mới nếu cần ký lại app.');
        const settings=presentationSettings(body);
        const target=await updateTarget(publicRoot,body,settings);
        if(settings.name || settings.version || settings.bundleId)throw new Error('Tên, phiên bản và Bundle ID được đọc từ IPA đã ký. Chọn ký mới nếu cần thay đổi.');
        await validateArchive(files.ipa[0].path);
        await prepareImages(files,req.work);
        await mkdir(path.join(req.work,'result'));
        await copyFile(files.ipa[0].path,path.join(req.work,'result','app.ipa'));
        result=await publishResult({id,work:req.work,files,settings,baseURL,configuredBase,publicRoot,target});
      }catch(error){failure=error.code?'Không xử lý được file ứng dụng. Vui lòng thử lại.':error.message;}
      finally{try{await clearWork(req.work);}catch{console.warn('Pending upload cleanup will retry at the next server start.');}busy=false;}
      if(failure)return res.status(400).json({error:failure});
      res.status(201).json(result);
    });
  });
  app.post('/api/sign',admin,async(req,res)=>{
    if(!signerReady) return res.status(503).json({error:'Chưa có công cụ ký trên máy chủ. Chạy npm run setup:signer.'});
    if(busy) return res.status(429).json({error:'Máy chủ đang xử lý một ứng dụng. Hãy đợi phiên ký hiện tại hoàn tất.'});
    busy=true;
    const id=randomUUID();req.work=path.join(privateRoot,id);await mkdir(req.work,{mode:0o700});
    upload(req,res,async error=>{
      try {
        if(error) throw new Error(error instanceof multer.MulterError?'Tệp quá lớn hoặc số lượng tệp vượt giới hạn.':error.message);
        const files=req.files || {}; const body=req.body || {};
        if(!files.ipa?.length)throw new Error('Hãy chọn file IPA để ký ứng dụng.');
        const settings=presentationSettings(body);
        const target=await updateTarget(publicRoot,body,settings);
        await prepareImages(files,req.work);
        await validateArchive(files.ipa[0].path);
        if(target && (await readAppInfo(files.ipa[0].path)).CFBundleIdentifier!==target.record.bundleId)throw new Error('IPA mới phải có cùng Bundle ID với app đang cập nhật.');
        let password;
        if(body.certificateId) {
          if(typeof body.certificateId!=='string' || files.p12 || files.profile || body.password)throw new Error('Chọn chứng chỉ trong kho hoặc tải chứng chỉ mới, không dùng đồng thời cả hai.');
          const appInfo=await readAppInfo(files.ipa[0].path);
          const saved=await vault.materialize(body.certificateId,req.work,settings.bundleId || appInfo.CFBundleIdentifier);
          files.p12=[{path:saved.p12}];files.profile=[{path:saved.profile}];password=saved.password;
        }else {
          for(const key of ['p12','profile'])if(!files[key]?.length)throw new Error('Cần đủ chứng chỉ .p12 và hồ sơ .mobileprovision, hoặc chọn một bộ đã lưu trong kho.');
          if(files.p12[0].size>1024**2 || files.profile[0].size>10*1024**2)throw new Error('Chứng chỉ hoặc hồ sơ có dung lượng quá lớn.');
          if(typeof body.password!=='string' || body.password.length>1024 || body.password.includes('\0'))throw new Error('Mật khẩu chứng chỉ không hợp lệ.');
          password=body.password;
        }
        const work=req.work;delete body.password;
        // The accepted job survives a closed browser; sensitive uploads are removed in finally.
        for(const [key,job] of jobs) if(Date.now()-job.createdAt>86400000) jobs.delete(key);
        jobs.set(id,{id,status:'signing',createdAt:Date.now()});
        res.status(202).json({id,status:'signing'});
        try {
          await mkdir(path.join(work,'result')); await mkdir(path.join(work,'metadata')); await mkdir(path.join(work,'unpack'));
          const args=signArguments({work,password,settings,files});
          try {await signer(args,work);} finally {args.fill('');}
          const meta=JSON.parse(await readFile(path.join(work,'metadata','metadata.json'),'utf8'));
          const published=await publishResult({id,work,files,settings,baseURL,configuredBase,publicRoot,meta,target});
          jobs.set(id,{...published,id});
        } catch(error) {jobs.set(id,{id,status:'failed',createdAt:Date.now(),error:error.message.startsWith('ENOENT')?'Không nhận được kết quả từ công cụ ký.':error.message});}
        finally {busy=false;await clearWork(work);}
      } catch(error) {busy=false;await clearWork(req.work);if(!res.headersSent) res.status(400).json({error:error.message});}
    });
  });
  const publicFiles=['index.html','appstore.css','app-data.js','app.js','apps.js','shared.js','site-logo.js','site-settings-admin.js','favicon.svg','sign.css','sign.js','admin-apps.js','certificates-admin.js','catalog.css','catalog.js','admin-login.css','admin-login.js'];
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
