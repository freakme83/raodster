import {clamp} from './physics.js';
import {CHARGE} from './charge.js';
const mix=(a,b,t)=>a+(b-a)*t;
function shade(hex,f){const n=parseInt(hex.slice(1),16);return `rgb(${Math.round((n>>16)*f)},${Math.round((n>>8&255)*f)},${Math.round((n&255)*f)})`;}
export class Renderer {
  constructor(canvas,{reducedMotion=false}={}){this.canvas=canvas;this.c=canvas.getContext('2d',{alpha:false});if(!this.c)throw Error('Canvas unavailable');this.w=390;this.h=844;this.lift=0;this.reducedMotion=reducedMotion;}
  resize(w,h,dpr=1){this.w=w;this.h=h;this.dpr=Math.min(dpr,2);this.canvas.width=Math.round(w*this.dpr);this.canvas.height=Math.round(h*this.dpr);}
  point(x,y,z){const depth=z+this.depth;if(depth<.5)return null;const s=this.f/depth;return{x:this.w/2+(x-this.camX)*s,y:this.horizon+(this.camY-y)*s,s};}
  poly(points,color){const c=this.c;c.fillStyle=color;c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fill();}
  world(points,color){const ps=points.map(p=>this.point(...p));if(ps.every(Boolean))this.poly(ps,color);}
  background(){
    const c=this.c,w=this.w,h=this.h,hy=this.horizon;
    const sky=c.createLinearGradient(0,0,0,hy+100);sky.addColorStop(0,'#b7becd');sky.addColorStop(.58,'#efbdad');sky.addColorStop(1,'#ffe0b5');c.fillStyle=sky;c.fillRect(0,0,w,h);
    const sunX=w*.76,sunY=hy*.68,r=Math.min(w*.11,75);const glow=c.createRadialGradient(sunX,sunY,r*.3,sunX,sunY,r*2.4);glow.addColorStop(0,'#ffefc67a');glow.addColorStop(1,'#ffefc600');c.fillStyle=glow;c.fillRect(sunX-r*3,sunY-r*3,r*6,r*6);c.fillStyle='#ffe4b6';c.beginPath();c.arc(sunX,sunY,r,0,Math.PI*2);c.fill();
    this.poly([{x:0,y:hy-18},{x:w*.08,y:hy-28},{x:w*.17,y:hy-66},{x:w*.25,y:hy-49},{x:w*.33,y:hy-17},{x:w*.42,y:hy-37},{x:w*.53,y:hy-32},{x:w*.64,y:hy-58},{x:w*.73,y:hy-43},{x:w*.82,y:hy-69},{x:w,y:hy-20},{x:w,y:hy+70},{x:0,y:hy+70}],'#b8a2ad');
    this.poly([{x:0,y:hy+7},{x:w*.15,y:hy-15},{x:w*.27,y:hy+12},{x:w*.4,y:hy-9},{x:w*.55,y:hy+14},{x:w*.69,y:hy-14},{x:w*.81,y:hy+9},{x:w,y:hy-9},{x:w,y:h},{x:0,y:h}],'#a9b2a2');
    c.fillStyle='#9aaa98';c.fillRect(0,hy+38,w,h);
    // Sparse distant architecture; never competes with traffic silhouettes.
    c.fillStyle='#aca6ad';for(let i=0;i<12;i++){const x=w*(.36+i*.018),height=4+(i*19%17);c.fillRect(x,hy-height,w*.009,height+8);}
  }
  ground(g){
    const dist=g.distance;
    this.world([[-7.8,0,-8],[-7.8,0,450],[7.8,0,450],[7.8,0,-8]],'#c8bba1');
    this.world([[-5.7,.01,-8],[-5.7,.01,450],[5.7,.01,450],[5.7,.01,-8]],'#66616b');
    this.world([[-5.25,.025,-8],[-5.25,.025,450],[5.25,.025,450],[5.25,.025,-8]],'#555262');
    for(let z=320;z>-8;z-=8){const near=Math.max(-8,z-8);if((Math.floor((dist+z)/8)&1)===0)this.world([[-5.22,.03,near],[-5.22,.03,z],[5.22,.03,z],[5.22,.03,near]],'#575463');}
    for(const x of [-5.3,5.3])this.world([[x-.06,.06,-8],[x-.06,.06,420],[x+.06,.06,420],[x+.06,.06,-8]],'#f3dcb4');
    const phase=dist%11;
    for(let z=320-phase;z>-8;z-=11){if(z-4<-8)continue;for(const x of [-1.7,1.7])this.world([[x-.045,.07,z-4],[x-.045,.07,z],[x+.045,.07,z],[x+.045,.07,z-4]],'#c7bebd');}
    // Quiet wear tracks and roadside curbs.
    for(const x of [-3.85,-2.95,-.45,.45,2.95,3.85])this.world([[x-.07,.04,-8],[x-.07,.04,150],[x+.07,.04,150],[x+.07,.04,-8]],'#504e5e');
    for(let z=280-dist%9;z>-8;z-=9){if(z-4<-8)continue;for(const x of [-5.65,5.45])this.world([[x,.05,z-4],[x,.05,z],[x+.2,.05,z],[x+.2,.05,z-4]],'#e3d0b1');}
  }
  addFace(vertices,color,faces){faces.push({vertices,color,z:vertices.reduce((s,v)=>s+v[2],0)/vertices.length});}
  box(x,y,z,w,h,l,color,faces,transform=null){
    const v=[[-w/2,0,-l/2],[w/2,0,-l/2],[w/2,0,l/2],[-w/2,0,l/2],[-w/2,h,-l/2],[w/2,h,-l/2],[w/2,h,l/2],[-w/2,h,l/2]].map(([a,b,d])=>transform?transform(a+x,b+y,d+z):[a+x,b+y,d+z]);
    for(const [idx,f] of [[[0,1,5,4],.72],[[1,2,6,5],.83],[[2,3,7,6],.8],[[3,0,4,7],.94],[[4,5,6,7],1.06]])this.addFace(idx.map(i=>v[i]),shade(color,f),faces);
  }
  playerShadow(v,g){
    const height=Math.max(0,g.y),spread=1+Math.min(height,8)*.015;
    const outline=[[-.39,-.5],[-.49,-.43],[-.52,-.18],[-.49,.14],[-.39,.4],[-.27,.5],[.27,.5],[.39,.4],[.49,.14],[.52,-.18],[.49,-.43],[.39,-.5]];
    const footprint=outline.map(([x,z])=>[v.x+x*v.width*spread,.08,v.z+z*v.length*spread]);
    const opacity=.15/(1+height*.5),c=this.c;
    c.save();c.shadowColor=`rgba(27,29,37,${opacity*.85})`;c.shadowBlur=12+Math.min(height,8)*4;
    this.world(footprint,`rgba(27,29,37,${opacity})`);
    c.restore();
  }
  car(v,player,g,faces){
    const w=v.width,l=v.length,h=v.height;
    let roll=player?g.roll:0,pitch=player?g.pitch:0;
    if(player&&g.dead){roll+=Math.sign(g.roll||1)*this.crashPose*.7;pitch+=this.crashPose*.2;}
    const squash=player?g.impact*.16+g.preload*.6:0;
    const transform=(x,y,z)=>{
      const yy=y-squash,ry=yy*Math.cos(roll)+x*Math.sin(roll),rx=x*Math.cos(roll)-yy*Math.sin(roll);
      return[v.x+rx,(player?g.y:0)+ry*Math.cos(pitch)-z*Math.sin(pitch),v.z+z*Math.cos(pitch)+ry*Math.sin(pitch)];
    };
    if(player)this.playerShadow(v,g);
    else {const ground=this.point(v.x,.08,v.z);if(ground){const c=this.c;c.fillStyle='#25263336';c.beginPath();c.ellipse(ground.x,ground.y,w*.72*ground.s,l*.22*ground.s,0,0,Math.PI*2);c.fill();}}
    const box=(x,y,z,bw,bh,bl,col)=>this.box(x,y,z,bw,bh,bl,col,faces,transform);
    for(const sx of [-1,1])for(const sz of [-1,1]){box(sx*w*.46,.12,sz*l*.32,.24,.44,l>.0?Math.min(.72,l*.2):.7,'#2d3040');box(sx*w*.52,.23,sz*l*.32,.025,.2,.31,'#929b9b');}
    if(player){
      const body=[[-w*.49,.18,-l*.5],[w*.49,.18,-l*.5],[w*.37,.17,l*.5],[-w*.37,.17,l*.5],[-w*.48,.67,-l*.5],[w*.48,.67,-l*.5],[w*.37,.48,l*.5],[-w*.37,.48,l*.5]].map(p=>transform(...p));
      for(const [ids,col] of [[[0,1,5,4],'#d9d6d0'],[[1,2,6,5],'#dedbd6'],[[2,3,7,6],'#e8e5df'],[[3,0,4,7],'#ebe8e2'],[[4,5,6,7],'#f4f1ea']])this.addFace(ids.map(i=>body[i]),col,faces);
    }else box(0,.3,0,w,.4,l,v.color);
    if(player){
      // Low white deck, broad rear shoulders and a compact dark greenhouse.
      box(0,.56,.07,w*.84,.15,l*.74,'#f0ede7');
      for(const sx of [-1,1]){
        const shoulder=[[sx*w*.25,.66,-l*.48],[sx*w*.49,.58,-l*.47],[sx*w*.48,.63,-l*.17],[sx*w*.32,.72,-l*.11]].map(p=>transform(...p));
        this.addFace(shoulder,'#e8e5de',faces);
        box(sx*w*.39,.51,-l*.27,w*.18,.18,l*.39,'#eeeae3');
        box(sx*w*.37,.35,l*.31,w*.18,.21,l*.31,'#eeeae3');
      }
      const canopy=[[-w*.28,.72,-l*.20],[w*.28,.72,-l*.20],[w*.245,1.13,l*.015],[-w*.245,1.13,l*.015],[-w*.245,1.13,l*.22],[w*.245,1.13,l*.22],[w*.30,.72,l*.36],[-w*.30,.72,l*.36]].map(p=>transform(...p));
      for(const [ids,col] of [[[0,1,2,3],'#354550'],[[3,2,5,4],'#e7e7e1'],[[4,5,6,7],'#52636a'],[[0,3,4,7],'#52636a'],[[1,6,5,2],'#354550']])this.addFace(ids.map(i=>canopy[i]),col,faces);
      box(0,.52,-l*.503,w*.91,.13,.045,'#343d48');
      for(const sx of [-1,1]){
        box(sx*w*.275,.605,-l*.516,w*.36,.052,.028,'#f48e91');
        box(sx*w*.35,.33,-l*.512,.22,.13,.055,'#283640');
        box(sx*w*.515,.47,-l*.27,.085,.12,.22,'#667984');
      }
      box(0,.34,-l*.515,w*.16,.07,.03,'#c5c5bf');
    }else if(v.type>=3){
      const cargo=v.type>=4;
      box(0,.7,cargo?-l*.15:0,w*.96,h-.7,l*(cargo?.69:.91),v.color);
      if(cargo){box(0,.7,l*.36,w*.94,1.25,l*.25,v.color);box(0,1.45,l*.49,w*.8,.4,.035,'#526b76');}
      else box(0,1.25,-l*.46,w*.75,.56,.035,'#5c737e');
      box(0,.83,-l*.48,w*.78,.08,.035,'#969fa4');
      if(cargo)box(0,1.1,-l*.5,.04,h-1.3,.04,'#9c9aa7');
    }else{
      box(0,.7,0,w*.79,h-.7,l*.52,v.color);
      box(0,.78,-l*.266,w*.68,Math.max(.15,h-.86),.035,'#4e6576');
      box(0,h,.04,w*.73,.04,l*.35,shade(v.color,1.1));
    }
    if(!player)for(const sx of [-1,1])box(sx*w*.35,.48,-l*.51,w*.16,.12,.035,'#f3898d');
    if(player&&g.thrusting&&!g.grounded){
      const t=g.time,c=this.c;
      for(const sx of [-1,1]){const a=this.point(...transform(sx*w*.39,.23,-l*.25)),b=this.point(...transform(sx*w*.39,-.7-(Math.sin(t*40)+1)*.23,-l*.25));if(a&&b){const grad=c.createLinearGradient(a.x,a.y,b.x,b.y);grad.addColorStop(0,'#ecffd9');grad.addColorStop(.35,'#b4ffe8b0');grad.addColorStop(1,'#d0ffef00');this.poly([{x:a.x-a.s*.09,y:a.y},{x:a.x+a.s*.09,y:a.y},{x:b.x+b.s*.18,y:b.y},{x:b.x-b.s*.18,y:b.y}],grad);}}
    }
    return player?transform:null;
  }
  lateralJets(g,transform){
    if(g.dead||g.grounded)return;
    const sideways=Math.abs(g.vx),correction=Math.abs(g.roll)>.025?Math.abs(g.rollV):0;
    if(sideways<.4&&correction<.14)return;
    const direction=sideways>.4?Math.sign(g.vx):-Math.sign(g.rollV);
    if(!direction)return;
    const side=-direction, strength=clamp(Math.max(sideways/7.2,correction/2.5),.2,1);
    const pulse=.88+.12*Math.sin(g.time*36),reach=(.32+strength*.5)*pulse;
    const origin=transform(side*1.02,.48,-1.02),tip=transform(side*(1.02+reach),.47,-1.08);
    const a=this.point(...origin),b=this.point(...tip);if(!a||!b)return;
    const c=this.c,grad=c.createLinearGradient(a.x,a.y,b.x,b.y);
    grad.addColorStop(0,`rgba(241,255,239,${.85*strength})`);
    grad.addColorStop(.45,`rgba(174,244,235,${.65*strength})`);
    grad.addColorStop(1,'rgba(191,246,243,0)');
    this.poly([{x:a.x,y:a.y-a.s*.05},{x:a.x,y:a.y+a.s*.05},{x:b.x,y:b.y+b.s*.14},{x:b.x,y:b.y-b.s*.14}],grad);
    c.strokeStyle=`rgba(245,255,246,${.55*strength})`;c.lineWidth=Math.max(1,a.s*.018);
    c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
  }
  chargeOrb(orb,time){
    const p=this.point(orb.x,orb.y,orb.z);if(!p)return;
    const c=this.c,r=Math.min(16,Math.max(4.2,p.s*.8));
    const halo=r*1.33,glow=c.createRadialGradient(p.x,p.y,r*.65,p.x,p.y,halo);
    glow.addColorStop(0,'#d6a55a35');glow.addColorStop(1,'#d6a55a00');
    c.fillStyle=glow;c.fillRect(p.x-halo,p.y-halo,halo*2,halo*2);
    const shimmer=this.reducedMotion?1:.95+.05*Math.sin(time*8+orb.index*1.7);
    const size=r*shimmer;
    this.poly([{x:p.x,y:p.y-size},{x:p.x+size*.77,y:p.y-size*.23},{x:p.x+size*.72,y:p.y+size*.47},{x:p.x,y:p.y+size},{x:p.x-size*.72,y:p.y+size*.47},{x:p.x-size*.77,y:p.y-size*.23}],'#d49e57');
    this.poly([{x:p.x,y:p.y-size*.69},{x:p.x+size*.4,y:p.y},{x:p.x,y:p.y+size*.56},{x:p.x-size*.4,y:p.y}],'#edd19c');
  }
  chargePop(pop){
    const p=this.point(pop.x,pop.y,pop.z);if(!p)return;
    const t=Math.min(1,pop.age/CHARGE.popDuration),size=Math.min(14,Math.max(4,p.s*.65))*(1-t*.72);
    this.poly([{x:p.x,y:p.y-size},{x:p.x+size*.65,y:p.y},{x:p.x,y:p.y+size},{x:p.x-size*.65,y:p.y}],`rgba(244,209,147,${.8*(1-t)})`);
  }
  scenery(g,faces){
    for(let i=0;i<19;i++){
      const z=330-i*20-g.distance%20;if(z<-6)continue;const worldIndex=Math.floor(g.distance/20)-i;
      for(const side of [-1,1]){
        const x=side*6.6;this.box(x,0,z,.11,.85,.12,'#ded9c0',faces);this.box(x,.59,z,.15,.16,.14,'#f9dcad',faces);
        if(worldIndex%5===0){this.box(side*9.1,0,z,.14,7,.14,'#68777b',faces);this.box(side*8.1,6.9,z,2.1,.12,.18,'#68777b',faces);this.box(side*7.25,6.8,z,.6,.08,.32,'#ffedca',faces);}
        if(worldIndex%3===0){const t=side*(11+((worldIndex%4+4)%4)*3);this.box(t,0,z,.25,1.2,.3,'#8f9381',faces);this.box(t,.7,z,1.5,.8,1.5,'#8eaa94',faces);this.box(t,1.2,z,1,.6,1,'#a3b69b',faces);}
      }
    }
    // Direction markers for all-lane blocks live beside the obstacle, not on the HUD.
    const walls=g.traffic.filter(v=>v.wall&&v.lane===1&&v.z>2&&v.z<200);
    for(const v of walls){this.box(6.4,0,v.z+7,.12,3,.12,'#777a79',faces);this.box(6.4,2.4,v.z+7,1.7,.9,.13,'#edd6a0',faces);}
  }
  render(g,mode='playing',dt=1/60,crashAge=0){
    const c=this.c,w=this.w,h=this.h;c.setTransform(this.dpr,0,0,this.dpr,0,0);
    this.lift=mix(this.lift,Math.min(g.y*.3,2.5),Math.min(1,dt*3));
    this.depth=12;this.f=Math.min(w*1.15,h*.98);this.horizon=h*.29;
    this.camY=(h*.69-this.horizon)*this.depth/this.f+this.lift+(this.reducedMotion?0:g.impact*.14);
    this.camX=g.x*.1;this.crashPose=clamp(crashAge*1.7,0,1);
    this.background();this.ground(g);
    const faces=[];this.scenery(g,faces);
    for(const v of [...g.traffic].sort((a,b)=>b.z-a.z))if(v.z>-6&&v.z<380)this.car(v,false,g,faces);
    const playerTransform=this.car({x:g.x,z:0,width:2.04,length:3.85,height:1.15,color:'#eeeae3'},true,g,faces);
    for(const arc of g.chargeArcs)for(const orb of arc.orbs)if(!orb.collected&&!orb.missed&&orb.z>-6&&orb.z<330)faces.push({z:orb.z,draw:()=>this.chargeOrb(orb,g.time)});
    faces.sort((a,b)=>b.z-a.z);for(const face of faces)if(face.draw)face.draw();else this.world(face.vertices,face.color);
    for(const pop of g.orbPops)this.chargePop(pop);
    this.lateralJets(g,playerTransform);
    for(const v of g.traffic){if(v.wall&&v.lane===1&&v.z>2&&v.z<200){const p=this.point(6.4,2.8,v.z+6.9);if(p){c.fillStyle='#58505c';c.textAlign='center';c.font=`bold ${Math.max(5,p.s*.35)}px Arial`;c.fillText('LIFT ↑',p.x,p.y);}}}
    if(g.dead&&crashAge<.18&&!this.reducedMotion){c.fillStyle=`rgba(255,226,195,${(.18-crashAge)*2})`;c.fillRect(0,0,w,h);}
    const vignette=c.createLinearGradient(0,h*.72,0,h);vignette.addColorStop(0,'#27293800');vignette.addColorStop(1,'#272938b8');c.fillStyle=vignette;c.fillRect(0,h*.72,w,h*.28);
  }
}
