import {
  BrowserProvider,Wallet,Contract,ContractFactory,parseEther,formatEther,
  MaxUint256,ZeroAddress,isAddress
} from './vendor/ethers.js';

const RPC='https://bsc-testnet.bnbchain.org';
const DAO=[
  '0x66Bccec30D27d780A23b2cBe467f20D4a1FC56F8',
  '0xe7efd5bfBa19cC1c6D50b5ddfBC972Fa5524851f',
  '0xF2637A6Ab93b13DEF1F46E49A1F39d1B9Ec1fC16',
  '0x1c8E8FFF893aFa573e0F616DDA333B1f0c7A8740',
  '0x3d6282594649f2E023209346779977293cFD481a',
  '0x202cA4f915E6dA048fb44d20c5FE852eb00FE3fe',
  '0x25D88f0B8ac6e1495112F3EB17DBC57271A92fa7'
];
const NAMES=['MockUSD','SevenGuardianCouncil','FTIReserveTokenV3','FundedBinaryPlan'];
const LABELS=['MockUSD test collateral','5-of-7 Partner DAO','FTIReserveTokenV3','FundedBinaryPlan','Bind token ↔ binary'];
const STORE='fti-v3-testnet-launcher-v1';
const $=id=>document.getElementById(id);

const artifacts=Object.fromEntries(await Promise.all(
  NAMES.map(async name=>[name,await fetch(`artifacts/${name}.json`,{cache:'no-store'}).then(r=>{
    if(!r.ok)throw Error('Missing V3 launcher artifact '+name+'. Run npm run launch:v3.');
    return r.json();
  })])
));

let provider,mainSigner,connected,helpers=[],charity=[],busy=false;
let state;

function blank(){
  return {
    version:3,
    release:'FTI_V3_ZERO_START',
    chainId:97,
    owner:null,
    steps:[],
    config:null,
    encrypted:null
  };
}

try{state=JSON.parse(localStorage.getItem(STORE)||'null');}catch{}
if(!state||state.release!=='FTI_V3_ZERO_START'||state.chainId!==97)state=blank();

const fmt=(x,d=6)=>Number(formatEther(x)).toLocaleString('en-US',{maximumFractionDigits:d});
const short=x=>x?x.slice(0,6)+'…'+x.slice(-4):'—';

function save(){
  localStorage.setItem(STORE,JSON.stringify(state));
  render();
}

function say(message,error=false){
  $('status').textContent=message;
  $('status').classList.toggle('error',error);
}

function b64(bytes){return btoa(String.fromCharCode(...bytes));}
function un64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}

async function deriveKey(password,salt){
  const material=await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},
    material,
    {name:'AES-GCM',length:256},
    false,
    ['encrypt','decrypt']
  );
}

