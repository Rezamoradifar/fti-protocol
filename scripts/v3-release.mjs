import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Contract,keccak256} from 'ethers';
export const RELEASE='FTI_V3_OWNER_DECISIONS_20261008';
const models={usd:'MockUSD',council:'SevenGuardianCouncil',timelock:'FTITimelock',token:'FTIReserveTokenV3',binary:'FundedBinaryPlan'};
const hash=x=>createHash('sha256').update(x).digest('hex');
export function contractDigest(){
 return hash(JSON.stringify(fs.readdirSync('contracts').filter(x=>x.endsWith('.sol')).sort().map(x=>[x,hash(fs.readFileSync('contracts/'+x))])));
}
export function releaseManifest(){
 const digest=contractDigest(),artifacts={};
 for(const name of Object.values(models)){
  const file='artifacts/'+name+'.json',data=JSON.parse(fs.readFileSync(file));
  if(data.sourceDigest!==digest)throw Error('Stale ABI/artifact: '+name+'. Run npm run compile.');
  artifacts[name]=hash(fs.readFileSync(file));
 }
 const sources={};
 for(const dir of ['contracts','frontend','scripts','landing/src'])for(const name of fs.readdirSync(dir).sort()){
  const file=dir+'/'+name;if(fs.statSync(file).isFile()&&/\.(sol|mjs|jsx|js|css)$/.test(name))sources[file]=hash(fs.readFileSync(file));
 }
 for(const file of ['package.json','package-lock.json','web/app.js'])sources[file]=hash(fs.readFileSync(file));
 const sourceFingerprint=hash(JSON.stringify(sources));
 let sourceRevision=process.env.FTI_SOURCE_REVISION||process.env.GITHUB_SHA||null;
 if(!sourceRevision)try{sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 if(sourceRevision&&!/^[a-f0-9]{40}$/.test(sourceRevision))throw Error('Source revision must be a full commit SHA');
 return {sourceRevision,sourceFingerprint,artifactHashes:artifacts};
}
export async function verifyV3Deployment(cfg,provider){
 const manifest=releaseManifest();
 if(cfg.release!==RELEASE||cfg.sourceFingerprint!==manifest.sourceFingerprint||JSON.stringify(cfg.artifactHashes)!==JSON.stringify(manifest.artifactHashes))throw Error('Deployment/build release mismatch');
 if(cfg.sourceRevision&&manifest.sourceRevision&&cfg.sourceRevision!==manifest.sourceRevision)throw Error('Source revision mismatch');
 if((await provider.getNetwork()).chainId!==BigInt(cfg.chainId))throw Error('Wrong deployment network');
 const contracts={};
 for(const [key,name] of Object.entries(models)){
  const code=await provider.getCode(cfg[key]);
  if(code==='0x'||keccak256(code)!==cfg.codeHashes?.[key])throw Error('Deployed code mismatch: '+key);
  contracts[key]=new Contract(cfg[key],JSON.parse(fs.readFileSync('artifacts/'+name+'.json')).abi,provider);
 }
 const {token,binary,timelock,council,usd}=contracts;
 const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
 if(!same(await token.governance(),cfg.timelock)||!same(await binary.governance(),cfg.timelock)||!same(await token.guardianCouncil(),cfg.council)||!same(await binary.guardian(),cfg.council)||!same(await token.binary(),cfg.binary)||!same(await token.usd(),cfg.usd)||!same(await binary.usd(),cfg.usd)||!same(await binary.token(),cfg.token))throw Error('Contract roles/binding mismatch');
 if(await timelock.getMinDelay()!==259200n||await council.THRESHOLD()!==5n||await usd.decimals()!==18n)throw Error('Governance or collateral configuration mismatch');
 if(!await timelock.hasRole(await timelock.PROPOSER_ROLE(),cfg.council))throw Error('Council is not timelock proposer');
 for(let i=0;i<7;i++)if(!same(await council.guardians(i),cfg.daoPartners[i]))throw Error('Guardian mismatch');
 if(!same(await token.development(),cfg.development)||!same(await binary.development(),cfg.development)||await token.INITIAL_PRICE()!==100000000000000000n||await token.RESTART_PRICE()!==200000000000000000n||await token.SMALL_SELL_EXEMPTION()!==500000000000000000000n||!await binary.pointValueIsTarget())throw Error('Owner economic configuration mismatch');
 if(await token.TRADE_FEE_BPS()!==300n||await token.RESERVE_FEE_BPS()!==300n||await token.TRANSFER_FEE_BPS()!==300n||cfg.transferFeeBps!==300||cfg.transferFeeMode!=='burn')throw Error('Fee configuration mismatch');
 return contracts;
}
