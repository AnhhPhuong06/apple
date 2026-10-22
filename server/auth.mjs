import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

const digest=value=>createHash('sha256').update(value).digest();
const sessionCookie='appspace_admin';
const sessionLifetime=12*60*60*1000;

export async function createAdminAuth({token,data,baseURL,port,secure,root}) {
  if(!token) {
    const keyFile=path.join(data,'admin-key.txt');
    try {token=(await readFile(keyFile,'utf8')).trim();}
    catch(error) {
      if(error.code!=='ENOENT') throw error;
      const generated=randomBytes(24).toString('base64url');
      try {await writeFile(keyFile,generated+'\n',{flag:'wx',mode:0o600});token=generated;}
      catch(error) {if(error.code!=='EEXIST')throw error;token=(await readFile(keyFile,'utf8')).trim();}
    }
  }
  if(token.length<24) throw new Error('Mật khẩu quản trị cần ít nhất 24 ký tự. Đặt ADMIN_TOKEN hoặc cập nhật data/admin-key.txt.');
  const tokenHash=digest(token); token='';
  const sessions=new Map(),attempts=new Map();
  const origins=new Set([baseURL,`http://localhost:${port}`,`http://127.0.0.1:${port}`]);
  const cookieOptions={httpOnly:true,secure,sameSite:'strict',path:'/'};
  function sessionID(req) {
    const value=(req.get('cookie') || '').split(';').map(value=>value.trim()).find(value=>value.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1);
    return /^[a-zA-Z0-9_-]{43}$/.test(value || '')?value:null;
  }
  function authenticated(req) {
    const authorization=req.get('authorization');
    if(authorization?.startsWith('Bearer ') && timingSafeEqual(digest(authorization.slice(7)),tokenHash)) return 'bearer';
    const id=sessionID(req); const expires=id?sessions.get(id):null;
    if(expires && expires>Date.now()) return 'session';
    if(id)sessions.delete(id);
    return false;
  }
  function originAllowed(req) {return !req.get('origin') || origins.has(req.get('origin'));}
  function admin(req,res,next) {
    res.set('Cache-Control','no-store');
    if(!originAllowed(req)) return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'});
    const auth=authenticated(req);
    if(!auth)return res.status(401).json({error:'Vui lòng đăng nhập quản trị.'});
    // Custom headers cannot be sent by a cross-site form. No CORS access is granted.
    if(auth==='session' && !['GET','HEAD'].includes(req.method) && req.get('X-AppSpace-Admin')!=='1') return res.status(403).json({error:'Yêu cầu quản trị không hợp lệ.'});
    next();
  }
  function page(req,res,next) {
    res.set('Cache-Control','no-store');
    if(authenticated(req)) return next();
    const resume=typeof req.query.resume==='string' && /^[0-9a-f-]{36}$/.test(req.query.resume)?'?resume='+req.query.resume:'';
    return res.redirect('/admin/login'+resume);
  }
  function mount(app) {
    app.post('/api/admin/login',express.json({limit:'4kb'}),(req,res)=>{
      res.set('Cache-Control','no-store');
      if(!originAllowed(req) || !req.is('application/json'))return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'});
      const now=Date.now(),ip=req.socket.remoteAddress;
      for(const [key,value] of attempts)if(value.until<=now)attempts.delete(key);
      const attempt=attempts.get(ip);
      if(attempt?.count>=8){res.set('Retry-After',String(Math.ceil((attempt.until-now)/1000)));return res.status(429).json({error:'Đăng nhập sai nhiều lần. Vui lòng thử lại sau 5 phút.'});}
      const password=req.body?.password;
      if(typeof password!=='string' || password.length>1024 || !timingSafeEqual(digest(password),tokenHash)) {
        attempts.set(ip,{count:(attempt?.count || 0)+1,until:attempt?.until || now+5*60*1000});
        return res.status(401).json({error:'Mật khẩu quản trị không đúng.'});
      }
      attempts.delete(ip);
      const previous=sessionID(req);if(previous)sessions.delete(previous);
      for(const [key,expires] of sessions)if(expires<=now)sessions.delete(key);
      if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
      const id=randomBytes(32).toString('base64url');sessions.set(id,now+sessionLifetime);
      res.cookie(sessionCookie,id,{...cookieOptions,maxAge:sessionLifetime});res.json({ok:true});
    });
    app.post('/api/admin/logout',admin,(req,res)=>{
      const id=sessionID(req);if(id)sessions.delete(id);
      res.clearCookie(sessionCookie,cookieOptions);res.json({ok:true});
    });
    app.get('/api/admin/session',admin,(req,res)=>res.json({authenticated:true}));
    app.get('/admin/login',(req,res)=>{
      res.set('Cache-Control','no-store');
      if(authenticated(req))return res.redirect('/admin');
      res.sendFile(path.join(root,'admin-login.html'));
    });
  }
  return {admin,page,mount,authenticated};
}
