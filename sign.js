(() => {
  const $=s=>document.querySelector(s), form=$('#sign-form');
  let ready=false,connected=false,active=false,iconURL=null,shotURLs=[],toastTimer,updating=null,fastUpload=false;
  const params=new URLSearchParams(location.search);
  const headers=()=>({'X-AppSpace-Admin':'1'});
  const mode=()=>$('input[name="publish-mode"]:checked').value;
  const canSubmit=()=>connected && (mode()==='publish' || ready);
  function updateMode() {
    const publish=mode()==='publish',saved=!publish && !!$('#saved-certificate').value;
    document.querySelectorAll('[data-sign-only]').forEach(element=>{element.hidden=publish;element.querySelectorAll('input').forEach(input=>input.disabled=publish);});
    form.elements.bundleId.readOnly=!!updating;
    $('#update-app-notice').hidden=!updating;$('#cancel-update-app').disabled=active;
    for(const name of ['p12','profile']){const input=form.elements[name];input.disabled=publish || saved;input.required=!publish && !saved;input.closest('.file-card').hidden=publish || saved;}
    form.elements.password.disabled=publish || saved;form.elements.password.closest('.field-label').hidden=publish || saved;
    $('#saved-certificate').disabled=publish || active;
    $('.upload-grid').classList.toggle('publish-only',publish || saved);$('#publish-note').hidden=!publish;
    $('#upload-title').textContent=publish?'Thêm file IPA đã ký':'Thêm ứng dụng & chứng chỉ';
    $('#upload-description').textContent=publish?'Chọn một IPA để tạo trang cài đặt, không ký lại gói.':saved?'Bộ chứng chỉ đã lưu được chọn. Bạn chỉ cần tải IPA để ký.':'Chọn ba tệp để bắt đầu ký ứng dụng.';
    $('#customize-description').textContent=publish?'Thông tin bên dưới chỉ thay đổi trang giới thiệu, giữ nguyên nội dung IPA.':'Bỏ trống tên, phiên bản và Bundle ID để giữ thông tin gốc.';
    $('#submit-description').textContent=publish?'App sẽ xuất hiện trong kho ứng dụng cùng link cài đặt riêng.':'Ký xong, bạn sẽ nhận link trang cài đặt và file IPA.';
    $('#submit-label').textContent=publish?'Thêm app & tạo trang cài đặt':'Ký & tạo trang cài đặt';
    if(updating){$('#upload-title').textContent='Tải IPA phiên bản mới';$('#submit-description').textContent='Bản mới thay thế bản hiện tại sau khi xử lý thành công. Link cài đặt được giữ nguyên.';$('#submit-label').textContent=publish?'Cập nhật phiên bản':'Ký & cập nhật phiên bản';}
    $('#sign-submit').disabled=!canSubmit() || active;
    document.querySelectorAll('[name="publish-mode"]').forEach(input=>input.disabled=active);refreshPreview();window.dispatchEvent(new CustomEvent('appspace:signingstate',{detail:{active}}));
  }
  document.querySelectorAll('[name="publish-mode"]').forEach(input=>input.addEventListener('change',updateMode));
  $('#saved-certificate').addEventListener('change',updateMode);
  function requireLogin(){const pending=new URLSearchParams(location.search).get('resume') || sessionStorage.getItem('appspace-sign-job');active=false;location.replace('/admin/login'+(/^[0-9a-f-]{36}$/.test(pending || '')?'?resume='+pending:''));}
  function error(message){$('#sign-error').textContent=message;$('#sign-error').hidden=false;}
  function notify(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);}
  async function health(){try{const response=await fetch('/api/health');if(response.status===401){requireLogin();return;}if(!response.ok) throw Error();const data=await response.json();connected=true;ready=data.signerReady;fastUpload=!!data.chunkUpload;$('#server-notice').textContent=!ready?'Công cụ ký chưa sẵn sàng. Bạn vẫn có thể thêm IPA đã ký; để ký mới, chạy npm run setup:signer trên máy chủ.':data.otaReady?'Máy chủ sẵn sàng. Trang cài đặt trực tiếp qua HTTPS đã được cấu hình.':'Máy chủ sẵn sàng. Để cài trực tiếp lên iPhone, cấu hình tên miền HTTPS cho máy chủ.';$('#server-notice').classList.toggle('ready',ready);updateMode();}catch{connected=false;$('#sign-submit').disabled=true;$('#server-notice').textContent='Chưa kết nối được máy chủ. Hãy chạy npm start rồi mở trang trên máy chủ đó.';}}
  function refreshPreview(){for(const [field,id,fallback] of [['name','live-name','Ứng dụng của bạn'],['subtitle','live-subtitle','Dành cho iPhone & iPad'],['version','live-version','Gốc'],['developer','live-developer','Của bạn'],['description','live-description','Thông tin bạn nhập sẽ xuất hiện tại đây, trên trang cài đặt riêng của ứng dụng.']]) $('#'+id).textContent=form.elements[field].value.trim() || fallback;if(mode()==='publish'){$('#live-name').textContent='Tên từ file IPA';$('#live-version').textContent='Từ IPA';}}
  $('#new-app-button').addEventListener('click',()=>{
    if(active){notify('Hãy chờ phiên ký hiện tại hoàn tất trước khi tạo app mới.');return;}
    updating=null;const savedID=$('#saved-certificate').value;form.reset();form.elements.targetAppId.value='';$('#saved-certificate').value=savedID;if(iconURL)URL.revokeObjectURL(iconURL);iconURL=null;shotURLs.forEach(URL.revokeObjectURL);shotURLs=[];
    $('#screenshot-thumbs').replaceChildren();$('#live-icon').src=$('#custom-icon-preview').src='assets/app-default.svg';
    form.querySelectorAll('.file-card').forEach(card=>{card.classList.remove('has-file');card.querySelector('.file-name').textContent=card.querySelector('input').getAttribute('accept');});
    $('#certificate-password').type='password';$('#show-password').textContent='Hiện';$('#show-password').setAttribute('aria-pressed','false');
    $('#result-card').hidden=true;$('#sign-error').hidden=true;$('#process-card').hidden=true;sessionStorage.removeItem('appspace-sign-job');
    const url=new URL(location.href);url.searchParams.delete('resume');history.replaceState(null,'',url);updateMode();form.scrollIntoView({behavior:'smooth'});form.elements.ipa.focus({preventScroll:true});
  });
  $('#cancel-update-app').addEventListener('click',()=>$('#new-app-button').click());
  window.addEventListener('appspace:update-app',event=>{
    if(active){notify('Hãy chờ xử lý app hiện tại hoàn tất trước khi cập nhật.');return;}
    $('#new-app-button').click();updating=event.detail;form.elements.targetAppId.value=updating.id;
    for(const key of ['subtitle','developer','category','description','bundleId'])form.elements[key].value=updating[key] || '';
    form.elements.releaseNotes.value='';
    $('#update-app-title').textContent='Cập nhật '+updating.name;
    $('#update-app-description').textContent=`Bản hiện tại: ${updating.version} · Build ${updating.buildVersion}. Link cài đặt giữ nguyên.`;
    $('#live-icon').src=$('#custom-icon-preview').src=updating.iconImage || 'assets/app-default.svg';
    updateMode();$('#update-app-notice').scrollIntoView({behavior:'smooth',block:'center'});
  });
  form.addEventListener('input',refreshPreview);
  form.querySelectorAll('.file-card input').forEach(input=>input.addEventListener('change',()=>{const card=input.closest('.file-card');card.classList.toggle('has-file',!!input.files.length);card.querySelector('.file-name').textContent=input.files[0]?.name || 'Chọn file';}));
  form.elements.icon.addEventListener('change',()=>{if(iconURL) URL.revokeObjectURL(iconURL);iconURL=form.elements.icon.files[0]?URL.createObjectURL(form.elements.icon.files[0]):null;$('#live-icon').src=$('#custom-icon-preview').src=iconURL || 'assets/app-default.svg';});
  form.elements.screenshots.addEventListener('change',()=>{shotURLs.forEach(URL.revokeObjectURL);shotURLs=[];$('#screenshot-thumbs').replaceChildren();if(form.elements.screenshots.files.length>5){error('Chọn tối đa 5 ảnh xem trước.');form.elements.screenshots.value='';return;}for(const file of form.elements.screenshots.files){const img=document.createElement('img');img.src=URL.createObjectURL(file);shotURLs.push(img.src);img.alt=file.name;$('#screenshot-thumbs').append(img);}});
  $('#show-password').addEventListener('click',()=>{const showing=$('#certificate-password').type==='text';$('#certificate-password').type=showing?'password':'text';$('#show-password').textContent=showing?'Hiện':'Ẩn';$('#show-password').setAttribute('aria-pressed',String(!showing));});
  async function poll(id){let failures=0;while(active){await new Promise(resolve=>setTimeout(resolve,1500));try{const response=await fetch(`/api/jobs/${encodeURIComponent(id)}`,{headers:headers()});if(response.status===401){requireLogin();return;}const job=await response.json();if(!response.ok) throw Error(job.error || 'Không đọc được trạng thái ký.');failures=0;if(job.status==='complete'){showResult(job);return;}if(job.status==='failed') throw Object.assign(Error(job.error),{terminal:true});}catch(e){failures++;if(e.terminal || failures>=4) throw e;}}}
  function showResult(job,publishedMode='sign'){active=false;updating=null;form.elements.targetAppId.value='';updateMode();window.dispatchEvent(new Event('appspace:signed'));$('#process-card').hidden=true;$('#result-card').hidden=false;$('#result-card').dataset.appId=job.appId || job.id;$('#result-title').textContent=job.updated?'Đã cập nhật phiên bản.':publishedMode==='publish'?'Đã thêm ứng dụng.':'Ký ứng dụng thành công.';$('#result-name').textContent=job.name;$('#result-link').value=job.installUrl;$('#open-result').href=job.installUrl;$('#download-result').href=job.downloadUrl;$('#result-warning').hidden=job.otaReady;if(!job.otaReady) $('#result-warning').textContent='IPA đã có thể tải về. Cần PUBLIC_BASE_URL là tên miền HTTPS để iPhone cài trực tiếp.';$('#result-card').scrollIntoView({behavior:'smooth',block:'center'});sessionStorage.removeItem('appspace-sign-job');const next=new URL(location.href);next.searchParams.delete('resume');history.replaceState(null,'',next);}
  function upload(data,publishedMode){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',publishedMode==='publish'?'/api/admin/apps':'/api/sign');Object.entries(headers()).forEach(([k,v])=>xhr.setRequestHeader(k,v));xhr.timeout=15*60*1000;xhr.upload.onprogress=event=>{if(event.lengthComputable){const pct=Math.round(event.loaded/event.total*100);$('#upload-progress').value=pct;$('#process-label').textContent=`Đang tải tệp lên… ${pct}%`;if(pct===100){$('#process-label').textContent='Đang kiểm tra gói ứng dụng…';$('#upload-progress').removeAttribute('value');}}};xhr.onload=()=>{if(xhr.status===401){requireLogin();return reject(Error('Phiên đăng nhập đã hết hạn.'));}let response;try{response=JSON.parse(xhr.responseText);}catch{return reject(Error('Máy chủ trả về phản hồi không hợp lệ.'));}if(xhr.status!==(publishedMode==='publish'?201:202)) return reject(Error(response.error || 'Không gửi được yêu cầu.'));resolve(response);};xhr.onerror=()=>reject(Error('Mất kết nối khi tải tệp. Kiểm tra mạng và thử lại.'));xhr.ontimeout=()=>reject(Error('Tải tệp quá thời gian. Hãy thử lại.'));xhr.send(data);});}
  function progress(){active=true;updateMode();$('#sign-error').hidden=true;$('#result-card').hidden=true;$('#process-card').hidden=false;$('#process-card').scrollIntoView({behavior:'smooth',block:'center'});}
  async function uploadIPA(data,publishedMode) {
    if(fastUpload && window.AppSpaceUpload && data.get('ipa') instanceof File) {
      const id=await window.AppSpaceUpload(data.get('ipa'),{onUnauthorized:requireLogin,onProgress:({loaded,total,bytesPerSecond})=>{
        const percent=Math.floor(loaded/total*100);$('#upload-progress').value=percent;$('#process-label').textContent=percent===100?'Đã tải IPA. Đang chuẩn bị phát hành…':`Đang tải IPA lên… ${percent}%`;
        const mb=bytes=>(bytes/1024**2).toLocaleString('vi-VN',{maximumFractionDigits:1});
        const seconds=bytesPerSecond>0?Math.ceil((total-loaded)/bytesPerSecond):null;
        $('#process-detail').textContent=`${mb(loaded)} / ${mb(total)} MB${bytesPerSecond>0?' · '+mb(bytesPerSecond)+' MB/s':''}${seconds && seconds>0?' · Còn khoảng '+(seconds<60?seconds+' giây':Math.ceil(seconds/60)+' phút'):''}. Có thể chọn lại cùng file để tiếp tục nếu mất mạng.`;
      }});
      data.delete('ipa');data.set('uploadId',id);
      $('#process-detail').textContent='IPA đã tải đủ. Đang gửi ảnh và thông tin ứng dụng.';
    }
    return upload(data,publishedMode);
  }
  async function resume(id){progress();$('#process-label').textContent='Đang kiểm tra phiên ký…';$('#upload-progress').removeAttribute('value');try{await poll(id);}catch(e){active=false;error(e.message);$('#process-card').hidden=true;updateMode();}}
  form.addEventListener('submit',async event=>{event.preventDefault();if(active || !canSubmit())return;const publishedMode=mode(),data=new FormData(form);for(const [name,file] of data){if(file instanceof File && !file.size && !file.name)data.delete(name);}progress();$('#upload-progress').value=0;$('#process-label').textContent='Đang tải tệp lên…';$('#process-detail').textContent='Giữ trang mở trong lúc tải tệp.';try{const job=await uploadIPA(data,publishedMode);if(publishedMode==='publish'){showResult(job,publishedMode);return;}form.elements.password.value='';for(const key of ['p12','profile']){const input=form.elements[key];input.value='';const card=input.closest('.file-card');card.classList.remove('has-file');card.querySelector('.file-name').textContent=key==='p12'?'.p12':'.mobileprovision';}data.delete('password');data.delete('p12');data.delete('profile');sessionStorage.setItem('appspace-sign-job',job.id);const current=new URL(location.href);current.searchParams.set('resume',job.id);history.replaceState(null,'',current);$('#process-label').textContent='Đang ký ứng dụng…';$('#upload-progress').removeAttribute('value');$('#process-detail').textContent='Máy chủ đang ký IPA và chuẩn bị trang cài đặt của bạn.';await poll(job.id);}catch(e){active=false;error(e.message);$('#process-card').hidden=true;updateMode();}});
  window.addEventListener('appspace:deleted',event=>{if(updating?.id===event.detail.id)$('#new-app-button').click();if($('#result-card').dataset.appId===event.detail.id){$('#result-card').hidden=true;$('#result-link').value='';$('#open-result').removeAttribute('href');$('#download-result').removeAttribute('href');}});
  $('#copy-result').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#result-link').value);notify('Đã sao chép link trang cài đặt.');}catch{$('#result-link').focus();$('#result-link').select();notify('Chọn “Sao chép” để lấy liên kết.');}});
  window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue='';}});
  $('#logout-button').addEventListener('click',async()=>{
    try {const response=await fetch('/api/admin/logout',{method:'POST',headers:headers()});if(!response.ok && response.status!==401)throw Error();active=false;form.reset();location.replace('/admin/login');}
    catch {error('Chưa đăng xuất được. Vui lòng thử lại.');}
  });
  window.addEventListener('pageshow',event=>{if(event.persisted)health();});
  updateMode();health().then(()=>{const pending=params.get('resume') || sessionStorage.getItem('appspace-sign-job');if(pending && ready)resume(pending);});
})();
