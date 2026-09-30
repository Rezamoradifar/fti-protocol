export const RANKS=[
 {name:'Member',short:'M',threshold:0,buyLimit:500,pool:null},
 {name:'Builder I',short:'I',threshold:100,buyLimit:600,pool:1.6},
 {name:'Builder II',short:'II',threshold:200,buyLimit:700,pool:1.2},
 {name:'Builder III',short:'III',threshold:500,buyLimit:800,pool:.8},
 {name:'Builder IV',short:'IV',threshold:1000,buyLimit:1000,pool:.4}
];
export const CAPS=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];
export const CONTRACTS=[
 {name:'FTI Token',role:'Curve pricing, reserve accounting and token movement.',address:'0x127bEEe5c89fDf42Bb056BBD5D4491982880eE91',source:'contracts/FTIToken.sol'},
 {name:'Binary Plan',role:'Membership placement, points and funded reward allocation.',address:'0x8838a88b34219119D14092DEC9A9070809F3456e',source:'contracts/BinaryPlan.sol'},
 {name:'MockUSD',role:'Test collateral only. Unrestricted test minting; no real USD backing.',address:'0x5a8A97a6c2AFEf0FA315f28cF58653AEAD75d6ae',source:'contracts/MockUSD.sol'},
 {name:'Council',role:'Five configured owners; three approvals are required to execute a proposal.',address:'0xD26f0Cb7ed939f91DD1fa07eBfc9bd1e803A58BB',source:'contracts/Governance.sol'},
 {name:'Timelock',role:'Governance execution delay, initially configured to 72 hours.',address:'0x7e28976e53AF9A66824F08169ac0a17AB3C00685',source:'contracts/Governance.sol'}
];
export const DOC_BASE='https://github.com/Rezamoradifar/fti-protocol';
