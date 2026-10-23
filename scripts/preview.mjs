import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.plist':'text/xml; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.ipa':'application/octet-stream'};
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    // /apple/ reproduces the repository subpath used by GitHub Pages.
    if (pathname === '/apple') { res.writeHead(302,{Location:'/apple/'}); return res.end(); }
    if (pathname.startsWith('/apple/')) pathname = pathname.slice(6);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const relative = pathname.replace(/^\/+/, '');
    const publicFiles = new Set(['index.html','catalog.html','catalog.css','catalog.js','appstore.css','app.js','apps.js','shared.js','site-logo.js','site-settings.json','favicon.svg','README.md']);
    if (!publicFiles.has(relative) && !/^assets\/[\w.-]+\.(png|jpe?g|webp|svg)$/.test(relative) && !/^downloads\/[\w.-]+\.ipa$/.test(relative)) { res.writeHead(404); return res.end('Not found'); }
    if (relative.split(/[\\/]/).some((part) => part.startsWith('.')) || relative.startsWith('scripts/')) { res.writeHead(404); return res.end('Not found'); }
    const file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403); return res.end(); }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); return res.end(); }
    const ext = path.extname(file).toLowerCase();
    const headers = {'Content-Type':types[ext] || 'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if (ext === '.ipa') headers['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/[^a-zA-Z0-9._-]/g,'_')}"`;
    res.writeHead(200, headers);
    if(req.method === 'HEAD') return res.end();
    const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port,'127.0.0.1', () => console.log(`AppSpace: http://127.0.0.1:${port}/apple/`));
