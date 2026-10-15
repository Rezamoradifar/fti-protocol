import React from 'react';

// One scalable mark for the protocol, token and member workspace.
export function BrandMark({size=42,className=''}){
 return <svg className={'fti-brand-mark '+className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false"><rect x="1" y="1" width="62" height="62" rx="20" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeOpacity=".35"/><path d="M18 19 47 13v9l-29 6zm0 13 22-5v9l-22 5zm0 13 10-2v9l-10 2z" fill="currentColor"/></svg>;
}
export function Brand({href='/',token=false}){
 return <a className="fti-brand" href={href} aria-label={token?'FTI Token':'FTI Protocol'}><BrandMark/><span dir="ltr">FTI<small>{token?'TOKEN':'PROTOCOL'}</small></span></a>;
}
export function TokenSeal(){
 return <div className="fti-token-seal" aria-hidden="true"><div className="fti-token-orbit"/><div className="fti-token-coin"><BrandMark size={96}/><strong>FTI</strong><span>RESERVE TOKEN</span></div></div>;
}
