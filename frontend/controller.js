import {purchaseError} from './purchase-error.js';
import {requireCollateralBalance} from './collateral-balance.js';
import {recoverPending} from './recover-pending.js';
import {transactionHashView} from './transaction-hash.js';
import {walletReview} from './wallet-review.js';
import {prepareUnknownCancellation,submitUnknownCancellation} from './prepared-cancellation.js';
import {readMembershipSnapshot} from './membership-snapshot.js';
import {readWalletIdentity,preparationDeadline} from './wallet-preflight.js';
import {readJson,initializeReadSession} from './read-json.js';
import {transactionState,confirmedReceipt,resolvePending,submitTracked,reconcileUnknown,prepareContractRequest,preparedWalletSend} from './transaction-state.js';
import {membershipBlock,walletError} from './membership-availability.js';
import {deploymentConfiguration} from './deployment.js';
import {deploymentNetwork} from '../core/deployment-network.mjs';
import {settledPoints} from './settled-points.js';
import {initLiveMarket} from './live-market.js';
import {initNetworkTree} from './network-tree.js';
import {t,language,displayNumber,displayUTC,withLanguage} from './locale.js';
import {readBuilderMode,builderMonthState,autoPercent} from './builder-view.js';
import {chooseWallet,requestWalletAccounts} from './wallet-selector.js';
import {JsonRpcProvider,BrowserProvider,Contract,FetchRequest,parseEther,formatEther,ZeroAddress,ZeroHash,randomBytes,hexlify,isAddress} from '/vendor/ethers.js';
import {disconnectSession} from './wallet-session.js';
import {siteLinks} from './site-links.js';
const sites=siteLinks(location.href);
import {surface,surfacePages,defaultPage,pagePath} from './surfaces.js';
const $=s=>document.querySelector(s);
const text=(id,value)=>{document.getElementById(id).textContent=t(value);};
const json=readJson;
const cfg=await deploymentConfiguration();
const networkProfile=deploymentNetwork(cfg);
$('#faucet').hidden=!networkProfile.testAssets;
const reserveModel=cfg.tokenContract==='FTIReserveToken';const v3Model=['FTIReserveTokenV3','FTIReserveTokenUpgradeable'].includes(cfg.tokenContract);
const fundedModel=['FundedBinaryPlan','FundedBinaryPlanUpgradeable'].includes(cfg.binaryContract);
let builderMode='unknown',selectableAuto=false;
const automaticReferral=cfg.referralPlacementEnabled===true;
$('#funded-policy').hidden=!fundedModel;
$('#direct-referral-count-row').hidden=!automaticReferral;
$('#point-values-panel').hidden=cfg.tokenContract!=='FTIReserveTokenUpgradeable';
if(reserveModel){
 text('token-price-label','Gross reserve value per FTI');text('token-model-title','Real-reserve pricing');text('token-model-ratio-label','Pricing model');text('token-model-ratio','Reserve / total shares');
 text('token-reserve-description','Recorded test USD backing');text('token-model-description','The 3% buy and sell fees remain in the real reserve. Positive trades and transfer burns increase the exact reserve/share value. There is no timed yield. The first paid allocation backs permanently locked shares; direct USD donations do not change quotes.');
 text('token-sale-description','Redeem unlocked FTI against recorded reserves. A 3% fee stays in reserve; check the net quote. A rising gross price does not guarantee profit or the value of the collateral.');
 $('#token-anchor-row').hidden=false;
}

if(v3Model){
 for(const id of ['legacy-locks','locked-ftis','legacy-floor-fund','legacy-token-floor'])$('#'+id).hidden=true;
 text('buy-policy',cfg.tokenContract==='FTIReserveTokenUpgradeable'?'Sequential $500 steps use updated reserve/supply prices. 3% fee per step; up to 128 steps per transaction. Membership and cycle allowances apply.':'Membership and rank purchase limits apply. V3 has no time or wallet-count locks.');
 text('sell-policy','3% fee. Gross sales up to $500 and final full-supply exits are exempt from ordinary sale limits. Minimum output and deadline always apply.');
 text('availability-policy','V3 tokens have no time or wallet-count locks. Pauses, emergency state and sale limits still apply.');
 text('token-price-label','Reserve / FTI');text('token-model-ratio-label','Pricing model');text('token-model-ratio','Reserve / supply · $0.10 first cycle, $0.20 restarts');
 text('token-model-description','No premint or time locks. Ordinary trade fees stay in reserve. Support is used only on a price drop, with the minimum available injection. Final-exit fees and remaining support go to development. Each new cycle starts with a $0.20 bootstrap quote.');
 text('token-sale-description','Reserve/share quotes, 3% fee. Sales above $500 retain 5% single-sale and 20% hourly limits; final full-supply exit is exempt. Transfers burn 3%. Support may be exhausted and does not guarantee a price floor.');
 text('point-policy',cfg.tokenContract==='FTIReserveTokenUpgradeable'?'Rewards use funded credits from your own branches. Every paid point has at least $20 gross funding. Protection increases below $16 calculated before the payout filter.':'Rewards use funded credits from your own branches. $20 per point is the protection target, not a reward ceiling or an unfunded guarantee. Protection adjusts hourly point caps when funding falls below that target.');
 text('transfer-title','Transfer FTI');text('transfer-description','The amount entered is your total debit: the recipient receives 97% and 3% is burned. The burn rounds up to the smallest FTI unit. Recipients do not need membership.');
 $('#transfer-quote').hidden=false;
 text('governance-title','5-of-7 governance');text('governance-description',cfg.timelock?'Five guardians approve proposals. Ordinary operations pass through a 72-hour timelock; emergency pause and redemption require five approvals.':'Legacy V3 configuration: ordinary governance is not timelocked. A new integrated deployment is required.');
 $('#timelock-form').hidden=!cfg.timelock;$('#timelock-heading').hidden=!cfg.timelock;
 const select=$('#proposal-form').elements.action;for(const option of [...select.options])if(option.value==='milestone'||(!cfg.timelock&&!['pauseBinary','pauseToken'].includes(option.value)))option.remove();
 const option=document.createElement('option');option.value='emergencyUnwind';option.textContent=t('Permanent emergency pro-rata redemption');select.append(option);
 
}

