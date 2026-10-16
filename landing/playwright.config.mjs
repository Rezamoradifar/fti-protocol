import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests', testMatch:'*.spec.mjs', timeout:30000,
  use:{browserName:process.env.FTI_BROWSER||'chromium',
    ...(process.env.FTI_BROWSER==='webkit'?{isMobile:true,hasTouch:true,deviceScaleFactor:3}:{}),baseURL:process.env.FTI_TEST_ORIGIN||'http://127.0.0.1:4173',
    launchOptions:process.env.FTI_BROWSER!=='webkit'&&process.env.FTI_CHROMIUM_PATH?{executablePath:process.env.FTI_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--disable-gpu-sandbox']}:{}},
  webServer:process.env.FTI_TEST_ORIGIN?undefined:{command:'node tests/serve.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:false},
});
