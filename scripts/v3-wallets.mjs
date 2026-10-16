import fs from 'node:fs';
import {isAddress, ZeroAddress} from 'ethers';
export function validateWallets(config) {
  const {owner, development, genesis}=config;
  const valid=a=>typeof a==='string'&&isAddress(a)&&a.toLowerCase()!==ZeroAddress;
  if(!valid(owner)||!valid(development)||owner.toLowerCase()===development.toLowerCase()) throw Error('Owner and development must be distinct valid nonzero addresses');
  if(!Array.isArray(genesis)||genesis.length!==31||!genesis.every(valid)||new Set(genesis.map(a=>a.toLowerCase())).size!==31) throw Error('Require 31 unique valid nonzero genesis wallets');
  if(genesis.some(a=>[owner,development].some(role=>role.toLowerCase()===a.toLowerCase()))) throw Error('Owner and development cannot occupy genesis positions');
  return {owner,development,genesis:[...genesis]};
}
export function loadWallets(file=process.env.V3_WALLETS_CONFIG||'config/v3-wallets.json') {
  return validateWallets(JSON.parse(fs.readFileSync(file,'utf8')));
}