const rpcTransport=new FetchRequest(location.origin+'/rpc');rpcTransport.timeout=12000;
const rpc=new JsonRpcProvider(rpcTransport,undefined,{cacheTimeout:-1,batchMaxCount:1});rpc.pollingInterval=1000;
const names={binary:cfg.binaryContract||'BinaryPlan',token:cfg.tokenContract||'FTIToken',usd:networkProfile.testAssets?'MockUSD':'Collateral',council:v3Model?'SevenGuardianCouncil':'Council',...(cfg.timelock?{timelock:'FTITimelock'}:{})},read={};
await Promise.all(Object.entries(names).map(async([key,name])=>{read[key]=new Contract(cfg[key],await json('/abi/'+name),rpc);}));
if(cfg.hourlyCapFlushVersion===1)document.getElementById('point-policy').textContent=t('Above-cap matched volume is flushed each hour; only the unmatched stronger-leg balance is saved when the capped points are fully funded. Within-cap volume deferred by the $20 funding floor remains. Flushed credit stays in the protected reserve.','تعادل بالاتر از سقف ساعتی فلش می‌شود؛ با تأمین کامل پوینت‌های مجاز، فقط اختلاف دست بزرگ ذخیره می‌شود. حجم داخل سقف که به علت کمبود پشتوانه ۲۰ پرداخت نشده، باقی می‌ماند. اعتبار فلش‌شده در ذخیره محافظت‌شده قرارداد می‌ماند.');
if(cfg.poolDistributionVersion===1){
 text('point-value-label',t('Hourly pool / eligible points · USD','استخر ساعتی ÷ پوینت‌های واجد شرایط · دلار'));
 text('point-policy',t('The entire hourly point pool is shared in proportion to eligible capped points. Above-cap matches flush; only unmatched stronger-leg volume remains. Only integer rounding carries to the next hour when points are eligible.','کل استخر ساعتی به نسبت پوینت‌های واجد شرایط پس از اعمال سقف تقسیم می‌شود. تعادل مازاد سقف می‌سوزد و فقط اختلاف دست بزرگ باقی می‌ماند. با وجود پوینت واجد شرایط، تنها اختلاف گردکردن به ساعت بعد می‌رود.'));
 text('point-protection-policy',t('Below $16, protection increases for the next hour; above $20 it eases one level. Protection changes rank point caps, never withholds eligible rewards. With no eligible points the pool carries forward.','زیر ۱۶ دلار، حفاظت برای ساعت بعد یک سطح بیشتر و بالای ۲۰ دلار یک سطح کمتر می‌شود. حفاظت سقف تعداد پوینت رنک را تغییر می‌دهد و مانع پرداخت سهم واجد شرایط نیست. اگر هیچ پوینت واجد شرایطی نباشد، کل استخر باقی می‌ماند.'));
 text('builder-pool-policy',t('Each rank pool includes its previous monthly remainder. Eligible ranks share equally, with the existing 20% per-wallet limit and one payment per rank. Unpaid funds and rounding remain available for later months.','مانده ماه قبل به صندوق همان رنک اضافه می‌شود. واجدین شرایط سهم برابر با سقف قبلی ۲۰٪ صندوق و یک‌بار پرداخت هر رنک دارند. مبلغ پرداخت‌نشده و گردکردن برای ماه‌های بعد قابل استفاده است.'));
 document.getElementById('wallet-credits-row').hidden=true;
}
initNetworkTree(read.binary,rpc,cfg.hourlyCapFlushVersion,cfg.poolDistributionVersion);
if(v3Model)initLiveMarket(read.token,rpc,cfg);
let activeTransaction;
let transactionStage='';
let signer,address,state,busy=false,connecting=false,transactionAddress,refreshSequence=0,autoDirty=false,councilOwner=false;
let lockOffset=0;
const ranks=['Member','Builder 1','Builder 2','Builder 3','Builder 4'].map(x=>t(x));
const thresholds=[100n,200n,500n,1000n];
const explorer=networkProfile.explorer;
const fmt=(value,digits=2)=>value===undefined?'—':displayNumber(Number(formatEther(value)),{maximumFractionDigits:digits});
const integer=value=>displayNumber(BigInt(value));
const utc=displayUTC;
const short=value=>value.slice(0,6)+'…'+value.slice(-4);
function status(message,error=false){text('status',message);$('#status').dataset.state=error?'error':'ready';$('#status').classList.toggle('error',error);}
const hashView=transactionHashView({document,clipboard:navigator.clipboard,translate:t,status,explorer});
const review=walletReview({document,translate:t});
const recoveryOptions={logAddresses:[cfg.usd,cfg.binary,cfg.token]};
function reason(error){return walletError(error);}
function wallet(){return address&&state?.wallet?.address?.toLowerCase()===address.toLowerCase()?state.wallet:null;}
function syncActions(){
 $('#unknown-send-form').querySelectorAll('button').forEach(button=>button.disabled=busy||!signer);
 $('#unknown-send-form').elements.hash.disabled=busy;
 const w=wallet();const enabled={holder:!!signer&&BigInt(w?.ftiBalance||0)>0n,council:!!signer&&councilOwner,wallet:!!signer,member:!!signer&&!!w?.exists,buyer:!!signer&&BigInt(w?.units||0)>0n,reward:!!signer&&BigInt(w?.claimable||0)>0n,unlocked:!!signer&&BigInt(w?.unlocked||0)>0n,auto:!!signer&&BigInt(w?.autoPending||0)>0n};
 $('#register-form').elements.units.disabled=busy||connecting;$('#register-form').elements.sponsor.disabled=busy||connecting||!!w?.exists;
 document.querySelectorAll('[data-write]').forEach(button=>{button.disabled=busy||button.dataset.executed==='true'||(button.dataset.requires&&!enabled[button.dataset.requires]);});
 if(cfg.batchedRewards)$('#reward-all').disabled=busy||!signer||!state||BigInt(state.rewardQueue||0)===0n||Number(state.phase)!==0||Number(state.monthPhase)!==0;
 const normal=state?.tokenStateVerified!==false&&!state?.tokenPaused&&!state?.emergencyUnwind;
 for(const id of ['buy-form','sell-form','transfer-form'])for(const button of $('#'+id).querySelectorAll('[data-write]'))button.disabled=button.disabled||!normal;
 const blocked=membershipBlock(state);
 if(blocked){$('#register-button').disabled=true;$('#approve-units-button').disabled=true;}
 let notice=$('#membership-availability');
 if(!notice){notice=document.createElement('p');notice.id='membership-availability';notice.setAttribute('role','status');$('#register-form').prepend(notice);$('#register-button').setAttribute('aria-describedby',notice.id);}
 notice.hidden=!blocked;notice.textContent=t(blocked);
 $('#language-select').disabled=busy||connecting;$('#connect').disabled=busy||connecting;$('#local-accounts').disabled=busy||connecting;
 $('#disconnect').hidden=!address;$('#disconnect').disabled=busy||connecting;
 $('#copy-address').disabled=!address;$('#copy-referral').disabled=!w?.exists;
 $('#max-sell').disabled=busy||!enabled.unlocked;
 $('#locks-prev').disabled=busy||lockOffset===0;$('#locks-next').disabled=busy||lockOffset+64>=Number(w?.lockCount||0);
 const autoForm=$('#auto-form');autoForm.elements.enabled.disabled=busy;autoForm.elements.percent.disabled=busy||!selectableAuto;autoForm.elements.price.disabled=busy||selectableAuto;const uncertain=builderMode==='unknown'||(selectableAuto&&w&&w.autoBuyPercent==null);
 for(const el of autoForm.elements)el.disabled=el.disabled||busy||uncertain;
 if(uncertain||state?.binaryRecoveryFrozen||Number(state?.phase)!==0)autoForm.querySelector('[data-write]').disabled=true;
 const month=builderMonthState(state,builderMode);
 $('#begin-month').disabled=busy||!signer||!month.canBegin;
 $('#process-month').disabled=busy||!signer||!month.canProcess;
}

