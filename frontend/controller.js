import {JsonRpcProvider,BrowserProvider,Contract,parseEther,formatEther,ZeroAddress,ZeroHash,randomBytes,hexlify,isAddress} from '/vendor/ethers.js';
import {surface,surfacePages,defaultPage,pagePath} from './surfaces.js';
const $=s=>document.querySelector(s);
const text=(id,value)=>{document.getElementById(id).textContent=value;};
async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(25000),cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to read contract data.');return data;}
const cfg=await json('/api/config');
const reserveModel=cfg.tokenContract==='FTIReserveToken';const v3Model=cfg.tokenContract==='FTIReserveTokenV3';
const fundedModel=cfg.binaryContract==='FundedBinaryPlan';
$('#funded-policy').hidden=!fundedModel;
if(reserveModel){
 text('token-price-label','Gross reserve value per FTI');text('token-model-title','Real-reserve pricing');text('token-model-ratio-label','Pricing model');text('token-model-ratio','Reserve / total shares');
 text('token-reserve-description','Recorded test USD backing');text('token-model-description','The 3% buy and sell fees remain in the real reserve. Positive trades and transfer burns increase the exact reserve/share value. There is no timed yield. The first paid allocation backs permanently locked shares; direct USD donations do not change quotes.');
 text('token-sale-description','Redeem unlocked FTI against recorded reserves. A 3% fee stays in reserve; check the net quote. A rising gross price does not guarantee profit or the value of the collateral.');
 $('#token-anchor-row').hidden=false;$('#token-source').href='https://github.com/Rezamoradifar/fti-protocol/blob/fix/funded-binary/contracts/FTIReserveToken.sol';
}

if(v3Model){
 text('buy-policy','Membership and rank purchase limits apply. V3 has no time or wallet-count locks.');
 text('sell-policy','V3 has no time locks. Sales remain subject to the 3% fee, single-sale and hourly outflow limits.');
 text('availability-policy','V3 tokens have no time or wallet-count locks. Pauses, emergency state and sale limits still apply.');
 text('token-price-label','Reserve / FTI');text('token-model-ratio-label','Pricing model');text('token-model-ratio','Zero-start reserve / supply');
 text('token-model-description','No premint or time locks. All 3% buy/sell fees stay in reserve; no charity tokens are minted. Support reserve is separate from normal pricing.');
 text('token-sale-description','Sales use reserve/share quotes: 3% fee, 5% gross single-sale and 20% net hourly outflow limits. Transfers burn 3% of the amount sent.');
 text('transfer-title','Transfer FTI');text('transfer-description','The amount entered is your total debit: the recipient receives 97% and 3% is burned. The burn rounds up to the smallest FTI unit. Recipients do not need membership.');
 $('#transfer-quote').hidden=false;
 text('governance-title','5-of-7 governance');text('governance-description',cfg.timelock?'Five guardians approve proposals. Ordinary operations pass through a 72-hour timelock; emergency pause and redemption require five approvals.':'Legacy V3 configuration: ordinary governance is not timelocked. A new integrated deployment is required.');
 $('#timelock-form').hidden=!cfg.timelock;$('#timelock-heading').hidden=!cfg.timelock;
 const select=$('#proposal-form').elements.action;for(const option of [...select.options])if(option.value==='milestone'||(!cfg.timelock&&!['pauseBinary','pauseToken'].includes(option.value)))option.remove();
 const option=document.createElement('option');option.value='emergencyUnwind';option.textContent='Permanent emergency pro-rata redemption';select.append(option);
 $('#token-source').href='https://github.com/Rezamoradifar/fti-protocol/blob/'+(cfg.sourceRevision||'fix/v3-no-charity-batched-rewards-20261008')+'/contracts/FTIReserveTokenV3.sol';
}

