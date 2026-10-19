import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,moveLane,landing,spawnWave,CONFIG,TYPES,MIN_MEANINGFUL_AIRTIME} from '../src/physics.js';
const fresh=()=>{const g=createGame(19);g.spawnIn=1e9;return g;};
const run=(g,seconds,thrust=false)=>{for(let t=0;t<seconds&&!g.dead;t+=CONFIG.step)step(g,{thrust},CONFIG.step);return g;};
const vehicle=(g,options={})=>{g.traffic.push({...TYPES[0],type:0,lane:0,x:0,z:12,passed:false,...options});};
const ascentProfile=()=>{
  const g=fresh(),levels=[1.25,1.45,2.25,2.8,3.15],times={};let takeoff=null,launchVy,at25,at50,peak=0,airborneDuration=null,thrustSteps=0;
  for(let i=0;i<1200&&!g.dead;i++){
    const wasGrounded=g.grounded,thrust=takeoff===null||g.time-takeoff<.75;
    if(thrust)thrustSteps++;
    step(g,{thrust});
    if(wasGrounded&&!g.grounded){takeoff=g.time;launchVy=g.vy;}
    if(takeoff!==null&&!g.grounded){
      const elapsed=g.time-takeoff;peak=Math.max(peak,g.y);
      if(at25===undefined&&elapsed>=.25)at25=g.y;
      if(at50===undefined&&elapsed>=.5)at50=g.y;
      for(const h of levels)if(times[h]===undefined&&g.y>=h)times[h]=elapsed;
    }
    if(takeoff!==null&&g.grounded){airborneDuration=g.time-takeoff;break;}
  }
  return{takeoff,launchVy,at25,at50,times,peak,airborneDuration,thrustSteps,dead:g.dead,reason:g.reason,pressure:g.pressure};
};
const laneTransition=(airborne,from,to)=>{
  const g=fresh();g.traffic=[];g.lane=from;g.x=from*CONFIG.lane;g.grounded=!airborne;g.y=airborne?2.5:0;g.vy=0;
  moveLane(g,to-from);let stableFrames=0,maxX=g.x,minX=g.x,completion=null;
  for(let i=0;i<600;i++){
    const error=Math.abs(g.x-to*CONFIG.lane);
    stableFrames=error<=.12&&Math.abs(g.vx)<=.35?stableFrames+1:0;
    if(stableFrames===6){completion=g.time;break;}
    const thrust=airborne&&(g.y<2.45||(g.y<2.65&&g.vy<0));
    step(g,{thrust});maxX=Math.max(maxX,g.x);minX=Math.min(minX,g.x);
  }
  return{completion,dead:g.dead,reason:g.reason,overshoot:to===1?Math.max(0,maxX-CONFIG.lane):to===-1?Math.max(0,-CONFIG.lane-minX):Math.max(0,Math.max(maxX-CONFIG.lane,-CONFIG.lane-minX)),g};
};

