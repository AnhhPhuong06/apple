(() => {
  const $=s=>document.querySelector(s),{normalize,formatSize}=window.AppSpace;
  let apps=[],pending=null,deleting=false,loadVersion=0;
  const dialog=$('#delete-app-dialog');
  const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  function row(app) {
    const element=node('article','saved-app-row');const image=node('img');image.src=app.iconImage || 'assets/app-default.svg';image.alt='';image.width=48;image.height=48;image.addEventListener('error',()=>{if(!image.src.endsWith('/assets/app-default.svg'))image.src='assets/app-default.svg';});
    const info=node('div','saved-app-info');info.append(node('h3','',app.name),node('p','',[app.version?'Phiên bản '+app.version:'',formatSize(app.size),app.category].filter(Boolean).join(' · ')));
    const date=new Date(app.createdAt).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});info.append(node('small','',`Tạo ngày ${date}`));
    const actions=node('div','saved-app-actions');const link=node('a','text-button','Mở trang ↗');const url=new URL('index.html?job='+encodeURIComponent(app.id),document.baseURI).href;link.href=url;link.target='_blank';link.rel='noopener';
    const copy=node('button','copy-app-link','Sao chép link');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);copy.textContent='Đã sao chép';setTimeout(()=>copy.textContent='Sao chép link',2000);}catch{let input=element.querySelector('.saved-link-input');if(!input){input=node('input','saved-link-input');input.readOnly=true;input.value=url;input.setAttribute('aria-label','Link cài '+app.name);element.append(input);}input.focus();input.select();}});
    const remove=node('button','delete-app-button','Xóa app');remove.type='button';remove.setAttribute('aria-label','Xóa app '+app.name);remove.disabled=deleting;remove.addEventListener('click',()=>{if(deleting)return;pending=app;$('#delete-app-name').textContent=app.name;$('#delete-app-error').hidden=true;dialog.showModal();});
    actions.append(link,copy,remove);element.append(image,info,actions);return element;
  }
  function render() {const query=normalize($('#saved-search').value.trim());const visible=apps.filter(app=>normalize([app.name,app.version,app.developer,app.category].join(' ')).includes(query));$('#saved-count').textContent=String(apps.length);$('#saved-list').replaceChildren(...visible.map(row));$('#saved-empty').hidden=visible.length>0;$('#saved-empty').textContent=apps.length?'Không tìm thấy app phù hợp.':'Chưa có app. Thêm ứng dụng đầu tiên bằng biểu mẫu phía trên.';}
  async function load() {const version=++loadVersion;$('#saved-error').hidden=true;try{const response=await fetch('/api/admin/apps');if(response.status===401){location.replace('/admin/login');return;}if(!response.ok)throw Error();const data=await response.json();if(version!==loadVersion)return;apps=data.apps;render();}catch{if(version!==loadVersion)return;$('#saved-empty').hidden=true;$('#saved-error').textContent='Chưa tải được danh sách. Nhấn “Làm mới” để thử lại.';$('#saved-error').hidden=false;}}
  $('#cancel-delete-app').addEventListener('click',()=>{if(!deleting)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(deleting)event.preventDefault();});
  dialog.addEventListener('close',()=>{if(!deleting)pending=null;});
  $('#confirm-delete-app').addEventListener('click',async()=>{
    if(!pending || deleting)return;
    const selected=pending;deleting=true;$('#confirm-delete-app').disabled=true;$('#cancel-delete-app').disabled=true;$('#confirm-delete-app').textContent='Đang xóa…';$('#delete-app-error').hidden=true;
    try {
      const response=await fetch('/api/admin/apps/'+encodeURIComponent(selected.id),{method:'DELETE',headers:{'X-AppSpace-Admin':'1'}});
      if(response.status===401){location.replace('/admin/login');return;}
      const data=await response.json();if(!response.ok && response.status!==404)throw Error(data.error || 'Chưa xóa được ứng dụng. Vui lòng thử lại.');
      ++loadVersion;apps=apps.filter(app=>app.id!==selected.id);$('#saved-error').hidden=true;$('#saved-status').textContent=response.status===404?'Ứng dụng này đã được gỡ khỏi máy chủ.':`Đã xóa ${selected.name} và link cài đặt của bản này.`;$('#saved-status').hidden=false;
      window.dispatchEvent(new CustomEvent('appspace:deleted',{detail:{id:selected.id}}));pending=null;dialog.close();
    }catch(error){$('#delete-app-error').textContent=error.message;$('#delete-app-error').hidden=false;}
    finally{deleting=false;$('#confirm-delete-app').disabled=false;$('#cancel-delete-app').disabled=false;$('#confirm-delete-app').textContent='Xóa ứng dụng';render();}
  });
  $('#saved-search').addEventListener('input',render);$('#refresh-apps').addEventListener('click',load);
  window.addEventListener('appspace:signed',load);load();
})();
