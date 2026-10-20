import {test} from 'node:test';
import assert from 'node:assert/strict';
import {siteLinks} from '../frontend/site-links.js';
test('all workspaces retain the authorized origin across every production entry host',()=>{
 for(const host of ['ftiprotocol.com','www.ftiprotocol.com','app.ftiprotocol.com','token.ftiprotocol.com','council.ftiprotocol.com','localhost:3000']){
  const origin=(host.startsWith('localhost')?'http://':'https://')+host;
  const links=siteLinks(origin+'/app/#network');
  for(const link of Object.values(links))assert.equal(new URL(link).origin,origin);
  assert.equal(new URL(links.trade).pathname,'/token/');assert.equal(new URL(links.council).pathname,'/admin/');
 }
});
