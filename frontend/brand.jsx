import React from 'react';

// One scalable mark for the protocol, token and member workspace.
export function BrandMark({size=42,className=''}){
 return <svg className={'fti-brand-mark '+className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5"/><path d="M19 46V18h20v5H25v7h12v5H25v11z" fill="currentColor"/><path d="M36 18h12v12m0-12L34 32" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/></svg>;
}
export function Brand({href='/',token=false}){
 return <a className="fti-brand" href={href} aria-label={token?'FTI Token':'FTI Protocol'}><BrandMark/><span dir="ltr">FTI<small>{token?'TOKEN':'PROTOCOL'}</small></span></a>;
}
export function TokenSeal(){
 return <div className="fti-token-seal" aria-hidden="true"><div className="fti-token-orbit"/><div className="fti-token-coin"><BrandMark size={96}/><strong>FTI</strong><span>RESERVE TOKEN</span></div></div>;
}
