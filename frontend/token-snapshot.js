// Minimal public reads for V3 token trading. Every contract value is read at
// one canonical block; unavailable data never becomes a usable zero balance.
const addressPattern=/^0x[0-9a-f]{40}$/i,hashPattern=/^0x[0-9a-f]{64}$/i;
const MAX_UINT256=(1n<<256n)-1n;
function uint(value,name){
 if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)))throw Error('Invalid token '+name+'.');
 const result=BigInt(value);if(result<0n||result>MAX_UINT256)throw Error('Invalid token '+name+'.');return result;
}
function safe(value,name){const result=Number(uint(value,name));if(!Number.isSafeInteger(result))throw Error('Invalid token '+name+'.');return result;}
function bool(value,name){if(typeof value!=='boolean')throw Error('Invalid token '+name+'.');return value;}
function checkedAddress(value,name){if(typeof value!=='string'||!addressPattern.test(value))throw Error('Invalid token '+name+'.');return value;}
function checkedBlock(value){
 if(!value||!Number.isSafeInteger(value.number)||value.number<0||!Number.isSafeInteger(value.timestamp)||value.timestamp<=0||typeof value.hash!=='string'||!hashPattern.test(value.hash))throw Error('Token block could not be verified.');
 return {number:value.number,timestamp:value.timestamp,hash:value.hash.toLowerCase()};
}

// This snapshot is only for FTIReserveTokenV3/FTIReserveTokenUpgradeable, where
// the full token balance is unlocked. Legacy token locks need their own getter.
export async function readTokenSnapshot({rpc,binary,usd,token,address,chainId,recoveryFrozen=true,tokenAddress=token?.target}){
 checkedAddress(address,'wallet');checkedAddress(tokenAddress,'contract address');
 if(!Number.isSafeInteger(chainId)||chainId<=0||typeof recoveryFrozen!=='boolean')throw Error('Invalid token network configuration.');
 if(uint((await rpc.getNetwork()).chainId,'network')!==BigInt(chainId))throw Error('Token RPC network does not match this deployment.');
 const observed=checkedBlock(await rpc.getBlock('latest')),options={blockTag:observed.number};
 const [pausedValue,frozenValue,emergencyValue,member,usdBalance,ftiBalance,remaining,allowance]=await Promise.all([
  token.paused(options),recoveryFrozen?token.recoveryFrozen(options):Promise.resolve(false),token.emergencyUnwind(options),
  binary.members(address,options),usd.balanceOf(address,options),token.balanceOf(address,options),
  token.remainingAllowance(address,options),usd.allowance(address,tokenAddress,options),
 ]);
 const paused=bool(pausedValue,'pause flag'),frozen=bool(frozenValue,'recovery flag'),emergency=bool(emergencyValue,'emergency flag');
 if(!member||typeof member!=='object')throw Error('Token membership record is unavailable.');
 const wallet={address};
 for(const name of ['parent','left','right'])wallet[name]=checkedAddress(member[name],name);
 for(const name of ['units','carryL','carryR','lifetimeL','lifetimeR','maxAutoPrice'])wallet[name]=uint(member[name],name);
 wallet.rank=safe(member.rank,'rank');if(wallet.rank>4)throw Error('Invalid token rank.');
 wallet.exists=bool(member.exists,'membership existence');wallet.autoEnabled=bool(member.autoEnabled,'auto-buy flag');
 wallet.usdBalance=uint(usdBalance,'collateral balance');wallet.ftiBalance=uint(ftiBalance,'balance');
 wallet.unlocked=wallet.ftiBalance;wallet.remaining=uint(remaining,'remaining allowance');
 wallet.collateralAllowance=uint(allowance,'collateral allowance');
 const canonical=checkedBlock(await rpc.getBlock(observed.number));
 if(canonical.number!==observed.number||canonical.hash!==observed.hash||canonical.timestamp!==observed.timestamp)throw Error('Token block changed. Prepare the request again.');
 if(uint((await rpc.getNetwork()).chainId,'network')!==BigInt(chainId))throw Error('Token RPC network does not match this deployment.');
 return {block:observed.number,timestamp:observed.timestamp,tokenStateVerified:true,tokenPaused:paused||frozen,tokenRecoveryFrozen:frozen,emergencyUnwind:emergency,wallet};
}
