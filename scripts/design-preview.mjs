// Read-only design preview using captured public TESTNET state; no network writes.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2),value=(name,fallback)=>args[args.indexOf(name)+1]||fallback;
const port=Number(value('--port','4173')),host=value('--host','0.0.0.0');
const root=process.cwd(),types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://terminal.local');
 if(url.pathname.startsWith('/abi/')){const name=url.pathname.slice(5);if(!/^[A-Za-z0-9]+$/.test(name))throw Error('Invalid ABI');res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(JSON.parse(fs.readFileSync('artifacts/'+name+'.json')).abi));}
 if(url.pathname.startsWith('/api/')||url.pathname==='/rpc'){
  const cfg=JSON.parse(fs.readFileSync('preview/config.json')),state=JSON.parse(fs.readFileSync('preview/state.json'));
  const respond=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/config')return respond(cfg);
  if(url.pathname==='/api/state')return respond(state);
  if(url.pathname==='/api/events')return respond({events:[]});
  if(url.pathname==='/rpc'){
   let body='';for await(const part of req)body+=part;
   const calls=JSON.parse(fs.readFileSync('preview/calls.json'));
   const answer=q=>{let result;if(q.method==='eth_chainId')result='0x61';else if(q.method==='eth_blockNumber')result='0x'+Number(state.block).toString(16);else if(q.method==='eth_call')result=calls[q.params[0].data.slice(0,10)];else if(q.method==='eth_getBlockByNumber')result={number:'0x'+Number(state.block).toString(16),timestamp:'0x'+Number(state.timestamp).toString(16),hash:'0x'+'0'.repeat(64),parentHash:'0x'+'0'.repeat(64),nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x1c9c380',gasUsed:'0x0',miner:'0x'+'0'.repeat(40),extraData:'0x',transactions:[]};return result===undefined?{jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'Read-only captured preview'}}:{jsonrpc:'2.0',id:q.id,result};};
   const q=JSON.parse(body);return respond(Array.isArray(q)?q.map(answer):answer(q));
  }
  return respond({error:'Not available in read-only captured preview'});
 }
 let file;if(url.pathname==='/preview-mobile')file='preview/mobile.html';else if(['/app/','/token/','/admin/'].includes(url.pathname))file='web/index.html';else if(url.pathname==='/protocol-ring.webp')file='landing/dist/protocol-ring.webp';else if(['/','/token-site/','/whitepaper/','/roadmap/'].includes(url.pathname))file='landing/dist/index.html';else if(url.pathname==='/app.js'||url.pathname==='/app.css')file='landing/dist'+url.pathname;else if(url.pathname==='/vendor/ethers.js'&&!fs.existsSync('web/vendor/ethers.js'))file='node_modules/ethers/dist/ethers.min.js';else if(url.pathname.startsWith('/vendor/'))file='web'+url.pathname;else file='web/'+url.pathname.replace(/^\/(app|token|admin)\//,'');
 const full=path.resolve(root,file);if(!full.startsWith(root+path.sep)||!fs.existsSync(full)){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream'});const data=fs.readFileSync(full);res.end(path.extname(full)==='.html'?data.toString().replace('<body>','<body><p class=preview-note>پیش‌نمایش طراحی — داده ثبت‌شده تست‌نت؛ تراکنش غیرفعال</p>'):data);
}catch(e){res.writeHead(502);res.end('Preview unavailable: '+e.message);}}).listen(port,host,()=>console.log('Read-only FTI design preview on '+port));
