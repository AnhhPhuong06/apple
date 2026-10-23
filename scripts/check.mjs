import {readFile, stat} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import '../ipa-validator.js';
import {validateSiteSettings} from '../server/site-settings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = ['apps.js','shared.js','app-data.js','app.js','manage.js','sign.js','site-logo.js','site-settings-admin.js','server/site-settings.mjs','admin-apps.js','catalog.js','admin-login.js','server/config.mjs','server/images.mjs','server/catalog.mjs','server/auth.mjs','server/app.mjs','server/index.mjs','server/signing.mjs','ipa-validator.js','scripts/setup-signer.mjs','scripts/preview.mjs','scripts/build.mjs','scripts/export-pages.mjs'];
for(const file of [...scripts,'upload.js','server/uploads.mjs','server/app-revisions.mjs','server/publishing.mjs','server/certificate-check.mjs','server/certificate-vault.mjs','server/certificates.mjs','certificates-admin.js']) execFileSync(process.execPath, ['--check', path.join(root,file)], {stdio:'pipe'});
validateSiteSettings(JSON.parse(await readFile(path.join(root,'site-settings.json'),'utf8')));
const source = await readFile(path.join(root,'apps.js'),'utf8');
const match = source.match(/^\s*window\.APP_CATALOG\s*=\s*([\s\S]+?);?\s*$/);
if(!match) throw new Error('apps.js must assign a JSON array to window.APP_CATALOG.');
const apps = JSON.parse(match[1]);
if(!Array.isArray(apps)) throw new Error('Catalog must be an array.');
const sandbox = {window:{}, document:{querySelectorAll:()=>[]}, URL};
vm.runInNewContext(await readFile(path.join(root,'shared.js'),'utf8'), sandbox);
const {isIPAUrl, isHTTPSUrl, categories, colors} = sandbox.window.AppSpace;
const ids = new Set();
for(const app of apps) {
  if (!/^[a-z0-9_-]+$/i.test(app.id || '') || ids.has(app.id)) throw new Error(`Invalid or duplicate app id: ${app.id}`);
  ids.add(app.id);
  if (typeof app.name !== 'string' || !app.name.trim() || !categories.includes(app.category) || !colors.includes(app.color)) throw new Error(`Invalid app metadata: ${app.id}`);
  if(app.manifestUrl && !isHTTPSUrl(app.manifestUrl)) throw new Error(`An installation manifest must use an HTTPS URL: ${app.id}`);
  if(app.file) {
    if(!isIPAUrl(app.file)) throw new Error(`Only local .ipa files or HTTPS .ipa links are supported: ${app.id}`);
    if(app.file.startsWith('downloads/')) {
      const file = path.join(root,app.file);
      const info = await stat(file);
      if(info.size > 95*1024*1024) throw new Error(`${app.file} exceeds the 95 MiB project limit. Use a GitHub Release link.`);
      const blob = await openAsBlob(file);
      Object.defineProperty(blob,'name',{value:path.basename(file)});
      await globalThis.validateIPA(blob);
      if(app.size !== info.size) throw new Error(`File size mismatch: ${app.id}`);
    }
  } else if(!app.sample && !app.manifestUrl) throw new Error(`An actual app needs an IPA or installation manifest URL: ${app.id}`);
  for (const asset of [app.iconImage, ...(app.screenshots || [])].filter(Boolean)) {
    if (isHTTPSUrl(asset)) continue;
    if (!/^assets\/[\w./-]+\.(png|jpe?g|webp|svg)$/i.test(asset) || asset.includes('..')) throw new Error(`Invalid image path: ${asset}`);
    await stat(path.join(root,asset));
  }
}
for(const name of ['index.html','catalog.html','manage.html','sign.html','admin-login.html']) {
  const html = await readFile(path.join(root,name),'utf8');
  for(const entry of html.replace(/<base\b[^>]*>/g,'').matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const link = entry[1];
    if(/^(https?:|data:)/.test(link)) continue;
    if(link==='admin') continue; // Authenticated server route.
    if(link.startsWith('/')) throw new Error(`Root-relative path will break project Pages: ${link}`);
    await stat(path.join(root,link.split('#')[0]));
  }
}
for(const url of ['javascript:alert(1)','https://example.com/app.apk','//example.com/app.ipa','downloads/../app.ipa']) {
  if(isIPAUrl(url)) throw new Error(`Unsafe download accepted: ${url}`);
}
console.log(`Checks passed: ${apps.length} catalog entries, JavaScript syntax, page assets, IPA links and local IPA structure.`);
