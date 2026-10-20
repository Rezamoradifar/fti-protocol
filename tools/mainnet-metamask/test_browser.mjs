// Local synthetic wallet only. This process cannot contact a chain or sign anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from '../../landing/node_modules/@playwright/test/index.mjs';
import {mainnetPayloads} from '../../scripts/prepare-mainnet.mjs';
import {freshDigest} from '../../scripts/fresh-testnet.mjs';
import {releaseManifest} from '../../scripts/continuity-release.mjs';
import {buildOperator} from './build.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fti-operator-browser-'));
const input=JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json'));
const body={schema:'FTI_MAINNET_UNSIGNED_PLAN_V1',input,manifest:releaseManifest(),nonce:0,...await mainnetPayloads(input,0),readyToBroadcast:false};
const plan={...body,digest:freshDigest(body)};
await buildOperator(plan,path.join(temp,'public'));
const server=http.createServer((req,res)=>{
 const name=req.url==='/'?'index.html':req.url.slice(1);
 if(!['index.html','operator.js','plan.json'].includes(name)){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html; charset=utf-8');
 res.end(fs.readFileSync(path.join(temp,'public',name)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({...(process.env.FTI_CHROMIUM_PATH?{executablePath:process.env.FTI_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.addInitScript(deployer=>{
   window.walletCalls=[];window.walletChain='0x61';window.walletAccount=deployer;
   window.ethereum={isMetaMask:true,request:async({method})=>{
    window.walletCalls.push(method);
    if(method==='eth_requestAccounts'||method==='eth_accounts')return [window.walletAccount];
    if(method==='eth_chainId')return window.walletChain;
    if(method==='eth_getTransactionCount')return '0x1'; // Force a changed nonce; never send.
    throw Error('Unexpected wallet operation '+method);
   }};
  },input.deployer);
  await page.goto(origin+'/');await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('deployer'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Horizontal overflow at '+width);
  await page.locator('#budget').fill('0.01');await page.locator('#ceiling').fill('0.1');await page.locator('#digest').fill('wrong');await page.locator('#connect').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('digest printed'));
  assert.equal(await page.evaluate(()=>walletCalls.length),0);
  await page.locator('#digest').fill(plan.digest);await page.locator('#connect').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('mainnet (56)'));
  await page.evaluate(()=>{window.walletChain='0x38';window.walletAccount='0x'+'1'.repeat(40)});await page.locator('#connect').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('deployment account'));
  await page.evaluate(deployer=>{window.walletAccount=deployer},input.deployer);await page.locator('#connect').click();
  await page.waitForFunction(()=>!document.getElementById('send').disabled);await page.locator('#send').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Nonce changed'));
  assert.equal(await page.evaluate(()=>walletCalls.includes('eth_sendTransaction')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS operator browser: width '+width+', digest/chain/account/nonce refusal, no signing request, no page errors');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true})}
