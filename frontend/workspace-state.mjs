// Advisory presentation state only. Contract permissions and conditions remain authoritative.
export const STALE_AFTER_MS = 45000;
export function dataFreshness(lastUpdated, now = Date.now(), failed = false) {
 if (!lastUpdated) return { stale: true, label: failed ? 'Contract data unavailable' : 'Loading contract data' };
 const seconds = Math.max(0, Math.floor((now - lastUpdated) / 1000));
 return { stale: failed || now - lastUpdated >= STALE_AFTER_MS, label: `Last successful read ${seconds}s ago` };
}
export function settlementReadiness(data) {
 const result = (ready, reason) => ({ ready, reason });
 if (!data) return Object.fromEntries(['volume','close-epoch','process-epoch','begin-month','process-month'].map(id => [id,result(false,'Waiting for contract data')]));
 const phase=Number(data.phase),monthPhase=Number(data.monthPhase),queued=BigInt(data.jobCount)>BigInt(data.jobCursor),ended=Number(data.timestamp)>=Number(data.epochEnd);
 const monthKey=Number(data.nextMonth),monthEnd=Number.isSafeInteger(monthKey)?Date.UTC(Math.floor(monthKey/12),monthKey%12+1,1)/1000:NaN;
 return {
  volume:result(phase===0&&queued,phase!==0?'Finish hourly settlement first':queued?'Queued branch volume is ready to process':'Volume queue is clear'),
  'close-epoch':result(phase===0&&ended&&!queued,phase!==0?'Hourly settlement is already running':queued?'Process queued branch volume first':!ended?'Waiting for the epoch boundary':data.epochUnits!==undefined&&BigInt(data.epochUnits)<5n?'Ready to close; fewer than five same-hour paid units, no point matching':'Ready to begin hourly settlement'),
  'process-epoch':result(phase>0,phase===1?'Ready to match eligible points':phase===2?'Ready to allocate funded rewards':'No hourly settlement in progress'),
  'begin-month':result(monthPhase===0&&Number(data.timestamp)>=monthEnd&&Number(data.lastClosedAt)>=monthEnd,monthPhase>0?'Monthly settlement is already running':Number(data.timestamp)<monthEnd?'Waiting for the calendar-month boundary':data.lastClosedAt===undefined?'Monthly checkpoint read unavailable':Number(data.lastClosedAt)<monthEnd?'Close the boundary hour before this month':'Ready to begin monthly settlement'),
  'process-month':result(monthPhase>0,monthPhase>0?'Ready to process monthly rewards':'No monthly settlement in progress')
 };
}
export function actionAvailability({data,wallet,connected=false,councilOwner=false,fresh=false,lifecycle={}}) {
 const ready=!!data&&connected&&fresh,w=wallet;
 return {
  wallet:ready,council:ready&&councilOwner,
  funder:ready&&!data.paused&&!lifecycle.fundingBlocked&&Number(data.phase)===0&&Number(data.timestamp)<Number(data.epochEnd),
  member:ready&&!!w?.exists,
  buyer:ready&&!!w?.exists&&BigInt(w?.units||0)>0n&&!lifecycle.buyingBlocked,
  reward:ready&&BigInt(w?.claimable||0)>0n,
  unlocked:ready&&BigInt(w?.unlocked||0)>0n,
  transfer:ready&&BigInt(w?.unlocked||0)>0n&&!data.tokenPaused&&!data.emergencyExit&&!data.permanentlyRetired&&!data.buysPermanentlyClosed&&!(data.lifecycleClosed&&!data.restartSupported),
  auto:ready&&BigInt(w?.autoPending||0)>0n,
  autoBuyer:ready&&BigInt(w?.autoPending||0)>0n&&!!w?.autoEnabled&&!lifecycle.buyingBlocked
 };
}
export function transactionStage(error) {
 return error?.code===4001||error?.code==='ACTION_REJECTED'?'rejected':error?.code==='WRONG_CHAIN'?'wrong-chain':'error';
}
export function proposalAvailability({executed,approvals,approved,owner,connected}) {
 return {approve:connected&&owner&&!executed&&!approved,execute:connected&&!executed&&Number(approvals)>=5};
}
export function timelockPresentation({scheduled,done,ready,timestamp}) {
 if(done)return {ready:false,label:'Executed on-chain'};
 if(!scheduled)return {ready:false,label:'Not scheduled on-chain'};
 if(ready)return {ready:true,label:'Delay elapsed · ready for on-chain execution'};
 return {ready:false,label:`Waiting until ${new Date(Number(timestamp)*1000).toISOString().replace('T',' ').replace('.000Z',' UTC')}`};
}
