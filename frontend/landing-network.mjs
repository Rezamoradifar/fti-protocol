import {deploymentNetwork} from '../core/deployment-network.mjs';
const mainnetCopy={
 'Explore testnet':'Open application','Explore the testnet':'Open application','Explore FTI testnet':'Open FTI application',
 'Open testnet application':'Open application','TESTNET':'MAINNET','01 / TESTNET EDITION':'01 / MAINNET EDITION',
 'EXPLORE WITH TEST ASSETS':'EXPLORE THE APPLICATION','to your first test.':'to your first transaction.',
 'The test application opens separately. Its availability depends on the testnet and its RPC service.':'The application opens separately. Check the selected network and collateral before signing.',
 'Experimental protocol · Test assets only · Not independently audited':'Experimental protocol · Real assets · Not independently audited',
 'AVAILABLE FOR TESTING':'ACTIVE DEPLOYMENT','The current testnet':'The configured deployment',
 'CURRENT TESTNET TOKEN · CHAIN 97':'CURRENT TOKEN · CHAIN 56','BNB SMART CHAIN TESTNET':'BNB SMART CHAIN MAINNET',
 'Test assets only. No guaranteed income, token price or principal repayment.':'Real assets. No guaranteed income, token price or principal repayment.',
 'Use a test wallet on BNB Smart Chain testnet, chain ID 97. Keep real funds separate.':'Use your wallet on BNB Smart Chain mainnet, chain ID 56. Review every transaction.',
 'This release is for test assets only. Use BNB testnet and test tokens. MockUSD is not a real stablecoin, and an FTI testnet balance has no promised monetary value.':'The mainnet application uses real assets and BNB for gas. Verify the collateral address. Testnet balances are not automatically converted into mainnet balances.'
};
export function landingDeploymentCopy(text,cfg){
 if(!cfg)return text;
 if(cfg.hourlyCapFlushVersion===1){
  if(text==='Unpaid matches')return 'Flushed above-cap matches';
  text=text.replace('Unpaid matched points are retained.','Above-cap matched volume is flushed; within-cap volume deferred by funding remains.')
   .replace('Unpaid matched volume is retained for later settlement.','Above-cap matches are flushed. Within-cap volume deferred by funding remains.');
 }
 if(deploymentNetwork(cfg).testAssets)return text;
 const trimmed=text.trim();if(mainnetCopy[trimmed])return text.replace(trimmed,mainnetCopy[trimmed]);
 return text.replaceAll('test USD','USD').replace('BNB Smart Chain testnet.','BNB Smart Chain mainnet.');
}
