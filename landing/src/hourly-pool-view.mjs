const UNIT=10n**18n;
const locales={fa:'fa-IR',ar:'ar',en:'en-US',tr:'tr-TR','zh-CN':'zh-CN',ru:'ru-RU',es:'es-ES'};
const unsigned=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)?BigInt(value):null;
const formatter=lang=>new Intl.NumberFormat(locales[lang]||'en-US');

export function poolInteger(value,lang='en'){
 const number=unsigned(value);return number===null?'—':formatter(lang).format(number);
}
export function poolAmount(value,lang='en'){
 const number=unsigned(value);if(number===null)return '—';
 const format=formatter(lang),whole=format.format(number/UNIT);
 if(number===0n)return whole;
 if(number<10n**12n)return '< '+poolAmount('1000000000000',lang);
 const fraction=(number%UNIT).toString().padStart(18,'0').slice(0,6).replace(/0+$/,'');
 if(!fraction)return whole;
 const decimal=format.formatToParts(1.1).find(part=>part.type==='decimal')?.value||'.';
 const digits=new Intl.NumberFormat(locales[lang]||'en-US',{useGrouping:false});
 return whole+decimal+[...fraction].map(digit=>digits.format(Number(digit))).join('');
}
export function exactPoolAmount(value){
 const number=unsigned(value);if(number===null)return '';
 const fraction=(number%UNIT).toString().padStart(18,'0').replace(/0+$/,'');
 return (number/UNIT).toString()+(fraction?'.'+fraction:'');
}
export function poolTime(timestamp,lang='en'){
 if(!Number.isSafeInteger(timestamp)||timestamp<=0)return '—';
 return new Intl.DateTimeFormat(locales[lang]||'en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:lang==='fa'?'Asia/Tehran':'UTC'}).format(new Date(timestamp*1000));
}
export function hourlyPoolView(snapshot,lang='en'){
 const settled=snapshot?.settled;
 return {pool:poolAmount(snapshot?.current?.poolWei,lang),points:poolInteger(settled?.points,lang),
  pointValue:settled?.pointValueWei==null?'—':poolAmount(settled.pointValueWei,lang),
  settledPool:poolAmount(settled?.poolWei,lang),epoch:poolInteger(snapshot?.current?.epoch,lang),
  settledEpoch:poolInteger(settled?.epoch,lang),processing:Number(snapshot?.current?.phase)>0,
  noEligiblePoints:settled?.points==='0'};
}
