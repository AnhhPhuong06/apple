(function () {
  'use strict';
  const icons = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="2" fill="currentColor"/><rect x="14" y="3" width="7" height="7" rx="2" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="2" fill="currentColor"/><rect x="14" y="14" width="7" height="7" rx="2" fill="currentColor" opacity=".5"/>',
    search:'<circle cx="10.8" cy="10.8" r="7.2"/><path d="m16.2 16.2 4.5 4.5"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    phone:'<rect x="6.5" y="2" width="11" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    sparkles:'<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" fill="currentColor" stroke="none"/><path d="m20 1 .8 2.2L23 4l-2.2.8L20 7l-.8-2.2L17 4l2.2-.8Z" fill="currentColor" stroke="none"/>',
    focus:'<circle cx="12" cy="13" r="7.5"/><path d="M12 8v5l3 2M9.5 2.5h5m-2.5 0v3m5.5 1.5 2-2"/>',
    pen:'<path d="m5 15.5-1.5 5.5L9 19.5 20 8.5a2.8 2.8 0 0 0-4-4L5 15.5Z"/><path d="m13.5 7 4 4M5 15.5l4 4"/>',
    music:'<path d="M9.5 17V6l11-2.5v11M9.5 9.5l11-2.5"/><ellipse cx="6" cy="17.5" rx="3.5" ry="2.5" fill="currentColor" stroke="none"/><ellipse cx="17" cy="15" rx="3.5" ry="2.5" fill="currentColor" stroke="none"/>',
    globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3.5 8.5h17M3.5 15.5h17"/>',
    folder:'<path d="M2.5 7a2 2 0 0 1 2-2H10l2.5 3h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V7Z"/><path d="M2.5 11.5h19"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>'
  };
  const colors = ['purple','green','orange','pink','blue','sand'];
  const categories = ['Năng suất','Sáng tạo','Giải trí','Tiện ích'];
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
  function appIcon(app) { return `<span class="app-icon ${colors.includes(app.color) ? app.color : 'purple'}">${svg(app.icon)}</span>`; }
  function isIPAUrl(value) {
    if (typeof value !== 'string' || !value || /[\s\\]/.test(value)) return false;
    if (/^downloads\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.ipa$/i.test(value) && !value.includes('..')) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && /\.ipa$/i.test(url.pathname); } catch { return false; }
  }
  function isHTTPSUrl(value) {
    if (typeof value !== 'string' || !value || /[\s\\]/.test(value)) return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname && !url.hash; } catch { return false; }
  }
  const formatSize = (bytes) => !Number.isFinite(bytes) || bytes <= 0 ? 'Chưa bổ sung' : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  const normalize = (text) => String(text ?? '').toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
  const slugify = (text) => normalize(text).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'app';
  const catalogText = (apps) => 'window.APP_CATALOG = ' + JSON.stringify(apps, null, 2) + ';\n';
  window.AppSpace = {svg, escapeHTML, appIcon, isIPAUrl, isHTTPSUrl, formatSize, normalize, slugify, catalogText, colors, categories};
  document.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = svg(element.dataset.icon); });
})();