async function encrypt(value,password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(password,salt);
  const encrypted=await crypto.subtle.encrypt(
    {name:'AES-GCM',iv},
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return {
    version:3,
    release:'FTI_V3_ZERO_START',
    algorithm:'AES-256-GCM',
    kdf:'PBKDF2-SHA256',
    iterations:310000,
    owner:connected,
    chainId:97,
    salt:b64(salt),
    iv:b64(iv),
    ciphertext:b64(new Uint8Array(encrypted))
  };
}

async function decrypt(data,password){
  if(
    data.version!==3||
    data.release!=='FTI_V3_ZERO_START'||
    data.chainId!==97||
    data.iterations!==310000
  )throw Error('Backup is not an FTI V3 Testnet backup.');

  const plain=await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:un64(data.iv)},
    await deriveKey(password,un64(data.salt)),
    un64(data.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function download(name,value){
  const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

async function guardNetwork(){
  if(!provider)throw Error('Connect your wallet first.');
  const chain=Number(await provider.send('eth_chainId',[]));
  if(chain!==97)throw Error('Only BNB Testnet chain ID 97 is allowed.');
}

async function connect(){
  if(!window.ethereum)throw Error('Open this page in MetaMask/Trust Wallet browser or a browser with a wallet extension.');

  await window.ethereum.request({method:'eth_requestAccounts'});

  try{
    await window.ethereum.request({
      method:'wallet_switchEthereumChain',
      params:[{chainId:'0x61'}]
    });
  }catch(error){
    if(error.code!==4902&&error.data?.originalError?.code!==4902)throw error;
    await window.ethereum.request({
      method:'wallet_addEthereumChain',
      params:[{
        chainId:'0x61',
        chainName:'BNB Smart Chain Testnet',
        nativeCurrency:{name:'Test BNB',symbol:'tBNB',decimals:18},
        rpcUrls:[RPC],
        blockExplorerUrls:['https://testnet.bscscan.com']
      }]
    });
  }

  provider=new BrowserProvider(window.ethereum,undefined,{cacheTimeout:-1});
  await guardNetwork();
  mainSigner=await provider.getSigner();
  connected=await mainSigner.getAddress();

  if(state.owner&&state.owner.toLowerCase()!==connected.toLowerCase()){
    say('Connected wallet differs from the owner saved in this deployment state. Export or clear the old state before starting another deployment.',true);
  }

  $('wallet').textContent=`${connected} · Balance: ${fmt(await provider.getBalance(connected))} tBNB`;
  render();
  await refresh();
}

async function action(fn){
  if(busy)return;
  busy=true;
  document.querySelectorAll('button').forEach(b=>b.disabled=true);

  try{
    await fn();
    say('Operation completed.');
    await refresh();
  }catch(error){
    say(error.reason||error.shortMessage||error.message,true);
  }finally{
    busy=false;
    document.querySelectorAll('button').forEach(b=>b.disabled=false);
    render();
  }
}

function renderDao(){
  const box=$('dao-list');
  box.replaceChildren();
  DAO.forEach((address,i)=>{
    const row=document.createElement('div');
    row.className='contract';
    row.textContent=`Partner ${i+1} · `;
    const code=document.createElement('code');
    code.textContent=address;
    row.append(code);
    box.append(row);
  });
}

function render(){
  const list=$('steps');
  list.replaceChildren();

  for(let i=0;i<5;i++){
    const li=document.createElement('li');
    const step=state.steps[i];
    li.textContent=LABELS[i]+(step?.status==='confirmed'?' — confirmed':step?.hash?' — submitted':' — pending');
    li.className=step?.status==='confirmed'?'done':'';

    if(step?.hash){
      const a=document.createElement('a');
      a.href='https://testnet.bscscan.com/tx/'+step.hash;
      a.target='_blank';
      a.rel='noopener';
      a.textContent=step.hash;
      li.append(a);
    }
    list.append(li);
  }

  const selected=$('account').value;
  $('account').replaceChildren();

  const ownerOption=document.createElement('option');
  ownerOption.value='owner';
  ownerOption.textContent='Connected deployer '+short(connected||state.owner);
  $('account').append(ownerOption);

  if(state.config){
    state.config.genesis.slice(1).forEach((address,i)=>{
      const o=document.createElement('option');
      o.value=String(i);
      o.textContent=`Genesis helper ${i+1} · ${short(address)}`;
      $('account').append(o);
    });
  }

  if([...$('account').options].some(o=>o.value===selected))$('account').value=selected;

  $('backup-state').textContent=helpers.length
    ?'30 Genesis helpers + 2 charity wallets are unlocked in browser memory.'
    :state.encrypted
      ?'Encrypted V3 backup is stored. Restore it to use generated wallets.'
      :'No V3 helper accounts prepared.';

  $('addresses').replaceChildren();
  for(let i=0;i<4;i++){
    const step=state.steps[i];
    if(step?.status==='confirmed'){
      const el=document.createElement('div');
      el.className='contract';
      el.textContent=LABELS[i];
      const a=document.createElement('a');
      a.href='https://testnet.bscscan.com/address/'+step.address;
      a.target='_blank';
      a.rel='noopener';
      a.textContent=step.address;
      el.append(a);
      $('addresses').append(el);
    }
  }

  renderDao();
}

function contract(index,signer=provider){
  const step=state.steps[index];
  if(step?.status!=='confirmed')throw Error('Complete V3 deployment first.');
  return new Contract(step.address,artifacts[NAMES[index]].abi,signer);
}

async function accountSigner(){
  await guardNetwork();
  if($('account').value==='owner')return mainSigner;

  const i=Number($('account').value);
  if(!helpers[i])throw Error('Restore the encrypted backup to use helper accounts.');
  return helpers[i].connect(provider);
}

async function receipt(hash){
  let r=await provider.getTransactionReceipt(hash);
  if(!r){
    say('Waiting for the previous transaction to confirm…');
    r=await provider.waitForTransaction(hash,1,180000);
  }
  if(!r)throw Error('Transaction is not confirmed yet. Resume later.');
  if(r.status!==1)throw Error('Previous transaction failed. Inspect it in the explorer.');
  return r;
}

function deploymentExport(){
  if(state.steps.length<5||state.steps.some(s=>s.status!=='confirmed'))throw Error('Complete V3 deployment first.');

  return {
    version:3,
    release:'FTI_V3_ZERO_START',
    mode:'testnet',
    chainId:97,
    tokenContract:'FTIReserveTokenV3',
    binaryContract:'FundedBinaryPlan',
    councilContract:'SevenGuardianCouncil',
    lockVersion:0,
    liquidityVersion:3,
    deployedAt:state.completedAt,
    deployedBlock:state.deployedBlock,
    deployer:state.owner,
    governance:state.owner,
    development:state.owner,
    usd:state.steps[0].address,
    council:state.steps[1].address,
    token:state.steps[2].address,
    binary:state.steps[3].address,
    daoThreshold:5,
    daoPartners:DAO,
    charityWalletA:state.config.charityWalletA,
    charityWalletB:state.config.charityWalletB,
    genesis:state.config.genesis,
    initialState:{totalSupply:'0',reserve:'0',supportReserve:'0',price:'0'},
    transactions:{
      usd:state.steps[0].hash,
      council:state.steps[1].hash,
      token:state.steps[2].hash,
      binary:state.steps[3].hash,
      bind:state.steps[4].hash
    },
    note:'TESTNET ONLY. MockUSD has no monetary value. Mainnet deployment is not approved.'
  };
}

async function deploy(){
  await guardNetwork();

  if(!connected)throw Error('Connect your deployer wallet.');
  if(state.owner&&state.owner.toLowerCase()!==connected.toLowerCase())throw Error('This saved deployment belongs to a different deployer wallet.');
  if(!state.config||!state.encrypted||!$('backup-confirm').checked)throw Error('Generate/restore V3 helpers and confirm that you saved the encrypted backup.');

  state.owner=connected;
  save();

  for(let i=0;i<4;i++){
    const current=state.steps[i];

    if(current?.hash){
      const prior=await provider.getTransactionReceipt(current.hash);
      if(prior&&prior.status===0){
        state.steps.splice(i);
        save();
        throw Error('Failed deployment step cleared. Resume to retry.');
      }

      const r=await receipt(current.hash);
      state.steps[i]={...current,address:r.contractAddress,status:'confirmed'};
      if(i===0)state.deployedBlock=r.blockNumber;
      save();
      continue;
    }

    let args;
    if(i===0)args=[];
    if(i===1)args=[DAO];
    if(i===2)args=[
      state.steps[0].address,
      connected,
      state.steps[1].address,
      state.config.charityWalletA,
      state.config.charityWalletB
    ];
    if(i===3)args=[
      state.steps[0].address,
      state.steps[2].address,
      connected,
      state.steps[1].address,
      connected,
      state.config.genesis
    ];

    say(`Step ${i+1} of 5: ${LABELS[i]} — review and approve in your wallet.`);
    const factory=new ContractFactory(artifacts[NAMES[i]].abi,artifacts[NAMES[i]].bytecode,mainSigner);
    const c=await factory.deploy(...args);
    const hash=c.deploymentTransaction().hash;
    state.steps[i]={hash,address:c.target,status:'pending'};
    save();

    const r=await receipt(hash);
    state.steps[i]={hash,address:r.contractAddress,status:'confirmed'};
    if(i===0)state.deployedBlock=r.blockNumber;
    save();
  }

  const token=contract(2,mainSigner);
  const binaryAddress=state.steps[3].address;
  const bound=await token.binary();

  if(bound.toLowerCase()!==binaryAddress.toLowerCase()){
    if(bound!==ZeroAddress)throw Error('Token is already bound to a different contract.');

    if(state.steps[4]?.hash){
      const prior=await provider.getTransactionReceipt(state.steps[4].hash);
      if(prior&&prior.status===0){
        state.steps.splice(4);
        save();
        throw Error('Failed bind step cleared. Resume to retry.');
      }
      await receipt(state.steps[4].hash);
    }else{
      say('Step 5 of 5: bind FTIReserveTokenV3 to FundedBinaryPlan.');
      const tx=await token.bind(binaryAddress);
      state.steps[4]={hash:tx.hash,status:'pending'};
      save();
      await receipt(tx.hash);
    }
  }

  if((await token.binary()).toLowerCase()!==binaryAddress.toLowerCase())throw Error('Token/binary binding verification failed.');

  const council=contract(1);
  if(await council.THRESHOLD()!==5n)throw Error('Partner DAO threshold is not 5.');

  for(let i=0;i<7;i++){
    if((await council.guardians(i)).toLowerCase()!==DAO[i].toLowerCase())throw Error('Partner DAO guardian mismatch at '+i);
  }

  if(await token.totalSupply()!==0n)throw Error('V3 token must start with zero supply.');
  if(await token.reserve()!==0n||await token.supportReserve()!==0n)throw Error('V3 reserve must start at zero.');

  state.steps[4]={...state.steps[4],status:'confirmed'};
  state.completedAt=new Date().toISOString();
  save();

  download('FTI-V3-Testnet-Deployment.json',deploymentExport());
  showTab('test');
}

async function send(txPromise){
  const tx=await txPromise;
  say('Transaction submitted: '+tx.hash);
  await tx.wait();
  return tx.hash;
}

async function approvedUSD(signer,spender,amount){
  const usd=contract(0,signer);
  const account=await signer.getAddress();
  if(await usd.allowance(account,spender)<amount)await send(usd.approve(spender,MaxUint256));
}

async function refresh(){
  if(!provider)return;
  await guardNetwork();

  $('wallet').textContent=`${connected} · Balance: ${fmt(await provider.getBalance(connected))} tBNB`;

  if(state.steps[4]?.status!=='confirmed')return;

  const selected=await accountSigner();
  const who=await selected.getAddress();
  const usd=contract(0);
  const token=contract(2);
  const binary=contract(3);

  const [m,usdBalance,fti,claimable,price,reserve,support,epoch,end,phase,jobCursor,jobs,remaining,rewardRemaining]=await Promise.all([
    binary.members(who),usd.balanceOf(who),token.balanceOf(who),binary.pendingReward(who),
    token.price(),token.reserve(),token.supportReserve(),binary.epoch(),binary.epochEnd(),
    binary.phase(),binary.jobCursor(),binary.jobCount(),token.remainingAllowance(who),binary.rewardQueueRemaining()
  ]);

  $('price').textContent=fmt(price);
  $('reserve').textContent=fmt(reserve);
  $('support').textContent=fmt(support);
  $('account-info').textContent=`${who} | Gas ${fmt(await provider.getBalance(who))} tBNB | USD ${fmt(usdBalance)} | FTI ${fmt(fti)} | Units ${m.units} | Rank ${m.rank} | Claimable ${fmt(claimable)} | Buy allowance ${fmt(remaining)}`;
  $('settlement').textContent=`Epoch ${epoch} · Phase ${phase} · Volume queue ${jobCursor}/${jobs} · Reward queue ${rewardRemaining} · Epoch end ${new Date(Number(end)*1000).toLocaleString('en-US')}`;

  const council=contract(1);
  const count=await council.proposalCount();
  const guardian=connected?await council.isGuardian(connected):false;
  $('gov-status').textContent=`Connected wallet: ${guardian?'Partner DAO guardian':'not a DAO guardian'} · Proposals: ${count}`;
}

function showTab(id){
  document.querySelectorAll('.tab').forEach(el=>el.hidden=el.id!==id);
  document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('selected',el.dataset.tab===id));
}

document.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>showTab(el.dataset.tab));

$('connect').onclick=()=>action(connect);
$('refresh').onclick=()=>action(refresh);
$('account').onchange=()=>action(refresh);

$('generate').onclick=()=>action(async()=>{
  await guardNetwork();
  if(state.steps.length)throw Error('Deployment already started. Restore the existing backup instead.');

  const password=$('password').value;
  if(password.length<12)throw Error('Use a backup password of at least 12 characters.');

  helpers=Array.from({length:30},()=>Wallet.createRandom());
  charity=[Wallet.createRandom(),Wallet.createRandom()];

  state.owner=connected;
  state.config={
    genesis:[connected,...helpers.map(w=>w.address)],
    charityWalletA:charity[0].address,
    charityWalletB:charity[1].address
  };

  state.encrypted=await encrypt({
    helperPrivateKeys:helpers.map(w=>w.privateKey),
    charityPrivateKeys:charity.map(w=>w.privateKey),
    config:state.config
  },password);

  save();
  download('FTI-V3-Testnet-Encrypted-Backup.json',state.encrypted);
  $('password').value='';
});

$('download-backup').onclick=()=>action(async()=>{
  if(!state.encrypted)throw Error('Create or restore a backup first.');
  download('FTI-V3-Testnet-Encrypted-Backup.json',state.encrypted);
});

$('restore').onchange=event=>action(async()=>{
  const file=event.target.files[0];
  if(!file)return;
  const password=prompt('Enter the encrypted V3 backup password');
  if(!password)throw Error('Backup password is required.');

  const encrypted=JSON.parse(await file.text());
  const decoded=await decrypt(encrypted,password);

  if(decoded.config.genesis[0].toLowerCase()!==connected.toLowerCase())throw Error('Connect the deployer wallet that owns this backup.');

  helpers=decoded.helperPrivateKeys.map(k=>new Wallet(k));
  charity=decoded.charityPrivateKeys.map(k=>new Wallet(k));
  state.owner=connected;
  state.config=decoded.config;
  state.encrypted=encrypted;
  save();
});

$('deploy').onclick=()=>action(deploy);

$('export').onclick=()=>action(async()=>download('FTI-V3-Testnet-Deployment.json',deploymentExport()));

$('import-deployment').onchange=event=>action(async()=>{
  const file=event.target.files[0];
  if(!file)return;
  const d=JSON.parse(await file.text());

  if(d.release!=='FTI_V3_ZERO_START'||d.chainId!==97||d.tokenContract!=='FTIReserveTokenV3')throw Error('Not an FTI V3 BNB Testnet deployment export.');
  if(d.deployer.toLowerCase()!==connected.toLowerCase())throw Error('Connect the deployer wallet for this deployment.');

  state.owner=d.deployer;
  state.config={
    genesis:d.genesis,
    charityWalletA:d.charityWalletA,
    charityWalletB:d.charityWalletB
  };
  state.steps=[
    {hash:d.transactions.usd,address:d.usd,status:'confirmed'},
    {hash:d.transactions.council,address:d.council,status:'confirmed'},
    {hash:d.transactions.token,address:d.token,status:'confirmed'},
    {hash:d.transactions.binary,address:d.binary,status:'confirmed'},
    {hash:d.transactions.bind,status:'confirmed'}
  ];
  state.deployedBlock=d.deployedBlock;
  state.completedAt=d.deployedAt;
  save();
});

$('fund-gas').onclick=()=>action(async()=>{
  const signer=await accountSigner();
  const who=await signer.getAddress();
  if(who.toLowerCase()===connected.toLowerCase())throw Error('Owner already has gas.');
  await send(mainSigner.sendTransaction({to:who,value:parseEther('0.01')}));
});

$('faucet').onclick=()=>action(async()=>{
  const signer=await accountSigner();
  await send(contract(0,signer).faucet());
});

$('add-units').onclick=()=>action(async()=>{
  const signer=await accountSigner();
  const units=BigInt($('units').value);
  if(units<1n||units>1000000n)throw Error('Invalid unit count.');
  const amount=units*parseEther('100');
  await approvedUSD(signer,state.steps[3].address,amount);
  await send(contract(3,signer).addUnits(units));
});

$('claim').onclick=()=>action(async()=>{
  const signer=await accountSigner();
  await send(contract(3,signer).claim());
});

$('buy').onclick=()=>action(async()=>{
  const signer=await accountSigner();
  const amount=parseEther($('buy-amount').value);
  const token=contract(2,signer);
  const quote=await token.quoteBuy(amount);
  const minimum=quote*9950n/10000n;
  await approvedUSD(signer,state.steps[2].address,amount);
  $('quote').textContent=`User quote: ${fmt(quote)} FTI · minimum ${fmt(minimum)} FTI`;
  await send(token.buy(amount,minimum,BigInt(Math.floor(Date.now()/1000)+1200)));
});

$('sell').onclick=()=>action(async()=>{
  const signer=await accountSigner();
  const amount=parseEther($('sell-amount').value);
  const token=contract(2,signer);
  const q=await token.quoteSell(amount);
  const minimum=q[0]*9950n/10000n;
  $('quote').textContent=`Net quote: ${fmt(q[0])} USD · gross ${fmt(q[1])} USD · minimum ${fmt(minimum)} USD`;
  await send(token.sell(amount,minimum,BigInt(Math.floor(Date.now()/1000)+1200)));
});

for(const [id,method,args] of [
  ['volume','processVolume',[50]],
  ['close','beginEpochClose',[]],
  ['process','processEpoch',[50]],
  ['month','beginBuilderMonth',[]],
  ['month-process','processBuilderMonth',[50]],
  ['reward','processRewards',[100]]
]){
  $(id).onclick=()=>action(async()=>send(contract(3,mainSigner)[method](...args)));
}

$('propose').onclick=()=>action(async()=>{
  const council=contract(1,mainSigner);
  if(!await council.isGuardian(connected))throw Error('Connect one of the seven Partner DAO wallets.');

  const actionName=$('gov-action').value;
  let target,data;

  if(actionName==='pauseBinary'){
    target=state.steps[3].address;
    data=contract(3).interface.encodeFunctionData('pause');
  }else if(actionName==='pauseToken'){
    target=state.steps[2].address;
    data=contract(2).interface.encodeFunctionData('pause');
  }else{
    target=state.steps[2].address;
    data=contract(2).interface.encodeFunctionData('activateEmergencyUnwind');
  }

  await send(council.propose(target,data));
});

$('vote').onclick=()=>action(async()=>{
  const council=contract(1,mainSigner);
  if(!await council.isGuardian(connected))throw Error('Connect one of the seven Partner DAO wallets.');
  await send(council.approve(BigInt($('proposal-id').value)));
});

$('execute-proposal').onclick=()=>action(async()=>{
  await send(contract(1,mainSigner).execute(BigInt($('proposal-id').value)));
});

window.ethereum?.on?.('accountsChanged',()=>location.reload());
window.ethereum?.on?.('chainChanged',()=>location.reload());

render();
renderDao();
