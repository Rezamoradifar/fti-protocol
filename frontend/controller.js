import {
  JsonRpcProvider,BrowserProvider,Contract,parseEther,formatEther,
  ZeroAddress,isAddress
} from '/vendor/ethers.js';
import {surface,surfacePages,defaultPage,pagePath} from './surfaces.js';

const $=selector=>document.querySelector(selector);
const text=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
async function json(url,options){
  const response=await fetch(url,{signal:AbortSignal.timeout(25000),cache:'no-store',...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Unable to read V3 contract data.');
  return data;
}

const cfg=await json('/api/config');
if(cfg.tokenContract!=='FTIReserveTokenV3'||cfg.binaryContract!=='FundedBinaryPlan'||cfg.councilContract!=='SevenGuardianCouncil'){
  throw Error('This workspace requires an FTI V3 deployment.');
}

const rpc=new JsonRpcProvider(location.origin+'/rpc',undefined,{cacheTimeout:-1});
rpc.pollingInterval=1000;

const names={
  binary:'FundedBinaryPlan',
  token:'FTIReserveTokenV3',
  usd:'MockUSD',
  council:'SevenGuardianCouncil'
};

const read={};
await Promise.all(Object.entries(names).map(async([key,name])=>{
  read[key]=new Contract(cfg[key],await json('/abi/'+name),rpc);
}));

let signer,address,state,busy=false,connecting=false,transactionAddress;
let refreshSequence=0,autoDirty=false,councilMember=false,governanceMember=false;

const ranks=['Member','Builder 1','Builder 2','Builder 3','Builder 4'];
const thresholds=[100n,200n,500n,1000n];
const explorer=Number(cfg.chainId)===97?'https://testnet.bscscan.com':null;

const fmt=(value,digits=2)=>{
  if(value===undefined||value===null)return '—';
  return Number(formatEther(value)).toLocaleString('en-US',{maximumFractionDigits:digits});
};
const integer=value=>value===undefined||value===null?'—':BigInt(value).toLocaleString('en-US');
const pct=bps=>(Number(bps)/100).toLocaleString('en-US',{maximumFractionDigits:2})+'%';
const utc=value=>new Date(Number(value)*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
const short=value=>value?value.slice(0,6)+'…'+value.slice(-4):'—';

function status(message,error=false){
  text('status',message);
  $('#status')?.classList.toggle('error',error);
}

function reason(error){
  if(error?.code===4001||error?.code==='ACTION_REJECTED')return 'Request cancelled in your wallet.';
  return error?.reason||error?.shortMessage||error?.message||'The request could not be completed.';
}

function wallet(){
  return address&&state?.wallet?.address?.toLowerCase()===address.toLowerCase()?state.wallet:null;
}

function syncActions(){
  const w=wallet();
  const enabled={
    council:!!signer&&councilMember,
    governance:!!signer&&governanceMember,
    wallet:!!signer,
    member:!!signer&&!!w?.exists,
    buyer:!!signer&&BigInt(w?.units||0)>0n&&!state?.emergencyUnwind,
    reward:!!signer&&BigInt(w?.claimable||0)>0n,
    unlocked:!!signer&&BigInt(w?.ftiBalance||0)>0n&&!state?.emergencyUnwind,
    auto:!!signer&&BigInt(w?.autoPending||0)>0n&&!state?.emergencyUnwind
  };

  document.querySelectorAll('[data-write]').forEach(button=>{
    button.disabled=busy||button.dataset.executed==='true'||
      (button.dataset.requires&&!enabled[button.dataset.requires]);
  });

  if($('#connect'))$('#connect').disabled=busy||connecting;
  if($('#local-accounts'))$('#local-accounts').disabled=busy||connecting;
  if($('#copy-address'))$('#copy-address').disabled=!address;
  if($('#copy-referral'))$('#copy-referral').disabled=!w?.exists;
  if($('#max-sell'))$('#max-sell').disabled=busy||!enabled.unlocked;
}

function write(key){
  if(!signer||!address)throw Error('Connect your wallet first.');
  if(transactionAddress&&address!==transactionAddress)throw Error('Wallet changed. Review the action and try again.');
  return read[key].connect(signer);
}

async function send(promise){
  const tx=await promise;
  status('Transaction submitted. Waiting for confirmation… '+short(tx.hash));
  if(explorer&&$('#transaction-link')){
    $('#transaction-link').href=explorer+'/tx/'+tx.hash;
    $('#transaction-link').hidden=false;
  }
  const receipt=await tx.wait();
  if(!receipt||receipt.status!==1)throw Error('Transaction was not confirmed successfully.');
  return receipt;
}

async function transaction(fn){
  if(busy)return;
  if(!signer){status('Connect your wallet first.',true);return;}

  busy=true;
  transactionAddress=address;
  syncActions();
  if($('#transaction-link'))$('#transaction-link').hidden=true;

  try{
    await refresh();
    if(address!==transactionAddress)throw Error('Wallet changed. Try again.');
    status('Review the request in your wallet.');
    await fn();
    await refresh();
    status('Transaction confirmed on-chain.');
  }catch(error){
    status(reason(error),true);
  }finally{
    busy=false;
    transactionAddress=null;
    syncActions();
  }
}

async function approve(spender,amount){
  const current=await read.usd.allowance(address,spender);
  if(current<amount){
    status('Approve test USD spending in your wallet.');
    if(current>0n)await send(write('usd').approve(spender,0));
    await send(write('usd').approve(spender,amount));
  }
}

async function connect({silent=false}={}){
  if(connecting||busy)return;
  connecting=true;
  syncActions();

  try{
    let nextSigner;

    if(cfg.mode==='local'){
      nextSigner=await rpc.getSigner($('#local-accounts').value);
    }else{
      if(!window.ethereum)throw Error('Open this site in a wallet browser or a browser with a wallet extension.');
      const accounts=await window.ethereum.request({method:silent?'eth_accounts':'eth_requestAccounts'});
      if(!accounts.length)return;

      const chain=Number(await window.ethereum.request({method:'eth_chainId'}));
      if(chain!==Number(cfg.chainId)){
        if(silent)throw Error('Switch your wallet to BNB Testnet and connect again.');
        try{
          await window.ethereum.request({
            method:'wallet_switchEthereumChain',
            params:[{chainId:'0x'+Number(cfg.chainId).toString(16)}]
          });
        }catch{
          throw Error('Switch your wallet to BNB Smart Chain Testnet (chain ID 97), then connect again.');
        }
      }

      const browserProvider=new BrowserProvider(window.ethereum);
      if(Number((await browserProvider.getNetwork()).chainId)!==Number(cfg.chainId))throw Error('Wallet network does not match this deployment.');
      nextSigner=await browserProvider.getSigner();
    }

    const nextAddress=await nextSigner.getAddress();
    if(address!==nextAddress){autoDirty=false;councilMember=false;governanceMember=false;}
    signer=nextSigner;
    address=nextAddress;
    text('connect-label',short(address));

    try{
      sessionStorage.setItem(cfg.mode==='local'?'fti-v3-local-account':'fti-v3-wallet-connected',cfg.mode==='local'?address:'yes');
    }catch{}

    await refresh();
    status('Wallet connected. V3 contract data loaded.');
  }catch(error){
    status(reason(error),true);
  }finally{
    connecting=false;
    syncActions();
  }
}

$('#connect').onclick=()=>connect();

if(window.ethereum){
  window.ethereum.on?.('accountsChanged',()=>{
    try{sessionStorage.removeItem('fti-v3-wallet-connected');}catch{}
    signer=null;address=null;state=null;autoDirty=false;councilMember=false;governanceMember=false;
    refreshSequence++;
    renderWallet();
    syncActions();
    text('connect-label','Connect wallet');
    status('Wallet account changed. Connect again to continue.');
    refresh().catch(error=>status(reason(error),true));
  });
  window.ethereum.on?.('chainChanged',()=>location.reload());
}

if(cfg.mode==='local'&&Array.isArray(cfg.accounts)){
  $('#local-accounts').hidden=false;
  $('#dev-controls').hidden=false;
  cfg.accounts.forEach((account,i)=>{
    const option=document.createElement('option');
    option.value=account;
    option.textContent=`${i+1}. ${i<31?'Genesis':i<38?'DAO test signer':'Test wallet'} ${short(account)}`;
    $('#local-accounts').append(option);
  });
  try{
    const saved=sessionStorage.getItem('fti-v3-local-account');
    if(cfg.accounts.includes(saved))$('#local-accounts').value=saved;
  }catch{}
  $('#local-accounts').onchange=()=>connect();
}

const network=cfg.mode==='local'?'Local V3 · 31337':'BNB Testnet · 97';
text('network-name',network);
text('account-network',network);
text('token-network',network);

const titles={
  'token-home':'FTI V3 token',
  overview:'Overview',
  network:'Membership & network',
  trade:'Buy & sell FTI',
  rewards:'Funded rewards',
  activity:'Protocol activity',
  admin:'5-of-7 DAO & settlement'
};

function navigate(page,focus=false){
  if(!titles[page])page=defaultPage;

  if(!surfacePages.some(([id])=>id===page)){
    location.assign(pagePath(page));
    return;
  }

  document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!==page);
  document.querySelectorAll('[data-page]').forEach(button=>{
    const active=button.dataset.page===page;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });

  text('page-title',titles[page]);
  document.title=titles[page]+' · FTI Protocol V3';
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);

  if(focus){
    $('#page-title').focus({preventScroll:true});
    $('#main').scrollIntoView({behavior:'instant'});
  }

  if(page==='activity')loadEvents();
  if(page==='admin')loadProposals();
}

document.querySelectorAll('[data-page],[data-go]').forEach(button=>{
  button.onclick=()=>navigate(button.dataset.page||button.dataset.go,true);
});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));

