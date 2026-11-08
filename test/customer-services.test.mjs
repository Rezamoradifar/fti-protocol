import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Wallet} from 'ethers';
import {createCustomerServices,handleCustomerServicesHttp,customerClientId} from '../scripts/customer-services.mjs';
import {createSupportService} from '../scripts/support-tickets.mjs';
import {createCustomerAi} from '../scripts/customer-ai.mjs';
import {createVpnHandoff,fetchVpnHealth,isPublicVpnAddress,validateVpnManifest} from '../scripts/customer-vpn.mjs';

const SITE='https://ftiprotocol.com',guardian=Wallet.createRandom(),visitor=Wallet.createRandom();
const cfg={chainId:56,binary:'0x'+'a1'.repeat(20)};
const lead=(extra={})=>({requestId:'a'.repeat(32),receiptToken:'b'.repeat(64),consent:true,interest:'support',name:'Test visitor',channel:'email',contact:'test@example.org',message:'I need help with a membership request.',language:'en',source:'/support/',campaign:'guide',...extra});

async function fixture(t,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fti-customer-test-'));let clock=1_800_000_000_000,isGuardian=true,roleError=false;
 const support=createSupportService({cfg,origin:SITE,dataDir:path.join(dir,'support'),now:()=>clock,council:{isGuardian:async address=>{if(roleError)throw Error('Private RPC failure');return isGuardian&&address===guardian.address;}}});
 const prepare=options.prepareDataDir,settings={origin:SITE,dataDir:path.join(dir,'leads'),authorizeTeam:support.authorizeTeam,now:()=>clock,...options};delete settings.prepareDataDir;if(prepare)await prepare({dir,dataDir:settings.dataDir});let service=createCustomerServices(settings);
 const api=(method,route,body={},token,origin=SITE,clientId='visitor-1')=>service.handle({method,path:'/api/customer-services'+route,body,origin,authorization:token?'Bearer '+token:undefined,clientId});
 const login=async(wallet=guardian,origin=SITE)=>{const c=await support.handle({method:'POST',path:'/api/support/challenge',body:{wallet:wallet.address},origin});assert.equal(c.status,200);const r=await support.handle({method:'POST',path:'/api/support/session',body:{wallet:wallet.address,nonce:c.data.nonce,signature:await wallet.signMessage(c.data.message)},origin});assert.equal(r.status,200);return r.data.token;};
 t.after(async()=>{await service.close();await fs.rm(dir,{recursive:true,force:true});});
 return {dir,settings,api,login,get service(){return service;},advance:ms=>{clock+=ms;},revoke:()=>{isGuardian=false;},roleError:value=>{roleError=value;},restart:async()=>{await service.close();service=createCustomerServices(settings);}};
}

