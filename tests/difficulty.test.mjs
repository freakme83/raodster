import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,moveLane,speedAt,closingSpeed,encounterGapSeconds,CONFIG,TYPES} from '../src/physics.js';

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

test('speed follows the aggressive first-minute targets and tapers smoothly to a practical cap',()=>{
  const at=[0,10,15,30,45,60,90,150,300,2000].map(speedAt);
  assert.equal(at[0],27);
  for(const [index,low,high] of[[1,36,40],[2,42,46],[3,55,60],[4,64,69],[5,70,74]])
    assert.ok(at[index]>=low&&at[index]<=high,`${index}: ${at[index].toFixed(2)} m/s`);
  assert.ok(at.every((v,i)=>i===0||v>at[i-1]));
  assert.ok(at.at(-1)<=80&&80-at.at(-1)<.001);
  assert.ok(at[7]-at[6]<at[4]-at[3]);
  for(let t=0;t<120;t+=.1)assert.ok(speedAt(t+.1)-speedAt(t)<.25);
});

test('flow and dense decision windows tighten while short releases remain',()=>{
  assert.ok(encounterGapSeconds(15,'cluster')>=1.8&&encounterGapSeconds(15,'cluster')<=2.2);
  assert.ok(encounterGapSeconds(35,'cluster')>=1.2&&encounterGapSeconds(35,'cluster')<=1.6);
  assert.ok(encounterGapSeconds(90,'cluster')>=.9&&encounterGapSeconds(90,'cluster')<=1.2);
  for(const kind of['flow','cluster'])assert.ok(encounterGapSeconds(30,kind)>encounterGapSeconds(180,kind));
  assert.ok(encounterGapSeconds(180,'release')>=2.8&&encounterGapSeconds(180,'release')<=3.1);
  assert.ok(encounterGapSeconds(180,'opening')>5);
});

test('the unchanged lane maneuver fits inside the tightest generated decision gap',()=>{
  const clearDistance=(TYPES[0].width/2+CONFIG.halfWidth)*.94;
  for(const direction of[-1,1]){
    const g=createGame(5);moveLane(g,direction);
    let elapsed=0;
    while(elapsed<.5&&Math.abs(g.x)<clearDistance){step(g,{});elapsed+=CONFIG.step;}
    assert.ok(Math.abs(g.x)>=clearDistance,`lane change did not clear in ${elapsed.toFixed(3)} s`);
    assert.ok(elapsed<.22,`lane change envelope took ${elapsed.toFixed(3)} s`);
    assert.ok(encounterGapSeconds(180,'cluster')-elapsed>.65);
  }
});

test('multi-row attacks begin early, then grow after speed mostly stabilizes',()=>{
  const groups=observe(12,400);
  assert.ok(groups.some(x=>x.time>=10&&x.time<20&&x.kind==='flow'&&x.vehicles.length===2));
  const earlyAttack=groups.filter(x=>x.time>=17&&x.time<30&&x.kind==='cluster');
  assert.ok(earlyAttack.length>=3,`only ${earlyAttack.length} early attack rows`);
  assert.ok(groups.filter(x=>x.time>60&&x.time<120&&x.kind==='cluster').length>=6);
  assert.ok(groups.some(x=>x.time>60&&x.kind==='release'));
  const runs=[];let length=0;
  for(const x of groups){if(x.kind==='cluster')length++;else if(length){runs.push({at:x.time,length});length=0;}}
  assert.ok(Math.max(...runs.filter(x=>x.at<100).map(x=>x.length))<Math.max(...runs.filter(x=>x.at>300).map(x=>x.length)));
  assert.ok(speedAt(400)-speedAt(180)<1.1);
  assert.ok(groups.filter(x=>x.time>120).some(x=>x.kind==='release'&&x.vehicles.length===1));
});

test('seeded schedules keep connected routes, varied attack paths, and protected wall runways',()=>{
  let dense=0,releases=0,walls=0,earlyDense=0,lateTight=0,heldRoutes=0,leftShifts=0,rightShifts=0;
  let shortReleases=0;
  for(let seed=0;seed<160;seed++){
    const a=observe(seed,190),b=observe(seed,190);
    const signature=groups=>groups.map(x=>[x.kind,x.lanes,x.vehicles.map(v=>v.type),x.wall,Math.round(x.time*120)]);
    assert.deepEqual(signature(a),signature(b),`seed ${seed} diverged`);
    let previousRoute=0,lastWall=-Infinity,firstRelease=0,attackRows=0;
    for(let i=0;i<a.length;i++){
      const x=a[i];
      if(x.kind==='cluster'&&!x.wall){dense++;assert.equal(x.vehicles.length,2);attackRows++;if(x.time<45)earlyDense++;if(x.time>60&&x.gapSeconds<=1.2)lateTight++;}
      if(x.kind!=='cluster')attackRows=0;
      if(x.kind==='release'){releases++;firstRelease++;assert.equal(x.vehicles.length,1);if(!a[i-1]?.wall&&x.time>45&&x.clearance<=3.6)shortReleases++;}
      if(!x.wall){
        assert.ok(x.lanes.length<=2,`unmarked all-lane block at ${x.time} seed ${seed}`);
        const open=[-1,0,1].filter(lane=>!x.lanes.includes(lane));
        assert.ok(open.includes(x.safeLane),`missing planned safe lane seed ${seed}`);
        assert.ok(Math.abs(x.safeLane-previousRoute)<=1,`disconnected route seed ${seed}`);
        if(i>0&&Math.abs(x.safeLane-previousRoute)===0)heldRoutes++;
        if(i>0&&x.safeLane-previousRoute===-1)leftShifts++;
        if(i>0&&x.safeLane-previousRoute===1)rightShifts++;
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
      // The existing ground steering crosses the collision envelope in .18 s;
      // all generated non-wall gaps leave a generous reaction margin beyond it.
      if(i>0&&!x.wall)assert.ok(x.clearance>=.88,`insufficient lane change window seed ${seed}`);
      if(x.kind==='cluster')assert.ok(attackRows<=8,`unbounded uninterrupted sequence seed ${seed}`);
    }
    assert.ok(firstRelease>=2,`no breathing room for seed ${seed}`);
  }
  assert.ok(dense>500&&releases>300&&walls>100,{dense,releases,walls});
  assert.ok(earlyDense>100,`dense traffic did not arrive early: ${earlyDense}`);
  assert.ok(lateTight>100,`late clusters did not reach the short safe window: ${lateTight}`);
  assert.ok(shortReleases>100,`late release sections remained too long: ${shortReleases}`);
  assert.ok(heldRoutes>0&&leftShifts>0&&rightShifts>0,{heldRoutes,leftShifts,rightShifts});
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
