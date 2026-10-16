// Public role/placement policy. No RPC, signing, random wallets or economic changes.
import {loadWallets} from './v3-wallets.mjs';
export const APPROVED_MAINNET_PROFILE='FTI_APPROVED_FRESH_MAINNET_20261016';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export function assertApprovedMainnetProfile(input){
 const approved=loadWallets('config/v3-wallets.json');
 if(input.walletProfile!==APPROVED_MAINNET_PROFILE)throw Error('Approved fresh mainnet wallet profile required');
 if(!same(input.owner,approved.owner)||!same(input.development,approved.development))throw Error('Approved owner/development roles differ');
 if(!Array.isArray(input.genesis)||input.genesis.length!==31||input.genesis.some((a,i)=>!same(a,approved.genesis[i])))throw Error('Approved genesis order differs');
 if(input.deploymentKind!=='new-contracts'||input.chainId!==56)throw Error('Fresh chain-56 deployment required; no testnet migration');
 return input;
}
