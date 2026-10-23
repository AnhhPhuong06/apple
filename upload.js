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
  window.AppSpaceUpload=async(file,{onProgress,onUnauthorized}={})=>{
    if(!/\.ipa$/i.test(file.name) || file.size<22 || file.size>512*1024**2)throw Error('Chọn file IPA, tối đa 512 MB.');
    const sample=64*1024,fingerprint=await digest(new Blob([file.name,String(file.size),String(file.lastModified),file.slice(0,sample),file.slice(Math.max(0,file.size-sample))]));
    let session,stopped=false,completed=0,transferred=0;const requests=new Set(),progress=new Map(),started=performance.now();
    const update=()=>{if(stopped)return;const sent=Math.min(file.size,completed+[...progress.values()].reduce((sum,value)=>sum+value,0));onProgress?.({loaded:sent,total:file.size,bytesPerSecond:transferred/Math.max(1,(performance.now()-started)/1000)});};
    const create=()=>api('/api/admin/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,size:file.size,fingerprint})});
    try {
      session=await create();
      const size=session.chunkSize,count=Math.ceil(file.size/size);
      if(!Number.isSafeInteger(size) || size<1 || size>16*1024**2 || !Array.isArray(session.received))throw Error('Máy chủ trả về cấu hình tải lên không hợp lệ.');
      let received=new Map(session.received.map(part=>[part.index,part.hash]));
      // Verify every acknowledged range before resuming; sampled fingerprints alone are insufficient.
      for(const [index,hash] of received)if(!Number.isInteger(index) || index<0 || index>=count || await digest(file.slice(index*size,Math.min(file.size,(index+1)*size)))!==hash) {
        await api('/api/admin/uploads/'+encodeURIComponent(session.id),{method:'DELETE'});session=await create();received=new Map();break;
      }
      for(const index of received.keys())completed+=Math.min(size,file.size-index*size);
      update();
      function send(index,blob,hash) {
        return new Promise((resolve,reject)=>{
          if(stopped)return reject(Error('Đã dừng phiên tải.'));
          const xhr=new XMLHttpRequest();requests.add(xhr);xhr.open('PUT',`/api/admin/uploads/${encodeURIComponent(session.id)}/chunks/${index}`);xhr.setRequestHeader('X-AppSpace-Admin','1');xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Chunk-SHA256',hash);xhr.timeout=5*60*1000;let previous=0;
          const finish=()=>requests.delete(xhr);
          xhr.upload.onprogress=event=>{transferred+=Math.max(0,event.loaded-previous);previous=event.loaded;progress.set(index,event.loaded);update();};
          xhr.onload=()=>{finish();let data;try{data=JSON.parse(xhr.responseText);}catch{data={};}if(xhr.status<200 || xhr.status>=300)return reject(Object.assign(Error(data.error || 'Kết nối tải tệp bị gián đoạn.'),{status:xhr.status}));resolve();};
          xhr.onerror=()=>{finish();reject(Error('Mất kết nối khi tải tệp.'));};xhr.ontimeout=()=>{finish();reject(Error('Tải phần tệp quá thời gian.'));};xhr.onabort=()=>{finish();reject(Error('Đã dừng phiên tải.'));};xhr.send(blob);
        });
      }
      const pending=Array.from({length:count},(_,index)=>index).filter(index=>!received.has(index));let next=0;
      async function worker() {
        while(!stopped && next<pending.length) {
          const index=pending[next++],blob=file.slice(index*size,Math.min(file.size,(index+1)*size)),hash=await digest(blob);
          for(let attempt=0;;attempt++) {
            try{await send(index,blob,hash);progress.delete(index);completed+=blob.size;update();break;}
            catch(error){progress.delete(index);update();if(stopped || attempt>=3 || (error.status && ![408,409,429].includes(error.status) && error.status<500))throw error;await pause(600*2**attempt);}
          }
        }
      }
      await Promise.all(Array.from({length:Math.min(3,pending.length)},worker));
      return session.id;
    }catch(error){if(error.status===401)onUnauthorized?.();throw error;}
    finally{stopped=true;for(const request of requests)request.abort();}
  };
})();
