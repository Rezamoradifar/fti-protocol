// Conservative local UI gas headroom; size-fee quotes have no pressure-decay timer.
// A later mined timestamp can execute more decay steps than eth_estimateGas saw.
// This is measured padding, not a proof of an upper bound or a payout guarantee.
// Unused gas is not consumed; minimum-output and deadline checks remain unchanged.
export function bufferedTokenSellGas(estimate){
 if(typeof estimate!=='bigint'||estimate<=0n)throw new TypeError('Positive bigint gas estimate required');
 return estimate+(estimate+3n)/4n+30000n;
}