test('HTTP intake requires explicit consent, is durable/idempotent, and cannot be listed anonymously',async t=>{
 const f=await fixture(t);
 const server=http.createServer((req,res)=>handleCustomerServicesHttp({service:f.service,req,res,origin:SITE}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/api/customer-services';
 const send=(route,payload,headers={})=>fetch(url+route,{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
 assert.equal((await send('/leads',lead({consent:false}))).status,400);
 assert.equal((await send('/leads',lead(),{Origin:'https://attacker.example'})).status,403);
 const first=await send('/leads',lead());assert.equal(first.status,201);const receipt=await first.json();assert.match(receipt.reference,/^[a-f0-9]{32}$/);assert(!JSON.stringify(receipt).includes('test@example.org'));
 const again=await send('/leads',lead());assert.equal(again.status,200);assert.equal((await again.json()).reference,receipt.reference);
 assert.equal((await send('/leads',lead({contact:'someone-else@example.org'}))).status,409);
 assert.equal((await fetch(url+'/leads',{headers:{Origin:SITE}})).status,401);
 const storedFile=path.join(f.settings.dataDir,receipt.reference+'.json');const stored=JSON.parse(await fs.readFile(storedFile,'utf8'));
 assert.equal(stored.contact,'test@example.org');assert.equal(stored.contactVerified,false);assert.equal(stored.receiptToken,undefined);assert.equal(stored.consentVersion,'contact-request-v1');
 assert.equal((await fs.stat(storedFile)).mode&0o077,0);assert.equal((await fs.stat(f.settings.dataDir)).mode&0o077,0);
 await f.restart();const recovered=await f.api('POST','/leads',lead());assert.equal(recovered.status,200);assert.equal(recovered.data.reference,receipt.reference);
});

test('concurrent duplicate submissions produce one receipt and one stored lead',async t=>{
 const f=await fixture(t),responses=await Promise.all(Array.from({length:4},()=>f.api('POST','/leads',lead())));
 assert.equal(responses.filter(item=>item.status===201).length,1);assert(responses.every(item=>[200,201].includes(item.status)));assert.equal(new Set(responses.map(item=>item.data.reference)).size,1);
 const files=await fs.readdir(f.settings.dataDir);assert.equal(files.filter(name=>name.endsWith('.json')).length,1);
});

test('guardian inbox rechecks authority, keeps bearer proofs private, and cannot cross support origins',async t=>{
 const f=await fixture(t),token=await f.login(),memberToken=await f.login(visitor),created=await f.api('POST','/leads',lead({language:'zh-CN'}));
 assert.equal((await f.api('GET','/leads',{},memberToken)).status,403);
 const listing=await f.api('GET','/leads',{},token);assert.equal(listing.status,200);assert.equal(listing.data.leads[0].language,'zh-CN');assert.equal(listing.data.leads[0].receiptHash,undefined);assert.equal(listing.data.leads[0].requestId,undefined);
 assert.equal((await f.api('GET','/leads',{},token,'https://app.ftiprotocol.com')).status,403);
 const changed=await f.api('POST','/leads/'+created.data.reference+'/status',{status:'reviewing'},token);assert.equal(changed.status,200);
 f.roleError(true);assert.equal((await f.api('GET','/leads',{},token)).status,503);f.roleError(false);
 f.revoke();assert.equal((await f.api('POST','/leads/'+created.data.reference+'/status',{status:'replied'},token)).status,403);assert.equal((await f.api('GET','/leads',{},token)).status,403);
});

test('withdrawal proves receipt ownership and removes personal content; retention purges expired requests',async t=>{
 const f=await fixture(t),token=await f.login(),created=await f.api('POST','/leads',lead()),id=created.data.reference;
 assert.equal((await f.api('POST','/leads/'+id+'/withdraw',{receiptToken:'c'.repeat(64)})).status,404);
 assert.equal((await f.api('POST','/leads/'+id+'/withdraw',{receiptToken:'b'.repeat(64)})).status,200);
 const record=(await f.api('GET','/leads',{},token)).data.leads[0];assert.equal(record.status,'withdrawn');assert.equal(record.contact,'');assert.equal(record.name,'');assert.equal(record.message,'');
 assert.equal((await f.api('POST','/leads/'+id+'/status',{status:'reviewing'},token)).status,409);
 f.advance(31*86_400_000);const freshToken=await f.login();const empty=await f.api('GET','/leads',{},freshToken);assert.equal(empty.status,200);assert.equal(empty.data.leads.length,0);assert(!(await fs.readdir(f.settings.dataDir)).some(name=>name.endsWith('.json')));
});

test('startup sweep removes expired requests without waiting for a visitor request',async t=>{
 const f=await fixture(t),created=await f.api('POST','/leads',lead()),file=path.join(f.settings.dataDir,created.data.reference+'.json');
 assert.equal(await fs.access(file).then(()=>true,()=>false),true);
 f.advance(31*86_400_000);await f.restart();await f.service.ready();
 assert.equal(await fs.access(file).then(()=>true,()=>false),false);
});

test('secret-like inputs are rejected before provider calls or lead persistence; user markup stays plain text',async t=>{
 let calls=0;const f=await fixture(t,{env:{FTI_ASSISTANT_PROVIDER:'openai',FTI_ASSISTANT_MODEL:'test-model',OPENAI_API_KEY:'test-only-key-not-a-secret'},fetcher:async()=>{calls++;throw Error('Should not be sent');}});
 const secret='Private key: 0x'+'11'.repeat(32);
 assert.equal((await f.api('POST','/chat',{message:secret,allowAi:true})).status,400);assert.equal(calls,0);
 assert.equal((await f.api('POST','/leads',lead({message:secret}))).status,400);const files=await fs.readdir(f.settings.dataDir).catch(error=>{if(error.code==='ENOENT')return [];throw error;});assert.equal(files.some(name=>name.endsWith('.json')),false);
 const made=await f.api('POST','/leads',lead({message:'<img src=x onerror=alert(1)> Please help with my request.'}));assert.equal(made.status,201);
 const team=await f.login();assert.match((await f.api('GET','/leads',{},team)).data.leads[0].message,/<img/);
});

test('AI is opt-in and limited to approved topic selection; malformed output and provider errors fall back safely',async t=>{
 const outbound=[];
 const f=await fixture(t,{env:{FTI_ASSISTANT_PROVIDER:'openai',FTI_ASSISTANT_MODEL:'test-model',OPENAI_API_KEY:'test-only-key-not-a-secret'},fetcher:async(url,options)=>{outbound.push({url,options});return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({topic:'membership',needsHuman:true})}]}]}),{status:200});}});
 const local=await f.api('POST','/chat',{message:'How do I join?'});assert.equal(local.data.mode,'guided');assert.equal(outbound.length,0);
 const ai=await f.api('POST','/chat',{message:'How do I join? Contact me at test@example.org.',allowAi:true});assert.equal(ai.data.mode,'ai-routed');assert.equal(outbound.length,1);assert(ai.data.actions.some(action=>action.id==='contact'));assert(ai.data.actions.every(action=>action.href.startsWith('/')||action.href==='#contact'));
 const payload=JSON.parse(outbound[0].options.body);assert.equal(payload.store,false);assert.equal(payload.tools,undefined);assert(!payload.input.includes('test@example.org'));assert.equal(payload.text.format.strict,true);assert.equal(outbound[0].url,'https://api.openai.com/v1/responses');
 const bad=createCustomerAi({env:{FTI_ASSISTANT_PROVIDER:'openai',FTI_ASSISTANT_MODEL:'test-model',OPENAI_API_KEY:'test-only-key-not-a-secret'},fetcher:async()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"topic":"membership","needsHuman":false,"paymentUrl":"https://attacker.example"}'}]}]}),{status:200})});
 assert.equal(await bad.route('join','en'),null);
});

