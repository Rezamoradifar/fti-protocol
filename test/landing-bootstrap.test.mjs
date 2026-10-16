import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('hashed landing retains an honest no-JavaScript fallback without inline executable code',()=>{
 const html=fs.readFileSync('landing/public/index.html','utf8');
 assert.match(html,/id="fti-boot"/);
 assert.match(html,/href="\/app\/"/);
 assert.match(html,/__APP_JS__/);assert.match(html,/__APP_CSS__/);
 assert(!/<script(?![^>]*src=)[^>]*>/i.test(html));
 const built=fs.readFileSync('landing/dist/index.html','utf8');
 assert.match(built,/src="\/assets\/main-[A-Z0-9]+\.js"/);
 for(const route of ['token-site','whitepaper','roadmap'])assert(fs.existsSync('landing/dist/'+route+'/index.html'));
});
