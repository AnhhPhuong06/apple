import express from 'express';
import {mkdir,readdir,readFile,writeFile,rm,open,link} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {randomUUID,createHash,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {validAppID} from './app-revisions.mjs';

export const uploadChunkSize=8*1024**2;
const lifetime=24*60*60*1000,maxSize=512*1024**2,maxSessions=4;
const failure=(message,status=400)=>Object.assign(new Error(message),{status});

export async function createUploads({app,admin,data,publicBase='',uploadBase=''}) {
  const transferKey=randomBytes(32);
  const root=path.join(data,'uploads'),sessions=new Map();await mkdir(root,{recursive:true,mode:0o700});
  const directory=id=>path.join(root,id);
  const total=session=>Math.ceil(session.size/uploadChunkSize);
  const partSize=(session,index)=>Math.min(uploadChunkSize,session.size-index*uploadChunkSize);
  const validMetadata=record=>validAppID(record.id) && Number.isSafeInteger(record.size) && record.size>=22 && record.size<=maxSize && /^[a-f0-9]{64}$/.test(record.fingerprint) && Number.isFinite(record.expiresAt);
  async function discard(session){sessions.delete(session.id);await rm(directory(session.id),{recursive:true,force:true});}
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(!entry.isDirectory() || !validAppID(entry.name))continue;
    try {
      const record=JSON.parse(await readFile(path.join(directory(entry.name),'session.json'),'utf8'));
      if(record.id!==entry.name || !validMetadata(record) || record.expiresAt<=Date.now())throw Error('Expired upload');
      const session={...record,inflight:new Set(),received:new Map(),locked:false};
      for(let index=0;index<total(session);index++) {
        try {const receipt=JSON.parse(await readFile(path.join(directory(session.id),`part-${index}.json`),'utf8'));if(/^[a-f0-9]{64}$/.test(receipt.hash) && receipt.size===partSize(session,index))session.received.set(index,receipt.hash);}catch{/* An interrupted part must be uploaded again. */}
      }
      const file=await open(path.join(directory(session.id),'app.ipa'),'r');try{if((await file.stat()).size!==record.size)throw Error('Incomplete upload file');}finally{await file.close();}
      sessions.set(session.id,session);
    } catch {await rm(directory(entry.name),{recursive:true,force:true});}
  }
  function get(id) {
    const session=validAppID(id)?sessions.get(id):null;
    if(!session || session.expiresAt<=Date.now())throw failure('Phiên tải đã hết hạn. Hãy chọn lại file IPA.',404);
    return session;
  }
  const signature=(session,expires)=>createHmac('sha256',transferKey).update(`${session.id}.${session.size}.${session.fingerprint}.${expires}`).digest('hex');
  const transport=session=>{
    if(!uploadBase)return undefined;
    const expiresAt=Math.min(session.expiresAt,Date.now()+60*60*1000);
    return {origin:uploadBase,url:`${uploadBase}/api/transfer/${session.id}/chunks`,ticket:`${expiresAt}.${signature(session,expiresAt)}`,expiresAt};
  };
  const status=session=>({id:session.id,size:session.size,chunkSize:uploadChunkSize,parallel:uploadBase?6:3,transport:transport(session),expiresAt:session.expiresAt,received:[...session.received].map(([index,hash])=>({index,hash}))});
  const route=handler=>async(req,res)=>{try{await handler(req,res);}catch(error){if(!res.headersSent && !res.destroyed)res.status(error.status || 500).json({error:error.status?error.message:'Chưa xử lý được tệp tải lên. Vui lòng thử lại.'});}};
  // Serialize creation so concurrent requests cannot exceed the disk quota.
  let creating=Promise.resolve();
  app.post('/api/admin/uploads',admin,express.json({limit:'2kb'}),route(async(req,res)=>{
    let unlock;const previous=creating;creating=new Promise(resolve=>{unlock=resolve;});await previous;
    try {
      const {size,fingerprint,name}=req.body || {};
      if(!Number.isSafeInteger(size) || size<22 || size>maxSize || typeof fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(fingerprint) || typeof name!=='string' || name.length>200 || !/\.ipa$/i.test(name))throw failure('Chỉ nhận file IPA, tối đa 512 MB.');
      for(const session of sessions.values())if(session.expiresAt<=Date.now() && !session.locked && !session.inflight.size)await discard(session);
      const existing=[...sessions.values()].find(session=>session.fingerprint===fingerprint && session.size===size);
      if(existing)return res.json(status(existing));
      if(sessions.size>=maxSessions)throw failure('Có 4 IPA đang chờ. Hãy tiếp tục một file đã tải hoặc thử lại khi phiên tải cũ hết hạn.',429);
      const record={id:randomUUID(),size,fingerprint,expiresAt:Date.now()+lifetime};
      await mkdir(directory(record.id),{mode:0o700});
      try {
        const file=await open(path.join(directory(record.id),'app.ipa'),'wx',0o600);try{await file.truncate(size);}finally{await file.close();}
        await writeFile(path.join(directory(record.id),'session.json'),JSON.stringify(record),{flag:'wx',mode:0o600});
      }catch(error){await rm(directory(record.id),{recursive:true,force:true});throw error;}
      const session={...record,inflight:new Set(),received:new Map(),locked:false};sessions.set(record.id,session);res.status(201).json(status(session));
    }finally{unlock();}
  }));
  app.get('/api/admin/uploads/:id',admin,route(async(req,res)=>res.json(status(get(req.params.id)))));
  app.delete('/api/admin/uploads/:id',admin,route(async(req,res)=>{
    const session=get(req.params.id);if(session.locked || session.inflight.size)throw failure('Tệp đang được xử lý. Vui lòng chờ.',409);
    session.locked=true;await discard(session);res.json({ok:true});
  }));
  const receive=route(async(req,res)=>{
    const session=get(req.params.id),raw=req.params.index,index=Number(raw),hash=req.get('X-Chunk-SHA256');
    if(!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(index) || index>=total(session) || !/^[a-f0-9]{64}$/.test(hash || '') || !req.is('application/octet-stream'))throw failure('Phần tải lên không hợp lệ.');
    if(session.locked || session.inflight.has(index))throw failure('Phần tệp đang được xử lý. Vui lòng thử lại.',409);
    const expected=partSize(session,index);
    if(req.get('content-length') && Number(req.get('content-length'))!==expected)throw failure('Dung lượng phần tệp không khớp.');
    if(session.received.has(index)) {
      req.resume();if(session.received.get(index)!==hash)throw failure('Nội dung file đã thay đổi. Hãy tải lại file IPA.',409);
      return res.json({ok:true,index});
    }
    session.inflight.add(index);
    try {
      let size=0;const digest=createHash('sha256');
      const verify=new Transform({transform(bytes,encoding,callback){size+=bytes.length;if(size>expected)return callback(failure('Phần tệp vượt dung lượng cho phép.'));digest.update(bytes);callback(null,bytes);}});
      // Write disjoint ranges directly into one private file; no merge or extra full IPA copy.
      await pipeline(req,verify,createWriteStream(path.join(directory(session.id),'app.ipa'),{flags:'r+',start:index*uploadChunkSize,highWaterMark:256*1024}));
      if(size!==expected || digest.digest('hex')!==hash)throw failure('Phần tệp bị thiếu hoặc lỗi. Vui lòng thử lại.');
      await writeFile(path.join(directory(session.id),`part-${index}.json`),JSON.stringify({size,hash}),{mode:0o600});
      session.received.set(index,hash);res.status(201).json({ok:true,index});
    }finally{session.inflight.delete(index);}
  });
  app.put('/api/admin/uploads/:id/chunks/:index',admin,receive);
  function cors(req,res,next) {
    if(!uploadBase)return res.sendStatus(404);
    if(req.get('Origin')!==publicBase)return res.sendStatus(403);
    res.vary('Origin');res.set('Access-Control-Allow-Origin',publicBase);res.set('Cache-Control','no-store');
    next();
  }
  app.options(['/api/transfer/ping','/api/transfer/:id/chunks/:index'],cors,(req,res)=>{
    res.set('Access-Control-Allow-Methods','GET, PUT, OPTIONS');res.set('Access-Control-Allow-Headers','Content-Type, X-Chunk-SHA256, X-AppSpace-Upload-Ticket');res.set('Access-Control-Max-Age','600');res.sendStatus(204);
  });
  app.get('/api/transfer/ping',cors,(req,res)=>res.json({ok:true}));
  app.put('/api/transfer/:id/chunks/:index',cors,route(async(req,res)=>{
    const session=get(req.params.id),ticket=req.get('X-AppSpace-Upload-Ticket') || '',match=/^(\d{13})\.([a-f0-9]{64})$/.exec(ticket);
    const expires=Number(match?.[1]);
    if(!match || !Number.isSafeInteger(expires) || expires<=Date.now() || expires>session.expiresAt || !timingSafeEqual(Buffer.from(match[2],'hex'),Buffer.from(signature(session,expires),'hex')))throw failure('Phiên tải trực tiếp đã hết hạn. Hãy thử lại.',403);
    await receive(req,res);
  }));
  async function acquire(id,files,work) {
    if(id===undefined || id==='')return null;
    if(typeof id!=='string' || files.ipa)throw failure('Chọn tải IPA trực tiếp hoặc dùng tệp đã tải, không dùng đồng thời cả hai.');
    const session=get(id);
    if(session.locked || session.inflight.size)throw failure('Tệp đang được xử lý. Vui lòng thử lại.',409);
    if(session.received.size!==total(session))throw failure('IPA chưa tải đủ. Vui lòng tiếp tục tải phần còn thiếu.');
    session.locked=true;
    try {
      const filename=path.join(work,randomUUID()+'.ipa');await link(path.join(directory(id),'app.ipa'),filename);
      files.ipa=[{path:filename,size:session.size,fieldname:'ipa',originalname:'app.ipa'}];
    }catch(error){session.locked=false;throw error;}
    return async consumed=>{try{if(consumed)await discard(session);}finally{session.locked=false;}};
  }
  return {acquire,get active(){return [...sessions.values()].some(session=>session.locked || session.inflight.size>0);}};
}