$('#theme').onclick=()=>{
  document.body.classList.toggle('light');
  try{localStorage.setItem('fti-theme',document.body.classList.contains('light')?'light':'dark');}catch{}
};
try{if(localStorage.getItem('fti-theme')==='light')document.body.classList.add('light');}catch{}

function effectiveMaxSellTokens(w,d){
  if(!w)return 0n;

  const balance=BigInt(w.ftiBalance||0);
  const single=BigInt(w.maxSingleSellTokens||0);
  if(balance===0n||single===0n)return 0n;

  const reserve=BigInt(d.reserve||0);
  const supply=BigInt(d.supply||0);
  const hourlyRemaining=BigInt(d.hourlyOutflowRemaining||0);
  if(reserve===0n||supply===0n||hourlyRemaining===0n)return balance<single?balance:single;

  // payout is ~97% of gross. Stay one basis point inside the calculated ceiling.
  const grossByHour=hourlyRemaining*10000n/9700n;
  const tokensByHour=grossByHour*supply/reserve;
  let out=balance<single?balance:single;
  if(tokensByHour<out)out=tokensByHour;
  return out*9999n/10000n;
}

async function refresh(){
  const sequence=++refreshSequence;
  const requestedAddress=address;

  const statePromise=json('/api/state'+(requestedAddress?'?wallet='+encodeURIComponent(requestedAddress):''));
  const rolePromise=requestedAddress
    ?Promise.all([
      read.council.isGuardian(requestedAddress),
      Promise.resolve(requestedAddress.toLowerCase()===String(cfg.governance||'').toLowerCase())
    ])
    :Promise.resolve([false,false]);

  const [d,[isGuardian,isGovernance]]=await Promise.all([statePromise,rolePromise]);
  if(sequence!==refreshSequence||requestedAddress!==address)return;

  state=d;
  councilMember=Boolean(isGuardian);
  governanceMember=Boolean(isGovernance);

  const tokenState=d.emergencyUnwind?'Emergency unwind':d.tokenPaused?'Paused':'Active';
  const healthy=BigInt(d.account1[0])>=BigInt(d.account1[1])&&BigInt(d.account2[0])>=BigInt(d.account2[1]);

  const values={
    'token-spot':fmt(d.price,6),
    'token-reserve':fmt(d.reserve),
    'token-support':fmt(d.supportReserve),
    'token-supply':fmt(d.supply,6),
    'token-status':tokenState,
    'launch-price':BigInt(d.launchPrice||0)>0n?fmt(d.launchPrice,6):'Not launched',
    'token-builder-multiplier':integer(d.builderMultiplier)+'×',
    'token-max-single':pct(d.maxSingleSellBps)+' of reserve',
    'token-hourly-limit':pct(d.maxHourlyOutflowBps)+' / hour',
    'animal-a':d.animalWalletA,
    'animal-b':d.animalWalletB,
    price:fmt(d.price,6),
    reserve:fmt(d.reserve),
    'support-reserve':fmt(d.supportReserve),
    reserve2:fmt(d.reserve),
    support2:fmt(d.supportReserve),
    supply:fmt(d.supply,6),
    members:integer(d.count),
    'point-pool':fmt(d.pointPool),
    'point-retained':fmt(d.pointRetained),
    'builder-retained':fmt(d.builderRetained),
    'builder-multiplier':integer(d.builderMultiplier)+'×',
    epoch:'Epoch '+integer(d.epoch),
    phase:['Accepting deposits','Matching points','Allocating rewards'][Number(d.phase)]||'Processing',
    protection:integer(d.level),
    'epoch-end':utc(d.epochEnd),
    accounting:healthy?'Backed':'Review required',
    queue:`Volume queue: ${integer(d.jobCursor)} / ${integer(d.jobCount)}\nSettlement phase: ${integer(d.phase)} · Member cursor: ${integer(d.cursor)}\nReward queue remaining: ${integer(d.rewardQueueRemaining||0)}`,
    'hourly-outflow':fmt(d.sellWindowOutflow),
    'hourly-remaining':fmt(d.hourlyOutflowRemaining),
    'charity-status':Number(d.charityBps||0)===0?'Disabled · 0%':pct(d.charityBps),
    'updated-at':'Updated '+new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
  };

  for(const [id,value] of Object.entries(values))text(id,value);
  renderWallet();
  renderRoles();
  syncActions();
}

