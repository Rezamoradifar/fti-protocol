// Read-only capability checks. An API flag or a newly served ABI is not proof
// that a new setter exists on the installed proxy implementation.
export async function readBuilderMode(binary,blockTag){
 if(!Number.isSafeInteger(blockTag)||blockTag<0)return 'unknown';
 const has=name=>binary.interface.hasFunction(name);
 if(!has('setAutoBuy')||!has('members'))return 'unknown';
 try{
  if(!has('autoBuyPercent')||!has('setAutoBuyPercent'))return 'legacy';
  const value=await binary.autoBuyPercent('0x0000000000000000000000000000000000000000',{blockTag});
  return value===5n?'selectable':'unknown';
 }catch(error){
  // A transport failure must not silently become a statement about old logic.
  if(error?.code!=='CALL_EXCEPTION')return 'unknown';
  try{const m=await binary.members('0x0000000000000000000000000000000000000000',{blockTag});
   return m.exists===false?'legacy':'unknown';
  }catch{return 'unknown';}
 }
}
export function builderMonthState(state,mode){
 const result={kind:'unknown',boundary:null,canBegin:false,canProcess:false};
 const valid=v=>/^(0|[1-9][0-9]*)$/.test(String(v))&&BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER);
 if(!state||!['nextMonth','timestamp','lastClosedAt','monthPhase'].every(k=>valid(state[k])))return result;
 const month=Number(state.nextMonth),year=Math.floor(month/12);
 if(year<1970||year>9998)return result;
 const boundary=Date.UTC(year,month%12+1,1)/1000;
 if(!Number.isFinite(boundary))return result;
 const frozen=state.binaryRecoveryFrozen===true;
 if(Number(state.monthPhase)>0)return {...result,kind:'processing',boundary,canProcess:!frozen};
 const early=Number(state.timestamp)<boundary,waiting=Number(state.lastClosedAt)<boundary;
 const kind=early?'waiting-month':waiting?'waiting-hour':'ready';
 return {...result,kind,boundary,canBegin:!frozen&&((!early&&!waiting)||mode==='selectable')};
}
export function autoPercent(value){
 const raw=String(value);if(!/^(?:[5-9]|[1-9][0-9]|100)$/.test(raw))throw Error('Choose a whole percentage from 5 to 100.');
 return Number(raw);
}
