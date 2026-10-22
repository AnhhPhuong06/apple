import {mkdir,readFile,writeFile,copyFile,stat,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateArchive,readAppInfo,manifestXML} from '../server/signing.mjs';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const [id,baseArgument]=process.argv.slice(2);
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id || '')) throw new Error('Usage: npm run export:pages -- <signed-app-id> https://USER.github.io/REPO');
const baseURL=(baseArgument || process.env.PAGES_BASE_URL || '').replace(/\/+$/,'');
const url=new URL(baseURL);
if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw new Error('Pages URL must use HTTPS without credentials, query or fragment.');
const source=path.join(path.resolve(process.env.DATA_DIR || path.join(root,'data')),'published',id);
const destination=path.join(root,'public-apps',id);
await mkdir(destination,{recursive:true});
if((await lstat(path.dirname(destination))).isSymbolicLink() || (await lstat(destination)).isSymbolicLink()) throw new Error('Export folders cannot be symbolic links.');
const original=JSON.parse(await readFile(path.join(source,'app.json'),'utf8'));
const ipa=path.join(source,'app.ipa');await validateArchive(ipa);
const size=(await stat(ipa)).size;
if(size>95*1024**2) throw new Error('This IPA exceeds the Git export limit. Host it in GitHub Releases instead.');
const info=await readAppInfo(ipa);
if(!info.CFBundleIdentifier || !info.CFBundleVersion)throw new Error('Signed app metadata is incomplete.');
const filenames=await readdir(source);
const images=filenames.filter(name=>/^(icon\.png|preview-[0-4]\.(png|jpg))$/.test(name));
for(const name of ['app.ipa',...images])await copyFile(path.join(source,name),path.join(destination,name));
// Explicit public fields only; never copy private signing inputs or server configuration.
const record={id,name:info.CFBundleDisplayName || info.CFBundleName,version:info.CFBundleShortVersionString || info.CFBundleVersion,buildVersion:info.CFBundleVersion,bundleId:info.CFBundleIdentifier,minimumIOS:info.MinimumOSVersion || null,subtitle:original.subtitle || 'Ứng dụng dành cho iPhone & iPad',description:original.description || '',category:original.category || 'Tiện ích',developer:original.developer || 'Nhà phát triển ứng dụng',icon:'sparkles',color:'blue',iconImage:images.includes('icon.png')?`${baseURL}/files/${id}/icon.png`:'assets/app-default.svg',screenshots:images.filter(name=>name.startsWith('preview-')).sort().map(name=>`${baseURL}/files/${id}/${name}`),size,releaseNotes:Array.isArray(original.releaseNotes)?original.releaseNotes:[],file:`${baseURL}/files/${id}/app.ipa`,manifestUrl:`${baseURL}/files/${id}/manifest.plist`,sample:false,generated:true};
await writeFile(path.join(destination,'app.json'),JSON.stringify(record,null,2)+'\n');
await writeFile(path.join(destination,'manifest.plist'),manifestXML({baseURL,id,bundleId:record.bundleId,version:record.buildVersion,name:record.name}));
console.log(`Exported ${record.name} ${record.version}: ${baseURL}/index.html?job=${id}`);
