from random import Random
from collections import Counter
rgen=Random(819244);W=10**18;C=Counter();examples={}
ceil=lambda n,d:(n+d-1)//d
def fee(a,r):
 x=max(20*a-max(500*W*20,r),0)
 return ceil(300*400*a*a+700*x*x,10000*400*a)
def check(r,s,r1,s1,f,kind):
 if not s1:return
 d=max(0,r*s1//s+1-r1)
 assert d==0,(kind,r,s,r1,s1,f,d)
 assert r1*s>r*s1
 C[kind]+=1
 if r1*W//s1==r*W//s:C['unchanged_getter']+=1
for _ in range(200000):
 r=rgen.randrange(1,10**30);s=rgen.randrange(2,10**36);a=rgen.randrange(1,10**30-r+1)
 f=fee(a,r);m=(a-f)*s//r
 if m>=10**6 and s+m<=10**36:check(r,s,r+a,s+m,f,'buy')
 q=rgen.randrange(1,s);g=q*r//s;f=fee(g,r) if g else 0;p=g-f
 if p>0:check(r,s,r-p,s-q,f,'sell')
 b=ceil(q*3,100)
 if q>b:check(r,s,r,s-b,0,'transfer')
# Existing exact-mint rules with all fee retained: repeated tiny actions cannot spend H.
r=1900000000000000000;s=5*10**35;H=500*W
for _ in range(10000):
 a=10**6;f=fee(a,r);m=(a-f)*s//r;check(r,s,r+a,s+m,f,'tiny_buy');r+=a;s+=m
 q=2;b=1;check(r,s,r,s-b,0,'tiny_transfer');s-=b
assert H==500*W
# Positive fees alone do NOT stop draining historical H if an unrestricted loss path exists.
r=s=10**24;r1=r-10**18;s1=s;f=1;d=max(0,r*s1//s+1-r1)
assert d==10**18+1 and d>f
examples['positive_fee_not_sufficient']={'fee_atoms':f,'D_atoms':d}
# Validate hypothetical helper: full exact D or revert; never partial commitment.
for _ in range(10000):
 r=rgen.randrange(1,10**30);s=rgen.randrange(1,10**36);s1=rgen.randrange(1,10**36);r1=rgen.randrange(0,10**30)
 d=max(0,r*s1//s+1-r1);H=rgen.randrange(0,10**30);f=rgen.randrange(0,10**28)
 if d<=H and d<=f and r1+d<=10**30:
  assert (r1+d)*s>r*s1
  if d:assert (r1+d-1)*s<=r*s1
  C['synthetic_helper_success']+=1
 else:C['synthetic_helper_reject']+=1
print(dict(C));print(examples);print('normal_support_spend_atoms',0,'H_unchanged',H==500*W if False else 'repeated test verified')
