const address=value=>/^0x[0-9a-f]{40}$/i.test(value||'');
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);

// All asynchronous preparation happens before open(). The final click invokes
// the wallet callback synchronously, preserving activation in mobile browsers.
export function walletReview({document,translate,now=Date.now,maxAgeMs=30000}){
 const panel=document.getElementById('wallet-review-panel'),button=document.getElementById('confirm-wallet-request'),cancelButton=document.getElementById('cancel-wallet-review');
 let pending=null;
 const hide=()=>{panel.hidden=true;button.disabled=true;};
 function cancel(message=translate('Request cancelled before sending.','درخواست پیش از ارسال لغو شد.')){
  if(!pending)return;const job=pending;pending=null;hide();job.reject(Error(message));
 }
 function open({request,title,onConfirm,isCurrent=()=>true}){
  if(pending)throw Error('A wallet review is already open.');
  if(!address(request?.from)||!address(request?.to)||!['chainId','nonce','gas','gasPrice','value'].every(key=>quantity(request[key]))||!/^0x(?:[0-9a-f]{2})*$/i.test(request.data||''))throw Error('Invalid prepared wallet request.');
  document.getElementById('wallet-review-title').textContent=title;
  const details=document.getElementById('wallet-review-details');if(details)details.open=false;
  for(const [id,value]of Object.entries({'wallet-review-from':request.from,'wallet-review-to':request.to,'wallet-review-network':'BNB Smart Chain · '+String(BigInt(request.chainId)),'wallet-review-nonce':String(BigInt(request.nonce))}))document.getElementById(id).textContent=value;
  return new Promise((resolve,reject)=>{
   pending={resolve,reject,onConfirm,isCurrent,createdAt:now()};panel.hidden=false;button.disabled=false;
   panel.scrollIntoView?.({block:'center',behavior:'smooth'});button.focus?.({preventScroll:true});
  });
 }
 button.onclick=()=>{
  const job=pending;if(!job)return;
  const age=now()-job.createdAt;
  if(age<0||age>maxAgeMs){cancel(translate('The prepared request expired. Start the action again to refresh it.','اطلاعات آماده‌شده منقضی شد؛ عملیات را دوباره شروع کن.'));return;}
  try{if(!job.isCurrent())throw Error();}catch{cancel(translate('Wallet or transaction state changed. Prepare the action again.','ولت یا وضعیت درخواست تغییر کرده است؛ عملیات را دوباره آماده کن.'));return;}
  pending=null;hide();
  // Do not add an await, Promise.then, RPC read or native confirm before this
  // callback: the wallet must be called in the button's original click stack.
  try{Promise.resolve(job.onConfirm()).then(job.resolve,job.reject);}catch(error){job.reject(error);}
 };
 cancelButton.onclick=()=>cancel();hide();return {open,cancel};
}
