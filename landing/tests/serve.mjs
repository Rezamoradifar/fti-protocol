import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp'};
// Match the production policy: no Google stylesheet/font allowlist.
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.reown.com; img-src 'self' data:; base-uri 'none'";
http.createServer((req,res)=>{
  if(req.url==='/api/config'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({chainId:97,mode:'bnb-testnet'}));return;}
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname.endsWith('/'))pathname+='index.html';
  const workspace = /^\/(app|token|admin)\//.test(pathname) || pathname.startsWith('/vendor/');
  const base = workspace ? path.resolve('../web') : root;
  if (pathname === '/vendor/ethers.js') {
    res.writeHead(200,{'Content-Type':'text/javascript'});
    fs.createReadStream(path.resolve('../node_modules/ethers/dist/ethers.min.js')).pipe(res);return;
  }
  const file=path.resolve(base,'.'+pathname.replace(/^\/(app|token|admin)\//,'/'));
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Security-Policy':csp});
  fs.createReadStream(file).pipe(res);
}).listen(4173,'127.0.0.1');
