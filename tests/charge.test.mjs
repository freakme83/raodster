import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,CONFIG} from '../src/physics.js';
import {CHARGE,ARC_SHAPES,spawnChargeArc,advanceCharge} from '../src/charge.js';
import {AudioEngine} from '../src/audio.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} !== ${expected}`);
const isolated=seed=>{const g=createGame(seed);g.spawnIn=Infinity;g.nextChargeArcAt=Infinity;return g;};

test('charge drains in fixed steps, ends the run at zero, and freezes after death',()=>{
  const g=isolated(7);assert.equal(g.charge,1);assert.equal(g.pressure,1);
  for(let i=0;i<120;i++)step(g,{});
  close(g.charge,1-1/40);assert.equal(g.dead,false);
  while(!g.dead)step(g,{});
  assert.equal(g.reason,'OUT OF CHARGE');assert.equal(g.charge,0);
  assert.ok(Math.abs(g.time-40)<CONFIG.step*2);
  assert.equal(g.events.filter(e=>e.type==='crash').length,1);
  const snapshot={time:g.time,distance:g.distance,charge:g.charge};step(g,{thrust:true});assert.deepEqual({time:g.time,distance:g.distance,charge:g.charge},snapshot);
});

test('airborne pickups restore charge immediately, never pressure, and allow partial arcs',()=>{
  const g=isolated(4);g.time=20;g.grounded=false;g.speed=50;g.charge=.2;g.pressure=.4;
  assert.equal(spawnChargeArc(g),true);const arc=g.chargeArcs[0];
  for(let i=0;i<3;i++){
    const orb=arc.orbs[i];orb.z=0;g.x=orb.x;g.y=orb.y;
    const before=g.charge;advanceCharge(g,CONFIG.step);
    close(g.charge,before-CHARGE.drainPerSecond*CONFIG.step+CHARGE.perOrb);
    assert.equal(orb.collected,true);assert.equal(arc.collected,i+1);
  }
  assert.equal(g.pressure,.4);assert.equal(g.events.filter(e=>e.type==='fullArc').length,0);
  for(let i=3;i<6;i++){const orb=arc.orbs[i];orb.z=0;g.x=orb.x;g.y=orb.y;advanceCharge(g,CONFIG.step);}
  assert.equal(arc.collected,6);assert.equal(arc.completed,true);
  assert.equal(g.events.filter(e=>e.type==='orb').length,6);
  assert.deepEqual(g.events.filter(e=>e.type==='orb').map(e=>e.chain),[1,2,3,4,5,6]);
  assert.equal(g.events.filter(e=>e.type==='fullArc').length,1);
  advanceCharge(g,CONFIG.step);assert.equal(g.events.filter(e=>e.type==='fullArc').length,1);
  g.charge=.99;g.orbPops.length=0;g.chargeArcs.length=0;spawnChargeArc(g);
  const fresh=g.chargeArcs[0].orbs[0];fresh.z=0;g.x=fresh.x;g.y=fresh.y;advanceCharge(g,CONFIG.step);
  assert.equal(g.charge,1,'charge cannot overfill');
});

test('collection needs a real airborne overlap, missed orbs stay missed, and arcs clean up',()=>{
  const g=isolated(8);g.time=20;g.speed=55;spawnChargeArc(g);const arc=g.chargeArcs[0],orb=arc.orbs[0];
  orb.z=0;g.x=orb.x;g.y=0;advanceCharge(g,CONFIG.step);assert.equal(orb.collected,false,'driving underneath does not collect');
  g.grounded=false;g.y=orb.y;g.x=orb.x+CHARGE.pickupX+.1;advanceCharge(g,CONFIG.step);assert.equal(orb.collected,false);
  g.x=orb.x;g.y=orb.y+CHARGE.pickupY+.1;advanceCharge(g,CONFIG.step);assert.equal(orb.collected,false);
  g.y=orb.y;orb.z=CHARGE.pickupZ+g.speed*CONFIG.step+.2;advanceCharge(g,CONFIG.step);assert.equal(orb.collected,false);
  orb.z=0;advanceCharge(g,CONFIG.step);assert.equal(orb.collected,true);
  advanceCharge(g,CONFIG.step);assert.equal(arc.collected,1,'a consumed orb cannot pay twice');
  const missed=arc.orbs[1];missed.z=-CHARGE.pickupZ-1;advanceCharge(g,CONFIG.step);assert.equal(missed.missed,true);
  missed.z=0;g.x=missed.x;g.y=missed.y;advanceCharge(g,CONFIG.step);assert.equal(arc.collected,1);
  arc.orbs.at(-1).z=-30;advanceCharge(g,CONFIG.step);assert.equal(g.chargeArcs.length,0);
  for(let i=0;i<35;i++)advanceCharge(g,CONFIG.step);
  assert.equal(g.orbPops.length,0);
});

test('all four six-orb shapes are elevated, smooth, and stay over the road',()=>{
  const seen=new Set();
  for(let seed=0;seed<80;seed++){
    const g=isolated(seed);g.time=20;g.speed=55;spawnChargeArc(g);
    g.nextChargeArcId=1;for(let i=0;i<8;i++)spawnChargeArc(g);
    for(const arc of g.chargeArcs){
      seen.add(arc.shape);assert.equal(arc.orbs.length,CHARGE.orbsPerArc);
      for(const orb of arc.orbs){assert.ok(orb.y>=2.1);assert.ok(Math.abs(orb.x)<=3.4+1e-8);}
      for(let i=1;i<arc.orbs.length;i++){
        const a=arc.orbs[i-1],b=arc.orbs[i];
        assert.ok(b.z>a.z&&Math.abs(b.x-a.x)<1.8&&Math.abs(b.y-a.y)<1.6);
      }
    }
  }
  assert.deepEqual([...seen].sort(),[...ARC_SHAPES].sort());
});

