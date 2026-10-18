import {createGame,step,moveLane,CONFIG,clamp} from './physics.js';
import {CHARGE} from './charge.js';
import {Renderer} from './renderer.js';
import {AudioEngine} from './audio.js';
const $=id=>document.getElementById(id);
const ui=Object.fromEntries(['hud','intro','result','pause','controls','pause-button','feedback','flight-hint','thrust-cue','distance','intro-best','final-distance','final-best','crash-reason','crash-tip','best-line','pressure-label','charge-meter','charge-fill','charge-label'].map(id=>[id,$(id)]));
const segments=[...document.querySelectorAll('.segments b')],meter=document.querySelector('.segments');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer;
try{renderer=new Renderer($('scene'),{reducedMotion});}catch{$('fatal').hidden=false;throw Error('Canvas rendering is not available');}
const audio=new AudioEngine();
const read=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
const write=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
let best=Number(read('airshift.best.v1','0'));if(!Number.isFinite(best)||best<0)best=0;
audio.setEnabled(read('airshift.sound.v1','on')!=='off');
let g=createGame(),mode='intro',accumulator=0,lastTime=0,crashAge=0,feedbackUntil=0,chargePulseUntil=0,runBest=best,shownFlightHint=false;
let thrustPointers=new Set(),keys=new Set(),swipes=new Map(),usedThrust=false;
const format=m=>(m/1000).toFixed(2);
ui['intro-best'].textContent=format(best);
const resize=()=>{const box=$('game').getBoundingClientRect();renderer.resize(box.width,box.height,devicePixelRatio||1);};
new ResizeObserver(resize).observe($('game'));resize();
function clearInput(){thrustPointers.clear();keys.clear();swipes.clear();}
function setMode(next){mode=next;ui.intro.hidden=next!=='intro';ui.result.hidden=next!=='result';ui.pause.hidden=next!=='paused';ui.hud.hidden=!['playing','crashing','paused'].includes(next);ui.controls.hidden=next!=='playing';ui['pause-button'].hidden=next!=='playing';if(next!=='playing'){clearInput();ui['flight-hint'].hidden=true;ui['thrust-cue'].hidden=true;ui.feedback.classList.remove('show');ui['charge-meter'].classList.remove('pickup');}accumulator=0;}
function start(){clearInput();g=createGame();renderer.lift=0;crashAge=0;feedbackUntil=0;chargePulseUntil=0;shownFlightHint=false;usedThrust=false;runBest=best;setMode('playing');ui['charge-meter'].classList.remove('pickup');audio.start().catch(()=>{});$('start').blur();$('retry').blur();}
function message(text,duration=1.4){ui.feedback.textContent=text;ui.feedback.classList.add('show');feedbackUntil=g.time+duration;}
function pause(){if(mode!=='playing')return;setMode('paused');audio.update(g,false);$('sound').textContent=audio.enabled?'SOUND ON':'SOUND OFF';}
function resume(){if(mode!=='paused')return;clearInput();setMode('playing');lastTime=performance.now();audio.start().catch(()=>{});}
function end(){setMode('crashing');crashAge=0;best=Math.max(best,g.distance);write('airshift.best.v1',String(best));ui['final-distance'].textContent=format(g.distance);ui['final-best'].textContent=format(best);ui['best-line'].classList.toggle('new-best',g.distance>runBest);ui['crash-reason'].textContent=g.reason;ui['crash-tip'].textContent=({'HARD LANDING':'Keep a little pressure. A short burst just before touchdown softens the fall.','LANDED SIDEWAYS':'Finish your lane change earlier. Give the car a moment to level out.','OFF THE ROAD':'Stay over the highway. Air steering needs a little room to settle.','TRAFFIC COLLISION':'Find a gap, or lift earlier. Your wheels need to clear the roof.','OUT OF CHARGE':'Airborne charge orbs refill the meter. Take what you can, then land safely.'})[g.reason]||'Find your rhythm. One more run.';}
function events(){for(const e of g.events){audio.event(e);if(e.type==='orb'){chargePulseUntil=g.time+CHARGE.popDuration;ui['charge-meter'].classList.remove('pickup');void ui['charge-meter'].offsetWidth;ui['charge-meter'].classList.add('pickup');}if(e.type==='landing'){if(e.quality==='perfect')message(e.passed>1?`PERFECT · ${e.passed} CAR JUMP`:'PERFECT LANDING');else if(e.quality==='rough')message('ROUGH LANDING');else if(e.meaningfulJump&&e.passed)message(`${e.passed} CAR JUMP`);else if(e.meaningfulJump)message('CLEAN LANDING');if(!reducedMotion&&navigator.vibrate)navigator.vibrate(e.quality==='rough'?24:10);}if(e.type==='fullArc')message('FULL ARC',1.2);if(e.type==='close')message('CLOSE CALL',.8);if(e.type==='crash')end();}g.events.length=0;}
function steer(dir){if(mode==='playing')moveLane(g,dir);}
$('start').addEventListener('click',start);$('retry').addEventListener('click',start);$('resume').addEventListener('click',resume);$('pause-button').addEventListener('click',pause);
ui.intro.addEventListener('click',e=>{if(!e.target.closest('button'))start();});
ui.result.addEventListener('click',e=>{if(!e.target.closest('button'))start();});
$('sound').addEventListener('click',()=>{audio.setEnabled(!audio.enabled);write('airshift.sound.v1',audio.enabled?'on':'off');$('sound').textContent=audio.enabled?'SOUND ON':'SOUND OFF';});
for(const [id,dir] of [['left',-1],['right',1]]){$(id).addEventListener('pointerdown',e=>{e.preventDefault();steer(dir);});$(id).addEventListener('click',e=>{if(e.detail===0)steer(dir);});}
const release=e=>{thrustPointers.delete(e.pointerId);swipes.delete(e.pointerId);};
// Each canvas touch can hold thrust and steer independently; buttons and overlays never enter this path.
$('scene').addEventListener('pointerdown',e=>{if(mode==='intro'){start();return;}if(mode==='result'){start();return;}if(mode!=='playing')return;swipes.set(e.pointerId,{anchorX:e.clientX,anchorY:e.clientY});if(e.pointerType==='touch')thrustPointers.add(e.pointerId);$('scene').setPointerCapture(e.pointerId);});
$('scene').addEventListener('pointermove',e=>{const swipe=swipes.get(e.pointerId);if(!swipe)return;const dx=e.clientX-swipe.anchorX,dy=e.clientY-swipe.anchorY;if(Math.abs(dx)>26&&Math.abs(dx)>Math.abs(dy)*1.2){steer(Math.sign(dx));swipe.anchorX=e.clientX;swipe.anchorY=e.clientY;}});
$('scene').addEventListener('pointerup',release);
for(const name of ['pointercancel','lostpointercapture'])$('scene').addEventListener(name,release);
window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);
window.addEventListener('keydown',e=>{
  const handled=['ArrowLeft','ArrowRight','ArrowUp','Space','KeyA','KeyD','KeyW','Escape','KeyP','Enter'];if(!handled.includes(e.code))return;
  // Focused buttons retain their ordinary keyboard activation outside a run.
  if(mode!=='playing'&&document.activeElement?.tagName==='BUTTON'&&['Space','Enter'].includes(e.code))return;
  e.preventDefault();if(e.repeat)return;
  if((mode==='intro'||mode==='result')&&['Space','Enter'].includes(e.code)){start();return;}
  if(mode==='paused'&&['Space','Enter','Escape','KeyP'].includes(e.code)){resume();return;}
  if(mode!=='playing')return;
  if(['Escape','KeyP'].includes(e.code)){pause();return;}
  keys.add(e.code);if(['ArrowLeft','KeyA'].includes(e.code))steer(-1);if(['ArrowRight','KeyD'].includes(e.code))steer(1);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{clearInput();pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();pause();}});
