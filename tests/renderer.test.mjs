import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer,hazardsOn} from '../src/renderer.js';
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

test('orb art keeps a compact dim halo and a matte core at preview distance',()=>{
  const r=renderer(),fills=[],colors=[],stops=[];let radii;
  r.point=()=>({x:180,y:280,s:5});r.c.fillRect=()=>{};
  r.c.createRadialGradient=(...args)=>{radii=[args[2],args[5]];return{addColorStop:(at,color)=>stops.push({at,color})};};
  r.poly=(points,color)=>{fills.push(points);colors.push(color);};
  r.chargeOrb({x:0,y:3,z:80,index:0},1);
  const radius=Math.max(...fills[0].map(p=>Math.abs(p.y-280)));
  assert.ok(radii[1]<=radius*1.45,'halo stays close to the solid orb');
  assert.ok(parseInt(stops[0].color.slice(-2),16)<.25*255,'halo opacity stays restrained');
  assert.ok(colors.every(color=>!/^#f{2}/i.test(color)),'the core is amber rather than white-hot');
  const width=Math.max(...fills[0].map(p=>p.x))-Math.min(...fills[0].map(p=>p.x));
  assert.ok(width>=6,'the silhouette remains visible at mobile preview size');
});

test('power depletion keeps the car upright and intact with synchronized amber rear hazards',()=>{
  const r=renderer(),g=createGame(3),faces=[],lights=[];
  r.playerShadow=()=>{};
  const originalBox=r.box.bind(r);
  r.box=(x,y,z,w,h,l,color,output,transform)=>{
    if(color==='#eeb65f'||color==='#584c49')lights.push({x,color,position:transform(0,.61,0)});
    return originalBox(x,y,z,w,h,l,color,output,transform);
  };
  g.dead=true;g.reason='OUT OF CHARGE';g.roll=.42;g.pitch=.18;g.impact=1;g.preload=.1;
  r.crashPose=.9;r.failureAge=.02;
  const transform=r.car({x:0,z:0,width:2.04,length:3.85,height:1.15},true,g,faces);
  assert.deepEqual(transform(1,1,1),[1,1,1],'no roll, pitch, or suspension collapse');
  assert.equal(lights.length,2);assert.deepEqual(lights.map(v=>v.color),['#eeb65f','#eeb65f']);
  assert.ok(lights[0].x===-lights[1].x,'rear lights are symmetric');
  lights.length=0;faces.length=0;r.failureAge=.16;
  r.car({x:0,z:0,width:2.04,length:3.85,height:1.15},true,g,faces);
  assert.deepEqual(lights.map(v=>v.color),['#584c49','#584c49']);
  assert.deepEqual([0,.27,.54].map(age=>hazardsOn(g,age)),[true,true,true]);
  assert.deepEqual([.16,.43,.7].map(age=>hazardsOn(g,age)),[false,false,false]);
  assert.equal(hazardsOn(g,.1,true),true,'reduced motion gives a steady hazard signal');
  lights.length=0;g.reason='TRAFFIC COLLISION';
  const collision=r.car({x:0,z:0,width:2.04,length:3.85,height:1.15},true,g,faces);
  assert.notDeepEqual(collision(1,1,1),[1,1,1],'physical impacts retain crash pose');
  assert.equal(lights.length,0,'amber hazards are only for charge failure');
});
