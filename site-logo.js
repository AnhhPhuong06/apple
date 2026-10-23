(() => {
  let revision=0,current={logoUrl:''};
  function validLogo(value) {
    if(typeof value!=='string' || value.length>2048 || /[\s\\]/.test(value))return false;
    try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.hash;}catch{return false;}
  }
  function apply(settings) {
    const logoUrl=validLogo(settings?.logoUrl)?settings.logoUrl:'';
    current={logoUrl};const version=++revision;
    document.querySelectorAll('.brand-mark').forEach(mark=>{
      mark.classList.remove('custom-logo');mark.innerHTML=window.AppSpace.svg('grid');
      if(!logoUrl)return;
      const image=new Image();image.alt='';image.referrerPolicy='no-referrer';image.decoding='async';
      image.addEventListener('load',()=>{if(version!==revision)return;mark.replaceChildren(image);mark.classList.add('custom-logo');});
      image.src=logoUrl;
    });
    return current;
  }
  const ready=fetch(new URL('site-settings.json',document.baseURI),{cache:'no-store'})
    .then(response=>{if(!response.ok)throw Error();return response.json();}).then(apply).catch(()=>current);
  window.AppSpaceBrand={apply,validLogo,ready};
})();
