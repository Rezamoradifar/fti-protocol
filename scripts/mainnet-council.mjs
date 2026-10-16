// Explicit user-approved production council. No signing or economic changes.
import fs from 'node:fs';
import {getAddress} from 'ethers';
export function selectedMainnetCouncil(){
 const council=JSON.parse(fs.readFileSync('config/mainnet-council.json','utf8'));
 if(council.chainId!==56||council.threshold!==5||!Array.isArray(council.partners)||council.partners.length!==7)throw Error('Invalid approved council configuration');
 const members=council.partners.map(getAddress);
 if(new Set(members).size!==7||members.includes('0x'+'0'.repeat(40)))throw Error('Invalid approved council members');
 return {...council,partners:members};
}
export function assertSelectedMainnetCouncil(input){
 const council=selectedMainnetCouncil();
 if(input.daoThreshold!==council.threshold)throw Error('Approved council threshold must remain 5');
 if(!Array.isArray(input.partners)||input.partners.length!==7||input.partners.some((a,i)=>typeof a!=='string'||a.toLowerCase()!==council.partners[i].toLowerCase()))throw Error('Approved council members/order differ');
 return input;
}
