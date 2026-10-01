// Independent integer ledger for the attributed-credit candidate. This is not an EVM throughput test.
import assert from 'node:assert/strict';
export const WAD = 10n ** 18n;
const caps = [[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];
const tiers = [16n,12n,8n,4n].map(x => x * WAD / 10n);
const thresholds = [100,200,500,1000];
export class FundedLedger {
 constructor() {
  this.users=[]; this.dirty=new Set(); this.monthAccounts=new Set(); this.level=0;
  this.pointBook=0n; this.pointAssigned=0n; this.pointRetained=0n; this.pointPaid=0n;
  this.builderBook=0n; this.builderAssigned=0n; this.builderRetained=0n; this.builderPaid=0n;
  this.monthFunds=[0n,0n,0n,0n]; this.inflow=0n; this.development=0n; this.tokenSupport=0n;
  this.unitsSinceSettlement=0; this.ancestorVisits=0; this.epochVisits=0; this.monthVisits=0;
  this.epochs=0; this.months=0;
  for(let i=0;i<31;i++) this.place(i ? Math.floor((i-1)/2) : -1);
 }
 place(parent) {
  const p=parent<0?null:this.users[parent]; assert(parent===-1 ? this.users.length===0 : !!p);
  assert(!p || (p.children.length<2 && p.depth<64));
  const id=this.users.length;
  this.users.push({parent,children:[],depth:p?p.depth+1:0,units:0,left:0,right:0,lifeLeft:0,lifeRight:0,
   creditLeft:0n,creditRight:0n,rank:0,reward:0n,builderReward:0n,builder:[0n,0n,0n,0n],claimed:[false,false,false,false]});
  if(p)p.children.push(id); return id;
 }
 fund(id,units) {
  assert(Number.isSafeInteger(units)&&units>0&&units<=1000000);
  const u=this.users[id]; assert(u); u.units+=units; this.unitsSinceSettlement+=units;
  const n=BigInt(units),point=90n*WAD*n,builder=4n*WAD*n;
  this.inflow+=100n*WAD*n; this.development+=WAD*n; this.tokenSupport+=5n*WAD*n;
  this.pointBook+=point; this.builderBook+=builder;
  const d=BigInt(u.depth),ps=d?point/d:0n,bs=tiers.map(x=>d?x*n/d:0n);
  this.pointRetained+=point-ps*d;
  for(let t=0;t<4;t++){this.monthFunds[t]+=tiers[t]*n;this.builderRetained+=tiers[t]*n-bs[t]*d;}
  let child=id,parent=u.parent;
  while(parent>=0){
   const a=this.users[parent]; this.ancestorVisits++;
   if(a.units>0){
    const side=a.children[0]===child?'Left':'Right';
    a[side.toLowerCase()]+=units;a['life'+side]+=units;a['credit'+side]+=ps;
    this.pointAssigned+=ps;this.dirty.add(parent);this.monthAccounts.add(parent);
    for(let t=0;t<4;t++){a.builder[t]+=bs[t];this.builderAssigned+=bs[t];}
   }else{this.pointRetained+=ps;for(const b of bs)this.builderRetained+=b;}
   child=parent;parent=a.parent;
  }
 }
 closeEpoch() {
  this.epochs++; if(this.unitsSinceSettlement<5)return;
  let paidPoints=0,eligibleBudget=0n;
  for(const id of this.dirty){
   const u=this.users[id],raw=Math.min(u.left,u.right),paid=Math.min(raw,caps[this.level][u.rank]);
   const l=raw?u.creditLeft*BigInt(raw)/BigInt(u.left):0n;
   const r=raw?u.creditRight*BigInt(raw)/BigInt(u.right):0n;
   const eligible=raw?(l+r)*BigInt(paid)/BigInt(raw):0n,max=20n*WAD*BigInt(paid),reward=eligible<max?eligible:max;
   u.creditLeft-=l;u.creditRight-=r;u.left-=raw;u.right-=raw;u.reward+=reward;
   this.pointAssigned-=l+r;this.pointRetained+=l+r-reward;this.pointBook-=reward;this.pointPaid+=reward;
   paidPoints+=paid;eligibleBudget+=eligible;this.epochVisits++;
   for(let t=u.rank;t<4;t++)if(Math.min(u.lifeLeft,u.lifeRight)>=thresholds[t])u.rank=t+1;
  }
  this.dirty.clear();
  if(paidPoints){const limit=20n*WAD*BigInt(paidPoints);if(eligibleBudget<limit)this.level=Math.min(3,this.level+1);if(eligibleBudget>limit)this.level=Math.max(0,this.level-1);this.unitsSinceSettlement=0;}
 }
 closeMonth() {
  assert.equal(this.dirty.size,0,'settle the month-end epoch first');
  for(const id of this.monthAccounts){
   const u=this.users[id];this.monthVisits++;
   for(let t=0;t<4;t++){
    const c=u.builder[t],limit=this.monthFunds[t]/5n;
    const reward=u.rank>t&&!u.claimed[t]?(c<limit?c:limit):0n;
    if(reward)u.claimed[t]=true;
    u.builder[t]=0n;u.builderReward+=reward;this.builderAssigned-=c;this.builderRetained+=c-reward;
    this.builderBook-=reward;this.builderPaid+=reward;
   }
  }
  this.monthAccounts.clear();this.monthFunds.fill(0n);this.months++;
 }
 check(full=false) {
  for(const x of [this.pointAssigned,this.pointRetained,this.builderAssigned,this.builderRetained])assert(x>=0n);
  assert.equal(this.pointAssigned+this.pointRetained,this.pointBook);
  assert.equal(this.builderAssigned+this.builderRetained,this.builderBook);
  assert.equal(this.pointBook+this.builderBook+this.pointPaid+this.builderPaid+this.development+this.tokenSupport,this.inflow);
  if(full){
   assert.equal(this.users.reduce((s,u)=>s+u.creditLeft+u.creditRight,0n),this.pointAssigned);
   assert.equal(this.users.reduce((s,u)=>s+u.builder.reduce((a,b)=>a+b,0n),0n),this.builderAssigned);
   assert.equal(this.users.reduce((s,u)=>s+u.reward,0n),this.pointPaid);
   assert.equal(this.users.reduce((s,u)=>s+u.builderReward,0n),this.builderPaid);
  }
 }
}
