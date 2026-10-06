// USD and FTI both use 18 decimals; their atom scales cancel in R / S.
// Never convert reserves, supply, prices, or deltas to Number.
const atoms = value => {
 if (typeof value !== 'bigint' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw Error('Expected unsigned integer atoms');
 const n=BigInt(value);if(n<0n)throw Error('Negative atoms');return n;
};
export function ratio(reserve,supply){const r=atoms(reserve),s=atoms(supply);return s===0n?null:{numerator:r,denominator:s};}
export function ratioDelta(before,after){
 const a=ratio(before.reserve,before.supply),b=ratio(after.reserve,after.supply);
 return !a||!b?null:{numerator:b.numerator*a.denominator-a.numerator*b.denominator,denominator:b.denominator*a.denominator};
}
// Long division, truncated rather than rounded up. Ellipsis explicitly marks a
// non-terminating/truncated decimal. The rational remains exact and inspectable.
export function formatRatio(value,{sign=false,minDecimals=0,significantDigits=24}={}){
 if(!value)return 'Undefined (zero supply)';
 let n=value.numerator,d=value.denominator;if(typeof n!=='bigint'||typeof d!=='bigint'||d<=0n)throw Error('Invalid ratio');
 const prefix=n<0n?'-':sign&&n>0n?'+':'';if(n<0n)n=-n;
 const whole=n/d;let remainder=n%d,fraction='',seen=whole>0n?whole.toString().length:0;
 while(remainder!==0n&&fraction.length<180&&(seen<significantDigits||fraction.length<minDecimals)){
  remainder*=10n;const digit=remainder/d;fraction+=digit.toString();remainder%=d;if(seen||digit!==0n)seen++;
 }
 return prefix+whole.toString()+(fraction?'.'+fraction:'')+(remainder!==0n?'…':'');
}
export function exactFraction(value){return value?`${value.numerator} / ${value.denominator}`:'Undefined: reserve / zero supply';}
export function deltaDecimals(delta){
 if(!delta||delta.numerator===0n)return 0;
 let n=delta.numerator<0n?-delta.numerator:delta.numerator,places=0;
 while(n<delta.denominator&&places<174){n*=10n;places++;}return places+6;
}
export async function readRatioSnapshot(provider,token,blockTag='latest'){
 const block=await provider.getBlock(blockTag);if(!block?.hash)throw Error('Block unavailable');
 const [reserve,supply,getter]=await Promise.all([token.reserve({blockTag:block.number}),token.totalSupply({blockTag:block.number}),token.price({blockTag:block.number})]);
 const check=await provider.getBlock(block.number);if(check?.hash!==block.hash)throw Error('Chain changed while reading price');
 return {reserve:atoms(reserve),supply:atoms(supply),getter:atoms(getter),blockNumber:block.number,blockHash:block.hash,parentHash:block.parentHash};
}
export async function confirmedTransactionDelta(provider,token,receipt){
 if(!receipt||receipt.status!==1||!receipt.hash||!receipt.blockHash)throw Error('Successful receipt required');
 const block=await provider.getBlock(receipt.blockNumber);
 if(block?.hash!==receipt.blockHash||block.transactions?.length!==1||block.transactions[0].toLowerCase()!==receipt.hash.toLowerCase())throw Error('Transaction-isolated snapshots unavailable (shared or changed block)');
 if(block.number<1)throw Error('Parent block unavailable');
 const before=await readRatioSnapshot(provider,token,block.number-1),after=await readRatioSnapshot(provider,token,block.number);
 if(before.blockHash!==block.parentHash||after.blockHash!==receipt.blockHash)throw Error('Chain changed while verifying transaction');
 return {before,after,delta:ratioDelta(before,after),transactionHash:receipt.hash};
}
