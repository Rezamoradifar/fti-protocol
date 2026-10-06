import {JsonRpcProvider,BrowserProvider,Contract,parseEther,formatEther,ZeroAddress,ZeroHash,randomBytes,hexlify,isAddress} from '/vendor/ethers.js';
import {surface,defaultPage,createWorkspaceRouter} from './surfaces.js';
import {dataFreshness,settlementReadiness,actionAvailability,transactionStage,proposalAvailability,timelockPresentation} from './workspace-state.mjs';
import {ratio,formatRatio,exactFraction,deltaDecimals,readRatioSnapshot,confirmedTransactionDelta} from './exact-price.mjs';
import {autoBuyPresentation,autoPreferenceReadiness,validateAutoPreference,autoBuyPolicy} from './auto-buy-state.mjs';
import {bufferedTokenSellGas} from './token-gas.mjs';
const $=s=>document.querySelector(s);
const text=(id,value)=>{document.getElementById(id).textContent=value;};
async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(25000),cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to read contract data.');return data;}
// Navigation and safe disabled controls work before the first RPC/config response.
let controllerReady=false;
const navigate=createWorkspaceRouter({window,document,onNavigate:page=>{if(controllerReady){if(page==='activity')loadEvents();if(page==='admin')loadProposals();}}});
navigate(location.hash.slice(1)||new URLSearchParams(location.search).has('sponsor')&&'network'||defaultPage,{historyMode:'replace'});
document.querySelectorAll('[data-write]').forEach(button=>button.disabled=true);
const cfg=await json('/api/config');
const retirementModel=cfg.tokenContract==='FTIRetirementReviewToken';
const reserveModel=retirementModel||cfg.tokenContract==='FTIReserveToken';
const fundedModel=cfg.binaryContract==='FundedBinaryPlan';
$('#funded-policy').hidden=!fundedModel;
$('#retirement-policy').hidden=!retirementModel;
if(reserveModel){
 text('token-price-label','Gross reserve value per FTI');text('token-model-title','Real-reserve pricing');text('token-model-ratio-label','Pricing model');text('token-model-ratio','Reserve / total shares');
 text('token-reserve-description',retirementModel?'Redeemable test USD backing; excludes protected support and owed development fees':'Redeemable test USD backing; excludes the protected price-protection fund');text('token-model-description','Local size-fee review: manual and auto buys and ordinary sales have a 3% base fee. The threshold is the greater of $500 or 5% of pretrade live reserve; only value above it attracts the smooth surcharge. The 7% curve parameter remains provisional. Buy and partial-sale fees stay in live reserve. The zero-reserve/zero-supply bootstrap retains its base-only exception. '+reserveExitPolicy(retirementModel)+' Protected fund cash is excluded from the threshold, price and payouts. Positive transfers burn 3% of gross FTI. At zero supply the live ratio is undefined; the stored getter is shown separately as an initial or historical reference.');
 text('token-sale-description','Local review: ordinary partial sales with gross value at or below $500 have only the 3% base fee, rounded once to USD atoms. Above the larger of $500 or 5% of live reserve, the current trade alone attracts a smooth size surcharge using a provisional 7% parameter. No timer or trade history affects the fee. '+reserveExitPolicy(retirementModel)+' Protected fund cash is never redeemed by sellers. Your min-out is enforced on-chain. A rising internal price does not guarantee profit.');
 text('trade-buy-policy','Manual purchases consume gross binary-owned quota; auto-buys use the same fee curve without consuming manual quota. Ordinary value at or below $500 pays only the 3% base fee, rounded once to USD atoms. The smooth surcharge starts above the larger of $500 or 5% of pretrade live reserve. The 7% parameter remains provisional. Bootstrap at zero reserve/supply is base-only; all buy cash stays in live reserve.');
 text('trade-sell-policy','Local size-fee review: gross sale value is your tokens × live reserve / total supply, floored to USD atoms. The same 3% base and provisional 7% size curve apply; there is no global pressure or timer. '+reserveExitPolicy(retirementModel)+' Exact fee amounts and minimum proceeds are shown in the quote.');
 text('trade-availability-policy','V2 has no time-based token lock or size/hourly waiting cap. Sales use your available balance and on-chain minimum proceeds. A pause stops new buys and transfers; holder redemptions remain available, including fee-free emergency exits.');
 text('token-hold-description','V2 has no time or wallet-count vesting. Live quotes show exact fee amounts; only current trade size and live reserve affect the review-stage fee curve.');
 text('token-fund-label','Protected price-protection fund · USD');
 if(retirementModel){text('token-model-title','Owner-selected R / H model');text('token-fund-label','Protected inactive H · USD');text('retirement-rules','Buy fees remain in live R. The full Binary 5% token allocation enters R while supply is positive and protected H at zero supply. H stays inactive: no automatic support release, insurance or loss repair. Ordinary final sales pay net of the current-trade fee. That fee becomes a reserved development claim, paid separately to the immutable fund. Permanent retirement requires five-of-seven Council approval, a 72-hour delay, zero supply/backing/token claims and a quiescent bound binary with no pending auto funds. Only that permanent governed retirement can dispose of H to the same fixed development fund after these liability checks; untracked donations require separate delayed recovery. Binary cash claims remain owned by their beneficiaries. Ordinary zero supply is separate from permanent buy closure. Any permissionless pending-auto cash conversion requires the explicit permanent-buy-closure marker, a paused binary and idle hourly settlement. It preserves the beneficiary and sends no funds outside the binary.');}
 $('#proposal-form option[value="milestone"]').textContent='Sync builder-only price milestone capacity';
 $('#token-anchor-row').hidden=true;$('#token-source').href='https://github.com/Rezamoradifar/fti-protocol';$('#token-source').textContent='Repository (local experiment unpublished) ↗';
}

