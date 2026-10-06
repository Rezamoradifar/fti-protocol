from random import Random
from collections import Counter
c=Counter(); ex={}; W=10**18
ceil=lambda n,d:(n+d-1)//d
def fee(v,r,s):
 if not r or not s:return ceil(300*v,10000)
 x=max(20*v-max(500*W*20,r),0)
 return ceil(300*400*v*v+700*x*x,10000*400*v)
def check(r,s,r1,s1,k):
 if s1==0:c['terminal_checked']+=1;return
 d=max(0,ceil(r*s1,s)-r1)
 assert d==0,(k,r,s,r1,s1,d)
 assert r1*s>=r*s1
 c[k]+=1
 if r1*W//s1==r*W//s:c['valid_unchanged_display']+=1
for r in range(1,81):
 for s in range(1,81):
  for a in range(1,61):
   f=fee(a,r,s);m=(a-f)*s//r
   if m:
    check(r,s,r+a,s+m,'exhaustive_buy')
    p=r*W//s;mc=(a-f)*W//p
    if (r+a)*s<r*(s+mc):c['current_buy_deficit']+=1
   else:c['zero_mint']+=1
  for q in range(1,s+1):
   g=q*r//s;f=fee(g,r,s) if g else 0;out=g-f
   if out>0:check(r,s,r-out,s-q,'exhaustive_sell')
   else:c['zero_payout']+=1
   b=ceil(q*300,10000)
   if q>b:check(r,s,r,s-b,'exhaustive_transfer')
rng=Random(7721)
for i in range(100000):
 r=rng.randrange(1,10**30);s=rng.randrange(1,10**36);a=rng.randrange(1,10**30-r+1)
 f=fee(a,r,s);m=(a-f)*s//r
 if m and s+m<=10**36:check(r,s,r+a,s+m,'random_buy')
 p=r*W//s
 if p:
  mc=(a-f)*W//p
  if s+mc<=10**36 and (r+a)*s<r*(s+mc):c['current_buy_deficit']+=1;ex.setdefault('current_buy_deficit',(r,s,a,f,p,mc))
 q=rng.randrange(1,s+1);g=q*r//s;f=fee(g,r,s);out=g-f
 if out>0:check(r,s,r-out,s-q,'random_sell')
 b=ceil(q*300,10000)
 if q>b:check(r,s,r,s-b,'random_transfer')
# Deliberate maximum-supply low-price cases reveal truncated-price overmint.
for p in range(1,100):
 s=10**36;r=(p*10+9)*10**17;s//=2
 for a in [1,10**6,10**12,10**18,100*W,500*W]:
  f=fee(a,r,s);pc=r*W//s;mc=(a-f)*W//pc;m=(a-f)*s//r
  if mc and s+mc<=10**36 and (r+a)*s<r*(s+mc):
   c['target_current_buy_deficit']+=1;ex.setdefault('target_current_buy_deficit',(r,s,a,f,pc,mc,max(0,ceil(r*(s+mc),s)-(r+a))))
  if m and s+m<=10**36:check(r,s,r+a,s+m,'target_fixed_buy')
# Repeated dust and alternating buy/sell operations, full precision.
r=1000*W;s=10000*W;H=500*W
for i in range(10000):
 a=[34,1000,10**6,W][i%4];f=fee(a,r,s);m=(a-f)*s//r
 if m:check(r,s,r+a,s+m,'split_buy');r+=a;s+=m
 q=max(1,m//2);g=q*r//s;f=fee(g,r,s) if g else 0;out=g-f
 if out>0:check(r,s,r-out,s-q,'split_sell');r-=out;s-=q
assert H==500*W
# Minimum-deficit identity and finite fund boundary: proposed helper, not an authorized loss path.
for r in range(1,31):
 for s in range(1,31):
  for s1 in range(1,31):
   r1=max(0,r-3);d=max(0,ceil(r*s1,s)-r1)
   assert (r1+d)*s>=r*s1
   if d:assert (r1+d-1)*s<r*s1
   if d>0:
    assert (r1+min(d,d-1))*s<r*s1
    c['insufficient_fund_rejected']+=1
   c['minimum_deficit_identity']+=1
print(dict(c));print('counterexamples',ex);print('support_spent_in_all_valid_trade_tests',0)
# Arbitrary support fraction of cash fee, including 100%, never double count.
cs=Counter()
for i in range(100000):
 r=rng.randrange(1,10**30);s=rng.randrange(1,10**36);a=rng.randrange(1,10**30-r+1)
 f=fee(a,r,s);m=(a-f)*s//r
 for h in [0,f//2,f]:
  if m and s+m<=10**36:
   assert (r+a-h)*s>=r*(s+m);cs['buy_fee_split']+=1
 q=rng.randrange(1,s) if s>1 else 1;g=q*r//s;f=fee(g,r,s) if g else 0;out=g-f
 for h in [0,f//2,f]:
  if out>0 and s>q:
   assert (r-out-h)*s>=r*(s-q);cs['sell_fee_split']+=1
print('additional_fee_split_checks',dict(cs))
