import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadWallets,validateWallets} from '../scripts/v3-wallets.mjs';
test('approved ordered wallets exclude both independent roles',()=>{
 const c=loadWallets();assert.equal(c.genesis.length,31);
 assert.equal(c.genesis[0],'0xD6492377C2C33047aFE61768930b2aedFF2B2704');
 assert.equal(c.genesis[30],'0xDf8Cb7695cEE9926141b4C3664b3338C35808F1e');
 for(const role of ['owner','development']) {const copy=structuredClone(c);copy.genesis[0]=copy[role];assert.throws(()=>validateWallets(copy),/cannot occupy/);}
 const dup=structuredClone(c);dup.genesis[30]=dup.genesis[0];assert.throws(()=>validateWallets(dup),/31 unique/);
 const invalid=structuredClone(c);invalid.genesis[0]='0x123';assert.throws(()=>validateWallets(invalid),/31 unique/);
});
