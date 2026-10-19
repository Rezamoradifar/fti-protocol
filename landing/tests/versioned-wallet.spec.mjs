import {test,expect} from '@playwright/test';
test('versioned wallet modules load from the workspace directory',async({page})=>{
 await page.goto('/app/?lang=en');
 const result=await page.evaluate(async()=>{
  const ethers=await import('/app/vendor/ethers.js');
  const wc=await import('/app/vendor/walletconnect.js');
  return {address:ethers.isAddress('0x2bf894836cbBBb9b27A0394a3EdF340c66839322'),walletConnect:typeof wc.walletConnectProvider};
 });
 expect(result).toEqual({address:true,walletConnect:'function'});
});
