"""Independent arithmetic checks. This does not execute Solidity or establish EVM equivalence."""
import json, random
from pathlib import Path
W=10**18
MAX_R=10**30
MAX_S=10**36
U256=2**256-1
rng=random.Random(20261006)
count=dict(buys=0,partial_sells=0,transfers=0,restarts=0,out_of_range_or_zero_output=0)
def ceildiv(a,b): return (a+b-1)//b
def fee(v,r,s):
    if not v: return 0
    if not s or not r: return ceildiv(v*300,10000)
    x=max(20*v-max(500*W*20,r),0)
    return ceildiv(300*400*v*v+700*x*x,10000*400*v)
for i in range(100000):
    r=rng.randrange(1,MAX_R+1);s=rng.randrange(2,MAX_S+1);a=rng.randrange(1,MAX_R-r+1) if r<MAX_R else 1
    f=fee(a,r,s);net=a-f
    assert 0<f<=a
    if a<=500*W: assert f==ceildiv(a*300,10000)
    mint=net*s//r
    if mint and s+mint<=MAX_S:
        assert (r+a)*s>r*(s+mint)
        assert mint<=net*s//r
        count['buys']+=1
    else: count['out_of_range_or_zero_output']+=1
    q=rng.randrange(1,s);gross=q*r//s;f=fee(gross,r,s);payout=gross-f
    if payout>0:
        assert (r-payout)*s>r*(s-q)
        count['partial_sells']+=1
    else:count['out_of_range_or_zero_output']+=1
    v=rng.randrange(2,s+1);burn=ceildiv(v*300,10000)
    if v>burn and s>burn:
        assert r*s>r*(s-burn)
        count['transfers']+=1
    # A new cycle mints against exact old reference while its R is only new cash.
    f=fee(a,0,0);mint=(a-f)*s//r
    if mint and mint<=MAX_S:
        assert a*s>r*mint
        # Terminal refund plus reserved dev claim equals that cycle's cash only.
        finalfee=fee(a,a,mint)
        assert (a-finalfee)+finalfee==a
        count['restarts']+=1
assert MAX_R*MAX_S<U256
assert 300*400*MAX_R**2+700*(20*MAX_R)**2<U256
boundaries=[]
for r in [1,500*W,10000*W,10000*W+1,MAX_R]:
    threshold=max(500*W,ceildiv(r,20))
    for v in [500*W-1,500*W,500*W+1,threshold-1,threshold,threshold+1]:
        f=fee(v,r,1)
        assert 0<f<v
        boundaries.append(dict(reserve=str(r),amount=str(v),fee=str(f)))
result={'seed':20261006,'random_states':100000,'accepted_checks':count,'fee_boundary_cases':len(boundaries),'uint256_cross_product_and_fee_bounds':'pass','status':'pass','scope':'Independent integer arithmetic model only, not EVM or source-equivalence validation'}
print(json.dumps(result,indent=2))
Path(__file__).with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
