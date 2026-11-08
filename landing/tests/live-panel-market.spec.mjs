import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {parseEther,ZeroAddress} from 'ethers';
import {COLLATERAL_ABI} from '../../core/deployment-network.mjs';

const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
const baseline=JSON.parse(fs.readFileSync(new URL('../../preview/state.json',import.meta.url)));
const installedIdentity=fs.readFileSync(new URL('./fixtures/member-panel-installed-identity.css',import.meta.url));
const first='0x1111111111111111111111111111111111111111',second='0x2222222222222222222222222222222222222222';
const wei=value=>parseEther(value).toString(),pending='fti-pending:56:'+first,hash='0x'+'a'.repeat(64);

async function fixture(page,{width=390,lang='en',importUnsupported=false}={}){
 const errors=[];let outage=false;page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});
 await page.addInitScript(({lang,first,second,importUnsupported})=>{
  localStorage.setItem('fti-language',lang);localStorage.setItem('fti-appearance','glass');
  let selected=first;const events=new Map();window.__marketMethods=[];
  window.ethereum={isMetaMask:true,on(event,listener){if(!events.has(event))events.set(event,new Set());events.get(event).add(listener);},removeListener(event,listener){events.get(event)?.delete(listener);},
   request:async({method,params})=>{
    window.__marketMethods.push({method,params});
    if(method==='eth_chainId')return '0x38';
    if(['eth_accounts','eth_requestAccounts'].includes(method))return [selected];
    if(method==='wallet_requestPermissions'){selected=second;return [{parentCapability:'eth_accounts'}];}
    if(method==='wallet_watchAsset'){if(importUnsupported)throw Object.assign(Error('Unsupported'),{code:4200});return true;}
    throw Error('Transactions and signatures disabled in UI test: '+method);
   }};
 },{lang,first,second,importUnsupported});
 await page.route('**/panel-identity.css',r=>r.fulfill({contentType:'text/css',body:installedIdentity}));
 await page.route('**/api/config',r=>r.fulfill({json:cfg}));
 await page.route('**/api/state*',r=>{
  if(outage)return r.fulfill({status:503,json:{error:'Deliberate data outage'}});
  const address=new URL(r.request().url()).searchParams.get('wallet'),other=address===second;
  const wallet=address?{address,exists:true,rank:0,units:'1',lifetimeL:'4',lifetimeR:'4',carryL:'0',carryR:'0',creditL:'0',creditR:'0',autoPending:'0',claimable:'0',usdBalance:wei(other?'0.0001':'137.907553424081186546'),ftiBalance:wei(other?'5':'596.537457909496382480'),unlocked:wei(other?'5':'596.537457909496382480'),remaining:wei('426.69'),autoEnabled:false,maxAutoPrice:'0',locks:[],lockCount:'0',directReferrals:'0',parent:ZeroAddress,left:ZeroAddress,right:ZeroAddress}:null;
  return r.fulfill({json:{...baseline,price:wei('0.1'),reserve:wei('100'),supply:wei('1000'),count:'34',block:129333333,timestamp:Math.floor(Date.now()/1000),level:'0',phase:0,tokenStateVerified:true,paused:false,tokenPaused:false,emergencyUnwind:false,wallet}});
 });
 for(const path of ['events','market'])await page.route('**/api/'+path,r=>r.fulfill({json:path==='events'?[]:{fromBlock:1,toBlock:2,trades:[]}}));
 await page.route('**/abi/*',r=>{const name=new URL(r.request().url()).pathname.split('/').at(-1);return r.fulfill({json:name==='Collateral'?COLLATERAL_ABI:JSON.parse(fs.readFileSync(new URL('../../artifacts/'+name+'.json',import.meta.url))).abi});});
 await page.route('**/rpc',r=>{
  const answer=c=>({jsonrpc:'2.0',id:c.id,...(c.method==='eth_chainId'?{result:'0x38'}:{error:{code:-32000,message:'Other reads unavailable in this UI test'}})}),calls=r.request().postDataJSON();
  return r.fulfill({json:Array.isArray(calls)?calls.map(answer):answer(calls)});
 });
 await page.goto('/app/');await expect(page.locator('#connect')).toBeEnabled();
 await page.locator('#connect').click();await page.getByRole('button',{name:'MetaMask',exact:true}).click();
 await expect(page.locator('#disconnect')).toBeVisible();await expect(page.locator('#wallet-address')).toHaveText(first);
 return {errors,outage:value=>{outage=value;}};
}
async function noFundsRequests(page){expect(await page.evaluate(()=>window.__marketMethods.filter(c=>/sendTransaction|personal_sign|eth_sign|signTyped/i.test(c.method)))).toEqual([]);}

