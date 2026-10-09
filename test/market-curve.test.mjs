import test from 'node:test';
import assert from 'node:assert/strict';
import {chartGeometry} from '../frontend/market-series.js';
test('curved chart preserves observed endpoints and bounded control points',()=>{
 const g=chartGeometry([{time:1,price:1},{time:2,price:3},{time:3,price:2}]);
 assert.equal((g.line.match(/C/g)||[]).length,2);assert.equal(g.change,100);
 const commands=g.line.split(' C');
 for(let i=1;i<commands.length;i++){
  const [cx1,cy1,cx2,cy2,x,y]=commands[i].split(' ').map(Number);
  const [px,py]=g.xy[i-1],[nx,ny]=g.xy[i];
  assert(cx1>=px&&cx1<=nx);assert.equal(cx1,cx2);
  assert.equal(cy1,Number(py.toFixed(2)));assert.equal(cy2,Number(ny.toFixed(2)));
  assert.equal(x,Number(nx.toFixed(2)));assert.equal(y,Number(ny.toFixed(2)));
 }
 assert(!chartGeometry([{time:1,price:2}]).line.includes('C'));
 assert.equal(chartGeometry([{time:1,price:2},{time:2,price:2}]).change,0);
});
