import crypto from 'node:crypto';
import {isIP} from 'node:net';
import {createCustomerLeadStore,customerFault,customerText,containsSecret,LEAD_RETENTION_DAYS} from './customer-leads.mjs';
import {KNOWLEDGE_VERSION,knowledgeAnswer,publicActions} from './customer-knowledge.mjs';
import {createCustomerAi} from './customer-ai.mjs';
import {createVpnHandoff} from './customer-vpn.mjs';

export const CUSTOMER_API='/api/customer-services';
function checkedOrigin(value){
 const url=new URL(value);
 if(url.origin!==value||url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Customer services require an HTTPS site origin or localhost');
 return url.origin;
}
export function createCustomerServices({origin,dataDir,authorizeTeam,allowedOrigins,env={},now=Date.now,fetcher=fetch,vpnOptions={}}){
 const site=checkedOrigin(origin),origins=new Set((allowedOrigins||[site,...(site==='https://ftiprotocol.com'?['https://app.ftiprotocol.com','https://token.ftiprotocol.com','https://council.ftiprotocol.com']:[])]).map(checkedOrigin));
 origins.add(site);
 const store=createCustomerLeadStore({dataDir,now}),startup=store.startup,ai=createCustomerAi({env,now,fetcher});
 const vpn=createVpnHandoff({manifestFile:env.FTI_VPN_MANIFEST_FILE||'',allowedHosts:String(env.FTI_VPN_ALLOWED_HOSTS||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean),now,...vpnOptions});
 const rates=new Map(),salt=crypto.randomBytes(32);let intakeAvailable=null;
 const result=(status,data)=>({status,data});
 function rate(key,max,window=60_000){
  const t=now();for(const [id,item]of rates)if(item.until<=t)rates.delete(id);
  if(!rates.has(key)&&rates.size>=5000)throw customerFault(429,'CUSTOMER_RATE_LIMIT');
  const item=rates.get(key)||{count:0,until:t+window};if(item.count>=max)throw customerFault(429,'CUSTOMER_RATE_LIMIT');item.count++;rates.set(key,item);
 }
 async function handle({method,path,body={},authorization,origin:requestOrigin,clientId='unknown'}){
  try{
   const url=new URL(path,site);if(url.origin!==site||!url.pathname.startsWith(CUSTOMER_API+'/'))return result(404,{error:'CUSTOMER_NOT_FOUND'});
   if(!origins.has(requestOrigin))throw customerFault(403,'CUSTOMER_ORIGIN_DENIED');
   if(!['GET','POST'].includes(method))return result(405,{error:'CUSTOMER_METHOD_NOT_ALLOWED'});
   if(method==='POST'&&(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>8000))throw customerFault(400,'CUSTOMER_INVALID_REQUEST');
   const sharedTransport=clientId==='unidentified-loopback-proxy';
   const peer=crypto.createHmac('sha256',salt).update(String(clientId).slice(0,128)).digest('hex');
   rate('all',600);rate('peer:'+peer,sharedTransport?600:100);
   if(method==='GET'&&url.pathname===CUSTOMER_API+'/config'){
    if(intakeAvailable===null){try{await startup;intakeAvailable=true;}catch{intakeAvailable=false;}}
    return result(200,{version:1,assistant:{automated:true,name:'FTI Assistant',knowledgeVersion:KNOWLEDGE_VERSION,...ai.status()},intake:{available:intakeAvailable,retentionDays:LEAD_RETENTION_DAYS,contactVerified:false},vpn:vpn.status()});
   }
   if(method==='GET'&&url.pathname===CUSTOMER_API+'/vpn'){
    rate('vpn:'+peer,20);return result(200,{vpn:await vpn.check()});
   }
   if(method==='POST'&&url.pathname===CUSTOMER_API+'/chat'){
    rate('chat:'+peer,sharedTransport?200:20);rate('chat-all',200);
    const message=customerText(body.message,{min:1,max:1200});
    if(containsSecret(message))throw customerFault(400,'CUSTOMER_SECRET_REJECTED');
    const requestedLanguage=body.language==='zh'?'zh-CN':body.language;
   const language=['en','ar','tr','zh-CN','ru','es','fa'].includes(requestedLanguage)?requestedLanguage:'en';
    const selected=typeof body.topic==='string'?body.topic:undefined;
    let routed=null;
    if(body.allowAi===true&&!selected){rate('ai:'+peer,5);routed=await ai.route(message,language);}
    const answer=knowledgeAnswer(message,language,routed?.topic==='general'?undefined:routed?.topic||selected);
    if(routed?.needsHuman)answer.actions=[...answer.actions,'contact'];
    return result(200,{...answer,actions:publicActions(answer.actions,language),sources:publicActions(answer.sources,language),automated:true,mode:routed?'ai-routed':'guided',knowledgeVersion:KNOWLEDGE_VERSION});
   }
   if(method==='POST'&&url.pathname===CUSTOMER_API+'/leads'){
    rate('lead:'+peer,sharedTransport?60:6,60*60_000);rate('leads-all',60,60*60_000);
    if(body.website)throw customerFault(400,'CUSTOMER_INVALID_REQUEST');
    const lead=await store.create(body);intakeAvailable=true;
    return result(lead.created?201:200,{...lead,retentionDays:LEAD_RETENTION_DAYS});
   }
   const withdraw=/^\/api\/customer-services\/leads\/([a-f0-9]{32})\/withdraw$/.exec(url.pathname);
   if(method==='POST'&&withdraw){rate('withdraw:'+peer,10);return result(200,await store.withdraw(withdraw[1],body.receiptToken));}
   if(url.pathname===CUSTOMER_API+'/leads'||/^\/api\/customer-services\/leads\/[a-f0-9]{32}\/status$/.test(url.pathname)){
    if(typeof authorizeTeam!=='function')throw customerFault(503,'CUSTOMER_TEAM_UNAVAILABLE');
    const team=await authorizeTeam({authorization,origin:requestOrigin});
    if(!team?.wallet)throw customerFault(403,'CUSTOMER_TEAM_REQUIRED');
    if(method==='GET'&&url.pathname===CUSTOMER_API+'/leads')return result(200,await store.list({offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||25),status:url.searchParams.get('status')||undefined}));
    if(method==='POST'){
     const match=/^\/api\/customer-services\/leads\/([a-f0-9]{32})\/status$/.exec(url.pathname);
     if(match)return result(200,await store.change(match[1],body.status,team.wallet));
    }
    throw customerFault(405,'CUSTOMER_METHOD_NOT_ALLOWED');
   }
   return result(404,{error:'CUSTOMER_NOT_FOUND'});
  }catch(error){
   const code=typeof error.code==='string'&&/^(CUSTOMER_|SUPPORT_)[A-Z_]+$/.test(error.code)?error.code:'CUSTOMER_UNAVAILABLE';
   return result(error.status||503,{error:code});
  }
 }
 return {handle,ready:()=>startup,close:()=>store.close()};
}

