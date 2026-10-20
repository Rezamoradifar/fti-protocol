import {preparedWalletSend,confirmedReceipt} from './transaction-state.js';

const addressPattern=/^0x[0-9a-f]{40}$/i,hashPattern=/^0x[0-9a-f]{64}$/i;
const sameAddress=(left,right)=>typeof left==='string'&&typeof right==='string'&&left.toLowerCase()===right.toLowerCase();
const quantity=value=>'0x'+BigInt(value).toString(16);
const failure=()=>Error('Cancellation details differ from the request. Check wallet activity.');

// All network work happens before the final, fresh user gesture. No wallet RPC
// is needed to prepare a zero-value self-transfer at the protected nonce.
export async function prepareUnknownCancellation(tracker,readProvider,address,chainId){
 const record=tracker.read();
 if(!/^unknown:\d+$/.test(record||''))throw Error('No unknown send to cancel.');
 const nonce=Number(record.slice(8));
 if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('Invalid nonce.');
 if(!addressPattern.test(address||''))throw Error('Invalid wallet address.');
 if(!Number.isSafeInteger(chainId)||chainId<1||Number((await readProvider.getNetwork()).chainId)!==chainId)throw Error('Wallet network does not match this deployment.');
 const [code,latest,fee]=await Promise.all([
  readProvider.getCode(address),readProvider.getTransactionCount(address,'latest'),
  typeof readProvider.send==='function'?readProvider.send('eth_gasPrice',[]):readProvider.getFeeData().then(value=>value.gasPrice),
 ]);
 if(code!=='0x')throw Error('Use wallet activity to resolve this smart-account request.');
 if(!Number.isSafeInteger(latest)||latest<0)throw Error('The wallet nonce could not be verified. No cancellation sent.');
 if(latest>nonce)throw Error('The previous nonce is already confirmed. Verify its transaction hash instead.');
 if(latest<nonce)throw Error('Earlier transactions must confirm first. Check wallet activity.');
 let gasPrice;try{gasPrice=BigInt(fee);}catch{throw Error('Network fee is unavailable. No cancellation sent.');}
 if(gasPrice<=0n)throw Error('Network fee is unavailable. No cancellation sent.');
 if(tracker.read()!==record)throw Error('Transaction state changed. Refresh before continuing.');
 const request=Object.freeze({from:address,to:address,value:'0x0',data:'0x',nonce:quantity(nonce),chainId:quantity(chainId),gas:'0x5208',gasPrice:quantity((gasPrice*125n+99n)/100n)});
 return Object.freeze({record,nonce,request});
}

function validatePrepared(prepared){
 const request=prepared?.request;
 if(!Number.isSafeInteger(prepared?.nonce)||prepared.nonce<0||prepared.record!=='unknown:'+prepared.nonce||
  !addressPattern.test(request?.from||'')||!sameAddress(request.from,request.to)||request.value!=='0x0'||request.data!=='0x'||
  request.nonce!==quantity(prepared.nonce)||request.gas!=='0x5208'||!/^0x[1-9a-f][0-9a-f]*$/i.test(request.chainId||'')||
  !/^0x[1-9a-f][0-9a-f]*$/i.test(request.gasPrice||''))throw Error('Invalid prepared cancellation.');
}

function verifyDetails(tx,receipt,prepared){
 const request=prepared.request;
 if(!tx||!receipt||!sameAddress(tx.from,request.from)||!sameAddress(tx.to,request.to)||tx.nonce!==prepared.nonce||
  tx.data!=='0x'||!hashPattern.test(tx.hash||'')||tx.hash.toLowerCase()!==receipt.hash?.toLowerCase()||
  !Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<0||!hashPattern.test(receipt.blockHash||'')||
  ![0,1].includes(Number(receipt.status))||tx.blockNumber!==receipt.blockNumber||tx.blockHash!==receipt.blockHash)throw failure();
 try{if(BigInt(tx.value)!==0n||BigInt(tx.chainId)!==BigInt(request.chainId))throw failure();}
 catch{throw failure();}
}

// This function reaches wallet.request synchronously before its first await.
// A known hash is shown immediately, but the original unknown nonce remains
// protected until the public RPC proves the exact self-transfer was mined.
export async function submitUnknownCancellation(tracker,wallet,readProvider,prepared,onSubmitted=()=>{}){
 validatePrepared(prepared);
 if(tracker.read()!==prepared.record)throw Error('Transaction state changed. Refresh before continuing.');
 const send=preparedWalletSend(wallet,readProvider,prepared.request);
 const tx=await send();
 tracker.remember?.(tx.hash);onSubmitted(tx.hash);
 const receipt=await tx.wait();
 if(!receipt)throw Error('Transaction confirmation is pending. Check wallet activity before retrying.');
 const sent=await readProvider.getTransaction(tx.hash);
 verifyDetails(sent,receipt,prepared);
 if(receipt.hash.toLowerCase()!==tx.hash.toLowerCase())throw failure();
 const canonical=await readProvider.getBlock(receipt.blockNumber);
 if(canonical?.hash!==receipt.blockHash)throw Error('Cancellation block changed. Verify its transaction hash before continuing.');
 if(tracker.read()!==prepared.record)throw Error('Transaction state changed. Refresh before continuing.');
 tracker.save(tx.hash);
 return confirmedReceipt({hash:tx.hash,wait:async()=>receipt},tracker);
}
