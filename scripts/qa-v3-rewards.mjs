// Local-only real browser QA. Requires a separately supplied Playwright module.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256} from 'ethers';
import {deployOne,settle} from './lib.mjs';
import {startWeb} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-reward-ui-'));
const chain=ganache.server({logging:{quiet:true},wallet:{totalAccounts:40},chain:{chainId:31337,time:new Date('2026-10-06T12:00:00Z')},miner:{timestampIncrement:0,blockGasLimit:30000000}});
let browser,server,provider;
try{
 await chain.listen(0);const rpc='http://127.0.0.1:'+chain.address().port;provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const signers=await Promise.all(Array.from({length:40},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const usd=await deployOne('MockUSD',[],signers[0]),council=await deployOne('SevenGuardianCouncil',[addresses.slice(31,38)],signers[0]);
 const token=await deployOne('FTIReserveTokenV3',[usd.target,addresses[39],council.target],signers[0]);
 const binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,addresses[39],council.target,addresses[38],addresses.slice(0,31)],signers[0]);
 await(await token.bind(binary.target)).wait();
 for(const i of [0,1,2]){await(await usd.connect(signers[i]).faucet()).wait();await(await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();await(await binary.connect(signers[i]).addUnits(i===0?1:5)).wait();}
 await settle({usd,token,binary},provider);
 const rootCash=await usd.balanceOf(addresses[0]);
 const cash=await binary.totalPending(),rootReward=await binary.pendingReward(addresses[0]),devReward=await binary.pendingReward(addresses[38]);
 await(await usd.setBlocked(addresses[0],true)).wait();
 const cfg={mode:'local',chainId:31337,rpcUrl:rpc,accounts:addresses,genesis:addresses.slice(0,31),councilOwners:addresses.slice(31,38),usd:usd.target,token:token.target,binary:binary.target,council:council.target,tokenContract:'FTIReserveTokenV3',binaryContract:'FundedBinaryPlan',councilContract:'SevenGuardianCouncil',batchedRewards:true};
 const config=path.join(dir,'deployment.json');fs.writeFileSync(config,JSON.stringify(cfg));process.env.PORT='0';process.env.HOST='127.0.0.1';delete process.env.RPC_URL;server=await startWeb(config);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/app/#rewards');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Wallet connected'));
 await page.locator('#connect').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Wallet connected'));
 assert.match(await page.locator('#reward-queue').innerText(),/2 wallets/);
 await page.locator('#reward-all').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Payout confirmed: 1 wallets paid'));
 assert.equal(await usd.balanceOf(addresses[38]),devReward);assert.equal(await binary.pendingReward(addresses[0]),rootReward);assert.match(await page.locator('#reward-queue').innerText(),/1 wallets/);
 await(await usd.setBlocked(addresses[0],false)).wait();await page.locator('#reward-all').click();await page.waitForFunction(()=>document.querySelector('#reward-queue').textContent.includes('0 wallets'));
 assert.equal(await binary.totalPending(),0n);assert.equal(await usd.balanceOf(addresses[0]),rootCash+rootReward);
 assert(await page.locator('#reward-all').isDisabled());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);const output=process.env.FTI_QA_DIR||'qa';fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'v3-rewards-mobile.png'),fullPage:true});
 const report={viewport:'390x844',cashWei:cash.toString(),blockedRecipientRetained:true,healthyRecipientPaid:true,retryClearsQueue:true,emptyQueueButtonDisabled:true,pageErrors:errors};fs.writeFileSync(path.join(output,'v3-rewards-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));provider?.destroy();await chain.close();fs.rmSync(dir,{recursive:true,force:true});}
