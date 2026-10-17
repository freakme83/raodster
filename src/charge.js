// Charge is a survival resource, independent of cold-gas thruster pressure.
export const CHARGE = Object.freeze({
  drainPerSecond:1/40,
  perOrb:.055,
  orbsPerArc:6,
  lowThreshold:.23,
  firstArcWindow:[10,15],
  repeatArcWindow:[7.8,10.6],
  pickupX:.95,
  pickupY:.82,
  pickupZ:2.6
});

export const ARC_SHAPES=Object.freeze(['simple','cross','high','greedy']);
const between=(r,[min,max])=>min+(max-min)*r();
const smooth=t=>t*t*(3-2*t);

export function firstArcAt(r){return between(r,CHARGE.firstArcWindow);}
export function nextArcDelay(r){return between(r,CHARGE.repeatArcWindow);}

// Orbs occupy fixed road-world positions. Existing traffic can move beneath
// them, so an arc does not reserve an empty or guaranteed landing corridor.
export function spawnChargeArc(g){
  const firstZ=Math.max(145,g.speed*2.65),spacing=11.8+g.speed*.02;
  const lastZ=firstZ+(CHARGE.orbsPerArc-1)*spacing;
  if(g.traffic.some(v=>v.wall&&v.z>firstZ-120&&v.z<lastZ+120))return false;
  const r=g.chargeRandom,roll=r();
  const shape=g.nextChargeArcId===0?(roll<.72?'simple':'cross'):
    roll<.38?'simple':roll<.65?'cross':roll<.81?'high':'greedy';
  const startLane=Math.floor(r()*3)-1;
  const direction=startLane===-1?1:startLane===1?-1:r()<.5?-1:1;
  const lane=shape==='greedy'?0:startLane;
  const orbs=Array.from({length:CHARGE.orbsPerArc},(_,index)=>{
    const t=index/(CHARGE.orbsPerArc-1),hump=Math.sin(Math.PI*t);
    const x=lane*3.4+(shape==='cross'?direction*3.4*smooth(t):shape==='greedy'?direction*3.4*t*t*t:0);
    const y=shape==='high'?3+2.1*hump:shape==='greedy'?2.15+1.2*hump+1.85*t*t:2.2+1.1*hump;
    return {index,x,y,z:firstZ+index*spacing,collected:false,missed:false};
  });
  g.chargeArcs.push({id:g.nextChargeArcId++,shape,lane,direction,spawnTime:g.time,orbs,collected:0,completed:false});
  return true;
}

export function advanceCharge(g,dt){
  g.charge=Math.max(0,g.charge-CHARGE.drainPerSecond*dt);
  if(g.time>=g.nextChargeArcAt){
    if(spawnChargeArc(g))g.nextChargeArcAt=g.time+nextArcDelay(g.chargeRandom);
    else g.nextChargeArcAt=g.time+1.25;
  }
  for(const arc of g.chargeArcs)for(const orb of arc.orbs){
    orb.z-=g.speed*dt;
    if(orb.collected||orb.missed)continue;
    if(orb.z< -CHARGE.pickupZ){orb.missed=true;continue;}
    if(g.grounded||Math.abs(orb.z)>CHARGE.pickupZ||Math.abs(g.x-orb.x)>CHARGE.pickupX||Math.abs(g.y-orb.y)>CHARGE.pickupY)continue;
    orb.collected=true;arc.collected++;g.charge=Math.min(1,g.charge+CHARGE.perOrb);
    const prior=g.orbChain;
    const chain=prior&&prior.arcId===arc.id&&prior.index===orb.index-1&&g.time-prior.time<.7?prior.count+1:1;
    g.orbChain={arcId:arc.id,index:orb.index,time:g.time,count:chain};
    g.orbPops.push({x:orb.x,y:orb.y,z:orb.z,age:0});
    g.events.push({type:'orb',arcId:arc.id,index:orb.index,chain});
    if(arc.collected===CHARGE.orbsPerArc&&!arc.completed){arc.completed=true;g.events.push({type:'fullArc',arcId:arc.id});}
  }
  g.chargeArcs=g.chargeArcs.filter(arc=>arc.orbs.at(-1).z>-25);
  for(const pop of g.orbPops){pop.z-=g.speed*dt;pop.age+=dt;}
  g.orbPops=g.orbPops.filter(pop=>pop.age<.25);
  if(g.charge>CHARGE.lowThreshold+.08)g.lowChargeWarned=false;
  if(g.charge>0&&g.charge<CHARGE.lowThreshold&&!g.lowChargeWarned){g.lowChargeWarned=true;g.events.push({type:'lowCharge'});}
  return g.charge===0;
}
