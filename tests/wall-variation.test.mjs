import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,step,moveLane,speedAt,CONFIG,TYPES,
  WALL_VARIANT_PROBABILITIES,WALL_PRE_APPROACH_SECONDS,HIGH_MANEUVER
} from '../src/physics.js';

const observationCache=new Map();
function observe(seed,seconds=190){
  const cacheKey=`${seed}:${seconds}`;
  if(observationCache.has(cacheKey))return observationCache.get(cacheKey);
  const g=createGame(seed),rows=[],active=[];g.grounded=false;
  for(let i=0;i<seconds/CONFIG.step;i++){
    g.y=100;g.charge=1;
    const wave=g.waves;step(g,{});
    assert.equal(g.dead,false,`seed ${seed} died at ${g.time}`);
    if(g.waves>wave){
      const vehicles=g.traffic.filter(v=>v.wave===wave),v=vehicles[0];
      const row={time:g.time,wave,vehicles,kind:v.kind,wall:v.wall,variant:v.wallVariant,
        safeLane:v.safeLane,gap:v.gapSeconds,sequence:v.highManeuverSequence,index:v.highManeuverRow};
      rows.push(row);active.push(row);
    }
    for(let j=active.length-1;j>=0;j--){
      const row=active[j];
      if(row.visible===undefined&&row.vehicles.some(v=>v.z<380))row.visible=g.time;
      if(row.entry===undefined&&row.vehicles.some(v=>v.z<v.length/2+CONFIG.halfLength))row.entry=g.time;
      if(row.vehicles.every(v=>v.z<-(v.length/2+CONFIG.halfLength))){row.exit=g.time;active.splice(j,1);}
    }
  }
  observationCache.set(cacheKey,rows);
  return rows;
}

function clearanceTime(type,age){
  const g=createGame(77);g.time=age;g.spawnIn=1e9;g.speed=speedAt(age);
  let elapsed=0;
  while(elapsed<2&&g.y<TYPES[type].height+.08){step(g,{thrust:true});elapsed+=CONFIG.step;}
  assert.ok(g.y>=TYPES[type].height+.08,`${TYPES[type].name} was not reachable at ${age}s`);
  return elapsed;
}

function crossWallLane(wall,target,age=120){
  const g=createGame(301);g.time=age;g.speed=speedAt(age);g.distance=age*60;g.pressure=1;g.charge=1;g.spawnIn=1e9;
  g.lane=target.lane;g.x=target.lane*CONFIG.lane;
  const relative=g.speed-target.worldSpeed;
  const approach=wall.gap-.35;
  const traffic=wall.vehicles.map((v,i)=>({...v,z:v.length/2+CONFIG.halfLength+relative*approach-4*i,previousZ:v.length/2+CONFIG.halfLength+relative*approach-4*i,passed:false}));
  g.traffic=traffic;
  const launch=clearanceTime(target.type,age);
  const launchAt=Math.max(0,approach-launch-.18);
  let elapsed=0,started=false;
  while(elapsed<approach+2&&traffic.some(v=>!v.passed)){
    const thrust=elapsed>=launchAt;
    if(thrust&&!started)started=true;
    step(g,{thrust});elapsed+=CONFIG.step;
    assert.equal(g.dead,false,`reachable ${TYPES[target.type].name} lane crashed in ${wall.variant} wall at ${elapsed.toFixed(2)}s`);
  }
  assert.ok(traffic.find(v=>v.lane===target.lane).passed,`${wall.variant} lane ${target.lane} was not cleared`);
  assert.ok(started);
}

test('walls keep seeded 60/30/10 mix and use one real, unchanged tall vehicle at a varied lane',()=>{
  assert.deepEqual(WALL_VARIANT_PROBABILITIES,{low:.60,van:.30,truck:.10});
  assert.deepEqual(WALL_PRE_APPROACH_SECONDS,{low:2.7,van:3,truck:3.2});
  const counts={low:0,van:0,truck:0},tallLanes={van:new Set(),truck:new Set()},signatures=[];
  for(let seed=0;seed<96;seed++){
    const rows=observe(seed,180);
    for(const row of rows){
      if(!row.wall)continue;
      counts[row.variant]++;
      assert.equal(row.vehicles.length,3);
      assert.ok(row.vehicles.every(v=>v.wall&&v.kind==='peak'&&v.wallVariant===row.variant));
      for(const v of row.vehicles){
        assert.equal(v.name,TYPES[v.type].name);
        assert.equal(v.width,TYPES[v.type].width);
        assert.equal(v.length,TYPES[v.type].length);
        assert.equal(v.height,TYPES[v.type].height);
        assert.equal(v.color,TYPES[v.type].color);
        assert.notEqual(v.type,5,'long trucks are excluded from walls');
      }
      if(row.variant==='low')assert.ok(row.vehicles.every(v=>v.type===0||v.type===1));
      else {
        const type=row.variant==='van'?3:4;
        const tall=row.vehicles.filter(v=>v.type===type);
        assert.equal(tall.length,1);
        assert.equal(row.vehicles.filter(v=>v.type>1).length,1);
        tallLanes[row.variant].add(tall[0].lane);
      }
      assert.equal(row.gap,WALL_PRE_APPROACH_SECONDS[row.variant]);
      signatures.push([row.variant,row.vehicles.map(v=>[v.lane,v.type]),row.gap]);
    }
  }
  const total=counts.low+counts.van+counts.truck;
  assert.ok(total>250,`sample had only ${total} walls`);
  assert.ok(counts.low/total>.54&&counts.low/total<.66,JSON.stringify(counts));
  assert.ok(counts.van/total>.24&&counts.van/total<.36,JSON.stringify(counts));
  assert.ok(counts.truck/total>.06&&counts.truck/total<.14,JSON.stringify(counts));
  assert.ok(tallLanes.van.size===3&&tallLanes.truck.size===3,JSON.stringify([...tallLanes.van]));
  const again=[];
  for(let seed=0;seed<96;seed++)for(const row of observe(seed,180))if(row.wall)
    again.push([row.variant,row.vehicles.map(v=>[v.lane,v.type]),row.gap]);
  assert.deepEqual(signatures,again);
});

