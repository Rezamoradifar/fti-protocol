export const RANKS=[
 {name:'Member',short:'M',threshold:0,buyLimit:500,pool:null},
 {name:'Builder I',short:'I',threshold:100,buyLimit:600,pool:1.6},
 {name:'Builder II',short:'II',threshold:200,buyLimit:700,pool:1.2},
 {name:'Builder III',short:'III',threshold:500,buyLimit:800,pool:.8},
 {name:'Builder IV',short:'IV',threshold:1000,buyLimit:1000,pool:.4}
];
export const CAPS=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];
export const LEGACY_CONTRACTS=[
 {name:'FTI Token',role:'Curve pricing, reserve accounting and token movement.',address:'0x127bEEe5c89fDf42Bb056BBD5D4491982880eE91',source:'contracts/FTIToken.sol'},
 {name:'Binary Plan',role:'Membership placement, points and funded reward allocation.',address:'0x8838a88b34219119D14092DEC9A9070809F3456e',source:'contracts/BinaryPlan.sol'},
 {name:'MockUSD',role:'Test collateral only. Unrestricted test minting; no real USD backing.',address:'0x5a8A97a6c2AFEf0FA315f28cF58653AEAD75d6ae',source:'contracts/MockUSD.sol'},
 {name:'Council',role:'Five configured owners; three approvals are required to execute a proposal.',address:'0xD26f0Cb7ed939f91DD1fa07eBfc9bd1e803A58BB',source:'contracts/Governance.sol'},
 {name:'Timelock',role:'Governance execution delay, initially configured to 72 hours.',address:'0x7e28976e53AF9A66824F08169ac0a17AB3C00685',source:'contracts/Governance.sol'}
];
export const DOC_BASE='https://github.com/Rezamoradifar/fti-protocol';
export const REVISION='fix/v3-owner-decisions-20261008';
export const SOURCE_BASE=DOC_BASE+'/blob/'+REVISION+'/';
export const TARGET_POINT_VALUE=20;
export const V3_CONTRACTS=[
 {name:'MockUSD',role:'Test collateral; no real dollar value.',source:'contracts/MockUSD.sol',tx:'0xbdda07eed7266580a7e91bed62c9e635e03e1741f9d0e5d9c2a23146b6301b88'},
 {name:'SevenGuardianCouncil',role:'Seven fixed emergency guardians; five approvals required.',source:'contracts/SevenGuardianCouncil.sol',tx:'0xaeb02b0e8b45d7aa2a672d721cb2f562512391457a26f0ca1fbf008383b1507e'},
 {name:'FTIReserveTokenV3',role:'Zero-start reserve token, purchase allowances and emergency redemption.',source:'contracts/FTIReserveTokenV3.sol',tx:'0xb162dc1e0b2b19ba4c12a85461e57ce4adbc37dabd5eb39ddfc3444f16e2b8fd'},
 {name:'FundedBinaryPlan',role:'Repeat unit purchases, attributed reward credit and hourly settlement.',source:'contracts/FundedBinaryPlan.sol',tx:'0x2499a3199979b7876aab93ee4ada626832937d8d78ed950e937415e35b391771'},
 {name:'Token–binary binding',role:'One-time connection; this is a transaction, not another contract.',source:'scripts/deploy-v3-testnet.mjs',tx:'0x70a8b3f710f1bf7e55db1579c430994da8d8a7828e62dbccad223fdad0105343'}
];
export function builderMultiplier(ratio){let multiplier=1,threshold=10;while(ratio>=threshold&&multiplier<16){multiplier*=2;threshold*=10;}return multiplier;}
export function purchaseAllowance(rank,units,ratio,spent){const multiplier=rank===0?1:builderMultiplier(ratio);const limit=RANKS[rank].buyLimit*units*multiplier;return {multiplier,limit,remaining:Math.max(0,limit-spent)};}
export function rewardExample(left,right,rank,level,matchedCredit){const raw=Math.min(left,right),paid=Math.min(raw,CAPS[level][rank]);const budget=raw?matchedCredit*paid/raw:0;return {raw,paid,flushed:raw-paid,carry:Math.abs(left-right),budget,reward:budget};}
