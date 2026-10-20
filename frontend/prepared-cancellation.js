import {preparedWalletSend,confirmedReceipt} from './transaction-state.js';

const addressPattern=/^0x[0-9a-f]{40}$/i,hashPattern=/^0x[0-9a-f]{64}$/i;
const bytecodePattern=/^0x(?:[0-9a-f]{2})*$/i,delegationPattern=/^0xef0100[0-9a-f]{40}$/i;
const ZERO='0x0000000000000000000000000000000000000000';
const preparedRequests=new WeakSet();
const sameAddress=(left,right)=>typeof left==='string'&&typeof right==='string'&&left.toLowerCase()===right.toLowerCase();
const quantity=value=>'0x'+BigInt(value).toString(16);
const failure=()=>Error('Cancellation details differ from the request. Check wallet activity.');
const tagged=(code,message,details={})=>Object.assign(Error(message),{code,...details});
const emptyList=value=>value==null||Array.isArray(value)&&value.length===0;

// All network work happens before the final, fresh user gesture. No wallet RPC
// is needed to prepare a zero-value replacement at the protected nonce. A
// delegated EOA must not call itself: that would execute its delegated code.
export async function prepareUnknownCancellation(tracker,readProvider,address,chainId){
 const record=tracker.read();
 if(!/^unknown:(0|[1-9]\d*)$/.test(record||''))throw Error('No unknown send to cancel.');
 const nonce=Number(record.slice(8));
 if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('Invalid nonce.');
 if(!addressPattern.test(address||''))throw Error('Invalid wallet address.');
 if(!Number.isSafeInteger(chainId)||chainId<1||Number((await readProvider.getNetwork()).chainId)!==chainId)throw Error('Wallet network does not match this deployment.');
 // Resolve nonce state before classifying code: an already-mined nonce needs
 // verified hash recovery, rather than another cancellation of any account type.
 const latest=await readProvider.getTransactionCount(address,'latest');
 if(!Number.isSafeInteger(latest)||latest<0)throw Error('The wallet nonce could not be verified. No cancellation sent.');
 if(latest>nonce)throw tagged('FTI_PREVIOUS_NONCE_CONFIRMED','The previous nonce is already confirmed. Verify its transaction hash instead.',{nonce,latest});
 if(latest<nonce)throw tagged('FTI_EARLIER_TRANSACTIONS_PENDING','Earlier transactions must confirm first. Check wallet activity.',{nonce,latest});
 const code=await readProvider.getCode(address);
 if(typeof code!=='string'||!bytecodePattern.test(code)||code.toLowerCase().startsWith('0xef0100')&&!delegationPattern.test(code))throw tagged('FTI_INVALID_ACCOUNT_CODE','The wallet code could not be verified. No cancellation sent.');
 const accountCode=code.toLowerCase(),accountType=accountCode==='0x'?'eoa':delegationPattern.test(accountCode)?'delegated-eoa':null;
 if(!accountType)throw tagged('FTI_UNSUPPORTED_SMART_ACCOUNT','Use wallet activity to resolve this smart-account request.');
 const recipient=accountType==='eoa'?address:ZERO;
 if(accountType==='delegated-eoa'){
  const destinationCode=await readProvider.getCode(ZERO);
  if(typeof destinationCode!=='string'||destinationCode.toLowerCase()!=='0x')throw tagged('FTI_UNSAFE_CANCELLATION_RECIPIENT','The cancellation recipient could not be verified. No cancellation sent.');
 }
 const fee=await (typeof readProvider.send==='function'?readProvider.send('eth_gasPrice',[]):readProvider.getFeeData().then(value=>value.gasPrice));
 let gasPrice;try{if(!['bigint','number','string'].includes(typeof fee))throw Error();gasPrice=BigInt(fee);}catch{throw Error('Network fee is unavailable. No cancellation sent.');}
 if(gasPrice<=0n||gasPrice>((1n<<256n)-1n)*100n/125n)throw Error('Network fee is unavailable. No cancellation sent.');
 const [currentCode,currentNetwork]=await Promise.all([readProvider.getCode(address),readProvider.getNetwork()]);
 if(typeof currentCode!=='string'||currentCode.toLowerCase()!==accountCode)throw tagged('FTI_ACCOUNT_CODE_CHANGED','Wallet code changed. Prepare the cancellation again.');
 if(Number(currentNetwork.chainId)!==chainId)throw Error('Wallet network does not match this deployment.');
 if(tracker.read()!==record)throw Error('Transaction state changed. Refresh before continuing.');
 const request=Object.freeze({from:address,to:recipient,value:'0x0',data:'0x',nonce:quantity(nonce),chainId:quantity(chainId),gas:'0x5208',gasPrice:quantity((gasPrice*125n+99n)/100n),type:'0x0'});
 const prepared=Object.freeze({record,nonce,accountType,accountCode,request});
 preparedRequests.add(prepared);return prepared;
}

function validatePrepared(prepared){
 const request=prepared?.request;
 const keys=['from','to','value','data','nonce','chainId','gas','gasPrice','type'];
 const classified=prepared?.accountType==='eoa'?prepared.accountCode==='0x'&&sameAddress(request?.from,request?.to):prepared?.accountType==='delegated-eoa'&&delegationPattern.test(prepared.accountCode||'')&&sameAddress(request?.to,ZERO);
 if(!preparedRequests.has(prepared)||!classified||!Number.isSafeInteger(prepared?.nonce)||prepared.nonce<0||prepared.record!=='unknown:'+prepared.nonce||
  !request||Object.keys(request).length!==keys.length||!Object.keys(request).every(key=>keys.includes(key))||request.type!=='0x0'||
  !addressPattern.test(request.from||'')||request.value!=='0x0'||request.data!=='0x'||
  request.nonce!==quantity(prepared.nonce)||request.gas!=='0x5208'||!/^0x[1-9a-f][0-9a-f]*$/i.test(request.chainId||'')||
  !/^0x[1-9a-f][0-9a-f]*$/i.test(request.gasPrice||''))throw Error('Invalid prepared cancellation.');
}

function verifyDetails(tx,receipt,prepared){
 const request=prepared.request;
 if(!tx||!receipt||!sameAddress(tx.from,request.from)||!sameAddress(tx.to,request.to)||tx.nonce!==prepared.nonce||
  tx.data!=='0x'||tx.type!==0||!emptyList(tx.authorizationList)||!emptyList(tx.accessList)||
  !hashPattern.test(tx.hash||'')||tx.hash.toLowerCase()!==receipt.hash?.toLowerCase()||
  !Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<0||!hashPattern.test(receipt.blockHash||'')||
  ![0,1].includes(Number(receipt.status))||tx.blockNumber!==receipt.blockNumber||tx.blockHash!==receipt.blockHash)throw failure();
 try{if(BigInt(tx.value)!==0n||BigInt(tx.chainId)!==BigInt(request.chainId)||BigInt(tx.gasLimit)!==21000n)throw failure();}
 catch{throw failure();}
}

// This function reaches wallet.request synchronously before its first await.
// A known hash is shown immediately, but the original unknown nonce remains
// protected until the public RPC proves this exact legacy replacement was mined.
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
 if(canonical?.hash!==receipt.blockHash||canonical.number!==receipt.blockNumber)throw Error('Cancellation block changed. Verify its transaction hash before continuing.');
 if(tracker.read()!==prepared.record)throw Error('Transaction state changed. Refresh before continuing.');
 tracker.save(tx.hash);
 return confirmedReceipt({hash:tx.hash,wait:async()=>receipt},tracker);
}
