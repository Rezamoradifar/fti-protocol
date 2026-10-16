import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
// Match the production policy: no Google stylesheet/font allowlist.
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.reown.com; img-src 'self' data:; base-uri 'none'";
http.createServer((req,res)=>{
  if(req.url==='/api/config'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({chainId:97,mode:'bnb-testnet'}));return;}
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname.endsWith('/'))pathname+='index.html';
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Security-Policy':csp});
  fs.createReadStream(file).pipe(res);
}).listen(4173,'127.0.0.1');
