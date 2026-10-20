// Minimal public membership reads for approval and purchase preparation. No
// dashboard endpoint or wallet RPC is used, and all values share one block.
const addressPattern=/^0x[0-9a-f]{40}$/i,hashPattern=/^0x[0-9a-f]{64}$/i;
const MAX_UINT256=(1n<<256n)-1n;
function uint(value,name){
 if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)))throw Error('Invalid membership '+name+'.');
 const result=BigInt(value);if(result<0n||result>MAX_UINT256)throw Error('Invalid membership '+name+'.');return result;
}
function safe(value,name){const result=Number(uint(value,name));if(!Number.isSafeInteger(result))throw Error('Invalid membership '+name+'.');return result;}
function bool(value,name){if(typeof value!=='boolean')throw Error('Invalid membership '+name+'.');return value;}
function checkedAddress(value,name){if(typeof value!=='string'||!addressPattern.test(value))throw Error('Invalid membership '+name+'.');return value;}
function checkedBlock(value){
 if(!value||!Number.isSafeInteger(value.number)||value.number<0||!Number.isSafeInteger(value.timestamp)||value.timestamp<=0||typeof value.hash!=='string'||!hashPattern.test(value.hash))throw Error('Membership block could not be verified.');
 return {number:value.number,timestamp:value.timestamp,hash:value.hash.toLowerCase()};
}

export async function readMembershipSnapshot({rpc,binary,usd,address,chainId,recoveryFrozen=true}){
 checkedAddress(address,'wallet');
 if(!Number.isSafeInteger(chainId)||chainId<=0||typeof recoveryFrozen!=='boolean')throw Error('Invalid membership network configuration.');
 if(uint((await rpc.getNetwork()).chainId,'network')!==BigInt(chainId))throw Error('Membership RPC network does not match this deployment.');
 const observed=checkedBlock(await rpc.getBlock('latest')),options={blockTag:observed.number};
 const [paused,frozen,phaseValue,monthPhaseValue,endValue,member,balance]=await Promise.all([
  binary.paused(options),recoveryFrozen?binary.recoveryFrozen(options):Promise.resolve(false),
  binary.phase(options),binary.monthPhase(options),binary.epochEnd(options),
  binary.members(address,options),usd.balanceOf(address,options),
 ]);
 const phase=safe(phaseValue,'phase'),monthPhase=safe(monthPhaseValue,'monthly phase'),epochEnd=safe(endValue,'epoch end');
 if(phase>2||monthPhase>2||epochEnd<=0)throw Error('Invalid membership settlement state.');
 if(!member||typeof member!=='object')throw Error('Membership record is unavailable.');
 const wallet={address};
 for(const name of ['parent','left','right'])wallet[name]=checkedAddress(member[name],name);
 for(const name of ['units','carryL','carryR','lifetimeL','lifetimeR','maxAutoPrice'])wallet[name]=uint(member[name],name);
 wallet.rank=safe(member.rank,'rank');if(wallet.rank>4)throw Error('Invalid membership rank.');
 wallet.exists=bool(member.exists,'existence');wallet.autoEnabled=bool(member.autoEnabled,'auto-buy flag');wallet.usdBalance=uint(balance,'collateral balance');
 const canonical=checkedBlock(await rpc.getBlock(observed.number));
 if(canonical.number!==observed.number||canonical.hash!==observed.hash||canonical.timestamp!==observed.timestamp)throw Error('Membership block changed. Prepare the request again.');
 if(uint((await rpc.getNetwork()).chainId,'network')!==BigInt(chainId))throw Error('Membership RPC network does not match this deployment.');
 return {block:observed.number,timestamp:observed.timestamp,paused:bool(paused,'pause flag'),binaryRecoveryFrozen:bool(frozen,'recovery flag'),phase,monthPhase,epochEnd,wallet};
}
