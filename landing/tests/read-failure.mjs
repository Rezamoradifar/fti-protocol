import {expect} from '@playwright/test';

// readJson intentionally hides raw 503 response bodies after bounded retries.
// Wait for the finished error state, not fixture text the UI must not expose.
export async function expectReadFailure(page,lang){
 const status=page.locator('#status');
 await expect(status).toHaveAttribute('data-state','error');
 await expect(status).toHaveText(lang==='fa'
  ?'اطلاعات قرارداد دریافت نشد. اینترنت را بررسی و دکمه ↻ را بزنید. اتصال ولت جداست؛ پرداخت را تکرار نکنید.'
  :'Contract data could not be loaded. Check your connection and tap Refresh. Wallet connection is separate; do not repeat a payment.');
}
