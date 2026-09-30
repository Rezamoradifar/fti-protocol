import assert from 'node:assert/strict';
export const W=10n**18n;
export const caps=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];
export const ceil=(a,b)=>a/b+(a%b?1n:0n);
export const pow5Up=q=>{let r=W;for(let i=0;i<5;i++)r=ceil(r*q,W);return r;};
export function match(left,right,cap){const raw=left<right?left:right;const paid=raw<cap?raw:cap;return{raw,paid,burned:raw-paid,left:left-raw,right:right-raw};}
export function rank(left,right){const v=left<right?left:right;return[100n,200n,500n,1000n].filter(t=>v>=t).length;}
export function builderPool(balance,count){if(!count)return{pay:0n,carry:balance};const equal=balance/BigInt(count),cap=balance/5n,pay=equal<cap?equal:cap;return{pay,carry:balance-pay*BigInt(count)};}
export class Curve {
 constructor(){this.V=20000n*W;this.S0=1000000n*W;this.supply=0n;this.reserve=0n;this.bb=0n;this.floor=0n;this.cash=0n;this.balances=new Map();this.ath=W/10n;}
 get S(){return this.S0+this.supply;}
 get X(){return this.V+this.reserve;}
 price(){return this.X*5n*W/this.S;}
 cost(m){return ceil(this.X*(pow5Up(ceil((this.S+m)*W,this.S))-W),W);}
 quoteBuy(amount){const fee=this.price()*100n<=this.ath*90n?120n:300n;const net=amount-amount*fee/10000n;let lo=0n,hi=this.S;while(this.cost(hi)<=net)hi*=2n;while(lo<hi){const m=lo+(hi-lo+1n)/2n;if(this.cost(m)<=net)lo=m;else hi=m-1n;}return{minted:lo,fee:amount-net,net};}
 inject(amount){this.cash+=amount;this.bb+=amount*80n/100n;this.floor+=amount-amount*80n/100n;this.defend();this.check();}
 buy(id,amount){assert(amount>0n);const q=this.quoteBuy(amount);const bal=this.balances.get(id)||0n;assert(q.minted>0n&&(bal+q.minted)*100n<=this.S+q.minted,'holding cap');this.cash+=amount;this.reserve+=q.net;this.bb+=q.fee;this.supply+=q.minted;this.balances.set(id,bal+q.minted);this.defend();this.check();return q.minted;}
 sell(id,tokens,sustained=false){assert(tokens>0n&&tokens<=(this.balances.get(id)||0n));const gross=this.X*(W-pow5Up(ceil((this.S-tokens)*W,this.S)))/W;const rho=gross*10000n/this.X;let fee=300n;if(rho>100n)fee+=5700n*(rho>=1000n?900n:rho-100n)/900n;if(sustained&&fee<1500n)fee=1500n;const payout=gross*(10000n-fee)/10000n;const extra=gross*(fee-300n)/10000n;assert(payout+extra<=this.reserve);this.reserve-=payout+extra;this.bb+=extra;this.cash-=payout;this.supply-=tokens;this.balances.set(id,this.balances.get(id)-tokens);this.defend();this.check();return payout;}
 defend(){let p=this.price();if(p>this.ath){this.ath=p;return;}if(p*100n<=this.ath*99n){const need=this.ath*this.S/(5n*W)-this.X;const amount=need<this.bb?need:this.bb;if(amount>0n){this.bb-=amount;this.reserve+=amount;}}if(this.price()*100n<this.ath*92n){const need=this.ath*92n*this.S/(500n*W)-this.X;const amount=need<this.floor?need:this.floor;if(amount>0n){this.floor-=amount;this.reserve+=amount;}}}
 check(){assert.equal(this.cash,this.reserve+this.bb+this.floor);assert(this.reserve>=0n);assert(this.X*this.S0**5n>=this.V*this.S**5n,'exact integer solvency invariant');}
}
/// Reference for integrated cash/volume flows, not a substitute for EVM tests or lock/governance implementation.
export class Protocol {
 constructor(){this.token=new Curve();this.members=[];this.pool=0n;this.builders=[0n,0n,0n,0n];this.dev=0n;this.pending=0n;this.cash=0n;this.externalIn=0n;this.externalOut=0n;this.unitsPending=0n;this.level=0;}
 register(units=1n,parent=null){const id=this.members.length;if(parent!==null){assert(this.members[parent]);assert(this.members[parent].children.length<2);}this.members.push({units:0n,parent,children:[],left:0n,right:0n,cumL:0n,cumR:0n,rank:0,pending:0n,spent:0n,auto:false,claimed:[false,false,false,false]});if(parent!==null)this.members[parent].children.push(id);this.addUnits(id,units);return id;}
 addUnits(id,n){assert(n>0n);const m=this.members[id];m.units+=n;this.externalIn+=100n*W*n;this.cash+=95n*W*n;this.pool+=90n*W*n;this.dev+=W*n;[16n,12n,8n,4n].forEach((x,i)=>this.builders[i]+=x*W*n/10n);this.token.inject(5n*W*n);this.unitsPending+=n;let child=id,parent=m.parent;while(parent!==null){const p=this.members[parent];if(p.children[0]===child){p.left+=n;p.cumL+=n;}else{p.right+=n;p.cumR+=n;}child=parent;parent=p.parent;}this.check();}
 buy(id,amount,auto=false){const m=this.members[id];if(!auto){assert(m.spent+amount<=m.units*BigInt([500,600,700,800,1000][m.rank])*W,'allowance');}else assert(amount<=m.pending,'not funded');const mint=this.token.buy(id,amount);if(auto){m.pending-=amount;this.pending-=amount;this.cash-=amount;}else{m.spent+=amount;this.externalIn+=amount;}this.check();return mint;}
 settle(){if(this.unitsPending<5n)return false;let total=0n;const matches=this.members.map(m=>{const r=match(m.left,m.right,BigInt(caps[this.level][m.rank]));total+=r.paid;return r;});if(!total)return false;const pool=this.pool,pv=pool/total;this.members.forEach((m,i)=>{const r=matches[i];m.left=r.left;m.right=r.right;const reward=r.paid*pv;m.pending+=reward;this.pending+=reward;this.pool-=reward;m.rank=rank(m.cumL,m.cumR);});if(pool<20n*W*total)this.level=Math.min(3,this.level+1);else if(pool>20n*W*total)this.level=Math.max(0,this.level-1);this.unitsPending=0n;this.check();return true;}
 month(){for(let p=0;p<4;p++){const eligible=this.members.filter(m=>m.rank>p&&!m.claimed[p]);const q=builderPool(this.builders[p],eligible.length);if(q.pay>0n)for(const m of eligible){m.claimed[p]=true;m.pending+=q.pay;this.pending+=q.pay;}this.builders[p]=q.carry;}this.check();}
 claim(id){const m=this.members[id],amount=m.pending;this.pending-=amount;this.cash-=amount;this.externalOut+=amount;m.pending=0n;this.check();return amount;}
 sell(id,amount){const payout=this.token.sell(id,amount);this.externalOut+=payout;this.check();return payout;}
 check(){this.token.check();assert.equal(this.cash,this.pool+this.builders.reduce((a,b)=>a+b,0n)+this.dev+this.pending);assert.equal(this.externalIn-this.externalOut,this.cash+this.token.cash);}
}
