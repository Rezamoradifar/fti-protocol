import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,parseEther,MaxUint256} from 'ethers';
import {artifact} from '../scripts/lib.mjs';
import {startWeb} from '../scripts/server.mjs';
import {createBudget} from '../scripts/address-migration-policy.mjs';
import {freshDigest,prepareFresh,deployFresh,validateFreshInput,validateFreshPlan} from '../scripts/fresh-testnet.mjs';
const address=i=>'0x'+i.toString(16).padStart(40,'0');
const valid=()=>({chainId:31337,deployer:address(1),partners:Array.from({length:7},(_,i)=>address(10+i)),testGenesis:true});
for(const [name,mutate]of [
  ['mainnet',x=>x.chainId=56],['string or unselected network',x=>x.chainId='97'],
  ['missing bootstrap consent',x=>x.testGenesis=false],['zero deployer',x=>x.deployer=address(0)],
  ['missing council member',x=>x.partners.pop()],['duplicate council member',x=>x.partners[1]=x.partners[0]],
  ['invalid guardian address',x=>x.partners[0]='someone']
])test('fresh deployment rejects '+name,()=>{const x=valid();mutate(x);assert.throws(()=>validateFreshInput(x));});
test('explicit seven-address configuration and canonical plan digest',()=>{
 assert.equal(validateFreshInput(valid()).partners.length,7);
 assert.equal(freshDigest({b:2,a:{d:4,c:3}}),freshDigest({a:{c:3,d:4},b:2}));
 assert.notEqual(freshDigest({units:'9007199254740992'}),freshDigest({units:'9007199254740993'}));
});
test('CLI help does not sign and an unsupported command does not default to deploy',()=>{
 const help=spawnSync(process.execPath,['scripts/fresh-testnet.mjs','--help'],{encoding:'utf8'});
 assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/No old-council approvals/);
 const invalid=spawnSync(process.execPath,['scripts/fresh-testnet.mjs','migrate'],{encoding:'utf8'});
 assert.notEqual(invalid.status,0);
});

