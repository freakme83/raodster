// Dependency-free DOM harness: checks event wiring and screen transitions.
// This is not a substitute for a real mobile-browser playtest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Renderer} from '../src/renderer.js';
import {CHARGE,spawnChargeArc} from '../src/charge.js';
class Element {
  constructor(id=''){this.id=id;this.hidden=false;this.style={};this.textContent='';this.events={};this.attrs={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,v)=>v?this.classes.add(x):this.classes.delete(x)};}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  fire(type,data={}){for(const fn of this.events[type]??[])fn({preventDefault(){},target:this,...data});}
  setAttribute(k,v){this.attrs[k]=v;}
  getBoundingClientRect(){return{width:390,height:844,left:0};}
  setPointerCapture(){}
  blur(){}
  closest(){return null;}
  querySelector(){return this.child??=new Element();}
}
test('touch, cancel, pause, crash, persistence, and retry work together',async()=>{
  const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const context=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{})});
  el('scene').getContext=()=>context;
  const segments=[new Element(),new Element(),new Element()];
  globalThis.document=Object.assign(new Element(),{getElementById:el,querySelector:el,querySelectorAll:()=>segments,activeElement:null,hidden:false});
  globalThis.window=new Element();globalThis.matchMedia=()=>({matches:true});globalThis.devicePixelRatio=1;
  globalThis.ResizeObserver=class{constructor(fn){this.fn=fn;}observe(){this.fn();}};
  const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
  let nextFrame,now=performance.now();globalThis.requestAnimationFrame=fn=>{nextFrame=fn;};
  const frames=n=>{for(let i=0;i<n;i++){now+=1000/60;nextFrame(now);}};
  let game;const render=Renderer.prototype.render;Renderer.prototype.render=function(g,...args){game=g;return render.call(this,g,...args);};
  await import('../src/main.js');
  el('intro').fire('pointerdown',{pointerId:10,pointerType:'touch'});frames(1);assert.equal(game.thrusting,false);
  el('start').fire('click');frames(1);assert.equal(el('intro').hidden,true);assert.equal(el('controls').hidden,false);
  assert.equal(el('charge-meter').attrs['aria-valuenow'],100);
  const touch=(pointerId,x=195,y=400,timeStamp=now)=>({pointerId,pointerType:'touch',clientX:x,clientY:y,timeStamp});
  el('pause-button').fire('pointerdown',touch(9));el('left').fire('pointerdown',touch(8));frames(25);
  assert.equal(game.pressure,1,'UI controls do not start thrust');
  frames(4);assert.equal(el('thrust-cue').hidden,false,'a short run teaches the gesture');
  game.traffic=[];game.spawnIn=Infinity;
  const sustainedHold=n=>{for(let i=0;i<n;i++){game.pressure=1;frames(1);}};
  // Screen position and a multi-second stationary hold do not steer.
  for(const [pointerId,x] of [[20,12],[21,378]]){
    const lane=game.lane;el('scene').fire('pointerdown',touch(pointerId,x));sustainedHold(90);
    for(const dx of [4,-3,7,-5,2])el('scene').fire('pointermove',touch(pointerId,x+dx));
    sustainedHold(90);assert.equal(game.thrusting,true);assert.equal(game.lane,lane);
    el('scene').fire('pointerup',touch(pointerId,x));frames(1);
    assert.equal(game.lane,lane,'holding and releasing at either screen edge never steers');
  }
  const moveSwipe=(id,x)=>{const before=game.lane;el('scene').fire('pointermove',touch(id,x));return game.lane-before;};
  // Each continuous stroke is latched after one command, regardless of distance or sampling.
  for(const [id,endX] of [[22,214],[23,292]]){
    game.lane=-1;game.x=-3.4;el('scene').fire('pointerdown',touch(id,180));
    assert.equal(moveSwipe(id,endX),1,'short and long swipes each issue only one command');
    assert.equal(game.lane,0,'a single overshot swipe cannot cross a second lane');
    if(id===23){
      let commands=0;
      for(let x=endX+5;x<=endX+100;x+=5){frames(1);commands+=Math.abs(moveSwipe(id,x));}
      assert.equal(commands,0,'many continued pointermoves do not repeat a lane command');
      assert.equal(game.lane,0);
    }
    el('scene').fire('pointerup',touch(id,endX));frames(1);
  }
  // A slow but continuously sampled swipe remains one gesture; elapsed time alone cannot rearm it.
  game.lane=-1;game.x=-3.4;el('scene').fire('pointerdown',touch(24,180));let slowCommands=0;
  for(let x=185;x<=300;x+=5){frames(6);slowCommands+=Math.abs(moveSwipe(24,x));}
  assert.equal(slowCommands,1,'a slow continuous swipe is not split by duration');assert.equal(game.lane,0);
  // One large pointermove is one command too.
  el('scene').fire('pointerup',touch(24,300));game.lane=-1;game.x=-3.4;
  el('scene').fire('pointerdown',touch(25,180));assert.equal(moveSwipe(25,330),1);assert.equal(game.lane,0);
  // Holding at the endpoint, including duplicate events and minor jitter, stays latched.
  for(let i=0;i<8;i++){frames(1);moveSwipe(25,330);moveSwipe(25,332+(i%2));}
  sustainedHold(180);assert.equal(game.lane,0,'a long stationary hold after a swipe does not steer');
  // A tiny post-pause nudge is not enough to rearm, but a clear second swipe is.
  frames(24);assert.equal(moveSwipe(25,343),0,'small movement after a pause is not a new swipe');
  assert.equal(moveSwipe(25,365),0,'continuation after the small nudge remains the same swipe');
  frames(24);assert.equal(moveSwipe(25,400),1);assert.equal(game.lane,1,'a distinct swipe after a pause changes one more lane');assert.equal(game.thrusting,true);
  // Tiny endpoint jitter is not a reversal; a deliberate opposite swipe is.
  for(const x of [397,402,396])assert.equal(moveSwipe(25,x),0,'small endpoint jitter cannot rearm steering');
  assert.equal(moveSwipe(25,367),-1,'a deliberate direction reversal issues exactly one command');assert.equal(game.lane,0);assert.equal(game.thrusting,true);
  for(const x of [335,305,270,240])assert.equal(moveSwipe(25,x),0,'continuing the reversed swipe remains latched');
  el('scene').fire('pointerup',touch(25,240));frames(1);assert.equal(game.thrusting,false);
  game.lane=-1;game.x=-3.4;el('scene').fire('pointerdown',touch(27,180));
  assert.equal(moveSwipe(27,214),1);frames(22);
  assert.equal(moveSwipe(27,248),1,'a second same-direction swipe rearms after a brief genuine pause');assert.equal(game.lane,1);
  el('scene').fire('pointerup',touch(27,248));frames(1);
  // Airborne thrust and one long swipe remain independent.
  game.lane=-1;game.x=-3.4;game.vx=0;game.grounded=false;game.y=2;game.vy=0;game.pressure=1;
  el('scene').fire('pointerdown',touch(26,180));sustainedHold(30);
  assert.equal(game.lane,-1,'airborne stationary hold does not steer');
  assert.equal(moveSwipe(26,290),1);assert.equal(game.lane,0,'airborne long swipe changes only one lane');assert.equal(game.thrusting,true);
  el('scene').fire('pointerup',touch(26,290));frames(1);assert.equal(game.thrusting,false);
  game.grounded=true;game.y=0;game.vy=0;game.lane=-1;game.x=-3.4;
  el('scene').fire('pointerdown',touch(1));frames(30);assert.ok(Number(el('.segments').attrs['aria-valuenow'])<90);
  assert.equal(game.thrusting,true);assert.equal(el('thrust-cue').hidden,true);
  el('right').fire('pointerdown',touch(2));frames(5);assert.equal(game.lane,0,'steering button works during a separate thrust hold');
  el('scene').fire('pointerdown',touch(3,190));el('scene').fire('pointermove',touch(3,235));frames(5);
  assert.equal(game.lane,1,'another finger can swipe during thrust');assert.equal(game.thrusting,true);
  el('scene').fire('pointerup',touch(3,235));frames(1);assert.equal(game.thrusting,true,'one finger release keeps the other hold active');
  el('scene').fire('pointercancel',touch(1));frames(1);assert.equal(game.thrusting,false,'cancellation clears thrust');
  el('scene').fire('pointerdown',touch(4));frames(3);assert.equal(game.thrusting,true);
  el('scene').fire('pointerup',touch(4));frames(1);assert.equal(game.thrusting,false,'release stops thrust');
  game.lane=-1;game.x=-3.4;el('scene').fire('pointerdown',touch(28,180));assert.equal(moveSwipe(28,214),1);
  el('pause-button').fire('click');el('resume').fire('click');frames(1);const resumedLane=game.lane;
  assert.equal(game.thrusting,false);assert.equal(moveSwipe(28,330),0,'a stale pointer cannot steer after pause/resume');assert.equal(game.lane,resumedLane);
  el('scene').fire('pointerdown',touch(29,180));assert.equal(moveSwipe(29,214),1,'a fresh gesture works after pause');
  el('scene').fire('pointerup',touch(29,214));el('scene').fire('pointerup',touch(28,330));frames(1);
  el('pause-button').fire('click');const distance=el('distance').textContent,pausedCharge=game.charge;frames(80);assert.equal(el('distance').textContent,distance);assert.equal(game.charge,pausedCharge);assert.equal(el('pause').hidden,false);
  el('scene').fire('pointerdown',touch(5));el('pause').fire('pointerdown',touch(6));frames(1);assert.equal(game.thrusting,false,'pause overlay cannot start thrust');
  el('resume').fire('click');frames(20);assert.equal(el('pause').hidden,true);assert.equal(game.thrusting,false);
  window.fire('keydown',{code:'Space',repeat:false});frames(12);assert.equal(game.thrusting,true,'keyboard thrust remains available');
  window.fire('keyup',{code:'Space'});frames(1);assert.equal(game.thrusting,false);
  window.fire('blur');assert.equal(el('pause').hidden,false);el('resume').fire('click');
  // Reset and drive directly into the guaranteed first centre-lane car.
  el('retry').fire('click');frames(600);assert.equal(el('result').hidden,false);assert.equal(el('crash-reason').textContent,'TRAFFIC COLLISION');assert.ok(Number(saved.get('airshift.best.v1'))>100);
  el('result').fire('pointerdown',touch(11));frames(1);assert.equal(game.thrusting,false);
  const record=saved.get('airshift.best.v1');el('retry').fire('click');frames(1);assert.equal(el('result').hidden,true);assert.equal(el('distance').textContent,'0.00');assert.equal(el('.segments').attrs['aria-valuenow'],100);assert.equal(saved.get('airshift.best.v1'),record);
  // Storage errors must never prevent play or retry.
  localStorage.setItem=()=>{throw Error('Storage disabled');};frames(600);assert.equal(el('result').hidden,false);el('retry').fire('click');frames(1);assert.equal(el('controls').hidden,false);
  game.spawnIn=1e9;el('scene').fire('pointerdown',touch(7));frames(11);game.jumpPasses=2;
  el('scene').fire('pointerup',touch(7));frames(70);
  assert.equal(game.grounded,true);assert.equal(el('feedback').classes.has('show'),false,'a tiny hop cannot earn CAR JUMP or PERFECT LANDING');
  game.grounded=false;game.y=.005;game.vy=-3;game.roll=0;game.rollV=0;game.airTime=1.05;frames(1);
  assert.equal(el('feedback').textContent,'PERFECT LANDING');assert.equal(el('feedback').classes.has('show'),true);
  el('retry').fire('click');frames(1);game.time=5.6;frames(1);assert.equal(el('thrust-cue').hidden,true,'the teaching cue expires');
  game.spawnIn=Infinity;game.nextChargeArcAt=Infinity;game.charge=.5;
  spawnChargeArc(game);const orb=game.chargeArcs[0].orbs[0];
  game.grounded=false;game.y=orb.y-CHARGE.pickupCenterY-CHARGE.pickupY+.2;game.vy=0;game.x=orb.x;game.lane=Math.round(orb.x/3.4);orb.z=0;
  frames(1);assert.equal(orb.collected,true);assert.ok(game.charge>.5);
  assert.equal(el('charge-meter').classes.has('pickup'),true,'a pickup pulses the meter immediately');
  assert.ok(Number(el('charge-meter').attrs['aria-valuenow'])>50);
  frames(20);assert.equal(el('charge-meter').classes.has('pickup'),false,'pickup pulse is brief');
  game.spawnIn=Infinity;game.nextChargeArcAt=Infinity;game.charge=.001;
  frames(10);assert.equal(el('crash-reason').textContent,'OUT OF CHARGE');
  assert.equal(el('charge-meter').attrs['aria-valuenow'],0);
  assert.equal(game.dead,true);assert.equal(el('result').hidden,true,'hazards have time to flash before results');
  const emptyTime=game.time;frames(38);assert.equal(el('result').hidden,true);
  frames(32);assert.equal(el('result').hidden,false,'the result appears after the brief power-loss beat');
  assert.equal(game.time,emptyTime,'charge failure freezes simulation');
  el('retry').fire('click');frames(1);assert.ok(game.charge>.999,'the new run begins full and drains once gameplay advances');assert.equal(el('charge-meter').attrs['aria-valuenow'],100);
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="thrust"/);assert.match(html,/id="thrust-cue"/);
  assert.match(html,/<div id="controls"[^>]*>\s*<button id="left"[\s\S]*<button id="right"/);
});
