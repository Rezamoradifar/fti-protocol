import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'customer-services.browser.mjs',timeout:30000,workers:1,
 use:{browserName:'chromium',baseURL:'http://127.0.0.1:4174',launchOptions:process.env.FTI_CHROMIUM_PATH?{executablePath:process.env.FTI_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{}},
 webServer:{command:'node tests/customer-services-server.mjs',url:'http://127.0.0.1:4174/support/',reuseExistingServer:false},
});
