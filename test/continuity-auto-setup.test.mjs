import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Wallet,parseEther as E} from 'ethers';
import {prepareAuto} from '../scripts/prepare-continuity-auto.mjs';
test('auto setup persists nine wallets, exposes only addresses and funds bounded test gas',{timeout:90000},async()=>{
 const engine=ganache.provider({chain:{chainId:31337},logging:{quiet:true}}),p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-auto-'));
 try{
  const options={state:dir,rpc:'http://127.0.0.1:unused',provider:p,allowLocal:true,sourceRevision:'0'.repeat(40)};
  const empty=await prepareAuto(options);assert.equal(empty.ready,false);assert.equal(empty.council.length,7);assert(!JSON.stringify(empty).includes('privateKey'));
  const filename=path.join(dir,'auto-wallets.json');assert.equal(fs.statSync(filename).mode&0o777,0o600);
  const again=await prepareAuto(options);assert.equal(again.deployer,empty.deployer);assert.deepEqual(again.council,empty.council);
  const wallets=JSON.parse(fs.readFileSync(filename)),funderKey=Object.values(engine.getInitialAccounts())[0].secretKey,funder=new Wallet(funderKey),before=await p.getBalance(funder.address);
  const ready=await prepareAuto({...options,funderKey});assert.equal(ready.ready,true);assert.equal(ready.deployer,empty.deployer);
  const after=BigInt(await p.send('eth_getBalance',[funder.address,'latest']));assert(before-after<E('0.2'));assert(after>=E('0.05'));
  assert.equal((await p.getBalance(ready.keeper)),E('0.03'));assert.equal(await p.getBalance(ready.council[0]),E('0.002'));
  const nonce=await p.getTransactionCount(funder.address,'latest');await prepareAuto({...options,funderKey});assert.equal(await p.getTransactionCount(funder.address,'latest'),nonce);
  const dao=JSON.parse(fs.readFileSync(path.join(dir,'dao.json')));assert.deepEqual(dao.partners,ready.council);
  const keeperEnv=fs.readFileSync(path.join(dir,'keeper.env'),'utf8');assert(keeperEnv.includes(wallets.keeper));assert(!keeperEnv.includes(wallets.deployer));
 }finally{p.destroy();await engine.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
