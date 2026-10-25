const UNIT=10n**18n,MAX_UINT256=(1n<<256n)-1n,ADDRESS=/^0x[0-9a-f]{40}$/i;
const UNKNOWN='—';

function assetWei(value){
 if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)))return null;
 try{const amount=BigInt(value);return amount>=0n&&amount<=MAX_UINT256?amount:null;}catch{return null;}
}
function anchorInteger(value,positive=false){
 const amount=assetWei(value);
 return amount===null||amount>BigInt(Number.MAX_SAFE_INTEGER)||positive&&amount===0n?null:Number(amount);
}

/** Full-precision decimal amount for an 18-decimal asset, without grouping.
 * Unknown and malformed amounts stay unavailable; actual zero is "0".
 */
export function exactAssetAmount(value){
 const amount=assetWei(value);if(amount===null)return UNKNOWN;
 const whole=amount/UNIT,fraction=(amount%UNIT).toString().padStart(18,'0').replace(/0+$/,'');
 return whole.toString()+(fraction?'.'+fraction:'');
}

/** Format integer base units using integer arithmetic, including rounding.
 * `digits` is a maximum, not a forced number of trailing decimal places.
 * A positive value below the displayed unit is shown as "<0.01", never zero.
 */
export function formatAssetAmount(value,{digits=2,locale='en-US'}={}){
 const amount=assetWei(value);
 if(amount===null||!Number.isInteger(digits)||digits<0||digits>18)return UNKNOWN;
 let integers,decimal,digitMap;
 try{
  integers=new Intl.NumberFormat(locale,{maximumFractionDigits:0,useGrouping:true});
  const parts=new Intl.NumberFormat(locale,{minimumFractionDigits:1,maximumFractionDigits:1,useGrouping:false}).formatToParts(1n);
  decimal=parts.find(part=>part.type==='decimal')?.value||'.';
  const digitFormatter=new Intl.NumberFormat(locale,{maximumFractionDigits:0,useGrouping:false});
  digitMap=Array.from({length:10},(_,i)=>digitFormatter.format(BigInt(i)));
 }catch{return UNKNOWN;}
 const scale=10n**BigInt(18-digits),places=10n**BigInt(digits);
 const render=scaled=>{
  const whole=integers.format(scaled/places);
  const fraction=(scaled%places).toString().padStart(digits,'0').replace(/0+$/,'');
  return whole+(fraction?decimal+fraction.replace(/[0-9]/g,digit=>digitMap[digit]):'');
 };
 if(amount>0n&&amount<scale)return '<'+render(1n);
 const rounded=amount/scale+((amount%scale)*2n>=scale?1n:0n);
 return render(rounded);
}

/** Read-only gross spot estimate at a verified account/price snapshot.
 * This is before fees and sale limits. It is not a quote or promised payout.
 * A partial membership refresh must not authorize an older price/balance mix.
 */
export function tokenValuation(state,address,{now=Date.now()}={}){
 if(!state||state.tokenValuationVerified!==true||typeof address!=='string'||!ADDRESS.test(address)||typeof state.wallet?.address!=='string'||!ADDRESS.test(state.wallet.address)||state.wallet.address.toLowerCase()!==address.toLowerCase())return null;
 if(!Number.isSafeInteger(now)||now<=0)return null;
 const block=anchorInteger(state.block),timestamp=anchorInteger(state.timestamp,true);
 if(block===null||timestamp===null)return null;
 const age=BigInt(now)-BigInt(timestamp)*1000n;
 if(age>45_000n||age< -15_000n)return null;
 const priceWei=assetWei(state.price),reserveWei=assetWei(state.reserve),supplyWei=assetWei(state.supply),balanceWei=assetWei(state.wallet.ftiBalance);
 if(priceWei===null||reserveWei===null||supplyWei===null||supplyWei===0n||balanceWei===null||balanceWei>supplyWei||priceWei!==reserveWei*UNIT/supplyWei)return null;
 return {grossValueWei:balanceWei*priceWei/UNIT,priceWei,balanceWei,block,timestamp};
}
