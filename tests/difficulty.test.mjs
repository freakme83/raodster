import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,moveLane,speedAt,closingSpeed,encounterGapSeconds,CONFIG,TYPES} from '../src/physics.js';

// Run the actual fixed-step scheduler with a harmless high flight so every
// seeded traffic choice can be inspected without building an AI driver.
function observe(seed,seconds){
  const g=createGame(seed),groups=[],samples=[];g.grounded=false;
  for(let i=0;i<seconds/CONFIG.step;i++){
    g.y=100;
    const before=g.waves;
    step(g,{});
    if(i%60===0&&g.time>=5){
      const visible=g.traffic.filter(v=>v.z>0&&v.z<380);
      samples.push({time:g.time,vehicles:visible.length,rows:new Set(visible.map(v=>v.wave)).size});
    }
    if(g.waves>before){
      const vehicles=g.traffic.filter(v=>v.wave===before).map(v=>({...v}));
      const preceding=g.traffic.filter(v=>v.wave===before-1);
      const prevFront=Math.max(0,...preceding.map(v=>v.z+v.length/2));
      const nextRear=Math.min(...vehicles.map(v=>v.z-v.length/2));
      groups.push({time:g.time,speed:g.speed,closing:closingSpeed(g),vehicles,lanes:vehicles.map(v=>v.lane),kind:vehicles[0].kind,wall:vehicles[0].wall,safeLane:vehicles[0].safeLane,gapSeconds:vehicles[0].gapSeconds,spawnZ:Math.min(...vehicles.map(v=>v.z)),clearance:(nextRear-prevFront)/closingSpeed(g)});
    }
    assert.equal(g.dead,false,`observer crashed for seed ${seed} at ${g.time}`);
  }
  return {groups,samples};
}

function sequences(groups,kind){
  const result=[];let current=[];
  for(const group of groups){
    if(group.kind===kind)current.push(group);
    else if(current.length){result.push(current);current=[];}
  }
  if(current.length)result.push(current);
  return result;
}

test('the bounded speed curve stays at the current tune',()=>{
  const at=[0,10,15,30,45,60,90,150,300,2000].map(speedAt);
  assert.equal(at[0],27);
  for(const [index,low,high] of[[1,36,40],[2,42,46],[3,55,60],[4,64,69],[5,70,74]])
    assert.ok(at[index]>=low&&at[index]<=high,`${index}: ${at[index].toFixed(2)} m/s`);
  assert.ok(at.every((v,i)=>i===0||v>at[i-1]));
  assert.ok(at.at(-1)<=80&&80-at.at(-1)<.001);
  for(let t=0;t<120;t+=.1)assert.ok(speedAt(t+.1)-speedAt(t)<.25);
});

test('ordinary, recovery, and peak gaps vary by time at the intended cadence',()=>{
  assert.ok(encounterGapSeconds(5,'flow')>=2.2&&encounterGapSeconds(5,'flow')<=2.7);
  assert.ok(encounterGapSeconds(35,'flow')>=1.3&&encounterGapSeconds(35,'flow')<1.7);
  assert.ok(encounterGapSeconds(90,'flow')<1);
  assert.ok(encounterGapSeconds(90,'peak')>=.6&&encounterGapSeconds(90,'peak')<=.7);
  assert.ok(encounterGapSeconds(90,'recovery')>=1.6&&encounterGapSeconds(90,'recovery')<=1.8);
  assert.ok(encounterGapSeconds(90,'flow')<encounterGapSeconds(20,'flow'));
});

test('the existing lane maneuver clears its collision envelope before peak follow-ups',()=>{
  const clearDistance=(TYPES[0].width/2+CONFIG.halfWidth)*.94;
  for(const direction of[-1,1]){
    const g=createGame(5);moveLane(g,direction);
    let elapsed=0;
    while(elapsed<.5&&Math.abs(g.x)<clearDistance){step(g,{});elapsed+=CONFIG.step;}
    assert.ok(Math.abs(g.x)>=clearDistance);
    assert.ok(elapsed<.22);
  assert.ok(encounterGapSeconds(90,'peak')-elapsed>.35);
  }
});

test('visible mid/late traffic is substantially denser than the previous PR baseline',()=>{
  let lateVehicleSamples=0,lateRowSamples=0,lateSamples=0,midVehicles=0,midSamples=0;
  for(let seed=0;seed<32;seed++){
    const {samples}=observe(seed,150);
    for(const sample of samples){
      if(sample.time>=30&&sample.time<60){midVehicles+=sample.vehicles;midSamples++;}
      if(sample.time>=60){lateVehicleSamples+=sample.vehicles;lateRowSamples+=sample.rows;lateSamples++;}
    }
  }
  const lateAverage=lateVehicleSamples/lateSamples;
  const lateRows=lateRowSamples/lateSamples;
  const midAverage=midVehicles/midSamples;
  // Previous PR averaged ~3.9 vehicles within the renderer's 380 m view
  // across 30 seeds; require at least a 50% sustained increase here.
  assert.ok(lateAverage>=5.9,`late visible average ${lateAverage.toFixed(2)}`);
  assert.ok(lateRows>=3.2,`late visible rows ${lateRows.toFixed(2)}`);
  assert.ok(midAverage>=5,`mid visible average ${midAverage.toFixed(2)}`);
});

