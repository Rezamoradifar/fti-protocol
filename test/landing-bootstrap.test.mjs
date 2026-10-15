import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public landing has a visible fallback and compatibility bootstrap',()=>{
 const html=fs.readFileSync('landing/public/index.html','utf8');
 assert.match(html,/id="fti-boot"/);
 assert.match(html,/Object\.hasOwn/);
 assert.match(html,/String\.prototype\.replaceAll/);
 assert.match(html,/type="module" src="\/app\.js"/);
});
