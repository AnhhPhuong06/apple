import {copyFile, cp, mkdir, readFile, writeFile, rm, lstat, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = path.resolve(root, '_site');
if(output !== path.join(root,'_site') || !output.startsWith(root + path.sep)) throw new Error('Unsafe build output path.');
try { if((await lstat(output)).isSymbolicLink()) throw new Error('Build output may not be a symlink.'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
await rm(output, {recursive:true,force:true});
await mkdir(path.join(output,'downloads'), {recursive:true});
const files = ['index.html','appstore.css','favicon.svg','apps.js','shared.js','app.js','.nojekyll','README.md'];
for(const file of files) await copyFile(path.join(root,file), path.join(output,file));
await cp(path.join(root,'assets'), path.join(output,'assets'), {recursive:true});
const source = await readFile(path.join(root,'apps.js'),'utf8');
const apps = JSON.parse(source.match(/^\s*window\.APP_CATALOG\s*=\s*([\s\S]+?);?\s*$/)[1]);
for(const file of new Set(apps.map((app)=>app.file).filter((file)=>typeof file==='string' && /^downloads\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.ipa$/i.test(file) && !file.includes('..')))) await copyFile(path.join(root,file),path.join(output,file));
const exported=[];
let entries=[];
try { entries=await readdir(path.join(root,'public-apps'),{withFileTypes:true}); } catch(error) {if(error.code!=='ENOENT')throw error;}
for(const entry of entries) {
  if(!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name))throw new Error('Unexpected public-apps entry.');
  const from=path.join(root,'public-apps',entry.name);
  const record=JSON.parse(await readFile(path.join(from,'app.json'),'utf8'));
  if(record.id!==entry.name || !record.generated || !record.name || !/^https:\/\//.test(record.manifestUrl) || !/^https:\/\//.test(record.file))throw new Error('Invalid public app export.');
  if((await stat(path.join(from,'app.ipa'))).size!==record.size)throw new Error('Exported IPA size mismatch.');
  const to=path.join(output,'files',entry.name);await mkdir(to,{recursive:true});
  for(const file of await readdir(from)) {
    if(file==='app.json')continue;
    if(!/^(app\.ipa|manifest\.plist|icon\.png|preview-[0-4]\.(png|jpg))$/.test(file))throw new Error(`Unexpected public file: ${file}`);
    if((await lstat(path.join(from,file))).isSymbolicLink())throw new Error('Public files cannot be symbolic links.');
    await copyFile(path.join(from,file),path.join(to,file));
  }
  exported.push(record);
}
if(exported.length)await writeFile(path.join(output,'apps.js'),'window.APP_CATALOG = '+JSON.stringify(exported,null,2)+';\n');
console.log(`Static site prepared in ${output}`);