test('density pressure is irregular, deterministic, and no longer a fixed phase cycle',()=>{
  const a=observe(23,220),b=observe(23,220);
  const signature=groups=>groups.map(x=>[x.kind,x.lanes,x.vehicles.map(v=>v.type),x.wall,Math.round(x.time*120)]);
  assert.deepEqual(signature(a.groups),signature(b.groups));
  const peaks=sequences(a.groups,'peak');
  assert.ok(peaks.length>=3,`only ${peaks.length} peak sequences`);
  const complete=peaks.filter(rows=>rows.at(-1).time<200);
  assert.ok(complete.length>=3);
  assert.ok(complete.every(rows=>rows.length>=7&&rows.length<=9));
  assert.ok(complete.every(rows=>rows.at(-1).time-rows[0].time>=3.7&&rows.at(-1).time-rows[0].time<=(rows.at(-1).wall?11:8.5)));
  const starts=complete.map(rows=>rows[0].time);
  const intervals=starts.slice(1).map((time,i)=>time-starts[i]);
  assert.ok(new Set(intervals.map(x=>Math.round(x))).size>=2,`peak intervals too regular: ${intervals}`);
  const recovery=a.groups.filter(x=>x.kind==='recovery');
  assert.ok(recovery.length>=complete.length-1);
  assert.ok(recovery.every(x=>x.vehicles.length===1&&x.gapSeconds<2.5));
  assert.ok(a.groups.every(x=>x.kind!=='release'&&x.kind!=='cluster'&&x.kind!=='opening'));
});

test('late ordinary decisions stay close together and peak sequences tighten further',()=>{
  const gaps=[];let peaks=0;
  for(let seed=0;seed<40;seed++){
    const {groups}=observe(seed,150);
    for(let i=1;i<groups.length;i++){
      if(groups[i].time<60)continue;
      if(groups[i].kind==='flow')gaps.push(groups[i].time-groups[i-1].time);
      if(groups[i].kind==='peak'&&!groups[i].wall){
        peaks++;
        assert.ok(groups[i].gapSeconds<=.86,`peak gap ${groups[i].gapSeconds}`);
      }
    }
  }
  const mean=gaps.reduce((sum,x)=>sum+x,0)/gaps.length;
  assert.ok(mean<1.3,`late ordinary decision mean ${mean.toFixed(2)} s`);
  assert.ok(peaks>500,`too few peak rows: ${peaks}`);
});

test('160 seeded schedules keep routes connected, traffic readable, and jump walls protected',()=>{
  let vehicles=0,walls=0,longTrucks=0,holds=0,left=0,right=0,wallPeaks=0;
  for(let seed=0;seed<160;seed++){
    const {groups}=observe(seed,190),again=observe(seed,190).groups;
    const signature=list=>list.map(x=>[x.kind,x.lanes,x.vehicles.map(v=>v.type),x.wall,Math.round(x.time*120)]);
    assert.deepEqual(signature(groups),signature(again),`seed ${seed} diverged`);
    let route=0,lastWall=-Infinity;
    for(let i=0;i<groups.length;i++){
      const x=groups[i];vehicles+=x.vehicles.length;
      longTrucks+=x.vehicles.filter(v=>v.length>=7).length;
      if(!x.wall){
        assert.ok(x.lanes.length<=2,`unmarked all-lane block at ${x.time} seed ${seed}`);
        const open=[-1,0,1].filter(lane=>!x.lanes.includes(lane));
        assert.ok(open.includes(x.safeLane),`missing safe lane seed ${seed}`);
        assert.ok(Math.abs(x.safeLane-route)<=1,`disconnected route seed ${seed}`);
        if(x.safeLane===route)holds++;
        if(x.safeLane-route===-1)left++;
        if(x.safeLane-route===1)right++;
        route=x.safeLane;
      }else{
        walls++;
        assert.equal(x.kind,'peak',`wall outside peak sequence seed ${seed}`);
        wallPeaks++;
        assert.deepEqual([...x.lanes].sort(),[-1,0,1]);
        assert.ok(x.vehicles.every(v=>v.height<=1.25&&v.length<=4));
        assert.ok(x.time-lastWall>22,`walls too close seed ${seed}`);
        assert.ok(x.clearance>=4.15,`insufficient wall approach seed ${seed}`);
        if(groups[i+1]){
          assert.ok(groups[i+1].kind==='recovery',`wall lacks recovery row seed ${seed}`);
          assert.ok(groups[i+1].clearance>=2.4,`wall recovery too short seed ${seed}`);
        }
        lastWall=x.time;
      }
      if(i>0){
        assert.ok(x.clearance>=x.gapSeconds-.08,`overlapping vehicle envelopes seed ${seed} wave ${i}`);
        for(const v of x.vehicles){
          const reactionDistance=v.z-v.length/2-CONFIG.halfLength;
          assert.ok(reactionDistance>=x.closing*2.5,`traffic appeared too close seed ${seed}`);
        }
      }
    }
  }
  assert.ok(walls>100&&wallPeaks===walls,{walls,wallPeaks});
  assert.ok(vehicles>30000,`traffic count ${vehicles}`);
  assert.ok(longTrucks>100,`late vehicle mix lacks long trucks: ${longTrucks}`);
  assert.ok(holds>0&&left>0&&right>0,{holds,left,right});
});

test('a generated late jump wall can still be crossed with a modest pulse and landing reserve',()=>{
  for(const age of[30,60,120,300]){
    const g=createGame(42);g.time=age;g.distance=age*50;g.spawnIn=1e9;
    for(const lane of[-1,0,1])g.traffic.push({...TYPES[0],type:0,lane,x:lane*CONFIG.lane,z:55,previousZ:55,passed:false,wall:true});
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
