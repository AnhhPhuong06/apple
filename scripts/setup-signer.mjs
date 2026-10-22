import {mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=path.resolve(root,'tools','zsign');
await mkdir(target,{recursive:true});
const builds={win32:{name:'zsign-windows-x64.zip',hash:'6fb5e12a5b7179cfe7e729aa471b35ccf86474eba33d8203df119bf62bad77f7'},linux:{name:'zsign-linux-musl-static.tar.gz',hash:'323533d2deb04c84149820f6123fa037adb3c2849d3c213833f9a212da219cad'}};
if(process.arch!=='x64' || !builds[process.platform]) throw Error('Cài zsign theo hướng dẫn chính thức, rồi đặt ZSIGN_BIN đến file thực thi cho nền tảng này.');
const build=builds[process.platform], archive=path.join(target,build.name);
const response=await fetch(`https://github.com/zhlynn/zsign/releases/download/v1.1.3/${build.name}`,{signal:AbortSignal.timeout(120000)});
if(!response.ok) throw Error(`Download failed: ${response.status}`);
const bytes=Buffer.from(await response.arrayBuffer());
if(createHash('sha256').update(bytes).digest('hex')!==build.hash) throw Error('SHA256 verification failed.');
await writeFile(archive,bytes);
if(process.platform==='win32') {
  const quote=value=>"'"+value.replace(/'/g,"''")+"'";
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(target)} -Force`],{windowsHide:true});
} else {execFileSync('tar',['-xzf',archive,'-C',target]);await chmod(path.join(target,'zsign'),0o755);}
await rm(archive);
console.log('Installed verified zsign v1.1.3 to tools/zsign.');
