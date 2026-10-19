import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
for(const width of [320,390,844,1280])for(const lang of ['en','fa'])test(`connect disconnect and reconnect at ${width}px ${lang}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.addInitScript(()=>{
  const address='0x2bf894836cbBBb9b27A0394a3EdF340c66839322';
  window.ethereum={isMetaMask:true,request:async({method})=>{
   if(method==='eth_chainId')return '0x38';
   if(['eth_accounts','eth_requestAccounts'].includes(method))return [address];
   throw Error('Unexpected wallet method: '+method);
  },on(){},removeListener(){}};
  localStorage.setItem('fti-pending:56:test','unknown:7');
 });
 await page.route('**/abi/*',r=>{const name=new URL(r.request().url()).pathname.split('/').pop();const artifact=JSON.parse(fs.readFileSync(new URL('../../artifacts/'+(name==='Collateral'?'MockUSD':name)+'.json',import.meta.url)));return r.fulfill({json:artifact.abi});});
 await page.route('**/api/config',r=>r.fulfill({json:cfg}));
 await page.route('**/api/state**',r=>r.fulfill({status:503,json:{error:'Read-only fixture'}}));
 await page.goto('/app/?lang='+lang);
 await expect(page.getByRole('status').first()).toContainText('Read-only fixture');
 await expect(page.locator('#disconnect')).toBeHidden();
 for(let i=0;i<2;i++){
  await page.locator('#connect').click();
  await page.getByRole('button',{name:'MetaMask',exact:true}).click();
  await expect(page.locator('#disconnect')).toBeVisible();
  await expect(page.locator('#disconnect')).toBeEnabled();
  const boxes=await page.locator('.connection button,.connection select').evaluateAll(els=>els.map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height).map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom})));
  for(const box of boxes){expect(box.x).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width);}
  for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)expect(boxes[a].x<boxes[b].right&&boxes[a].right>boxes[b].x&&boxes[a].y<boxes[b].bottom&&boxes[a].bottom>boxes[b].y).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if(i===0)await page.screenshot({path:`test-results/wallet-layout-${width}-${lang}.png`});
  await page.locator('#disconnect').click();
  await expect(page.locator('#disconnect')).toBeHidden();
  await expect(page.locator('#connect-label')).toHaveText(lang==='fa'?'اتصال کیف‌پول':'Connect wallet');
  await expect(page.getByRole('status').first()).toHaveText(lang==='fa'?'اتصال ولت قطع شد.':'Wallet disconnected.');
 }
 expect(await page.evaluate(()=>sessionStorage.getItem('fti-wallet-connected'))).toBeNull();
 expect(await page.evaluate(()=>localStorage.getItem('fti-pending:56:test'))).toBe('unknown:7');
});
