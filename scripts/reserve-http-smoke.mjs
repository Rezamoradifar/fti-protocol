import {spawn} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';

// Starts its own ephemeral, loopback-only test chain. Never use a public deployment.
const funded=process.argv.includes('--funded-plan');
const port=process.env.QA_WEB_PORT||'13082',rpcPort=process.env.QA_RPC_PORT||'18546';
const env={...process.env,PORT:port,LOCAL_RPC_PORT:rpcPort,HOST:'127.0.0.1'};
delete env.RPC_URL;delete env.EVENT_RPC_URL;delete env.UI_QA;
const child=spawn(process.execPath,['scripts/local.mjs',funded?'--funded-plan':'--reserve-token'],{env,stdio:['ignore','pipe','pipe']});
let output='',exited=false;
child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});child.once('exit',()=>{exited=true;});
try{
 const deadline=Date.now()+180000;
 while(!output.includes('Local test assets only.')){if(exited||Date.now()>deadline)throw Error('Local demo failed to start: '+output);await new Promise(r=>setTimeout(r,250));}
 const base=`http://127.0.0.1:${port}`,routes=['/','/app/','/token/','/admin/','/app.js','/style.css','/health','/api/config','/api/state','/api/events','/abi/FTIReserveToken'];
 for(const route of routes){const r=await fetch(base+route,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,route);}
 const cfg=await(await fetch(base+'/api/config')).json(),state=await(await fetch(base+'/api/state?wallet='+cfg.accounts[0])).json();
 assert.equal(cfg.tokenContract,'FTIReserveToken');assert.equal(state.pricingModel,'real-reserve-v2-zero-start');assert.equal(BigInt(state.totalSupply),BigInt(state.supply));assert.equal(BigInt(state.anchorSupply),0n);assert.equal(state.account2[0],state.account2[1]);assert.equal(state.wallet.units,'1');
 assert.equal(cfg.lockVersion,3);assert.equal(state.wallet.lockCount,'0');
 const locks=await(await fetch(base+'/api/locks?wallet='+cfg.accounts[0]+'&offset=0&limit=64')).json();assert.equal(locks.total,'0');assert.deepEqual(locks.locks,[]);
 assert.equal((await fetch(base+'/api/locks?wallet='+cfg.accounts[0]+'&limit=65')).status,400);
 if(funded){assert.equal(cfg.binaryContract,'FundedBinaryPlan');assert.equal(state.rewardModel,'attributed-credit-v1');assert(BigInt(state.pointRetained)>0n);assert.equal((await fetch(base+'/abi/FundedBinaryPlan')).status,200);}
 const rejected=await fetch(base+'/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'evm_setAccountBalance',params:[]})});assert.equal(rejected.status,400);
 const result={routes,model:cfg.tokenContract,rewardModel:cfg.rewardModel,lockPagination:'passed',accounting:'balanced',supplySeparation:'passed',unapprovedRpcMutation:'rejected',chainId:cfg.chainId,price:state.price,scope:'HTTP/API smoke on actual fresh local reserve deployment. Not browser rendering.'};
 fs.writeFileSync(funded?'docs/funded-http-results.json':'docs/reserve-http-results.json',JSON.stringify(result,null,2)+'\n');console.log('RESERVE_HTTP',JSON.stringify(result));
}finally{
 if(!exited){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await stopped;clearTimeout(kill);}
}