test('a simple six-orb arc can be cleared with the existing thrust and landing physics',()=>{
  const g=isolated(12);g.time=25;g.speed=60;g.distance=1000;g.chargeRandom=()=>.1;
  g.lane=-1;g.x=-3.4;g.charge=.5;spawnChargeArc(g);
  let launched=false,launchTime=0;
  for(let i=0;i<500&&!g.dead;i++){
    if(!launched&&g.chargeArcs[0]?.orbs[0]?.z<40){launched=true;launchTime=g.time;}
    const elapsed=g.time-launchTime;
    const thrust=launched&&(elapsed<.75||(!g.grounded&&g.y<1.7&&g.vy< -6&&g.pressure>.2));
    step(g,{thrust});
    if(launched&&g.grounded&&elapsed>1.2)break;
  }
  assert.equal(g.dead,false);assert.equal(g.grounded,true);
  assert.equal(g.events.filter(e=>e.type==='orb').length,6);
  assert.equal(g.events.filter(e=>e.type==='fullArc').length,1);
  assert.ok(g.pressure>.2,'the arc requires only the existing pressure tank');
});

test('seeded schedules supply recurring theoretical charge without changing traffic randomness',()=>{
  const shapes=new Set(),firstTimes=[],gaps=[];let mixedTraffic=0;
  for(let seed=0;seed<100;seed++){
    const g=createGame(seed),same=createGame(seed),seen=new Set(),arrivals=new Set(),schedule=[];
    g.grounded=same.grounded=false;same.nextChargeArcAt=Infinity;let potential=1,lowest=1;
    for(let i=0;i<120/CONFIG.step;i++){
      g.y=same.y=100;g.charge=same.charge=1;step(g,{});step(same,{});potential-=CHARGE.drainPerSecond*CONFIG.step;
      assert.equal(g.dead,false);
      if(g.time<10)assert.equal(g.nextChargeArcId,0);
      for(const arc of g.chargeArcs){
        if(!seen.has(arc.id)){
          seen.add(arc.id);schedule.push({time:arc.spawnTime,shape:arc.shape,orbs:arc.orbs.map(o=>({x:o.x,y:o.y,z:o.z}))});
          shapes.add(arc.shape);
          if(g.traffic.some(v=>v.z>arc.orbs[0].z-25&&v.z<arc.orbs.at(-1).z+25))mixedTraffic++;
        }
        if(!arrivals.has(arc.id)&&arc.orbs[0].z<0){arrivals.add(arc.id);potential=Math.min(1,potential+CHARGE.perOrb*CHARGE.orbsPerArc);}
        const first=arc.orbs[0].z,last=arc.orbs.at(-1).z;
        if(first>-30&&last<330)for(const wall of g.traffic.filter(v=>v.wall&&v.lane===0))
          assert.ok(wall.z<=first-75||wall.z>=last+75,`arc entered a wall recovery zone: seed ${seed}, ${g.time.toFixed(1)}s`);
      }
      lowest=Math.min(lowest,potential);g.events.length=0;
    }
    assert.ok(lowest>.25,`insufficient charge opportunity for seed ${seed}: ${lowest}`);
    assert.ok(schedule.length>=10);
    assert.ok(schedule[0].time>=10&&schedule[0].time<=15);
    assert.ok(schedule[1].time<30,'a second opportunity should precede empty charge');
    assert.deepEqual(g.traffic,same.traffic,'arcs must not alter traffic generation or motion');
    firstTimes.push(schedule[0].time);
    for(let i=1;i<schedule.length;i++)gaps.push(schedule[i].time-schedule[i-1].time);
    // The charge stream must not advance the traffic generator.
    for(let i=0;i<8;i++)assert.equal(g.random(),same.random());
    const again=createGame(seed);again.grounded=false;const repeated=[];
    for(let i=0;i<120/CONFIG.step;i++){
      again.y=100;again.charge=1;step(again,{});
      for(const arc of again.chargeArcs)if(repeated.length<=arc.id)repeated.push({time:arc.spawnTime,shape:arc.shape,orbs:arc.orbs.map(o=>({x:o.x,y:o.y,z:o.z}))});
    }
    assert.deepEqual(repeated.map(({time,shape,orbs})=>({time,shape,orbs:orbs.map(({x,y})=>({x,y}))})),schedule.map(({time,shape,orbs})=>({time,shape,orbs:orbs.map(({x,y})=>({x,y}))})));
  }
  assert.deepEqual([...shapes].sort(),[...ARC_SHAPES].sort());
  assert.ok(Math.max(...firstTimes)-Math.min(...firstTimes)>4);
  assert.ok(Math.max(...gaps)-Math.min(...gaps)>4);
  assert.ok(mixedTraffic>50,'charge arcs should often share the forward view with traffic');
});

test('low-charge audio warns once and successive pickups rise gently in pitch',()=>{
  const g=isolated(5);g.charge=CHARGE.lowThreshold+.0001;
  advanceCharge(g,.1);advanceCharge(g,.1);
  assert.equal(g.events.filter(e=>e.type==='lowCharge').length,1);
  const audio=new AudioEngine(),tones=[];audio.tone=f=>tones.push(f);
  for(let chain=1;chain<=6;chain++)audio.event({type:'orb',chain});
  assert.ok(tones[0]<tones[2]&&tones[2]<tones[4]&&tones[8]<tones[10]);
});
