import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,moveLane,CONFIG,TYPES,HIGH_MANEUVER,PRE_WALL_MIN_GAP} from '../src/physics.js';

function observe(seed,seconds=190){
  const g=createGame(seed),rows=[],active=[];
  g.grounded=false;
  for(let i=0;i<seconds/CONFIG.step;i++){
    g.y=100;g.charge=1;
    const wave=g.waves;
    step(g,{});
    assert.equal(g.dead,false,`seed ${seed} died at ${g.time}`);
    if(g.waves>wave){
      const vehicles=g.traffic.filter(v=>v.wave===wave);
      const v=vehicles[0];
      const row={time:g.time,vehicles,kind:v.kind,wall:v.wall,safeLane:v.safeLane,gap:v.gapSeconds,
        sequence:v.highManeuverSequence,index:v.highManeuverRow};
      rows.push(row);active.push(row);
    }
    for(let j=active.length-1;j>=0;j--){
      const row=active[j];
      if(row.visible===undefined&&row.vehicles.some(v=>v.z<380))row.visible=g.time;
      if(row.entry===undefined&&row.vehicles.some(v=>v.z<v.length/2+CONFIG.halfLength))row.entry=g.time;
      if(row.vehicles.every(v=>v.z<-(v.length/2+CONFIG.halfLength))){row.exit=g.time;active.splice(j,1);}
    }
  }
  return {g,rows};
}

function lateralClearTime(){
  const g=createGame(1);g.spawnIn=1e9;g.lane=-1;g.x=-CONFIG.lane;
  moveLane(g,1);
  const clearance=(TYPES[5].width/2+CONFIG.halfWidth)*.94;
  let elapsed=0;
  while(g.x+CONFIG.lane<clearance&&elapsed<1){step(g,{});elapsed+=CONFIG.step;}
  assert.ok(g.x+CONFIG.lane>=clearance);
  return elapsed;
}

function launchClearTime(){
  const g=createGame(1);g.time=120;g.spawnIn=1e9;
  let elapsed=0;
  while(g.y<TYPES[0].height+.08&&elapsed<2){step(g,{thrust:true});elapsed+=CONFIG.step;}
  assert.ok(g.y>=TYPES[0].height+.08);
  return elapsed;
}

test('late maneuver segments use existing peaks, vary in length and direction, and keep real steering time',()=>{
  const segments=new Map(),lengths=new Set(),patterns=new Set();
  let early=0,affected=0,peakRows=0,changes=0,checked=0,nonPeak=0;
  const clearTime=lateralClearTime();
  for(let seed=0;seed<64;seed++){
    const {rows}=observe(seed);
    let safe=0;
    for(let i=0;i<rows.length;i++){
      const row=rows[i],prev=rows[i-1];
      if(row.kind==='peak')peakRows++;
      if(!row.wall){
        assert.ok(Math.abs(row.safeLane-safe)<=1,`disconnected route at seed ${seed}`);
        safe=row.safeLane;
      }
      if(row.sequence===null)continue;
      affected++;
      if(row.time<HIGH_MANEUVER.after)early++;
      if(row.kind!=='peak'||row.wall||row.kind==='optional'||row.kind==='recovery')nonPeak++;
      assert.ok(row.vehicles.length===1||row.vehicles.length===2);
      const key=`${seed}:${row.sequence}`;
      if(!segments.has(key))segments.set(key,[]);
      segments.get(key).push(row);
      if(row.index>0&&prev?.sequence===row.sequence&&prev.vehicles.length===2&&row.vehicles.length===2&&prev.safeLane!==row.safeLane){
        changes++;
        if(row.entry!==undefined&&prev.exit!==undefined){
          assert.ok(row.entry-prev.exit>clearTime+.08,`seed ${seed} has ${(row.entry-prev.exit).toFixed(3)} s for lateral clearance`);
          checked++;
        }
      }
    }
  }
  assert.equal(early,0);assert.equal(nonPeak,0);
  assert.ok(segments.size>=50&&segments.size<150,`segments ${segments.size}`);
  assert.ok(affected/peakRows>.1&&affected/peakRows<.3,`affected peak rows ${affected}/${peakRows}`);
  for(const segment of segments.values()){
    lengths.add(segment.length);
    assert.ok(segment.length>=HIGH_MANEUVER.minRows&&segment.length<=HIGH_MANEUVER.maxRows);
    assert.deepEqual(segment.map(row=>row.index),segment.map((_,i)=>i));
    patterns.add(segment.map(row=>row.safeLane).join(','));
    const dense=segment.filter(row=>row.vehicles.length===2);
    assert.ok(dense.length>=1);
  }
  assert.deepEqual([...lengths].sort(),[3,4,5]);
  assert.ok(patterns.size>12,`only ${patterns.size} lane patterns`);
  assert.ok(changes>100&&checked>100,{changes,checked,clearTime});
});

test('wall approach shortens without taking away launch, lateral settling, or recovery',()=>{
  const clearance=lateralClearTime(),launch=launchClearTime();
  let walls=0,afterManeuver=0,minUsable=Infinity,minVisible=Infinity;
  for(let seed=0;seed<64;seed++){
    const {rows}=observe(seed);
    for(let i=1;i<rows.length-1;i++){
      const wall=rows[i],prior=rows[i-1],after=rows[i+1];
      if(!wall.wall)continue;
      walls++;
      assert.equal(wall.gap,PRE_WALL_MIN_GAP);
      assert.ok(PRE_WALL_MIN_GAP<4.2);
      assert.ok(wall.vehicles.every(v=>v.height<=1.25));
      assert.equal(after.kind,'recovery');
      assert.ok(after.gap>=2.45);
      if(wall.entry===undefined||prior.exit===undefined)continue;
      const usable=wall.entry-prior.exit;
      minUsable=Math.min(minUsable,usable);
      // Include the unchanged preload, roof clearance, lateral settling, and
      // a further reaction margin after the previous collision envelope.
      assert.ok(usable>clearance+launch+1.5,`seed ${seed} wall launch window ${usable.toFixed(3)}`);
      if(prior.sequence!==null)afterManeuver++;
      if(after.entry!==undefined&&wall.exit!==undefined)
        assert.ok(after.entry-wall.exit>1.25,`seed ${seed} wall recovery`);
      // Walls appear within the 380 m forward view well before contact.
      minVisible=Math.min(minVisible,wall.entry-wall.visible);
    }
  }
  assert.ok(walls>100&&afterManeuver>0,{walls,afterManeuver});
  assert.ok(minUsable>2.3&&minVisible>5);
});

test('the selected lane variation is seeded and charge and bonus random streams remain independent',()=>{
  const a=observe(37,125),b=observe(37,125);
  const signature=({rows})=>rows.map(row=>[row.kind,row.safeLane,row.vehicles.map(v=>[v.type,v.worldSpeed]),row.sequence,row.index,row.wall]);
  assert.deepEqual(signature(a),signature(b));
  // Compare independent streams after identical simulation paths, then force
  // a different maneuver selection; traffic must not consume either stream.
  const alternate=createGame(37);alternate.maneuverRandom=()=>.99;alternate.grounded=false;
  for(let i=0;i<125/CONFIG.step;i++){alternate.y=100;alternate.charge=1;step(alternate,{});}
  assert.equal(a.g.chargeRandom(),alternate.chargeRandom());
  assert.equal(a.g.bonusRandom(),alternate.bonusRandom());
});
