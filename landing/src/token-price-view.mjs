import {poolInteger} from './hourly-pool-view.mjs';
const UNIT=10n**18n,MINIMUM=10n**10n;
export function tokenPriceFreshness(timestamp,nowMs=Date.now()){
 if(!Number.isSafeInteger(timestamp)||timestamp<=0||!Number.isFinite(nowMs)||nowMs<=0)return 'unavailable';
 return Math.abs(nowMs-timestamp*1000)>45000?'delayed':'fresh';
}
export function tokenPriceAmount(value,lang='en'){
 if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value))return '—';
 const number=BigInt(value);
 if(number>0n&&number<MINIMUM)return '< '+tokenPriceAmount(String(MINIMUM),lang);
 const format=new Intl.NumberFormat(lang,{useGrouping:false});
 const decimal=format.formatToParts(1.1).find(part=>part.type==='decimal')?.value||'.';
 const fraction=(number%UNIT).toString().padStart(18,'0').slice(0,8);
 return poolInteger(String(number/UNIT),lang)+decimal+[...fraction].map(digit=>format.format(Number(digit))).join('');
}
