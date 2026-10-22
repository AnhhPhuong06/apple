(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const {escapeHTML:esc, appIcon, svg, isIPAUrl, formatSize, slugify, catalogText} = window.AppSpace;
  const form = $('#app-form');
  let draft = (window.APP_CATALOG || []).filter((app) => !app.sample).map((app) => ({...app}));
  const localFiles = new Map();
  let selectedFile = null;
  let fileCheck = 0;
  let dirty = false;
  function message(text, success = false) { $('#form-message').textContent = text; $('#form-message').classList.toggle('success', success); $('#form-message').hidden = false; }
  function saveBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  function renderDraft() {
    $('#draft-count').textContent = `${draft.length} app`;
    $('#draft-empty').hidden = draft.length > 0;
    $('#export-config').disabled = !draft.length;
    $('#draft-list').innerHTML = draft.map((app) => `<div class="draft-item">${appIcon(app)}<div class="draft-item-info"><strong>${esc(app.name)}</strong><small>${esc(app.version)} · ${formatSize(app.size)}</small><small>${esc(app.file)}</small>${localFiles.has(app.id) ? `<button class="save-ipa" type="button" data-save="${esc(app.id)}">${svg('download')}Lưu IPA</button>` : ''}</div><button type="button" class="remove-draft" data-remove="${esc(app.id)}" aria-label="Bỏ ${esc(app.name)} khỏi bản nháp">Bỏ</button></div>`).join('');
  }
  async function selectFile(file) {
    const check = ++fileCheck;
    selectedFile = null;
    $('#file-label').textContent = file ? file.name : 'Chọn hoặc kéo file IPA vào đây';
    $('#file-status').textContent = 'Đang kiểm tra cấu trúc IPA…';
    try {
      if (!file) throw new Error('Chưa chọn file IPA.');
      if (file.size > 95 * 1024 * 1024) throw new Error('IPA vượt 95 MiB. Hãy tải file lên GitHub Releases và chọn nguồn Link HTTPS.');
      await globalThis.validateIPA(file);
      if (check !== fileCheck) return;
      selectedFile = file;
      $('#file-status').textContent = `${formatSize(file.size)} · Có cấu trúc IPA. Chưa kiểm tra chữ ký Apple.`;
    } catch (error) { if (check === fileCheck) $('#file-status').textContent = error.message; }
  }
  function updateSource() {
    const local = form.elements.source.value === 'local';
    $('#local-source').hidden = !local;
    $('#url-source').hidden = local;
    $('#ipa-file').disabled = !local;
    $('#ipa-url').disabled = local;
    $('#ipa-url').required = !local;
    form.elements.sizeMB.disabled = local;
  }
  $('#ipa-file').addEventListener('change', (event) => selectFile(event.target.files[0]));
  form.querySelectorAll('[name=source]').forEach((input) => input.addEventListener('change', updateSource));
  const zone = $('#dropzone');
  ['dragenter','dragover'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave','drop'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (event) => { if (event.dataTransfer.files.length !== 1) { $('#file-status').textContent='Mỗi lần chỉ chọn một file IPA.'; selectedFile=null; fileCheck++; return; } selectFile(event.dataTransfer.files[0]); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const name = String(values.get('name')).trim();
    const subtitle = String(values.get('subtitle')).trim();
    const version = String(values.get('version')).trim();
    const id = slugify(name);
    if (!name || !subtitle) return message('Hãy nhập tên và mô tả ngắn cho ứng dụng.');
    if (draft.some((app) => app.id === id)) return message('Tên này đã có trong bản nháp. Hãy bỏ bản cũ hoặc dùng tên khác.');
    let file, size;
    if (values.get('source') === 'local') {
      if (!selectedFile) return message('Hãy chọn file .ipa hợp lệ và đợi kiểm tra xong.');
      file = `downloads/${id}-${version}.ipa`;
      size = selectedFile.size;
    } else {
      file = String(values.get('url')).trim();
      if (!isIPAUrl(file) || !file.startsWith('https://')) return message('Dùng link HTTPS trỏ tới file có đuôi .ipa.');
      size = values.get('sizeMB') ? Math.round(Number(values.get('sizeMB')) * 1024 * 1024) : null;
      if (size !== null && (!Number.isFinite(size) || size <= 0)) return message('Dung lượng không hợp lệ.');
    }
    const app = {id, name, subtitle, description:String(values.get('description')).trim() || subtitle, category:values.get('category'), icon:values.get('icon'), color:values.get('color'), version, minimumIOS:String(values.get('minimumIOS')).trim() || null, size, file, sample:false};
    draft.push(app);
    if (values.get('source') === 'local') localFiles.set(id, selectedFile);
    dirty = true;
    renderDraft();
    message(`Đã thêm ${name} vào bản nháp. Tải apps.js và lưu IPA trước khi đóng tab.`, true);
    form.reset(); selectedFile=null; fileCheck++; updateSource();
    $('#file-label').textContent='Chọn hoặc kéo file IPA vào đây';
    $('#file-status').textContent='File lớn hơn nên đặt trong GitHub Releases rồi dùng link HTTPS.';
  });
  $('#draft-list').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) { draft=draft.filter((app) => app.id!==remove.dataset.remove); localFiles.delete(remove.dataset.remove); dirty=true; renderDraft(); }
    const save = event.target.closest('[data-save]');
    if (save) { const app=draft.find((item)=>item.id===save.dataset.save); const file=localFiles.get(app.id); if(file) saveBlob(file, app.file.split('/').pop()); }
  });
  $('#export-config').addEventListener('click', () => { saveBlob(new Blob([catalogText(draft)], {type:'text/javascript;charset=utf-8'}), 'apps.js'); dirty=false; message('Đã xuất apps.js. Hãy lưu các IPA trong bản nháp, đặt vào downloads/ và commit cùng cấu hình lên GitHub.', true); });
  window.addEventListener('beforeunload', (event) => { if(dirty) { event.preventDefault(); event.returnValue=''; } });
  renderDraft();
})();