function renderRoles(){
  let role='PUBLIC CALLER';
  if(councilMember&&governanceMember)role='DAO + GOVERNANCE';
  else if(councilMember)role='PARTNER DAO';
  else if(governanceMember)role='GOVERNANCE';
  else if(!address)role='READ ONLY';

  text('admin-role',role);

  if(!address)text('admin-access-copy','Connect a wallet to check Partner DAO or governance access.');
  else if(councilMember)text('admin-access-copy','This wallet can create and approve 5-of-7 Partner DAO proposals.');
  else if(governanceMember)text('admin-access-copy','This wallet can perform governance-only unpause actions. It cannot rescue protected reserve collateral.');
  else text('admin-access-copy','This wallet has no privileged governance role. Permissionless settlement remains available.');

  const list=$('#guardian-list');
  if(list){
    list.replaceChildren();
    for(const [i,g] of (cfg.daoPartners||[]).entries()){
      const row=document.createElement('div');
      row.textContent=`Partner ${i+1}`;
      const code=document.createElement('code');
      code.textContent=g;
      row.append(code);
      if(address&&g.toLowerCase()===address.toLowerCase())row.classList.add('active');
      list.append(row);
    }
  }
}

function renderWallet(){
  const w=wallet();
  const registered=!!w?.exists;
  const maxSell=w&&state?effectiveMaxSellTokens(w,state):0n;

  const values={
    claimable:w?fmt(w.claimable):'—',
    'reward-claimable':w?fmt(w.claimable):'—',
    rank:registered?ranks[Number(w.rank)]:address?'Not registered':'Not connected',
    'wallet-address':address||'No wallet connected',
    'usd-balance':w?fmt(w.usdBalance):'—',
    'fti-balance':w?fmt(w.ftiBalance,5):'—',
    unlocked:w?fmt(w.ftiBalance,5):'—',
    allowance:w?fmt(w.remaining):'—',
    units:w?integer(w.units):'—',
    'account-units':w?integer(w.units):'—',
    lifetime:w?`${integer(w.lifetimeL)} / ${integer(w.lifetimeR)}`:'—',
    carry:w?`${integer(w.carryL)} / ${integer(w.carryR)}`:'—',
    'auto-pending':w?fmt(w.autoPending):'—',
    'trade-balance':w?fmt(w.ftiBalance,5):'—',
    'trade-unlocked':w?fmt(w.ftiBalance,5):'—',
    'anti-whale-single':w?fmt(maxSell,5):'—',
    'locked-summary':w?'No token lock in V3':'V3 has no token lock',
    'buy-available':w?`Balance: ${fmt(w.usdBalance)} USD · Allowance: ${fmt(w.remaining)} USD`:'Connect to view your balance and allowance.',
    'sell-available':w?`Allowed now: up to ${fmt(maxSell,6)} FTI`:'Available: — FTI',
    'membership-status':registered?'Registered member':address?'Not registered':'Not connected',
    'auto-status':registered?(w.autoEnabled?'Enabled':'Disabled'):'Not connected',
    'wallet-credits':w?`${fmt(w.creditL)} / ${fmt(w.creditR)}`:'—'
  };
  for(const [id,value] of Object.entries(values))text(id,value);

  text('welcome-copy',registered
    ?'Your funded membership, FTI V3 balance and rewards are read directly from the chain.'
    :'Connect a wallet, get test assets and register with a sponsor to begin.');

  const matched=w?(BigInt(w.lifetimeL)<BigInt(w.lifetimeR)?BigInt(w.lifetimeL):BigInt(w.lifetimeR)):0n;
  const rankIndex=Number(w?.rank||0);
  const next=thresholds[rankIndex];
  const previous=rankIndex>0?thresholds[rankIndex-1]:0n;
  $('#rank-progress').value=registered
    ?(next?Math.max(0,Math.min(100,Number((matched-previous)*100n/(next-previous)))):100)
    :0;

  text('rank-description',registered
    ?(next?'Progress is based on the weaker lifetime branch.':'Highest current Builder rank reached.')
    :'Activate membership to start rank progression.');
  text('rank-points',registered?integer(matched)+' lifetime points':'— lifetime points');
  text('rank-next',registered?(next?'Next: '+integer(next):'Top rank'):'—');

  if(state?.emergencyUnwind){
    text('trade-notice','Emergency unwind is active. Normal buying, selling and transfers are permanently disabled; holder redemption must use the emergency redemption flow.');
  }else if(!address){
    text('trade-notice','Connect a registered wallet to trade.');
  }else if(!registered){
    text('trade-notice','Register your wallet in Membership before buying FTI.');
  }else if(BigInt(w.units||0)===0n){
    text('trade-notice','Add at least one membership unit before buying FTI.');
  }else if(state?.tokenPaused){
    text('trade-notice','Token trading is currently paused by the contract.');
  }else{
    text('trade-notice','V3 has no token lock. Slippage, 5% single-sale protection and the hourly circuit breaker are enforced on-chain.');
  }

  const form=$('#register-form');
  if(form){
    form.elements.sponsor.disabled=registered;
    text('registration-title',registered?'Add membership units':'Join the network');
    text('register-button',registered?'Add units':'Register membership');
    text('sponsor-help',registered
      ?'Your sponsor and tree position stay unchanged when adding units.'
      :'New positions fill the sponsor’s left slot first, then right.');
  }

  for(const [id,done] of [
    ['step-wallet',!!signer],
    ['step-funds',BigInt(w?.usdBalance||0)>0n],
    ['step-member',registered&&BigInt(w?.units||0)>0n]
  ])$('#'+id)?.classList.toggle('done',done);

  if($('#referral-link'))$('#referral-link').value=registered?location.origin+'/app/?sponsor='+address+'#network':'';

  const tree=$('#tree');
  if(tree){
    tree.replaceChildren();
    for(const [label,key] of [['Sponsor','parent'],['Left branch','left'],['Right branch','right']]){
      const node=document.createElement('div');
      node.textContent=label;
      const value=document.createElement('small');
      value.textContent=w&&w[key]!==ZeroAddress?w[key]:w?'Empty position':'Connect to view';
      node.append(value);
      tree.append(node);
    }
  }

  if(w&&!autoDirty){
    $('#auto-form').elements.enabled.checked=w.autoEnabled;
    if(BigInt(w.maxAutoPrice)>0n)$('#auto-form').elements.price.value=formatEther(w.maxAutoPrice);
  }
}

