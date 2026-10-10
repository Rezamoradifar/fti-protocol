import test from 'node:test';
import assert from 'node:assert/strict';
import {settledPoints} from '../frontend/settled-points.js';
test('wallet initialization and disconnect render before chain data arrives',()=>{for(const state of [undefined,null,{}, {phase:1}])assert.deepEqual(settledPoints(state),{raw:null,paid:null,count:null});});
test('only completed settlement displays separate raw and paid values',()=>assert.deepEqual(settledPoints({phase:0,candidatePoints:'2',calculatedPointValue:'15',totalPaidPoints:'1',pointValue:'20'}),{raw:'15',paid:'20',count:'1'}));
