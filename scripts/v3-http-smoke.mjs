import {spawn} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const port=process.env.QA_WEB_PORT||'13084';
const rpcPort=process.env.QA_RPC_PORT||'18553';
const env={...process.env,PORT:port,LOCAL_RPC_PORT:rpcPort,HOST:'127.0.0.1'};
delete env.RPC_URL;
delete env.EVENT_RPC_URL;

const child=spawn(process.execPath,['scripts/local-v3.mjs'],{
  env,
  stdio:['ignore','pipe','pipe']
});

let output='',exited=false;
child.stdout.on('data',b=>{output+=b;});
child.stderr.on('data',b=>{output+=b;});
child.once('exit',()=>{exited=true;});

try{
  const deadline=Date.now()+180000;
  while(!output.includes('FTI V3 local test assets only.')){
    if(exited||Date.now()>deadline)throw Error('V3 local demo failed to start: '+output);
    await new Promise(r=>setTimeout(r,250));
  }

  const base=`http://127.0.0.1:${port}`;
  const routes=[
    '/','/app/','/token/','/admin/','/app.js','/style.css',
    '/health','/api/config','/api/state','/api/events',
    '/abi/FTIReserveTokenV3','/abi/FundedBinaryPlan','/abi/SevenGuardianCouncil'
  ];

  for(const route of routes){
    const response=await fetch(base+route,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200,route);
  }

  const cfg=await (await fetch(base+'/api/config')).json();
  assert.equal(cfg.release,'FTI_V3_ZERO_START');
  assert.equal(cfg.tokenContract,'FTIReserveTokenV3');
  assert.equal(cfg.binaryContract,'FundedBinaryPlan');
  assert.equal(cfg.councilContract,'SevenGuardianCouncil');
  assert.equal(cfg.daoThreshold,5);
  assert.equal(cfg.daoPartners.length,7);
  assert.equal(cfg.lockVersion,0);

  const state=await (await fetch(base+'/api/state?wallet='+cfg.accounts[0])).json();
  assert.equal(state.pricingModel,'zero-start-reserve-v3');
  assert.equal(state.rewardModel,'attributed-credit-v1');
  assert.equal(state.supply,'0');
  assert.equal(state.reserve,'0');
  assert(BigInt(state.supportReserve)>0n);
  assert.equal(state.price,'0');
  assert.equal(state.wallet.lockCount,0);
  assert.equal(state.wallet.ftiBalance,'0');
  assert.equal(state.maxSingleSellBps,'500');
  assert.equal(state.maxHourlyOutflowBps,'2000');
  assert.equal(state.tradeFeeBps,'300');
  assert.equal(state.charityBps,'0');
  assert.equal(state.reserveFeeBps,'300');
  assert.equal(typeof state.rewardQueueRemaining,'string');

  const locks=await (await fetch(base+'/api/locks?wallet='+cfg.accounts[0])).json();
  assert.equal(locks.total,0);
  assert.deepEqual(locks.locks,[]);

  const rejected=await fetch(base+'/rpc',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'evm_setAccountBalance',params:[]})
  });
  assert.equal(rejected.status,400);

  console.log('V3_HTTP',JSON.stringify({
    release:cfg.release,
    routes:routes.length,
    dao:'5-of-7',
    zeroStart:{supply:state.supply,reserve:state.reserve,price:state.price},
    supportReserve:state.supportReserve,
    locks:'none',
    rpcMutation:'rejected'
  }));
}finally{
  if(!exited){
    const stopped=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');
    const kill=setTimeout(()=>child.kill('SIGKILL'),5000);
    await stopped;
    clearTimeout(kill);
  }
}