$('#refresh-state').onclick=async()=>{
  try{await refresh();status('V3 contract data refreshed.');}
  catch(error){status(reason(error),true);}
};

async function copy(value,input){
  try{
    await navigator.clipboard.writeText(value);
    status('Copied to clipboard.');
  }catch{
    if(input){input.focus();input.select();status('Text selected. Copy it from the field.');}
    else status('Clipboard access is unavailable in this browser.',true);
  }
}

$('#copy-address').onclick=()=>copy(address);
$('#copy-referral').onclick=()=>copy($('#referral-link').value,$('#referral-link'));

const sponsor=new URLSearchParams(location.search).get('sponsor');
if(sponsor&&isAddress(sponsor))$('#register-form').elements.sponsor.value=sponsor;

$('#register-form').elements.units.oninput=()=>{
  const raw=$('#register-form').elements.units.value;
  text('registration-cost',/^\d+$/.test(raw)?integer(BigInt(raw)*100n)+' test USD':'Enter whole units');
};

for(const id of ['claim','claim-rewards']){
  $('#'+id).onclick=()=>transaction(()=>send(write('binary').claim()));
}

$('#faucet').onclick=()=>transaction(()=>send(write('usd').faucet()));

$('#register-form').onsubmit=event=>{
  event.preventDefault();
  transaction(async()=>{
    const form=event.target;
    const n=BigInt(form.elements.units.value);
    if(n<1n||n>1000000n)throw Error('Enter between 1 and 1,000,000 whole units.');

    const w=wallet();
    if(!w)throw Error('Reload wallet data and try again.');

    const sponsorAddress=form.elements.sponsor.value.trim();
    if(!w.exists&&(!isAddress(sponsorAddress)||sponsorAddress===ZeroAddress))throw Error('Enter a valid sponsor address.');

    const cost=n*parseEther('100');
    if(cost>BigInt(w.usdBalance))throw Error('Not enough test USD. Use Get test USD first.');

    await approve(cfg.binary,cost);
    await send(w.exists?write('binary').addUnits(n):write('binary').register(sponsorAddress,n));
  });
};

