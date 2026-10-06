// Advisory UI only. The contract's earned-hour snapshot and atomic quote are authoritative.
export const IMMEDIATE_AUTO_POLICY='immediate-current-quote-v1';
export function autoBuyPresentation(data,wallet){
 const enabled=!!wallet?.autoEnabled,next=wallet?.nextAutoSetting;
 const scheduled=!enabled&&!!next?.enabled&&BigInt(next.effectiveAt||0)>BigInt(data?.timestamp||0);
 return {enabled,scheduled,requested:enabled||scheduled,
  label:!wallet?.exists?'Not connected':scheduled?'Scheduled for next UTC boundary':enabled?'Enabled · fixed 5%':'Disabled · default off',
  effectiveAt:scheduled?next.effectiveAt:null};
}
export function autoPreferenceReadiness({data,wallet,enabled,lifecycle={}}){
 if(!data)return {ready:false,reason:'Waiting for contract data'};
 if(data.autoBuyPolicy!==IMMEDIATE_AUTO_POLICY)return {ready:false,reason:'This historical contract uses a different auto-buy policy. Preference editing is unavailable in this review interface.'};
 if(!wallet?.exists)return {ready:false,reason:'Connect a registered member wallet to save this preference.'};
 if(!enabled)return {ready:true,reason:'Disabling stops purchases and retries immediately. Existing earned-hour allocations and beneficiary cash ownership are preserved.'};
 if(lifecycle.buyingBlocked)return {ready:false,reason:'New token purchases are unavailable. You can still disable auto-buy and release your pending funds to claimable cash.'};
 return {ready:true,reason:'Enabling starts at the next UTC hourly allocation boundary: a request at 12:30 starts at 13:00. A request exactly at 13:00 starts at 14:00. Older overdue allocations do not inherit a later request.'};
}
export function validateAutoPreference(options){
 const result=autoPreferenceReadiness(options);if(!result.ready)throw Error(result.reason);
}
export function autoBuyPolicy(data,lifecycle={}){
 if(data?.autoBuyPolicy!==IMMEDIATE_AUTO_POLICY)return 'This historical contract uses a different auto-buy policy. Check its configured contract before changing preferences or executing pending funds.';
 const availability=lifecycle.buyingBlocked?'New token purchases are currently unavailable. ':'';
 return availability+'Auto-buy is off by default. When enabled, a fixed 5% of eligible builder hourly rewards is attempted immediately during allocation at the current full-precision quote, including fees, without a user price cap. Only that new allocation is included in the immediate attempt. Failed attempts stay pending for the same beneficiary. Bounded keeper retries can continue while the request is active and buying is possible; there is no execution deadline or service-uptime guarantee. Funds already claimed to a wallet are never re-debited.';
}
