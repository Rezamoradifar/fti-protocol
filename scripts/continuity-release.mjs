import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Contract,ContractFactory,keccak256,id} from 'ethers';
import {MAINNET_RELEASE,COLLATERAL_ABI,deploymentNetwork} from '../core/deployment-network.mjs';
export const RELEASE='FTI_CONTINUITY_TESTNET_20261009';
const models={usd:'MockUSD',council:'SevenGuardianCouncil',timelock:'FTITimelock',token:'FTIReserveTokenUpgradeable',binary:'FundedBinaryPlanUpgradeable'};
const hash=x=>createHash('sha256').update(x).digest('hex');
export function contractDigest(){
 return hash(JSON.stringify(fs.readdirSync('contracts').filter(x=>x.endsWith('.sol')).sort().map(x=>[x,hash(fs.readFileSync('contracts/'+x))])));
}
export function releaseManifest(){
 const digest=contractDigest(),artifacts={};
 for(const name of [...Object.values(models),'FTIProxy']){
  const file='artifacts/'+name+'.json',data=JSON.parse(fs.readFileSync(file));
  if(data.sourceDigest!==digest)throw Error('Stale ABI/artifact: '+name+'. Run npm run compile.');
  artifacts[name]=hash(fs.readFileSync(file));
 }
 const sources={};
 for(const dir of ['contracts','frontend','scripts','core','landing/src'])for(const name of fs.readdirSync(dir).sort()){
  const file=dir+'/'+name;if(fs.statSync(file).isFile()&&/\.(sol|mjs|jsx|js|css)$/.test(name))sources[file]=hash(fs.readFileSync(file));
 }
 for(const file of ['config/mainnet-council.json','config/mainnet-usdt-collateral.json','config/v3-wallets.json','config/mainnet-approved-input.REQUIRED.json','package.json','package-lock.json','web/app.js','web/vendor/walletconnect.js','core/hourly-cap-policy.mjs'])sources[file]=hash(fs.readFileSync(file));
 const sourceFingerprint=hash(JSON.stringify(sources));
 let sourceRevision=process.env.FTI_SOURCE_REVISION||process.env.GITHUB_SHA||null;
 if(!sourceRevision)try{sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 if(sourceRevision&&!/^[a-f0-9]{40}$/.test(sourceRevision))throw Error('Source revision must be a full commit SHA');
 return {sourceRevision,sourceFingerprint,artifactHashes:artifacts};
}
export async function verifyV3Deployment(cfg,provider){
 const mainnet=cfg.release===MAINNET_RELEASE;
 if(mainnet)deploymentNetwork(cfg);
 const manifest=releaseManifest();
 if(![RELEASE,MAINNET_RELEASE].includes(cfg.release)||cfg.sourceFingerprint!==manifest.sourceFingerprint||JSON.stringify(cfg.artifactHashes)!==JSON.stringify(manifest.artifactHashes))throw Error('Deployment/build release mismatch');
 if(cfg.sourceRevision&&manifest.sourceRevision&&cfg.sourceRevision!==manifest.sourceRevision)throw Error('Source revision mismatch');
 if((await provider.getNetwork()).chainId!==BigInt(cfg.chainId))throw Error('Wrong deployment network');
 const contracts={};
 for(const [key,name] of Object.entries(models)){
  const code=await provider.getCode(cfg[key]);
  if(code==='0x'||keccak256(code)!==cfg.codeHashes?.[key])throw Error('Deployed code mismatch: '+key);
  contracts[key]=new Contract(cfg[key],mainnet&&key==='usd'?COLLATERAL_ABI:JSON.parse(fs.readFileSync('artifacts/'+name+'.json')).abi,provider);
 }
 if(!(mainnet?cfg.chainId===56:[97,31337].includes(cfg.chainId))||cfg.tokenContract!==models.token||cfg.binaryContract!==models.binary)throw Error('Continuity network/model mismatch');
 if(mainnet){
  if(!/^[a-f0-9]{40}$/.test(cfg.sourceRevision||'')||cfg.collateral?.address?.toLowerCase()!==cfg.usd.toLowerCase()||cfg.collateral?.codeHash!==cfg.codeHashes.usd||cfg.collateral?.decimals!==18)throw Error('Reviewed mainnet collateral configuration required');
 }
 const slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
 for(const key of ['token','binary']){
  const implementation=cfg[key+'Implementation'];
  const stored=await provider.getStorage(cfg[key],slot);
  if(!implementation||stored.slice(-40).toLowerCase()!==implementation.slice(2).toLowerCase()||keccak256(await provider.getCode(implementation))!==cfg.implementationCodeHashes?.[key])throw Error('Implementation mismatch: '+key);
  const component=new Contract(implementation,['function COMPONENT_ID() view returns(bytes32)','function proxiableUUID() view returns(bytes32)'],provider);
  if(await component.COMPONENT_ID()!==id(key==='token'?'FTI_TOKEN_CONTINUITY_V1':'FTI_BINARY_CONTINUITY_V1')||await component.proxiableUUID()!==slot)throw Error('UUPS component mismatch');
 }
 // Verify all creation inputs against this build, including atomic proxy initializers.
 for(const key of ['usd','council','timelock','tokenImplementation','binaryImplementation','token','binary']){
  if(mainnet&&key==='usd')continue; // Existing, explicitly selected collateral; never deploy MockUSD on 56.
  const name=key==='token'||key==='binary'?'FTIProxy':key==='tokenImplementation'?models.token:key==='binaryImplementation'?models.binary:models[key];
  const data=JSON.parse(fs.readFileSync('artifacts/'+name+'.json'));
  const expected=(await new ContractFactory(data.abi,data.bytecode).getDeployTransaction(...cfg.constructorArgs[key])).data;
  const tx=await provider.getTransaction(cfg.transactions[key]);const receipt=await provider.getTransactionReceipt(cfg.transactions[key]);
  if(!tx||tx.to!==null||tx.data.toLowerCase()!==expected.toLowerCase()||tx.from.toLowerCase()!==cfg.deployer.toLowerCase()||receipt?.status!==1||receipt.contractAddress?.toLowerCase()!==cfg[key].toLowerCase())throw Error('Creation input mismatch: '+key);
  if(mainnet&&(tx.chainId!==56n||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash))throw Error('Mainnet creation chain/block mismatch: '+key);
 }
 const {token,binary,timelock,council,usd}=contracts;
 const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
 if(!same(await token.governance(),cfg.timelock)||!same(await binary.governance(),cfg.timelock)||!same(await token.guardianCouncil(),cfg.council)||!same(await binary.guardian(),cfg.council)||!same(await token.binary(),cfg.binary)||!same(await token.usd(),cfg.usd)||!same(await binary.usd(),cfg.usd)||!same(await binary.token(),cfg.token))throw Error('Contract roles/binding mismatch');
 if(await timelock.getMinDelay()!==259200n||await council.THRESHOLD()!==5n||await usd.decimals()!==18n)throw Error('Governance or collateral configuration mismatch');
 if(!await timelock.hasRole(await timelock.PROPOSER_ROLE(),cfg.council))throw Error('Council is not timelock proposer');
 for(let i=0;i<7;i++)if(!same(await council.guardians(i),cfg.daoPartners[i]))throw Error('Guardian mismatch');
 if(!same(await token.development(),cfg.development)||!same(await binary.development(),cfg.development)||await token.INITIAL_PRICE()!==100000000000000000n||await token.RESTART_PRICE()!==200000000000000000n||await token.SMALL_SELL_EXEMPTION()!==500000000000000000000n||!await binary.pointValueIsTarget())throw Error('Owner economic configuration mismatch');
 if(await token.TRADE_FEE_BPS()!==300n||await token.RESERVE_FEE_BPS()!==300n||await token.TRANSFER_FEE_BPS()!==300n||cfg.transferFeeBps!==300||cfg.transferFeeMode!=='burn')throw Error('Fee configuration mismatch');
 if(await binary.TARGET_POINT_VALUE()!==20n*10n**18n||await binary.PROTECTION_TRIGGER()!==16n*10n**18n||await token.BUY_STEP()!==500n*10n**18n)throw Error('Continuity economic configuration mismatch');
 if(mainnet){
  if(await binary.hourlyCapFlushVersion()!==1n)throw Error('Mainnet cap-flush implementation required');
  if(await binary.poolDistributionVersion()!==1n)throw Error('Mainnet hourly pool distribution must be active');
  const [b,t,c]=await Promise.all([binary.accounting(),token.accounting(),binary.fundingAccounting()]);
  if(b[0]<b[1]||t[0]<t[1]||c[0]!==c[1]||c[2]!==c[3])throw Error('Mainnet accounting mismatch');
 }
 return contracts;
}