test('distance progresses smoothly and pressure recovers only on the ground',()=>{const g=fresh();g.pressure=.2;run(g,1);assert.ok(g.distance>26&&g.distance<29);assert.ok(g.pressure>.5);g.grounded=false;g.y=8;g.vy=0;const p=g.pressure;run(g,.2);assert.equal(g.pressure,p);});
test('ground launch applies one vertical impulse after the unchanged preload',()=>{
  const g=fresh();
  for(let i=0;i<12;i++)step(g,{thrust:true});
  assert.equal(g.grounded,true);assert.ok(Math.abs(g.preload-12*CONFIG.step)<1e-12);assert.equal(g.events.filter(e=>e.type==='launch').length,0);
  step(g,{thrust:true});
  assert.equal(g.grounded,true);assert.equal(g.events.filter(e=>e.type==='launch').length,0);
  step(g,{thrust:true});
  assert.equal(g.grounded,false);assert.equal(g.events.filter(e=>e.type==='launch').length,1);
  assert.ok(g.vy>=CONFIG.launchBoost&&g.vy<CONFIG.launchBoost+.2);
  assert.ok(Math.abs(g.pressure-(1-CONFIG.drain*14*CONFIG.step))<1e-9,'launch impulse does not refill pressure');
  const launchVy=g.vy,pressure=g.pressure;
  run(g,.25,true);
  assert.equal(g.events.filter(e=>e.type==='launch').length,1);assert.ok(g.vy>launchVy);assert.ok(g.pressure<pressure);
});
test('short taps cannot repeat the launch impulse and each real takeoff can receive it',()=>{
  const taps=fresh();run(taps,.1,true);run(taps,.1,false);run(taps,.1,true);assert.equal(taps.grounded,true);assert.equal(taps.events.filter(e=>e.type==='launch').length,0);
  const g=fresh();run(g,.2,true);assert.equal(g.events.filter(e=>e.type==='launch').length,1);run(g,2,false);assert.equal(g.grounded,true);assert.equal(g.dead,false);
  run(g,.25,true);assert.equal(g.events.filter(e=>e.type==='launch').length,2);assert.equal(g.grounded,false);assert.ok(g.vy>=CONFIG.launchBoost);
});
test('launch boost improves measured early ascent without an excessive flight envelope change',()=>{
  const p=ascentProfile(),baseline={takeoff:14*CONFIG.step,at25:.4373088218,at50:1.5192744117,times:{1.25:.45,1.45:.4916666667,2.25:.6333333333,2.8:.7166666667,3.15:.7666666667},peak:4.6128195454,airborneDuration:2.15};
  assert.equal(p.dead,false);assert.equal(p.reason,null);assert.ok(Math.abs(p.takeoff-baseline.takeoff)<1e-9);
  assert.equal(CONFIG.launchBoost,1.5);assert.ok(p.launchVy>=CONFIG.launchBoost&&p.launchVy<CONFIG.launchBoost+.2);
  assert.ok(p.at25>baseline.at25&&p.at50>baseline.at50);
  for(const h of[1.25,1.45,2.25,2.8,3.15])assert.ok(p.times[h]<baseline.times[h],`${h} m: ${p.times[h]} not before ${baseline.times[h]}`);
  assert.ok(p.peak<baseline.peak*1.2,`peak increased to ${p.peak}`);assert.ok(p.airborneDuration<baseline.airborneDuration*1.08);
  assert.ok(Math.abs(p.pressure-(1-CONFIG.drain*p.thrustSteps*CONFIG.step))<1e-9);
});
test('lane transitions are about twelve percent faster with the same settling criterion',()=>{
  const directions=[[-1,0],[0,1],[1,0],[0,-1]],baseline={ground:.7666666667,air:1.0833333333};
  for(const airborne of[false,true]){
    const results=directions.map(([from,to])=>laneTransition(airborne,from,to));
    for(const result of results){assert.ok(result.completion>0);assert.equal(result.dead,false);assert.ok(Math.abs(result.g.x-result.g.lane*CONFIG.lane)<=.12);assert.ok(Math.abs(result.g.vx)<=.35);assert.ok(result.overshoot<.1);}
    const average=results.reduce((sum,result)=>sum+result.completion,0)/results.length;
    const reduction=1-average/(airborne?baseline.air:baseline.ground);
    assert.ok(reduction>=.10&&reduction<=.12,`${airborne?'air':'ground'} transition reduction ${(reduction*100).toFixed(2)}%`);
  }
  assert.equal(CONFIG.lane,3.4);
});
test('launching and steering remain independent through ascent and descent',()=>{
  const noSteer=fresh(),steer=fresh();moveLane(steer,1);
  for(let i=0;i<18;i++){step(noSteer,{thrust:true});step(steer,{thrust:true});}
  assert.ok(steer.y>0&&steer.grounded===false);assert.ok(Math.abs(steer.vy-noSteer.vy)<1e-9);
  const launches=steer.events.filter(e=>e.type==='launch').length;moveLane(steer,-1);run(steer,.3,true);assert.equal(steer.events.filter(e=>e.type==='launch').length,launches);assert.ok(steer.thrusting);
  run(steer,3,false);assert.equal(steer.dead,false);assert.equal(steer.grounded,true);
  moveLane(steer,1);run(steer,.2,true);assert.equal(steer.grounded,false);moveLane(steer,-1);run(steer,.25,true);moveLane(steer,1);
  assert.equal(steer.events.filter(e=>e.type==='launch').length,2);run(steer,5,false);assert.notEqual(steer.reason,'HARD LANDING');
});
test('a hold first unloads suspension, then continuously accelerates upward',()=>{const g=fresh();run(g,.05,true);assert.equal(g.y,0);assert.ok(g.preload>0);run(g,.3,true);assert.ok(g.y>.25);assert.ok(g.vy>2);const v=g.vy;run(g,.2,true);assert.ok(g.vy>v);run(g,.2,false);assert.ok(g.vy<v+3);});
test('longer holds produce higher jumps rather than a fixed impulse',()=>{const a=fresh(),b=fresh();run(a,.3,true);run(b,.65,true);let ah=a.y,bh=b.y;for(let i=0;i<240;i++){step(a,{thrust:false});step(b,{thrust:false});ah=Math.max(ah,a.y);bh=Math.max(bh,b.y);}assert.ok(bh>ah*2);});
test('a small hop lands safely without jump feedback and ground pressure restores',()=>{const g=fresh();run(g,.18,true);run(g,1.5);assert.equal(g.dead,false);assert.equal(g.grounded,true);const event=g.events.find(e=>e.type==='landing');assert.ok(event);assert.ok(g.airTime<MIN_MEANINGFUL_AIRTIME);assert.equal(event.meaningfulJump,false);assert.equal(event.quality,'safe');run(g,3);assert.equal(g.pressure,1);});
test('spending the tank during launch creates a hard-landing failure',()=>{const g=fresh();run(g,2.5,true);assert.ok(g.pressure<.01);run(g,8);assert.equal(g.reason,'HARD LANDING');});
test('a late thrust burst meaningfully slows descent',()=>{const a=fresh(),b=fresh();for(const g of[a,b]){g.y=3;g.vy=-6;g.grounded=false;}run(a,.2);run(b,.2,true);assert.ok(b.vy-a.vy>4.8);assert.ok(b.y>a.y);});
test('meaningful airtime gates perfect and car-jump feedback without changing landing safety',()=>{
  for(const [airTime,fall,deg,quality] of [[.99,3,2,'safe'],[1.01,3,2,'perfect'],[1.2,6,10,'safe'],[.2,8,20,'rough'],[1.2,8,20,'rough'],[.2,3,26,'LANDED SIDEWAYS'],[1.2,12,0,'HARD LANDING']]){
    const g=fresh();g.airTime=airTime;g.vy=-fall;g.roll=deg*Math.PI/180;g.jumpPasses=2;landing(g);
    assert.equal(g.dead?g.reason:g.events.at(-1).quality,quality);
    if(!g.dead){assert.equal(g.events.at(-1).meaningfulJump,airTime>=MIN_MEANINGFUL_AIRTIME);assert.equal(g.events.at(-1).passed,2);}
  }
});
test('lane movement is smooth, clamped, and settles without a random road exit',()=>{const g=fresh();moveLane(g,1);assert.equal(g.x,0);run(g,.15);assert.ok(g.x>0&&g.x<3.4);run(g,1);assert.ok(Math.abs(g.x-3.4)<.02);moveLane(g,1);assert.equal(g.lane,1);assert.equal(g.dead,false);});
test('air steering is slower and still returns to level when input stops',()=>{const g=fresh();g.y=20;g.grounded=false;moveLane(g,1);run(g,.2);assert.ok(g.x>0&&g.x<1.5);assert.ok(Math.abs(g.roll)>0);run(g,.8,true);assert.ok(Math.abs(g.roll)<.15);});
test('leaving road ends the run even when airborne',()=>{const g=fresh();g.x=5;g.y=5;g.grounded=false;step(g,{});assert.equal(g.reason,'OFF THE ROAD');});
test('traffic collision uses lane, longitudinal footprint, and roof height',()=>{const a=fresh();vehicle(a,{z:2});step(a,{});assert.equal(a.reason,'TRAFFIC COLLISION');const b=fresh();vehicle(b,{z:2});b.y=3;b.grounded=false;step(b,{});assert.equal(b.dead,false);const c=fresh();vehicle(c,{z:2,x:3.4});step(c,{});assert.equal(c.dead,false);});
test('descending onto a truck roof is a collision, not a safe ground landing',()=>{const g=fresh();vehicle(g,{...TYPES[5],z:0});g.y=3.16;g.vy=-8;g.grounded=false;step(g,{});assert.equal(g.reason,'TRAFFIC COLLISION');});
test('swept longitudinal overlap prevents fast vehicles passing through the player',()=>{const g=fresh();g.distance=100000;vehicle(g,{z:4});run(g,.2);assert.equal(g.reason,'TRAFFIC COLLISION');});
test('crashes freeze score and fresh runs reset all gameplay state',()=>{const g=fresh();vehicle(g,{z:0});step(g,{});const d=g.distance;run(g,2,true);assert.equal(g.distance,d);const n=createGame(1);assert.equal(n.distance,0);assert.equal(n.pressure,1);assert.equal(n.dead,false);assert.equal(n.traffic.length,0);});
test('seeded traffic is repeatable and every non-wall leaves a lane open',()=>{for(let seed=0;seed<100;seed++){const a=createGame(seed),b=createGame(seed);a.distance=b.distance=4500;a.time=b.time=80;for(let i=0;i<8;i++){spawnWave(a);spawnWave(b);}assert.deepEqual(a.traffic,b.traffic);for(let wave=0;wave<8;wave++){const vs=a.traffic.filter(v=>v.wave===wave);if(vs[0].wall){assert.equal(vs.length,3);assert.ok(vs.every(v=>v.height<=1.25&&v.length<=4));assert.equal(new Set(vs.map(v=>v.lane)).size,3);}else assert.ok(new Set(vs.map(v=>v.lane)).size<3);}}});
test('an all-lane wall can be jumped and landed using a partial launch and braking pulse',()=>{const g=fresh();g.time=60;g.distance=2500;for(const lane of[-1,0,1])vehicle(g,{lane,x:lane*3.4,z:55});let crossed=false,apex=0;for(let i=0;i<900&&!g.dead;i++){const shouldLaunch=g.time-60<.72;const brake=!g.grounded&&g.vy<-3.2&&g.y<g.vy*g.vy/28+.7;step(g,{thrust:shouldLaunch||brake});apex=Math.max(apex,g.y);if(g.events.some(e=>e.type==='airpass'))crossed=true;if(crossed&&g.grounded)break;}assert.equal(g.dead,false,g.reason);assert.ok(crossed);assert.ok(apex>1.5);assert.equal(g.grounded,true);assert.ok(g.pressure>.15);});