$('#auto-form').addEventListener('input',()=>{autoDirty=true;});
$('#auto-form').onsubmit=event=>{
  event.preventDefault();
  const enabled=event.target.elements.enabled.checked;
  const price=event.target.elements.price.value;
  transaction(async()=>{
    await send(write('binary').setAutoBuy(enabled,parseEther(price)));
    autoDirty=false;
  });
};

$('#execute-auto').onclick=()=>transaction(()=>send(write('binary').executeAuto(address,BigInt(wallet().autoPending))));
$('#release-auto').onclick=()=>transaction(()=>send(write('binary').releaseAutoToCash()));

function amountInput(form){
  const amount=parseEther(form.elements.amount.value);
  const percent=Number(form.elements.slippage.value);
  if(amount<=0n||!Number.isFinite(percent)||percent<0||percent>5)throw Error('Enter a positive amount and slippage between 0% and 5%.');
  return [amount,BigInt(Math.round(percent*100))];
}

for(const kind of ['buy','sell']){
  const form=$('#'+kind+'-form');
  let debounce,quoteSequence=0;

  const showQuote=()=>{
    clearTimeout(debounce);
    const sequence=++quoteSequence;
    text(kind+'-quote','Updating quote…');

    debounce=setTimeout(async()=>{
      try{
        const [amount,slip]=amountInput(form);
        let output,extra='';

        if(kind==='buy'){
          output=await read.token.quoteBuy(amount);
          extra=` · Trade fee ${pct(state?.tradeFeeBps||300)}`;
        }else{
          const quote=await read.token.quoteSell(amount);
          output=quote[0];
          const gross=quote[1];
          const fee=BigInt(gross)-BigInt(output);
          extra=` · Gross ${fmt(gross,6)} · Fee ${fmt(fee,6)} USD`;
        }

        if(sequence!==quoteSequence)return;
        const minimum=output*(10000n-slip)/10000n;
        text(kind+'-quote',
          (kind==='buy'?'Estimated user output: ':'Net proceeds: ')+fmt(output,6)+(kind==='buy'?' FTI':' test USD')+
          '\nMinimum accepted: '+fmt(minimum,6)+(kind==='buy'?' FTI':' test USD')+extra
        );
        $('#'+kind+'-quote').classList.remove('invalid');
      }catch{
        if(sequence!==quoteSequence)return;
        text(kind+'-quote',form.elements.amount.value?'Quote unavailable. Check amount and current limits.':'Enter an amount for a live quote.');
        $('#'+kind+'-quote').classList.add('invalid');
      }
    },250);
  };

  form.elements.amount.oninput=showQuote;
  form.elements.slippage.oninput=showQuote;

  form.onsubmit=event=>{
    event.preventDefault();
    transaction(async()=>{
      const [amount,slip]=amountInput(form);
      const w=wallet();
      if(!w?.exists||BigInt(w.units)===0n)throw Error('Register and add at least one membership unit before trading.');
      if(state.emergencyUnwind)throw Error('Emergency unwind is active.');
      if(state.tokenPaused)throw Error('Token trading is paused.');

      const deadline=BigInt(state.timestamp)+1200n;

      if(kind==='buy'){
        if(amount>BigInt(w.usdBalance))throw Error('Not enough test USD in your wallet.');
        if(amount>BigInt(w.remaining))throw Error('Amount exceeds your remaining manual purchase allowance.');
        const quote=await read.token.quoteBuy(amount);
        await approve(cfg.token,amount);
        await send(write('token').buy(amount,quote*(10000n-slip)/10000n,deadline));
      }else{
        if(amount>BigInt(w.ftiBalance))throw Error('Amount exceeds your FTI balance.');
        const max=effectiveMaxSellTokens(w,state);
        if(amount>max)throw Error('Amount exceeds the current anti-whale/hourly sell limit.');
        const quote=await read.token.quoteSell(amount);
        await send(write('token').sell(amount,quote[0]*(10000n-slip)/10000n,deadline));
      }
    });
  };
}

