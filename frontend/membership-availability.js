// Mirrors deposit gates; never changes settlement or sends a transaction.
export function membershipBlock(state){
 if(!state)return 'Contract data is unavailable. Refresh before adding units.';
 if(state.binaryRecoveryFrozen)return 'Membership is frozen by governance. Adding units is unavailable.';
 if(state.paused)return 'Membership is paused. Adding units is unavailable.';
 if(Number(state.phase)!==0||Number(state.monthPhase)!==0)return 'Settlement is in progress. Wait for completion and refresh before adding units.';
 if(!Number.isFinite(Number(state.timestamp))||!Number.isFinite(Number(state.epochEnd)))return 'Contract timing is unavailable. Refresh before adding units.';
 if(Number(state.timestamp)>=Number(state.epochEnd))return 'The hourly period has ended and settlement is overdue. The operator must complete settlement and check the Keeper before units can be added. No membership transaction has been sent.';
 return '';
}
export function walletError(error){
 const seen=new Set(),messages=[];let rejected=false;
 function visit(value,depth=0){
  if(!value||typeof value!=='object'||seen.has(value)||depth>6)return;
  seen.add(value);if(value.code===4001||value.code==='ACTION_REJECTED')rejected=true;
  for(const key of ['error','info','data','cause','originalError'])visit(value[key],depth+1);
  for(const key of ['reason','message','shortMessage'])if(typeof value[key]==='string'){
   const msg=value[key];if(!/could not coalesce|unknown error|missing revert data/i.test(msg))messages.push(msg);
  }
 }
 visit(error);
 if(rejected)return 'Request cancelled in your wallet.';
 // Avoid displaying transport URLs, access tokens or full transaction payloads.
 const detail=(messages[0]||'Wallet or RPC request failed. Check the wallet activity before retrying.').replace(/https?:\/\/[^\s"'<>]+/g,'[RPC]').split(/\s*\((?:error|payload|action)=/)[0];
 return detail.slice(0,400);
}
