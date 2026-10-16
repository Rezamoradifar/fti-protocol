import React from 'react';
import network from './assets/network.webp';
import token from './assets/token.webp';
import council from './assets/council.webp';
import horizon from './assets/horizon.webp';
export const artwork={network,token,council,horizon};
export function Artwork({kind,className=''}){return <img className={'protocol-art '+className} src={artwork[kind]} alt="" loading="lazy" decoding="async" width={kind==='horizon'?1400:640} height={kind==='horizon'?700:640}/>}
