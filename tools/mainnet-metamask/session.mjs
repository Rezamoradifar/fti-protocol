// Wallet-only signing coordinator. No key input, automatic retry or service activation.
import {getAddress, getCreateAddress, keccak256, sha256, toUtf8Bytes, toQuantity} from 'ethers';
const check=(ok,message)=>{if(!ok)throw Error(message)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const digest=v=>sha256(toUtf8Bytes(JSON.stringify(canonical(v)))).slice(2);
const names=['council','timelock','tokenImplementation','token','binaryImplementation','binary','bind'];
export function validatePlan(plan,expectedDigest){
 const {digest:actual,...body}=plan;
 check(actual===expectedDigest&&actual===digest(body),'Plan digest mismatch');
 check(plan.schema==='FTI_MAINNET_UNSIGNED_PLAN_V1'&&plan.input.chainId===56&&plan.readyToBroadcast===false,'Reviewed chain-56 plan required');
 getAddress(plan.input.deployer);
 check(Number.isSafeInteger(plan.nonce)&&plan.nonce>=0&&Number.isSafeInteger(plan.nonce+7),'Invalid nonce');
 check(plan.transactions.length===7,'Exactly seven transactions required');
 for(const [i,tx]of plan.transactions.entries()){
  check(tx.name===names[i]&&tx.chainId===56&&same(tx.from,plan.input.deployer)&&tx.nonce===plan.nonce+i&&tx.value==='0','Unexpected transaction');
  check(keccak256(tx.data)===tx.dataHash,'Payload hash mismatch');
  if(i<6)check(tx.to===null&&same(plan.addresses[tx.name],getCreateAddress({from:tx.from,nonce:tx.nonce})),'Creation address mismatch');
  else check(same(tx.to,plan.addresses.token),'Binding target mismatch');
 }
 return plan;
}
export class MainnetSession{
 constructor({provider,plan,expectedDigest,storage,maxFeeWei,maxGasPriceWei,confirmations=12}){
  this.provider=provider;this.plan=validatePlan(plan,expectedDigest);this.storage=storage;
  this.maxFeeWei=BigInt(maxFeeWei);this.maxGasPriceWei=BigInt(maxGasPriceWei);
  check(this.maxFeeWei>0n&&this.maxGasPriceWei>0n,'Positive fee limits required');
  check(Number.isSafeInteger(confirmations)&&confirmations>=12,'At least 12 confirmations required');
  this.confirmations=confirmations;this.busy=false;this.key='fti-mainnet:'+plan.digest;
  this.state=JSON.parse(storage.getItem(this.key)||'{"steps":[],"reservedWei":"0"}');
  check(Array.isArray(this.state.steps)&&this.state.steps.length<=7,'Invalid saved journal');
  check(this.state.steps.every(s=>BigInt(s.reservedWei)>0n),'Invalid saved fee reservation');
  const reserved=this.state.steps.reduce((sum,s)=>sum+BigInt(s.reservedWei),0n);
  check(reserved>=0n&&reserved===BigInt(this.state.reservedWei)&&reserved<=this.maxFeeWei,'Saved fee reservation exceeds the limits');
  this.persist(); // Storage must work before a wallet can be prompted.
 }
 rpc(method,params=[]){return this.provider.request({method,params})}
 persist(){this.storage.setItem(this.key,JSON.stringify(this.state))}
 async account(){
  check(BigInt(await this.rpc('eth_chainId'))===56n,'Select BNB Smart Chain mainnet (56) in MetaMask');
  const accounts=await this.rpc('eth_accounts');
  check(same(accounts?.[0],this.plan.input.deployer),'Select the approved deployment account in MetaMask');
 }
 audit(tx,receipt,step){
  check(tx&&receipt&&same(tx.hash,receipt.transactionHash)&&BigInt(receipt.status)===1n,'Successful matching transaction receipt required');
  // Some RPCs omit chainId for legacy transactions; EIP-155 v still commits to it.
  const chain=tx.chainId!==undefined?BigInt(tx.chainId):tx.v!==undefined&&BigInt(tx.v)>=35n?(BigInt(tx.v)-35n)/2n:0n;
  check(chain===56n&&same(tx.from,step.from)&&Number(BigInt(tx.nonce))===step.nonce&&BigInt(tx.value)===0n&&same(tx.input??tx.data,step.data),'Wallet transaction differs from plan');
  check(step.to?same(tx.to,step.to):tx.to===null,'Unexpected transaction destination');
  if(!step.to)check(same(receipt.contractAddress,this.plan.addresses[step.name]),'Unexpected created contract');
 }
 async reconcile(){
  await this.account();
  for(const [i,saved]of this.state.steps.entries()){
   check(saved.index===i&&saved.hash,'Uncertain send: do not retry. Inspect the deployer nonce and explorer first.');
   saved.confirmed=false;this.persist();
   const receipt=await this.rpc('eth_getTransactionReceipt',[saved.hash]);
   if(!receipt)return false;
   const tx=await this.rpc('eth_getTransactionByHash',[saved.hash]);
   this.audit(tx,receipt,this.plan.transactions[i]);
   check(BigInt(tx.gasPrice)<=this.maxGasPriceWei&&BigInt(tx.gas)*BigInt(tx.gasPrice)<=BigInt(saved.reservedWei),'Wallet changed the approved gas limits; stop and review');
   const block=await this.rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
   check(same(block?.hash,receipt.blockHash),'Receipt block changed');
   if(BigInt(await this.rpc('eth_blockNumber'))-BigInt(receipt.blockNumber)+1n<BigInt(this.confirmations))return false;
   if(!this.plan.transactions[i].to)check(await this.rpc('eth_getCode',[receipt.contractAddress,'latest'])!=='0x','Created contract has no code');
   saved.confirmed=true;this.persist();
  }
  return true;
 }
 async sendNext(){
  check(!this.busy,'Another wallet operation is running');this.busy=true;
  try{
   check(await this.reconcile(),'Wait for the previous transaction and 12 confirmations');
   const index=this.state.steps.length,step=this.plan.transactions[index];check(step,'All seven transactions have been sent');
   const latest=Number(BigInt(await this.rpc('eth_getTransactionCount',[step.from,'latest'])));
   const pending=Number(BigInt(await this.rpc('eth_getTransactionCount',[step.from,'pending'])));
   check(latest===step.nonce&&pending===step.nonce,'Nonce changed or pending transaction exists; stop and review');
   check(keccak256(await this.rpc('eth_getCode',[this.plan.input.usd,'latest']))===this.plan.input.usdCodeHash,'Collateral code changed');
   if(!step.to)check(await this.rpc('eth_getCode',[this.plan.addresses[step.name],'latest'])==='0x'&&BigInt(await this.rpc('eth_getTransactionCount',[this.plan.addresses[step.name],'latest']))===0n,'Predicted address already occupied');
   const tx={from:step.from,chainId:'0x38',nonce:toQuantity(step.nonce),value:'0x0',data:step.data,...(step.to?{to:step.to}:{})};
   const estimate=BigInt(await this.rpc('eth_estimateGas',[tx]));
   const gas=(estimate*120n+99n)/100n;check(gas>0n&&gas<=12000000n,'Gas estimate exceeds the per-transaction limit');
   const price=BigInt(await this.rpc('eth_gasPrice'));check(price>0n&&price<=this.maxGasPriceWei,'Gas price exceeds the approved ceiling');
   // Fix the submitted legacy price at the explicit ceiling, so the journal bounds fees.
   const reserved=gas*this.maxGasPriceWei,previous=BigInt(this.state.reservedWei);
   check(previous+reserved<=this.maxFeeWei,'Total fee budget exceeded');
   check(BigInt(await this.rpc('eth_getBalance',[step.from,'pending']))>=reserved,'Insufficient BNB for this transaction');
   check(Number(BigInt(await this.rpc('eth_getTransactionCount',[step.from,'latest'])))===step.nonce&&Number(BigInt(await this.rpc('eth_getTransactionCount',[step.from,'pending'])))===step.nonce,'Nonce changed during estimation; stop and review');
   await this.account(); // Recheck after async estimation, immediately before the wallet prompt.
   const entry={index,intent:true,confirmed:false,reservedWei:String(reserved)};
   this.state.steps.push(entry);this.state.reservedWei=String(previous+reserved);this.persist();
   let hash;
   try{hash=await this.rpc('eth_sendTransaction',[{...tx,gas:toQuantity(gas),gasPrice:toQuantity(this.maxGasPriceWei)}])}
   catch(error){
    if(error.code===4001){this.state.steps.pop();this.state.reservedWei=String(previous);this.persist()}
    throw error; // Other errors retain the uncertain-send marker. Never auto-resend.
   }
   check(/^0x[0-9a-f]{64}$/i.test(hash||''),'Uncertain wallet response; inspect the explorer before any retry');
   entry.hash=hash;this.persist();return hash;
  }finally{this.busy=false}
 }
 exportHashes(){
  check(this.state.steps.length===7&&this.state.steps.every(s=>s.hash&&s.confirmed),'Seven confirmed transactions required');
  return Object.fromEntries(this.state.steps.map((s,i)=>[names[i],s.hash]));
 }
}
