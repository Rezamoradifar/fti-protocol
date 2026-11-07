import fs from 'node:fs';
import path from 'node:path';

const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'};
function regular(file){try{const value=fs.lstatSync(file);return value.isFile()&&!value.isSymbolicLink()?value:null;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export function staticEncoding(header,available){
 const values=new Map();
 for(const item of String(header||'').toLowerCase().split(',')){
  const [name,...parameters]=item.trim().split(';').map(value=>value.trim());if(!name)continue;
  const qParameter=parameters.find(value=>value.startsWith('q='));
  const q=qParameter===undefined?1:/^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(qParameter)?Number(qParameter.slice(2)):0;
  values.set(name,q);
 }
 const quality=name=>values.has(name)?values.get(name):name==='identity'?(values.get('*')===0?0:1):values.get('*')||0;
 const candidates=[...available,'identity'].map(name=>({name,q:quality(name)})).filter(item=>item.q>0).sort((a,b)=>b.q-a.q||(['br','gzip','identity'].indexOf(a.name)-['br','gzip','identity'].indexOf(b.name)));
 return candidates[0]?.name||null;
}
export function staticCacheControl(requestPath,extension){
 if(extension==='.html')return 'no-cache';
 const versioned=/^\/fti-site-refresh-[a-f0-9]{12,64}\//.test(requestPath);
 const hashed=/^\/assets\/(?:[^/]+\/)*[^/]+-[a-zA-Z0-9]{8,}\.(?:js|css|woff2?|webp|png|jpe?g|svg)$/.test(requestPath);
 return versioned||hashed?'public, max-age=31536000, immutable':'no-cache';
}
export function sendStaticResponse(req,res,file,requestPath){
 const original=regular(file);if(!original)return false;
 const extension=path.extname(file),compressible=['.js','.css','.html','.json','.svg'].includes(extension);
 const variants=new Map();
 if(compressible)for(const [encoding,suffix]of [['br','.br'],['gzip','.gz']]){const stat=regular(file+suffix);if(stat)variants.set(encoding,{file:file+suffix,stat});}
 const encoding=staticEncoding(req.headers['accept-encoding'],[...variants.keys()]);
 const previous=res.getHeader('Vary');const vary=new Set(String(previous||'').split(',').map(value=>value.trim()).filter(Boolean));vary.add('Accept-Encoding');res.setHeader('Vary',[...vary].join(', '));
 if(encoding===null){res.writeHead(406,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('No acceptable content encoding');return true;}
 const selected=encoding==='identity'?{file,stat:original}:variants.get(encoding);
 res.setHeader('Content-Type',TYPES[extension]||'application/octet-stream');
 res.setHeader('Content-Length',selected.stat.size);
 res.setHeader('Cache-Control',staticCacheControl(requestPath,extension));
 if(encoding!=='identity')res.setHeader('Content-Encoding',encoding);
 res.writeHead(200);
 const stream=fs.createReadStream(selected.file);stream.once('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);return true;
}
