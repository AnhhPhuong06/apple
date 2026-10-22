(async () => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const {isIPAUrl, isHTTPSUrl, formatSize} = window.AppSpace;
  const catalog = Array.isArray(window.APP_CATALOG) ? window.APP_CATALOG : [];
  const params = new URLSearchParams(location.search);
  let app = catalog.find((item) => item.id === params.get('app')) || catalog.find((item) => item && !item.sample) || catalog.find((item) => item) || {};
  const publishedApp = params.has('job') ? catalog.find(item => item.id === params.get('job') && item.generated) : null;
  if (publishedApp) app = publishedApp;
  if (params.has('job') && !publishedApp) {
    try {
      const response = await fetch(`api/apps/${encodeURIComponent(params.get('job'))}`);
      if (!response.ok) throw new Error();
      app = await response.json();
    } catch {
      document.title = 'Không tìm thấy ứng dụng — AppSpace';
      const main = document.querySelector('main'); main.replaceChildren();
      const heading = document.createElement('h1'); heading.textContent = 'Không tìm thấy ứng dụng.';
      const message = document.createElement('p'); message.textContent = 'Liên kết không còn tồn tại hoặc máy chủ chưa sẵn sàng. Hãy kiểm tra lại link từ người chia sẻ.';
      const link = document.createElement('a'); link.href = 'index.html'; link.textContent = 'Về trang ứng dụng'; link.className = 'text-button';
      main.append(heading,message,link); main.style.paddingBlock = '60px'; document.documentElement.classList.remove('loading-app'); return;
    }
  }
  const installDialog = $('#install-dialog');
  const previewDialog = $('#preview-dialog');
  const shareDialog = $('#share-dialog');
  const track = $('#screenshot-track');
  const defaultIcon = app.generated ? 'assets/app-default.svg' : 'assets/app-icon.png';
  const localFile = (value) => { try { const url = new URL(value,location.href); return url.origin === location.origin && /^\/files\/[0-9a-f-]{36}\/[\w.-]+$/.test(url.pathname); } catch { return false; } };
  const safeImage = (value) => typeof value === 'string' && (/^assets\/[\w./-]+\.(png|jpe?g|webp|svg)$/i.test(value) && !value.includes('..') || isHTTPSUrl(value) || localFile(value));
  const icon = safeImage(app.iconImage) ? app.iconImage : defaultIcon;
  const customShots = Array.isArray(app.screenshots) ? app.screenshots.filter(safeImage) : [];
  const screenshots = app.generated ? customShots : customShots.length ? customShots : ['assets/preview-1.jpg','assets/preview-2.jpg','assets/preview-3.jpg'];
  const name = app.name || 'Ngọc Rồng Hot';
  let activePreview = 0;
  let toastTimer;
  function setText(selector, value) { document.querySelectorAll(selector).forEach((element) => { element.textContent = value; }); }
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
  function openDialog(dialog) { dialog.showModal(); }
  function closeDialog(dialog) { dialog.close(); }
  function installStatus(message, error = false) { const status = $('#install-status'); status.textContent = message; status.hidden = false; status.classList.toggle('error', error); }
  const size = Number.isFinite(app.size) && app.size > 0 ? formatSize(app.size).replace('.0 MB', ' MB') : 'Chưa cập nhật';
  if (app.generated) {
    setText('.hero-eyebrow', 'ỨNG DỤNG CỦA BẠN. SẴN SÀNG TRẢI NGHIỆM.');
    setText('#description-title', 'Mô tả');
    setText('#guide-title', 'Cài đặt ứng dụng');
    setText('.guide-lead', 'Chỉ vài bước để bắt đầu trải nghiệm.');
    setText('.bottom-app > div > span', 'Dành cho iPhone & iPad');
    setText('.breadcrumb', app.category || 'Ứng dụng');
    setText('.nav-links .active', 'Ứng dụng');
    setText('.information-list > div:nth-child(3) dd', app.category || 'Ứng dụng');
    $('.dragon').textContent = '⌘';
    $('#description-toggle').hidden = true; $('.game-tags').hidden = true;
    $('#description-extra').hidden = true;
    $('#preview').hidden = !screenshots.length;
    $('.updates-section').hidden = !app.releaseNotes?.length;
    $('.description-section').hidden = !app.description;
    $('.preview-hint').hidden = true;
    if (!screenshots.length) document.querySelector('a[href="#preview"]').hidden = true;
    $('meta[name="description"]').content = app.subtitle || app.name;
    document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').forEach(link=>link.href=icon);
  }
  document.title = `${name} — Tải ứng dụng`;
  setText('[data-app-name], #app-title', name);
  setText('#app-subtitle', app.subtitle || 'Ứng dụng dành cho iPhone & iPad');
  setText('#app-description', app.description || app.subtitle || '');
  setText('[data-version]', app.version || '1.0.0');
  setText('[data-developer], #developer-value', app.developer || name + ' Studio');
  setText('[data-size], #size-value', size);
  setText('#age-value, #info-age', app.age || (app.generated ? '—' : '12+'));
  setText('#compatibility', app.minimumIOS ? `iOS ${app.minimumIOS} trở lên` : 'Xem yêu cầu của nhà phát triển');
  setText('#rating-value', app.rating || '—');
  setText('#rating-count', app.ratingCount ? `${app.ratingCount} ĐÁNH GIÁ` : 'ĐÁNH GIÁ');
  $('.stars').setAttribute('aria-label', app.rating ? `${app.rating} trên 5 sao` : 'Chưa có đánh giá');
  if (!app.rating) $('.stars').hidden = true;
  ['#app-icon','#bottom-icon','#install-icon'].forEach((selector) => { const image = $(selector); image.src = icon; image.addEventListener('error', () => { if(image.getAttribute('src') !== defaultIcon) image.src = defaultIcon; }); });
  $('#app-icon').alt = `Biểu tượng ${name}`;
  setText('#install-title', `Cài đặt ${name}?`);
  if (Array.isArray(app.releaseNotes)) { $('#release-notes').replaceChildren(...app.releaseNotes.map((text) => { const li = document.createElement('li'); li.textContent = text; return li; })); }
  // Construct elements directly; configuration is never interpreted as HTML.
  track.replaceChildren(...screenshots.map((src, index) => {
    const button = document.createElement('button'); button.className = 'screenshot'; button.dataset.preview = index; button.setAttribute('aria-label', `Phóng to ảnh ${index + 1}`);
    const image = document.createElement('img'); image.src = src; image.alt = `${name} — ảnh xem trước ${index + 1}`; image.width = 960; image.height = 540; if (index > 1) image.loading = 'lazy';
    button.append(image); return button;
  }));
  function updateGalleryControls() { $('#preview-prev').disabled = track.scrollLeft < 5; $('#preview-next').disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 5; }
  function moveGallery(direction) { const item = track.querySelector('.screenshot'); if(item) track.scrollBy({left:direction * (item.getBoundingClientRect().width + parseFloat(getComputedStyle(track).gap)), behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); }
  $('#preview-prev').addEventListener('click', () => moveGallery(-1));
  $('#preview-next').addEventListener('click', () => moveGallery(1));
  track.addEventListener('scroll', updateGalleryControls, {passive:true});
  new ResizeObserver(updateGalleryControls).observe(track);
  track.addEventListener('keydown', (event) => { if(event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); moveGallery(event.key === 'ArrowRight' ? 1 : -1); } });
  function showPreview(index) { activePreview = (index + screenshots.length) % screenshots.length; $('#lightbox-image').src = screenshots[activePreview]; $('#lightbox-image').alt = `${name} — ảnh xem trước ${activePreview + 1}`; setText('#preview-counter', `${activePreview + 1} / ${screenshots.length}`); }
  track.addEventListener('click', (event) => { const button = event.target.closest('[data-preview]'); if (button) { showPreview(Number(button.dataset.preview)); openDialog(previewDialog); } });
  $('#lightbox-prev').addEventListener('click', () => showPreview(activePreview - 1));
  $('#lightbox-next').addEventListener('click', () => showPreview(activePreview + 1));
  $('.lightbox-close').addEventListener('click', () => closeDialog(previewDialog));
  previewDialog.addEventListener('keydown', (event) => { if(event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); showPreview(activePreview + (event.key === 'ArrowRight' ? 1 : -1)); } });
  const manifestUrl = isHTTPSUrl(app.manifestUrl) ? app.manifestUrl : null;
  const fileUrl = isIPAUrl(app.file) || (localFile(app.file) && /\/app\.ipa$/.test(app.file)) ? app.file : null;
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  document.querySelectorAll('[data-install]').forEach((button) => button.addEventListener('click', () => {
    $('#install-status').hidden = true; $('#confirm-install').disabled = false; $('#confirm-install').textContent = 'Cài đặt';
    if (!manifestUrl && fileUrl) { $('#confirm-install').textContent = 'Tải file IPA'; if(app.installUnavailable) installStatus(app.installUnavailable); }
    openDialog(installDialog);
  }));
  $('#cancel-install').addEventListener('click', () => closeDialog(installDialog));
  $('#confirm-install').addEventListener('click', () => {
    if(manifestUrl) {
      if (!isIOS) { installStatus('Hãy mở trang này bằng Safari trên iPhone hoặc iPad để cài đặt ứng dụng.', true); return; }
      // The OS owns installation. A browser event cannot confirm success.
      window.location.href = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
      installStatus('Hãy xác nhận trong thông báo của iOS. Sau đó kiểm tra ứng dụng trên màn hình chính.');
    } else if (fileUrl) {
      const link = document.createElement('a'); link.href = fileUrl; link.download = ''; if(fileUrl.startsWith('https:')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; } document.body.append(link); link.click(); link.remove();
      installStatus('Đã gửi yêu cầu tải file IPA. Tải file chỉ lưu về thiết bị; bạn cần phương thức cài đặt phù hợp để sử dụng.');
    } else {
      installStatus('Ứng dụng chưa có liên kết cài đặt. Vui lòng quay lại khi nhà phát triển cập nhật bản tải.', true);
    }
  });
  if(fileUrl) { const link = $('#direct-download'); link.href = fileUrl; link.download = ''; link.hidden = false; if(fileUrl.startsWith('https:')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; } }
  $('#description-toggle').addEventListener('click', () => { const expanded = $('#description-toggle').getAttribute('aria-expanded') === 'true'; $('#description-extra').hidden = expanded; $('#description-toggle').setAttribute('aria-expanded', String(!expanded)); $('#description-toggle').firstChild.textContent = expanded ? 'Xem thêm ' : 'Thu gọn '; });
  function openShare() { $('#share-url').value = window.location.href.split('#')[0]; openDialog(shareDialog); }
  $('#share-button').addEventListener('click', async () => { if(navigator.share) { try { await navigator.share({title:name,text:`Khám phá ${name} dành cho iPhone & iPad.`,url:window.location.href.split('#')[0]}); } catch(error) { if(error.name !== 'AbortError') openShare(); } } else openShare(); });
  $('#copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#share-url').value); closeDialog(shareDialog); toast('Đã sao chép liên kết ứng dụng.'); } catch { $('#share-url').focus(); $('#share-url').select(); $('#copy-link').textContent = 'Chọn “Sao chép” để lấy liên kết'; } });
  document.querySelectorAll('dialog').forEach((dialog) => { dialog.addEventListener('click', (event) => { if(event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if(event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog); }); });
  updateGalleryControls();
  document.documentElement.classList.remove('loading-app');
})();
