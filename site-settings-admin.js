(() => {
  const form=document.querySelector('#site-settings-form');
  const input=document.querySelector('#site-logo-url');
  const preview=document.querySelector('#site-logo-preview');
  const status=document.querySelector('#site-logo-status');
  const message=document.querySelector('#site-logo-message');
  const save=document.querySelector('#save-site-logo');
  const download=document.querySelector('#export-site-settings');
  let timer,revision=0,saved={logoUrl:''},loaded=false;
  function feedback(text,error=false){message.textContent=text;message.hidden=false;message.classList.toggle('error',error);}
  function showPreview(){
    const version=++revision,value=input.value.trim();clearTimeout(timer);input.setCustomValidity('');preview.src='assets/app-default.svg';
    if(!value){status.textContent='Dùng logo AppSpace mặc định.';return;}
    if(!window.AppSpaceBrand.validLogo(value)){status.textContent='Nhập link HTTPS trực tiếp đến ảnh.';input.setCustomValidity('Dùng link ảnh HTTPS hợp lệ.');return;}
    status.textContent='Đang tải ảnh xem trước…';
    timer=setTimeout(()=>{const image=new Image();image.referrerPolicy='no-referrer';image.onload=()=>{if(version!==revision)return;preview.src=value;status.textContent='Logo đã sẵn sàng. Nhấn “Lưu logo” để áp dụng.';};image.onerror=()=>{if(version!==revision)return;status.textContent='Không tải được ảnh. Kiểm tra link ảnh công khai, không phải link trang chia sẻ.';};image.src=value;},300);
  }
  window.AppSpaceBrand.ready.then(async()=>{
    try{const response=await fetch('/site-settings.json',{cache:'no-store'});if(!response.ok)throw Error();saved=await response.json();input.value=saved.logoUrl || '';loaded=true;save.disabled=false;download.disabled=false;showPreview();}
    catch{feedback('Chưa tải được cấu hình logo. Hãy tải lại trang trước khi thay đổi.',true);}
  });
  input.addEventListener('input',showPreview);
  document.querySelector('#reset-site-logo').addEventListener('click',()=>{input.value='';showPreview();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!loaded)return;save.disabled=true;message.hidden=true;
    try {
      const response=await fetch('/api/admin/site-settings',{method:'PUT',headers:{'Content-Type':'application/json','X-AppSpace-Admin':'1'},body:JSON.stringify({logoUrl:input.value.trim()})});
      if(response.status===401){location.replace('/admin/login');return;}
      const data=await response.json();if(!response.ok)throw Error(data.error || 'Không lưu được logo.');
      saved=data;input.value=saved.logoUrl;window.AppSpaceBrand.apply(saved);feedback(saved.logoUrl?'Đã lưu logo website. Các trang trên máy chủ sẽ dùng logo mới.':'Đã khôi phục logo AppSpace mặc định.');
    }catch(error){feedback(error instanceof TypeError?'Không kết nối được máy chủ. Vui lòng thử lại.':error.message,true);}
    finally{save.disabled=false;}
  });
  download.addEventListener('click',()=>{
    if(!loaded)return;
    const blob=new Blob([JSON.stringify(saved,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='site-settings.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    feedback('Đã xuất cấu hình đã lưu. Thay site-settings.json trong repo rồi push để cập nhật GitHub Pages.');
  });
})();