function write(key){if(!signer||!address)throw Error('Connect your wallet first.');if(transactionAddress&&address!==transactionAddress)throw Error('Wallet changed. Please review the action and try again.');return read[key].connect(signer);}
async function checkCollateral(required){
 transactionStage='BALANCE';
 await requireCollateralBalance({rpc,token:read.usd,wallet:transactionAddress,chainId:cfg.chainId,required});
 if(address!==transactionAddress)throw Error('Wallet changed. Please review the action and try again.');
 transactionStage='VALIDATION';
}
async function refreshMembershipState(){
 const expectedAddress=address,expectedSigner=signer;
 const next=await preparationDeadline(readMembershipSnapshot({rpc,binary:read.binary,usd:read.usd,address:expectedAddress,chainId:cfg.chainId,recoveryFrozen:cfg.binaryContract==='FundedBinaryPlanUpgradeable'}),25000);
 if(address!==expectedAddress||signer!==expectedSigner)throw Error('Wallet changed. Try again.');
 refreshSequence++;
 state={...state,...next,tokenStateVerified:state?.tokenPaused!==undefined&&state?.emergencyUnwind!==undefined,wallet:{...(wallet()||{}),...next.wallet}};
 text('units',integer(next.wallet.units));text('account-units',integer(next.wallet.units));text('usd-balance',fmt(next.wallet.usdBalance));text('wallet-address',expectedAddress);
 text('membership-status',next.wallet.exists?'Registered member':'Not registered');text('registration-title',next.wallet.exists?'Add membership units':'Join the network');$('#register-form').elements.sponsor.disabled=next.wallet.exists;
 syncActions();
}
async function transaction(fn,{membership=false}={}){
 if(busy)return;if(!signer){status('Connect your wallet first.',true);return;}
 const originalAddress=address,originalSigner=signer;
 transactionStage='NETWORK';busy=true;transactionAddress=address;syncActions();status('Refreshing wallet data before your request…');
 try{if(cfg.mode!=='local')await readWalletIdentity(walletProvider,originalAddress,cfg.chainId);
 if(address!==originalAddress||signer!==originalSigner)return;
 let storage;try{storage=localStorage;}catch{}
 activeTransaction=transactionState(storage,cfg.chainId,address);
 hashView.restore(activeTransaction);
 const pendingHash=activeTransaction.read();
 if(pendingHash&&!pendingHash.startsWith('unknown:')&&explorer){$('#transaction-link').href=explorer+'/tx/'+pendingHash;$('#transaction-link').hidden=false;}
 if(pendingHash?.startsWith('unknown:')){
  status('Checking your previous request automatically…');
  const recovered=await recoverPending(activeTransaction,rpc,address,cfg.chainId,recoveryOptions).catch(()=>null);
  if(address!==originalAddress||signer!==originalSigner)return;
  if(recovered){hashView.show(recovered.hash,{pending:true});$('#unknown-send-form').hidden=true;await refresh();if(address!==originalAddress||signer!==originalSigner)return;status('Previous request resolved. Review your balances, then choose your next action.');return;}
 }
 transactionStage='PREVIOUS';const previous=await resolvePending(activeTransaction,rpc);
 if(address!==originalAddress||signer!==originalSigner)return;
 if(previous){status(Number(previous.status)===1?'Previous transaction confirmed. Refresh and review your balances before another request.':'Transaction reverted on-chain.',Number(previous.status)!==1);await refresh().catch(()=>{});return;}
 transactionStage='BALANCE';await (membership?refreshMembershipState():refresh());transactionStage='VALIDATION';if(address!==transactionAddress)throw Error('Wallet changed. Try again.');status('Review the request in your wallet.');const outcome=await fn();
 if(address!==originalAddress||signer!==originalSigner)return;
 try{await refresh();}catch{if(address===originalAddress&&signer===originalSigner)status('Transaction confirmed on-chain. Balance refresh failed; refresh the page before another request.');return;}
 if(address!==originalAddress||signer!==originalSigner)return;
 status(typeof outcome==='string'?outcome:'Transaction confirmed on-chain.');}
 catch(error){if(address!==originalAddress||signer!==originalSigner)return;const pending=activeTransaction?.read();$('#unknown-send-form').hidden=!pending?.startsWith('unknown:');status(pending?.startsWith('unknown:')?'Send result is unknown. Inspect wallet activity and verify its transaction hash before continuing.':pending?'Transaction confirmation is pending. Check wallet activity before retrying.':purchaseError(transactionStage,error),true);}
 finally{busy=false;transactionStage='';transactionAddress=null;activeTransaction=null;syncActions();}
}
async function send(request){
 const originalAddress=transactionAddress,originalSigner=signer,tracker=activeTransaction;
 transactionStage='NONCE';const nonce=Number(await rpc.send('eth_getTransactionCount',[originalAddress,'pending']));
 if(address!==originalAddress||signer!==originalSigner)throw Error('Wallet changed. Try again.');
 transactionStage='SIGN';hashView.hide();const tx=await submitTracked(request,tracker,nonce);
 if(address===originalAddress&&signer===originalSigner){hashView.show(tx.hash,{pending:true});status('Transaction submitted. Waiting for confirmation… '+short(tx.hash));}
 const receipt=await confirmedReceipt(tx,tracker);
 if(address===originalAddress&&signer===originalSigner&&/^0x[0-9a-f]{64}$/i.test(receipt.hash||''))hashView.show(receipt.hash,{pending:true});
 return receipt;
}
async function sendContract(key,method,...args){
 transactionStage='GAS';const activeSigner=signer,expectedAddress=address;
 status('Checking the purchase before opening your wallet…');
 let request;
 try{request=await prepareContractRequest(read[key][method],args,activeSigner,rpc);}
 catch(error){throw Error(t('Preflight failed. No request was sent to your wallet.','بررسی اولیه انجام نشد؛ درخواستی برای امضا به ولت ارسال نشده است.')+' '+reason(error));}
 // Wallet changes during read-only preparation must not create a pending record.
 if(signer!==activeSigner||address!==expectedAddress||address!==transactionAddress)throw Error('Wallet changed. Please review the action and try again.');
 status('Review the request in your wallet.');
 const originalWallet=walletProvider,tracker=activeTransaction;
 const [,nonceHex,priceHex]=await Promise.all([
  readWalletIdentity(originalWallet,expectedAddress,cfg.chainId),
  rpc.send('eth_getTransactionCount',[expectedAddress,'pending']),rpc.send('eth_gasPrice',[])
 ]);
 const nonce=Number(BigInt(nonceHex)),gasPrice=BigInt(priceHex);
 if(!Number.isSafeInteger(nonce)||nonce<0||gasPrice<=0n)throw Error('Transaction nonce or network fee is unavailable.');
 if(signer!==activeSigner||address!==expectedAddress||walletProvider!==originalWallet||tracker.read())throw Error('Wallet or transaction state changed. Prepare the action again.');
 const rpcRequest=rpc.getRpcTransaction({...request,from:expectedAddress,chainId:cfg.chainId,nonce,gasPrice,value:request.value||0n});
 if(!rpcRequest.data)rpcRequest.data='0x';
 const title=t(key==='usd'&&method==='approve'?'Approve USDT spending':key==='binary'&&['addUnits','register','registerWithPlacement'].includes(method)?'Buy membership units':'Review your transaction',key==='usd'&&method==='approve'?'تأیید اجازهٔ مصرف تتر':key==='binary'&&['addUnits','register','registerWithPlacement'].includes(method)?'خرید یونیت عضویت':'بررسی تراکنش');
 const units=key==='binary'&&['addUnits','register','registerWithPlacement'].includes(method)?BigInt(args.at(-1)):null;
 $('#wallet-review-description').textContent=units!==null?t('Membership units: ','تعداد یونیت: ')+integer(units)+' · '+integer(units*100n)+' USDT':key==='usd'&&method==='approve'?t('USDT spending allowance: ','مجوز مصرف تتر: ')+formatEther(args[1])+' USDT':t('Review the amount and recipient in your wallet before confirming.','مبلغ و گیرنده را پیش از تأیید در ولت بررسی کن.');
 const callback=preparedWalletSend(originalWallet,rpc,rpcRequest);
 transactionStage='SIGN';status(t('Request prepared. Tap Open confirmation in wallet below.','درخواست آماده شد؛ دکمهٔ «باز کردن تأیید در ولت» را بزن.'));
 const tx=await review.open({request:rpcRequest,title,isCurrent:()=>signer===activeSigner&&address===expectedAddress&&walletProvider===originalWallet&&!tracker.read(),onConfirm:()=>{hashView.hide();return submitTracked(callback,tracker,nonce);}});
 if(signer===activeSigner&&address===expectedAddress){hashView.show(tx.hash,{pending:true});status('Transaction submitted. Waiting for confirmation… '+short(tx.hash));}
 const receipt=await confirmedReceipt(tx,tracker);
 if(signer===activeSigner&&address===expectedAddress&&/^0x[0-9a-f]{64}$/i.test(receipt.hash||''))hashView.show(receipt.hash,{pending:true});
 return receipt;
}
$('#find-transaction-hash').onclick=async()=>{
 if(busy||!address||!signer)return;
 busy=true;syncActions();const originalAddress=address;
 const result=$('#hash-lookup-result');
 result.textContent=t('Looking for the previous transaction on the network…','در حال جست‌وجوی تراکنش قبلی در شبکه…');
 try{
  const tracker=transactionState(localStorage,cfg.chainId,originalAddress),pending=tracker.read();
  if(pending?.startsWith('unknown:')){
   const recovered=await recoverPending(tracker,rpc,originalAddress,cfg.chainId,recoveryOptions);
   if(address!==originalAddress)return;
   if(!recovered){hashView.hide();result.textContent=t('No confirmed hash was recovered. The request may still be pending, may not have been sent, or the RPC may lack its history. The previous request remains protected.','هش تأییدشدهٔ این درخواست پیدا نشد؛ ممکن است درخواست در انتظار باشد، ارسال نشده باشد یا RPC سابقه‌اش را نداشته باشد. قفل درخواست قبلی حفظ شده است.');return;}
   hashView.show(recovered.hash,{pending:true});$('#unknown-send-form').hidden=true;
   status(t('The previous hash was verified and is ready to copy. Review your units and balance before another purchase.','هش قبلی بررسی شد و برای کپی آماده است. پیش از خرید دوباره، یونیت‌ها و موجودی را بررسی کن.'));
   await refresh().catch(()=>{});
  }else{
   hashView.restore(tracker);
   result.textContent=pending||tracker.last()?t('The transaction hash is displayed above.','هش تراکنش در کادر بالا نمایش داده شده است.'):t('No transaction hash has been received from the wallet.','هنوز هیچ هش تراکنشی از ولت دریافت نشده است.');
  }
 }catch(error){if(address===originalAddress)result.textContent=t('Hash lookup could not be completed. The previous request is still protected.','جست‌وجوی هش کامل نشد؛ قفل درخواست قبلی حفظ شده است.')+' '+reason(error);}
 finally{busy=false;syncActions();}
};
$('#unknown-send-form').onsubmit=async e=>{
 e.preventDefault();if(busy||!address||!signer)return;busy=true;syncActions();const originalAddress=address,originalSigner=signer;
 try{
  if(cfg.mode!=='local'&&Number(await walletProvider.request({method:'eth_chainId'}))!==cfg.chainId)throw Error('Wallet network does not match this deployment.');
  if(address!==originalAddress||signer!==originalSigner)return;
  const tracker=transactionState(localStorage,cfg.chainId,originalAddress);
  const entered=e.target.elements.hash.value.trim(),pending=tracker.read();
  if(pending&&!pending.startsWith('unknown:')&&entered.toLowerCase()!==pending.toLowerCase())throw Error('Enter the pending transaction hash.');
  const receipt=pending?.startsWith('unknown:')?await reconcileUnknown(tracker,rpc,originalAddress,entered):await resolvePending(tracker,rpc);
  if(!receipt)throw Error('No pending transaction to verify.');
  if(address!==originalAddress||signer!==originalSigner)return;
  hashView.show(entered,{pending:true});$('#unknown-send-form').hidden=true;await refresh().catch(()=>{});
  if(address!==originalAddress||signer!==originalSigner)return;
  status(Number(receipt.status)===1?'Previous transaction confirmed. Refresh and review your balances before another request.':'Transaction reverted on-chain.',Number(receipt.status)!==1);
 }catch(error){if(address===originalAddress&&signer===originalSigner)status(reason(error),true);}finally{busy=false;syncActions();}
};
$('#cancel-unknown').onclick=async()=>{
 if(busy||!address||!signer)return;
 busy=true;syncActions();const originalAddress=address,originalSigner=signer,originalWallet=walletProvider;
 try{
  await readWalletIdentity(originalWallet,originalAddress,cfg.chainId);
  if(address!==originalAddress||signer!==originalSigner)return;
  const tracker=transactionState(localStorage,cfg.chainId,originalAddress);
  const prepared=await preparationDeadline(prepareUnknownCancellation(tracker,rpc,originalAddress,cfg.chainId),25000);
  if(address!==originalAddress||signer!==originalSigner||walletProvider!==originalWallet)return;
  $('#wallet-review-description').textContent=t('This sends zero BNB to your own wallet and pays only the network fee. It does not buy units.','این درخواست صفر BNB به ولت خودت می‌فرستد و فقط کارمزد شبکه دارد؛ خرید یونیت نیست.');
  status(t('Cancellation prepared. Tap Open confirmation in wallet below.','لغو درخواست آماده شد؛ دکمهٔ «باز کردن تأیید در ولت» را بزن.'));
  await review.open({request:prepared.request,title:t('Cancel previous request','لغو درخواست قبلی'),isCurrent:()=>address===originalAddress&&signer===originalSigner&&walletProvider===originalWallet&&tracker.read()===prepared.record,onConfirm:()=>submitUnknownCancellation(tracker,originalWallet,rpc,prepared,hash=>{if(address===originalAddress&&signer===originalSigner){hashView.show(hash,{pending:true});status(t('Cancellation submitted. Waiting for network confirmation.','لغو ارسال شد؛ در انتظار تأیید شبکه.'));}})});
  if(address!==originalAddress||signer!==originalSigner)return;
  $('#unknown-send-form').hidden=true;await refresh().catch(()=>{});
  if(address!==originalAddress||signer!==originalSigner)return;
  status(t('Previous nonce resolved. Review your units and balance, then approve USDT and buy units if still needed.','درخواست قبلی تعیین‌تکلیف شد. موجودی و یونیت‌ها را بررسی کن؛ سپس در صورت نیاز تأیید تتر و خرید را انجام بده.'));
 }catch(error){if(address===originalAddress&&signer===originalSigner)status(reason(error),true);}finally{busy=false;syncActions();}
};
async function approve(spender,amount){
 transactionStage='ALLOWANCE';const current=await read.usd.allowance(address,spender);
 if(current<amount){status(networkProfile.testAssets?'Approve test USD spending in your wallet.':'Approve collateral spending in your wallet.');if(current>0n)await sendContract('usd','approve',spender,0);await sendContract('usd','approve',spender,amount);}
}
let walletProvider,providerListeners,selectedWallet;
function clearWallet(){review.cancel();$('#unknown-send-form').hidden=true;hashView.hide();$('#unknown-send-form').elements.hash.value='';$('#hash-lookup-result').textContent='';signer=null;address=null;state=null;autoDirty=false;councilOwner=false;refreshSequence++;renderWallet();syncActions();text('connect-label','Connect wallet');}
function detachWallet(){if(providerListeners){walletProvider?.removeListener?.('accountsChanged',providerListeners.accounts);walletProvider?.removeListener?.('chainChanged',providerListeners.chain);walletProvider?.removeListener?.('disconnect',providerListeners.disconnect);}providerListeners=null;walletProvider=null;}
function observeWallet(provider){
 detachWallet();walletProvider=provider;
 const reset=()=>{try{sessionStorage.removeItem('fti-wallet-connected');}catch{}clearWallet();status('Wallet account changed. Connect to continue.');refresh().catch(e=>status(reason(e),true));};
 providerListeners={accounts:reset,chain:()=>location.reload(),disconnect:reset};
 provider.on?.('accountsChanged',providerListeners.accounts);provider.on?.('chainChanged',providerListeners.chain);provider.on?.('disconnect',providerListeners.disconnect);
}
async function connect({silent=false}={}){
 if(connecting||busy)return;if(signer&&address){status('Wallet already connected.');return;}connecting=true;syncActions();
 try{
  let nextSigner;
  if(cfg.mode==='local')nextSigner=await rpc.getSigner($('#local-accounts').value);
  else{
   const selected=await chooseWallet({silent,projectId:cfg.walletConnectProjectId,chainId:cfg.chainId});if(!selected)return;
   detachWallet();clearWallet();const injected=selected.provider;
   const accounts=await requestWalletAccounts(selected,silent);if(!accounts.length)return;
   const chain=Number(await injected.request({method:'eth_chainId'}));
   if(chain!==cfg.chainId){if(silent)throw Error('Switch your wallet to '+networkProfile.name+' and connect again.');try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x'+cfg.chainId.toString(16)}]});}catch{throw Error('Switch your wallet to '+networkProfile.name+' (chain ID '+cfg.chainId+'), then connect again.');}}
   const provider=new BrowserProvider(injected);if(Number((await preparationDeadline(provider.getNetwork())).chainId)!==cfg.chainId)throw Error('Wallet network does not match this deployment.');nextSigner=await preparationDeadline(provider.getSigner());observeWallet(injected);selectedWallet=selected;
  }
  const nextAddress=await nextSigner.getAddress();if(address!==nextAddress){autoDirty=false;councilOwner=false;}signer=nextSigner;address=nextAddress;text('connect-label',short(address));try{sessionStorage.setItem(cfg.mode==='local'?'fti-local-account':'fti-wallet-connected',cfg.mode==='local'?address:'yes');}catch{}
  let saved;try{saved=transactionState(localStorage,cfg.chainId,nextAddress);}catch{}
  hashView.restore(saved);$('#unknown-send-form').hidden=!saved?.read()?.startsWith('unknown:');
  let membershipOnly=false;
  try{await refresh();}catch{await refreshMembershipState();membershipOnly=true;}
  if(saved?.read()?.startsWith('unknown:')){
   status('Checking your previous request automatically…');
   const recovered=await recoverPending(saved,rpc,nextAddress,cfg.chainId,recoveryOptions).catch(()=>null);
   if(address!==nextAddress)return;
   $('#unknown-send-form').hidden=!!recovered;
   if(recovered){hashView.show(recovered.hash,{pending:true});await refresh();status('Previous request resolved. Review your balances, then choose your next action.');}
   else status('Previous request could not be verified automatically. Check wallet activity.',true);
  }else status(membershipOnly?t('Wallet connected. Membership data is ready; some dashboard data is unavailable.','ولت متصل شد و اطلاعات عضویت آماده است؛ بخشی از اطلاعات داشبورد در دسترس نیست.'):'Wallet connected. Contract data loaded.');
 }catch(error){status(purchaseError('CONNECT',error),true);}finally{connecting=false;syncActions();}
}
$('#connect').onclick=()=>connect();
$('#disconnect').onclick=async()=>{
 if(busy||connecting)return;
 connecting=true;const selected=selectedWallet;selectedWallet=null;
 detachWallet();clearWallet();
 let storage;try{storage=sessionStorage;}catch{}
 const remoteClosed=await disconnectSession(selected,storage);
 connecting=false;syncActions();
 status(remoteClosed?'Wallet disconnected.':'Disconnected from this site. Close the WalletConnect session in your wallet.',!remoteClosed);
};


if(cfg.mode==='local'){
 $('#local-accounts').hidden=false;$('#dev-controls').hidden=false;
 cfg.accounts.forEach((a,i)=>{const option=document.createElement('option');option.value=a;option.textContent=`${i+1}. ${i<31?'Genesis':i<36?'Council':'New member'} ${short(a)}`;$('#local-accounts').append(option);});
 try{const saved=sessionStorage.getItem('fti-local-account');if(cfg.accounts.includes(saved))$('#local-accounts').value=saved;}catch{}
 $('#local-accounts').onchange=connect;
}
const network=networkProfile.label;text('global-network',network);text('network-name',network);text('account-network',network);text('token-network',network);
const titles={'token-home':'FTI token',overview:'Overview',network:'Membership & network',trade:'Buy & sell FTI',rewards:'Your rewards',activity:'Protocol activity',admin:'Governance & settlement'};
function navigate(page,focus=false){
 if(!titles[page])page=defaultPage;
 if(!surfacePages.some(([id])=>id===page)){location.assign(withLanguage(pagePath(page)));return;}document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==page);
 document.querySelectorAll('[data-page]').forEach(button=>{const active=button.dataset.page===page;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 text('page-title',t(titles[page]));document.title=t(titles[page])+' · FTI Protocol';
 if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);
 if(focus){$('#page-title').focus({preventScroll:true});$('#main').scrollIntoView({behavior:'instant'});}
 if(page==='activity')loadEvents();if(page==='admin')loadProposals();
 if(page==='network'&&new URLSearchParams(location.search).get('view')==='tree')requestAnimationFrame(()=>$('#network-explorer')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
document.querySelectorAll('[data-page],[data-go]').forEach(button=>button.onclick=()=>navigate(button.dataset.page||button.dataset.go,true));
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
async function refresh(){
 const sequence=++refreshSequence,requestedAddress=address;
 const [d,isOwner]=await Promise.all([json('/api/state'+(requestedAddress?'?wallet='+encodeURIComponent(requestedAddress):'')),requestedAddress&&surface==='admin'?(v3Model?read.council.isGuardian(requestedAddress):read.council.isOwner(requestedAddress)):Promise.resolve(false)]);
 if(requestedAddress&&cfg.lockVersion===2){if(state?.wallet?.address!==requestedAddress||lockOffset>=Number(d.wallet.lockCount))lockOffset=0;if(lockOffset>0){const page=await json('/api/locks?wallet='+requestedAddress+'&offset='+lockOffset);d.wallet.locks=page.locks;d.wallet.lockCount=page.total;}}
 let checkedMode='unknown';
 try{
  checkedMode=await readBuilderMode(read.binary,Number(d.block));
  d.lastClosedAt=String(await read.binary.lastClosedAt({blockTag:Number(d.block)}));
  if(checkedMode==='selectable'&&requestedAddress){
   try{d.wallet.autoBuyPercent=autoPercent(String(await read.binary.autoBuyPercent(requestedAddress,{blockTag:Number(d.block)})));}
   catch{d.wallet.autoBuyPercent=null;}
  }
 }catch{d.lastClosedAt=null;}
 if(sequence!==refreshSequence||requestedAddress!==address)return;
 builderMode=checkedMode;selectableAuto=builderMode==='selectable';
 $('#auto-percent-control').hidden=!selectableAuto;$('#auto-price-control').hidden=selectableAuto||builderMode==='unknown';
 const note=$('#auto-capability');note.dataset.state=builderMode;
 note.textContent=t(builderMode==='selectable'?'Installed contract: selectable hourly auto-buy.':builderMode==='legacy'?'Installed contract: legacy 5% auto-buy with a maximum-price setting.':'Contract capabilities could not be verified. Auto-buy changes are disabled.');
 text('auto-policy',selectableAuto?'Choose 5–100% of your eligible hourly binary income for FTI purchases at the current price. Monthly Builder funds are not used. Existing pending funds are unchanged; purchase allowance and fees still apply.':builderMode==='legacy'?'When enabled, 5% of eligible hourly rewards is reserved for FTI purchases. Set the highest price you are willing to pay.':'Checking installed contract capabilities…');
 state=d;councilOwner=isOwner;if(cfg.batchedRewards)text('reward-queue',integer(d.rewardQueue||0)+' wallets awaiting cash payout');if(reserveModel)text('token-anchor',fmt(d.anchorSupply,6));
 if(fundedModel){text('point-retained',fmt(d.pointRetained));text('builder-retained',fmt(d.builderRetained));}
 const month=builderMonthState(d,builderMode);
 const monthLabels={'unknown':'Monthly status is unavailable; no date or readiness is assumed.','waiting-month':'Waiting for the next Gregorian month boundary.','waiting-hour':'Month boundary reached; hourly settlement must finish first.','ready':'Ready for monthly processing. A transaction is still required.','processing':'Monthly processing is in progress.'};
 const monthText=(month.boundary?t('Monthly settlement boundary: ')+utc(month.boundary)+' · ':'')+t(monthLabels[month.kind]);
 for(const id of ['builder-month-schedule','member-month-schedule'])document.getElementById(id).textContent=monthText;
 $('#begin-month').textContent=t(month.kind!=='ready'&&builderMode==='selectable'?'Request close at next month boundary':'Close month');

 for(const[id,value]of Object.entries({'token-spot':fmt(d.price,6),'token-reserve':fmt(d.reserve),'token-supply':fmt(d.supply),'token-bb':fmt(d.bb),'token-floor':fmt(d.floor),'token-status':d.emergencyUnwind?'Emergency redemption':d.tokenPaused?'Paused':'Active',price:fmt(d.price,6),reserve:fmt(d.reserve),reserve2:fmt(d.reserve),members:integer(d.count),'point-pool':fmt(d.pointPool),buyback:fmt(d.bb),floor:fmt(d.floor),supply:fmt(d.supply),epoch:'Epoch '+integer(d.epoch),phase:['Accepting deposits','Matching points','Allocating rewards'][d.phase]||'Processing',protection:integer(d.level),'epoch-end':utc(d.epochEnd),accounting:d.account1[0]===d.account1[1]&&d.account2[0]===d.account2[1]?'Balanced':'Review required',queue:`Volume queue: ${d.jobCursor} / ${d.jobCount}\nSettlement phase: ${d.phase} · Member cursor: ${d.cursor}`,'lock-clock':v3Model?'No time locks':'Wallet counter '+integer(d.clock),'updated-at':'Updated '+new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}))text(id,value);
 if(v3Model){text('cycle-display',integer(d.cycle));text('ath-display',fmt(d.ath,6)+' USD');text('bootstrap-display',fmt(d.cycleStartPrice,2)+' USD');text('builder-multiplier',integer(d.builderMultiplier)+'×');}
 $('#emergency-panel').hidden=!v3Model||!d.emergencyUnwind||!['member','token'].includes(surface);
 renderWallet();syncActions();
}
function renderWallet(){
 text('admin-role',!address?'READ ONLY':councilOwner?'COUNCIL OWNER':'PUBLIC CALLER');text('admin-access-copy',!address?'Connect a wallet to check its council role.':councilOwner?t('Your connected wallet can propose and approve council actions.')+' '+t(v3Model?'Five of seven guardian approvals are required.':'Three approvals are required to execute a proposal.')+'':'This wallet is not a council owner. You can process settlement and execute operations that are already authorized and ready.');
 const w=wallet();const locked=w?BigInt(w.ftiBalance)-BigInt(w.unlocked):0n;
 if(fundedModel)text('wallet-credits',w?fmt(w.creditL)+' / '+fmt(w.creditR):'—');
 const count=Number(w?.lockCount||0);$('#lock-pagination').hidden=cfg.lockVersion!==2||count<=64;$('#locks-prev').disabled=busy||lockOffset===0;$('#locks-next').disabled=busy||lockOffset+64>=count;text('lock-page-label',count?`${lockOffset+1}–${Math.min(lockOffset+64,count)} of ${count}`:'No active locks');
 for(const[id,value]of Object.entries({claimable:w?fmt(w.claimable):'—','reward-claimable':w?fmt(w.claimable):'—',rank:w?.exists?ranks[w.rank]:address?'Not registered':'Not connected','wallet-address':address||'No wallet connected','usd-balance':w?fmt(w.usdBalance):'—','fti-balance':w?fmt(w.ftiBalance,5):'—',unlocked:w?fmt(w.unlocked,5):'—',allowance:w?fmt(w.remaining):'—',units:w?integer(w.units):'—','account-units':w?integer(w.units):'—',lifetime:w?`${integer(w.lifetimeL)} / ${integer(w.lifetimeR)}`:'—',carry:w?`${integer(w.carryL)} / ${integer(w.carryR)}`:'—','auto-pending':w?fmt(w.autoPending):'—','trade-balance':w?fmt(w.ftiBalance,5):'—','trade-unlocked':w?fmt(w.unlocked,5):'—','trade-locked':w?fmt(locked,5):'—','locked-summary':w?fmt(locked,5)+' FTI locked':'Connect to view token locks','buy-available':w?`Balance: ${fmt(w.usdBalance)} USD · Allowance: ${fmt(w.remaining)} USD`:'Connect to view your balance and allowance.','sell-available':w?'Available: '+fmt(w.unlocked,6)+' FTI':'Available: — FTI','membership-status':w?.exists?'Registered member':address?'Not registered':'Not connected','auto-status':w?.exists?(w.autoEnabled?'Enabled':'Disabled'):'Not connected'}))text(id,value);
 text('welcome-copy',w?.exists?'Your membership, tokens and rewards — connected to your wallet and read directly from the chain.':networkProfile.testAssets?'Connect a wallet, get test assets and register with a sponsor to begin.':'Connect your wallet to see your balances, manage membership and trade FTI.');
 const matched=w?(BigInt(w.lifetimeL)<BigInt(w.lifetimeR)?BigInt(w.lifetimeL):BigInt(w.lifetimeR)):0n;
 const next=thresholds[w?.rank||0];const previous=Number(w?.rank)>0?thresholds[Number(w.rank)-1]:0n;
 $('#rank-progress').value=w?.exists?(next?Math.max(0,Math.min(100,Number((matched-previous)*100n/(next-previous)))):100):0;
 text('rank-description',w?.exists?(next?'Progress is based on your weaker lifetime branch.':'You have reached the highest current rank.'):'Register with a sponsor to start your membership.');
 text('rank-points',w?.exists?integer(matched)+' lifetime points':'— lifetime points');text('rank-next',w?.exists?(next?'Next: '+integer(next):'Top rank'):'—');
 text('trade-notice',!address?'Connect a registered wallet to trade.':!w?.exists?'Register your wallet in Membership before buying FTI.':BigInt(w?.units||0)===0n?'Add at least one membership unit before buying FTI.':state?.tokenPaused?'Token trading is currently paused by the contract.':BigInt(w?.ftiBalance||0)>0n&&BigInt(w?.unlocked||0)===0n?'Your FTI is locked. Selling becomes available when a tranche reaches its wallet threshold or UTC deadline below.':'Buy, sell or transfer through your wallet. Every transaction requires your approval.');
 const registered=!!w?.exists;const form=$('#register-form');form.elements.sponsor.disabled=registered;
 if(cfg.tokenContract==='FTIReserveTokenUpgradeable'){const points=settledPoints(state);text('raw-point-value',points.raw===null?'—':fmt(points.raw));text('paid-point-value',points.paid===null?'—':fmt(points.paid));text('paid-point-count',points.count===null?'—':integer(points.count));}
 if(automaticReferral)text('direct-referrals',w?.exists?integer(w.directReferrals||0):'—');
 text('registration-title',registered?'Add membership units':'Join the network');$('#register-button').textContent=t('2. Buy units','۲. خرید یونیت');
 text('sponsor-help',registered?'Your inviter and position stay unchanged when you add units.':automaticReferral?t('One inviter can share unlimited direct invitations. Your binary position is assigned automatically, level by level, left before right.','هر معرف می‌تواند لینک دعوت خود را بدون محدودیت تعداد معرفی مستقیم به اشتراک بگذارد. جایگاه شما به‌صورت خودکار، سطح‌به‌سطح و از چپ به راست، زیر شبکهٔ معرف انتخاب می‌شود.'):'New positions fill the sponsor’s left slot first, then the right. Both slots must not be full.');
 for(const[id,done]of [['step-wallet',!!signer],['step-funds',BigInt(w?.usdBalance||0)>0n],['step-member',registered]])$('#'+id).classList.toggle('done',done);
 $('#referral-link').value=registered?withLanguage(sites.member+'?sponsor='+address+'#network'):'';
 $('#tree').replaceChildren();for(const[label,key]of (automaticReferral?[['Direct inviter','referrer'],['Binary parent','parent'],['Left branch','left'],['Right branch','right']]:[['Sponsor','parent'],['Left branch','left'],['Right branch','right']])){const node=document.createElement('div');node.textContent=t(label);const value=document.createElement('small');value.textContent=t(w&&w[key]!==ZeroAddress?w[key]:w?'Empty position':'Connect to view');node.append(value);$('#tree').append(node);}
 $('#locks').replaceChildren();
 if(w?.locks.length){for(const l of w.locks){const tr=document.createElement('tr');for(const value of [fmt(l.amount,6),integer(l.clock),utc(l.deadline),BigInt(state.clock)>=BigInt(l.clock)||state.timestamp>=Number(l.deadline)?'Unlocked':'Locked']){const td=document.createElement('td');td.textContent=t(value);tr.append(td);}$('#locks').append(tr);}}
 else{const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent=t(v3Model?'V3 does not create time or wallet-count lock tranches.':address?'No token lock tranches recorded.':'Connect a wallet to see its unlock schedule.');tr.append(td);$('#locks').append(tr);}
 if(w&&!autoDirty){$('#auto-form').elements.enabled.checked=w.autoEnabled;if(selectableAuto)$('#auto-form').elements.percent.value=w.autoBuyPercent==null?'':String(w.autoBuyPercent);else if(BigInt(w.maxAutoPrice)>0n)$('#auto-form').elements.price.value=formatEther(w.maxAutoPrice);}
}
$('#reward-all-panel').hidden=!cfg.batchedRewards;
$('#reward-all').onclick=()=>transaction(()=>send(()=>write('binary').payRewards(100)));
$('#refresh-state').onclick=async()=>{try{await refresh();status('Contract data refreshed.');}catch(e){status(reason(e),true);}};
for(const[id,step]of [['locks-prev',-64],['locks-next',64]])$('#'+id).onclick=async()=>{lockOffset=Math.max(0,lockOffset+step);try{await refresh();}catch(e){status(reason(e),true);}};
async function copy(value,input){try{await navigator.clipboard.writeText(value);status('Copied to clipboard.');}catch{if(input){input.focus();input.select();status('The link is selected. Copy it from the text field.');}else{const range=document.createRange();range.selectNodeContents($('#wallet-address'));getSelection().removeAllRanges();getSelection().addRange(range);status('The address is selected. Copy the selected text.');}}}
$('#copy-address').onclick=()=>copy(address);$('#copy-referral').onclick=()=>copy($('#referral-link').value,$('#referral-link'));
const sponsor=new URLSearchParams(location.search).get('sponsor');if(sponsor&&isAddress(sponsor))$('#register-form').elements.sponsor.value=sponsor;
$('#register-form').elements.units.oninput=()=>{const raw=$('#register-form').elements.units.value;text('registration-cost',/^\d+$/.test(raw)?integer(BigInt(raw)*100n)+' '+networkProfile.currency:'Enter whole units');};
for(const id of ['claim','claim-rewards'])$('#'+id).onclick=()=>transaction(()=>send(()=>write('binary').claim()));
$('#faucet').onclick=()=>{if(networkProfile.testAssets)transaction(()=>send(()=>write('usd').faucet()));};
$('#approve-units-button').onclick=()=>transaction(async()=>{
 const blocked=membershipBlock(state);if(blocked)throw Error(blocked);
 const raw=$('#register-form').elements.units.value.trim();
 if(!/^[1-9]\d*$/.test(raw))throw Error('Enter a positive whole number of units.');
 const amount=BigInt(raw)*parseEther('100');
 const w=wallet();if(!w)throw Error('Reload wallet data and try again.');
 await checkCollateral(amount);
 await approve(cfg.binary,amount);
 if(await read.usd.allowance(transactionAddress,cfg.binary)<amount)throw Error('Approval could not be verified. Refresh before continuing.');
 return t('USDT approved. Now press 2. Buy units. No units have been purchased in this step.','تتر تأیید شد. حالا دکمه «۲. خرید یونیت» را بزن. در این مرحله یونیتی خریداری نشده است.');
},{membership:true});
$('#register-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const blocked=membershipBlock(state);if(blocked)throw Error(blocked);const f=e.target,raw=f.elements.units.value.trim();if(!/^[1-9]\d*$/.test(raw))throw Error('Enter a positive whole number of units.');const n=BigInt(raw);if(n<1n)throw Error('Enter a positive whole number of units.');const w=wallet();if(!w)throw Error('Reload wallet data and try again.');const sponsorAddress=f.elements.sponsor.value.trim();if(!w.exists&&(!isAddress(sponsorAddress)||sponsorAddress===ZeroAddress))throw Error('Enter a valid sponsor address.');const cost=n*parseEther('100');await checkCollateral(cost);let placement;
 if(!w.exists&&automaticReferral){
  status(t('Finding the next free position in the inviter’s network…','در حال پیدا کردن نخستین جایگاه خالی زیر مجموعهٔ معرف…'));
  placement=await json('/api/placement?referrer='+encodeURIComponent(sponsorAddress));
  if(!isAddress(placement.placementParent)||placement.referrer.toLowerCase()!==sponsorAddress.toLowerCase())throw Error('Placement suggestion failed integrity checks.');
 }
 transactionStage='ALLOWANCE';if(await read.usd.allowance(transactionAddress,cfg.binary)<cost)throw Error(t('First press 1. Approve USDT for the selected number of units.','ابتدا برای تعداد یونیت انتخاب‌شده، دکمه «۱. تأیید تتر» را بزن.'));
 // Approval may cross an hourly boundary; refresh before requesting the purchase.
 transactionStage='BALANCE';await refreshMembershipState();transactionStage='VALIDATION';const blockedAfterApproval=membershipBlock(state);if(blockedAfterApproval)throw Error(blockedAfterApproval);
 const currentWallet=wallet();if(!currentWallet||currentWallet.exists!==w.exists)throw Error('Membership changed. Refresh and review before trying again.');
 await checkCollateral(cost);
 if(w.exists)await sendContract('binary','addUnits',n);
 else if(placement)await sendContract('binary','registerWithPlacement',sponsorAddress,placement.placementParent,n);
 else await sendContract('binary','register',sponsorAddress,n);},{membership:true});};
$('#auto-form').addEventListener('input',()=>{autoDirty=true;});
$('#auto-form').onsubmit=e=>{e.preventDefault();const enabled=e.target.elements.enabled.checked;
 if(builderMode==='unknown'){status(t('Contract capabilities could not be verified. Auto-buy changes are disabled.'),true);return;}
 if(selectableAuto){const percent=Number(e.target.elements.percent.value);if(!Number.isInteger(percent)||percent<5||percent>100){status(t('Choose a whole percentage from 5 to 100.','یک درصد صحیح بین ۵ تا ۱۰۰ انتخاب کنید.'),true);return;}transaction(async()=>{if(builderMode!=='selectable')throw Error('Contract capabilities could not be verified. Auto-buy changes are disabled.');await send(()=>write('binary').setAutoBuyPercent(enabled,percent));autoDirty=false;});}
 else {const price=e.target.elements.price.value;transaction(async()=>{if(builderMode!=='legacy')throw Error('Contract capabilities could not be verified. Auto-buy changes are disabled.');await send(()=>write('binary').setAutoBuy(enabled,parseEther(price)));autoDirty=false;});}
};
$('#execute-auto').onclick=()=>transaction(()=>{let amount=BigInt(wallet().autoPending);if(cfg.tokenContract==='FTIReserveTokenUpgradeable'&&amount>parseEther('64000'))amount=parseEther('64000');return send(()=>write('binary').executeAuto(address,amount));});
$('#release-auto').onclick=()=>transaction(()=>send(()=>write('binary').releaseAutoToCash()));
function amountInput(form){const amount=parseEther(form.elements.amount.value);const percent=Number(form.elements.slippage.value);if(amount<=0n||!Number.isFinite(percent)||percent<0||percent>5)throw Error('Enter a positive amount and slippage between 0% and 5%.');return[amount,BigInt(Math.round(percent*100))];}
for(const kind of ['buy','sell']){
 const form=$('#'+kind+'-form');let debounce,quoteSequence=0;
 const showQuote=()=>{clearTimeout(debounce);const sequence=++quoteSequence;text(kind+'-quote','Updating quote…');debounce=setTimeout(async()=>{try{const[a,slip]=amountInput(form);let output,fee;if(kind==='buy')output=await read.token.quoteBuy(a);else[output,fee]=await read.token.quoteSell(a);if(sequence!==quoteSequence)return;const minimum=output*(10000n-slip)/10000n;text(kind+'-quote',(kind==='buy'?'Estimated output: ':'Net proceeds: ')+fmt(output,6)+(kind==='buy'?' FTI':' '+networkProfile.currency)+'\nMinimum accepted: '+fmt(minimum,6)+(kind==='buy'?' FTI':' '+networkProfile.currency)+(kind==='buy'&&cfg.tokenContract==='FTIReserveTokenUpgradeable'?' · '+((a+parseEther('500')-1n)/parseEther('500')).toString()+' steps · updated price per step · 3% fee':'')+(fee!==undefined?(v3Model?' · Fee 3%':' · Fee '+Number(fee)/100+'%'):''));$('#'+kind+'-quote').classList.remove('invalid');}catch(error){if(sequence!==quoteSequence)return;text(kind+'-quote',form.elements.amount.value?'Quote unavailable. Check the amount or refresh contract data.':'Enter an amount for a live quote.');$('#'+kind+'-quote').classList.add('invalid');}},250);};
 form.elements.amount.oninput=showQuote;form.elements.slippage.oninput=showQuote;
 form.onsubmit=e=>{e.preventDefault();transaction(async()=>{const[a,slip]=amountInput(form),w=wallet();if(kind==='buy'&&(!w?.exists||BigInt(w.units)===0n))throw Error('Register or add membership units before trading.');if(state.tokenPaused||state.emergencyUnwind)throw Error('Token trading is paused by the contract.');const deadline=BigInt(state.timestamp)+1200n;
  if(kind==='buy'){if(cfg.tokenContract==='FTIReserveTokenUpgradeable'&&a>parseEther('64000'))throw Error('Buy up to 64,000 USD per transaction; repeat for a larger order.');await checkCollateral(a);if(a>BigInt(w.remaining))throw Error('Amount exceeds your remaining manual purchase allowance.');const quote=await read.token.quoteBuy(a);await approve(cfg.token,a);await send(()=>write('token').buy(a,quote*(10000n-slip)/10000n,deadline));}
  else{if(a>BigInt(w.unlocked))throw Error('Amount exceeds your unlocked balance. Check the unlock schedule.');const[q]=await read.token.quoteSell(a);await send(()=>write('token').sell(a,q*(10000n-slip)/10000n,deadline));}
 });};
}
$('#emergency-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{if(!v3Model||!state?.emergencyUnwind)throw Error('Emergency redemption is not active.');const amount=parseEther(e.target.elements.amount.value),minimum=parseEther(e.target.elements.minimum.value);if(amount<=0n||amount>BigInt(wallet()?.ftiBalance||0)||minimum<0n)throw Error('Enter an amount within your token balance.');await send(()=>write('token').emergencyRedeem(amount,minimum));});};
$('#max-sell').onclick=()=>{const form=$('#sell-form');form.elements.amount.value=formatEther(wallet().unlocked);form.elements.amount.dispatchEvent(new Event('input',{bubbles:true}));};
if(v3Model){
 const form=$('#transfer-form');let timer,sequence=0;
 form.elements.amount.oninput=()=>{clearTimeout(timer);const current=++sequence;text('transfer-quote','Updating transfer quote…');timer=setTimeout(async()=>{
  try{const amount=parseEther(form.elements.amount.value);if(amount<=0n)throw Error('Enter a positive amount.');const[received,burned]=await read.token.quoteTransfer(amount);if(current!==sequence)return;text('transfer-quote','Recipient receives: '+formatEther(received)+' FTI · Burned: '+formatEther(burned)+' FTI');}
  catch{if(current===sequence)text('transfer-quote',form.elements.amount.value?'Transfer quote unavailable. Check the amount and contract connection.':'Enter an amount to see the recipient amount and burn.');}
 },250);};
}
$('#transfer-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const to=e.target.elements.to.value.trim(),amount=parseEther(e.target.elements.amount.value);if(!isAddress(to)||to===ZeroAddress)throw Error('Enter a valid recipient address.');if(amount<=0n||amount>BigInt(wallet().unlocked))throw Error('Enter an amount within your unlocked token balance.');if(to.toLowerCase()===address.toLowerCase())throw Error('Choose a different recipient wallet.');if(!v3Model&&await read.binary.unitsOf(to)===0n)throw Error('The recipient must own at least one membership unit.');await send(()=>write('token').transfer(to,amount));});};
for(const[id,method,arg]of [['volume','processVolume',50],['close-epoch','beginEpochClose'],['process-epoch','processEpoch',50],['process-month','processBuilderMonth',50]])$('#'+id).onclick=()=>transaction(()=>send(()=>write('binary')[method](...(arg?[arg]:[]))));
document.querySelectorAll('[data-time]').forEach(button=>button.onclick=()=>transaction(async()=>{const response=await fetch('/api/dev/time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seconds:Number(button.dataset.time)})});if(!response.ok)throw Error((await response.json()).error);}));
let eventsLoading=false;
async function loadEvents(){
 if(eventsLoading)return;eventsLoading=true;$('#refresh-events').disabled=true;text('events','Loading recent on-chain events…');
 try{const rows=await json('/api/events');if(!Array.isArray(rows))throw Error('Events are unavailable.');$('#events').replaceChildren();if(!rows.length)text('events','No events in the recent block range.');
 for(const row of rows){const node=document.createElement('div');node.className='event';const title=document.createElement('strong');title.textContent=row.name+' · Block '+integer(row.block);const pre=document.createElement('pre');pre.textContent=row.args.map(arg=>arg.name+': '+arg.value).join('\n');node.append(title,pre);if(explorer){const link=document.createElement('a');link.href=explorer+'/tx/'+row.hash;link.target='_blank';link.rel='noreferrer';link.textContent='View transaction ↗';node.append(link);}$('#events').append(node);}}
 catch(error){text('events','Recent events could not be loaded. Your balances remain available. Use Refresh events to retry.');status(reason(error),true);}
 finally{eventsLoading=false;$('#refresh-events').disabled=false;}
}
$('#refresh-events').onclick=loadEvents;
for(const[key,name]of Object.entries(names)){const el=document.createElement('div');el.textContent=name;const code=document.createElement('code');code.textContent=cfg[key];if(explorer){const a=document.createElement('a');a.href=explorer+'/address/'+cfg[key];a.target='_blank';a.rel='noreferrer';a.append(code);el.append(a);}else el.append(code);$('#contracts').append(el);}
$('#begin-month').onclick=()=>transaction(async()=>{
 const readiness=builderMonthState(state,builderMode);if(!readiness.canBegin)throw Error('Monthly status is unavailable; no date or readiness is assumed.');
 const receipt=await send(()=>write('binary').beginBuilderMonth());
 const requested=receipt?.logs?.some(log=>{try{return read.binary.interface.parseLog(log)?.name==='BuilderMonthCloseRequested';}catch{return false;}});
 return requested?'Request recorded on-chain; no monthly funds have been paid by this request.':undefined;
});
async function loadProposals(){try{const count=Number(await (v3Model?read.council.proposalCount():read.council.count()));$('#proposals').replaceChildren();if(!count)text('proposals','No governance proposals yet.');for(let i=count-1;i>=Math.max(0,count-20);i--){const p=await read.council.proposal(i),box=document.createElement('div');box.className='proposal';const title=document.createElement('p');title.textContent=language==='fa'?`پیشنهاد ${i} · ${p[2]} از ${v3Model?5:3} تأیید · ${p[3]?'اجراشده':'در انتظار'}`:`${t('Proposal')} ${integer(i)} · ${integer(p[2])}/${integer(v3Model?5:3)} ${t('approvals')} · ${t(p[3]?'Executed':'Pending')}`;box.append(title);for(const[label,fn]of [['Approve',()=>write('council').approve(i)],['Execute proposal',()=>write('council').execute(i)]]){const button=document.createElement('button');button.className='secondary';button.textContent=t(label);button.dataset.write='';button.dataset.requires=label==='Approve'?'council':'wallet';button.dataset.executed=String(p[3]);button.onclick=()=>transaction(async()=>{await send(fn);await loadProposals();});box.append(button);}$('#proposals').append(box);}syncActions();}catch(error){text('proposals','Proposals could not be loaded. Reopen this section to retry.');status(reason(error),true);}}
$('#proposal-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const action=e.target.elements.action.value;let target,data;
 if(action==='emergencyUnwind'){target=cfg.token;data=read.token.interface.encodeFunctionData('activateEmergencyUnwind');}
 else if(action==='pauseBinary'||action==='pauseToken'){const key=action==='pauseBinary'?'binary':'token';target=cfg[key];data=read[key].interface.encodeFunctionData('pause');}
 else{const key=action==='unpauseBinary'?'binary':'token';const inner=read[key].interface.encodeFunctionData(action==='milestone'?'advancePriceMilestone':'unpause');target=cfg.timelock;data=read.timelock.interface.encodeFunctionData('schedule',[cfg[key],0,inner,ZeroHash,hexlify(randomBytes(32)),259200]);}
 await send(()=>write('council').propose(target,data));await loadProposals();});};
$('#timelock-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const p=await read.council.proposal(BigInt(e.target.elements.id.value));if(p[0].toLowerCase()!==cfg.timelock.toLowerCase()||!p[3])throw Error('The scheduling proposal has not been executed.');const args=read.timelock.interface.decodeFunctionData('schedule',p[1]);await send(()=>write('timelock').execute(args[0],args[1],args[2],args[3],args[4]));});};
text('token-address',cfg.token);$('#token-explorer').hidden=!explorer;if(explorer)$('#token-explorer').href=explorer+'/address/'+cfg.token;
renderWallet();syncActions();navigate(location.hash.slice(1)||((sponsor&&isAddress(sponsor))?'network':defaultPage));
try{if(cfg.mode==='local')await connect();else await initializeReadSession({refresh,ready:()=>status('Contract data loaded. Connect a wallet to manage your account.'),failed:error=>status(reason(error),true),reconnect:async()=>{let reconnect=false;try{reconnect=sessionStorage.getItem('fti-wallet-connected')==='yes';}catch{}if(reconnect)await connect({silent:true});}});}catch(error){status(reason(error),true);}
setInterval(()=>{if(!busy&&!connecting)refresh().catch(error=>status('Connection unavailable: '+reason(error),true));},15000);
