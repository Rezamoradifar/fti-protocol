import test from 'node:test';
import assert from 'node:assert/strict';
import {MAINNET_RELEASE,deploymentNetwork,walletConnectOptions} from '../core/deployment-network.mjs';
import {validateFreshInput} from '../scripts/fresh-testnet.mjs';
const mainnet={chainId:56,mode:'bnb-mainnet',release:MAINNET_RELEASE,tokenContract:'FTIReserveTokenUpgradeable',binaryContract:'FundedBinaryPlanUpgradeable'};
test('mainnet configuration cannot reuse a testnet label or legacy contract model',()=>{
 assert.equal(deploymentNetwork(mainnet).explorer,'https://bscscan.com');
 assert.equal(deploymentNetwork(mainnet).testAssets,false);
 for(const change of [{chainId:'56'},{mode:'local'},{mode:'bnb-testnet'},{release:'FTI_CONTINUITY_TESTNET_20261009'},{tokenContract:'FTIReserveTokenV3'},{chainId:1}])assert.throws(()=>deploymentNetwork({...mainnet,...change}));
 assert.equal(deploymentNetwork({chainId:97,mode:'bnb-testnet'}).testAssets,true);
 assert.equal(deploymentNetwork({chainId:31337,mode:'local'}).explorer,null);
 assert.throws(()=>validateFreshInput({chainId:56}),/TESTNET/);
});
test('WalletConnect selects one explicit chain and same-origin read-only RPC',()=>{
 for(const chain of [56,97]){
  const options=walletConnectOptions('a'.repeat(32),chain,'https://example.com');
  assert.deepEqual(options.chains,[chain]);assert.deepEqual(options.rpcMap,{[chain]:'https://example.com/rpc'});
 }
 for(const chain of [1,'56',31337])assert.throws(()=>walletConnectOptions('a'.repeat(32),chain,'https://example.com'));
 assert.throws(()=>walletConnectOptions('bad',56,'https://example.com'));
 assert.throws(()=>walletConnectOptions('a'.repeat(32),56,'http://public.example.com'));
});
