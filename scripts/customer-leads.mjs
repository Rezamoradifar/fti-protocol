import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ID=/^[a-f0-9]{32}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const INTERESTS=new Set(['membership','token','vpn','partnership','support']);
const STATES=new Set(['new','reviewing','replied','closed','withdrawn']);
export const LEAD_RETENTION_DAYS=30;
const RETENTION=LEAD_RETENTION_DAYS*86_400_000;
const MAX_RECORDS=2000,MAX_FILE=24_000,MAX_BYTES=30_000_000;
export const customerFault=(status,code)=>Object.assign(Error(code),{status,code});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function customerText(value,{min=0,max=1500,code='CUSTOMER_INVALID_MESSAGE'}={}){
 if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw customerFault(400,code);
 return value.trim();
}
export function containsSecret(value){
 return /(?:0x)?\b[0-9a-fA-F]{64}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:private\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|عبارت\s*بازیابی|کلید\s*خصوصی)\s*[:=]\s*\S+|(?:vmess|vless|trojan|ss|wireguard):\/\//i.test(value);
}
function normalize(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||body.consent!==true)throw customerFault(400,'CUSTOMER_CONSENT_REQUIRED');
 if(!ID.test(body.requestId||'')||!DIGEST.test(body.receiptToken||'')||!INTERESTS.has(body.interest))throw customerFault(400,'CUSTOMER_INVALID_REQUEST');
 const name=customerText(body.name||'',{max:80});
 const message=customerText(body.message||'',{max:1500});
 if(containsSecret(message)||containsSecret(name))throw customerFault(400,'CUSTOMER_SECRET_REJECTED');
 const channel=body.channel;
 let contact=customerText(body.contact,{min:3,max:254,code:'CUSTOMER_INVALID_CONTACT'});
 if(channel==='email'){
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact)||/[\r\n]/.test(contact))throw customerFault(400,'CUSTOMER_INVALID_CONTACT');
  contact=contact.toLowerCase();
 }else if(channel==='telegram'){
  contact=contact.replace(/^@/,'');
  if(!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(contact))throw customerFault(400,'CUSTOMER_INVALID_CONTACT');
 }else throw customerFault(400,'CUSTOMER_INVALID_CONTACT');
 const requestedLanguage=body.language==='zh'?'zh-CN':body.language;
   const language=['en','ar','tr','zh-CN','ru','es','fa'].includes(requestedLanguage)?requestedLanguage:'en';
 const source=body.source===undefined?'/':customerText(body.source,{max:160});
 if(!/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(source))throw customerFault(400,'CUSTOMER_INVALID_SOURCE');
 const campaign=customerText(body.campaign||'',{max:80});
 if(!/^[a-zA-Z0-9 ._-]*$/.test(campaign))throw customerFault(400,'CUSTOMER_INVALID_SOURCE');
 return {name,message,channel,contact,interest:body.interest,language,source,campaign,requestId:body.requestId,receiptHash:digest(body.receiptToken),consentVersion:'contact-request-v1'};
}
function validate(record,id){
 if(!record||record.version!==1||record.id!==id||!ID.test(id)||!ID.test(record.requestId)||!DIGEST.test(record.fingerprint)||!DIGEST.test(record.receiptHash)||!INTERESTS.has(record.interest)||!STATES.has(record.status)||!Number.isSafeInteger(record.createdAt)||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<record.createdAt||record.expiresAt!==record.createdAt+RETENTION||record.consentVersion!=='contact-request-v1'||!Array.isArray(record.history)||record.history.length>30)throw Error('Unsafe customer record');
 for(const item of record.history)if(!item||!STATES.has(item.status)||!Number.isSafeInteger(item.at)||typeof item.actor!=='string'||item.actor.length>80)throw Error('Unsafe customer history');
 if(record.status!=='withdrawn'){
  if(!['email','telegram'].includes(record.channel)||typeof record.contact!=='string'||record.contact.length>254||typeof record.name!=='string'||record.name.length>80||typeof record.message!=='string'||record.message.length>1500)throw Error('Unsafe customer record');
 }else if(record.contact!==''||record.name!==''||record.message!=='')throw Error('Withdrawn request still has personal data');
 return record;
}
async function privateDirectory(directory){
 if(!path.isAbsolute(directory)||path.resolve(directory)!==directory)throw Error('Unsafe customer directory');
 let current=path.parse(directory).root;
 for(const item of directory.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,item);
  const st=await fs.lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(st&&(st.isSymbolicLink()||!st.isDirectory()))throw Error('Unsafe customer directory');
 }
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const st=await fs.lstat(directory);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw Error('Customer directory must be private and service-owned');
}
async function readPrivate(file,max=MAX_FILE){
 const h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const st=await h.stat();if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>max)throw Error('Unsafe customer file');return await h.readFile('utf8');}finally{await h.close();}
}

