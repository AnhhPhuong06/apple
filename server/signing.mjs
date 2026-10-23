import {spawn} from 'node:child_process';
import path from 'node:path';
import yauzl from 'yauzl';
import * as plist from 'plist';
import * as bplist from 'bplist-parser';

export function readAppInfo(file) {
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(error,zip)=>{
    if(error) return reject(new Error('Không đọc được IPA đã ký.'));
    let found=false;
    zip.on('error',()=>{zip.close();reject(new Error('IPA đã ký bị hỏng.'));});
    zip.on('entry',entry=>{
      if(!/^Payload\/[^/]+\.app\/Info\.plist$/.test(entry.fileName)) return zip.readEntry();
      found=true;
      if(entry.uncompressedSize>2*1024**2) {zip.close();return reject(new Error('Info.plist quá lớn.'));}
      zip.openReadStream(entry,(error,stream)=>{
        if(error){zip.close();return reject(new Error('Không đọc được thông tin app.'));}
        const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',()=>{zip.close();reject(new Error('Thông tin app bị hỏng.'));});
        stream.on('end',()=>{zip.close();try{const bytes=Buffer.concat(chunks);resolve(bytes.subarray(0,8).toString()==='bplist00'?bplist.parseBuffer(bytes)[0]:plist.parse(bytes.toString('utf8')));}catch{reject(new Error('Info.plist không hợp lệ.'));}});
      });
    });
    zip.on('end',()=>{if(!found)reject(new Error('Không tìm thấy thông tin ứng dụng đã ký.'));});zip.readEntry();
  }));
}

export function validateArchive(file) {
  return new Promise((resolve,reject) => {
    yauzl.open(file,{lazyEntries:true,validateEntrySizes:true},(error,zip) => {
      if(error) return reject(new Error('Không đọc được IPA. Hãy chọn gói ứng dụng iOS hợp lệ.'));
      let size=0, count=0; const apps=new Set(); const names=new Set();
      const fail=(message)=>{zip.close();reject(new Error(message));};
      zip.on('error',()=>fail('Gói IPA bị hỏng hoặc có đường dẫn không hợp lệ.'));
      zip.on('entry',entry=>{
        const name=entry.fileName;
        const segments=name.split('/');
        const type=(entry.externalFileAttributes >>> 16) & 0xf000;
        if(name.startsWith('/') || /[\\:\x00-\x1f]/.test(name) || segments.some(s=>s==='..' || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) || type===0xa000 || (entry.generalPurposeBitFlag & 1) || names.has(name.toLowerCase())) return fail('IPA chứa đường dẫn, liên kết hoặc tệp mã hóa không được hỗ trợ.');
        names.add(name.toLowerCase()); size+=entry.uncompressedSize; count++;
        if(size>2*1024**3 || count>60000) return fail('IPA vượt giới hạn 2 GB sau giải nén hoặc có quá nhiều tệp.');
        const match=name.match(/^Payload\/([^/]+\.app)\/Info\.plist$/); if(match) apps.add(match[1]);
        zip.readEntry();
      });
      zip.on('end',()=>apps.size===1 ? resolve() : reject(new Error('IPA phải chứa đúng một ứng dụng Payload/*.app/Info.plist.')));
      zip.readEntry();
    });
  });
}

export function runZsign(binary,args,{cwd,timeout=600000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
    let log=''; let timedOut=false;
    // Only classify errors. Never return raw tool output, argv or certificate data to clients.
    const collect=data=>{log=(log+data.toString()).slice(-24000);};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Không khởi chạy được công cụ ký. Kiểm tra ZSIGN_BIN trên máy chủ.'));});
    child.once('close',code=>{
      clearTimeout(timer);
      if(timedOut) return reject(new Error('Quá thời gian ký 10 phút. Hãy thử lại với gói nhỏ hơn.'));
      if(code===0) return resolve();
      if(/password|private key|p12|pkcs12|certificate/i.test(log)) return reject(new Error('Không dùng được chứng chỉ. Kiểm tra file .p12 và mật khẩu.'));
      if(/provision|profile/i.test(log)) return reject(new Error('Không dùng được hồ sơ .mobileprovision. Kiểm tra hồ sơ và chứng chỉ tương ứng.'));
      reject(new Error('Ký IPA thất bại. Kiểm tra bản IPA, chứng chỉ và hồ sơ cấp phép phù hợp.'));
    });
  });
}

export const xmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function manifestXML({baseURL,id,bundleId,version,name,revision}) {
  const ipa=`${baseURL}/files/${id}/app.ipa${revision?'?revision='+revision:''}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${xmlEscape(ipa)}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${xmlEscape(bundleId)}</string><key>bundle-version</key><string>${xmlEscape(version)}</string><key>kind</key><string>software</string><key>title</key><string>${xmlEscape(name)}</string></dict></dict></array></dict></plist>\n`;
}

export function signArguments({work,password,settings,files}) {
  const args=['-f','-k',files.p12[0].path,'-p',password,'-m',files.profile[0].path,'-o',path.join(work,'result','app.ipa'),'-x',path.join(work,'metadata'),'-t',path.join(work,'unpack'),'-z','6'];
  if(settings.name) args.push('-n',settings.name);
  if(settings.bundleId) args.push('-b',settings.bundleId);
  if(settings.version) args.push('-r',settings.version);
  if(files.icon) args.push('-I',files.icon[0].path);
  args.push(files.ipa[0].path);
  return args;
}
