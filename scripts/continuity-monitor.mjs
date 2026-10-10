import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract} from 'ethers';

export async function inspectContinuity({binary,token,blockTag}){
 const at={blockTag},read=async(c,n)=>c[n](at),alerts=[];
 const [binaryBook,tokenBook,credits,phase,points,value,pending,queue,support,price,ath]=await Promise.all([read(binary,'accounting'),read(token,'accounting'),read(binary,'fundingAccounting'),read(binary,'phase'),read(binary,'totalPaidPoints'),read(binary,'pointValue'),read(binary,'totalPending'),read(binary,'rewardAccountCount'),read(token,'supportReserve'),read(token,'price'),read(token,'ath')]);
 if(binaryBook[0]<binaryBook[1])alerts.push({severity:'critical',code:'BINARY_COLLATERAL_DEFICIT'});
 if(tokenBook[0]<tokenBook[1])alerts.push({severity:'critical',code:'TOKEN_COLLATERAL_DEFICIT'});
 if(credits[0]!==credits[1]||credits[2]!==credits[3])alerts.push({severity:'critical',code:'CREDIT_BOOK_MISMATCH'});
 if(phase===0n&&points>0n&&value<20n*10n**18n)alerts.push({severity:'critical',code:'SETTLED_POINT_BELOW_20'});
 if(pending>0n&&queue===0n)alerts.push({severity:'critical',code:'PAYOUT_QUEUE_MISSING'});
 if(price<ath)alerts.push({severity:'warning',code:support===0n?'SUPPORT_EXHAUSTED':'PRICE_REPAIR_NEEDED'});
 const proposals=[];
 for(const c of [binary,token]){
  if(c.interface.hasFunction('recoveryFrozen')&&!await read(c,'recoveryFrozen'))proposals.push({target:c.target,value:'0',data:c.interface.encodeFunctionData('setRecoveryFrozen',[true])});
 }
 return {block:blockTag,alerts,critical:alerts.some(a=>a.severity==='critical'),unsignedFreezeProposals:proposals,submitted:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const cfg=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE||'deployments/continuity-testnet.json','utf8')),p=new JsonRpcProvider(process.env.RPC_URL||'http://127.0.0.1:3108/rpc');
 try{
  const chain=(await p.getNetwork()).chainId;if(![97n,31337n].includes(chain)||chain!==BigInt(cfg.chainId))throw Error('Testnet/local only; deployment chain mismatch');
  const contract=(address,name)=>new Contract(address,JSON.parse(fs.readFileSync(`artifacts/${name}.json`)).abi,p);
  const names={binary:cfg.binaryContract||'FundedBinaryPlan',token:cfg.tokenContract||'FTIReserveTokenV3'};
  if(!['FundedBinaryPlan','FundedBinaryPlanFloor','FundedBinaryPlanUpgradeable'].includes(names.binary)||!['FTIReserveTokenV3','FTIReserveTokenRecovery','FTIReserveTokenUpgradeable'].includes(names.token))throw Error('Unsupported contract model');
  const binary=contract(cfg.binary,names.binary),token=contract(cfg.token,names.token),blockTag=await p.getBlockNumber();
  if((await binary.token({blockTag})).toLowerCase()!==cfg.token.toLowerCase()||(await token.binary({blockTag})).toLowerCase()!==cfg.binary.toLowerCase())throw Error('Contract binding mismatch');
  const report=await inspectContinuity({binary,token,blockTag});console.log(JSON.stringify(report,null,2));if(report.critical)process.exitCode=2;
 }finally{p.destroy();}
}