// One writer owns this directory. The exclusive lock prevents two web workers
// from silently overwriting lead updates; a dead process's lock is recovered.
export function createCustomerLeadStore({dataDir,now=Date.now}){
 const directory=path.resolve(dataDir),records=new Map(),requests=new Map(),sizes=new Map();
 const lockFile=path.join(directory,'.writer-lock'),lockToken=crypto.randomBytes(16).toString('hex');
 let loading,locked=false,closed=false,totalBytes=0,tail=Promise.resolve();
 const time=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid customer clock');return value;};
 function serial(fn){const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;}
 async function acquire(){
  try{const h=await fs.open(lockFile,'wx',0o600);try{await h.writeFile(JSON.stringify({pid:process.pid,token:lockToken}));await h.sync();}finally{await h.close();}locked=true;return;}
  catch(error){if(error.code!=='EEXIST')throw error;}
  const lock=JSON.parse(await readPrivate(lockFile,200));
  if(!Number.isSafeInteger(lock.pid)||lock.pid<1||!ID.test(lock.token))throw Error('Unsafe customer lock');
  try{process.kill(lock.pid,0);throw customerFault(503,'CUSTOMER_STORE_BUSY');}catch(error){if(error.code!=='ESRCH')throw error;}
  await fs.unlink(lockFile);
  const h=await fs.open(lockFile,'wx',0o600);try{await h.writeFile(JSON.stringify({pid:process.pid,token:lockToken}));await h.sync();}finally{await h.close();}locked=true;
 }
 async function load(){
  if(closed)throw Error('Customer store closed');
  if(!loading)loading=(async()=>{
   await privateDirectory(directory);await acquire();
   const names=await fs.readdir(directory);if(names.length>MAX_RECORDS+100)throw Error('Customer store limit');
   for(const name of names){
    if(!/^[a-f0-9]{32}\.json$/.test(name))continue;
    const raw=await readPrivate(path.join(directory,name)),record=validate(JSON.parse(raw),name.slice(0,-5));
    if(requests.has(record.requestId))throw Error('Duplicate customer request');
    records.set(record.id,record);requests.set(record.requestId,record.id);sizes.set(record.id,Buffer.byteLength(raw));totalBytes+=Buffer.byteLength(raw);
    if(records.size>MAX_RECORDS||totalBytes>MAX_BYTES)throw Error('Customer store limit');
   }
  })();
  return loading;
 }
 async function prune(t){
  for(const [id,record]of records){if(record.expiresAt>t)continue;
   const file=path.join(directory,id+'.json');await readPrivate(file);await fs.unlink(file);
   records.delete(id);requests.delete(record.requestId);totalBytes-=sizes.get(id)||0;sizes.delete(id);
  }
 }
 async function persist(record){
  validate(record,record.id);const raw=JSON.stringify(record)+'\n',bytes=Buffer.byteLength(raw);
  if(bytes>MAX_FILE||totalBytes-(sizes.get(record.id)||0)+bytes>MAX_BYTES)throw customerFault(429,'CUSTOMER_STORAGE_LIMIT');
  const file=path.join(directory,record.id+'.json'),tmp=path.join(directory,'.'+crypto.randomBytes(16).toString('hex')+'.tmp');
  const old=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(old&&(old.isSymbolicLink()||!old.isFile()||old.nlink!==1||old.uid!==process.getuid?.()||(old.mode&0o077)!==0))throw Error('Unsafe customer target');
  let h;try{h=await fs.open(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);await h.writeFile(raw);await h.sync();await h.close();h=null;await fs.rename(tmp,file);const d=await fs.open(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{await d.sync();}finally{await d.close();}}
  finally{await h?.close();await fs.unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  totalBytes=totalBytes-(sizes.get(record.id)||0)+bytes;sizes.set(record.id,bytes);records.set(record.id,record);requests.set(record.requestId,record.id);
 }
 async function ready(){await load();return serial(()=>prune(time()));}
 async function create(body){
  const input=normalize(body);await load();
  return serial(async()=>{
   const t=time();await prune(t);
   const fingerprint=digest(JSON.stringify(input)),previous=requests.get(input.requestId);
   if(previous){const record=records.get(previous);if(record.fingerprint!==fingerprint)throw customerFault(409,'CUSTOMER_REQUEST_CONFLICT');return {created:false,reference:record.id,status:record.status,expiresAt:record.expiresAt};}
   if(records.size>=MAX_RECORDS)throw customerFault(429,'CUSTOMER_STORAGE_LIMIT');
   // Contact is not verified by this request. It must not trigger automatic
// marketing, account recovery or disclosure of an existing customer record.
   const id=crypto.randomBytes(16).toString('hex'),record={version:1,id,...input,fingerprint,status:'new',contactVerified:false,createdAt:t,updatedAt:t,expiresAt:t+RETENTION,history:[{status:'new',at:t,actor:'visitor'}]};
   await persist(record);return {created:true,reference:id,status:'new',expiresAt:record.expiresAt};
  });
 }
 async function list({offset=0,limit=25,status}={}){
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX_RECORDS||!Number.isSafeInteger(limit)||limit<1||limit>50||status!==undefined&&!STATES.has(status))throw customerFault(400,'CUSTOMER_INVALID_PAGE');
  await load();return serial(async()=>{await prune(time());const all=[...records.values()].filter(record=>!status||record.status===status).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));return {leads:all.slice(offset,offset+limit).map(record=>{const {receiptHash,fingerprint,requestId,...publicRecord}=record;return structuredClone(publicRecord);}),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null};});
 }
 async function change(id,status,actor){
  if(!ID.test(id)||!STATES.has(status)||status==='withdrawn'||typeof actor!=='string'||actor.length>80)throw customerFault(400,'CUSTOMER_INVALID_STATUS');
  await load();return serial(async()=>{
   await prune(time());const record=records.get(id);if(!record)throw customerFault(404,'CUSTOMER_NOT_FOUND');
   if(record.status==='withdrawn')throw customerFault(409,'CUSTOMER_REQUEST_WITHDRAWN');
   if(record.history.length>=30)throw customerFault(409,'CUSTOMER_HISTORY_LIMIT');
   const t=Math.max(time(),record.updatedAt);const next={...record,status,updatedAt:t,history:[...record.history,{status,at:t,actor}]};await persist(next);return {reference:id,status};
  });
 }
 async function withdraw(id,receiptToken){
  if(!ID.test(id)||!DIGEST.test(receiptToken||''))throw customerFault(404,'CUSTOMER_NOT_FOUND');
  await load();return serial(async()=>{
   await prune(time());const record=records.get(id);
   if(!record||!crypto.timingSafeEqual(Buffer.from(record.receiptHash,'hex'),Buffer.from(digest(receiptToken),'hex')))throw customerFault(404,'CUSTOMER_NOT_FOUND');
   if(record.status==='withdrawn')return {reference:id,status:'withdrawn'};
   const t=Math.max(time(),record.updatedAt),next={...record,status:'withdrawn',contact:'',name:'',message:'',campaign:'',updatedAt:t,history:[...record.history.slice(-29),{status:'withdrawn',at:t,actor:'visitor'}]};
   await persist(next);return {reference:id,status:'withdrawn'};
  });
 }
 // Start from the service lifetime, not the first visitor request. This gives
 // expired records a bounded removal time after a restart while preserving a
 // fail-closed public API if the private store cannot be opened.
 const startup=ready();startup.catch(()=>{});
 const timer=setInterval(()=>{if(!closed)ready().catch(()=>{});},60*60_000);timer.unref();
 async function close(){closed=true;clearInterval(timer);await tail;await loading?.catch(()=>{});if(locked){const lock=JSON.parse(await readPrivate(lockFile,200));if(lock.token===lockToken)await fs.unlink(lockFile);locked=false;}}
 return {ready,startup,create,list,change,withdraw,close};
}
