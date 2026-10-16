import {parseEther,parseUnits,formatEther} from 'ethers';
import {MainnetSession,validatePlan} from './session.mjs';
const el=id=>document.getElementById(id);
let session;let plan;let expected;let locked=false;
function message(text){el('status').textContent=text}
function render(){
 el('journal').textContent=JSON.stringify(session?.state||{},null,2);
 el('send').disabled=!session||locked;
 el('export').disabled=!session||session.state.steps.length!==7||session.state.steps.some(s=>!s.confirmed);
}
async function run(fn){if(locked)return;locked=true;render();try{await fn()}catch(e){message(e.shortMessage||e.message||'Operation failed')}finally{locked=false;render()}}
el('connect').onclick=()=>run(async()=>{
 if(session)throw Error('Reload to change limits; keep the existing browser journal.');
 if(!window.isSecureContext)throw Error('HTTPS is required');
 const provider=window.ethereum;
 if(!provider?.isMetaMask)throw Error('Open this exact HTTPS URL inside MetaMask Browser');
 if(el('digest').value.trim()!==expected)throw Error('Paste the plan digest printed by the server command');
 const fee=parseEther(el('budget').value.trim()),price=parseUnits(el('ceiling').value.trim(),'gwei');
 validatePlan(plan,expected);
 await provider.request({method:'eth_requestAccounts'});
 // Network changes are explicit in MetaMask; this page never adds an unreviewed RPC.
 const candidate=new MainnetSession({provider,plan,expectedDigest:expected,storage:localStorage,maxFeeWei:fee,maxGasPriceWei:price});
 await candidate.account();session=candidate;
 for(const id of ['budget','ceiling','digest','connect'])el(id).disabled=true;
 message('متصل شد. سقف کل گس: '+formatEther(fee)+' BNB. هر مرحله یک تأیید مستقل در متامسک دارد.');
});
el('send').onclick=()=>run(async()=>{const hash=await session.sendNext();message('ارسال شد: '+hash+' — برای ادامه، بررسی رسید را بزنید. صفحه را نگه دارید.')});
el('check').onclick=()=>run(async()=>{if(!session)throw Error('ابتدا اتصال را انجام دهید');message(await session.reconcile()?'رسیدهای قبلی تأیید شدند. مرحلهٔ بعد آمادهٔ بررسی است.':'در انتظار رسید و ۱۲ تأیید شبکه. دوباره ارسال نکنید.')});
el('export').onclick=()=>run(async()=>{
 await session.reconcile();const hashes=session.exportHashes();
 const url=URL.createObjectURL(new Blob([JSON.stringify(hashes,null,2)+'\n'],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='FTI-mainnet-transactions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 message('فایل هش‌ها ذخیره شد. راه‌اندازی سایت به تأیید مستقل scripts/finalize-mainnet.mjs نیاز دارد.');
});
try{
 const response=await fetch('./plan.json',{cache:'no-store'});if(!response.ok)throw Error('Plan unavailable');
 plan=await response.json();expected=document.querySelector('meta[name="fti-plan-digest"]').content;validatePlan(plan,expected);
 el('summary').textContent=JSON.stringify({chain:56,deployer:plan.input.deployer,revision:plan.manifest.sourceRevision,nonce:plan.nonce,digest:expected,addresses:plan.addresses},null,2);
 el('payloads').textContent=JSON.stringify(plan.transactions,null,2);
 message('برنامه بارگذاری شد. digest چاپ‌شدهٔ سرور را تطبیق دهید؛ شبکه و حساب متامسک باید مطابق بالا باشند.');
}catch(e){message(e.message);el('connect').disabled=true}
render();