test('fresh deployment uses new addresses/zero books, leaves a funded previous network intact, and serves the new Builder API',{timeout:240000},async t=>{
 const engine=ganache.server({chain:{chainId:31337,time:new Date('2026-01-12T00:00:00Z')},logging:{quiet:true},wallet:{totalAccounts:20},miner:{blockGasLimit:30000000}});
 await engine.listen(0,'127.0.0.1');
 const provider=new BrowserProvider(engine.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-fresh-test-'));
 const originalRpc=process.env.RPC_URL,originalPort=process.env.PORT,originalHost=process.env.HOST;
 let web;
 const budget=()=>createBudget({maxFeeWei:parseEther('1'),maxGasPriceWei:10000000000n,maxGas:12000000,maxTransactions:8});
 const sent=async p=>{const receipt=await(await p).wait();assert.equal(receipt.status,1);return receipt;};
 try{
  const w=await Promise.all(Array.from({length:20},(_,i)=>provider.getSigner(i))),a=await Promise.all(w.map(x=>x.getAddress()));
  const oldPrepared=await prepareFresh({provider,chainId:31337,deployer:a[0],partners:a.slice(1,8),testGenesis:true});
  const oldCfg=await deployFresh({provider,signer:w[0],plan:oldPrepared.plan,confirmPlan:oldPrepared.plan.digest,budget:budget(),confirmations:1});
  const oldB=new Contract(oldCfg.binary,artifact('FundedBinaryPlanUpgradeable').abi,w[0]);
  const oldT=new Contract(oldCfg.token,artifact('FTIReserveTokenUpgradeable').abi,w[0]);
  const oldUSD=new Contract(oldCfg.usd,artifact('MockUSD').abi,w[0]);
  await sent(oldUSD.faucet());await sent(oldUSD.approve(oldB.target,MaxUint256));await sent(oldB.addUnits(3));
  await sent(oldUSD.approve(oldT.target,MaxUint256));await sent(oldT.buy(parseEther('100'),0,MaxUint256));
  const capture=async()=>({members:[...await oldB.members(a[0])],count:await oldB.memberCount(),binary:[...await oldB.accounting()],token:[...await oldT.accounting()],
    supply:await oldT.totalSupply(),balance:await oldT.balanceOf(a[0]),pending:await oldB.totalPending(),epoch:await oldB.epoch(),governance:await oldB.governance()});
  const before=await capture();assert(before.binary[0]>0n);assert(before.token[0]>0n);assert(before.balance>0n);
  const {plan,testKeys}=await prepareFresh({provider,chainId:31337,deployer:a[8],partners:a.slice(9,16),testGenesis:true});
  await validateFreshPlan(plan);
  assert.equal(testKeys.wallets.length,30);assert(!JSON.stringify(plan).includes('privateKey'));
  assert(plan.genesis.every(g=>!oldCfg.genesis.some(o=>o.toLowerCase()===g.toLowerCase())));
  for(const key of ['binary','token','usd','council','timelock','binaryImplementation','tokenImplementation'])assert.notEqual(plan.addresses[key],oldCfg[key]);
  await t.test('tampered or extra transaction data fails before signing',async()=>{
    const altered=structuredClone(plan);altered.transactions.at(-1).to=oldCfg.token;
    const {digest,...body}=altered;altered.digest=freshDigest(body);
    await assert.rejects(()=>validateFreshPlan(altered),/arbitrary transaction/);
    const imported=structuredClone(plan);imported.oldDeployment=oldCfg;
    const {digest:d,...b}=imported;imported.digest=freshDigest(b);
    await assert.rejects(()=>validateFreshPlan(imported),/arbitrary transaction/);
  });
  await t.test('wrong confirmation/signer and insufficient budget produce no new contracts',async()=>{
    await assert.rejects(()=>deployFresh({provider,signer:w[8],plan,confirmPlan:'0'.repeat(64),budget:budget(),confirmations:1}),/digest required/);
    await assert.rejects(()=>deployFresh({provider,signer:w[0],plan,confirmPlan:plan.digest,budget:budget(),confirmations:1}),/wallet differs/);
    await assert.rejects(()=>deployFresh({provider,signer:w[8],plan,confirmPlan:plan.digest,budget:createBudget({maxFeeWei:1,maxGasPriceWei:1,maxTransactions:8}),confirmations:1}),/budget exceeded/);
    assert.equal(await provider.getCode(plan.addresses.usd),'0x');
  });
  const events=[];
  const cfg=await deployFresh({provider,signer:w[8],plan,confirmPlan:plan.digest,budget:budget(),confirmations:1,onEvent:async e=>events.push(e)});
  assert.equal(cfg.importedUsers,0);assert.equal(cfg.importedFunds,'0');assert.equal(cfg.initialState.memberCount,31);
  assert.equal(cfg.initialState.price,'0');assert.equal(cfg.initialState.bootstrapQuotePrice,'100000000000000000');
  assert.equal(events.filter(e=>e.status==='SUBMITTED').length,8);
  assert.equal(events.filter(e=>e.status==='CONFIRMED').length,8);
  assert.equal(cfg.constructorArgs.council[0].length,7);
  assert.deepEqual(await capture(),before);
  await assert.rejects(()=>deployFresh({provider,signer:w[8],plan,confirmPlan:plan.digest,budget:budget(),confirmations:1}),/nonce changed/);
  const b=new Contract(cfg.binary,artifact('FundedBinaryPlanUpgradeable').abi,w[8]);
  const tkn=new Contract(cfg.token,artifact('FTIReserveTokenUpgradeable').abi,w[8]);
  assert.equal(await b.registered(a[0]),false);assert.equal(await tkn.balanceOf(a[0]),0n);
  await sent(b.setAutoBuyPercent(true,100));assert.equal(await b.autoBuyPercent(a[8]),100n);
  for(const p of [4,101])await assert.rejects(()=>b.setAutoBuyPercent.staticCall(true,p));
  const monthlyBefore=await b.nextBuilderMonth();
  const request=await sent(b.beginBuilderMonth());assert.equal(await b.monthPhase(),0n);assert.equal(await b.nextBuilderMonth(),monthlyBefore);
  const event=request.logs.map(l=>{try{return b.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='BuilderMonthCloseRequested');
  assert(event);assert.equal(event.args.effectiveAt,BigInt(Date.parse('2026-02-01T00:00:00Z')/1000));
  // Uninitialized implementations and reinitializing proxies are not usable.
  const initArgs=b.interface.decodeFunctionData('initialize',cfg.constructorArgs.binary[1]);
  await assert.rejects(()=>b.initialize.staticCall(...initArgs));
  const implementation=new Contract(cfg.binaryImplementation,b.interface,w[8]);
  await assert.rejects(()=>implementation.initialize.staticCall(...initArgs));
  const deployment=path.join(dir,'deployment.json');fs.writeFileSync(deployment,JSON.stringify(cfg),{mode:0o600});
  process.env.RPC_URL='http://127.0.0.1:'+engine.address().port;process.env.PORT='0';process.env.HOST='127.0.0.1';
  web=await startWeb(deployment);const base='http://127.0.0.1:'+web.address().port;
  const api=await(await fetch(base+'/api/config')).json();assert.equal(api.binary,cfg.binary);assert.equal(api.selectableHourlyAutoBuy,true);
  const state=await(await fetch(base+'/api/state?wallet='+a[8])).json();assert.equal(state.wallet.autoBuyPercent,'100');assert.equal(state.count,'31');
  for(const route of ['/health','/app/','/token/','/admin/','/abi/FundedBinaryPlanUpgradeable'])assert.equal((await fetch(base+route)).status,200,route);
  await t.test('real CLI writes private plan/deployment records and refuses a repeated deployment',async()=>{
    const target=path.join(dir,'cli-fresh'),daoFile=path.join(dir,'dao.json'),keyFile=path.join(dir,'deployer.key');
    fs.writeFileSync(daoFile,JSON.stringify({threshold:5,partners:a.slice(1,8)}),{mode:0o600});
    const secret=engine.provider.getInitialAccounts()[a[16].toLowerCase()].secretKey;
    fs.writeFileSync(keyFile,secret,{mode:0o600});
    const run=args=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['scripts/fresh-testnet.mjs',...args],{env:{...process.env,FTI_FRESH_RPC_URL:'http://127.0.0.1:'+engine.address().port},stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
      child.stdout.on('data',x=>{stdout+=x});child.stderr.on('data',x=>{stderr+=x});
      child.on('error',e=>{clearTimeout(timer);reject(e)});
      child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});
    });
    const prepared=await run(['plan','--chain','31337','--deployer',a[16],'--dao-file',daoFile,'--test-genesis','--out',target]);
    assert.equal(prepared.code,0,prepared.stderr);const summary=JSON.parse(prepared.stdout.trim());
    assert.equal(summary.result,'FTI_FRESH_PLAN_READY');assert.equal(summary.deployed,false);
    assert.equal(fs.statSync(target).mode&0o777,0o700);
    assert.equal(fs.statSync(path.join(target,'test-genesis-keys.json')).mode&0o777,0o600);
    const unsigned=await run(['deploy','--out',target]);assert.notEqual(unsigned.code,0);
    assert(!fs.existsSync(path.join(target,'deployment.started.json')));
    const args=['deploy','--out',target,'--send','--confirm-plan',summary.digest,'--key-file',keyFile,'--max-fee-wei',parseEther('1').toString(),'--max-gas-price-wei','10000000000','--confirmations','1'];
    const deployed=await run(args);assert.equal(deployed.code,0,deployed.stderr);
    assert.equal(JSON.parse(deployed.stdout.trim()).result,'FTI_FRESH_TESTNET_DEPLOYED');
    assert(!deployed.stdout.includes(secret));assert(!deployed.stdout.includes('privateKey'));
    const saved=fs.readFileSync(path.join(target,'deployment.json'),'utf8');
    const journal=fs.readFileSync(path.join(target,'journal.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(journal.filter(e=>e.status==='CONFIRMED').length,8);
    assert.equal(fs.statSync(path.join(target,'deployment.json')).mode&0o777,0o600);
    const repeat=await run(args);assert.notEqual(repeat.code,0);
    assert.equal(fs.readFileSync(path.join(target,'deployment.json'),'utf8'),saved);
  });
  assert.deepEqual(await capture(),before);
  console.log('FTI_FRESH_RELEASE_TEST',JSON.stringify({scope:'LOCAL_EVM_NOT_PUBLIC_NETWORK',newContracts:7,transactions:8,bootstrapPositions:31,
    importedUsers:0,importedFunds:'0',oldFundedNetworkUnchanged:true,newAutoBuyPercent:100,earlyMonthRequestOnly:true,webApiVerified:true}));
 }finally{
  if(web)await new Promise(r=>web.close(r));provider.destroy();await engine.close();fs.rmSync(dir,{recursive:true,force:true});
  for(const [key,value]of [['RPC_URL',originalRpc],['PORT',originalPort],['HOST',originalHost]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
