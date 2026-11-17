import {test,expect} from '@playwright/test';
import fs from 'node:fs';

test('a first visit starts in English, Persian is last, and live reads wait for visibility',async({page})=>{
 const calls=[];page.on('request',request=>{if(/\/(api\/config|rpc)$/.test(new URL(request.url()).pathname))calls.push(request.url());});
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect(page.locator('.landing-language')).toHaveValue('en');
 await expect(page.locator('.landing-language option').first()).toHaveAttribute('value','en');
 await expect(page.locator('.landing-language option').last()).toHaveAttribute('value','fa');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('.quick-actions>a')).toHaveCount(4);
 expect(calls).toEqual([]);
 await page.locator('#live-data').scrollIntoViewIfNeeded();
 await expect(page.locator('#hourly-pool')).toBeVisible();
 expect(calls.some(url=>url.endsWith('/api/config'))).toBe(true);
});

test('failed optional data chunk preserves landing content and provides recovery',async({page})=>{
 await page.goto('/?lang=en');
 const loaded=new Set(await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.name)));
 await page.route('**/assets/*.js',route=>loaded.has(route.request().url())?route.continue():route.abort());
 await page.locator('#live-data').scrollIntoViewIfNeeded();
 await expect(page.getByText('Contract data could not load. You can continue exploring this page.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Reload this page',exact:true})).toBeVisible();
 await expect(page.locator('h1')).toBeAttached();
 await expect(page.locator('.quick-actions>a')).toHaveCount(4);
});

test('English initial payload stays within the measured performance budget',async()=>{
 const stats=JSON.parse(fs.readFileSync(new URL('../build-performance.json',import.meta.url)));
 expect(stats.initialJavaScriptBytes).toBeLessThan(300_000);
 expect(stats.initialJavaScriptGzipBytes).toBeLessThan(90_000);
 expect(stats.initialCssBytes).toBeLessThan(45_000);
});
