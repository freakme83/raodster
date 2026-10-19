import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,moveLane,speedAt,CONFIG} from '../src/physics.js';
import {CHARGE,ARC_SHAPES,spawnChargeArc,advanceCharge} from '../src/charge.js';
import {AudioEngine} from '../src/audio.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} !== ${expected}`);
const isolated=seed=>{const g=createGame(seed);g.spawnIn=Infinity;g.nextChargeArcAt=Infinity;return g;};

test('eight-percent orbs pay exactly once, partial rewards persist, and FULL ARC gives no bonus',()=>{
  close(CHARGE.drainPerSecond,1/40);close(CHARGE.perOrb,.08);
  assert.deepEqual(CHARGE.repeatArcWindow,[7.8,10.6]);
  const g=isolated(21);g.time=20;g.speed=60;g.charge=.1;g.grounded=false;
  spawnChargeArc(g);const arc=g.chargeArcs[0];
  for(let i=0;i<3;i++){
    const orb=arc.orbs[i];g.x=orb.x;g.y=orb.y;orb.z=0;
    advanceCharge(g,0);close(g.charge,.1+.08*(i+1));
    advanceCharge(g,0);close(g.charge,.1+.08*(i+1));
  }
  close(g.charge,.34);assert.equal(arc.collected,3);
  assert.equal(g.events.filter(e=>e.type==='fullArc').length,0);
  for(let i=3;i<6;i++){
    const orb=arc.orbs[i];g.x=orb.x;g.y=orb.y;orb.z=0;advanceCharge(g,0);
  }
  close(g.charge,.58);assert.equal(arc.collected,6);
  assert.equal(g.events.filter(e=>e.type==='orb').length,6);
  assert.equal(g.events.filter(e=>e.type==='fullArc').length,1);
  advanceCharge(g,0);close(g.charge,.58);
  g.charge=.97;g.chargeArcs=[];spawnChargeArc(g);
  const next=g.chargeArcs[0].orbs[0];g.x=next.x;g.y=next.y;next.z=0;
  advanceCharge(g,0);close(g.charge,1);
});

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
  missed.z=0;g.x=missed.x;g.y=missed.y;
  const afterMiss=g.charge;advanceCharge(g,0);
  assert.equal(arc.collected,1);close(g.charge,afterMiss);
  arc.orbs.at(-1).z=-30;advanceCharge(g,CONFIG.step);assert.equal(g.chargeArcs.length,0);
  for(let i=0;i<35;i++)advanceCharge(g,CONFIG.step);
  assert.equal(g.orbPops.length,0);
});

test('the airborne body collects below the orb center, while clear vertical and side misses do not',()=>{
  const g=isolated(9);g.time=20;g.speed=70;spawnChargeArc(g);
  const [body,above,side]=g.chargeArcs[0].orbs;
  g.grounded=false;g.y=.3;g.x=body.x;body.z=0;
  advanceCharge(g,CONFIG.step);assert.equal(body.collected,false,'a ground-adjacent hop cannot skim an elevated arc');
  g.y=body.y-CHARGE.pickupCenterY-CHARGE.pickupY+.2;g.vy=0;g.lane=Math.round(body.x/CONFIG.lane);g.charge=.4;
  body.z=1.3;const before=g.charge;step(g,{});
  assert.equal(body.collected,true,'the roof/body overlaps although the base lies below the old pickup radius');
  close(g.charge,before-CHARGE.drainPerSecond*CONFIG.step+CHARGE.perOrb);
  assert.equal(g.events.filter(e=>e.type==='orb').length,1,'feedback fires in the same simulation step');
  above.z=0;g.x=above.x;g.y=above.y-CHARGE.pickupCenterY+CHARGE.pickupY+.2;
  advanceCharge(g,CONFIG.step);assert.equal(above.collected,false,'orb above the visible car stays out');
  side.z=0;g.y=side.y-CHARGE.pickupCenterY;g.x=side.x+CHARGE.pickupX+.2;
  advanceCharge(g,CONFIG.step);assert.equal(side.collected,false,'clear lateral miss stays out');
});