function frame(now){
  const dt=Math.min((now-lastTime)/1000||0,1/20);lastTime=now;
  if(mode==='playing'){
    accumulator+=dt;
    const thrust=thrustPointers.size>0||['Space','ArrowUp','KeyW'].some(k=>keys.has(k));
    while(accumulator>=CONFIG.step&&mode==='playing'){step(g,{thrust},CONFIG.step);events();accumulator=Math.max(0,accumulator-CONFIG.step);}
    ui.distance.textContent=format(g.distance);
    segments.forEach((s,i)=>s.style.transform=`scaleX(${clamp(g.pressure*3-i,0,1)})`);
    meter.setAttribute('aria-valuenow',Math.round(g.pressure*100));
    document.querySelector('.pressure').classList.toggle('low',g.pressure<.22);
    ui['pressure-label'].textContent=g.pressure<.03?'EMPTY':g.grounded&&g.pressure<.99&&!g.thrusting?'RECHARGING':'PRESSURE';
    ui['charge-fill'].style.transform=`scaleX(${g.charge})`;
    ui['charge-meter'].setAttribute('aria-valuenow',Math.round(g.charge*100));
    ui['charge-meter'].classList.toggle('low',g.charge<CHARGE.lowThreshold);
    ui['charge-label'].textContent=g.charge<CHARGE.lowThreshold?'LOW CHARGE':'CHARGE';
    if(g.time>=chargePulseUntil)ui['charge-meter'].classList.remove('pickup');
    if(g.thrusting)usedThrust=true;
    ui['thrust-cue'].hidden=usedThrust||g.time<.4||g.time>5.5||!g.grounded;
    if(g.time>feedbackUntil)ui.feedback.classList.remove('show');
    if(!g.grounded&&!shownFlightHint){ui['flight-hint'].hidden=false;shownFlightHint=true;}
    if(g.grounded)ui['flight-hint'].hidden=true;
  }else if(mode==='intro'){g.distance+=dt*8;g.time+=dt;}
  else if(mode==='crashing'){crashAge+=dt;if(crashAge>(g.reason==='OUT OF CHARGE'?.86:.7))setMode('result');}
  renderer.render(g,mode,dt,crashAge);audio.update(g,mode==='playing');requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
