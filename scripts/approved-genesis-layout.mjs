// Expected initial tree, decoded from the user-approved numbered drawing.
import fs from 'node:fs';
import {ZeroAddress} from 'ethers';
export function approvedGenesisLayout(){
 const layout=JSON.parse(fs.readFileSync('config/mainnet-genesis-layout.json','utf8'));
 if(layout.schema!=='FTI_GENESIS_LAYOUT_V1'||layout.id!=='FTI_GENESIS_1_2_4_8_8_8_20261016'||layout.positions.length!==31)throw Error('Invalid approved genesis layout');
 const children=Array.from({length:31},()=>({left:null,right:null})),depths=[];
 for(const [i,p] of layout.positions.entries()){
  if(p.position!==i+1)throw Error('Invalid genesis position order');
  if(i===0){if(p.parent!==null||p.side!==null)throw Error('Invalid genesis root');depths.push(0);continue;}
  if(!Number.isInteger(p.parent)||p.parent<1||p.parent>=p.position||!['left','right'].includes(p.side)||children[p.parent-1][p.side]!==null)throw Error('Invalid genesis parent/side');
  children[p.parent-1][p.side]=p.position;depths.push(depths[p.parent-1]+1);
 }
 const levels=Array.from({length:Math.max(...depths)+1},(_,d)=>depths.filter(x=>x===d).length);
 if(JSON.stringify(levels)!==JSON.stringify(layout.levels))throw Error('Invalid genesis level counts');
 return {...layout,children,depths};
}
export async function assertFreshGenesisLayout(binary,genesis,blockTag){
 if(!Array.isArray(genesis)||genesis.length!==31)throw Error('Exactly 31 genesis wallets required');
 const layout=approvedGenesisLayout(),at=blockTag===undefined?{}:{blockTag};
 const address=n=>n===null?ZeroAddress:genesis[n-1];
 const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
 for(const [i,p] of layout.positions.entries()){
  const m=await binary.members(genesis[i],at),kids=layout.children[i];
  if(!m.exists||!same(m.parent,address(p.parent))||!same(m.left,address(kids.left))||!same(m.right,address(kids.right))||await binary.depth(genesis[i],at)!==BigInt(layout.depths[i]))throw Error('Fresh genesis genealogy mismatch at position '+p.position);
 }
 return layout.id;
}
