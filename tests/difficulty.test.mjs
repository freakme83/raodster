import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,speedAt,closingSpeed,encounterGapSeconds,CONFIG} from '../src/physics.js';

// A collision-free observer lets the actual fixed-step spawn scheduler run
// without pretending to play or steering the car through the obstacles.
function observe(seed,seconds){
  const g=createGame(seed),groups=[];g.grounded=false;
  for(let i=0;i<seconds/CONFIG.step;i++){
    g.y=100;const before=g.waves;step(g,{thrust:false});
    if(g.waves>before){
      const vehicles=g.traffic.filter(v=>v.wave===before);
      const preceding=g.traffic.filter(v=>v.wave===before-1);
      const prevFront=Math.max(0,...preceding.map(v=>v.z+v.length/2));
      const nextRear=Math.min(...vehicles.map(v=>v.z-v.length/2));
      groups.push({time:g.time,speed:g.speed,closing:closingSpeed(g),vehicles,lanes:vehicles.map(v=>v.lane),kind:vehicles[0].kind,wall:vehicles[0].wall,safeLane:vehicles[0].safeLane,gapSeconds:vehicles[0].gapSeconds,spawnZ:Math.min(...vehicles.map(v=>v.z)),clearance:(nextRear-prevFront)/closingSpeed(g)});
    }
    assert.equal(g.dead,false,`observer crashed for seed ${seed} at ${g.time}`);
  }
  return groups;
}

test('early and mid speed ramp is significant, bounded, and smoothly tapering',()=>{
  const at=[0,15,30,45,60,90,150,300,2000].map(speedAt);
  assert.equal(at[0],27);
  assert.ok(at[1]>35&&at[3]>53&&at[4]>60,at.join(','));
  assert.ok(at.every((v,i)=>i===0||v>at[i-1]));
  assert.ok(at.at(-1)<=76&&76-at.at(-1)<.001);
  assert.ok(at[6]-at[5]<at[3]-at[2]);
  // The first minute is a smooth curve, not a hidden step in the scheduler.
  for(let t=0;t<120;t+=.1)assert.ok(speedAt(t+.1)-speedAt(t)<.15);
});

test('decision gaps shrink in seconds while sparse and recharge sections remain',()=>{
  for(const kind of['flow','cluster'])assert.ok(encounterGapSeconds(30,kind)>encounterGapSeconds(180,kind));
  assert.ok(encounterGapSeconds(180,'cluster')<2);
  assert.ok(encounterGapSeconds(180,'cluster')>=1.4);
  assert.ok(encounterGapSeconds(180,'release')>4.5);
  assert.ok(encounterGapSeconds(180,'opening')>5);
});

test('late runs develop longer dense sequences after speed almost stabilizes',()=>{
  const groups=observe(12,400);
  assert.ok(groups.filter(x=>x.time>60&&x.time<120&&x.kind==='cluster').length>=6);
  assert.ok(groups.some(x=>x.time>60&&x.kind==='release'));
  const runs=[];let length=0;
  for(const x of groups){if(x.kind==='cluster')length++;else if(length){runs.push({at:x.time,length});length=0;}}
  assert.ok(Math.max(...runs.filter(x=>x.at<100).map(x=>x.length))<Math.max(...runs.filter(x=>x.at>300).map(x=>x.length)));
  assert.ok(speedAt(400)-speedAt(180)<1.1);
  assert.ok(groups.filter(x=>x.time>120).some(x=>x.kind==='release'&&x.vehicles.length===1));
});

test('hundreds of deterministic schedules keep a connected lane route and protected wall runways',()=>{
  let dense=0,releases=0,walls=0;
  for(let seed=0;seed<160;seed++){
    const a=observe(seed,190),b=observe(seed,190);
    const signature=groups=>groups.map(x=>[x.kind,x.lanes,x.vehicles.map(v=>v.type),x.wall,Math.round(x.time*120)]);
    assert.deepEqual(signature(a),signature(b),`seed ${seed} diverged`);
    let previousRoute=0,lastWall=-Infinity,firstRelease=0;
    for(let i=0;i<a.length;i++){
      const x=a[i];
      if(x.kind==='cluster'&&!x.wall){dense++;assert.equal(x.vehicles.length,2);}
      if(x.kind==='release'){releases++;firstRelease++;assert.equal(x.vehicles.length,1);}
      if(!x.wall){
        assert.ok(x.lanes.length<=2,`unmarked all-lane block at ${x.time} seed ${seed}`);
        const open=[-1,0,1].filter(lane=>!x.lanes.includes(lane));
        assert.ok(open.includes(x.safeLane),`missing planned safe lane seed ${seed}`);
        assert.ok(Math.abs(x.safeLane-previousRoute)<=1,`disconnected route seed ${seed}`);
        previousRoute=x.safeLane;
      }else{
        walls++;
        assert.deepEqual([...x.lanes].sort(),[-1,0,1]);
        assert.ok(x.vehicles.every(v=>v.height<=1.25&&v.length<=4));
        assert.ok(x.time-lastWall>22,`walls too close seed ${seed}`);
        assert.ok(x.clearance>=4.55,`insufficient approach to wall seed ${seed}`);
        if(a[i+1])assert.ok(a[i+1].clearance>=4.45,`no landing/recharge runway seed ${seed}`);
        lastWall=x.time;
      }
      if(i>0){
        assert.ok(x.clearance>=x.gapSeconds-.05,`overlapping groups seed ${seed} wave ${i}`);
        assert.ok(x.spawnZ>=205-1,`late traffic pop seed ${seed}`);
      }
      // Adjacent shifts clear the old lane in under half a second with the
      // unchanged steering; even the late cluster has room to make the move.
      assert.ok(x.clearance>1.32,`insufficient lane change window seed ${seed}`);
    }
    assert.ok(firstRelease>=2,`no breathing room for seed ${seed}`);
  }
  assert.ok(dense>500&&releases>300&&walls>100,{dense,releases,walls});
});

test('a late aligned wall is still clearable with a modest pulse and landing reserve',()=>{
  for(const age of[30,60,120,300]){
    const g=createGame(42);g.time=age;g.distance=age*50;g.spawnIn=1e9;
    for(const lane of[-1,0,1])g.traffic.push({lane,x:lane*CONFIG.lane,z:55,previousZ:55,width:1.65,length:3.3,height:1.25,passed:false});
    let crossed=false;
    for(let i=0;i<900&&!g.dead;i++){
      const launch=g.time-age<.72;
      const brake=!g.grounded&&g.vy<-3.2&&g.y<g.vy*g.vy/28+.7;
      step(g,{thrust:launch||brake});
      if(g.events.some(e=>e.type==='airpass'))crossed=true;
      if(crossed&&g.grounded)break;
      g.events.length=0;
    }
    assert.equal(g.dead,false,`wall at ${age}s: ${g.reason}`);
    assert.ok(crossed&&g.grounded&&g.pressure>.15);
  }
});
