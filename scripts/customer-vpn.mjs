// A read-only handoff adapter, not a payment processor or VPN provisioner.
// Checkout remains closed until both delivery acceptance and live provider
// health match the same provider release. User input never selects a URL.
import fs from 'node:fs/promises';
import https from 'node:https';
import dns from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';

const REQUIRED_CHECKS=['paid-order-delivered','owner-authorized-retrieval','retry-after-provisioning-failure','reopen-order-recovery','expiry-enforcement'];
const RESERVED_V4=new BlockList(),RESERVED_V6=new BlockList();
for(const [ip,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])RESERVED_V4.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix]of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',32],['2001:2::',48],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['fec0::',10],['ff00::',8]])RESERVED_V6.addSubnet(ip,prefix,'ipv6');
export function isPublicVpnAddress(address){
 const family=isIP(address);if(!family)return false;
 if(family===4)return !RESERVED_V4.check(address,'ipv4');
 // Only ordinary globally routable unicast addresses; reject NAT64,
 // mapped/transition ranges rather than trying to interpret embedded IPv4.
 return /^[23][0-9a-f]{0,3}:/i.test(address)&&!RESERVED_V6.check(address,'ipv6');
}
function url(value,allowedHosts){
 const parsed=new URL(value);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.port&&parsed.port!=='443'||isIP(parsed.hostname)||!allowedHosts.has(parsed.hostname)||!/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(parsed.hostname))throw Error('Invalid VPN provider URL');
 return parsed;
}
export function validateVpnManifest(manifest,allowedHosts,now=Date.now()){
 if(!manifest||manifest.version!==1||manifest.provider!=='NodeShield'||!Array.isArray(manifest.deliveryChecks)||!REQUIRED_CHECKS.every(check=>manifest.deliveryChecks.includes(check))||typeof manifest.releaseId!=='string'||!/^[-a-zA-Z0-9_.]{1,80}$/.test(manifest.releaseId)||typeof manifest.evidenceReference!=='string'||!/^[-a-zA-Z0-9_./:]{4,160}$/.test(manifest.evidenceReference))throw Error('VPN acceptance evidence is incomplete');
 const acceptedAt=Date.parse(manifest.deliveryVerifiedAt);
 if(!Number.isSafeInteger(acceptedAt)||acceptedAt>now||now-acceptedAt>90*86_400_000)throw Error('VPN acceptance evidence is stale');
 const hosts=new Set(allowedHosts),portal=url(manifest.portalUrl,hosts),health=url(manifest.healthUrl,hosts);
 if(portal.origin!==health.origin)throw Error('VPN provider origin mismatch');
 return {...manifest,portalUrl:portal.href,healthUrl:health.href,acceptedAt};
}
export async function loadVpnManifest({file,allowedHosts,now=Date.now()}){
 if(!file)return null;
 const h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const st=await h.stat();if(!st.isFile()||st.nlink!==1||st.size>6000||(st.mode&0o022)!==0||![0,process.getuid?.()].includes(st.uid))throw Error('Unsafe VPN manifest');
  return validateVpnManifest(JSON.parse(await h.readFile('utf8')),allowedHosts,now);
 }finally{await h.close();}
}

export async function fetchVpnHealth(target,{lookup=dns.lookup,request=https.request,timeoutMs=4500}={}){
 const parsed=new URL(target);
 let lookupTimer;
 const addresses=await Promise.race([lookup(parsed.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{lookupTimer=setTimeout(()=>reject(Error('VPN DNS timeout')),timeoutMs);lookupTimer.unref();})]).finally(()=>clearTimeout(lookupTimer));
 if(!Array.isArray(addresses)||!addresses.length||addresses.length>20||addresses.some(item=>!isPublicVpnAddress(item.address)))throw Error('VPN health target is not public');
 const chosen=addresses.find(item=>item.family===4)||addresses[0];
 return new Promise((resolve,reject)=>{
  let settled=false,req,timer;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){req?.destroy();reject(error);}else resolve(value);};
  // Pin the checked DNS result for this TLS request, retaining the original
  // hostname for certificate verification. Do not follow redirects.
  req=request(parsed,{method:'GET',agent:false,servername:parsed.hostname,headers:{Accept:'application/json','User-Agent':'FTI-NodeShield-health/1'},lookup:(_host,options,callback)=>{
   if(options?.all)callback(null,[chosen]);else callback(null,chosen.address,chosen.family);
  }},response=>{
   if(response.statusCode!==200||!/^application\/json\b/i.test(response.headers['content-type']||'')){response.resume();return finish(Error('VPN health response rejected'));}
   const chunks=[];let bytes=0;
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192){response.destroy();finish(Error('VPN health response too large'));}else chunks.push(chunk);});
   response.once('error',error=>finish(error));
   response.once('end',()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){finish(error);}});
  });
  timer=setTimeout(()=>finish(Error('VPN health timeout')),timeoutMs);timer.unref();
  req.once('error',error=>finish(error));req.end();
 });
}

export function createVpnHandoff({manifestFile,allowedHosts=[],now=Date.now,readManifest=loadVpnManifest,readHealth=fetchVpnHealth}){
 let cached=null,pending=null;
 const unavailable=state=>({provider:'NodeShield',state,checkoutUrl:null,deliveryVerifiedAt:null,checkedAt:null});
 function status(){return cached&&now()-cached.at<30_000?cached.data:unavailable(manifestFile?'unavailable':'not-configured');}
 async function check(){
  if(!manifestFile)return unavailable('not-configured');
  if(cached&&now()-cached.at<30_000)return cached.data;
  if(pending)return pending;
  pending=(async()=>{
   let data=unavailable('unavailable');
   try{
    const manifest=await readManifest({file:manifestFile,allowedHosts,now:now()});
    const health=await readHealth(manifest.healthUrl);
    if(health?.service!=='nodeshield'||health.status!=='ok'||health.checkoutReady!==true||health.deliveryReady!==true||health.releaseId!==manifest.releaseId)throw Error('VPN provider is not ready');
    data={provider:'NodeShield',state:'ready',checkoutUrl:manifest.portalUrl,deliveryVerifiedAt:new Date(manifest.acceptedAt).toISOString(),checkedAt:new Date(now()).toISOString()};
   }catch{data={...data,checkedAt:new Date(now()).toISOString()};}
   cached={at:now(),data};return data;
  })().finally(()=>{pending=null;});
  return pending;
 }
 return {status,check};
}
