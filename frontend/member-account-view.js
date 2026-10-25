import {CAPS} from './hourly-caps.js';

const ADDRESS=/^0x[0-9a-f]{40}$/i;
const MAX_UINT256=(1n<<256n)-1n;
const ACCOUNT_FIELDS=['units','lifetimeL','lifetimeR','carryL','carryR','autoPending','claimable','usdBalance','ftiBalance','unlocked','remaining'];
const CORE_FIELDS=['units','lifetimeL','lifetimeR','carryL','carryR'];
const MAX_AGE_MS=120_000;

function uint(value){
 if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)))return null;
 try{const result=BigInt(value);return result>=0n&&result<=MAX_UINT256?result.toString():null;}catch{return null;}
}
function integer(value,min,max){const raw=uint(value);if(raw===null)return null;const n=Number(raw);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null;}
function timestamp(value){return integer(value,1,Number.MAX_SAFE_INTEGER);}
function networkView(profile,cfg){
 if(!profile||typeof profile!=='object')return null;
 const chainId=integer(profile.chainId,1,Number.MAX_SAFE_INTEGER);
 if(chainId===null||typeof profile.testAssets!=='boolean'||typeof profile.label!=='string'||!profile.label.trim()||profile.label.length>100)return null;
 if(cfg?.chainId!==undefined&&integer(cfg.chainId,1,Number.MAX_SAFE_INTEGER)!==chainId)return null;
 let explorer=null;
 if(profile.explorer!==null&&profile.explorer!==undefined){
  try{const url=new URL(profile.explorer);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return null;explorer=url.href.replace(/\/$/,'');}catch{return null;}
 }
 return {chainId,label:profile.label,explorer,testAssets:profile.testAssets};
}

/** Project a real account snapshot into plain UI data, with no DOM or writes.
 * Money/token fields remain canonical integer base-unit strings for the caller
 * to format. Missing values are null, never invented zeroes. `now` makes age
 * classification deterministic; callers may supply their current clock in ms.
 */
export function memberAccountView({state,address,networkProfile,selectableAuto=false,cfg,busy=false,updatedAt,readError=false,now=Date.now()}={}){
 const connected=typeof address==='string'&&ADDRESS.test(address);
 const network=networkView(networkProfile,cfg);
 const result={connected,address:connected?address:null,network,verified:false,stale:false,
  status:connected?(readError?'unavailable':'loading'):'disconnected',membershipStatus:'unknown',busy:busy===true,readError:readError===true,
  snapshot:{block:null,timestamp:null,updatedAt:timestamp(updatedAt),ageSeconds:null},
  rank:null,hourlyCap:null,directReferrals:null,autoEnabled:null,autoBuyPercent:null,
  ...Object.fromEntries(ACCOUNT_FIELDS.map(key=>[key,null]))};
 if(!connected)return result;
 if(!state||typeof state!=='object')return result;
 const wallet=state.wallet;
 if(!wallet||typeof wallet!=='object')return {...result,status:busy&&!readError?'loading':'unavailable'};
 if(typeof wallet.address!=='string'||!ADDRESS.test(wallet.address)||wallet.address.toLowerCase()!==address.toLowerCase())return {...result,status:'unavailable'};
 for(const key of ACCOUNT_FIELDS)result[key]=uint(wallet[key]);
 result.rank=integer(wallet.rank,0,4);
 result.autoEnabled=typeof wallet.autoEnabled==='boolean'?wallet.autoEnabled:null;
 if(cfg?.referralPlacementEnabled===true)result.directReferrals=uint(wallet.directReferrals);
 if(selectableAuto===true)result.autoBuyPercent=integer(wallet.autoBuyPercent,5,100);
 const protection=integer(state.level,0,CAPS.length-1);
 if(typeof wallet.exists==='boolean')result.membershipStatus=wallet.exists?'registered':'not-registered';
 result.snapshot.block=integer(state.block,0,Number.MAX_SAFE_INTEGER);
 result.snapshot.timestamp=timestamp(state.timestamp);
 const clock=timestamp(now),observed=result.snapshot.timestamp;
 const validAnchor=result.snapshot.block!==null&&observed!==null&&clock!==null&&observed<=Math.floor(Number.MAX_SAFE_INTEGER/1000);
 if(validAnchor){
  result.snapshot.ageSeconds=Math.max(0,Math.floor((clock-observed*1000)/1000));
  result.stale=clock-observed*1000>MAX_AGE_MS||observed*1000-clock>15_000
    ||result.snapshot.updatedAt!==null&&(clock-result.snapshot.updatedAt>MAX_AGE_MS||result.snapshot.updatedAt-clock>15_000);
 }
 const completeMembership=typeof wallet.exists==='boolean'&&result.rank!==null&&CORE_FIELDS.every(key=>result[key]!==null);
 const hasAccountData=ACCOUNT_FIELDS.some(key=>result[key]!==null)||result.rank!==null||typeof wallet.exists==='boolean';
 if(readError===true&&hasAccountData)result.stale=true;
 result.verified=!!(network&&validAnchor&&completeMembership&&!result.stale);
 if(result.verified&&wallet.exists===true&&protection!==null)result.hourlyCap=CAPS[protection][result.rank];
 result.status=result.stale?'stale':result.verified?'verified':'unavailable';
 return result;
}
