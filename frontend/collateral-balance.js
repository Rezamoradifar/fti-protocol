// Read the selected ERC-20 directly before approval/purchase. Dashboard state
// is a separate snapshot and must not decide whether a new deposit is funded.
export async function requireCollateralBalance({rpc,token,wallet,chainId,required}){
 if(typeof required!=='bigint'||required<=0n)throw Error('Invalid collateral amount.');
 if(Number(await rpc.send('eth_chainId',[]))!==chainId)throw Error('Balance RPC network does not match this deployment.');
 // The existing contracts accept only 18-decimal collateral; never rescale a
 // different token into this protocol or change its 100 USD unit price.
 if(BigInt(await token.decimals())!==18n)throw Error('Collateral decimals do not match this deployment.');
 const balance=BigInt(await token.balanceOf(wallet));
 if(balance<0n)throw Error('Invalid collateral balance.');
 if(balance<required){
  const error=new Error('Insufficient collateral balance.');
  Object.assign(error,{code:'FTI_INSUFFICIENT_COLLATERAL',required,balance,
   shortfall:required-balance,chainId,wallet,tokenAddress:token.target});
  throw error;
 }
 return balance;
}

export function collateralAmount(value){
 const unit=10n**18n,n=BigInt(value);
 const fraction=(n%unit).toString().padStart(18,'0').replace(/0+$/,'');
 return (n/unit).toString()+(fraction?'.'+fraction:'');
}

const labels={
 en:['Insufficient payment token balance','Required','Balance','Shortfall','Wallet','Token'],
 fa:['موجودی توکن پرداخت کافی نیست','مبلغ لازم','موجودی','کسری','ولت','توکن'],
 ar:['رصيد رمز الدفع غير كافٍ','المطلوب','الرصيد','النقص','المحفظة','الرمز'],
 tr:['Ödeme tokeni bakiyesi yetersiz','Gerekli','Bakiye','Eksik','Cüzdan','Token'],
 'zh-CN':['支付代币余额不足','所需','余额','差额','钱包','代币'],
 ru:['Недостаточно платёжных токенов','Требуется','Баланс','Не хватает','Кошелёк','Токен'],
 es:['Saldo insuficiente del token de pago','Necesario','Saldo','Faltante','Billetera','Token'],
};
export function collateralBalanceMessage(error,lang='en'){
 const l=labels[lang]||labels.en;
 const mainnet=error.chainId===56&&String(error.tokenAddress).toLowerCase()==='0x55d398326f99059ff775485246999027b3197955';
 const asset=mainnet?'USDT':'USD';
 const network=error.chainId===56?'BNB Smart Chain (56)':`Chain ${error.chainId}`;
 return `${l[0]} · ${network}. ${l[1]}: ${collateralAmount(error.required)} ${asset}; ${l[2]}: ${collateralAmount(error.balance)} ${asset}; ${l[3]}: ${collateralAmount(error.shortfall)} ${asset}. ${l[4]}: ${error.wallet}. ${l[5]}: ${error.tokenAddress}.`;
}