test('AI opt-in redacts common contact identifiers without removing short prices',async()=>{
 let payload;
 const ai=createCustomerAi({env:{FTI_ASSISTANT_PROVIDER:'openai',FTI_ASSISTANT_MODEL:'test-model',OPENAI_API_KEY:'test-only-key-not-a-secret'},fetcher:async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({topic:'token',needsHuman:false})}]}]}));}});
 const question='Buy 10 FTI. Call +1 (415) 555-0123 or ۰۹۱۲-۳۴۵-۶۷۸۹, @mytelegram, mail user@example.com, https://example.com/path and wallet 0x'+'ab'.repeat(20);
 assert.deepEqual(await ai.route(question,'en'),{topic:'token',needsHuman:false});
 const sent=JSON.parse(payload.input).question;
 for(const identity of ['415','۰۹۱۲','@mytelegram','user@example.com','https://example.com','0x'+ 'ab'.repeat(20)])assert(!sent.includes(identity),identity);
 assert.match(sent,/Buy 10 FTI/);assert.match(sent,/\[phone number\]/);assert.match(sent,/\[username\]/);
});

test('an unsafe store or competing writer fails closed and never exposes filesystem details',async t=>{
 const f=await fixture(t,{prepareDataDir:async({dir,dataDir})=>{await fs.mkdir(dataDir,{mode:0o700});await fs.writeFile(path.join(dir,'private.txt'),'unrelated private data');await fs.symlink(path.join(dir,'private.txt'),path.join(dataDir,'d'.repeat(32)+'.json'));}});
 const result=await f.api('POST','/leads',lead());assert.equal(result.status,503);assert.deepEqual(result.data,{error:'CUSTOMER_UNAVAILABLE'});
 const other=await fixture(t);assert.equal((await other.api('POST','/leads',lead())).status,201);
 const competing=createCustomerServices(other.settings);t.after(()=>competing.close());const response=await competing.handle({method:'POST',path:'/api/customer-services/leads',body:lead({requestId:'c'.repeat(32)}),origin:SITE});assert.equal(response.status,503);assert.equal(response.data.error,'CUSTOMER_STORE_BUSY');
});

