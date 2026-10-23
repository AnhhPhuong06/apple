(() => {
  const $=selector=>document.querySelector(selector),form=$('#certificate-save-form'),select=$('#saved-certificate'),dialog=$('#delete-certificate-dialog');
  let records=[],busy=false,signing=false,pending=null;
  const labels={good:'Apple xác nhận tốt',unknown:'Chưa xác minh Apple',expired:'Đã hết hạn',invalid:'Không khớp / không hợp lệ',revoked:'Đã bị thu hồi','not-yet-valid':'Chưa có hiệu lực'};
  const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const date=value=>Number.isFinite(value)?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Chưa rõ';
  function message(text,error=false){$('#certificate-message').textContent=text;$('#certificate-message').classList.toggle('error',error);$('#certificate-message').hidden=false;}
  async function request(url,options={}) {
    const response=await fetch(url,{...options,headers:{'X-AppSpace-Admin':'1',...options.headers}});
    if(response.status===401){location.replace('/admin/login');throw Error('Phiên đăng nhập đã hết hạn.');}
    let data;try{data=await response.json();}catch{throw Error('Máy chủ chưa trả về thông tin chứng chỉ hợp lệ.');}
    if(!response.ok)throw Error(data.error || 'Không xử lý được yêu cầu kho chứng chỉ.');
    return data;
  }
  function selectedStatus(){const record=records.find(item=>item.id===select.value);$('#saved-certificate-status').textContent=record?`${labels[record.status] || record.status} · ${record.message}`:'Chọn bộ đã lưu để chỉ cần tải IPA khi ký.';if(select.value)sessionStorage.setItem('appspace-certificate-id',select.value);else sessionStorage.removeItem('appspace-certificate-id');}
  function setBusy(value){busy=value;$('#save-certificate').disabled=value;$('#refresh-certificates').disabled=value;$('#certificate-list').querySelectorAll('button').forEach(button=>button.disabled=value || (button.classList.contains('use-certificate') && (signing || button.dataset.usable!=='true')));}
  function render() {
    const selected=select.value || sessionStorage.getItem('appspace-certificate-id');
    select.replaceChildren(node('option','','Tải chứng chỉ mới'));select.options[0].value='';
    for(const record of records){const option=node('option','',`${record.label} — ${labels[record.status] || record.status}`);option.value=record.id;option.disabled=!record.usable;select.append(option);}
    if(records.some(record=>record.id===selected && record.usable))select.value=selected;
    $('#certificate-count').textContent=String(records.length);$('#certificate-empty').hidden=records.length>0;$('#certificate-empty').textContent='Chưa lưu chứng chỉ. Mở “Lưu bộ chứng chỉ mới” để thêm.';
    $('#certificate-list').replaceChildren(...records.map(record=>{
      const row=node('article','certificate-row'),heading=node('div','certificate-row-heading');heading.append(node('h3','',record.label),node('span','certificate-badge status-'+record.status,labels[record.status] || record.status));
      row.append(heading,node('p','certificate-subject',record.name),node('p','certificate-reason',record.message));
      const info=node('div','certificate-metadata');for(const [label,value] of [['Chứng chỉ hết hạn',date(record.expiresAt)],['Hồ sơ hết hạn',date(record.profileExpiresAt)],['Team ID',record.teamId],['App ID',record.applicationIdentifier],['Hồ sơ',record.profileName],['Loại',record.distribution==='enterprise'?'Enterprise':record.distribution==='ad-hoc'?`Ad Hoc · ${record.deviceCount} thiết bị`:record.distribution==='development'?`Development · ${record.deviceCount} thiết bị`:'App Store']]){const field=node('div');field.append(node('small','',label),node('span','',value));info.append(field);}row.append(info);
      row.append(node('p','certificate-last-check',`Kiểm tra lúc ${date(record.checkedAt)}${record.revocation?.checkedAt?' · OCSP: '+(record.revocation.status==='good'?'tốt':record.revocation.status==='revoked'?'thu hồi':'chưa xác minh'):''}`));
      const actions=node('div','certificate-actions'),use=node('button','copy-app-link use-certificate','Dùng để ký'),check=node('button','copy-app-link','Check chứng chỉ'),remove=node('button','delete-app-button','Xóa khỏi kho');
      for(const button of [use,check,remove])button.type='button';use.dataset.usable=String(record.usable);use.disabled=!record.usable || signing || busy;
      use.addEventListener('click',()=>{if(signing || busy)return;const signMode=document.querySelector('[name="publish-mode"][value="sign"]');signMode.checked=true;select.value=record.id;signMode.dispatchEvent(new Event('change'));select.dispatchEvent(new Event('change'));$('#sign-form').scrollIntoView({behavior:'smooth'});$('#sign-form').elements.ipa.focus({preventScroll:true});});
      check.addEventListener('click',async()=>{if(busy)return;setBusy(true);message(`Đang kiểm tra ${record.label}, bao gồm phản hồi OCSP Apple…`);try{const updated=await request('/api/admin/certificates/'+record.id+'/check',{method:'POST'});records=records.map(item=>item.id===record.id?updated:item);render();message(`${updated.label}: ${updated.message}`);}catch(error){message(error.message,true);}finally{setBusy(false);}});
      remove.addEventListener('click',()=>{if(busy)return;pending=record;$('#delete-certificate-name').textContent=record.label;$('#delete-certificate-error').hidden=true;dialog.showModal();});
      actions.append(use,check,remove);row.append(actions);return row;
    }));
    selectedStatus();select.dispatchEvent(new Event('change'));setBusy(busy);
  }
  async function load(){if(busy)return;setBusy(true);try{records=(await request('/api/admin/certificates')).certificates;render();}catch(error){$('#certificate-empty').textContent='Chưa tải được kho chứng chỉ. Nhấn “Làm mới kho” để thử lại.';message(error.message,true);}finally{setBusy(false);}}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const p12=form.elements.vaultP12.files[0],profile=form.elements.vaultProfile.files[0];
    if(!p12 || !/\.p12$/i.test(p12.name) || p12.size>1024**2 || !profile || !/\.mobileprovision$/i.test(profile.name) || profile.size>10*1024**2)return message('Chọn đúng .p12 (tối đa 1 MB) và .mobileprovision (tối đa 10 MB).',true);
    const data=new FormData();data.append('p12',p12);data.append('profile',profile);data.append('password',form.elements.vaultPassword.value);data.append('label',form.elements.vaultLabel.value);
    setBusy(true);message('Đang mở chứng chỉ, kiểm tra hồ sơ và OCSP Apple…');
    try{const record=await request('/api/admin/certificates',{method:'POST',body:data});records.unshift(record);form.reset();render();if(record.usable){select.value=record.id;select.dispatchEvent(new Event('change'));}message(`Đã lưu ${record.label}. ${record.message}`);}
    catch(error){message(error.message,true);}finally{data.delete('password');data.delete('p12');data.delete('profile');setBusy(false);}
  });
  $('#refresh-certificates').addEventListener('click',load);select.addEventListener('change',selectedStatus);
  $('#cancel-delete-certificate').addEventListener('click',()=>{if(!busy)dialog.close();});dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#confirm-delete-certificate').addEventListener('click',async()=>{
    if(!pending || busy)return;const record=pending;setBusy(true);$('#confirm-delete-certificate').disabled=true;$('#cancel-delete-certificate').disabled=true;
    try{await request('/api/admin/certificates/'+record.id,{method:'DELETE'});records=records.filter(item=>item.id!==record.id);if(select.value===record.id){select.value='';sessionStorage.removeItem('appspace-certificate-id');}pending=null;render();dialog.close();message('Đã xóa bộ chứng chỉ khỏi kho. Các app đã ký được giữ nguyên.');}
    catch(error){$('#delete-certificate-error').textContent=error.message;$('#delete-certificate-error').hidden=false;}finally{setBusy(false);$('#confirm-delete-certificate').disabled=false;$('#cancel-delete-certificate').disabled=false;}
  });
  window.addEventListener('appspace:signingstate',event=>{signing=event.detail.active;setBusy(busy);});
  load();
})();