test('high-speed swept contact before the far face collects; a high-speed side miss remains missed',()=>{
  const g=isolated(10);g.time=20;g.speed=80;spawnChargeArc(g);
  const [hit,miss]=g.chargeArcs[0].orbs;
  g.grounded=false;g.y=hit.y-CHARGE.pickupCenterY-CHARGE.pickupY+.2;g.x=hit.x;g.charge=.4;
  hit.z=-CHARGE.pickupZ+g.speed*CONFIG.step*.5;
  const before=g.charge;advanceCharge(g,CONFIG.step);
  assert.ok(hit.z< -CHARGE.pickupZ,'the current-frame center already passed the pickup region');
  assert.equal(hit.collected,true);close(g.charge,before-CHARGE.drainPerSecond*CONFIG.step+CHARGE.perOrb);
  miss.z=-CHARGE.pickupZ+g.speed*CONFIG.step*.5;g.x=miss.x+CHARGE.pickupX+.12;
  advanceCharge(g,CONFIG.step);assert.equal(miss.collected,false);assert.equal(miss.missed,true);
  assert.equal(g.events.filter(e=>e.type==='orb').length,1);
});

test('ordinary arc baselines rise while their profiles and the high arc stay intact',()=>{
  const make=roll=>{
    const g=isolated(18);g.time=25;g.speed=60;g.nextChargeArcId=1;
    g.chargeRandom=(()=>{let i=0;return()=>[roll,.1][i++]??.1})();
    spawnChargeArc(g);return g.chargeArcs[0];
  };
  const simple=make(.1),cross=make(.45),high=make(.65),greedy=make(.8);
  for(const arc of [simple,cross]){
    close(arc.orbs[0].y,3.3);close(arc.orbs.at(-1).y,3.3);
    close(arc.orbs[2].y,3.3+1.1*Math.sin(2*Math.PI/5));
  }
  close(greedy.orbs[0].y,3.3);close(greedy.orbs.at(-1).y,5.15);
  close(greedy.orbs[3].y,3.3+1.2*Math.sin(3*Math.PI/5)+1.85*(3/5)**2);
  close(high.orbs[0].y,3.2);close(high.orbs.at(-1).y,3.2);
  close(high.orbs[2].y,3.2+2.6*Math.sin(2*Math.PI/5));
  assert.equal(simple.orbs[0].x,simple.orbs.at(-1).x);
  close(cross.orbs.at(-1).x-cross.orbs[0].x,3.4);
  close(greedy.orbs.at(-1).x-greedy.orbs[0].x,3.4);
});

test('far-cross traverses both outer lanes smoothly in either direction',()=>{
  const make=laneRoll=>{
    const g=isolated(19);g.time=25;g.speed=60;g.nextChargeArcId=1;
    g.chargeRandom=(()=>{let i=0;return()=>[.95,laneRoll][i++]??.1})();
    spawnChargeArc(g);return g.chargeArcs[0];
  };
  const left=make(.1),right=make(.9);
  for(const [arc,start,end] of [[left,-3.4,3.4],[right,3.4,-3.4]]){
    assert.equal(arc.shape,'far-cross');assert.equal(arc.orbs.length,6);
    close(arc.orbs[0].x,start);close(arc.orbs.at(-1).x,end);
    close(arc.orbs[0].y,3.3);close(arc.orbs.at(-1).y,3.3);
    for(let i=1;i<6;i++){
      assert.ok(Math.sign(arc.orbs[i].x-arc.orbs[i-1].x)===Math.sign(end-start));
      assert.ok(Math.abs(arc.orbs[i].x-arc.orbs[i-1].x)<2.1);
      assert.ok(Math.abs(arc.orbs[i].y-arc.orbs[i-1].y)<.7);
      close(arc.orbs[i].z-arc.orbs[i-1].z,19);
    }
  }
  for(let i=0;i<6;i++){close(left.orbs[i].x,-right.orbs[i].x);close(left.orbs[i].y,right.orbs[i].y);}
  const opening=isolated(19);opening.chargeRandom=()=>.95;
  spawnChargeArc(opening);assert.equal(opening.chargeArcs[0].shape,'cross','the introductory arc stays familiar');
});

test('all five six-orb shapes are elevated, smooth, and stay over the road',()=>{
  const seen=new Set();
  for(let seed=0;seed<80;seed++){
    const g=isolated(seed);g.time=20;g.speed=55;spawnChargeArc(g);
    g.nextChargeArcId=1;for(let i=0;i<8;i++)spawnChargeArc(g);
    for(const arc of g.chargeArcs){
      seen.add(arc.shape);assert.equal(arc.orbs.length,CHARGE.orbsPerArc);
      for(const orb of arc.orbs){assert.ok(orb.y>=2.7);assert.ok(Math.abs(orb.x)<=3.4+1e-8);}
      for(let i=1;i<arc.orbs.length;i++){
        const a=arc.orbs[i-1],b=arc.orbs[i];
        assert.ok(b.z>a.z&&Math.abs(b.x-a.x)<(arc.shape==='far-cross'?2.1:1.8)&&Math.abs(b.y-a.y)<1.6);
      }
    }
  }
  assert.deepEqual([...seen].sort(),[...ARC_SHAPES].sort());
});