for(const width of [320,390,1440])test(`mainnet balances, count and changing wallet preserve identity at ${width}`,async({page})=>{
 const f=await fixture(page,{width});
 await expect(page.locator('#fti-balance')).toHaveText('596.53746');await expect(page.locator('#fti-balance')).toHaveAttribute('title','596.53745790949638248');
 await expect(page.locator('#usd-balance')).toHaveText('137.91');await expect(page.locator('#usd-balance')).toHaveAttribute('title','137.907553424081186546');
 await expect(page.locator('#fti-estimated-value')).toHaveText('59.65 USDT');
 await expect(page.locator('#members')).toHaveText('34');await expect(page.locator('#members-source')).toContainText('129333333');
 await expect(page.locator('#faucet')).toBeHidden();await expect(page.locator('#overview')).not.toContainText('Test USD');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 // A wallet switch must retain the first wallet's unresolved transaction.
 await page.evaluate(({pending,hash})=>localStorage.setItem(pending,hash),{pending,hash});
 await page.locator('#change-wallet').click();await expect(page.locator('#fti-balance')).toHaveText('—');await expect(page.locator('#fti-estimated-value')).toHaveText('—');
 await page.getByRole('button',{name:'MetaMask',exact:true}).click();await expect(page.locator('#wallet-address')).toHaveText(second);
 await expect(page.locator('#fti-balance')).toHaveText('5');await expect(page.locator('#usd-balance')).toHaveText('<0.01');await expect(page.locator('#fti-estimated-value')).toHaveText('0.5 USDT');
 expect(await page.evaluate(pending=>localStorage.getItem(pending),pending)).toBe(hash);
 expect(await page.evaluate(()=>window.__marketMethods.filter(c=>c.method==='wallet_requestPermissions').length)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(f.errors).toEqual([]);await noFundsRequests(page);
});

for(const unsupported of [false,true])test(`explicit FTI import uses correct metadata and manual fallback ${unsupported}`,async({page})=>{
 const f=await fixture(page,{importUnsupported:unsupported});await page.evaluate(()=>location.hash='trade');
 await page.locator('#add-fti-wallet').click();
 await expect(page.locator('#token-import-status')).toContainText(unsupported?'Automatic import was not confirmed':'FTI was added');
 if(unsupported)await expect(page.locator('#token-import-details')).toHaveAttribute('open','');
 const calls=await page.evaluate(()=>window.__marketMethods.filter(c=>c.method==='wallet_watchAsset'));
 expect(calls).toEqual([{method:'wallet_watchAsset',params:{type:'ERC20',options:{address:cfg.token,symbol:'FTI',decimals:18}}}]);
 await expect(page.locator('#token-import-address')).toHaveText(cfg.token);expect(f.errors).toEqual([]);await noFundsRequests(page);
});

for(const lang of ['en','fa'])test(`glass preference persists and failed balance reads remove valuation ${lang}`,async({page})=>{
 const f=await fixture(page,{lang});await page.locator('.member-settings-toggle').click();
 const toggle=page.locator('.fti-appearance');await expect(toggle).toHaveAttribute('aria-pressed','true');
 await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-appearance','solid');await expect(toggle).toHaveAttribute('aria-pressed','false');
 await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-appearance','glass');
 f.outage(true);await page.locator('#refresh-state').click();await expect(page.locator('#fti-estimated-value')).toHaveText('—');
 await expect(page.locator('#fti-balance')).not.toHaveText('—');expect(f.errors).toEqual([]);await noFundsRequests(page);
});
