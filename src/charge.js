// Charge is a survival resource, independent of cold-gas thruster pressure.
export const CHARGE = Object.freeze({
  drainPerSecond:1/40,
  perOrb:.08,
  orbsPerArc:6,
  lowThreshold:.23,
  firstArcWindow:[10,15],
  repeatArcWindow:[7.8,10.6],
  pickupCenterY:.62,
  pickupX:1.18,
  pickupY:1.08,
  bonusPickupX:1.4,
  bonusPickupY:1.25,
  pickupZ:3.15,
  minimumPickupAltitude:.45,
  popDuration:.22,
  bonusPopDuration:.36,
  bonusMeanInterval:75,
  bonusHeight:5.5,
  bonusReward:.5
});

export const ARC_SHAPES=Object.freeze(['simple','cross','high','greedy','far-cross']);
const between=(r,[min,max])=>min+(max-min)*r();
const smooth=t=>t*t*(3-2*t);
const playerHalfLength=1.85,playerHalfWidth=.83;

// Predict nearby traffic at each orb's encounter, then lift only the affected
// part of the arc. The player needs room for their body above a vehicle roof;
// the last orbs and their landing lanes remain free to be risky.
function clearTrafficRoofs(g,orbs){
  const original=orbs.map(orb=>orb.y),raised=[...original];
  for(const orb of orbs){
    const travelTime=orb.z/g.speed;
    for(const vehicle of g.traffic){
      if(vehicle.wall||vehicle.height<2.6)continue;
      if(Math.abs(vehicle.x-orb.x)>vehicle.width/2+playerHalfWidth+CHARGE.pickupX)continue;
      const projectedZ=vehicle.z-(g.speed-(vehicle.worldSpeed??15))*travelTime;
      const envelope=vehicle.length/2+playerHalfLength+CHARGE.pickupZ+3;
      if(Math.abs(projectedZ)>envelope)continue;
      const required=vehicle.height+.08+.28+CHARGE.pickupCenterY-CHARGE.pickupY*.6;
      const lift=Math.max(0,required-original[orb.index]);
      raised[orb.index]=Math.max(raised[orb.index],original[orb.index]+lift);
      for(const neighbor of [orb.index-1,orb.index+1])if(neighbor>=0&&neighbor<orbs.length)
        raised[neighbor]=Math.max(raised[neighbor],original[neighbor]+lift*.5);
    }
  }
  orbs.forEach((orb,i)=>{orb.y=raised[i];});
}

export function firstArcAt(r){return between(r,CHARGE.firstArcWindow);}
export function nextArcDelay(r){return between(r,CHARGE.repeatArcWindow);}
export function nextBonusDelay(r){return -Math.log(Math.max(Number.EPSILON,1-r()))*CHARGE.bonusMeanInterval;}

function bonusCanSpawn(g,spawnZ){
  const visibleLifetime=(spawnZ+6)/g.speed;
  for(const arc of g.chargeArcs)for(const orb of arc.orbs){
    if(orb.collected||orb.missed)continue;
    // Include yellow orbs that will enter the renderer's 330 m range before
    // this green orb has passed the near edge of the view.
    if(orb.z>-6&&orb.z<330+g.speed*visibleLifetime)return false;
  }
  return g.nextChargeArcAt-g.time>visibleLifetime;
}

// Bonus charge appears independently from normal six-orb arcs and their RNG.
export function spawnBonusOrb(g,lane=Math.floor(g.bonusRandom()*3)-1){
  const spawnZ=Math.max(145,g.speed*3);
  if(g.bonusOrbs.length||!bonusCanSpawn(g,spawnZ))return false;
  g.bonusOrbs.push({x:lane*3.4,y:CHARGE.bonusHeight,z:spawnZ,collected:false,missed:false});
  return true;
}

// Orbs occupy fixed road-world positions. Existing traffic can move beneath
// them, so an arc does not reserve an empty or guaranteed landing corridor.
export function spawnChargeArc(g){
  const firstZ=Math.max(145,g.speed*2.65),ordinarySpacing=11.8+g.speed*.02;
  const lastZ=firstZ+(CHARGE.orbsPerArc-1)*ordinarySpacing;
  if(g.traffic.some(v=>v.wall&&v.z>firstZ-120&&v.z<lastZ+120))return false;
  const r=g.chargeRandom,roll=r();
  let shape=g.nextChargeArcId===0?(roll<.72?'simple':'cross'):
    roll<.342?'simple':roll<.594?'cross':roll<.711?'high':roll<.9?'greedy':'far-cross';
  // Only the full-road crossing needs extra travel time between orbs.
  // Near a protected wall, use its ordinary cross sibling on the same schedule.
  const farSpacing=Math.max(19,g.speed*.3);
  if(shape==='far-cross'&&g.traffic.some(v=>v.wall&&v.z>lastZ+120&&v.z<firstZ+(CHARGE.orbsPerArc-1)*farSpacing+120))shape='cross';
  const spacing=shape==='far-cross'?farSpacing:ordinarySpacing;
  const startLane=Math.floor(r()*3)-1;
  const direction=startLane===-1?1:startLane===1?-1:r()<.5?-1:1;
  const lane=shape==='greedy'?0:shape==='far-cross'&&startLane===0?-direction:startLane;
  const orbs=Array.from({length:CHARGE.orbsPerArc},(_,index)=>{
    const t=index/(CHARGE.orbsPerArc-1),hump=Math.sin(Math.PI*t);
    const x=lane*3.4+(shape==='far-cross'?direction*6.8*smooth(t):shape==='cross'?direction*3.4*smooth(t):shape==='greedy'?direction*3.4*t*t*t:0);
    const y=shape==='high'?3.2+2.6*hump:shape==='greedy'?3.3+1.2*hump+1.85*t*t:3.3+1.1*hump;
    return {index,x,y,z:firstZ+index*spacing,collected:false,missed:false};
  });
  clearTrafficRoofs(g,orbs);
  g.chargeArcs.push({id:g.nextChargeArcId++,shape,lane,direction,spawnTime:g.time,orbs,collected:0,completed:false});
  return true;
}

