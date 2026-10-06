export const RANKS=[
  {name:'Member',short:'M',threshold:0,buyLimit:500,pool:null},
  {name:'Builder I',short:'I',threshold:100,buyLimit:600,pool:1.6},
  {name:'Builder II',short:'II',threshold:200,buyLimit:700,pool:1.2},
  {name:'Builder III',short:'III',threshold:500,buyLimit:800,pool:.8},
  {name:'Builder IV',short:'IV',threshold:1000,buyLimit:1000,pool:.4}
];

export const CAPS=[
  [5,10,15,20,25],
  [5,10,12,16,20],
  [5,10,10,12,15],
  [5,10,10,10,10]
];

export const DAO_PARTNERS=[
  '0x66Bccec30D27d780A23b2cBe467f20D4a1FC56F8',
  '0xe7efd5bfBa19cC1c6D50b5ddfBC972Fa5524851f',
  '0xF2637A6Ab93b13DEF1F46E49A1F39d1B9Ec1fC16',
  '0x1c8E8FFF893aFa573e0F616DDA333B1f0c7A8740',
  '0x3d6282594649f2E023209346779977293cFD481a',
  '0x202cA4f915E6dA048fb44d20c5FE852eb00FE3fe',
  '0x25D88f0B8ac6e1495112F3EB17DBC57271A92fa7'
];

export const CONTRACTS=[
  {name:'FTIReserveTokenV3',role:'Zero-start reserve/share token, 3% buy/sell fee, charity minting, anti-whale limits and emergency pro-rata redemption.',address:null,source:'contracts/FTIReserveTokenV3.sol'},
  {name:'FundedBinaryPlan',role:'Binary placement, source-attributed reward funding, rank progression, builder pools and optional auto-buy.',address:null,source:'contracts/FundedBinaryPlan.sol'},
  {name:'SevenGuardianCouncil',role:'Seven fixed Partner DAO wallets. Five approvals are required to execute a proposal; the council does not custody reserve funds.',address:null,source:'contracts/SevenGuardianCouncil.sol'},
  {name:'MockUSD',role:'Test collateral only. It has no real USD backing or monetary value.',address:null,source:'contracts/MockUSD.sol'}
];

export const DOC_BASE='https://github.com/Rezamoradifar/fti-protocol';
export const V3_BRANCH='feat/zero-start-charity-protection';
