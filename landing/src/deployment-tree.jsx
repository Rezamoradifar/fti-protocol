import React from 'react';
import {landingDeploymentCopy} from '../../frontend/landing-network.mjs';
export function deploymentTree(node,cfg){
 if(typeof node==='string')return landingDeploymentCopy(node,cfg);
 if(Array.isArray(node))return node.map(child=>deploymentTree(child,cfg));
 if(!React.isValidElement(node)||!Object.hasOwn(node.props,'children'))return node;
 return React.cloneElement(node,{children:deploymentTree(node.props.children,cfg)});
}
