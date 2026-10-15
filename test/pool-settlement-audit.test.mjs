import test from 'node:test';
import assert from 'node:assert/strict';
import {auditHourlySettlement as audit} from '../core/hourly-settlement-audit.mjs';
const unit=10n**18n;
const row=(wallet,points,cash,automatic=0n)=>({wallet,points,cash,automatic});
test('pooled public-chain audit accepts sub-target point value and exact per-wallet rounding',()=>{
 const x=audit({pool:100n*unit,points:10n,pointValue:10n*unit,allocations:[row('a',3n,27n*unit,3n*unit),row('b',7n,70n*unit)],pooled:true});
 assert.equal(x.carry,'0');
 const dust=audit({pool:10n,points:3n,pointValue:3n,allocations:[row('a',1n,3n),row('b',2n,6n)],pooled:true});
 assert.equal(dust.carry,'1');
 assert.equal(audit({pool:3n,points:3n,pointValue:1n,allocations:[row('a',1n,1n),row('b',2n,2n)],pooled:true}).allocated,'3');
});
test('pooled audit catches missing, duplicated, misweighted and overpaid recipients',()=>{
 const base={pool:11n,points:3n,pointValue:3n,allocations:[row('a',1n,3n),row('b',2n,7n)],pooled:true};
 assert.equal(audit(base).carry,'1');
 for(const change of [{allocations:[row('a',1n,3n)]},{allocations:[row('a',1n,3n),row('A',2n,7n)]},
  {allocations:[row('a',1n,4n),row('b',2n,6n)]},{allocations:[row('a',1n,4n),row('b',2n,8n)]},{pointValue:4n}]){
  assert.throws(()=>audit({...base,...change}));
 }
});
test('no eligible points retains all funds, while the legacy floor still applies only to legacy reports',()=>{
 assert.equal(audit({pool:100n,points:0n,pointValue:0n,allocations:[row('a',0n,0n)],pooled:true}).carry,'100');
 const legacy={pool:30n*unit,points:1n,pointValue:20n*unit,allocations:[row('a',1n,20n*unit)],pooled:false};
 assert.equal(audit(legacy).carry,String(10n*unit));
 assert.throws(()=>audit({...legacy,pointValue:10n*unit,allocations:[row('a',1n,10n*unit)]}),/gross floor/);
});
