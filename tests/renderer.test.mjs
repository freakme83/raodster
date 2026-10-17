import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer} from '../src/renderer.js';
import {createGame} from '../src/physics.js';

function renderer(){
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},createLinearGradient(){return{addColorStop(){}};}};
  return new Renderer({getContext:()=>ctx});
}

test('lateral jets fire opposite airborne correction but never on the ground',()=>{
  const r=renderer(),bursts=[];
  r.point=(x,y)=>({x,y,s:1});r.poly=points=>bursts.push(points);
  const transform=(x,y,z)=>[x,y,z],g=createGame(3);
  g.vx=-5;g.roll=.1;g.rollV=.5;
  r.lateralJets(g,transform);assert.equal(bursts.length,0);
  g.grounded=false;r.lateralJets(g,transform);
  assert.equal(bursts.length,1);assert.ok(bursts[0][0].x>0,'left correction fires from the right');
  g.vx=5;g.roll=-.1;g.rollV=-.5;r.lateralJets(g,transform);
  assert.equal(bursts.length,2);assert.ok(bursts[1][0].x<0,'right correction fires from the left');
  g.vx=0;g.roll=.1;g.rollV=-1;r.lateralJets(g,transform);
  assert.equal(bursts.length,3);assert.ok(bursts[2][0].x<0,'airborne roll correction remains visible');
  g.grounded=true;r.lateralJets(g,transform);assert.equal(bursts.length,3);
});

test('player shadow follows a tapered road footprint and fades with height',()=>{
  const r=renderer(),shadows=[];
  r.world=(points,color)=>shadows.push({points,color,blur:r.c.shadowBlur});
  const g=createGame(3),car={x:0,z:0,width:2.04,length:3.85};
  r.playerShadow(car,g);g.y=4;r.playerShadow(car,g);
  const [near,high]=shadows;
  const span=(points,axis)=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]));
  const alpha=color=>Number(color.match(/,([\d.]+)\)$/)[1]);
  assert.ok(span(near.points,2)>span(near.points,0)*1.5);
  assert.ok(new Set(near.points.map(p=>Math.abs(p[0]))).size>2,'the outline tapers rather than forming an ellipse');
  assert.ok(near.points.every(p=>p[1]===.08)&&high.points.every(p=>p[1]===.08));
  assert.ok(alpha(high.color)<alpha(near.color));
  assert.ok(high.blur>near.blur&&span(high.points,0)>span(near.points,0));
});