$('#max-sell').onclick=()=>{
  const form=$('#sell-form');
  const max=effectiveMaxSellTokens(wallet(),state);
  form.elements.amount.value=formatEther(max);
  form.elements.amount.dispatchEvent(new Event('input',{bubbles:true}));
};

$('#transfer-form').onsubmit=event=>{
  event.preventDefault();
  transaction(async()=>{
    const to=event.target.elements.to.value.trim();
    const amount=parseEther(event.target.elements.amount.value);
    if(!isAddress(to)||to===ZeroAddress)throw Error('Enter a valid recipient address.');
    if(to.toLowerCase()===address.toLowerCase())throw Error('Choose a different recipient wallet.');
    if(amount<=0n||amount>BigInt(wallet().ftiBalance))throw Error('Enter an amount within your FTI balance.');
    if(state.emergencyUnwind)throw Error('Transfers are disabled during emergency unwind.');
    await send(write('token').transfer(to,amount));
  });
};

for(const [id,method,arg] of [
  ['volume','processVolume',50],
  ['close-epoch','beginEpochClose'],
  ['process-epoch','processEpoch',50],
  ['begin-month','beginBuilderMonth'],
  ['process-month','processBuilderMonth',50],
  ['reward-all','processRewards',100]
]){
  $('#'+id).onclick=()=>transaction(()=>send(write('binary')[method](...(arg?[arg]:[]))));
}

