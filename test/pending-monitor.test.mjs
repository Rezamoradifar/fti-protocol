import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingMonitor} from '../frontend/pending-monitor.js';

function harness(extra={}){
 const tasks=new Map(),listeners=new Set();let id=0;
 const document={hidden:false,addEventListener(_,fn){listeners.add(fn);},removeEventListener(_,fn){listeners.delete(fn);}};
 const monitor=pendingMonitor({check:async()=>false,document,
  setTimer(fn,delay){const next=++id;tasks.set(next,{fn,delay});return next;},
  clearTimer(next){tasks.delete(next);},...extra});
 return {monitor,document,tasks,listeners,
  async tick(){const next=tasks.entries().next().value;assert.ok(next,'scheduled check');tasks.delete(next[0]);await next[1].fn();},
  visibility(hidden){document.hidden=hidden;for(const fn of [...listeners])fn();}};
}

test('checks immediately, polls with a bounded budget, then removes timers and listeners',async()=>{
 let checks=0;const h=harness({check:async()=>{checks++;return false;},maxAttempts:3});
 h.monitor.start();h.monitor.start();assert.equal(h.tasks.size,1);
 assert.equal([...h.tasks.values()][0].delay,0);
 await h.tick();assert.equal([...h.tasks.values()][0].delay,15000);
 await h.tick();await h.tick();
 assert.equal(checks,3);assert.equal(h.tasks.size,0);assert.equal(h.listeners.size,0);
});

test('successful verified resolution stops instead of continuing to poll',async()=>{
 let checks=0;const h=harness({check:async()=>{checks++;return true;}});
 h.monitor.start();await h.tick();h.monitor.wake();
 assert.equal(checks,1);assert.equal(h.tasks.size,0);assert.equal(h.listeners.size,0);
});

test('pauses in hidden tabs and resumes with the same budget',async()=>{
 let checks=0;const h=harness({check:async()=>{checks++;return false;},maxAttempts:2});
 h.visibility(true);h.monitor.start();assert.equal(h.tasks.size,0);
 h.visibility(false);await h.tick();assert.equal(checks,1);
 h.visibility(true);assert.equal(h.tasks.size,0);
 h.visibility(false);await h.tick();assert.equal(checks,2);assert.equal(h.tasks.size,0);
});

test('no overlapping reads when repeatedly woken while a check is pending',async()=>{
 let done,checks=0;const h=harness({check:()=>{checks++;return new Promise(resolve=>{done=resolve;});}});
 h.monitor.start();const pending=h.tick();
 h.monitor.wake();await h.tick();h.monitor.wake();await h.tick();
 assert.equal(checks,1);done(false);await pending;
 assert.equal(h.tasks.size,1);h.monitor.stop();
});

test('account, signer or provider mismatch stops before making a read',async()=>{
 let checks=0;const h=harness({check:async()=>{checks++;},isCurrent:()=>false});
 h.monitor.start();await h.tick();assert.equal(checks,0);assert.equal(h.tasks.size,0);
});

test('stopping an in-flight check cannot schedule another check after completion',async()=>{
 let done;const h=harness({check:()=>new Promise(resolve=>{done=resolve;})});
 h.monitor.start();const pending=h.tick();h.monitor.stop();done(false);await pending;
 assert.equal(h.tasks.size,0);assert.equal(h.listeners.size,0);
});

test('a temporary read failure consumes one attempt and preserves the retry budget',async()=>{
 let checks=0;const h=harness({check:async()=>{checks++;throw Error('RPC unavailable');},maxAttempts:2});
 h.monitor.start();await h.tick();await h.tick();
 assert.equal(checks,2);assert.equal(h.tasks.size,0);
});

test('a hidden tab during a read does not start another read until visible',async()=>{
 let done,checks=0;const h=harness({check:()=>{checks++;return new Promise(resolve=>{done=resolve;});}});
 h.monitor.start();const pending=h.tick();h.visibility(true);done(false);await pending;
 assert.equal(checks,1);assert.equal(h.tasks.size,0);
 h.visibility(false);assert.equal(h.tasks.size,1);h.monitor.stop();
});

test('rejects unbounded or excessively frequent configurations',()=>{
 for(const value of [{maxAttempts:Infinity},{maxAttempts:0},{interval:0},{check:null}])
  assert.throws(()=>harness(value),/Invalid pending monitor/);
});