// Sweep the orb against the car's visible body volume over this fixed step.
// The relative segment also catches a fast pass that ends beyond the near face.
function crossesCollector(g,orb,previous,dt,bonus=false){
  if(g.grounded)return false;
  const start=[orb.x-previous.x,orb.y-previous.y-CHARGE.pickupCenterY,orb.z];
  const end=[orb.x-g.x,orb.y-g.y-CHARGE.pickupCenterY,orb.z-g.speed*dt];
  const half=[bonus?CHARGE.bonusPickupX:CHARGE.pickupX,bonus?CHARGE.bonusPickupY:CHARGE.pickupY,CHARGE.pickupZ];
  let entry=0,exit=1;
  for(let axis=0;axis<3;axis++){
    const delta=end[axis]-start[axis];
    if(Math.abs(delta)<1e-9){if(Math.abs(start[axis])>half[axis])return false;continue;}
    const a=(-half[axis]-start[axis])/delta,b=(half[axis]-start[axis])/delta;
    entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
    if(entry>exit)return false;
  }
  const rise=g.y-previous.y;
  if(Math.abs(rise)<1e-9)return previous.y>=CHARGE.minimumPickupAltitude;
  const threshold=(CHARGE.minimumPickupAltitude-previous.y)/rise;
  if(rise>0)entry=Math.max(entry,threshold);
  else exit=Math.min(exit,threshold);
  return entry<=exit;
}

export function advanceCharge(g,dt,previous={x:g.x,y:g.y}){
  g.charge=Math.max(0,g.charge-CHARGE.drainPerSecond*dt);
  if(g.time>=g.nextBonusOrbAt){
    // Preserve the opportunity, and its lane roll, if yellow traffic occupies
    // the view. The separate timer keeps producing irregular opportunities.
    (g.pendingBonusLanes??=[]).push(Math.floor(g.bonusRandom()*3)-1);
    g.nextBonusOrbAt=g.time+nextBonusDelay(g.bonusRandom);
  }
  const spawnZ=Math.max(145,g.speed*3);
  if(g.pendingBonusLanes?.length&&!g.bonusOrbs.length&&bonusCanSpawn(g,spawnZ)&&
      g.bonusRandom()<1-Math.exp(-dt/.35))
    spawnBonusOrb(g,g.pendingBonusLanes.shift());
  if(g.time>=g.nextChargeArcAt){
    if(spawnChargeArc(g))g.nextChargeArcAt=g.time+nextArcDelay(g.chargeRandom);
    else g.nextChargeArcAt=g.time+1.25;
  }
  for(const arc of g.chargeArcs)for(const orb of arc.orbs){
    const touched=!orb.collected&&!orb.missed&&crossesCollector(g,orb,previous,dt);
    orb.z-=g.speed*dt;
    if(orb.collected||orb.missed)continue;
    if(!touched){if(orb.z< -CHARGE.pickupZ)orb.missed=true;continue;}
    orb.collected=true;arc.collected++;g.charge=Math.min(1,g.charge+CHARGE.perOrb);
    const prior=g.orbChain;
    const chain=prior&&prior.arcId===arc.id&&prior.index===orb.index-1&&g.time-prior.time<.7?prior.count+1:1;
    g.orbChain={arcId:arc.id,index:orb.index,time:g.time,count:chain};
    g.orbPops.push({x:orb.x,y:orb.y,z:orb.z,age:0});
    g.events.push({type:'orb',arcId:arc.id,index:orb.index,chain});
    if(arc.collected===CHARGE.orbsPerArc&&!arc.completed){arc.completed=true;g.events.push({type:'fullArc',arcId:arc.id});}
  }
  for(const orb of g.bonusOrbs){
    const touched=!orb.collected&&!orb.missed&&crossesCollector(g,orb,previous,dt,true);
    orb.z-=g.speed*dt;
    if(orb.collected||orb.missed)continue;
    if(!touched){if(orb.z< -CHARGE.pickupZ)orb.missed=true;continue;}
    orb.collected=true;g.charge=Math.min(1,g.charge+CHARGE.bonusReward);
    g.orbPops.push({x:orb.x,y:orb.y,z:orb.z,age:0,bonus:true});
    g.events.push({type:'orb',arcId:null,index:0,chain:1,bonus:true});
  }
  g.bonusOrbs=g.bonusOrbs.filter(orb=>!orb.missed&&!orb.collected);
  g.chargeArcs=g.chargeArcs.filter(arc=>arc.orbs.at(-1).z>-25);
  for(const pop of g.orbPops){pop.z-=g.speed*dt;pop.age+=dt;}
  g.orbPops=g.orbPops.filter(pop=>pop.age<(pop.bonus?CHARGE.bonusPopDuration:CHARGE.popDuration));
  if(g.charge>CHARGE.lowThreshold+.08)g.lowChargeWarned=false;
  if(g.charge>0&&g.charge<CHARGE.lowThreshold&&!g.lowChargeWarned){g.lowChargeWarned=true;g.events.push({type:'lowCharge'});}
  return g.charge===0;
}