document.querySelectorAll('[data-time]').forEach(button=>{
  button.onclick=()=>transaction(async()=>{
    const response=await fetch('/api/dev/time',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({seconds:Number(button.dataset.time)})
    });
    if(!response.ok)throw Error((await response.json()).error);
  });
});

let eventsLoading=false;
async function loadEvents(){
  if(eventsLoading)return;
  eventsLoading=true;
  $('#refresh-events').disabled=true;
  text('events','Loading recent on-chain events…');

  try{
    const rows=await json('/api/events');
    if(!Array.isArray(rows))throw Error('Events unavailable.');

    $('#events').replaceChildren();
    if(!rows.length)text('events','No events in the recent block range.');

    for(const row of rows){
      const node=document.createElement('div');
      node.className='event';

      const title=document.createElement('strong');
      title.textContent=row.name+' · Block '+integer(row.block);

      const pre=document.createElement('pre');
      pre.textContent=row.args.map(arg=>arg.name+': '+arg.value).join('\n');

      node.append(title,pre);

      if(explorer){
        const link=document.createElement('a');
        link.href=explorer+'/tx/'+row.hash;
        link.target='_blank';
        link.rel='noreferrer';
        link.textContent='View transaction ↗';
        node.append(link);
      }

      $('#events').append(node);
    }
  }catch(error){
    text('events','Recent events could not be loaded. Your balances remain available. Use Refresh events to retry.');
    status(reason(error),true);
  }finally{
    eventsLoading=false;
    $('#refresh-events').disabled=false;
  }
}
$('#refresh-events').onclick=loadEvents;

