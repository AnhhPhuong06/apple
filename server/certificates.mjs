import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';

export function mountCertificateRoutes(app,{admin,vault,privateRoot}) {
  const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,req.certificateWork),filename:(req,file,cb)=>cb(null,file.fieldname==='p12'?'identity.p12':'identity.mobileprovision')});
  const upload=multer({storage,limits:{fileSize:10*1024**2,files:2,fields:2,fieldSize:4096,parts:4},fileFilter:(req,file,cb)=>{
    const valid={p12:'.p12',profile:'.mobileprovision'}[file.fieldname]===path.extname(file.originalname).toLowerCase();
    cb(valid?null:new Error('Chỉ nhận file .p12 và .mobileprovision đúng trường tương ứng.'),valid);
  }}).fields([{name:'p12',maxCount:1},{name:'profile',maxCount:1}]);
  const failure=(res,error)=>res.status(error.status || (error.code?500:400)).json({error:error.code?'Không xử lý được kho chứng chỉ. Kiểm tra dung lượng và quyền thư mục dữ liệu.':error.message});
  app.get('/api/admin/certificates',admin,async(req,res)=>{try{res.json({certificates:await vault.list()});}catch(error){failure(res,error);}});
  app.post('/api/admin/certificates',admin,async(req,res)=>{
    const work=path.resolve(privateRoot,randomUUID());
    if(path.dirname(work)!==privateRoot)return res.sendStatus(500);
    try{await mkdir(work,{mode:0o700});}catch{return res.status(500).json({error:'Không tạo được thư mục kiểm tra chứng chỉ.'});}
    req.certificateWork=work;
    upload(req,res,async error=>{
      let result,problem;
      try{
        if(error)throw new Error(error instanceof multer.MulterError?'Chứng chỉ tối đa 1 MB; hồ sơ tối đa 10 MB. Kiểm tra số lượng và dung lượng tệp.':error.message);
        const files=req.files || {},body=req.body || {};
        if(!files.p12?.length || !files.profile?.length)throw new Error('Cần đủ .p12 và .mobileprovision để lưu bộ chứng chỉ.');
        if(files.p12[0].size>1024**2)throw new Error('Chứng chỉ .p12 tối đa 1 MB.');
        if(body.password!==undefined && typeof body.password!=='string')throw new Error('Mật khẩu chứng chỉ không hợp lệ.');
        if(body.label!==undefined && typeof body.label!=='string')throw new Error('Tên lưu chứng chỉ không hợp lệ.');
        result=await vault.save({p12:files.p12[0].path,profile:files.profile[0].path,password:body.password || '',label:body.label || '',work});
      }catch(error){problem=error;}
      finally{try{await rm(work,{recursive:true,force:true});}catch{problem=Object.assign(new Error('Không dọn được dữ liệu chứng chỉ tạm. Kiểm tra quyền thư mục dữ liệu trên máy chủ.'),{status:500});}}
      if(problem)return failure(res,problem);
      res.status(201).json(result);
    });
  });
  app.post('/api/admin/certificates/:id/check',admin,async(req,res)=>{try{res.json(await vault.check(req.params.id));}catch(error){failure(res,error);}});
  app.delete('/api/admin/certificates/:id',admin,async(req,res)=>{try{res.json(await vault.remove(req.params.id));}catch(error){failure(res,error);}});
}
