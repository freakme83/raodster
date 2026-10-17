import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,moveLane,speedAt,closingSpeed,encounterGapSeconds,TRAFFIC_SPEED_RANGES,CONFIG,TYPES} from '../src/physics.js';

// Run the actual fixed-step scheduler with a harmless high flight so every
// seeded traffic choice can be inspected without building an AI driver.
function observe(seed,seconds){
  const g=createGame(seed),groups=[],samples=[];g.grounded=false;
  for(let i=0;i<seconds/CONFIG.step;i++){
    g.y=100;g.charge=1; // Inspect traffic beyond the new survival limit.
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
      groups.push({wave:before,time:g.time,speed:g.speed,closing:closingSpeed(g),vehicles,lanes:vehicles.map(v=>v.lane),kind:vehicles[0].kind,wall:vehicles[0].wall,safeLane:vehicles[0].safeLane,gapSeconds:vehicles[0].gapSeconds,spawnZ:Math.min(...vehicles.map(v=>v.z)),envelopeGap:nextRear-prevFront,clearance:(nextRear-prevFront)/closingSpeed(g),optionalSequence:vehicles[0].optionalSequence,optionalRow:vehicles[0].optionalRow});
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

test('acceleration reaches the same ceiling about 30% sooner with a smooth curve',()=>{
  const at=[0,10,15,30,45,60,90,150,300,2000].map(speedAt);
  assert.equal(at[0],27);
  for(const [index,low,high] of[[1,40,43],[2,47,50],[3,62,66],[4,70,74],[5,75,78]])
    assert.ok(at[index]>=low&&at[index]<=high,`${index}: ${at[index].toFixed(2)} m/s`);
  const previous=t=>27+53*(1-Math.exp(-Math.pow(t/34,1.2)));
  assert.ok(speedAt(10)>previous(10)+3&&speedAt(30)>previous(30)+6&&speedAt(60)>previous(60)+3);
  assert.ok(at.every((v,i)=>i===0||v>=at[i-1]));
  assert.ok(at.at(-1)<=80&&80-at.at(-1)<.001);
  for(let t=0;t<120;t+=.1){assert.ok(speedAt(t+.1)>speedAt(t));assert.ok(speedAt(t+.1)-speedAt(t)<.2);}
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
  const signature=groups=>groups.map(x=>[x.kind,x.lanes,x.vehicles.map(v=>[v.type,Math.round(v.worldSpeed*100)]),x.wall,Math.round(x.time*120)]);
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
        assert.ok(x.envelopeGap>0,`overlapping row envelopes seed ${seed} wave ${i}`);
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

test('traffic speed tendencies are seeded, bounded, and create evolving gaps',()=>{
  const samples=Array.from({length:6},()=>[]);
  for(let seed=0;seed<24;seed++){
    const {groups}=observe(seed,100);
    for(const group of groups)for(const v of group.vehicles){
      const [min,max]=TRAFFIC_SPEED_RANGES[v.type];
      assert.ok(v.worldSpeed>=min&&v.worldSpeed<=max,`${v.name} speed ${v.worldSpeed}`);
      samples[v.type].push(v.worldSpeed);
    }
  }
  assert.ok(samples.every(list=>list.length>50));
  const mean=list=>list.reduce((sum,v)=>sum+v,0)/list.length;
  assert.ok(mean(samples[0])-mean(samples[5])>2,'long trucks should trend slower than compacts');
  const g=createGame(9),slow={...TYPES[5],worldSpeed:9.2,z:400,lane:-1,previousZ:400},fast={...TYPES[1],worldSpeed:18.8,z:400,lane:1,previousZ:400};
  g.traffic.push(slow,fast);g.spawnIn=1e9;
  step(g,{});const initialDifference=slow.z-fast.z;
  for(let i=0;i<120;i++)step(g,{});
  assert.ok(Math.abs((slow.z-fast.z)-initialDifference)>4.5,'different speeds should visibly change relative gaps');
});

test('same-lane projected traffic envelopes stay separated in the forward view',()=>{
  let checked=0;
  for(let seed=0;seed<48;seed++){
    const g=createGame(seed);g.grounded=false;
    for(let i=0;i<115/CONFIG.step;i++){
      g.y=100;g.charge=1;step(g,{});
      const visible=g.traffic.filter(v=>v.z<500&&v.z>-25);
      for(let a=0;a<visible.length;a++)for(let b=a+1;b<visible.length;b++){
        const x=visible[a],y=visible[b];if(x.lane!==y.lane)continue;
        assert.ok(Math.abs(x.z-y.z)>=(x.length+y.length)/2-1,`same-lane envelopes overlapped seed ${seed} at ${g.time.toFixed(1)}s`);
        checked++;
      }
      const blocking=visible.filter(v=>Math.abs(v.z)<v.length/2+CONFIG.halfLength);
      if(new Set(blocking.map(v=>v.lane)).size===3)
        assert.ok(blocking.every(v=>v.wall&&v.height<=1.25),`projected all-lane barrier outside a jump wall, seed ${seed} at ${g.time.toFixed(1)}s`);
    }
  }
  assert.ok(checked>5000);
});

test('optional jump sequences preserve a changing ground route and a bounded air window',()=>{
  let found=0,longVehicleRows=0,routeChanges=0,airCandidate=null;
  for(let seed=0;seed<80;seed++){
    const {groups}=observe(seed,180);
    const candidates=sequences(groups,'optional');
    for(const seq of candidates){
      if(seq.length!==3)continue;
      const lastIndex=groups.findIndex(row=>row.wave===seq.at(-1).vehicles[0].wave);
      if(!groups[lastIndex+1])continue;
      found++;
      assert.ok(seq.every((row,i)=>row.optionalSequence===seq[0].optionalSequence&&row.optionalRow===i));
      assert.ok(seq.every(row=>row.vehicles.length===2&&!row.wall));
      assert.ok(seq.every((row,i)=>i===0||Math.abs(row.safeLane-seq[i-1].safeLane)<=1));
      const changes=seq.slice(1).filter((row,i)=>row.safeLane!==seq[i].safeLane).length;
      assert.ok(changes>=2,'ground routing should demand repeated lane choices');
      routeChanges+=changes;
      longVehicleRows+=seq.filter(row=>row.vehicles.some(v=>v.length>=7)).length;
      const span=seq.at(-1).time-seq[0].time;
      assert.ok(span>=.8&&span<=1.5,`optional sequence span ${span.toFixed(2)}s`);
      assert.ok(seq.every(row=>row.gapSeconds<=.55),`air route cadence ${seq.map(row=>row.gapSeconds).join(',')}`);
      assert.ok(seq.every(row=>row.vehicles.every(v=>v.height<=3.15&&v.worldSpeed>=9&&v.worldSpeed<=19)));
      assert.equal(groups[lastIndex+1]?.kind,'recovery','optional air routes need a short landing window');
      assert.equal(groups[lastIndex+1]?.vehicles.length,1);
      airCandidate??=seq;
    }
  }
  assert.ok(found>=15,`only ${found} optional sequences`);
  assert.ok(longVehicleRows>20,'optional routes should sometimes include long ground blockers');
  assert.ok(routeChanges>=found*2);
  assert.ok(airCandidate);
  const g=createGame(1);g.time=70;g.distance=3500;g.speed=speedAt(g.time);g.spawnIn=1e9;
  let z=95;
  for(let i=0;i<airCandidate.length;i++){
    const row=airCandidate[i];
    if(i>0)z+=row.gapSeconds*(g.speed-row.vehicles.reduce((sum,v)=>sum+v.worldSpeed,0)/row.vehicles.length);
    for(const v of row.vehicles)g.traffic.push({...v,z:z+(v.lane===1?4:0),previousZ:z+(v.lane===1?4:0),passed:false});
  }
  for(let i=0;i<900&&!g.dead;i++){
    const t=i*CONFIG.step;
    const brake=!g.grounded&&g.vy<-3.2&&g.y<g.vy*g.vy/28+.7;
    step(g,{thrust:t<1.35||brake});
    if(g.grounded&&t>1.6)break;
  }
  assert.equal(g.dead,false,`optional air route failed: ${g.reason}`);
  assert.ok(g.grounded&&g.pressure>.1,'the jump route should leave a controlled landing and pressure reserve');
  assert.equal(g.traffic.some(v=>v.optionalSequence===airCandidate[0].optionalSequence),false,'all candidate rows should be passed before landing');
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