const rpc=new JsonRpcProvider(location.origin+'/rpc',undefined,{cacheTimeout:-1});rpc.pollingInterval=1000;
const names={binary:cfg.binaryContract||'BinaryPlan',token:cfg.tokenContract||'FTIToken',usd:'MockUSD',council:v3Model?'SevenGuardianCouncil':'Council',...(cfg.timelock?{timelock:'FTITimelock'}:{})},read={};
await Promise.all(Object.entries(names).map(async([key,name])=>{read[key]=new Contract(cfg[key],await json('/abi/'+name),rpc);}));
let signer,address,state,busy=false,connecting=false,transactionAddress,refreshSequence=0,autoDirty=false,councilOwner=false;
let lockOffset=0;
const ranks=['Member','Builder 1','Builder 2','Builder 3','Builder 4'];
const thresholds=[100n,200n,500n,1000n];
const explorer=cfg.chainId===97?'https://testnet.bscscan.com':null;
const fmt=(value,digits=2)=>value===undefined?'—':Number(formatEther(value)).toLocaleString('en-US',{maximumFractionDigits:digits});
const integer=value=>BigInt(value).toLocaleString('en-US');
const utc=value=>new Date(Number(value)*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
const short=value=>value.slice(0,6)+'…'+value.slice(-4);
function status(message,error=false){text('status',message);$('#status').classList.toggle('error',error);}
function reason(error){if(error.code===4001||error.code==='ACTION_REJECTED')return 'Request cancelled in your wallet.';return error.reason||error.shortMessage||error.message||'The request could not be completed.';}
function wallet(){return address&&state?.wallet?.address?.toLowerCase()===address.toLowerCase()?state.wallet:null;}
function syncActions(){
 const w=wallet();const enabled={council:!!signer&&councilOwner,wallet:!!signer,member:!!signer&&!!w?.exists,buyer:!!signer&&BigInt(w?.units||0)>0n,reward:!!signer&&BigInt(w?.claimable||0)>0n,unlocked:!!signer&&BigInt(w?.unlocked||0)>0n,auto:!!signer&&BigInt(w?.autoPending||0)>0n};
 document.querySelectorAll('[data-write]').forEach(button=>{button.disabled=busy||button.dataset.executed==='true'||(button.dataset.requires&&!enabled[button.dataset.requires]);});
 if(cfg.batchedRewards)$('#reward-all').disabled=busy||!signer||!state||BigInt(state.rewardQueue||0)===0n||Number(state.phase)!==0||Number(state.monthPhase)!==0;
 $('#connect').disabled=busy||connecting;$('#local-accounts').disabled=busy||connecting;
 $('#copy-address').disabled=!address;$('#copy-referral').disabled=!w?.exists;
 $('#max-sell').disabled=busy||!enabled.unlocked;
 $('#locks-prev').disabled=busy||lockOffset===0;$('#locks-next').disabled=busy||lockOffset+64>=Number(w?.lockCount||0);
}
function write(key){if(!signer||!address)throw Error('Connect your wallet first.');if(transactionAddress&&address!==transactionAddress)throw Error('Wallet changed. Please review the action and try again.');return read[key].connect(signer);}
async function transaction(fn){
 if(busy)return;if(!signer){status('Connect your wallet first.',true);return;}
 busy=true;transactionAddress=address;syncActions();$('#transaction-link').hidden=true;status('Refreshing wallet data before your request…');
 try{await refresh();if(address!==transactionAddress)throw Error('Wallet changed. Try again.');status('Review the request in your wallet.');await fn();await refresh();status('Transaction confirmed on-chain.');}
 catch(error){status(reason(error),true);}
 finally{busy=false;transactionAddress=null;syncActions();}
}
async function send(promise){
 const tx=await promise;status('Transaction submitted. Waiting for confirmation… '+short(tx.hash));
 if(explorer){$('#transaction-link').href=explorer+'/tx/'+tx.hash;$('#transaction-link').hidden=false;}
 const receipt=await tx.wait();if(!receipt||receipt.status!==1)throw Error('Transaction was not confirmed successfully.');return receipt;
}
async function approve(spender,amount){
 const current=await read.usd.allowance(address,spender);
 if(current<amount){status('Approve test USD spending in your wallet.');if(current>0n)await send(write('usd').approve(spender,0));await send(write('usd').approve(spender,amount));}
}
async function connect({silent=false}={}){
 if(connecting||busy)return;connecting=true;syncActions();
 try{
  let nextSigner;
  if(cfg.mode==='local')nextSigner=await rpc.getSigner($('#local-accounts').value);
  else{
   if(!window.ethereum)throw Error('Open this site in your wallet’s browser or use a browser with a wallet extension.');
   const accounts=await window.ethereum.request({method:silent?'eth_accounts':'eth_requestAccounts'});if(!accounts.length)return;
   const chain=Number(await window.ethereum.request({method:'eth_chainId'}));
   if(chain!==cfg.chainId){if(silent)throw Error('Switch your wallet to BNB Testnet and connect again.');try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x'+cfg.chainId.toString(16)}]});}catch{throw Error('Switch your wallet to BNB Smart Chain Testnet (chain ID 97), then connect again.');}}
   const provider=new BrowserProvider(window.ethereum);if(Number((await provider.getNetwork()).chainId)!==cfg.chainId)throw Error('Wallet network does not match this deployment.');nextSigner=await provider.getSigner();
  }
  const nextAddress=await nextSigner.getAddress();if(address!==nextAddress){autoDirty=false;councilOwner=false;}signer=nextSigner;address=nextAddress;text('connect-label',short(address));try{sessionStorage.setItem(cfg.mode==='local'?'fti-local-account':'fti-wallet-connected',cfg.mode==='local'?address:'yes');}catch{}await refresh();status('Wallet connected. Contract data loaded.');
 }catch(error){status(reason(error),true);}finally{connecting=false;syncActions();}
}
$('#connect').onclick=connect;
if(window.ethereum){window.ethereum.on?.('accountsChanged',()=>{try{sessionStorage.removeItem('fti-wallet-connected');}catch{}signer=null;address=null;state=null;autoDirty=false;councilOwner=false;refreshSequence++;renderWallet();syncActions();text('connect-label','Connect wallet');status('Wallet account changed. Connect to continue.');refresh().catch(e=>status(reason(e),true));});window.ethereum.on?.('chainChanged',()=>location.reload());}
if(cfg.mode==='local'){
 $('#local-accounts').hidden=false;$('#dev-controls').hidden=false;
 cfg.accounts.forEach((a,i)=>{const option=document.createElement('option');option.value=a;option.textContent=`${i+1}. ${i<31?'Genesis':i<36?'Council':'New member'} ${short(a)}`;$('#local-accounts').append(option);});
 try{const saved=sessionStorage.getItem('fti-local-account');if(cfg.accounts.includes(saved))$('#local-accounts').value=saved;}catch{}
 $('#local-accounts').onchange=connect;
}
const network=cfg.mode==='local'?'Local chain · 31337':'BNB Testnet · 97';text('network-name',network);text('account-network',network);text('token-network',network);
const titles={'token-home':'FTI token',overview:'Overview',network:'Membership & network',trade:'Buy & sell FTI',rewards:'Your rewards',activity:'Protocol activity',admin:'Governance & settlement'};
function navigate(page,focus=false){
 if(!titles[page])page=defaultPage;
 if(!surfacePages.some(([id])=>id===page)){location.assign(pagePath(page));return;}document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==page);
 document.querySelectorAll('[data-page]').forEach(button=>{const active=button.dataset.page===page;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 text('page-title',titles[page]);document.title=titles[page]+' · FTI Protocol';
 if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);
 if(focus){$('#page-title').focus({preventScroll:true});$('#main').scrollIntoView({behavior:'instant'});}
 if(page==='activity')loadEvents();if(page==='admin')loadProposals();
}
document.querySelectorAll('[data-page],[data-go]').forEach(button=>button.onclick=()=>navigate(button.dataset.page||button.dataset.go,true));
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
$('#theme').onclick=()=>{document.body.classList.toggle('light');try{localStorage.setItem('fti-theme',document.body.classList.contains('light')?'light':'dark');}catch{}};
try{if(localStorage.getItem('fti-theme')==='light')document.body.classList.add('light');}catch{}
async function refresh(){
 const sequence=++refreshSequence,requestedAddress=address;
 const [d,isOwner]=await Promise.all([json('/api/state'+(requestedAddress?'?wallet='+encodeURIComponent(requestedAddress):'')),requestedAddress&&surface==='admin'?(v3Model?read.council.isGuardian(requestedAddress):read.council.isOwner(requestedAddress)):Promise.resolve(false)]);
 if(requestedAddress&&cfg.lockVersion===2){if(state?.wallet?.address!==requestedAddress||lockOffset>=Number(d.wallet.lockCount))lockOffset=0;if(lockOffset>0){const page=await json('/api/locks?wallet='+requestedAddress+'&offset='+lockOffset);d.wallet.locks=page.locks;d.wallet.lockCount=page.total;}}
 if(sequence!==refreshSequence||requestedAddress!==address)return;
 state=d;councilOwner=isOwner;if(cfg.batchedRewards)text('reward-queue',integer(d.rewardQueue||0)+' wallets awaiting cash payout');if(reserveModel)text('token-anchor',fmt(d.anchorSupply,6));
 if(fundedModel){text('point-retained',fmt(d.pointRetained));text('builder-retained',fmt(d.builderRetained));}
 for(const[id,value]of Object.entries({'token-spot':fmt(d.price,6),'token-reserve':fmt(d.reserve),'token-supply':fmt(d.supply),'token-bb':fmt(d.bb),'token-floor':fmt(d.floor),'token-status':d.tokenPaused?'Paused':'Active',price:fmt(d.price,6),reserve:fmt(d.reserve),reserve2:fmt(d.reserve),members:integer(d.count),'point-pool':fmt(d.pointPool),buyback:fmt(d.bb),floor:fmt(d.floor),supply:fmt(d.supply),epoch:'Epoch '+integer(d.epoch),phase:['Accepting deposits','Matching points','Allocating rewards'][d.phase]||'Processing',protection:integer(d.level),'epoch-end':utc(d.epochEnd),accounting:d.account1[0]===d.account1[1]&&d.account2[0]===d.account2[1]?'Balanced':'Review required',queue:`Volume queue: ${d.jobCursor} / ${d.jobCount}\nSettlement phase: ${d.phase} · Member cursor: ${d.cursor}`,'lock-clock':v3Model?'No time locks':'Wallet counter '+integer(d.clock),'updated-at':'Updated '+new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}))text(id,value);
 renderWallet();syncActions();
}
function renderWallet(){
 text('admin-role',!address?'READ ONLY':councilOwner?'COUNCIL OWNER':'PUBLIC CALLER');text('admin-access-copy',!address?'Connect a wallet to check its council role.':councilOwner?'Your connected wallet can propose and approve council actions. '+(v3Model?'Five of seven guardian approvals are required.':'Three approvals are required to execute a proposal.')+'':'This wallet is not a council owner. You can process settlement and execute operations that are already authorized and ready.');
 const w=wallet();const locked=w?BigInt(w.ftiBalance)-BigInt(w.unlocked):0n;
 if(fundedModel)text('wallet-credits',w?fmt(w.creditL)+' / '+fmt(w.creditR):'—');
 const count=Number(w?.lockCount||0);$('#lock-pagination').hidden=cfg.lockVersion!==2||count<=64;$('#locks-prev').disabled=busy||lockOffset===0;$('#locks-next').disabled=busy||lockOffset+64>=count;text('lock-page-label',count?`${lockOffset+1}–${Math.min(lockOffset+64,count)} of ${count}`:'No active locks');
 for(const[id,value]of Object.entries({claimable:w?fmt(w.claimable):'—','reward-claimable':w?fmt(w.claimable):'—',rank:w?.exists?ranks[w.rank]:address?'Not registered':'Not connected','wallet-address':address||'No wallet connected','usd-balance':w?fmt(w.usdBalance):'—','fti-balance':w?fmt(w.ftiBalance,5):'—',unlocked:w?fmt(w.unlocked,5):'—',allowance:w?fmt(w.remaining):'—',units:w?integer(w.units):'—','account-units':w?integer(w.units):'—',lifetime:w?`${integer(w.lifetimeL)} / ${integer(w.lifetimeR)}`:'—',carry:w?`${integer(w.carryL)} / ${integer(w.carryR)}`:'—','auto-pending':w?fmt(w.autoPending):'—','trade-balance':w?fmt(w.ftiBalance,5):'—','trade-unlocked':w?fmt(w.unlocked,5):'—','trade-locked':w?fmt(locked,5):'—','locked-summary':w?fmt(locked,5)+' FTI locked':'Connect to view token locks','buy-available':w?`Balance: ${fmt(w.usdBalance)} USD · Allowance: ${fmt(w.remaining)} USD`:'Connect to view your balance and allowance.','sell-available':w?'Available: '+fmt(w.unlocked,6)+' FTI':'Available: — FTI','membership-status':w?.exists?'Registered member':address?'Not registered':'Not connected','auto-status':w?.exists?(w.autoEnabled?'Enabled':'Disabled'):'Not connected'}))text(id,value);
 text('welcome-copy',w?.exists?'Your membership, tokens and rewards — connected to your wallet and read directly from the chain.':'Connect a wallet, get test assets and register with a sponsor to begin.');
 const matched=w?(BigInt(w.lifetimeL)<BigInt(w.lifetimeR)?BigInt(w.lifetimeL):BigInt(w.lifetimeR)):0n;
 const next=thresholds[w?.rank||0];const previous=Number(w?.rank)>0?thresholds[Number(w.rank)-1]:0n;
 $('#rank-progress').value=w?.exists?(next?Math.max(0,Math.min(100,Number((matched-previous)*100n/(next-previous)))):100):0;
 text('rank-description',w?.exists?(next?'Progress is based on your weaker lifetime branch.':'You have reached the highest current rank.'):'Register with a sponsor to start your membership.');
 text('rank-points',w?.exists?integer(matched)+' lifetime points':'— lifetime points');text('rank-next',w?.exists?(next?'Next: '+integer(next):'Top rank'):'—');
 text('trade-notice',!address?'Connect a registered wallet to trade.':!w?.exists?'Register your wallet in Membership before buying FTI.':BigInt(w?.units||0)===0n?'Add at least one membership unit before buying FTI.':state?.tokenPaused?'Token trading is currently paused by the contract.':BigInt(w?.ftiBalance||0)>0n&&BigInt(w?.unlocked||0)===0n?'Your FTI is locked. Selling becomes available when a tranche reaches its wallet threshold or UTC deadline below.':'Buy, sell or transfer through your wallet. Every transaction requires your approval.');
 const registered=!!w?.exists;const form=$('#register-form');form.elements.sponsor.disabled=registered;
 text('registration-title',registered?'Add membership units':'Join the network');text('register-button',registered?'Add units':'Register membership');
 text('sponsor-help',registered?'Your sponsor and position stay unchanged when you add units.':'New positions fill the sponsor’s left slot first, then the right. Both slots must not be full.');
 for(const[id,done]of [['step-wallet',!!signer],['step-funds',BigInt(w?.usdBalance||0)>0n],['step-member',registered]])$('#'+id).classList.toggle('done',done);
 $('#referral-link').value=registered?location.origin+'/app/?sponsor='+address+'#network':'';
 $('#tree').replaceChildren();for(const[label,key]of [['Sponsor','parent'],['Left branch','left'],['Right branch','right']]){const node=document.createElement('div');node.textContent=label;const value=document.createElement('small');value.textContent=w&&w[key]!==ZeroAddress?w[key]:w?'Empty position':'Connect to view';node.append(value);$('#tree').append(node);}
 $('#locks').replaceChildren();
 if(w?.locks.length){for(const l of w.locks){const tr=document.createElement('tr');for(const value of [fmt(l.amount,6),integer(l.clock),utc(l.deadline),BigInt(state.clock)>=BigInt(l.clock)||state.timestamp>=Number(l.deadline)?'Unlocked':'Locked']){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('#locks').append(tr);}}
 else{const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent=v3Model?'V3 does not create time or wallet-count lock tranches.':address?'No token lock tranches recorded.':'Connect a wallet to see its unlock schedule.';tr.append(td);$('#locks').append(tr);}
 if(w&&!autoDirty){$('#auto-form').elements.enabled.checked=w.autoEnabled;if(BigInt(w.maxAutoPrice)>0n)$('#auto-form').elements.price.value=formatEther(w.maxAutoPrice);}
}
$('#reward-all-panel').hidden=!cfg.batchedRewards;
$('#reward-all').onclick=()=>transaction(()=>send(write('binary').payRewards(100)));
$('#refresh-state').onclick=async()=>{try{await refresh();status('Contract data refreshed.');}catch(e){status(reason(e),true);}};
for(const[id,step]of [['locks-prev',-64],['locks-next',64]])$('#'+id).onclick=async()=>{lockOffset=Math.max(0,lockOffset+step);try{await refresh();}catch(e){status(reason(e),true);}};
async function copy(value,input){try{await navigator.clipboard.writeText(value);status('Copied to clipboard.');}catch{if(input){input.focus();input.select();status('The link is selected. Copy it from the text field.');}else{const range=document.createRange();range.selectNodeContents($('#wallet-address'));getSelection().removeAllRanges();getSelection().addRange(range);status('The address is selected. Copy the selected text.');}}}
$('#copy-address').onclick=()=>copy(address);$('#copy-referral').onclick=()=>copy($('#referral-link').value,$('#referral-link'));
const sponsor=new URLSearchParams(location.search).get('sponsor');if(sponsor&&isAddress(sponsor))$('#register-form').elements.sponsor.value=sponsor;
$('#register-form').elements.units.oninput=()=>{const raw=$('#register-form').elements.units.value;text('registration-cost',/^\d+$/.test(raw)?integer(BigInt(raw)*100n)+' test USD':'Enter whole units');};
for(const id of ['claim','claim-rewards'])$('#'+id).onclick=()=>transaction(()=>send(write('binary').claim()));
$('#faucet').onclick=()=>transaction(()=>send(write('usd').faucet()));
$('#register-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const f=e.target,n=BigInt(f.elements.units.value);if(n<1n||n>1000000n)throw Error('Enter between 1 and 1,000,000 whole units.');const w=wallet();if(!w)throw Error('Reload wallet data and try again.');const sponsorAddress=f.elements.sponsor.value.trim();if(!w.exists&&(!isAddress(sponsorAddress)||sponsorAddress===ZeroAddress))throw Error('Enter a valid sponsor address.');const cost=n*parseEther('100');if(cost>BigInt(w.usdBalance))throw Error('Not enough test USD. Use Get test USD on Overview.');await approve(cfg.binary,cost);await send(w.exists?write('binary').addUnits(n):write('binary').register(sponsorAddress,n));});};
$('#auto-form').addEventListener('input',()=>{autoDirty=true;});
$('#auto-form').onsubmit=e=>{e.preventDefault();const enabled=e.target.elements.enabled.checked,price=e.target.elements.price.value;transaction(async()=>{await send(write('binary').setAutoBuy(enabled,parseEther(price)));autoDirty=false;});};
$('#execute-auto').onclick=()=>transaction(()=>send(write('binary').executeAuto(address,BigInt(wallet().autoPending))));
$('#release-auto').onclick=()=>transaction(()=>send(write('binary').releaseAutoToCash()));
function amountInput(form){const amount=parseEther(form.elements.amount.value);const percent=Number(form.elements.slippage.value);if(amount<=0n||!Number.isFinite(percent)||percent<0||percent>5)throw Error('Enter a positive amount and slippage between 0% and 5%.');return[amount,BigInt(Math.round(percent*100))];}
for(const kind of ['buy','sell']){
 const form=$('#'+kind+'-form');let debounce,quoteSequence=0;
 const showQuote=()=>{clearTimeout(debounce);const sequence=++quoteSequence;text(kind+'-quote','Updating quote…');debounce=setTimeout(async()=>{try{const[a,slip]=amountInput(form);let output,fee;if(kind==='buy')output=await read.token.quoteBuy(a);else[output,fee]=await read.token.quoteSell(a);if(sequence!==quoteSequence)return;const minimum=output*(10000n-slip)/10000n;text(kind+'-quote',(kind==='buy'?'Estimated output: ':'Net proceeds: ')+fmt(output,6)+(kind==='buy'?' FTI':' test USD')+'\nMinimum accepted: '+fmt(minimum,6)+(kind==='buy'?' FTI':' test USD')+(fee!==undefined?(v3Model?' · Fee 3%':' · Fee '+Number(fee)/100+'%'):''));$('#'+kind+'-quote').classList.remove('invalid');}catch(error){if(sequence!==quoteSequence)return;text(kind+'-quote',form.elements.amount.value?'Quote unavailable. Check the amount or refresh contract data.':'Enter an amount for a live quote.');$('#'+kind+'-quote').classList.add('invalid');}},250);};
 form.elements.amount.oninput=showQuote;form.elements.slippage.oninput=showQuote;
 form.onsubmit=e=>{e.preventDefault();transaction(async()=>{const[a,slip]=amountInput(form),w=wallet();if(!w?.exists||BigInt(w.units)===0n)throw Error('Register or add membership units before trading.');if(state.tokenPaused)throw Error('Token trading is paused by the contract.');const deadline=BigInt(state.timestamp)+1200n;
  if(kind==='buy'){if(a>BigInt(w.usdBalance))throw Error('Not enough test USD in your wallet.');if(a>BigInt(w.remaining))throw Error('Amount exceeds your remaining manual purchase allowance.');const quote=await read.token.quoteBuy(a);await approve(cfg.token,a);await send(write('token').buy(a,quote*(10000n-slip)/10000n,deadline));}
  else{if(a>BigInt(w.unlocked))throw Error('Amount exceeds your unlocked balance. Check the unlock schedule.');const[q]=await read.token.quoteSell(a);await send(write('token').sell(a,q*(10000n-slip)/10000n,deadline));}
 });};
}
$('#max-sell').onclick=()=>{const form=$('#sell-form');form.elements.amount.value=formatEther(wallet().unlocked);form.elements.amount.dispatchEvent(new Event('input',{bubbles:true}));};
if(v3Model){
 const form=$('#transfer-form');let timer,sequence=0;
 form.elements.amount.oninput=()=>{clearTimeout(timer);const current=++sequence;text('transfer-quote','Updating transfer quote…');timer=setTimeout(async()=>{
  try{const amount=parseEther(form.elements.amount.value);if(amount<=0n)throw Error('Enter a positive amount.');const[received,burned]=await read.token.quoteTransfer(amount);if(current!==sequence)return;text('transfer-quote','Recipient receives: '+formatEther(received)+' FTI · Burned: '+formatEther(burned)+' FTI');}
  catch{if(current===sequence)text('transfer-quote',form.elements.amount.value?'Transfer quote unavailable. Check the amount and contract connection.':'Enter an amount to see the recipient amount and burn.');}
 },250);};
}
$('#transfer-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const to=e.target.elements.to.value.trim(),amount=parseEther(e.target.elements.amount.value);if(!isAddress(to)||to===ZeroAddress)throw Error('Enter a valid recipient address.');if(amount<=0n||amount>BigInt(wallet().unlocked))throw Error('Enter an amount within your unlocked token balance.');if(to.toLowerCase()===address.toLowerCase())throw Error('Choose a different recipient wallet.');if(!v3Model&&await read.binary.unitsOf(to)===0n)throw Error('The recipient must own at least one membership unit.');await send(write('token').transfer(to,amount));});};
for(const[id,method,arg]of [['volume','processVolume',50],['close-epoch','beginEpochClose'],['process-epoch','processEpoch',50],['begin-month','beginBuilderMonth'],['process-month','processBuilderMonth',50]])$('#'+id).onclick=()=>transaction(()=>send(write('binary')[method](...(arg?[arg]:[]))));
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
async function loadProposals(){try{const count=Number(await (v3Model?read.council.proposalCount():read.council.count()));$('#proposals').replaceChildren();if(!count)text('proposals','No governance proposals yet.');for(let i=count-1;i>=Math.max(0,count-20);i--){const p=await read.council.proposal(i),box=document.createElement('div');box.className='proposal';const title=document.createElement('p');title.textContent=`Proposal ${i} · ${p[2]} of ${v3Model?5:3} approvals · ${p[3]?'Executed':'Pending'}`;box.append(title);for(const[label,fn]of [['Approve',()=>write('council').approve(i)],['Execute proposal',()=>write('council').execute(i)]]){const button=document.createElement('button');button.className='secondary';button.textContent=label;button.dataset.write='';button.dataset.requires=label==='Approve'?'council':'wallet';button.dataset.executed=String(p[3]);button.onclick=()=>transaction(async()=>{await send(fn());await loadProposals();});box.append(button);}$('#proposals').append(box);}syncActions();}catch(error){text('proposals','Proposals could not be loaded. Reopen this section to retry.');status(reason(error),true);}}
$('#proposal-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const action=e.target.elements.action.value;let target,data;
 if(action==='emergencyUnwind'){target=cfg.token;data=read.token.interface.encodeFunctionData('activateEmergencyUnwind');}
 else if(action==='pauseBinary'||action==='pauseToken'){const key=action==='pauseBinary'?'binary':'token';target=cfg[key];data=read[key].interface.encodeFunctionData('pause');}
 else{const key=action==='unpauseBinary'?'binary':'token';const inner=read[key].interface.encodeFunctionData(action==='milestone'?'advancePriceMilestone':'unpause');target=cfg.timelock;data=read.timelock.interface.encodeFunctionData('schedule',[cfg[key],0,inner,ZeroHash,hexlify(randomBytes(32)),259200]);}
 await send(write('council').propose(target,data));await loadProposals();});};
$('#timelock-form').onsubmit=e=>{e.preventDefault();transaction(async()=>{const p=await read.council.proposal(BigInt(e.target.elements.id.value));if(p[0].toLowerCase()!==cfg.timelock.toLowerCase()||!p[3])throw Error('The scheduling proposal has not been executed.');const args=read.timelock.interface.decodeFunctionData('schedule',p[1]);await send(write('timelock').execute(args[0],args[1],args[2],args[3],args[4]));});};
text('token-address',cfg.token);$('#token-explorer').hidden=!explorer;if(explorer)$('#token-explorer').href=explorer+'/address/'+cfg.token;
renderWallet();syncActions();navigate(location.hash.slice(1)||((sponsor&&isAddress(sponsor))?'network':defaultPage));
try{if(cfg.mode==='local')await connect();else{await refresh();status('Contract data loaded. Connect a wallet to manage your account.');let reconnect=false;try{reconnect=sessionStorage.getItem('fti-wallet-connected')==='yes';}catch{}if(reconnect&&window.ethereum)await connect({silent:true});}}catch(error){status(reason(error),true);}
setInterval(()=>{if(!busy&&!connecting)refresh().catch(error=>status('Connection unavailable: '+reason(error),true));},15000);