test('orb heights clear projected truck roofs without reserving a safe landing lane',()=>{
  const g=isolated(16);g.time=25;g.speed=60;g.chargeRandom=()=>.1;
  const firstZ=Math.max(145,g.speed*2.65);
  g.traffic=[{x:-3.4,z:(g.speed-10)*firstZ/g.speed,width:2.4,length:11,height:3.15,worldSpeed:10,wall:false}];
  spawnChargeArc(g);const arc=g.chargeArcs[0],first=arc.orbs[0];
  assert.equal(arc.shape,'simple');assert.ok(first.y>3.45,'orb above the projected truck lifts');
  const topOfCollectorBase=first.y-CHARGE.pickupCenterY+CHARGE.pickupY;
  assert.ok(topOfCollectorBase>g.traffic[0].height+.08+.22,'an attainable pickup altitude clears the collision roof');
  assert.ok(arc.orbs.at(-1).y<first.y,'the entire lane is not turned into an elevated safe corridor');
  const unaffected=isolated(16);unaffected.time=25;unaffected.speed=60;unaffected.chargeRandom=()=>.1;
  spawnChargeArc(unaffected);
  assert.ok(first.y>unaffected.chargeArcs[0].orbs[0].y);
  assert.equal(g.traffic.length,1,'traffic itself is untouched');
});

