import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
const read = p => fs.readFileSync(new URL('../'+p, import.meta.url),'utf8');
const theme = read('frontend/member-landing-theme.css');
const landing = read('landing/src/initial-landing.css');
const main = read('frontend/main.jsx');
const rgb = hex => hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255);
const luminance = hex => rgb(hex).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast = (a,b) => {const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const tokens = rule => Object.fromEntries([...rule.matchAll(/--([a-z0-9-]+):\s*(#[\da-f]{6})(?:;|\s)/gi)].map(m=>[m[1],m[2]]));

test('member dark palette uses the actual initial landing colors',()=>{
  const dark=tokens(theme.match(/body\[data-surface="member"\]\s*\{([^}]+)\}/)[1]);
  for(const [key,value] of Object.entries({bg:'#080d0b',text:'#eaf1ed',accent:'#b2ffd0',muted:'#9aa79f',line:'#29342d'})) {
    assert.equal(dark[key],value);assert(landing.includes(value),'landing reference changed: '+key);
  }
});
test('theme is valid CSS, locally bundled, and linked after the base workspace stylesheet',async()=>{
  const css=await transform(theme,{loader:'css',minify:true});assert.equal(css.warnings.length,0);
  const html=read('web/index.html');assert(html.indexOf('./member-landing-theme.css')>html.indexOf('./style.css'));
  assert(read('scripts/build-web.mjs').includes("entryPoints:['frontend/member-landing-theme.css']"));
  const built=read('web/member-landing-theme.css');assert(built.length>1000);assert(built.includes('data-surface=member'));
});
test('every theme selector stays scoped to the member surface',()=>{
  const stripped=theme.replace(/\/\*[\s\S]*?\*\//g,'');
  for(const match of stripped.matchAll(/([^{}]+)\{/g)) {
    const selector=match[1].trim();if(selector.startsWith('@'))continue;
    // Commas inside :is() are not independent selectors. All selector lines
    // that begin a rule must explicitly bind the member surface.
    assert(selector.startsWith('body[data-surface="member"]')||selector.startsWith('html[dir="rtl"] body[data-surface="member"]'),selector);
  }
  assert(!theme.includes('[hidden]'));assert(!/pointer-events:\s*auto/.test(theme));
});
test('dark and light primary text pairs satisfy a 4.5:1 contrast check',()=>{
  for(const expression of [/body\[data-surface="member"\]\s*\{([^}]+)\}/,/body\[data-surface="member"\]\.light\s*\{([^}]+)\}/]) {
    const c=tokens(theme.match(expression)[1]);
    for(const surface of ['bg','panel','panel2'])for(const text of ['text','muted'])assert(contrast(c[text],c[surface])>=4.5,`${text} on ${surface}`);
    assert(contrast(c.ink,c.accent)>=4.5,'button label contrast');
    assert(contrast(c.accent,c.panel)>=3,'focus/selected state contrast');
  }
});
test('keyboard focus, reduced motion and small-screen layouts remain explicit',()=>{
  for(const text of [':focus-visible','outline-offset: 4px','prefers-reduced-motion: reduce','max-width: 360px','max-width: 640px','max-width: 860px','min-height: 44px','html[dir="rtl"]'])assert(theme.includes(text),text);
});
test('existing user and auto-buy form hooks remain present',()=>{
  for(const id of ['connect','register-form','buy-form','sell-form','auto-form','auto-percent-control','auto-price-control','claim-rewards','execute-auto','release-auto','status'])assert(main.includes(`id="${id}"`),id);
  assert(main.includes('data-write disabled'));assert(main.includes("import('./controller.js')"));
});
test('member skin adds no remote resources, fake figures or transaction code',()=>{
  assert(!/@import|url\(|https?:\/\//i.test(theme));
  assert(!/content:\s*['"][^'"]+/.test(theme),'no financial labels or fake data in pseudo-elements');
  assert(!/eth_send|private.key|approve\(/i.test(theme));
});
