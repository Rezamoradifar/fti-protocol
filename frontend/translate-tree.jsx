import React from 'react';
import {t} from './locale.js';
// Local copy translation only; attributes carrying URLs, money, form values,
// wallet addresses and callbacks are not changed. No DOM mutation observer.
export function translateTree(node){
 if(typeof node==='string'){
  const m=node.match(/^(\s*)([\s\S]*?)(\s*)$/);return m[1]+t(m[2])+m[3];
 }
 if(Array.isArray(node))return node.map(translateTree);
 if(!React.isValidElement(node))return node;
 const props={};
 for(const key of ['aria-label','title','placeholder','alt'])if(typeof node.props[key]==='string')props[key]=t(node.props[key]);
 if(Object.hasOwn(node.props,'children'))props.children=translateTree(node.props.children);
 return React.cloneElement(node,props);
}
