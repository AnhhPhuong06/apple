(() => {
  const $=selector=>document.querySelector(selector),source=$('#saved-certificate');
  let items=[],running=false,externalActive=false,stop=false,prefetch=null,current=-1;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
  function message(text,error=false){$('#quick-message').textContent=text;$('#quick-message').classList.toggle('error',error);$('#quick-message').hidden=!text;}
  function controls() {
    const remaining=items.some(item=>!['complete','uncertain'].includes(item.state));
    $('#quick-start').disabled=running || externalActive || !remaining;
    $('#quick-start').textContent=items.some(item=>item.state==='complete')?'Thêm phần còn lại':'Thêm nhanh';
    for(const id of ['quick-files','quick-mode','quick-category','quick-developer'])$('#'+id).disabled=running || externalActive;
    $('#quick-certificate').disabled=running || externalActive || $('#quick-mode').value!=='sign';
    $('#quick-certificate-field').hidden=$('#quick-mode').value!=='sign';$('#quick-stop').hidden=!running;$('#quick-stop').disabled=stop;
  }
  function certificates() {
    if(running)return;
    const selected=source.value || $('#quick-certificate').value;
    const options=[...source.options].map(option=>{const copy=option.cloneNode(true);if(!copy.value)copy.textContent='Chọn chứng chỉ đã lưu';return copy;});
    $('#quick-certificate').replaceChildren(...options);
    if(options.some(option=>option.value===selected && !option.disabled))$('#quick-certificate').value=selected;
    controls();
  }
  source.addEventListener('change',certificates);new MutationObserver(certificates).observe(source,{childList:true,subtree:true,attributes:true});
  $('#quick-certificate').addEventListener('change',()=>{source.value=$('#quick-certificate').value;source.dispatchEvent(new Event('change'));});
  $('#quick-mode').addEventListener('change',()=>{sessionStorage.setItem('appspace-quick-mode',$('#quick-mode').value);controls();});
  $('#quick-mode').value=sessionStorage.getItem('appspace-quick-mode')==='sign'?'sign':'publish';
  function state(item,text,value=item.state){item.state=value;item.row.dataset.state=value;item.status.textContent=text;}
  function render() {
    $('#quick-list').replaceChildren(...items.map(item=>{
      item.row=node('li');const info=node('div'),name=node('strong',item.file.name);item.status=node('span','Chờ thêm');info.append(name,item.status);item.row.append(info);item.links=node('div');item.links.className='quick-result-links';item.row.append(item.links);return item.row;
    }));$('#quick-count').textContent=items.length?`${items.length} IPA đã chọn`:'';controls();
  }
  $('#quick-files').addEventListener('change',()=>{
    const files=[...$('#quick-files').files];message('');
    if(files.length>20 || files.some(file=>!/\.ipa$/i.test(file.name) || file.size<22 || file.size>512*1024**2)) {
      $('#quick-files').value='';items=[];render();return message('Chọn tối đa 20 file IPA, mỗi file tối đa 512 MB.',true);
    }
    items=files.map(file=>({file,state:'pending',uploadId:null,jobId:null}));render();
  });
  window.addEventListener('appspace:signingstate',event=>{externalActive=event.detail.active;controls();});
  async function request(url,options={}) {
    let response;
    try{response=await fetch(url,{...options,headers:{'X-AppSpace-Admin':'1',...options.headers}});}catch{throw Object.assign(Error('Mất kết nối. Kiểm tra danh sách app trước khi thử lại.'),{network:true,halt:true});}
    const data=await response.json().catch(()=>({}));
    if(response.status===401){location.assign('/admin/login');throw Object.assign(Error('Phiên đăng nhập đã hết hạn.'),{halt:true});}
    if(!response.ok)throw Object.assign(Error(data.error || 'Chưa thêm được app. Vui lòng thử lại.'),{status:response.status});return data;
  }
  async function prepare(item,index) {
    if(item.jobId)return {ok:true};
    const controller=new AbortController();item.controller=controller;
    state(item,index>current?'Đang tải trước IPA…':'Đang tải IPA…','uploading');
    try {
      item.uploadId=await window.AppSpaceUpload(item.file,{signal:controller.signal,onUnauthorized:()=>location.assign('/admin/login'),onProgress:({loaded,total})=>state(item,`Đang tải IPA… ${Math.floor(loaded/total*100)}%`,'uploading')});
      state(item,'IPA đã sẵn sàng','ready');return {ok:true};
    }catch(error){state(item,error.name==='AbortError'?'Đã dừng, có thể tiếp tục':error.message,error.name==='AbortError'?'pending':'failed');return {ok:false,error};}
    finally{item.controller=null;}
  }
  async function poll(item) {
    let failures=0;
    for(;;) {
      try {
        const job=await request('/api/jobs/'+encodeURIComponent(item.jobId));failures=0;
        if(job.status==='complete' || job.status==='failed') {
          if(sessionStorage.getItem('appspace-sign-job')===item.jobId)sessionStorage.removeItem('appspace-sign-job');
          item.jobId=null;
          if(job.status==='failed')throw Object.assign(Error(job.error || 'Ký app thất bại.'),{terminal:true});
          return job;
        }
      }catch(error){if(error.terminal || error.status===404 || error.halt && !error.network || ++failures>=4)throw error;}
      await pause(800);
    }
  }
  async function publish(item,config) {
    if(item.jobId)return poll(item);
    const data=new FormData();data.set('uploadId',item.uploadId);data.set('category',config.category);data.set('developer',config.developer);
    if(config.mode==='sign')data.set('certificateId',config.certificateId);
    let result;
    for(let attempt=0;;attempt++) {
      try{result=await request(config.mode==='sign'?'/api/sign':'/api/admin/apps',{method:'POST',body:data});break;}
      catch(error){if(error.status!==429 || attempt>=80)throw error;state(item,'Đang chờ máy chủ hoàn tất app trước…','processing');await pause(1500);}
    }
    if(result.status==='complete')return result;
    item.jobId=result.id;sessionStorage.setItem('appspace-sign-job',item.jobId);state(item,'Đang ký app…','processing');return poll(item);
  }
  function complete(item,job) {
    item.uploadId=null;state(item,'Đã thêm thành công','complete');
    const url=new URL('index.html?job='+encodeURIComponent(job.appId || job.id),document.baseURI).href;
    const link=node('a','Mở trang ↗');link.href=url;link.target='_blank';link.rel='noopener';
    const copy=node('button','Sao chép link');copy.type='button';copy.className='copy-app-link';copy.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(url);copy.textContent='Đã sao chép';}catch{const input=node('input');input.readOnly=true;input.value=url;input.setAttribute('aria-label','Link cài '+item.file.name);item.links.replaceChildren(link,input);input.focus();input.select();}
    });item.links.replaceChildren(link,copy);window.dispatchEvent(new Event('appspace:signed'));
  }
  async function trimFailed() {
    // Reserve two cache slots for the current app and the next IPA being uploaded.
    const failed=items.filter(item=>item.state==='failed' && item.uploadId && !item.jobId);
    for(const item of failed.slice(0,-2))try{await request('/api/admin/uploads/'+encodeURIComponent(item.uploadId),{method:'DELETE'});item.uploadId=null;}catch{/* Expiry also removes abandoned upload sessions. */}
  }
  $('#quick-stop').addEventListener('click',()=>{
    stop=true;for(const [index,item] of items.entries())if(index>current)item.controller?.abort();controls();message('Sẽ dừng sau app hiện tại. Các app đã thêm vẫn được giữ.');
  });
  $('#quick-start').addEventListener('click',async()=>{
    if(running || externalActive)return;
    const config={mode:$('#quick-mode').value,certificateId:$('#quick-certificate').value,category:$('#quick-category').value,developer:$('#quick-developer').value.trim()};
    if(config.mode==='sign' && (!config.certificateId || $('#quick-certificate').selectedOptions[0]?.disabled))return message('Chọn chứng chỉ có thể dùng trong kho để ký nhanh.',true);
    const queue=items.filter(item=>!['complete','uncertain'].includes(item.state));if(!queue.length)return;
    running=true;stop=false;current=-1;controls();message('Đang chuẩn bị thêm app…');window.dispatchEvent(new CustomEvent('appspace:quick-state',{detail:{active:true}}));
    try {
      const health=await request('/api/health');if(!health.chunkUpload || config.mode==='sign' && !health.signerReady)throw Error('Máy chủ chưa sẵn sàng cho cách thêm này. Hãy dùng IPA đã ký hoặc thử lại sau.');
      if(stop)return;
      prefetch=prepare(queue[0],items.indexOf(queue[0]));
      for(let index=0;index<queue.length;index++) {
        const item=queue[index];current=items.indexOf(item);const prepared=await prefetch;
        if(!prepared.ok){stop=true;message(prepared.error.message,true);break;}
        state(item,'Đang tạo trang cài đặt…','processing');
        // Transfer the next IPA while the server validates/signs the current app.
        prefetch=index+1<queue.length?prepare(queue[index+1],items.indexOf(queue[index+1])):null;
        try{complete(item,await publish(item,config));}
        catch(error){
          state(item,error.message,error.network && !item.jobId?'uncertain':'failed');window.dispatchEvent(new Event('appspace:signed'));
          if(error.halt || item.jobId){stop=true;message(error.message,true);}
        }
        await trimFailed();
        const done=items.filter(value=>value.state==='complete').length;$('#quick-count').textContent=`${done}/${items.length} app đã thêm`;
        if(stop)break;
      }
    }catch(error){message(error.message,true);stop=true;}
    finally {
      for(const item of items)if(item.controller)item.controller.abort();if(prefetch)await prefetch;prefetch=null;
      running=false;window.dispatchEvent(new CustomEvent('appspace:quick-state',{detail:{active:false}}));certificates();controls();
      const done=items.filter(item=>item.state==='complete').length,failed=items.filter(item=>['failed','uncertain'].includes(item.state)).length;
      if(!stop)message(`Đã thêm ${done}/${items.length} app${failed?`. Có ${failed} app chưa thêm được; xem lỗi ở từng file.`:'. Các link cài đặt đã sẵn sàng.'}`,failed>0);
    }
  });
  certificates();controls();
})();