const rpc=new JsonRpcProvider(location.origin+'/rpc',undefined,{cacheTimeout:-1});rpc.pollingInterval=1000;
const names={binary:cfg.binaryContract||'BinaryPlan',token:cfg.tokenContract||'FTIToken',usd:'MockUSD',council:'Council',timelock:'FTITimelock'},read={};
await Promise.all(Object.entries(names).map(async([key,name])=>{read[key]=new Contract(cfg[key],await json('/abi/'+name),rpc);}));
let signer,address,state,busy=false,connecting=false,transactionAddress,refreshSequence=0,autoDirty=false,councilOwner=false;
let lockOffset=0,lastUpdated=0,readFailed=false,timelockReady=false,timelockSequence=0,proposalSequence=0;
let priceSnapshot=null,priceDecimals=0;
const quoteRefreshers=[];
const ranks=['Member','Builder 1','Builder 2','Builder 3','Builder 4'];
const thresholds=[100n,200n,500n,1000n];
const explorer=cfg.chainId===97?'https://testnet.bscscan.com':null;
const fmt=(value,digits=2)=>value===undefined?'—':Number(formatEther(value)).toLocaleString('en-US',{maximumFractionDigits:digits});
const integer=value=>BigInt(value).toLocaleString('en-US');
const utc=value=>new Date(Number(value)*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
const short=value=>value.slice(0,6)+'…'+value.slice(-4);
function status(message,error=false,stage=error?'error':'ready'){text('status',message);$('#status').classList.toggle('error',error);$('#status').dataset.state=stage;}
function freshness(){return dataFreshness(lastUpdated,Date.now(),readFailed);}
function renderCalculatedPrice(){
 $('.exact-price-notice').hidden=!reserveModel;if(!reserveModel)return;
 const stale=freshness().stale;
 const value=priceSnapshot?ratio(priceSnapshot.reserve,priceSnapshot.supply):null;
 const display=stale?'Unavailable':priceSnapshot?formatRatio(value,{minDecimals:priceDecimals}):'—';
 for(const id of ['token-price-label','overview-price-label'])text(id,priceSnapshot?.supply>0n?'Calculated reserve / supply · USD per FTI':'Live ratio undefined (zero supply)');
 for(const id of ['price','token-spot']){text(id,display);$('#'+id).title=value?exactFraction(value):'R / S is undefined when S = 0';}
 text('exact-price-details',stale?'Calculated price unavailable until a successful fresh contract read.':priceSnapshot?
  'Calculated reserve / supply at block '+priceSnapshot.blockNumber+': '+exactFraction(value)+'. '+(value?'Decimal expansion; … means truncated. ':'Live ratio is undefined; stored getter is an initial or historical reference only. ')+'On-chain 18-decimal getter (unchanged): '+formatEther(priceSnapshot.getter)+' USD / FTI. This calculated ratio is not a redemption quote.':'Waiting for a verified reserve / supply snapshot.');
}
function renderFreshness(){
 renderCalculatedPrice();
 const f=freshness();if(f.stale)for(const kind of ['buy','sell']){text(kind+'-quote','Quote unavailable: refresh contract data first.');$('#'+kind+'-form button[data-write]').dataset.quoteReady='false';}$('#stale-notice').hidden=!f.stale||!lastUpdated&&!readFailed;
 text('stale-notice',(readFailed?'Contract connection interrupted. ': 'Contract data is stale. ')+f.label+'. Values shown may be outdated; writes are disabled until a successful refresh. Use the refresh button to retry.');
 $('#wallet-state').textContent=connecting?'Connecting':address?'Wallet connected':'Read only';$('#disconnect').hidden=!address;$('#disconnect').disabled=busy||connecting;
}
function clearWallet(){
 signer=null;address=null;autoDirty=false;councilOwner=false;refreshSequence++;timelockReady=false;
 try{sessionStorage.removeItem('fti-wallet-connected');sessionStorage.removeItem('fti-local-account');}catch{}
 text('connect-label','Connect wallet');renderWallet();syncActions();quoteRefreshers.forEach(refresh=>refresh());if(surface==='admin')loadProposals();
}
$('#disconnect').onclick=()=>{clearWallet();status('Wallet disconnected from this workspace. Public contract data remains available.',false,'disconnected');};
function reason(error){if(error.code===4001||error.code==='ACTION_REJECTED')return 'Request cancelled in your wallet.';return error.reason||error.shortMessage||error.message||'The request could not be completed.';}
function wallet(){return address&&state?.wallet?.address?.toLowerCase()===address.toLowerCase()?state.wallet:null;}
function syncActions(){
 const w=wallet(),lifecycle=tokenLifecycle(state,retirementModel),fresh=!freshness().stale;
 const enabled=actionAvailability({data:state,wallet:w,connected:!!signer,councilOwner,fresh,lifecycle}),readiness=settlementReadiness(state);
 const autoReady=autoPreferenceReadiness({data:state,wallet:w,enabled:$('#auto-form').elements.enabled.checked,lifecycle});enabled.autoSettings=enabled.member&&autoReady.ready;
 text('auto-setting-help',autoReady.reason);$('#auto-form').elements.enabled.disabled=busy||state?.autoBuyPolicy!=='immediate-current-quote-v1';
 document.querySelectorAll('[data-write]').forEach(button=>{button.disabled=busy||connecting||!fresh||button.dataset.executed==='true'||button.dataset.blocked==='true'||(button.dataset.requires&&!enabled[button.dataset.requires]);});
 for(const[id,condition]of Object.entries(readiness)){const button=$('#'+id);button.disabled=button.disabled||!condition.ready;text(id+'-readiness',condition.reason);button.title=condition.reason;}
 for(const kind of ['buy','sell']){const button=$('#'+kind+'-form button[data-write]');button.disabled=button.disabled||button.dataset.quoteReady!=='true';}
 $('#execute-timelock').disabled=$('#execute-timelock').disabled||!timelockReady;
 renderFreshness();
 $('#connect').disabled=busy||connecting;$('#local-accounts').disabled=busy||connecting;
 $('#copy-address').disabled=!address;$('#copy-referral').disabled=!w?.exists||lifecycle.fundingBlocked;
 $('#max-sell').disabled=busy||!enabled.unlocked;
 $('#locks-prev').disabled=busy||lockOffset===0;$('#locks-next').disabled=busy||lockOffset+64>=Number(w?.lockCount||0);
}
function write(key){if(!signer||!address)throw Error('Connect your wallet first.');if(transactionAddress&&address!==transactionAddress)throw Error('Wallet changed. Please review the action and try again.');return read[key].connect(signer);}
async function transaction(fn,{localOnly=false}={}){
 if(busy||connecting)return;if(!signer){status('Connect your wallet first.',true);return;}
 busy=true;transactionAddress=address;syncActions();$('#transaction-link').hidden=true;status('Refreshing wallet data before your request…',false,'loading');
 try{await refresh();if(address!==transactionAddress)throw Error('Wallet changed. Try again.');status(localOnly?'Applying the local demo clock change…':'Review the request in your wallet.',false,localOnly?'loading':'awaiting-wallet');await fn();const completed=localOnly?'Local demo clock advanced.':'Transaction confirmed on-chain.';try{await refresh();status(completed,false,localOnly?'ready':'confirmed');}catch(error){status(completed+' The refreshed balance is unavailable; retry the contract read.',true,localOnly?'error':'confirmed');}}
 catch(error){status(reason(error),true,transactionStage(error));}
 finally{busy=false;transactionAddress=null;syncActions();}
}
async function send(promise){
 const tx=await promise;status('Transaction submitted. Waiting for confirmation… '+short(tx.hash),false,'pending');
 if(explorer){$('#transaction-link').href=explorer+'/tx/'+tx.hash;$('#transaction-link').hidden=false;}
 const receipt=await tx.wait();if(!receipt||receipt.status!==1)throw Error('Transaction was not confirmed successfully.');
 if(reserveModel){
  text('exact-price-delta','Confirmed transaction '+receipt.hash+': verifying calculated price change…');
  try{const result=await confirmedTransactionDelta(rpc,read.token,receipt);priceDecimals=deltaDecimals(result.delta);
   text('exact-price-delta','Transaction '+receipt.hash+' · calculated R / S change: '+formatRatio(result.delta,{sign:true})+' USD / FTI. '+(result.delta?'Exact difference: '+exactFraction(result.delta)+'. Verified isolated block '+receipt.blockNumber+'.':'No live-to-live delta: zero supply at an endpoint. Initial and historical references are not live ratios.'));
  }catch{ text('exact-price-delta','Transaction '+receipt.hash+' confirmed. Its calculated price change is unavailable: isolated, hash-verified pre/post snapshots could not be established. No change is inferred from refreshed balances.'); }
 }
 return receipt;
}
async function approve(spender,amount){
 const current=await read.usd.allowance(address,spender);
 if(current<amount){status('Approve test USD spending in your wallet.',false,'awaiting-wallet');if(current>0n)await send(write('usd').approve(spender,0));await send(write('usd').approve(spender,amount));}
}
async function connect({silent=false}={}){
 if(connecting||busy)return;connecting=true;syncActions();status('Waiting for wallet connection…',false,'connecting');
 try{
  let nextSigner;
  if(cfg.mode==='local')nextSigner=await rpc.getSigner($('#local-accounts').value);
  else{
   if(!window.ethereum)throw Error('Open this site in your wallet’s browser or use a browser with a wallet extension.');
   const accounts=await window.ethereum.request({method:silent?'eth_accounts':'eth_requestAccounts'});if(!accounts.length){clearWallet();status('No wallet account is connected. Public data remains available.',false,'disconnected');return;}
   const chain=Number(await window.ethereum.request({method:'eth_chainId'}));
   if(chain!==cfg.chainId){if(silent)throw Object.assign(Error('Switch your wallet to the configured chain '+cfg.chainId+' and connect again.'),{code:'WRONG_CHAIN'});try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x'+cfg.chainId.toString(16)}]});}catch(error){if(error.code===4001||error.code==='ACTION_REJECTED')throw error;throw Object.assign(Error('Wallet network mismatch. Switch to chain '+cfg.chainId+', then connect again.'),{code:'WRONG_CHAIN'});}}
   const provider=new BrowserProvider(window.ethereum);if(Number((await provider.getNetwork()).chainId)!==cfg.chainId)throw Object.assign(Error('Wallet network does not match this deployment.'),{code:'WRONG_CHAIN'});nextSigner=await provider.getSigner();
  }
  const nextAddress=await nextSigner.getAddress();if(address!==nextAddress){autoDirty=false;councilOwner=false;}signer=nextSigner;address=nextAddress;text('connect-label',short(address));try{sessionStorage.setItem(cfg.mode==='local'?'fti-local-account':'fti-wallet-connected',cfg.mode==='local'?address:'yes');}catch{}await refresh();status('Wallet connected. Contract data loaded.',false,'connected');quoteRefreshers.forEach(refresh=>refresh());if(surface==='admin')loadProposals();
 }catch(error){if(error.code==='WRONG_CHAIN')clearWallet();status(reason(error),true,transactionStage(error));}finally{connecting=false;syncActions();}
}
$('#connect').onclick=connect;
if(window.ethereum){window.ethereum.on?.('accountsChanged',()=>{clearWallet();status('Wallet account changed. Connect to continue.',false,'disconnected');refresh().catch(e=>status(reason(e),true,'rpc-error'));});window.ethereum.on?.('chainChanged',()=>{clearWallet();status('Wallet network changed. Connect again on chain '+cfg.chainId+'.',true,'wrong-chain');});}
if(cfg.mode==='local'){
 $('#local-accounts').hidden=false;$('#dev-controls').hidden=false;
 cfg.accounts.forEach((a,i)=>{const option=document.createElement('option');option.value=a;option.textContent=`${i+1}. ${cfg.genesis?.includes(a)?'Genesis':cfg.councilOwners?.includes(a)?'Council demo':'Test wallet'} ${short(a)}`;$('#local-accounts').append(option);});
 try{const saved=sessionStorage.getItem('fti-local-account');if(cfg.accounts.includes(saved))$('#local-accounts').value=saved;}catch{}
 $('#local-accounts').onchange=connect;
}
const network=cfg.mode==='local'?'Local chain · '+cfg.chainId:'Configured network · '+cfg.chainId;text('network-name',network);text('account-network',network);text('token-network',network);
$('#theme').onclick=()=>{document.body.classList.toggle('light');try{localStorage.setItem('fti-theme',document.body.classList.contains('light')?'light':'dark');}catch{}};
try{if(localStorage.getItem('fti-theme')==='light')document.body.classList.add('light');}catch{}
async function refresh(){
 const sequence=++refreshSequence,requestedAddress=address;
 try{
 const [d,isOwner,lastClosedAt,epochUnits,nextPriceSnapshot]=await Promise.all([json('/api/state'+(requestedAddress?'?wallet='+encodeURIComponent(requestedAddress):'')),requestedAddress&&surface==='admin'?read.council.isOwner(requestedAddress):Promise.resolve(false),surface==='admin'?read.binary.lastClosedAt():Promise.resolve(undefined),read.binary.epochUnits(),reserveModel?readRatioSnapshot(rpc,read.token):Promise.resolve(null)]);
 if(requestedAddress&&cfg.lockVersion===2){if(state?.wallet?.address!==requestedAddress||lockOffset>=Number(d.wallet.lockCount))lockOffset=0;if(lockOffset>0){const page=await json('/api/locks?wallet='+requestedAddress+'&offset='+lockOffset);d.wallet.locks=page.locks;d.wallet.lockCount=page.total;}}
 if(sequence!==refreshSequence||requestedAddress!==address)return;
 priceSnapshot=nextPriceSnapshot;state=d;state.epochUnits=epochUnits;text('hourly-paid-units',integer(epochUnits)+' / 5 required');if(lastClosedAt!==undefined)state.lastClosedAt=lastClosedAt;const recovered=readFailed;lastUpdated=Date.now();readFailed=false;councilOwner=isOwner;if(recovered&&!busy&&!connecting)status('Connection restored. Contract data loaded.',false,address?'connected':'disconnected');if(reserveModel){text('token-unallocated',fmt(d.unallocatedReserve));text('token-anchor',fmt(d.anchorSupply,6));text('token-price-label',tokenLifecycle(d,retirementModel).priceLabel);text('overview-price-label',tokenLifecycle(d,retirementModel).priceLabel);}
 if(retirementModel){text('token-development-claim',formatEther(d.developmentFeeClaim));text('token-development-fund',d.developmentFund);text('token-retired',d.permanentlyRetired?'Yes · irreversible':'No');text('token-reference-price',formatEther(d.referencePrice));text('token-buy-closure',d.restartSupported?(d.buysPermanentlyClosed?'Permanently closed · irreversible':'Open · ordinary zero supply can restart'):'Separate closure marker unavailable in this ABI');text('token-reference-exact',d.restartSupported?formatRatio(ratio(d.referenceReserve,d.referenceSupply))+' USD / FTI · exact '+exactFraction(ratio(d.referenceReserve,d.referenceSupply)):'Exact retained ratio unavailable in this ABI');}
 if(fundedModel){text('point-retained',fmt(d.pointRetained));text('builder-retained',fmt(d.builderRetained));}
 for(const[id,value]of Object.entries({'token-spot':formatEther(d.price),'token-reserve':fmt(d.reserve),'token-supply':fmt(d.supply),'token-bb':fmt(d.bb),'token-floor':fmt(d.floor),'token-status':tokenLifecycle(d,retirementModel).status,price:formatEther(d.price),reserve:fmt(d.reserve),reserve2:fmt(d.reserve),members:integer(d.count),'point-pool':fmt(d.pointPool),buyback:fmt(d.bb),floor:fmt(d.floor),supply:fmt(d.supply),epoch:'Epoch '+integer(d.epoch),phase:['Accepting deposits','Matching points','Allocating rewards'][d.phase]||'Processing',protection:integer(d.level),'epoch-end':utc(d.epochEnd),accounting:d.account1[0]===d.account1[1]&&d.account2[0]===d.account2[1]?'Balanced':'Review required',queue:`Volume queue: ${d.jobCursor} / ${d.jobCount}\nSettlement phase: ${d.phase} · Member cursor: ${d.cursor}\nSame-hour paid units: ${epochUnits} / 5 required for matching`,'lock-clock':'Wallet counter '+integer(d.clock),'updated-at':'Updated '+new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}))text(id,value);
 renderWallet();syncActions();
 }catch(error){if(sequence===refreshSequence){readFailed=true;syncActions();}throw error;}
}
function renderWallet(){
 text('admin-binary-status',state?state.paused?'Paused':'Open':'—');text('admin-token-status',state?tokenLifecycle(state,retirementModel).status:'—');
 text('admin-role',!address?'READ ONLY':councilOwner?'COUNCIL OWNER':'PUBLIC CALLER');text('admin-access-copy',!address?'Connect a wallet to check its council role.':councilOwner?'Your connected wallet can propose and approve council actions. Five approvals are required to execute a proposal.':'This wallet is not a council owner. You can process settlement and execute operations that are already authorized and ready.');
 const w=wallet(),lifecycle=tokenLifecycle(state,retirementModel);const locked=w?BigInt(w.ftiBalance)-BigInt(w.unlocked):0n;
 if(fundedModel)text('wallet-credits',w?fmt(w.creditL)+' / '+fmt(w.creditR):'—');
 const count=Number(w?.lockCount||0);$('#lock-pagination').hidden=cfg.lockVersion!==2||count<=64;$('#locks-prev').disabled=busy||lockOffset===0;$('#locks-next').disabled=busy||lockOffset+64>=count;text('lock-page-label',count?`${lockOffset+1}–${Math.min(lockOffset+64,count)} of ${count}`:'No active locks');
 for(const[id,value]of Object.entries({claimable:w?fmt(w.claimable):'—','reward-claimable':w?fmt(w.claimable):'—',rank:w?.exists?ranks[w.rank]:address?'Not registered':'Not connected','wallet-address':address||'No wallet connected','usd-balance':w?fmt(w.usdBalance):'—','fti-balance':w?fmt(w.ftiBalance,5):'—',unlocked:w?fmt(w.unlocked,5):'—',allowance:w?fmt(w.remaining):'—',units:w?integer(w.units):'—','account-units':w?integer(w.units):'—',lifetime:w?`${integer(w.lifetimeL)} / ${integer(w.lifetimeR)}`:'—',carry:w?`${integer(w.carryL)} / ${integer(w.carryR)}`:'—','auto-pending':w?fmt(w.autoPending):'—','trade-balance':w?fmt(w.ftiBalance,5):'—','trade-unlocked':w?fmt(w.unlocked,5):'—','trade-locked':w?fmt(locked,5):'—','locked-summary':reserveModel?'No time-based token locks':w?fmt(locked,5)+' FTI locked':'Connect to view token locks','buy-available':w?`Balance: ${fmt(w.usdBalance)} USD · Allowance: ${fmt(w.remaining)} USD`:'Connect to view your balance and allowance.','sell-available':w?'Available: '+fmt(w.unlocked,6)+' FTI':'Available: — FTI','membership-status':w?.exists?'Registered member':address?'Not registered':'Not connected','auto-status':autoBuyPresentation(state,w).label}))text(id,value);
 $('#legacy-lock-schedule').hidden=reserveModel;$('#lock-clock').hidden=reserveModel;
 $('#lifecycle-notice').hidden=!lifecycle.notice;text('lifecycle-notice',lifecycle.notice);
 text('membership-intro-title',lifecycle.fundingBlocked?'Review your existing position.':'Build your position.');
 text('membership-intro-copy',lifecycle.fundingBlocked?'New funding is disabled for this closed token target. Existing network records and binary cash claims remain available.':'Each unit costs 100 test USD. Your position and branch volume are recorded on-chain.');
 text('token-buy-description',lifecycle.buyingBlocked?'New token purchases are unavailable. Review the lifecycle notice and current contract state.':'Registered wallets with purchased units can buy along the curve. Review the fee, allowance and minimum output before approving.');
 text('membership-funding-notice',lifecycle.fundingBlocked?lifecycle.notice:state?.paused?'Membership funding is paused by the binary contract.':state&&(Number(state.phase)!==0||Number(state.timestamp)>=Number(state.epochEnd))?'Membership funding is waiting for hourly settlement. The administration panel shows permissionless processing readiness.':'Your wallet may request a USD approval before registration. Existing members add units to their current position.');
 text('step-member-title',lifecycle.fundingBlocked?'Review existing membership':'Join with a sponsor');text('step-member-copy',lifecycle.fundingBlocked?'New funding is disabled for this closed token target. Existing binary cash claims remain available.':'Register a position to unlock token purchases.');
 text('referral-copy',lifecycle.fundingBlocked?'Invitations are disabled for this closed token target.':'Share your membership link. Registration still checks available positions on-chain.');
 text('token-membership-title',lifecycle.fundingBlocked?'Existing membership and claims.':'Your membership opens the door.');
 text('token-membership-copy',lifecycle.fundingBlocked?'Review your existing position and binary cash claims in the member dashboard.':'Manage your registration, units and rewards in the separate member dashboard.');
 text('auto-policy',autoBuyPolicy(state,lifecycle));
 const autoView=autoBuyPresentation(state,w);text('auto-effective-at',autoView.scheduled?'Scheduled start: '+utc(autoView.effectiveAt)+' · first eligible allocation boundary. Older overdue allocations do not inherit this request.':autoView.enabled?'Active now. Disabling stops attempts immediately, including retries of existing pending funds.':'No future enable is scheduled.');
 text('auto-release-policy','Move funds to claimable keeps your funds inside the binary as your cash claim; Claim to wallet transfers them separately. '+(state?.restartSupported?'Permissionless conversion is allowed only after separately governed permanent buy closure, with the binary paused and hourly settlement idle. An ordinary zero-supply interval does not allow it.':'This token ABI has no separately governed permanent-buy-closure marker. This interface offers only your own cash-release control.')+' Previously fixed earned-hour allocations can remain pending after disabling.');
 text('welcome-copy',lifecycle.fundingBlocked?lifecycle.notice:w?.exists?'Your membership, tokens and rewards — connected to your wallet and read directly from the chain.':'Connect a wallet, get test assets and register with a sponsor to begin.');
 const paidRank=state?.rewardModel==='global-pool-paid-points-v2';
 const matched=w?(paidRank?BigInt(w.cumulativePaidRankPoints||0):(BigInt(w.lifetimeL)<BigInt(w.lifetimeR)?BigInt(w.lifetimeL):BigInt(w.lifetimeR))):0n;
 text('member-paid-points',w?.exists?integer(matched):'—');
 const caps=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];text('member-point-cap',w?.exists?caps[Number(state?.level)||0]?.[Number(w.rank)]+' eligible points':'—');
 text('member-rank-threshold',w?.exists?(thresholds[Number(w.rank)]?integer(thresholds[Number(w.rank)])+' points':'Top rank'):'—');
 $('#same-hour-policy').hidden=!paidRank;
 const next=thresholds[w?.rank||0];const previous=Number(w?.rank)>0?thresholds[Number(w.rank)-1]:0n;
 $('#rank-progress').value=w?.exists?(next?Math.max(0,Math.min(100,Number((matched-previous)*100n/(next-previous)))):100):0;
 text('rank-description',w?.exists?(next?(paidRank?'Progress counts capped points credited by funded settlement; cash withdrawal is not required.':'Historical model: weaker lifetime-branch volume determines rank.'):'You have reached the highest current rank.'):lifecycle.fundingBlocked?'Membership funding is disabled for this closed token target.':'Register with a sponsor to start your membership.');
 text('rank-points',w?.exists?integer(matched)+(paidRank?' funded settlement points':' historical lifetime units'):'— points');text('rank-next',w?.exists?(next?'Next: '+integer(next):'Top rank'):'—');
 text('trade-notice',lifecycle.fundingBlocked?lifecycle.notice:!address?'Connect a wallet to view trading availability.':state?.lifecycleClosed?lifecycle.notice:state?.emergencyExit?'Emergency redemption-only mode is active. New buys and transfers are stopped; holder redemptions are fee-free and there are no normal size/hourly waiting caps.':state?.tokenPaused?'New token buys and transfers are paused; holder redemptions remain available under contract rules.':!w?.exists?'You can sell available FTI. Register your wallet in Membership before buying FTI.':BigInt(w?.units||0)===0n?'You can sell available FTI. Add at least one membership unit before buying FTI.':'Buy, sell or transfer through your wallet. Review available balance, minimum output and the configured contract rules before approving.');
 const registered=!!w?.exists;const form=$('#register-form');form.elements.sponsor.disabled=registered;
 text('registration-title',lifecycle.fundingBlocked?'Membership funding unavailable':registered?'Add membership units':'Join the network');text('register-button',lifecycle.fundingBlocked?'Funding disabled':registered?'Add units':'Register membership');
 text('sponsor-help',registered?'Your sponsor and position stay unchanged when you add units.':'New positions fill the sponsor’s left slot first, then the right. Both slots must not be full.');
 for(const[id,done]of [['step-wallet',!!signer],['step-funds',BigInt(w?.usdBalance||0)>0n],['step-member',registered]])$('#'+id).classList.toggle('done',done);
 $('#referral-link').value=registered&&!lifecycle.fundingBlocked?location.origin+'/app/?sponsor='+address+'#network':'';
 $('#tree').replaceChildren();for(const[label,key]of [['Sponsor','parent'],['Left branch','left'],['Right branch','right']]){const node=document.createElement('div');node.textContent=label;const value=document.createElement('small');value.textContent=w&&w[key]!==ZeroAddress?w[key]:w?'Empty position':'Connect to view';node.append(value);$('#tree').append(node);}
 $('#locks').replaceChildren();
 if(w?.locks.length){for(const l of w.locks){const tr=document.createElement('tr');for(const value of [fmt(l.amount,6),integer(l.clock),utc(l.deadline),BigInt(state.clock)>=BigInt(l.clock)||state.timestamp>=Number(l.deadline)?'Unlocked':'Locked']){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('#locks').append(tr);}}
 else{const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent=address?'No token lock tranches recorded.':'Connect a wallet to see its unlock schedule.';tr.append(td);$('#locks').append(tr);}
 if(!autoDirty)$('#auto-form').elements.enabled.checked=autoView.requested;
}
$('#refresh-state').onclick=async()=>{try{await refresh();status('Contract data refreshed.');}catch(e){status(reason(e),true,'rpc-error');}};
for(const[id,step]of [['locks-prev',-64],['locks-next',64]])$('#'+id).onclick=async()=>{lockOffset=Math.max(0,lockOffset+step);try{await refresh();}catch(e){status(reason(e),true);}};
async function copy(value,input){try{await navigator.clipboard.writeText(value);status('Copied to clipboard.');}catch{if(input){input.focus();input.select();status('The link is selected. Copy it from the text field.');}else{const range=document.createRange();range.selectNodeContents($('#wallet-address'));getSelection().removeAllRanges();getSelection().addRange(range);status('The address is selected. Copy the selected text.');}}}
$('#copy-address').onclick=()=>copy(address);$('#copy-referral').onclick=()=>copy($('#referral-link').value,$('#referral-link'));
const sponsor=new URLSearchParams(location.search).get('sponsor');if(sponsor&&isAddress(sponsor))$('#register-form').elements.sponsor.value=sponsor;
$('#register-form').elements.units.oninput=()=>{const raw=$('#register-form').elements.units.value;text('registration-cost',/^\d+$/.test(raw)?integer(BigInt(raw)*100n)+' test USD':'Enter whole units');};
for(const id of ['claim','claim-rewards'])$('#'+id).onclick=()=>transaction(()=>send(write('binary').claim()));
$('#faucet').onclick=()=>transaction(()=>send(write('usd').faucet()));
$('#register-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{validateFundingAccess(state,retirementModel);const f=e.target,n=BigInt(f.elements.units.value);if(n<1n||n>1000000n)throw Error('Enter between 1 and 1,000,000 whole units.');const w=wallet();if(!w)throw Error('Reload wallet data and try again.');const sponsorAddress=f.elements.sponsor.value.trim();if(!w.exists&&(!isAddress(sponsorAddress)||sponsorAddress===ZeroAddress))throw Error('Enter a valid sponsor address.');const cost=n*parseEther('100');if(cost>BigInt(w.usdBalance))throw Error('Not enough test USD. Use Get test USD on Overview.');await approve(cfg.binary,cost);await send(w.exists?write('binary').addUnits(n):write('binary').register(sponsorAddress,n));});};
$('#auto-form').addEventListener('input',()=>{autoDirty=true;syncActions();});
$('#auto-form').onsubmit=e=>{e.preventDefault();const enabled=e.target.elements.enabled.checked;transaction(async()=>{validateAutoPreference({data:state,wallet:wallet(),enabled,lifecycle:tokenLifecycle(state,retirementModel)});await send(write('binary').setAutoBuy(enabled));autoDirty=false;});};
$('#execute-auto').onclick=()=>transaction(()=>{if(tokenLifecycle(state,retirementModel).buyingBlocked)throw Error('New token purchases are unavailable.');if(!wallet()?.autoEnabled)throw Error('Auto-buy is not active. Enable it for the next UTC boundary or release your funds to claimable cash.');return send(write('binary').executeAuto(address,BigInt(wallet().autoPending)));});
$('#release-auto').onclick=()=>transaction(()=>send(write('binary').releaseAutoToCash()));
function amountInput(form){const amount=parseEther(form.elements.amount.value);const percent=Number(form.elements.slippage.value);if(amount<=0n||!Number.isFinite(percent)||percent<0||percent>5)throw Error('Enter a positive amount and slippage between 0% and 5%.');return[amount,BigInt(Math.round(percent*100))];}
// Quote helpers are isolated for UI regression coverage without a browser wallet.
async function readTradeQuote(token,kind,amount,slippageBps,isReserve,blockTag){
 const overrides=blockTag===undefined?{}:{blockTag};
 let output,feeAmount,feeBps;
 if(kind==='buy'){
  if(isReserve)[output,[feeAmount]]=await Promise.all([token.quoteBuy(amount,overrides),token.buyFeeQuote(amount,overrides)]);
  else output=await token.quoteBuy(amount,overrides);
 }else if(kind==='sell'){
  if(isReserve)[feeAmount,output]=await token.sellFeeQuote(amount,overrides);
  else [output,feeBps]=await token.quoteSell(amount,overrides);
 }else throw Error('Unknown trade direction');
 return {output,minimum:output*(10000n-slippageBps)/10000n,feeAmount,feeBps};
}
function formatTradeQuote(kind,{output,minimum,feeAmount,feeBps}){
 const unit=kind==='buy'?' FTI':' test USD';
 let message=(kind==='buy'?'Estimated output: ':'Net proceeds: ')+formatEther(output)+unit+'\nMinimum accepted: '+formatEther(minimum)+unit;
 if(feeAmount!==undefined)message+='\nQuoted fee: '+formatEther(feeAmount)+' test USD';
 else if(feeBps!==undefined)message+=' · Quoted fee rate: '+Number(feeBps)/100+'%';
 return message;
}
function validateTradeAccess(kind,w,tokenPaused,lifecycleClosed=false,permanentlyRetired=false,restartSupported=false,buysPermanentlyClosed=false,emergencyExit=false){
 if(!w)throw Error('Reload wallet data and try again.');
 if(kind==='buy'){
  if(permanentlyRetired)throw Error('The token is permanently retired; new purchases are unavailable.');
  if(buysPermanentlyClosed)throw Error('Token buys are permanently closed; new purchases are unavailable.');
  if(lifecycleClosed&&!restartSupported)throw Error('The token lifecycle is closed; new purchases are unavailable in this historical token model.');
  if(!w.exists||BigInt(w.units)===0n)throw Error('Register or add membership units before buying FTI.');
  if(tokenPaused||emergencyExit)throw Error('New token purchases are paused by the contract.');
 }
}
function reserveExitPolicy(isRetirement){
 return isRetirement?'Ordinary full-supply sales pay net of the current-trade fee; the fee is reserved as a development claim and paid separately to the immutable fund. Only emergency redemptions are fee-free.':'Full-supply and emergency redemptions are fee-free.';
}
function tokenLifecycle(data,isRetirement=false){
 const d=data||{},retired=!!d.permanentlyRetired,permanent=!!d.buysPermanentlyClosed,empty=!!d.lifecycleClosed,legacyClosed=empty&&!d.restartSupported;
 const fundingBlocked=isRetirement&&(retired||permanent||legacyClosed);
 const notice=retired?'The token is permanently retired. Supply and redeemable reserve are zero; the stored price reference is historical. Membership funding into this token target is unavailable. Existing binary cash claims remain available.':permanent?'Token buys are permanently closed by the separate governed closure action. An ordinary empty interval cannot set this marker. New token buys and funding into this token target are unavailable. Binary cash claims remain available.':legacyClosed?'The token lifecycle is closed under this historical ABI. Supply and redeemable reserve are zero; the stored price reference is historical, not a redeemable quote. New token buys are blocked. Binary cash claims remain available.':empty?'All tokens were redeemed. Live R / S is undefined at zero supply. The same token can restart at its retained exact reference ratio when buys are open and pause/emergency conditions permit. Protected support and existing development claims stay separate and are not captured by the restart. An ordinary zero-supply interval does not permit permissionless pending-auto cash conversion.':'';
 return {fundingBlocked,buyingBlocked:!data||retired||permanent||legacyClosed||!!d.tokenPaused||!!d.emergencyExit,notice,
  priceLabel:BigInt(d.supply||0)>0n?'Calculated reserve / supply · USD per FTI':'Live ratio undefined (zero supply)',
  status:retired?'Permanently retired':permanent?'Buys permanently closed':d.emergencyExit?'Redemption only':d.tokenPaused?'Paused':legacyClosed?'Lifecycle closed':empty?'Zero supply · restart available':'Active'};
}
function validateFundingAccess(data,isRetirement){
 if(!data)throw Error('Reload contract data and try again.');
 if(tokenLifecycle(data,isRetirement).fundingBlocked)throw Error('Membership funding is disabled for this closed token target. Existing binary cash claims remain available.');
 if(data.paused)throw Error('Membership funding is paused by the binary contract.');
}
// End isolated quote helpers.
for(const kind of ['buy','sell']){
 const form=$('#'+kind+'-form');let debounce,quoteSequence=0;
 const showQuote=()=>{clearTimeout(debounce);const sequence=++quoteSequence,quoteAddress=address;const button=form.querySelector('[data-write]');button.dataset.quoteReady='false';syncActions();text(kind+'-quote',form.elements.amount.value?'Updating quote…':'Enter an amount for a live quote.');if(!form.elements.amount.value)return;if(freshness().stale){text(kind+'-quote','Quote unavailable: refresh contract data first.');return;}
 debounce=setTimeout(async()=>{try{const[a,slip]=amountInput(form),blockTag=await rpc.getBlockNumber(),quote=await readTradeQuote(read.token,kind,a,slip,reserveModel,blockTag);if(sequence!==quoteSequence||quoteAddress!==address)return;if(freshness().stale)throw Error('Contract data is stale.');if(quote.minimum<=0n)throw Error('Output is below a safe minimum.');text(kind+'-quote',formatTradeQuote(kind,quote)+'\nQuote block: '+blockTag+' · Expires '+form.elements.deadline.value+' minutes after the refreshed chain timestamp at submission.');button.dataset.quoteReady='true';$('#'+kind+'-quote').classList.remove('invalid');syncActions();}catch(error){if(sequence!==quoteSequence)return;text(kind+'-quote','Quote unavailable. Check the amount or refresh contract data. '+reason(error));$('#'+kind+'-quote').classList.add('invalid');button.dataset.quoteReady='false';syncActions();}},250);};
 quoteRefreshers.push(showQuote);form.elements.deadline.onchange=showQuote;
 form.elements.amount.oninput=showQuote;form.elements.slippage.oninput=showQuote;
 form.onsubmit=e=>{e.preventDefault();transaction(async()=>{const[a,slip]=amountInput(form),w=wallet();validateTradeAccess(kind,w,state.tokenPaused,state.lifecycleClosed,state.permanentlyRetired,state.restartSupported,state.buysPermanentlyClosed,state.emergencyExit);const duration=Number(form.elements.deadline.value);if(![5,10,20].includes(duration))throw Error('Choose a valid transaction deadline.');const deadline=BigInt(state.timestamp)+BigInt(duration*60);
  if(kind==='buy'){if(a>BigInt(w.usdBalance))throw Error('Not enough test USD in your wallet.');if(a>BigInt(w.remaining))throw Error('Amount exceeds your remaining manual purchase allowance.');const quote=await readTradeQuote(read.token,kind,a,slip,reserveModel,await rpc.getBlockNumber());if(quote.minimum<=0n)throw Error('Output is below a safe minimum.');text(kind+'-quote',formatTradeQuote(kind,quote)+'\nDeadline: '+utc(deadline));await approve(cfg.token,a);await send(write('token').buy(a,quote.minimum,deadline));}
  else{if(a>BigInt(w.unlocked))throw Error('Amount exceeds your available token balance.');const quote=await readTradeQuote(read.token,kind,a,slip,reserveModel,await rpc.getBlockNumber()),token=write('token'),args=[a,quote.minimum,deadline];if(quote.minimum<=0n)throw Error('Output is below a safe minimum.');text(kind+'-quote',formatTradeQuote(kind,quote)+'\nDeadline: '+utc(deadline));const overrides=reserveModel?{gasLimit:bufferedTokenSellGas(await token.sell.estimateGas(...args))}:{};await send(token.sell(...args,overrides));}
 });};
}
$('#max-sell').onclick=()=>{const form=$('#sell-form');form.elements.amount.value=formatEther(wallet().unlocked);form.elements.amount.dispatchEvent(new Event('input',{bubbles:true}));};
$('#transfer-form').elements.amount.oninput=()=>{try{const amount=parseEther($('#transfer-form').elements.amount.value);if(amount<=0n)throw Error();const burn=reserveModel?(amount*300n+9999n)/10000n:amount*300n/10000n;const received=amount-burn;if(received<=0n)throw Error();text('transfer-preview','Gross transfer: '+formatEther(amount)+' FTI\nBurned (3%, rounded to token atoms): '+formatEther(burn)+' FTI\nRecipient receives: '+formatEther(received)+' FTI\nNo separate USD fee; wallet network gas is additional.');}catch{text('transfer-preview','Enter a positive amount above the transfer dust limit.');}};
$('#transfer-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const to=e.target.elements.to.value.trim(),amount=parseEther(e.target.elements.amount.value);if(!isAddress(to)||to===ZeroAddress)throw Error('Enter a valid recipient address.');if(state.tokenPaused||state.emergencyExit||state.permanentlyRetired||state.buysPermanentlyClosed||(state.lifecycleClosed&&!state.restartSupported))throw Error('Transfers are unavailable in the current token state.');if(amount<=0n||amount>BigInt(wallet().unlocked))throw Error('Enter an amount within your unlocked token balance.');if(to.toLowerCase()===address.toLowerCase())throw Error('Choose a different recipient wallet.');await send(write('token').transfer(to,amount));});};
for(const[id,method,arg]of [['volume','processVolume',50],['close-epoch','beginEpochClose'],['process-epoch','processEpoch',50],['begin-month','beginBuilderMonth'],['process-month','processBuilderMonth',50]])$('#'+id).onclick=()=>transaction(()=>{const readiness=settlementReadiness(state)[id];if(!readiness.ready)throw Error(readiness.reason);return send(write('binary')[method](...(arg?[arg]:[])));});
document.querySelectorAll('[data-time]').forEach(button=>button.onclick=()=>transaction(async()=>{const response=await fetch('/api/dev/time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seconds:Number(button.dataset.time)})});if(!response.ok)throw Error((await response.json()).error);},{localOnly:true}));
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
function operationLabel(target,data){
 for(const[key,contract]of Object.entries(read)){if(cfg[key]?.toLowerCase()===target.toLowerCase()){try{return contract.interface.parseTransaction({data}).name;}catch{return 'Unknown operation';}}}
 return 'External target';
}
async function loadProposals(){
 const sequence=++proposalSequence,requestedAddress=address;$('#refresh-proposals').disabled=true;
 try{const count=Number(await read.council.count()),fragment=document.createDocumentFragment();
 if(!count){const empty=document.createElement('p');empty.textContent='No governance proposals yet. A council owner can create one.';fragment.append(empty);}
 for(let i=count-1;i>=Math.max(0,count-20);i--){
  const p=await read.council.proposal(i),alreadyApproved=requestedAddress?await read.council.approved(i,requestedAddress):false,box=document.createElement('div');box.className='proposal';
  const title=document.createElement('h4');title.textContent=`Proposal ${i} · ${operationLabel(p[0],p[1])}`;
  const description=document.createElement('p');description.textContent=`${p[2]} of 5 approvals · ${p[3]?'Executed':Number(p[2])>=5?'Threshold met':'Awaiting council approvals'}`;
  const target=document.createElement('p');target.className='address';target.textContent='Target: '+p[0];
  const details=document.createElement('details'),summary=document.createElement('summary'),calldata=document.createElement('pre');summary.textContent='Inspect exact call data';calldata.textContent=p[1];details.append(summary,calldata);box.append(title,description,target,details);
  const available=proposalAvailability({executed:p[3],approvals:p[2],approved:alreadyApproved,owner:councilOwner,connected:!!signer});
  for(const[label,key,fn]of [[alreadyApproved?'Approved by this wallet':'Approve','approve',()=>write('council').approve(i)],['Execute proposal','execute',()=>write('council').execute(i)]]){
   const button=document.createElement('button');button.className='secondary';button.textContent=label;button.dataset.write='';button.dataset.requires=key==='approve'?'council':'wallet';button.dataset.executed=String(p[3]);button.dataset.blocked=String(!available[key]);
   button.onclick=()=>transaction(async()=>{const current=await read.council.proposal(i);if(current[3])throw Error('This proposal has already executed.');if(key==='approve'&&await read.council.approved(i,address))throw Error('This wallet already approved the proposal.');if(key==='execute'&&Number(current[2])<5)throw Error('Five current council approvals are required.');await send(fn());await loadProposals();});box.append(button);
  }
  if(p[0].toLowerCase()===cfg.timelock.toLowerCase()&&p[3]){const inspect=document.createElement('button');inspect.className='text-button';inspect.textContent='Inspect timelock →';inspect.onclick=()=>{$('#timelock-form').elements.id.value=String(i);inspectTimelock();};box.append(inspect);}
  fragment.append(box);
 }
 if(sequence!==proposalSequence||requestedAddress!==address)return;$('#proposals').replaceChildren(fragment);syncActions();
 }catch(error){if(sequence!==proposalSequence)return;text('proposals','Proposals could not be loaded. Use Refresh proposals to retry.');status(reason(error),true,'rpc-error');}
 finally{if(sequence===proposalSequence)$('#refresh-proposals').disabled=false;}
}
$('#refresh-proposals').onclick=loadProposals;
$('#proposal-form').elements.action.onchange=()=>{const action=$('#proposal-form').elements.action.value,key=action.includes('Binary')?'binary':'token',delayed=action.startsWith('unpause')||action==='milestone';text('proposal-preview','Operation: '+$('#proposal-form').elements.action.selectedOptions[0].textContent+'\nContract target: '+cfg[key]+'\n'+(delayed?'Five council approvals schedule this call through the fixed 72-hour timelock. Scheduling and execution are separate transactions.':'Five council approvals allow direct execution. This proposal alone does not execute the operation.'));};
$('#proposal-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const action=e.target.elements.action.value;if(!['emergencyExit','pauseBinary','pauseToken','unpauseBinary','unpauseToken','milestone'].includes(action))throw Error('Choose an operation to propose.');let target,data;
 if(action==='emergencyExit'){target=cfg.token;data=read.token.interface.encodeFunctionData('activateEmergencyExit');}
 else if(action==='pauseBinary'||action==='pauseToken'){const key=action==='pauseBinary'?'binary':'token';target=cfg[key];data=read[key].interface.encodeFunctionData('pause');}
 else{const key=action==='unpauseBinary'?'binary':'token';const inner=read[key].interface.encodeFunctionData(action==='milestone'?'advancePriceMilestone':'unpause');target=cfg.timelock;data=read.timelock.interface.encodeFunctionData('schedule',[cfg[key],0,inner,ZeroHash,hexlify(randomBytes(32)),259200]);}
 await send(write('council').propose(target,data));await loadProposals();});};
async function readTimelockOperation(proposalId){
 if(!/^\d+$/.test(String(proposalId)))throw Error('Enter a whole scheduling proposal ID.');
 const p=await read.council.proposal(BigInt(proposalId));if(p[0].toLowerCase()!==cfg.timelock.toLowerCase()||!p[3])throw Error('The scheduling proposal has not been executed.');
 const args=read.timelock.interface.decodeFunctionData('schedule',p[1]),operation=await read.timelock.hashOperation(args[0],args[1],args[2],args[3],args[4]);
 const [timestamp,done,ready,predecessorReady]=await Promise.all([read.timelock.getTimestamp(operation),read.timelock.isOperationDone(operation),read.timelock.isOperationReady(operation),args[3]===ZeroHash?true:read.timelock.isOperationDone(args[3])]);
 const presentation=timelockPresentation({scheduled:timestamp>0n,done,ready,timestamp});if(presentation.ready&&!predecessorReady){presentation.ready=false;presentation.label='Waiting for predecessor operation';}
 return {args,operation,...presentation};
}
async function inspectTimelock(){
 const sequence=++timelockSequence,id=$('#timelock-form').elements.id.value;timelockReady=false;syncActions();text('timelock-preview','Reading operation from the timelock…');$('#inspect-timelock').disabled=true;
 try{const op=await readTimelockOperation(id);if(sequence!==timelockSequence)return;timelockReady=op.ready;text('timelock-preview',op.label+'\nOperation: '+operationLabel(op.args[0],op.args[2])+'\nTarget: '+op.args[0]+'\nNative value: '+formatEther(op.args[1])+'\nOperation hash: '+op.operation+'\nCall data: '+op.args[2]);}
 catch(error){if(sequence===timelockSequence)text('timelock-preview','Operation unavailable: '+reason(error));}
 finally{if(sequence===timelockSequence){$('#inspect-timelock').disabled=false;syncActions();}}
}
$('#inspect-timelock').onclick=inspectTimelock;
$('#timelock-form').elements.id.oninput=()=>{timelockSequence++;timelockReady=false;$('#inspect-timelock').disabled=false;text('timelock-preview','Check this proposal to read its on-chain readiness.');syncActions();};
$('#timelock-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const op=await readTimelockOperation(e.target.elements.id.value);if(!op.ready)throw Error(op.label);const a=op.args;await send(write('timelock').execute(a[0],a[1],a[2],a[3],a[4]));await inspectTimelock();});};
text('token-address',cfg.token);$('#token-explorer').hidden=!explorer;if(explorer)$('#token-explorer').href=explorer+'/address/'+cfg.token;
controllerReady=true;renderWallet();syncActions();navigate(location.hash.slice(1)||((sponsor&&isAddress(sponsor))?'network':defaultPage),{historyMode:'replace'});
try{await refresh();status('Contract data loaded. Connect a wallet to manage your account.',false,'disconnected');let reconnect=false;try{reconnect=cfg.mode==='local'?!!sessionStorage.getItem('fti-local-account'):sessionStorage.getItem('fti-wallet-connected')==='yes';}catch{}if(reconnect&&(cfg.mode==='local'||window.ethereum))await connect({silent:true});}catch(error){status(reason(error),true,'rpc-error');}
setInterval(()=>{if(!busy&&!connecting)refresh().catch(error=>status('Connection unavailable: '+reason(error),true,'rpc-error'));},15000);
setInterval(()=>syncActions(),5000);
