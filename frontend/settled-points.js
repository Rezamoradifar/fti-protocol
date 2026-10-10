export function settledPoints(state){
 if(!state||Number(state.phase)!==0)return {raw:null,paid:null,count:null};
 return {raw:BigInt(state.candidatePoints||0)>0n?state.calculatedPointValue:null,paid:BigInt(state.totalPaidPoints||0)>0n?state.pointValue:null,count:state.totalPaidPoints||0};
}
