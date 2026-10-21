import {walletError} from './membership-availability.js';
import {t,language} from './locale.js';
import {collateralBalanceMessage} from './collateral-balance.js';
const stages={
 CONNECT:['Wallet connection or account loading failed.','اتصال ولت یا دریافت اطلاعات حساب ناموفق بود.'],
 NETWORK:['Wallet network check failed.','بررسی شبکه از داخل ولت ناموفق بود.'],
 PREVIOUS:['Previous transaction check failed.','بررسی تراکنش قبلی ناموفق بود.'],
 BALANCE:['Wallet balance refresh failed.','دریافت موجودی ولت از سایت ناموفق بود.'],
 VALIDATION:['Request requirements were not met.','شرایط درخواست کامل نیست.'],
 ALLOWANCE:['USDT allowance check failed.','خواندن مجوز تتر از شبکه ناموفق بود.'],
 GAS:['Transaction preparation failed.','آماده‌سازی تراکنش و برآورد گس ناموفق بود.'],
 NONCE:['Transaction number check failed.','دریافت شماره تراکنش از شبکه ناموفق بود.'],
 SIGN:['Wallet request failed. Check wallet activity.','درخواست ولت ناموفق بود؛ تاریخچه ولت را بررسی کنید.']
};
export function purchaseError(stage,error){
 if(error?.code==='FTI_INSUFFICIENT_COLLATERAL')return `[FTI-COLLATERAL] ${collateralBalanceMessage(error,language)}`;
 const code=Object.hasOwn(stages,stage)?stage:'UNKNOWN';
 const label=stages[code]||['Request failed.','درخواست ناموفق بود.'];
 return `[FTI-${code}] ${t(...label)} ${walletError(error)}`;
}