test('HTTP body limit rejects oversized input and client throttling trusts only an explicit loopback proxy',async t=>{
 const f=await fixture(t);const server=http.createServer((req,res)=>handleCustomerServicesHttp({service:f.service,req,res,origin:SITE}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/api/customer-services/chat';
 assert.equal((await fetch(url,{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json'},body:JSON.stringify({message:'a'.repeat(9000)})})).status,413);
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 const req={socket:{remoteAddress:'203.0.113.11'},headers:{'x-real-ip':'1.1.1.1','x-forwarded-for':'8.8.8.8'}};assert.equal(customerClientId(req,{trustLoopbackProxy:true}),'203.0.113.11');req.socket.remoteAddress='127.0.0.1';assert.equal(customerClientId(req),'unidentified-loopback-proxy');assert.equal(customerClientId(req,{trustLoopbackProxy:true}),'1.1.1.1');
 for(let i=0;i<20;i++)assert.equal((await f.api('POST','/chat',{message:'hello'},undefined,SITE,'limited-client')).status,200);
 assert.equal((await f.api('POST','/chat',{message:'hello'},undefined,SITE,'limited-client')).status,429);
});

const manifest=()=>({version:1,provider:'NodeShield',portalUrl:'https://vpn.example.org/shop/',healthUrl:'https://vpn.example.org/api/fti-health',releaseId:'checked-release-1',evidenceReference:'acceptance/order-test-1234',deliveryVerifiedAt:new Date(1_800_000_000_000-3600000).toISOString(),deliveryChecks:['paid-order-delivered','owner-authorized-retrieval','retry-after-provisioning-failure','reopen-order-recovery','expiry-enforcement']});
test('VPN checkout requires current delivery evidence and matching live health, never only a reachable URL',async()=>{
 const now=()=>1_800_000_000_000,allowedHosts=['vpn.example.org'];let healthy=false,checks=0,clock=now();
 const valid=validateVpnManifest(manifest(),allowedHosts,now());
 assert.throws(()=>validateVpnManifest({...manifest(),deliveryChecks:[]},allowedHosts,now()));assert.throws(()=>validateVpnManifest({...manifest(),healthUrl:'https://127.0.0.1/private'},['127.0.0.1'],now()));assert.throws(()=>validateVpnManifest({...manifest(),portalUrl:'https://unapproved.example/shop'},allowedHosts,now()));assert.throws(()=>validateVpnManifest({...manifest(),deliveryVerifiedAt:'2020-01-01T00:00:00Z'},allowedHosts,now()));
 const vpn=createVpnHandoff({manifestFile:'/configured/manifest.json',allowedHosts,now:()=>clock,readManifest:async()=>valid,readHealth:async()=>{checks++;return {service:'nodeshield',status:'ok',checkoutReady:true,deliveryReady:healthy,releaseId:'checked-release-1'};}});
 assert.equal(vpn.status().checkoutUrl,null);assert.equal((await vpn.check()).state,'unavailable');healthy=true;assert.equal((await vpn.check()).state,'unavailable');assert.equal(checks,1);
 clock+=31_000;const ready=await vpn.check();assert.equal(ready.state,'ready');assert.equal(ready.checkoutUrl,manifest().portalUrl);assert.equal(checks,2);
 const none=createVpnHandoff({now});assert.equal((await none.check()).state,'not-configured');
});

test('VPN health refuses private/mapped DNS answers before opening a connection',async()=>{
 for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fd00::1','2001:db8::1','64:ff9b::a00:1'])assert.equal(isPublicVpnAddress(address),false,address);
 assert.equal(isPublicVpnAddress('1.1.1.1'),true);assert.equal(isPublicVpnAddress('2606:4700:4700::1111'),true);
 let requests=0;await assert.rejects(fetchVpnHealth('https://vpn.example.org/api/fti-health',{lookup:async()=>[{address:'127.0.0.1',family:4}],request:()=>{requests++;throw Error('Should not connect');}}));assert.equal(requests,0);
 await assert.rejects(fetchVpnHealth('https://vpn.example.org/api/fti-health',{lookup:async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}],request:()=>{requests++;throw Error('Should not connect');}}));assert.equal(requests,0);
});
