// Links can supply hash candidates, never a wallet, nonce or an unlock command.
// The recovery reader verifies every candidate against the connected wallet's
// existing pending record and a canonical confirmed receipt.
export function recoveryHints(href){
 let values;try{values=new URL(href).searchParams.getAll('recover');}catch{return [];}
 if(values.length>16)return [];
 return [...new Set(values.filter(value=>/^0x[0-9a-f]{64}$/i.test(value)).map(value=>value.toLowerCase()))];
}

// This optional public file contains candidates from a read-only diagnostic,
// with no RPC credentials. Every candidate still needs canonical verification.
export async function readRecoveryHints({address,chainId,fetchImpl=globalThis.fetch,timeoutMs=5000}){
 if(!/^0x[0-9a-f]{40}$/i.test(address)||!Number.isSafeInteger(chainId)||chainId<=0)throw Error('Invalid recovery hint identity.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetchImpl(`/token/recovery/${chainId}/${address.toLowerCase()}.json`,{method:'GET',cache:'no-store',redirect:'error',signal:controller.signal});
  if(response.status===404)return [];
  if(!response.ok)throw Error('Recovery candidates are unavailable.');
  const body=await response.text();if(body.length>16384)throw Error('Recovery candidates are too large.');
  const value=JSON.parse(body);
  if(value?.schema!=='FTI_RECOVERY_HINTS_V1'||value.chainId!==chainId||value.address?.toLowerCase()!==address.toLowerCase()||!Array.isArray(value.hashes)||value.hashes.length>16||value.hashes.some(hash=>!/^0x[0-9a-f]{64}$/i.test(hash)))throw Error('Invalid recovery candidates.');
  return [...new Set(value.hashes.map(hash=>hash.toLowerCase()))];
 }finally{clearTimeout(timer);}
}
