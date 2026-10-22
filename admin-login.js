(() => {
  const form=document.querySelector('#login-form');
  const password=document.querySelector('#admin-password');
  const toggle=document.querySelector('#toggle-password');
  const submit=document.querySelector('#login-submit');
  const error=document.querySelector('#login-error');
  toggle.addEventListener('click',()=>{const visible=password.type==='text';password.type=visible?'password':'text';toggle.textContent=visible?'Hiện':'Ẩn';toggle.setAttribute('aria-pressed',String(!visible));});
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;error.hidden=true;
    try {
      const response=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password.value}),credentials:'same-origin'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error || 'Không đăng nhập được. Hãy thử lại.');
      password.value='';
      const resume=new URLSearchParams(location.search).get('resume');
      location.replace('/admin'+(/^[0-9a-f-]{36}$/.test(resume || '')?'?resume='+resume:''));
    } catch(e) {error.textContent=e instanceof TypeError?'Không kết nối được máy chủ. Vui lòng thử lại.':e.message;error.hidden=false;submit.disabled=false;}
  });
})();
