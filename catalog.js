(() => {
  const $=selector=>document.querySelector(selector);
  const {normalize,formatSize}=window.AppSpace;
  let apps=[],category='all';
  const set=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const imageURL=value=>{try{const url=new URL(value,location.href);return url.protocol==='https:' || url.origin===location.origin?url.href:'assets/app-default.svg';}catch{return 'assets/app-default.svg';}};
  function card(app) {
    const element=set('article','catalog-card');
    const top=set('div','catalog-card-top');const image=set('img');image.src=imageURL(app.iconImage || 'assets/app-default.svg');image.alt='';image.width=67;image.height=67;image.loading='lazy';image.addEventListener('error',()=>{if(!image.src.endsWith('/assets/app-default.svg'))image.src='assets/app-default.svg';});
    top.append(image,set('span','catalog-category',app.category || 'Ứng dụng'));
    const info=set('div','catalog-card-info');info.append(set('span','',app.version?'Phiên bản '+app.version:'iOS'),set('span','',formatSize(app.size)));
    const link=set('a','catalog-card-link');link.href='index.html?job='+encodeURIComponent(app.id);link.setAttribute('aria-label','Xem ứng dụng '+app.name);link.append(set('span','','Xem ứng dụng'),set('span','','↗'));
    element.append(top,set('h3','',app.name),set('p','',app.subtitle || app.developer || 'Dành cho iPhone & iPad'),info,link);return element;
  }
  function render() {
    const query=normalize($('#catalog-search').value.trim());
    const visible=apps.filter(app=>(category==='all' || app.category===category) && normalize([app.name,app.subtitle,app.developer].join(' ')).includes(query));
    if($('#catalog-sort').value==='name')visible.sort((a,b)=>a.name.localeCompare(b.name,'vi'));else visible.sort((a,b)=>(b.updatedAt || b.createdAt || 0)-(a.updatedAt || a.createdAt || 0) || a.name.localeCompare(b.name,'vi'));
    $('#catalog-count').textContent=visible.length+' ứng dụng';$('#catalog-grid').replaceChildren(...visible.map(card));
    $('#catalog-empty').hidden=visible.length>0;$('#clear-search').hidden=!apps.length;
    $('#empty-title').textContent=apps.length?'Chưa tìm thấy ứng dụng.':'Chưa có ứng dụng.';
    $('#empty-description').textContent=apps.length?'Thử tên khác hoặc chọn lại danh mục.':'Ứng dụng mới sẽ xuất hiện tại đây khi được phát hành.';
  }
  function selectCategory(value) {category=value;document.querySelectorAll('[data-category]').forEach(button=>{const active=button.dataset.category===value;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});render();}
  async function load() {
    $('#catalog-error').hidden=true;$('#catalog-count').textContent='Đang tải…';
    try {
      let records=window.APP_CATALOG || [];
      if(document.body.dataset.source==='server'){const response=await fetch('api/apps');if(!response.ok)throw Error();records=(await response.json()).apps;}
      if(!Array.isArray(records))throw Error();
      apps=records.filter(app=>app && !app.sample && typeof app.id==='string' && typeof app.name==='string');render();
    } catch {$('#catalog-error').hidden=false;$('#catalog-empty').hidden=true;$('#catalog-grid').replaceChildren();$('#catalog-count').textContent='';}
  }
  $('#catalog-search').addEventListener('input',render);$('#catalog-sort').addEventListener('change',render);
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>selectCategory(button.dataset.category)));
  $('#clear-search').addEventListener('click',()=>{$('#catalog-search').value='';selectCategory('all');});
  $('#catalog-retry').addEventListener('click',load);load();
})();
