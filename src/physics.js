// All units are metres / seconds. Rendering never changes simulation state.
export const CONFIG = Object.freeze({lane:3.4,roadHalf:5.25,halfWidth:.83,halfLength:1.85,gravity:11,thrust:25,drain:.43,recharge:.32,maxFall:11.5,maxAngle:25*Math.PI/180,step:1/120});
export const TYPES = Object.freeze([
  {name:'compact',width:1.65,length:3.3,height:1.25,color:'#e6c179'},
  {name:'coupe',width:1.85,length:4,height:1.1,color:'#df91a1'},
  {name:'sedan',width:1.8,length:4.5,height:1.45,color:'#9bb5d7'},
  {name:'van',width:1.95,length:5.2,height:2.25,color:'#e1d7be'},
  {name:'truck',width:2.15,length:7,height:2.8,color:'#b6c6b3'},
  {name:'long truck',width:2.2,length:10.5,height:3.15,color:'#c4b0d2'}
]);
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function randomSeed(seed=Date.now()) { let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}; }
// A sharper first-minute pull tapers smoothly into an 80 m/s ceiling.
export const speedAt=time=>27+53*(1-Math.exp(-Math.pow(Math.max(0,time)/34,1.2)));
export const trafficFlowAt=distance=>10+5*(1-Math.exp(-distance/4000));
export const closingSpeed=g=>g.speed-trafficFlowAt(g.distance);
// Decision windows continue tightening gently while speed approaches its ceiling.
export const intensityAt=time=>1-Math.exp(-Math.max(0,time-8)/35);
export function encounterGapSeconds(time,kind){
  const intensity=intensityAt(time);
  if(kind==='opening')return 5.8;
  if(kind==='release')return 3.4-.55*intensity;
  if(kind==='cluster')return 2.2-1.3*intensity;
  return 3.6-1.9*intensity;
}
export function createGame(seed) {
  return {time:0,distance:0,speed:27,pressure:1,x:0,vx:0,lane:0,y:0,vy:0,roll:0,rollV:0,pitch:0,grounded:true,preload:0,thrusting:false,impact:0,instability:0,traffic:[],events:[],dead:false,reason:null,spawnIn:1.4,waves:0,lastWall:-100,random:randomSeed(seed),jumpPasses:0,airTime:0,pattern:'opening',patternLeft:3,lastSafeLane:0,lastWasWall:false};
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
  if(fall<4.8&&angle<5*Math.PI/180)quality='perfect';
  else if(fall>7.7||angle>15*Math.PI/180){quality='rough';g.instability=.65;g.vx+=Math.sign(g.roll)*.65;}
  g.events.push({type:'landing',quality,fall,angle,passed:g.jumpPasses});g.jumpPasses=0;
}
function nextPattern(g){
  if(g.patternLeft>0)return;
  if(g.pattern==='opening'){g.pattern='flow';g.patternLeft=3;}
  else if(g.pattern==='flow'&&g.time>=16){
    g.pattern='cluster';
    // Short attack sequences appear early and keep extending on very long runs.
    g.patternLeft=3+Math.floor(Math.log2(1+Math.max(0,g.time-15)/35));
  }else if(g.pattern==='flow'){g.patternLeft=2;}
  else if(g.pattern==='cluster'){g.pattern='release';g.patternLeft=1;}
  else {g.pattern='flow';g.patternLeft=g.time<60?3:2;}
}
function nextSafeLane(lane,r,{stayChance=0}={}){
  const options=[lane-1,lane+1].filter(n=>n>=-1&&n<=1);
  if(options.length&&r()<stayChance)return lane;
  return options[Math.floor(r()*options.length)];
}
export function spawnWave(g){
  nextPattern(g);
  const r=g.random,kind=g.pattern,slot=g.patternLeft;
  const wall=kind==='cluster'&&slot===1&&g.time>22&&g.time-g.lastWall>22&&r()<.42;
  const count=wall?3:kind==='opening'||kind==='release'?1:kind==='cluster'?2:(g.time>=9||r()<.35+intensityAt(g.time)*.35?2:1);
  const maxType=g.distance<280?3:g.distance<900?4:6;
  const lanes=wall?[-1,0,1]:[];
  let safeLane=g.lastSafeLane;
  if(count===2){
    // Every dense row has an adjacent free lane from the previous route.
    safeLane=nextSafeLane(g.lastSafeLane,r,{stayChance:.24});
    lanes.push(...[-1,0,1].filter(lane=>lane!==safeLane));
  }else if(count===1){
    if(g.waves===0){lanes.push(0);safeLane=-1;}
    else {lanes.push(g.lastSafeLane);safeLane=nextSafeLane(g.lastSafeLane,r);}
  }
  const types=lanes.map(()=>wall?Math.floor(r()*2):g.waves===0?0:Math.floor(r()*maxType));
  const lead=g.traffic.reduce((z,v)=>Math.max(z,v.z+v.length/2),0);
  const closing=closingSpeed(g);
  // Gap is measured from the previous group's leading edge to this group's
  // trailing edge. Include vehicle length so mixed long trucks cannot overlap.
  const seconds=Math.max(encounterGapSeconds(g.time,kind),wall?4.6:0,g.lastWasWall?4.5:0);
  const gap=closing*seconds;
  const longestHalf=Math.max(...types.map(i=>TYPES[i].length/2));
  const z=g.waves===0?100:Math.max(205,lead+gap+longestHalf);
  lanes.forEach((lane,i)=>{
    const type=types[i],position=z+(wall?0:i*4);
    g.traffic.push({...TYPES[type],type,lane,x:lane*CONFIG.lane,z:position,previousZ:position,passed:false,wall,wave:g.waves,kind,gapSeconds:seconds,safeLane});
  });
  if(wall)g.lastWall=g.time;
  g.lastWasWall=wall;g.lastSafeLane=safeLane;g.waves++;g.patternLeft--;
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
  // Shared flow speed prevents different vehicle types from forming unplanned walls.
  const flow=trafficFlowAt(g.distance);
  for(const v of g.traffic){
    v.previousZ=v.z;v.z-=(g.speed-flow)*dt;
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
  if(g.spawnIn<=0&&g.traffic.every(v=>v.z<225)){spawnWave(g);g.spawnIn=1;}
}
