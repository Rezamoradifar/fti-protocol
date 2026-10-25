import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const URI='wc:'+'a'.repeat(64)+'@2?relay-protocol=irn&symKey='+'b'.repeat(64);
const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
let fixture;
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:`import {showWalletConnectPairing} from './frontend/walletconnect-modal.js';
  let close,copied=null,cancelled=0;
  export function open(uri,failQr=false){close=showWalletConnectPairing({uri,chainId:56,onCancel:()=>{cancelled++;}},{navigator:{clipboard:{writeText:async value=>{copied=value;}}},...(failQr?{toCanvas:()=>Promise.reject(Error('fixture'))}:{})});}
  export function finish(){close();}
  export function state(){return {copied,cancelled};}`,resolveDir:path.resolve('..'),loader:'js'},bundle:true,format:'esm',target:'es2022',write:false,define:{'process.env.NODE_ENV':'"production"','global':'globalThis'}});
 fixture=result.outputFiles[0].text;
});
async function setup(page,{lang='en',width=390,failQr=false}={}){
 await page.setViewportSize({width,height:844});
 await page.route('**/app/__walletconnect_fixture.js',r=>r.fulfill({contentType:'text/javascript',body:fixture}));
 await page.route('**/api/config',r=>r.fulfill({json:cfg}));
 await page.route('**/api/state*',r=>r.fulfill({status:503,json:{error:'Read-only fixture'}}));
 await page.route('**/rpc',r=>r.fulfill({json:{jsonrpc:'2.0',id:1,error:{code:-32601,message:'No transaction or public-chain calls in this fixture'}}}));
 await page.goto('/app/?lang='+lang);
 await page.locator('body[data-surface="member"]').waitFor();
 await page.evaluate(()=>{const button=document.createElement('button');button.id='wc-focus-return';button.textContent='Connection fixture';document.body.append(button);button.focus();});
 await page.evaluate(async({uri,failQr})=>{const m=await import('/app/__walletconnect_fixture.js');window.__wcFixture=m;m.open(uri,failQr);},{uri:URI,failQr});
 return page.getByRole('dialog',{name:'WalletConnect',exact:true});
}
for(const lang of ['en','fa'])for(const width of [390,1440])test(`first-party WalletConnect QR and official mobile links ${lang} ${width}`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const dialog=await setup(page,{lang,width});
 await expect(dialog).toBeVisible();await expect(dialog.getByText('BNB Mainnet · 56',{exact:false})).toBeVisible();
 const canvas=dialog.getByRole('img');await expect(canvas).toBeVisible();
 await expect.poll(()=>canvas.evaluate(el=>{const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let black=0,white=0;for(let i=0;i<data.length;i+=4){if(data[i+3]===255&&data[i]<20)black++;if(data[i]===255&&data[i+1]===255&&data[i+2]===255)white++;}return black>2000&&white>2000;})).toBe(true);
 for(const [wallet,host]of [['Trust Wallet','https://link.trustwallet.com'],['MetaMask','https://metamask.app.link']]){
  const href=await dialog.getByRole('link',{name:wallet,exact:true}).getAttribute('href'),url=new URL(href);expect(url.origin).toBe(host);expect(url.searchParams.get('uri')).toBe(URI);
 }
 await dialog.getByRole('button',{name:lang==='fa'?'کپی لینک اتصال':'Copy connection link',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__wcFixture.state().copied)).toBe(URI);
 expect(page.url()).not.toContain('symKey');expect(await page.locator('body').innerText()).not.toContain('symKey');
 expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.__wcFixture.state().cancelled)).toBe(1);
});
test('WalletConnect keeps keyboard focus inside its screen and restores focus after approval',async({page})=>{
 const dialog=await setup(page);await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await page.keyboard.press('Tab');await expect(dialog.getByRole('link',{name:'Trust Wallet',exact:true})).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await page.evaluate(()=>window.__wcFixture.finish());await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.__wcFixture.state().cancelled)).toBe(0);await expect(page.locator('#wc-focus-return')).toBeFocused();
});
test('WalletConnect QR failure leaves working app links and cancellation available',async({page})=>{
 const dialog=await setup(page,{failQr:true});await expect(dialog.getByRole('img')).toBeHidden();
 await expect(dialog.getByRole('status')).toHaveText('QR rendering failed. Choose an app or copy the connection link.');await expect(dialog.getByRole('link',{name:'Trust Wallet',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.__wcFixture.state().cancelled)).toBe(1);
});
