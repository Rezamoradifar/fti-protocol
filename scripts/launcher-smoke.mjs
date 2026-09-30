import ganache from 'ganache';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH);
const owner='0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3';
const chain=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{unlockedAccounts:[owner]},miner:{blockGasLimit:30000000}});
await chain.request({method:'evm_setAccountBalance',params:[owner,'0x56BC75E2D63100000']});
process.env.PORT='3001';await import('./launch-server.mjs');
const bundled=(await import(process.env.BROWSER_BUNDLE)).default;
const browser=await chromium.launch({headless:true,args:bundled.args,executablePath:process.env.BROWSER_EXECUTABLE});
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];globalThis.qaPage=page;page.on('pageerror',e=>errors.push(e.message));
await page.exposeFunction('evmRequest',async({method,params})=>{if(['eth_requestAccounts','eth_accounts'].includes(method))return[owner];if(method==='wallet_switchEthereumChain')return null;return chain.request({method,params:params||[]});});
await page.addInitScript(()=>{window.ethereum={request:args=>window.evmRequest(args),on:()=>{}}});
await page.goto('http://127.0.0.1:3001');await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#wallet').textContent.includes('Balance:'));
await page.locator('#password').fill('local-test-password-only');await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#backup-state').textContent.includes('unlocked'),null,{timeout:60000});
await page.locator('#backup-confirm').check();await page.locator('#deploy').click();await page.waitForFunction(()=>document.querySelectorAll('#steps li.done').length===6,null,{timeout:120000});await page.waitForFunction(()=>!document.querySelector('#faucet').disabled);
await page.locator('#faucet').click();await page.waitForFunction(()=>!document.querySelector('#faucet').disabled);await page.locator('#add-units').click();await page.waitForFunction(()=>document.querySelector('#account-info').textContent.includes('Units 1'),null,{timeout:60000});
page.on('dialog',d=>d.accept());await page.locator('#buy').click();await page.waitForFunction(()=>!document.querySelector('#buy').disabled);if(await page.locator('#status').evaluate(e=>e.classList.contains('error')))throw Error(await page.locator('#status').innerText());
await page.screenshot({path:'qa/launcher-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa/launcher-mobile.png',fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(errors.length||overflow)throw Error(JSON.stringify({errors,overflow}));
const result={network:'isolated local Ganache EVM with chain ID 97; no public testnet transactions',deployment:'six confirmed transactions',encryptedBackup:'generated',membership:'one unit',buy:'confirmed',pageErrors:errors,horizontalOverflow:overflow};fs.writeFileSync('docs/launcher-test-results.json',JSON.stringify(result,null,2));console.log(result);
}catch(e){console.error(e);if(globalThis.qaPage){console.error(await qaPage.locator('#status').innerText());await qaPage.screenshot({path:'qa/launcher-failure.png',fullPage:true});}process.exitCode=1;}finally{await browser.close();await chain.disconnect();process.exit(process.exitCode||0);}
