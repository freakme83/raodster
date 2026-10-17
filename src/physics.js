// All units are metres / seconds. Rendering never changes simulation state.
export const CONFIG = Object.freeze({lane:3.4,roadHalf:5.25,halfWidth:.83,halfLength:1.85,gravity:11,thrust:25,drain:.43,recharge:.32,maxFall:11.5,maxAngle:25*Math.PI/180,step:1/120});
export const MIN_MEANINGFUL_AIRTIME = 1;
export const TYPES = Object.freeze([
  {name:'compact',width:1.65,length:3.3,height:1.25,color:'#e6c179'},
  {name:'coupe',width:1.85,length:4,height:1.1,color:'#df91a1'},
  {name:'sedan',width:1.8,length:4.5,height:1.45,color:'#9bb5d7'},
  {name:'van',width:1.95,length:5.2,height:2.25,color:'#e1d7be'},
  {name:'truck',width:2.15,length:7,height:2.8,color:'#b6c6b3'},
  {name:'long truck',width:2.2,length:10.5,height:3.15,color:'#c4b0d2'}
]);
// Seeded highway cruising speeds (m/s). Differences are deliberate but bounded:
// every vehicle remains slower than the player, while gaps evolve between rows.
export const TRAFFIC_SPEED_RANGES=Object.freeze([[12,17],[15,19],[13,17],[11,14],[9,12],[9,12]]);
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function randomSeed(seed=Date.now()) { let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}; }
// Reach the same 80 m/s ceiling with a 30% faster time scale.
export const speedAt=time=>27+53*(1-Math.exp(-Math.pow(Math.max(0,time)*1.3/34,1.2)));
export const trafficFlowAt=distance=>10+5*(1-Math.exp(-distance/4000));
export const closingSpeed=(g,vehicle)=>g.speed-(vehicle?.worldSpeed??trafficFlowAt(g.distance));
export function trafficWorldSpeed(g,vehicle,z=vehicle.z,flow=trafficFlowAt(g.distance)){
  if(vehicle.worldSpeed==null)return flow;
  // The individualized speed difference develops in the readable forward
  // view. Far scenery keeps the shared flow, avoiding long-range traffic pileups.
  const blend=clamp((460-z)/120,0,1);
  return flow+(vehicle.worldSpeed-flow)*blend;
}
function projectedTimeToZ(g,vehicle,z){
  const flow=trafficFlowAt(g.distance),speed=g.speed,target=vehicle.worldSpeed??flow;
  let cursor=vehicle.z,time=0;
  if(cursor>460&&z<cursor){const end=Math.max(z,460);time+=(cursor-end)/Math.max(1,speed-flow);cursor=end;}
  if(cursor>340&&z<cursor){const end=Math.max(z,340);time+=(cursor-end)/Math.max(1,speed-(flow+target)/2);cursor=end;}
  if(cursor>z)time+=(cursor-z)/Math.max(1,speed-target);
  return time;
}
// A smooth pressure signal sets density; seeded rolls add irregular variation.
export const intensityAt=time=>1-Math.exp(-Math.max(0,time)/38);
export function encounterGapSeconds(time,kind='flow'){
  const intensity=intensityAt(time);
  if(kind==='peak')return .95-.3*intensity;
  if(kind==='optional')return .48+.06*(1-intensity);
  if(kind==='recovery')return 2.5-.8*intensity;
  if(kind==='opening')return 2.9-.8*intensity;
  return 2.55-1.8*intensity;
}
export function createGame(seed) {
  return {time:0,distance:0,speed:27,pressure:1,x:0,vx:0,lane:0,y:0,vy:0,roll:0,rollV:0,pitch:0,grounded:true,preload:0,thrusting:false,impact:0,instability:0,traffic:[],events:[],dead:false,reason:null,spawnIn:1.4,waves:0,lastWall:-100,random:randomSeed(seed),jumpPasses:0,airTime:0,lastSafeLane:0,lastWasWall:false,peakRows:0,lastPeak:-100,recoveryDue:false,optionalRows:0,optionalId:0,lastOptional:-100};
}
export function moveLane(g,dir){
  if(g.dead)return;
  const next=clamp(g.lane+Math.sign(dir),-1,1);
  if(next===g.lane)return;
  g.lane=next;
  if(!g.grounded)g.rollV-=dir*.48;
  g.events.push({type:'lane'});
}
export function fail(g,reason){if(g.dead)return;g.dead=true;g.thrusting=false;g.reason=reason;g.events.push({type:'crash',reason});}
export function landing(g){
  const fall=Math.max(0,-g.vy),angle=Math.abs(g.roll);
  if(fall>CONFIG.maxFall){fail(g,'HARD LANDING');return;}
  if(angle>CONFIG.maxAngle){fail(g,'LANDED SIDEWAYS');return;}
  g.y=0;g.vy=0;g.grounded=true;g.impact=Math.min(1,fall/10);g.preload=0;
  let quality='safe';
  const meaningfulJump=g.airTime>=MIN_MEANINGFUL_AIRTIME;
  if(meaningfulJump&&fall<4.8&&angle<5*Math.PI/180)quality='perfect';
  else if(fall>7.7||angle>15*Math.PI/180){quality='rough';g.instability=.65;g.vx+=Math.sign(g.roll)*.65;}
  g.events.push({type:'landing',quality,fall,angle,passed:g.jumpPasses,meaningfulJump});g.jumpPasses=0;
}
function nextSafeLane(lane,r,{stayChance=0}={}){
  const options=[lane-1,lane+1].filter(n=>n>=-1&&n<=1);
  if(options.length&&r()<stayChance)return lane;
  return options[Math.floor(r()*options.length)];
}
export function spawnWave(g){
  const r=g.random,intensity=intensityAt(g.time);
  if(g.optionalRows===0&&g.peakRows===0&&!g.recoveryDue&&g.time>20&&g.time-g.lastPeak>9&&g.time-g.lastOptional>14&&r()<.12+intensity*.12){
    g.optionalRows=3;g.optionalId++;g.lastOptional=g.time;
    const laneSpeeds=[11.2+r()*.8,14.6+r()*.7,16.4+r()*.8];
    for(let i=laneSpeeds.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[laneSpeeds[i],laneSpeeds[j]]=[laneSpeeds[j],laneSpeeds[i]];}
    g.optionalLaneSpeeds=laneSpeeds;
  }
  if(g.peakRows===0&&g.optionalRows===0&&!g.recoveryDue&&g.time>28&&g.time-g.lastPeak>28&&r()<.14+intensity*.12){
    g.peakRows=7+Math.floor(r()*3);
    g.lastPeak=g.time;
  }
  const peak=g.peakRows>0,optional=g.optionalRows>0,recovery=g.recoveryDue;
  const kind=peak?'peak':optional?'optional':recovery?'recovery':'flow';
  const wall=peak&&g.peakRows===1&&g.time-g.lastWall>22&&r()<.55;
  const maxType=g.time<18?3:g.distance<900?4:6;
  const count=wall?3:peak||optional?2:recovery||g.time<6?1:(r()<.38+intensity*.5?2:1);
  const lanes=wall?[-1,0,1]:[];
  let safeLane=g.lastSafeLane;
  if(count===2){
    // Every dense row has an adjacent free lane from the previous route.
    safeLane=nextSafeLane(g.lastSafeLane,r,{stayChance:optional?0:peak ? .18 : .24});
    lanes.push(...[-1,0,1].filter(lane=>lane!==safeLane));
  }else if(count===1){
    if(g.waves===0){lanes.push(0);safeLane=-1;}
    else {lanes.push(g.lastSafeLane);safeLane=nextSafeLane(g.lastSafeLane,r);}
  }
  const types=lanes.map(lane=>{
    if(wall)return Math.floor(r()*2);
    if(optional){
      const speed=g.optionalLaneSpeeds[lane+1];
      const choices=TRAFFIC_SPEED_RANGES.map((range,i)=>({range,i})).filter(({range,i})=>i<maxType&&speed>=range[0]&&speed<=range[1]).map(({i})=>i);
      return speed<13&&g.time>45&&r()<.42?5:choices[Math.floor(r()*choices.length)];
    }
    return peak&&g.time>55&&r()<.3?5:g.time<6?0:Math.floor(r()*maxType);
  });
  const worldSpeeds=types.map((type,i)=>optional?g.optionalLaneSpeeds[lanes[i]+1]:TRAFFIC_SPEED_RANGES[type][0]+r()*(TRAFFIC_SPEED_RANGES[type][1]-TRAFFIC_SPEED_RANGES[type][0]));
  const lead=g.traffic.reduce((z,v)=>Math.max(z,v.z+v.length/2),0);
  // Size spacing for the slowest plausible traffic vehicle so changing speeds
  // cannot compress a newly generated row into the one ahead of it.
  const closing=Math.max(1,g.speed-Math.min(...TRAFFIC_SPEED_RANGES.map(([,max])=>max)));
  // Time gaps scale with relative closing speed and vary deterministically.
  // Wall approach and post-wall recovery remain longer than ordinary traffic.
  const baseGap=encounterGapSeconds(g.time,kind);
  const variedGap=optional ? .48+r()*.06 : baseGap*(peak ? .9+r()*.2 : .82+r()*.36);
  const seconds=Math.max(variedGap,wall?4.2:0,g.lastWasWall?2.45:0);
  const gap=closing*seconds;
  const longestHalf=Math.max(...types.map(i=>TYPES[i].length/2));
  const safePreview=closing*2.6+longestHalf+CONFIG.halfLength;
  let z=g.waves===0?100:Math.max(safePreview,lead+gap+longestHalf);
  if(!wall&&g.waves>0){
    // If the previous row occupies this row's only open lane at the same
    // time, preserve a connected ground route by moving the new row just past it.
    for(let attempt=0;attempt<5;attempt++){
      let start=Infinity,end=0;
      for(let i=0;i<lanes.length;i++){
        const envelope=TYPES[types[i]].length/2+CONFIG.halfLength;
        start=Math.min(start,projectedTimeToZ(g,{worldSpeed:worldSpeeds[i],z:z+4*i},envelope));
        end=Math.max(end,projectedTimeToZ(g,{worldSpeed:worldSpeeds[i],z:z+4*i},-envelope));
      }
      let delay=0;
      for(const v of g.traffic){
        if(v.lane!==safeLane||v.z<=0||v.z<z-400)continue;
        const envelope=v.length/2+CONFIG.halfLength;
        const oldStart=projectedTimeToZ(g,v,envelope);
        const oldEnd=projectedTimeToZ(g,v,-envelope);
        if(start<oldEnd&&end>oldStart)delay=Math.max(delay,oldEnd+.18-start);
      }
      if(delay<=.01)break;
      z+=delay*Math.max(1,g.speed-9);
    }
  }
  if(g.waves>0){
    // Project same-lane envelopes through the active-speed portion of the
    // view. Add only the spacing needed to keep a faster rear car from
    // catching a slower lead car before both pass the player.
    let extra=0;
    lanes.forEach((lane,i)=>{
      for(const behind of g.traffic){
        if(behind.lane!==lane||behind.z>=z+4*i)continue;
        const separation=z+4*i-behind.z;
        const closing=behind.worldSpeed!=null?behind.worldSpeed-worldSpeeds[i]:0;
        const envelope=(TYPES[types[i]].length+behind.length)/2+2;
        extra=Math.max(extra,envelope+Math.max(0,closing)*9-separation);
      }
    });
    z+=Math.max(0,extra);
  }
  lanes.forEach((lane,i)=>{
    const type=types[i],position=z+(wall?0:i*4);
    const worldSpeed=worldSpeeds[i];
    g.traffic.push({...TYPES[type],type,lane,x:lane*CONFIG.lane,z:position,previousZ:position,passed:false,wall,wave:g.waves,kind,gapSeconds:seconds,safeLane,worldSpeed,optionalJumpCandidate:optional,optionalSequence:optional?g.optionalId:null,optionalRow:optional?3-g.optionalRows:null});
  });
  if(wall)g.lastWall=g.time;
  if(recovery)g.recoveryDue=false;
  if(peak){g.peakRows--;if(g.peakRows===0)g.recoveryDue=true;}
  if(optional){g.optionalRows--;if(g.optionalRows===0){g.optionalLaneSpeeds=null;g.recoveryDue=true;}}
  g.lastWasWall=wall;g.lastSafeLane=safeLane;g.waves++;
  return seconds;
}
export function step(g,input,dt=CONFIG.step){
  if(g.dead)return;
  g.time+=dt;g.speed=speedAt(g.time);g.distance+=g.speed*dt;
  g.impact=Math.max(0,g.impact-dt*3.8);g.instability=Math.max(0,g.instability-dt);
  const wasGrounded=g.grounded;
  g.thrusting=!!input.thrust&&g.pressure>.0001;
  if(g.thrusting){
    if(g.grounded){g.preload+=dt;if(g.preload>=.11){g.grounded=false;g.airTime=0;g.events.push({type:'launch'});}}
    g.pressure=Math.max(0,g.pressure-CONFIG.drain*dt);
  }else {g.preload=0;if(g.grounded){const old=g.pressure;g.pressure=Math.min(1,g.pressure+CONFIG.recharge*dt);if(old<1&&g.pressure===1)g.events.push({type:'charged'});}}
  const error=g.lane*CONFIG.lane-g.x;
  const stiffness=g.grounded?75:19, damping=g.grounded?17:7.2;
  g.vx+= (error*stiffness-g.vx*damping)*dt;
  g.vx=clamp(g.vx,g.grounded?-12:-7.2,g.grounded?12:7.2);
  g.x+=g.vx*dt;
  const rollTarget=-g.vx*(g.grounded?.018:.055);
  g.rollV+=((rollTarget-g.roll)*32-g.rollV*7.5)*dt;g.roll+=g.rollV*dt;
  if(!g.grounded){
    g.airTime+=dt;
    // A soft thrust falloff at altitude avoids an invisible hard ceiling.
    const force=g.thrusting?CONFIG.thrust*clamp(1-(g.y-3)/7,.12,1):0;
    const riseDrag=Math.max(0,g.vy)*1.2;
    g.vy+=(force-CONFIG.gravity-riseDrag)*dt;g.y+=g.vy*dt;
    if(g.y<=0&&!wasGrounded)landing(g);
  }
  g.pitch+=(clamp(-g.vy*.014,-.16,.21)-g.pitch)*Math.min(1,dt*7);
  if(Math.abs(g.x)+CONFIG.halfWidth>CONFIG.roadHalf){fail(g,'OFF THE ROAD');return;}
  if(g.dead)return;
  const flow=trafficFlowAt(g.distance);
  for(const v of g.traffic){
    v.previousZ=v.z;v.z-=(g.speed-trafficWorldSpeed(g,v,v.z,flow))*dt;
    const half=v.length/2+CONFIG.halfLength;
    const inDepth=v.z<half&&v.previousZ>-half;
    const inLane=Math.abs(g.x-v.x)<(v.width/2+CONFIG.halfWidth)*.94;
    if(inDepth&&inLane&&g.y<v.height+.08){fail(g,'TRAFFIC COLLISION');return;}
    if(!v.passed&&v.z<-half){
      v.passed=true;
      if(g.y>v.height&&inLane){g.jumpPasses++;g.events.push({type:'airpass'});}
      else if(g.grounded&&Math.abs(g.x-v.x)<v.width/2+CONFIG.halfWidth+.55)g.events.push({type:'close'});
    }
  }
  g.traffic=g.traffic.filter(v=>v.z>-35);
  g.spawnIn-=dt;
  if(g.spawnIn<=0)g.spawnIn=spawnWave(g);
}
