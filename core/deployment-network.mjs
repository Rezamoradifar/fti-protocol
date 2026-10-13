export const MAINNET_RELEASE='FTI_CONTINUITY_MAINNET_20261013';
export const COLLATERAL_ABI=[
 'function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)',
 'function transfer(address,uint256) returns(bool)','function transferFrom(address,address,uint256) returns(bool)'
];
export function deploymentNetwork(cfg){
 if(cfg.chainId===56){
  if(cfg.mode!=='bnb-mainnet'||cfg.release!==MAINNET_RELEASE||cfg.tokenContract!=='FTIReserveTokenUpgradeable'||cfg.binaryContract!=='FundedBinaryPlanUpgradeable')throw Error('Explicit verified mainnet release required');
  return {chainId:56,hex:'0x38',name:'BNB Smart Chain',label:'BNB Mainnet · 56',explorer:'https://bscscan.com',testAssets:false,currency:'USD'};
 }
 if(cfg.chainId===97&&['testnet','bnb-testnet'].includes(cfg.mode))return {chainId:97,hex:'0x61',name:'BNB Smart Chain Testnet',label:'BNB Testnet · 97',explorer:'https://testnet.bscscan.com',testAssets:true,currency:'tUSD'};
 if(cfg.chainId===31337&&cfg.mode==='local')return {chainId:31337,hex:'0x7a69',name:'Local chain',label:'Local chain · 31337',explorer:null,testAssets:true,currency:'tUSD'};
 throw Error('Unsupported deployment network or mode');
}
export function walletConnectOptions(projectId,chainId,origin){
 if(!/^[a-f0-9]{32}$/i.test(projectId||'')||![56,97].includes(chainId))throw Error('WalletConnect requires an explicit BNB network and valid project ID');
 const url=new URL(origin);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('HTTPS wallet origin required');
 return {projectId,chains:[chainId],showQrModal:true,rpcMap:{[chainId]:url.origin+'/rpc'},
  optionalMethods:['eth_requestAccounts','wallet_switchEthereumChain','wallet_addEthereumChain'],
  metadata:{name:'FTI Protocol',description:'FTI membership and token workspace',url:url.origin,icons:[url.origin+'/app/favicon.svg']}};
}
