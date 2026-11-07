// Isolated browser-test fixture: actual customer service and static build,
// temporary private intake data, no provider key, wallet signing or payments.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createCustomerServices,handleCustomerServicesHttp} from '../../scripts/customer-services.mjs';
import {sendStaticResponse} from '../../scripts/static-response.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.resolve(process.env.FTI_CUSTOMER_TEST_DIST||path.join(root,'dist'));
const port=Number(process.env.FTI_CUSTOMER_TEST_PORT||4174),origin='http://127.0.0.1:'+port;
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'fti-browser-customer-'));
const service=createCustomerServices({origin,dataDir,env:{}});
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/customer-services/'))return await handleCustomerServicesHttp({service,req,res,origin});
  if(url.pathname==='/api/config'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({chainId:97,mode:'bnb-testnet'}));return;}
  if(url.pathname.startsWith('/api/')||url.pathname==='/rpc'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'NO_FINANCIAL_API_IN_CUSTOMER_TEST'}));return;}
  const pathname=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname,file=path.resolve(base,'.'+pathname);
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
  if(!file.startsWith(base+path.sep)||!sendStaticResponse(req,res,file,url.pathname)){res.writeHead(404);res.end('Not found');}
 }catch{res.writeHead(503);res.end('Customer fixture unavailable');}
});
server.listen(port,'127.0.0.1');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;server.close();server.closeAllConnections();await service.close();await fs.rm(dataDir,{recursive:true,force:true});process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
