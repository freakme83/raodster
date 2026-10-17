// Dependency-free DOM harness: checks event wiring and screen transitions.
// This is not a substitute for a real mobile-browser playtest.
import test from 'node:test';
import assert from 'node:assert/strict';
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
  await import('../src/main.js');
  el('start').fire('click');frames(1);assert.equal(el('intro').hidden,true);assert.equal(el('controls').hidden,false);
  el('thrust').fire('pointerdown',{pointerId:1});frames(30);assert.ok(Number(el('.segments').attrs['aria-valuenow'])<90);
  el('left').fire('pointerdown',{pointerId:2});frames(5); // second thumb does not cancel thrust
  assert.ok(el('thrust').classes.has('active'));
  el('thrust').fire('pointercancel',{pointerId:1});frames(1);assert.equal(el('thrust').classes.has('active'),false);
  el('pause-button').fire('click');const distance=el('distance').textContent;frames(80);assert.equal(el('distance').textContent,distance);assert.equal(el('pause').hidden,false);
  el('resume').fire('click');frames(20);assert.equal(el('pause').hidden,true);assert.equal(el('thrust').classes.has('active'),false);
  window.fire('blur');assert.equal(el('pause').hidden,false);el('resume').fire('click');
  // Reset and drive directly into the guaranteed first centre-lane car.
  el('retry').fire('click');frames(600);assert.equal(el('result').hidden,false);assert.equal(el('crash-reason').textContent,'TRAFFIC COLLISION');assert.ok(Number(saved.get('airshift.best.v1'))>100);
  const record=saved.get('airshift.best.v1');el('retry').fire('click');frames(1);assert.equal(el('result').hidden,true);assert.equal(el('distance').textContent,'0.00');assert.equal(el('.segments').attrs['aria-valuenow'],100);assert.equal(saved.get('airshift.best.v1'),record);
  // Storage errors must never prevent play or retry.
  localStorage.setItem=()=>{throw Error('Storage disabled');};frames(600);assert.equal(el('result').hidden,false);el('retry').fire('click');frames(1);assert.equal(el('controls').hidden,false);
});
