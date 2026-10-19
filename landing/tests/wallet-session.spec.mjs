import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
for(const width of [390,1280])test(`connect disconnect and reconnect at ${width}px`,async({page})=>{
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
 await page.goto('/app/?lang=en');
 await expect(page.getByRole('status').first()).toContainText('Read-only fixture');
 await expect(page.locator('#disconnect')).toBeHidden();
 for(let i=0;i<2;i++){
  await page.locator('#connect').click();
  await page.getByRole('button',{name:'MetaMask',exact:true}).click();
  await expect(page.locator('#disconnect')).toBeVisible();
  await expect(page.locator('#disconnect')).toBeEnabled();
  await page.locator('#disconnect').click();
  await expect(page.locator('#disconnect')).toBeHidden();
  await expect(page.locator('#connect-label')).toHaveText('Connect wallet');
  await expect(page.getByRole('status').first()).toHaveText('Wallet disconnected.');
 }
 expect(await page.evaluate(()=>sessionStorage.getItem('fti-wallet-connected'))).toBeNull();
 expect(await page.evaluate(()=>localStorage.getItem('fti-pending:56:test'))).toBe('unknown:7');
});
