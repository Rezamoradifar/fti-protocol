import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract,keccak256,ZeroAddress} from 'ethers';

export function validateGenealogy(users){
 const index=new Map(users.map(u=>[u.wallet.toLowerCase(),u]));
 if(index.size!==users.length)throw Error('Duplicate member');
 for(const u of users){
  if(!u.member.exists)throw Error('Inactive member-list entry');
  for(const side of ['left','right']){
   const child=u.member[side];if(child===ZeroAddress)continue;
   const c=index.get(child.toLowerCase());
   if(!c||c.member.parent.toLowerCase()!==u.wallet.toLowerCase())throw Error('Broken child/parent link');
   if(BigInt(c.depth)!==BigInt(u.depth)+1n)throw Error('Broken depth');
  }
  if(u.member.parent!==ZeroAddress){
   const parent=index.get(u.member.parent.toLowerCase());
   if(!parent||![parent.member.left.toLowerCase(),parent.member.right.toLowerCase()].includes(u.wallet.toLowerCase()))throw Error('Missing parent link');
  }else if(BigInt(u.depth)!==0n)throw Error('Invalid root depth');
 }
 return true;
}
const named=r=>r.toObject(true);
export async function collectInventory({provider,binary,token,usd,cfg,blockTag}){
 const block=await provider.getBlock(blockTag);if(!block)throw Error('Snapshot block unavailable');
 const at={blockTag:block.number};const read=async(c,n,...args)=>c[n](...args,at);
 const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
 if(!same(await read(binary,'token'),token.target)||!same(await read(binary,'usd'),usd.target)||!same(await read(token,'binary'),binary.target)||!same(await read(token,'usd'),usd.target))throw Error('Contract binding mismatch');
 const count=Number(await read(binary,'memberCount'));
 if(!Number.isSafeInteger(count)||count>1000000)throw Error('Unexpected member count');
 const users=[];
 for(let i=0;i<count;i++){
  const wallet=await read(binary,'memberList',i),member=named(await read(binary,'members',wallet));
  const u={index:i,wallet,member};
  for(const n of ['depth','activatedAtSerial','creditL','creditR','pendingReward','pendingAuto'])u[n]=await read(binary,n,wallet);
  u.rankReachedAt=await Promise.all([0,1,2,3].map(k=>read(binary,'rankReachedAt',wallet,k)));
  u.builderClaimed=await Promise.all([0,1,2,3].map(k=>read(binary,'builderClaimed',wallet,k)));
  u.token={};for(const n of ['balanceOf','purchaseCycle','cyclePurchases','lifetimeManualBuys'])u.token[n]=await read(token,n,wallet);
  users.push(u);
 }
 validateGenealogy(users);
 const global={binary:{},token:{}};
 for(const n of ['epoch','epochEnd','lastClosedAt','epochUnits','unitsSinceSettlement','fundingSerial','pointPool','queuedPointCredit','assignedPointCredit','retainedPointReserve','queuedBuilderCredit','assignedBuilderCredit','retainedBuilderReserve','builderAccounted','totalPending','totalAuto','phase','monthPhase','nextBuilderMonth','protectionLevel','frozenLevel','cursor','frozenMembers','totalPaidPoints','allocated','pointValue','dirtyCount','jobCursor','jobCount'])global.binary[n]=await read(binary,n);
 for(const n of ['reserve','supportReserve','launchPrice','ath','pendingSupportTarget','cycle','cycleStartPrice','sellWindowStart','sellWindowOpeningReserve','sellWindowOutflow','emergencyUnwind','emergencyRemainingPool','emergencyRemainingSupply','totalSupply','price'])global.token[n]=await read(token,n);
 for(const n of ['recoveryFrozen','recoverySnapshotRoot','recoveryCheckpointSerial'])if(binary.interface.hasFunction(n))global.binary[n]=await read(binary,n);
 if(token.interface.hasFunction('recoveryFrozen'))global.token.recoveryFrozen=await read(token,'recoveryFrozen');
 const development=await read(binary,'development');
 const pendingDevelopment=await read(binary,'pendingReward',development);
 const queues={rewards:[],auto:[],dirty:[],jobs:[]};
 for(const [key,countName,itemName]of [['rewards','rewardAccountCount','rewardAccounts'],['auto','autoAccountCount','autoAccounts'],['dirty','dirtyCount','dirtyMembers'],['jobs','jobCount','jobs']]){
  const size=Number(await read(binary,countName));if(!Number.isSafeInteger(size)||size>1000000)throw Error('Unexpected queue size');
  for(let i=0;i<size;i++){const value=await read(binary,itemName,i);queues[key].push(typeof value==='string'?value:named(value));}
 }
 const binaryBook=await read(binary,'accounting'),tokenBook=await read(token,'accounting'),credits=await read(binary,'fundingAccounting');
 if(binaryBook[0]!==binaryBook[1]||tokenBook[0]!==tokenBook[1]||credits[0]!==credits[1]||credits[2]!==credits[3])throw Error('Accounting mismatch; inventory rejected');
 const codes={};for(const [key,address]of Object.entries({binary:binary.target,token:token.target,usd:usd.target})){const code=await provider.getCode(address,block.number);if(code==='0x')throw Error('Missing contract code');codes[key]=keccak256(code);if(cfg.codeHashes?.[key]&&codes[key]!==cfg.codeHashes[key])throw Error('Deployment code hash mismatch');}
 const again=await provider.getBlock(block.number);if(again.hash!==block.hash)throw Error('Snapshot block reorganized');
 return {schema:'FTI_READONLY_INVENTORY_V1',chainId:String((await provider.getNetwork()).chainId),block:{number:block.number,hash:block.hash,timestamp:block.timestamp},contracts:{binary:binary.target,token:token.target,usd:usd.target},codeHashes:codes,users,global,queues,development:{wallet:development,pending:pendingDevelopment},accounting:{binary:[...binaryBook],token:[...tokenBook],funding:[...credits]},migrationReady:false,limitations:['Read-only inventory; no funds or users migrated.','A fixed-block read is not a freeze of the old contracts.','Non-member token holders, ERC20 allowances, historical epoch mappings and monthly builder mappings require separate event/storage export before any full migration.','The old binary has no USD migration withdrawal; never issue unfunded replacement balances.']};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const cfg=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE||'deployments/v3-testnet.json','utf8'));
 const provider=new JsonRpcProvider(process.env.RPC_URL||'http://127.0.0.1:3108/rpc');
 try{
  const chain=(await provider.getNetwork()).chainId;if(chain!==97n&&chain!==31337n)throw Error('Testnet/local only');if(chain!==BigInt(cfg.chainId))throw Error('Wrong deployment chain');
  const abi=n=>JSON.parse(fs.readFileSync(`artifacts/${n}.json`,'utf8')).abi;
  const binaryName=cfg.binaryContract||'FundedBinaryPlan',tokenName=cfg.tokenContract||'FTIReserveTokenV3';
  if(!['FundedBinaryPlan','FundedBinaryPlanFloor'].includes(binaryName)||!['FTIReserveTokenV3','FTIReserveTokenRecovery'].includes(tokenName))throw Error('Unsupported inventory model');
  const binary=new Contract(cfg.binary,abi(binaryName),provider),token=new Contract(cfg.token,abi(tokenName),provider),usd=new Contract(cfg.usd,abi('MockUSD'),provider);
  const blockTag=process.env.FTI_SNAPSHOT_BLOCK?Number(process.env.FTI_SNAPSHOT_BLOCK):await provider.getBlockNumber();
  if(!Number.isSafeInteger(blockTag)||blockTag<0)throw Error('Invalid block');
  const report=await collectInventory({provider,binary,token,usd,cfg,blockTag});
  const output=process.env.FTI_INVENTORY_OUTPUT;if(!output)throw Error('Set FTI_INVENTORY_OUTPUT to a new report path');
  fs.writeFileSync(output,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({result:'INVENTORY_SAVED',members:report.users.length,block:report.block.number,migrationReady:false,output}));
 }finally{provider.destroy();}
}
