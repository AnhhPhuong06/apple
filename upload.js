(() => {
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const digest=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const adminHeaders={'X-AppSpace-Admin':'1'};
  async function api(url,options={}) {
    let response;try{response=await fetch(url,{...options,headers:{...adminHeaders,...options.headers}});}catch{throw Error('Mất kết nối. Chọn lại cùng file IPA để tiếp tục phần còn thiếu.');}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(Error(data.error || 'Chưa tải được IPA. Hãy thử lại.'),{status:response.status});
    return data;
  }
  window.AppSpaceUpload=async(file,{onProgress,onUnauthorized,signal}={})=>{
    signal?.throwIfAborted();
    if(!/\.ipa$/i.test(file.name) || file.size<22 || file.size>512*1024**2)throw Error('Chọn file IPA, tối đa 512 MB.');
    const sample=64*1024,fingerprint=await digest(new Blob([file.name,String(file.size),String(file.lastModified),file.slice(0,sample),file.slice(Math.max(0,file.size-sample))]));
    let session,stopped=false,completed=0,transferred=0,direct=null;const requests=new Set(),progress=new Map(),started=performance.now();
    const update=()=>{if(stopped || signal?.aborted)return;const sent=Math.min(file.size,completed+[...progress.values()].reduce((sum,value)=>sum+value,0));onProgress?.({loaded:sent,total:file.size,bytesPerSecond:transferred/Math.max(1,(performance.now()-started)/1000),transport:direct?'direct':'website'});};
    const create=()=>api('/api/admin/uploads',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,size:file.size,fingerprint})});
    try {
      session=await create();
      signal?.throwIfAborted();
      const size=session.chunkSize,count=Math.ceil(file.size/size);
      if(!Number.isSafeInteger(size) || size<1 || size>16*1024**2 || !Array.isArray(session.received))throw Error('Máy chủ trả về cấu hình tải lên không hợp lệ.');
      let received=new Map(session.received.map(part=>[part.index,part.hash]));
      // Verify every acknowledged range before resuming; sampled fingerprints alone are insufficient.
      for(const [index,hash] of received)if(!Number.isInteger(index) || index<0 || index>=count || await digest(file.slice(index*size,Math.min(file.size,(index+1)*size)))!==hash) {
        signal?.throwIfAborted();await api('/api/admin/uploads/'+encodeURIComponent(session.id),{method:'DELETE',signal});session=await create();received=new Map();break;
      }
      for(const index of received.keys())completed+=Math.min(size,file.size-index*size);
      update();
      async function directTransport() {
        signal?.throwIfAborted();
        const candidate=session.transport;
        if(!candidate)return null;
        let url;try{url=new URL(candidate.url);if(url.protocol!=='https:' || url.origin!==candidate.origin || url.pathname!==`/api/transfer/${session.id}/chunks` || typeof candidate.ticket!=='string')return null;}catch{return null;}
        const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,2500);signal?.addEventListener('abort',abort,{once:true});
        try {
          const response=await fetch(candidate.origin+'/api/transfer/ping',{mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal});
          return response.ok && (await response.json()).ok===true?candidate:null;
        }catch{return null;}
        finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
      }
      function send(index,blob,hash) {
        return new Promise((resolve,reject)=>{
          if(stopped || signal?.aborted)return reject(new DOMException('Đã dừng phiên tải.','AbortError'));
          const target=direct,xhr=new XMLHttpRequest();requests.add(xhr);xhr.open('PUT',target?`${target.url}/${index}`:`/api/admin/uploads/${encodeURIComponent(session.id)}/chunks/${index}`);xhr.withCredentials=false;
          if(target)xhr.setRequestHeader('X-AppSpace-Upload-Ticket',target.ticket);else xhr.setRequestHeader('X-AppSpace-Admin','1');
          xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Chunk-SHA256',hash);xhr.timeout=5*60*1000;let previous=0;
          const abort=()=>xhr.abort();signal?.addEventListener('abort',abort,{once:true});
          const finish=()=>{requests.delete(xhr);signal?.removeEventListener('abort',abort);};
          xhr.upload.onprogress=event=>{transferred+=Math.max(0,event.loaded-previous);previous=event.loaded;progress.set(index,event.loaded);update();};
          xhr.onload=()=>{finish();let data;try{data=JSON.parse(xhr.responseText);}catch{data={};}if(xhr.status<200 || xhr.status>=300)return reject(Object.assign(Error(data.error || 'Kết nối tải tệp bị gián đoạn.'),{status:xhr.status,direct:!!target}));resolve();};
          xhr.onerror=()=>{finish();reject(Object.assign(Error('Mất kết nối khi tải tệp.'),{direct:!!target}));};xhr.ontimeout=()=>{finish();reject(Object.assign(Error('Tải phần tệp quá thời gian.'),{direct:!!target}));};xhr.onabort=()=>{finish();reject(Error('Đã dừng phiên tải.'));};xhr.send(blob);
        });
      }
      const pending=Array.from({length:count},(_,index)=>index).filter(index=>!received.has(index));let next=0;
      if(pending.length)direct=await directTransport();signal?.throwIfAborted();update();
      async function worker() {
        while(!stopped && next<pending.length) {
          const index=pending[next++],blob=file.slice(index*size,Math.min(file.size,(index+1)*size)),hash=await digest(blob);
          for(let attempt=0;;attempt++) {
            try{await send(index,blob,hash);progress.delete(index);completed+=blob.size;update();break;}
            catch(error){
              progress.delete(index);if(stopped || signal?.aborted)throw error;
              if(error.direct && (!error.status || [401,403,404,408].includes(error.status) || error.status>=500)){direct=null;update();continue;}
              update();if(attempt>=3 || (error.status && ![408,409,429].includes(error.status) && error.status<500))throw error;await pause(600*2**attempt);
            }
          }
        }
      }
      const parallel=direct?Math.max(1,Math.min(6,session.parallel || 3)):3;
      await Promise.all(Array.from({length:Math.min(parallel,pending.length)},worker));
      return session.id;
    }catch(error){if(error.status===401)onUnauthorized?.();if(signal?.aborted)throw new DOMException('Đã dừng phiên tải.','AbortError');throw error;}
    finally{stopped=true;for(const request of requests)request.abort();}
  };
})();