test('a simple six-orb arc can be cleared with the existing thrust and landing physics',()=>{
  const g=isolated(12);g.time=25;g.speed=60;g.distance=1000;g.chargeRandom=()=>.1;
  g.lane=-1;g.x=-3.4;g.charge=.5;spawnChargeArc(g);
  let launched=false,launchTime=0;
  for(let i=0;i<600&&!g.dead;i++){
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

test('a high arc is reachable with the existing launch preload, thrust, gravity, and tank',()=>{
  const g=isolated(12);g.time=25;g.speed=60;g.distance=1000;g.chargeRandom=()=>.7;
  g.nextChargeArcId=1;g.lane=1;g.x=3.4;g.charge=.5;spawnChargeArc(g);
  assert.equal(g.chargeArcs[0].shape,'high');
  assert.ok(g.chargeArcs[0].orbs[2].y>5.6,'the crest is distinct from ordinary arcs');
  let launched=false,launchTime=0;
  for(let i=0;i<600&&!g.dead;i++){
    if(!launched&&g.chargeArcs[0]?.orbs[0]?.z<40){launched=true;launchTime=g.time;}
    const elapsed=g.time-launchTime;
    const thrust=launched&&(elapsed<.75||(!g.grounded&&g.y<1.7&&g.vy< -6&&g.pressure>.2));
    step(g,{thrust});
    if(launched&&g.grounded&&elapsed>1.2)break;
  }
  assert.equal(g.dead,false);assert.equal(g.grounded,true);
  assert.equal(g.events.filter(e=>e.type==='orb').length,6);
  assert.ok(g.pressure>.2,'the existing tank can reach the crest and land');
});

test('high arc spacing permits the same physical climb near the speed ceiling',()=>{
  const g=isolated(12);g.time=110;g.speed=speedAt(g.time);g.distance=5000;g.chargeRandom=()=>.7;
  g.nextChargeArcId=1;g.lane=1;g.x=3.4;spawnChargeArc(g);
  let launched=false,launchTime=0;
  for(let i=0;i<900&&!g.dead;i++){
    if(!launched&&g.chargeArcs[0]?.orbs[0]?.z<65){launched=true;launchTime=g.time;}
    const elapsed=g.time-launchTime;
    step(g,{thrust:launched&&(elapsed<.75||(!g.grounded&&g.y<1.7&&g.vy<-6&&g.pressure>.2))});
    if(launched&&g.grounded&&elapsed>1.2)break;
  }
  assert.equal(g.dead,false);assert.equal(g.grounded,true);
  assert.equal(g.events.filter(e=>e.type==='orb').length,6);
  assert.ok(g.pressure>.2);
});

test('raised cross and greedy arcs remain fully collectable using unchanged flight physics',()=>{
  for(const [shape,roll,startLane,steerAt] of [['cross',.45,-1,0],['greedy',.8,0,-20]])for(const seconds of [25,110]){
    const g=isolated(77);g.time=seconds;g.speed=speedAt(seconds);g.distance=g.speed*seconds;
    g.nextChargeArcId=1;g.chargeRandom=(()=>{let i=0;return()=>[roll,.1][i++]??.1})();
    g.lane=startLane;g.x=startLane*CONFIG.lane;spawnChargeArc(g);
    const arc=g.chargeArcs[0];assert.equal(arc.shape,shape);
    let launched=false,launchTime=0,steered=false;
    for(let i=0;i<650&&!g.dead;i++){
      const z=arc.orbs[0].z;
      if(!launched&&z<(seconds<60?35:45)){launched=true;launchTime=g.time;}
      if(!steered&&z<steerAt){moveLane(g,1);steered=true;}
      const elapsed=g.time-launchTime;
      const pulse=shape==='cross'?(seconds<60?.65:.6):(seconds<60?.75:.7);
      step(g,{thrust:launched&&(elapsed<pulse||(!g.grounded&&g.y<1.7&&g.vy< -6&&g.pressure>.2))});
      if(z<-120)break;
    }
    assert.equal(g.dead,false,`${shape} at ${seconds}s remains survivable`);
    assert.equal(arc.collected,6,`${shape} at ${seconds}s can be fully collected`);
    assert.equal(g.events.filter(e=>e.type==='fullArc').length,1);
  }
});

test('far-cross can be fully flown in both directions at mid-run and near-ceiling speeds',()=>{
  for(const seconds of [25,110])for(const lane of [-1,1]){
    const g=isolated(77);g.time=seconds;g.speed=speedAt(seconds);g.distance=g.speed*seconds;
    g.nextChargeArcId=1;g.chargeRandom=(()=>{let i=0;return()=>[.95,lane===-1?.1:.9][i++]??.1})();
    g.lane=lane;g.x=lane*CONFIG.lane;spawnChargeArc(g);
    const arc=g.chargeArcs[0],direction=-lane;
    assert.equal(arc.shape,'far-cross');
    close(arc.orbs[1].z-arc.orbs[0].z,Math.max(19,g.speed*.3));
    let launched=false,launchTime=0,steers=0;
    for(let i=0;i<680&&!g.dead;i++){
      const z=arc.orbs[0].z;
      if(!launched&&z<(seconds<60?35:45)){launched=true;launchTime=g.time;}
      if(steers===0&&z<-10){moveLane(g,direction);steers++;}
      if(steers===1&&z< -35){moveLane(g,direction);steers++;}
      const elapsed=g.time-launchTime;
      const launchPulse=seconds<60?.7:.68;
      step(g,{thrust:launched&&(elapsed<launchPulse||(elapsed>1.55&&elapsed<2))});
      if(z< -190)break;
    }
    assert.equal(g.dead,false,`far-cross from lane ${lane} at ${seconds}s remains survivable`);
    assert.equal(steers,2);assert.equal(g.grounded,true,'the flight can end in a normal landing');
    assert.equal(arc.collected,6,`far-cross from lane ${lane} at ${seconds}s can be fully collected`);
    assert.equal(g.events.filter(e=>e.type==='fullArc').length,1);
  }
});

test('a far-cross can be abandoned after partial pickups without losing charge',()=>{
  const g=isolated(77);g.time=25;g.speed=speedAt(25);g.distance=g.speed*25;
  g.nextChargeArcId=1;g.charge=.3;g.lane=-1;g.x=-CONFIG.lane;
  g.chargeRandom=(()=>{let i=0;return()=>[.95,.1][i++]??.1})();
  spawnChargeArc(g);const arc=g.chargeArcs[0],initialTime=g.time;
  let launched=false,launchTime=0,steered=false;
  for(let i=0;i<680&&!g.dead;i++){
    const z=arc.orbs[0].z;
    if(!launched&&z<55){launched=true;launchTime=g.time;}
    if(!steered&&z<5){moveLane(g,1);steered=true;}
    const elapsed=g.time-launchTime;
    step(g,{thrust:launched&&(elapsed<.8||(elapsed>1.55&&elapsed<2))});
    if(z< -190)break;
  }
  assert.equal(g.dead,false);assert.equal(g.grounded,true);
  assert.ok(arc.collected>0&&arc.collected<6);
  close(g.charge,.3-(g.time-initialTime)*CHARGE.drainPerSecond+arc.collected*CHARGE.perOrb);
  assert.equal(arc.completed,false);assert.equal(g.events.filter(e=>e.type==='fullArc').length,0);
});

test('far-cross never extends into an existing jump-wall recovery zone',()=>{
  const g=isolated(4);g.time=25;g.speed=60;g.nextChargeArcId=1;
  g.chargeRandom=(()=>{let i=0;return()=>[.95,.1][i++]??.1})();
  g.traffic=[{wall:true,z:360,x:0}];
  assert.equal(spawnChargeArc(g),true,'the ordinary cross keeps this encounter on schedule');
  assert.equal(g.chargeArcs[0].shape,'cross');
  assert.ok(g.chargeArcs[0].orbs.at(-1).z+120<g.traffic[0].z);
  assert.deepEqual(g.traffic,[{wall:true,z:360,x:0}]);
});

test('seeded schedules supply recurring theoretical charge without changing traffic randomness',()=>{
  const shapes=new Set(),firstTimes=[],firstEncounters=[],gaps=[],encounterGaps=[];let mixedTraffic=0,highCount=0,farCount=0,eligibleCount=0,arcCount=0,roofConflicts=0;
  for(let seed=0;seed<100;seed++){
    const g=createGame(seed),same=createGame(seed),seen=new Set(),arrivals=new Set(),schedule=[],encounters=[];
    g.grounded=same.grounded=false;same.nextChargeArcAt=Infinity;let potential=1,lowest=1;
    for(let i=0;i<120/CONFIG.step;i++){
      g.y=same.y=100;g.charge=same.charge=1;step(g,{});step(same,{});potential-=CHARGE.drainPerSecond*CONFIG.step;
      assert.equal(g.dead,false);
      if(g.time<10)assert.equal(g.nextChargeArcId,0);
      for(const arc of g.chargeArcs){
        if(!seen.has(arc.id)){
          seen.add(arc.id);schedule.push({time:arc.spawnTime,shape:arc.shape,orbs:arc.orbs.map(o=>({x:o.x,y:o.y,z:o.z}))});
          arcCount++;if(arc.shape==='high')highCount++;
          if(arc.id>0){eligibleCount++;if(arc.shape==='far-cross')farCount++;}
          shapes.add(arc.shape);
          if(g.traffic.some(v=>v.z>arc.orbs[0].z-25&&v.z<arc.orbs.at(-1).z+25))mixedTraffic++;
        }
        if(!arrivals.has(arc.id)&&arc.orbs[0].z<0){arrivals.add(arc.id);encounters.push(g.time);potential=Math.min(1,potential+CHARGE.perOrb*CHARGE.orbsPerArc);}
        for(const orb of arc.orbs)if(Math.abs(orb.z)<2)for(const v of g.traffic){
          if(v.wall||v.height<2.6||Math.abs(v.x-orb.x)>v.width/2+CONFIG.halfWidth+CHARGE.pickupX)continue;
          if(Math.abs(v.z)>v.length/2+CONFIG.halfLength+1.2)continue;
          if(orb.y-CHARGE.pickupCenterY+CHARGE.pickupY<v.height+.08+.22)roofConflicts++;
        }
        const first=arc.orbs[0].z,last=arc.orbs.at(-1).z;
        if(first>-30&&last<330)for(const wall of g.traffic.filter(v=>v.wall&&v.lane===0))
          assert.ok(wall.z<=first-75||wall.z>=last+75,`arc entered a wall recovery zone: seed ${seed}, ${g.time.toFixed(1)}s`);
      }
      lowest=Math.min(lowest,potential);g.events.length=0;
    }
    assert.ok(lowest>.25,`insufficient charge opportunity for seed ${seed}: ${lowest}`);
    assert.ok(schedule.length>=10);
    assert.ok(schedule[0].time>=10&&schedule[0].time<=15);
    assert.ok(['simple','cross'].includes(schedule[0].shape),'far-cross never opens a run');
    assert.ok(schedule[1].time<30,'a second opportunity should precede empty charge');
    assert.deepEqual(g.traffic,same.traffic,'arcs must not alter traffic generation or motion');
    firstTimes.push(schedule[0].time);
    firstEncounters.push(encounters[0]);
    for(let i=1;i<schedule.length;i++)gaps.push(schedule[i].time-schedule[i-1].time);
    for(let i=1;i<encounters.length;i++)encounterGaps.push(encounters[i]-encounters[i-1]);
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
  assert.ok(firstEncounters.every(time=>time>13&&time<20),'the first collectible arrives after its arc spawns');
  const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
  assert.ok(mean(firstEncounters)-mean(firstTimes)>2.5,'travel time is included in the encounter budget');
  assert.ok(mean(encounterGaps)>8&&mean(encounterGaps)<11);
  assert.ok(mean(gaps)>8&&mean(gaps)<11);
  assert.ok(highCount/arcCount>=.1&&highCount/arcCount<=.15,`high arcs ${highCount}/${arcCount}`);
  assert.ok(farCount/eligibleCount>=.075&&farCount/eligibleCount<=.125,`far-cross arcs ${farCount}/${eligibleCount}`);
  assert.equal(roofConflicts,0,'a collectible above a truck has a collision-free overlap altitude');
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
