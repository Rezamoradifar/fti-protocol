import {chromium} from '../landing/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('frontend/wallet-selector.js','utf8').replace("import {t} from './locale.js';","const t=s=>s;")+ '\nwindow.chooseWallet=chooseWallet;';
const browser=await chromium.launch({executablePath:process.env.FTI_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const mode of ['native','missing','throws']){
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<body data-surface="member"><button id="connect">Connect</button></body>');
  await page.addStyleTag({content:fs.readFileSync('frontend/panel-identity.css','utf8').replace(/@import[^;]+;/g,'')});
  await page.evaluate(mode=>{
   window.ethereum={isMetaMask:true,providers:{},request:async()=>[]};
   if(mode==='missing')HTMLDialogElement.prototype.showModal=undefined;
   if(mode==='throws')HTMLDialogElement.prototype.showModal=()=>{throw Error('Unsupported');};
  },mode);
  await page.addScriptTag({type:'module',content:source});
  await page.waitForFunction(()=>typeof window.chooseWallet==='function');
  await page.evaluate(()=>document.querySelector('#connect').onclick=()=>{window.choice=undefined;window.chooseWallet({chainId:56}).then(w=>window.choice=w?.name||'cancel');});
  await page.click('#connect');await page.getByRole('button',{name:'MetaMask',exact:true}).click();
  await page.waitForFunction(()=>window.choice==='MetaMask');assert.equal(await page.locator('.wallet-dialog').count(),0);
  await page.click('#connect');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForFunction(()=>window.choice==='cancel');assert.equal(await page.locator('.wallet-dialog-fallback').count(),0);
  console.log('PASS dialog open/select/cancel/reopen:',mode);await page.close();
 }
}finally{await browser.close();}