export function customerClientId(req,{trustLoopbackProxy=false}={}){
 const address=req.socket?.remoteAddress||'unknown';
 const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
 // Trust only an explicitly configured loopback reverse proxy that overwrites
 // X-Real-IP. Never trust client-supplied X-Forwarded-For chains.
 if(trustLoopbackProxy&&loopback&&typeof req.headers['x-real-ip']==='string'&&isIP(req.headers['x-real-ip']))return req.headers['x-real-ip'];
 return loopback?'unidentified-loopback-proxy':address;
}
export async function handleCustomerServicesHttp({service,req,res,origin,trustLoopbackProxy=false}){
 const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
  if(!service)return respond(503,{error:'CUSTOMER_UNAVAILABLE'});
  const scheme=new URL(origin).protocol;
  const requestOrigin=req.headers.origin||scheme+'//'+req.headers.host;
  if(req.method==='POST'&&(!req.headers.origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')))return respond(403,{error:'CUSTOMER_ORIGIN_DENIED'});
  let body;
  if(req.method==='POST'){
   if(Number(req.headers['content-length']||0)>8000)return respond(413,{error:'CUSTOMER_REQUEST_TOO_LARGE'});
   let size=0;const chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size>8000)return respond(413,{error:'CUSTOMER_REQUEST_TOO_LARGE'});chunks.push(chunk);}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return respond(400,{error:'CUSTOMER_INVALID_REQUEST'});}
  }
  const answer=await service.handle({method:req.method,path:req.url,body,authorization:req.headers.authorization,origin:requestOrigin,clientId:customerClientId(req,{trustLoopbackProxy})});
  if(answer.status===429)res.setHeader('Retry-After','60');
  return respond(answer.status,answer.data);
 }catch{return respond(503,{error:'CUSTOMER_UNAVAILABLE'});}
}
