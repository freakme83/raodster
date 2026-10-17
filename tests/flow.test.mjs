// Dependency-free DOM harness: checks event wiring and screen transitions.
// This is not a substitute for a real mobile-browser playtest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Renderer} from '../src/renderer.js';
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
  const touch=(pointerId,x=195,y=400)=>({pointerId,pointerType:'touch',clientX:x,clientY:y});
  el('pause-button').fire('pointerdown',touch(9));el('left').fire('pointerdown',touch(8));frames(25);
  assert.equal(game.pressure,1,'UI controls do not start thrust');
  frames(4);assert.equal(el('thrust-cue').hidden,false,'a short run teaches the gesture');
  el('scene').fire('pointerdown',touch(1));frames(30);assert.ok(Number(el('.segments').attrs['aria-valuenow'])<90);
  assert.equal(game.thrusting,true);assert.equal(el('thrust-cue').hidden,true);
  el('right').fire('pointerdown',touch(2));frames(5);assert.equal(game.lane,0,'steering button works during a separate thrust hold');
  el('scene').fire('pointerdown',touch(3,190));el('scene').fire('pointermove',touch(3,235));frames(5);
  assert.equal(game.lane,1,'another finger can swipe during thrust');assert.equal(game.thrusting,true);
  el('scene').fire('pointerup',touch(3,235));frames(1);assert.equal(game.thrusting,true,'one finger release keeps the other hold active');
  el('scene').fire('pointercancel',touch(1));frames(1);assert.equal(game.thrusting,false,'cancellation clears thrust');
  el('scene').fire('pointerdown',touch(4));frames(3);assert.equal(game.thrusting,true);
  el('scene').fire('pointerup',touch(4));frames(1);assert.equal(game.thrusting,false,'release stops thrust');
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
  game.spawnIn=Infinity;game.nextChargeArcAt=Infinity;game.charge=.001;
  frames(10);assert.equal(el('crash-reason').textContent,'OUT OF CHARGE');
  assert.equal(el('charge-meter').attrs['aria-valuenow'],0);
  const emptyTime=game.time;frames(70);assert.equal(game.time,emptyTime,'charge failure freezes simulation');
  el('retry').fire('click');frames(1);assert.ok(game.charge>.999,'the new run begins full and drains once gameplay advances');assert.equal(el('charge-meter').attrs['aria-valuenow'],100);
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="thrust"/);assert.match(html,/id="thrust-cue"/);
  assert.match(html,/<div id="controls"[^>]*>\s*<button id="left"[\s\S]*<button id="right"/);
});
