import fs from 'node:fs';
export function selectedMainnetCollateral(){return JSON.parse(fs.readFileSync('config/mainnet-usdt-collateral.json','utf8'))}
export function assertSelectedMainnetCollateral(input){
 const collateral=selectedMainnetCollateral();
 if(collateral.chainId!==56||collateral.decimals!==18||String(input.usd).toLowerCase()!==collateral.address.toLowerCase()||String(input.usdCodeHash).toLowerCase()!==collateral.usdCodeHash.toLowerCase())throw Error('Mainnet collateral must match the selected BNB USDT address and observed runtime hash');
 return input;
}