for(const [key,name] of Object.entries(names)){
  const el=document.createElement('div');
  el.textContent=name;
  const code=document.createElement('code');
  code.textContent=cfg[key];
  if(explorer){
    const a=document.createElement('a');
    a.href=explorer+'/address/'+cfg[key];
    a.target='_blank';
    a.rel='noreferrer';
    a.append(code);
    el.append(a);
  }else el.append(code);
  $('#contracts').append(el);
}

async function loadProposals(){
  try{
    const count=Number(await read.council.proposalCount());
    $('#proposals').replaceChildren();

    if(!count)text('proposals','No Partner DAO proposals yet.');

    for(let i=count-1;i>=Math.max(0,count-20);i--){
      const p=await read.council.proposal(i);
      const box=document.createElement('div');
      box.className='proposal';

      const title=document.createElement('p');
      title.textContent=`Proposal ${i} · ${p.approvals??p[2]} of 5 approvals · ${(p.executed??p[3])?'Executed':'Pending'}`;
      box.append(title);

      const target=document.createElement('small');
      target.textContent='Target: '+(p.target??p[0]);
      box.append(target);

      for(const [label,fn,requirement] of [
        ['Approve',()=>write('council').approve(i),'council'],
        ['Execute proposal',()=>write('council').execute(i),'wallet']
      ]){
        const button=document.createElement('button');
        button.className='secondary';
        button.textContent=label;
        button.dataset.write='';
        button.dataset.requires=requirement;
        button.dataset.executed=String(Boolean(p.executed??p[3]));
        button.onclick=()=>transaction(async()=>{
          await send(fn());
          await loadProposals();
        });
        box.append(button);
      }

      $('#proposals').append(box);
    }
    syncActions();
  }catch(error){
    text('proposals','Partner DAO proposals could not be loaded. Retry this section.');
    status(reason(error),true);
  }
}

$('#proposal-form').onsubmit=event=>{
  event.preventDefault();
  transaction(async()=>{
    const action=event.target.elements.action.value;
    let target,data;

    if(action==='pauseBinary'){
      target=cfg.binary;
      data=read.binary.interface.encodeFunctionData('pause');
    }else if(action==='pauseToken'){
      target=cfg.token;
      data=read.token.interface.encodeFunctionData('pause');
    }else if(action==='emergencyUnwind'){
      target=cfg.token;
      data=read.token.interface.encodeFunctionData('activateEmergencyUnwind');
    }else throw Error('Unknown DAO action.');

    await send(write('council').propose(target,data));
    await loadProposals();
  });
};

$('#governance-form').onsubmit=event=>{
  event.preventDefault();
  transaction(async()=>{
    const action=event.target.elements.action.value;
    if(action==='unpauseBinary')await send(write('binary').unpause());
    else if(action==='unpauseToken')await send(write('token').unpause());
    else throw Error('Unknown governance action.');
  });
};

text('token-address',cfg.token);
$('#token-explorer').hidden=!explorer;
if(explorer)$('#token-explorer').href=explorer+'/address/'+cfg.token;

renderRoles();
renderWallet();
syncActions();
navigate(location.hash.slice(1)||((sponsor&&isAddress(sponsor))?'network':defaultPage));

try{
  if(cfg.mode==='local'){
    await connect();
  }else{
    await refresh();
    status('V3 contract data loaded. Connect a wallet to manage your account.');
    let reconnect=false;
    try{reconnect=sessionStorage.getItem('fti-v3-wallet-connected')==='yes';}catch{}
    if(reconnect&&window.ethereum)await connect({silent:true});
  }
}catch(error){
  status(reason(error),true);
}

setInterval(()=>{
  if(!busy&&!connecting)refresh().catch(error=>status('Connection unavailable: '+reason(error),true));
},15000);
