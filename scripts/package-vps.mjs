import {mkdir,readFile,writeFile,copyFile,readdir,lstat,rm,chmod,mkdtemp} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import yazl from 'yazl';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const output=path.join(root,'packages');await mkdir(output,{recursive:true});
if((await lstat(output)).isSymbolicLink())throw new Error('Package output may not be a symbolic link.');
const staging=await mkdtemp(path.join(os.tmpdir(),'appspace-package-'));
const destination=path.join(staging,'appspace-vps');await mkdir(destination);
const files=['package.json','package-lock.json','.env.example','README.md','index.html','catalog.html','catalog.css','catalog.js','appstore.css','favicon.svg','apps.js','app-data.js','app.js','shared.js','site-logo.js','site-settings.json','site-settings-admin.js','sign.html','sign.css','sign.js','admin-apps.js','admin-login.html','admin-login.css','admin-login.js','ipa-validator.js','manage.html','manage.css','manage.js','styles.css'];
for(const [folder,pattern] of [['server',/\.mjs$/],['scripts',/\.mjs$/],['deploy',/\.(sh|mjs|md|service)$/],['assets',/\.(png|jpg|svg|webp)$/]]) {
  for(const entry of await readdir(path.join(root,folder),{withFileTypes:true}))if(entry.isFile() && pattern.test(entry.name))files.push(`${folder}/${entry.name}`);
}
for(const entry of await readdir(path.join(root,'public-apps'),{withFileTypes:true})) {
  if(!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name))throw new Error('Unexpected public app export.');
  for(const file of await readdir(path.join(root,'public-apps',entry.name))) {
    if(!/^(app\.(json|ipa)|manifest\.plist|icon\.png|preview-[0-4]\.(png|jpg))$/.test(file))throw new Error('Unexpected public app file.');
    files.push(`public-apps/${entry.name}/${file}`);
  }
}
const secretPath=path.join(root,'data','admin-key.txt');let secret='';
try{secret=(await readFile(secretPath,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}
const hashes={};
try {
  for(const relative of files.sort()) {
    const source=path.join(root,relative),target=path.join(destination,relative);
    if(!(await lstat(source)).isFile())throw new Error(`Not a regular file: ${relative}`);
    await mkdir(path.dirname(target),{recursive:true});
    let bytes=await readFile(source);
    if(!/\.(png|jpe?g|webp|ipa)$/.test(relative)) {
      const text=bytes.toString('utf8').replace(/\r\n/g,'\n');
      if(secret && text.includes(secret))throw new Error(`Private admin key found in package input: ${relative}`);
      if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw new Error(`Private key found: ${relative}`);
      bytes=Buffer.from(text);
    }
    await writeFile(target,bytes);await chmod(target,relative.endsWith('.sh')?0o755:0o644);
    hashes[relative]=createHash('sha256').update(bytes).digest('hex');
  }
  let commit='unversioned';try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,stdio:['ignore','pipe','ignore']}).toString().trim();}catch{}
  const info={name:'appspace-vps',target:'Ubuntu 24.04 LTS x86_64',createdAt:new Date().toISOString(),sourceCommit:commit,nodeVersion:'24.22.1',files:hashes};
  await writeFile(path.join(destination,'package-info.json'),JSON.stringify(info,null,2)+'\n');
  const tarName='appspace-vps.tar.gz',zipName='appspace-vps.zip';
  execFileSync('tar',['-czf',path.join(output,tarName),'-C',staging,'appspace-vps'],{windowsHide:true});
  const zip=new yazl.ZipFile();
  for(const relative of [...files,'package-info.json'].sort())zip.addFile(path.join(destination,relative),`appspace-vps/${relative}`,{mode:relative.endsWith('.sh')?0o100755:0o100644});
  const zipWrite=pipeline(zip.outputStream,createWriteStream(path.join(output,zipName)));zip.end();await zipWrite;
  await copyFile(path.join(destination,'deploy','HUONG-DAN-VPS.md'),path.join(output,'HUONG-DAN-VPS.md'));
  const checksums=[];
  for(const name of [tarName,zipName])checksums.push(`${createHash('sha256').update(await readFile(path.join(output,name))).digest('hex')}  ${name}`);
  await writeFile(path.join(output,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
  console.log(`Created VPS packages: ${output}\n${files.length} approved files plus package manifest. No local credentials or private data included.`);
} finally {await rm(staging,{recursive:true,force:true});}
