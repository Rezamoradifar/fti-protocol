export const isTransactionHash=value=>/^0x[0-9a-f]{64}$/i.test(value||'');

// Display only a returned or verified hash. An unknown request must never show
// an older approval as though it belonged to the current purchase.
export function transactionHashView({document,clipboard,translate,status,explorer}){
 const panel=document.getElementById('transaction-hash-panel');
 const field=document.getElementById('transaction-hash-value');
 const button=document.getElementById('copy-transaction-hash');
 const link=document.getElementById('transaction-link');
 let hash=null;
 function hide(){hash=null;field.value='';panel.hidden=true;button.disabled=true;link.hidden=true;link.removeAttribute('href');document.getElementById('unknown-send-form').elements.hash.value='';}
 function show(value,{pending=false}={}){
  if(!isTransactionHash(value))throw Error('Invalid transaction hash.');
  hash=value;field.value=value;panel.hidden=false;button.disabled=false;
  link.hidden=!explorer;if(explorer)link.href=explorer+'/tx/'+value;
  if(pending)document.getElementById('unknown-send-form').elements.hash.value=value;
 }
 function restore(tracker){
  const pending=tracker?.read();
  if(isTransactionHash(pending))show(pending,{pending:true});
  else if(pending)hide();
  else{const previous=tracker?.last?.();if(isTransactionHash(previous))show(previous);else hide();}
 }
 button.onclick=async()=>{
  if(!isTransactionHash(hash))return;
  const value=hash;
  try{await clipboard.writeText(value);if(hash!==value)return;status(translate('Transaction hash copied.','هش تراکنش کپی شد.'));}
  catch{if(hash!==value)return;field.focus();field.select();field.setSelectionRange?.(0,value.length);status(translate('The transaction hash is selected. Copy it from the field.','هش تراکنش انتخاب شد؛ آن را از کادر کپی کن.'));}
 };
 hide();return {show,hide,restore};
}
