import {ZeroAddress,id,AbiCoder,keccak256,getAddress,toBeHex} from 'ethers';

export async function completeExport(inventory,{provider,binary,token,cfg,chunk=1000}){
 const blockTag=inventory.block.number,at={blockTag};
 if(!Number.isSafeInteger(cfg.deployedBlock)||cfg.deployedBlock<=0||cfg.deployedBlock>blockTag)throw Error('Verified deployment start block required');
 if(!Number.isSafeInteger(chunk)||chunk<1||chunk>1000)throw Error('Log chunk must be 1..1000');
 const first=await provider.getBlock(cfg.deployedBlock);if(!first)throw Error('Deployment block unavailable');
 if(inventory.global.binary.phase!==0n||inventory.global.binary.monthPhase!==0n||inventory.global.binary.jobCursor!==inventory.global.binary.jobCount)throw Error('Finish settlement/volume before complete export');
 const addresses=new Set(inventory.users.map(u=>u.wallet.toLowerCase())),pairs=new Map(),logs=[];
 for(let from=cfg.deployedBlock;from<=blockTag;from+=chunk){
  const rows=await provider.getLogs({address:token.target,fromBlock:from,toBlock:Math.min(blockTag,from+chunk-1),topics:[[id('Transfer(address,address,uint256)'),id('Approval(address,address,uint256)')]]});
  for(const log of rows){
   const e=token.interface.parseLog(log);if(!e)throw Error('Unrecognized token ledger log');
   logs.push({blockNumber:log.blockNumber,transactionHash:log.transactionHash,index:log.index,topics:log.topics,data:log.data});
   if(e.name==='Transfer'){for(const who of [e.args.from,e.args.to])if(who!==ZeroAddress)addresses.add(who.toLowerCase());}
   else {addresses.add(e.args.owner.toLowerCase());pairs.set(`${e.args.owner.toLowerCase()}:${e.args.spender.toLowerCase()}`,[e.args.owner,e.args.spender]);}
  }
 }
 const holders=[];let supply=0n;
 for(const wallet of [...addresses].sort()){
  const balance=await token.balanceOf(wallet,at);supply+=balance;
  const u={wallet,balance};for(const n of ['purchaseCycle','cyclePurchases','lifetimeManualBuys'])u[n]=await token[n](wallet,at);
  holders.push(u);
 }
 if(supply!==inventory.global.token.totalSupply)throw Error('Token holder export does not reconcile to total supply');
 const allowances=[];for(const [owner,spender]of pairs.values())allowances.push({owner,spender,amount:await token.allowance(owner,spender,at)});
 const epochs=[],lastEpoch=Number(inventory.global.binary.epoch);if(!Number.isSafeInteger(lastEpoch)||lastEpoch>100000)throw Error('Unexpected epoch history');
 for(let epoch=1;epoch<=lastEpoch;epoch++){
  const entries=[];
  for(const u of inventory.users){
   const [points,auto,settled]=await Promise.all([binary.paidPoints(epoch,u.wallet,at),binary.autoSnapshot(epoch,u.wallet,at),binary.settled(epoch,u.wallet,at)]);
   if(points>0n||auto||settled)entries.push({wallet:u.wallet,points,auto,settled});
  }
  epochs.push({epoch,entries});
 }
 const monthKey=t=>{const d=new Date(t*1000);return d.getUTCFullYear()*12+d.getUTCMonth();};
 const start=Math.min(monthKey(first.timestamp),Number(inventory.global.binary.nextBuilderMonth)),end=monthKey(inventory.block.timestamp),months=[];
 if(end-start>1200)throw Error('Unexpected builder history');
 for(let month=start;month<=end;month++){
  const funding=await Promise.all([0,1,2,3].map(i=>binary.monthFunding(month,i,at))),members=[],credits=[];
  const count=Number(await binary.builderAccountCount(month,at));if(!Number.isSafeInteger(count)||count>inventory.users.length)throw Error('Unexpected builder account count');
  const layout=cfg.binaryStorageLayout;
  const slot=layout?.storage?.find(s=>s.label==='builderAccounts');
  if(!slot||layout.types[slot.type]?.encoding!=='mapping')throw Error('Verified builderAccounts storage layout required');
  const arraySlot=keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','uint256'],[month,slot.slot]));
  const storedRaw=await provider.getStorage(binary.target,arraySlot,blockTag);
  const storedCount=BigInt(storedRaw==='0x'?'0x0':storedRaw);
  if(storedCount!==BigInt(count))throw Error('Builder ordering storage mismatch');
  const base=BigInt(keccak256(arraySlot));
  for(let i=0;i<count;i++){
   const raw=await provider.getStorage(binary.target,toBeHex((base+BigInt(i))%(1n<<256n),32),blockTag);
   const wallet=getAddress('0x'+raw.slice(-40));
   if(!inventory.users.some(u=>u.wallet.toLowerCase()===wallet.toLowerCase()))throw Error('Unknown builder member');members.push(wallet);
  }
  for(const u of inventory.users){const amounts=await Promise.all([0,1,2,3].map(i=>binary.builderCredit(month,u.wallet,i,at)));credits.push({wallet:u.wallet,amounts});}
  months.push({month,funding,members,credits});
 }
 let pending=0n,automatic=0n;const cashQueue=[],autoQueue=[];
 for(const wallet of inventory.queues.rewards){const amount=await binary.pendingReward(wallet,at);pending+=amount;cashQueue.push({wallet,amount});}
 for(const wallet of inventory.queues.auto){const amount=await binary.pendingAuto(wallet,at);automatic+=amount;autoQueue.push({wallet,amount});}
 const ownedAuto=inventory.users.reduce((sum,u)=>sum+u.pendingAuto,0n);
 if(pending!==inventory.global.binary.totalPending||ownedAuto!==inventory.global.binary.totalAuto||automatic>ownedAuto)throw Error('Reward ownership reconciliation failed');
 const pointCredits=inventory.users.reduce((sum,u)=>sum+u.creditL+u.creditR,0n);
 const builderCredits=months.reduce((sum,m)=>sum+m.credits.reduce((s,c)=>s+c.amounts.reduce((a,v)=>a+v,0n),0n),0n);
 if(pointCredits!==inventory.global.binary.assignedPointCredit||builderCredits!==inventory.global.binary.assignedBuilderCredit)throw Error('Per-user credits do not reconcile to assigned books');
 const monthlyGlobal={};for(const n of ['builderCarry','monthBalances','monthEligible','monthPay','monthPaid'])monthlyGlobal[n]=await Promise.all([0,1,2,3].map(i=>binary[n](i,at)));
 for(const n of ['monthCursor','monthMembers','frozenPool'])monthlyGlobal[n]=await binary[n](at);
 const current=await provider.getBlock(blockTag);if(current.hash!==inventory.block.hash)throw Error('Snapshot reorganized');
 return {...inventory,ledger:{holders,allowances,logs,epochs,months,monthlyGlobal,cashQueue,autoQueue},schema:'FTI_COMPLETE_EXPORT_V1',migrationReady:false,limitations:['Export does not transfer collateral or activate replacement balances.','Old contract cannot be made fully frozen or upgradeable retroactively.','Builder ordering is read from storage using a supplied verified layout; validate code hashes and layout before import.','Allowances are audit records; they must not be recreated as user consent on a new token address.']};
}