test('height-aware spacing leaves real launch and reaction time at representative speeds',()=>{
  const byVariant={low:[],van:[],truck:[]};let walls=0,maneuverWalls=0,minAfterManeuver=Infinity,visibleMinimum=Infinity,postWall=[];
  for(let seed=0;seed<64;seed++){
    const rows=observe(seed);
    for(let i=1;i<rows.length-1;i++){
      const wall=rows[i],previous=rows[i-1],next=rows[i+1];if(!wall.wall)continue;
      walls++;
      assert.equal(next.kind,'recovery');
      assert.ok(next.gap>=2.45,'wall recovery minimum remains protected');
      if(previous.exit===undefined||wall.entry===undefined||wall.visible===undefined)continue;
      const available=wall.entry-previous.exit;
      const type=wall.variant==='low'?null:wall.variant==='van'?3:4;
      const typeVehicle=type===null?wall.vehicles.reduce((lowest,v)=>v.height<lowest.height?v:lowest):wall.vehicles.find(v=>v.type===type);
      const clearanceType=typeVehicle.type;
      const required=clearanceTime(clearanceType,wall.time);
      const relative=speedAt(wall.time)-typeVehicle.worldSpeed;
      const traversal=(typeVehicle.length+2*CONFIG.halfLength)/relative;
      // Count the full vehicle/player collision envelope, plus reaction time,
      // after a physics-simulated launch to the actual roof height.
      assert.ok(available>=required+traversal+.6,`${wall.variant}: available ${available.toFixed(3)} < launch ${required.toFixed(3)} + traversal ${traversal.toFixed(3)} + margin`);
      if(wall.variant!=='low'){
        const lower=wall.vehicles.find(v=>v.type<=1);
        const lowerTraversal=(lower.length+2*CONFIG.halfLength)/Math.max(1,speedAt(wall.time)-lower.worldSpeed);
        assert.ok(available>=clearanceTime(lower.type,wall.time)+lowerTraversal+.6);
      }
      byVariant[wall.variant].push({available,required});
      if(previous.sequence!==null){maneuverWalls++;minAfterManeuver=Math.min(minAfterManeuver,available);}
      visibleMinimum=Math.min(visibleMinimum,wall.entry-wall.visible);
      if(next.entry!==undefined&&wall.exit!==undefined)postWall.push(next.entry-wall.exit);
      assert.equal(wall.time-previous.time>0,true);
    }
  }
  assert.ok(walls>100);
  assert.ok(maneuverWalls>0&&minAfterManeuver>2.3,{maneuverWalls,minAfterManeuver});
  for(const [variant,samples] of Object.entries(byVariant))assert.ok(samples.length>0,`${variant} not measured`);
  assert.ok(visibleMinimum>5,`wall preview ${visibleMinimum.toFixed(2)} s`);
  assert.ok(postWall.every(value=>value>1.2));
  assert.ok(Math.max(...byVariant.low.map(x=>x.available))>Math.min(...byVariant.truck.map(x=>x.available))-.1);
});

test('each mixed wall has an actually survivable low lane; existing physics can also clear tall roofs',()=>{
  const examples={};
  for(let seed=0;seed<96;seed++)for(const row of observe(seed,180))if(row.wall&&!examples[row.variant])examples[row.variant]=row;
  for(const variant of ['low','van','truck']){
    const wall=examples[variant];
    crossWallLane(wall,wall.vehicles.find(v=>v.type<=1));
    if(variant!=='low')crossWallLane(wall,wall.vehicles.find(v=>v.type=== (variant==='van'?3:4)));
  }
  const measured=[0,3,4].map(type=>[30,60,120,180].map(age=>clearanceTime(type,age)));
  assert.ok(measured[0].every(t=>t<.55));
  assert.ok(measured[1].every(t=>t<.72));
  assert.ok(measured[2].every(t=>t<.82));
});

test('wall-only tuning leaves high-maneuver controls and protected random streams intact',()=>{
  assert.deepEqual(HIGH_MANEUVER,{after:60,peakChance:.30,minRows:3,maxRows:5,stayChance:.04,oppositeOuterChance:.72,transitionClearance:.36});
  const g=createGame(81),reference=createGame(81);
  assert.equal(g.nextChargeArcAt,reference.nextChargeArcAt);
  assert.equal(g.nextBonusOrbAt,reference.nextBonusOrbAt);
  for(let i=0;i<20;i++){
    assert.equal(g.chargeRandom(),reference.chargeRandom());
    assert.equal(g.bonusRandom(),reference.bonusRandom());
  }
});
