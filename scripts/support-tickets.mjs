// Private support records. Authentication only proves control of a wallet;
// it never submits a transaction or grants protocol governance authority.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {getAddress,verifyMessage} from 'ethers';

const ID=/^[a-f0-9]{32}$/;
const HASH=/^0x[a-fA-F0-9]{64}$/;
const TOPICS=new Set(['Wallet connection','Membership and referral','Rewards and auto-buy','Token transaction','Other']);
const STATES=new Set(['open','answered','closed']);
const CHALLENGE_MS=5*60_000,SESSION_MS=30*60_000,MAX_FILE=256_000,MAX_BYTES=50_000_000;
const fault=(status,code)=>Object.assign(Error(code),{status,code});
const random=()=>crypto.randomBytes(16).toString('hex');
const wallet=value=>{try{const v=getAddress(value);if(BigInt(v)===0n)throw Error();return v;}catch{throw fault(400,'INVALID_WALLET');}};
function trustedOrigin(value){try{const u=new URL(value);if(u.origin!==value||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error();return u.origin;}catch{throw Error('Support requires an explicit HTTPS origin or local test origin');}}
function text(value,min=1,max=2000){if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw fault(400,'INVALID_MESSAGE');return value.trim();}
function validRecord(r,id){
 if(!r||r.version!==1||r.id!==id||!ID.test(id)||!TOPICS.has(r.topic)||!STATES.has(r.status)||wallet(r.wallet)!==r.wallet||!(r.hash===null||HASH.test(r.hash))||!Number.isSafeInteger(r.createdAt)||!Number.isSafeInteger(r.updatedAt)||r.createdAt<0||r.updatedAt<r.createdAt||!Array.isArray(r.messages)||!r.messages.length||r.messages.length>100)throw Error('Invalid support record');
 for(const m of r.messages)if(!m||!ID.test(m.id)||!['member','team'].includes(m.role)||wallet(m.wallet)!==m.wallet||!Number.isSafeInteger(m.createdAt)||m.createdAt<r.createdAt||m.createdAt>r.updatedAt||text(m.text)!==m.text)throw Error('Invalid support message');
 return r;
}
async function privateDirectory(dir){
 if(!path.isAbsolute(dir)||path.resolve(dir)!==dir)throw Error('Unsafe support directory');
 let current=path.parse(dir).root;
 for(const part of dir.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  const st=await fs.lstat(current).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(st&&(st.isSymbolicLink()||!st.isDirectory()))throw Error('Unsafe support directory');
 }
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const st=await fs.lstat(dir);
 if(st.isSymbolicLink()||!st.isDirectory()||(st.mode&0o077)!==0||st.uid!==process.getuid?.())throw Error('Support directory must be private and service-owned');
}

export function createSupportService({cfg,council,dataDir,origin,allowedOrigins,now=Date.now}){
 const site=trustedOrigin(origin),binary=wallet(cfg.binary),chainId=cfg.chainId;
 const origins=new Set((allowedOrigins||[site,...(site==='https://ftiprotocol.com'?['https://app.ftiprotocol.com','https://council.ftiprotocol.com','https://token.ftiprotocol.com']:[])]).map(trustedOrigin));origins.add(site);
 if(!Number.isSafeInteger(chainId)||chainId<1||!dataDir)throw Error('Invalid support configuration');
 const directory=path.resolve(dataDir),records=new Map(),sizes=new Map(),challenges=new Map(),sessions=new Map(),rates=new Map();
 let loading,totalBytes=0,tail=Promise.resolve();
 function time(){const n=now();if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid clock');return n;}
 function sweep(t){for(const [key,value]of challenges)if(value.expiresAt<=t)challenges.delete(key);for(const [key,value]of sessions)if(value.expiresAt<=t)sessions.delete(key);for(const [key,value]of rates)if(value.until<=t)rates.delete(key);}
 function rate(key,max,ms=60_000){const t=time();sweep(t);const entry=rates.get(key)||{count:0,until:t+ms};if(entry.count>=max)throw fault(429,'SUPPORT_RATE_LIMIT');entry.count++;rates.set(key,entry);}
 async function load(){if(!loading)loading=(async()=>{
  await privateDirectory(directory);
  const names=await fs.readdir(directory);if(names.length>2200)throw Error('Support store limit');
  for(const name of names){if(!/^[a-f0-9]{32}\.json$/.test(name))continue;
   const file=path.join(directory,name),h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{const st=await h.stat();if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0||st.uid!==process.getuid?.()||st.size>MAX_FILE)throw Error('Unsafe support file');const raw=await h.readFile('utf8');const r=validRecord(JSON.parse(raw),name.slice(0,-5));records.set(r.id,r);sizes.set(r.id,Buffer.byteLength(raw));totalBytes+=Buffer.byteLength(raw);if(totalBytes>MAX_BYTES||records.size>2000)throw Error('Support store limit');}finally{await h.close();}
  }
 })();return loading;}
 async function persist(record){
  validRecord(record,record.id);const raw=JSON.stringify(record)+'\n',bytes=Buffer.byteLength(raw);
  if(bytes>MAX_FILE||totalBytes-(sizes.get(record.id)||0)+bytes>MAX_BYTES)throw fault(429,'SUPPORT_STORAGE_LIMIT');
  const target=path.join(directory,record.id+'.json'),temporary=path.join(directory,'.'+random()+'.tmp');
  const prior=await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(prior&&(prior.isSymbolicLink()||!prior.isFile()||prior.nlink!==1||prior.uid!==process.getuid?.()))throw Error('Unsafe support target');
  let h;try{h=await fs.open(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);await h.writeFile(raw);await h.sync();await h.close();h=null;await fs.rename(temporary,target);const d=await fs.open(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{await d.sync();}finally{await d.close();}}
  finally{await h?.close();await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  totalBytes=totalBytes-(sizes.get(record.id)||0)+bytes;sizes.set(record.id,bytes);records.set(record.id,record);
 }
 function serial(fn){const next=tail.then(fn);tail=next.catch(()=>{});return next;}
 function authenticate(authorization){const match=typeof authorization==='string'&&/^Bearer ([a-f0-9]{64})$/.exec(authorization);const s=match&&sessions.get(match[1]);if(!s||s.expiresAt<=time())throw fault(401,'SUPPORT_AUTH_REQUIRED');return s;}
 async function guardian(address){try{if(await council.isGuardian(address)!==true)throw fault(403,'SUPPORT_GUARDIAN_REQUIRED');}catch(e){if(e.status===403)throw e;throw fault(503,'SUPPORT_ROLE_UNAVAILABLE');}}
 const summary=r=>({id:r.id,wallet:r.wallet,topic:r.topic,hash:r.hash,status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt,messageCount:r.messages.length,lastRole:r.messages.at(-1).role});
 function result(status,data){return {status,data};}
 async function handle({method,path:requestPath,body={},authorization,origin:requestOrigin}){
  try{
   const url=new URL(requestPath,site);if(url.origin!==site||!url.pathname.startsWith('/api/support/'))return result(404,{error:'SUPPORT_NOT_FOUND'});
   if(!['GET','POST'].includes(method))return result(405,{error:'SUPPORT_METHOD_NOT_ALLOWED'});
   if(!origins.has(requestOrigin))throw fault(403,'SUPPORT_ORIGIN_DENIED');
   if(method==='POST'&&(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>12_000))throw fault(400,'SUPPORT_INVALID_REQUEST');
   const t=time();sweep(t);
   if(method==='POST'&&url.pathname==='/api/support/challenge'){
    const address=wallet(body.wallet);rate('challenge-global',120);rate('challenge:'+address,5);
    if(challenges.size>=1000)throw fault(429,'SUPPORT_RATE_LIMIT');
    const nonce=random(),expiresAt=t+CHALLENGE_MS;
    const message=['FTI Protocol support access','',`Origin: ${requestOrigin}`,`Chain ID: ${chainId}`,`Binary contract: ${binary}`,`Wallet: ${address}`,`Nonce: ${nonce}`,`Issued at: ${new Date(t).toISOString()}`,`Expires at: ${new Date(expiresAt).toISOString()}`,'','Sign only to access private support tickets. This does not authorize a transaction or spending.'].join('\n');
    challenges.set(nonce,{wallet:address,message,expiresAt,origin:requestOrigin});return result(200,{nonce,message,expiresAt});
   }
   if(method==='POST'&&url.pathname==='/api/support/session'){
    const address=wallet(body.wallet);rate('session-global',120);rate('session:'+address,10);
    if(typeof body.nonce!=='string'||!ID.test(body.nonce)||typeof body.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(body.signature))throw fault(400,'SUPPORT_INVALID_SIGNATURE');
    const challenge=challenges.get(body.nonce);challenges.delete(body.nonce);
    if(!challenge||challenge.expiresAt<=t||challenge.wallet!==address||challenge.origin!==requestOrigin)throw fault(401,'SUPPORT_CHALLENGE_EXPIRED');
    let recovered;try{recovered=verifyMessage(challenge.message,body.signature);}catch{throw fault(401,'SUPPORT_SIGNATURE_REJECTED');}
    if(recovered!==address)throw fault(401,'SUPPORT_SIGNATURE_REJECTED');
    if(sessions.size>=1000)throw fault(429,'SUPPORT_RATE_LIMIT');
    const token=crypto.randomBytes(32).toString('hex'),expiresAt=t+SESSION_MS;sessions.set(token,{wallet:address,expiresAt,origin:requestOrigin});return result(200,{token,expiresAt,wallet:address});
   }
   const session=authenticate(authorization);if(session.origin!==requestOrigin)throw fault(403,'SUPPORT_ORIGIN_DENIED');rate('read:'+session.wallet,180);
   if(method==='POST')rate('write:'+session.wallet,20);
   await load();
   const admin=url.searchParams.get('scope')==='admin';
   if(admin)await guardian(session.wallet);
   if(url.pathname==='/api/support/tickets'){
    if(method==='GET'){
     const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||25);
     if(!Number.isSafeInteger(offset)||offset<0||offset>2000||!Number.isSafeInteger(limit)||limit<1||limit>50)throw fault(400,'SUPPORT_INVALID_PAGE');
     const rows=[...records.values()].filter(r=>admin||r.wallet===session.wallet).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
     return result(200,{tickets:rows.slice(offset,offset+limit).map(summary),total:rows.length,offset,nextOffset:offset+limit<rows.length?offset+limit:null});
    }
    return await serial(async()=>{
     if(!TOPICS.has(body.topic))throw fault(400,'SUPPORT_INVALID_TOPIC');
     const message=text(body.message,15),hash=body.hash==null||body.hash===''?null:body.hash;if(hash!==null&&!HASH.test(hash))throw fault(400,'SUPPORT_INVALID_HASH');
     if(records.size>=2000||[...records.values()].filter(r=>r.wallet===session.wallet).length>=100)throw fault(429,'SUPPORT_TICKET_LIMIT');
     const id=random(),record={version:1,id,wallet:session.wallet,topic:body.topic,hash,status:'open',createdAt:t,updatedAt:t,messages:[{id:random(),wallet:session.wallet,role:'member',text:message,createdAt:t}]};
     await persist(record);return result(201,{ticket:record});
    });
   }
   const match=/^\/api\/support\/tickets\/([a-f0-9]{32})(?:\/(replies|status))?$/.exec(url.pathname);
   if(!match)throw fault(404,'SUPPORT_NOT_FOUND');
   return await serial(async()=>{
    const record=records.get(match[1]);if(!record)throw fault(404,'SUPPORT_NOT_FOUND');
    if(record.wallet!==session.wallet&&!admin)throw fault(404,'SUPPORT_NOT_FOUND');
    if(method==='GET'&&!match[2])return result(200,{ticket:structuredClone(record)});
    if(method!=='POST'||!match[2])throw fault(405,'SUPPORT_METHOD_NOT_ALLOWED');
    if(match[2]==='status'){
     await guardian(session.wallet);if(!STATES.has(body.status))throw fault(400,'SUPPORT_INVALID_STATUS');
     const next={...record,status:body.status,updatedAt:Math.max(t,record.updatedAt)};await persist(next);return result(200,{ticket:next});
    }
    if(record.status==='closed')throw fault(409,'SUPPORT_TICKET_CLOSED');
    if(record.messages.length>=100)throw fault(429,'SUPPORT_THREAD_LIMIT');
    const role=admin?'team':'member',message=text(body.message),next={...record,status:admin?'answered':'open',updatedAt:Math.max(t,record.updatedAt),messages:[...record.messages,{id:random(),wallet:session.wallet,role,text:message,createdAt:Math.max(t,record.updatedAt)}]};
    await persist(next);return result(200,{ticket:next});
   });
  }catch(e){return result(e.status||503,{error:typeof e.code==='string'&&/^(SUPPORT_|INVALID_)/.test(e.code)?e.code:'SUPPORT_UNAVAILABLE'});}
 }
 return {handle};
}
