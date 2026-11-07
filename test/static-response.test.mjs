import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {gzipSync,brotliCompressSync,gunzipSync,brotliDecompressSync} from 'node:zlib';
import {sendStaticResponse,staticEncoding,staticCacheControl} from '../scripts/static-response.mjs';

test('static responses negotiate precompressed bytes with correct MIME, cache and q=0 handling',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fti-static-'));const original=Buffer.from('console.log("FTI compressed static asset");\n'.repeat(30));const file=path.join(dir,'main-ABCDEF12.js');
 await fs.writeFile(file,original);await fs.writeFile(file+'.gz',gzipSync(original));await fs.writeFile(file+'.br',brotliCompressSync(original));
 const server=http.createServer((req,res)=>{sendStaticResponse(req,res,file,'/assets/main-ABCDEF12.js');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
 const read=accept=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:server.address().port,path:'/assets/main-ABCDEF12.js',headers:{'Accept-Encoding':accept}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject);});
 const br=await read('gzip, br');assert.equal(br.headers['content-encoding'],'br');assert.deepEqual(brotliDecompressSync(br.body),original);assert.match(br.headers['content-type'],/^text\/javascript/);assert.equal(Number(br.headers['content-length']),br.body.length);assert.match(br.headers['cache-control'],/immutable/);assert.equal(br.headers.vary,'Accept-Encoding');
 const gzip=await read('br;q=0, gzip');assert.equal(gzip.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(gzip.body),original);
 const raw=await read('br;q=0, gzip;q=0');assert.equal(raw.headers['content-encoding'],undefined);assert.deepEqual(raw.body,original);
 assert.equal((await read('br;q=0, gzip;q=0, identity;q=0')).status,406);
});
test('unversioned content and HTML revalidate; hashes or release path are required for immutable caching',()=>{
 assert.equal(staticCacheControl('/app/','.html'),'no-cache');assert.equal(staticCacheControl('/assets/main.js','.js'),'no-cache');assert.match(staticCacheControl('/assets/main-ABCDEF12.js','.js'),/immutable/);assert.match(staticCacheControl('/fti-site-refresh-abcdef123456/app.js','.js'),/immutable/);assert.equal(staticCacheControl('/fti-site-refresh-abcdef123456/index.html','.html'),'no-cache');
 assert.equal(staticEncoding('br;q=0,gzip;q=0,*;q=0',[]),null);assert.equal(staticEncoding('gzip;q=broken',['gzip']),'identity');assert.equal(staticEncoding('gzip;q=0.8,identity;q=0.2',['gzip']),'gzip');
});
