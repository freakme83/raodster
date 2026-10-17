export class AudioEngine {
  constructor(){this.ctx=null;this.enabled=true;this.nextNote=0;this.note=0;}
  async start(){
    if(!this.ctx){
      const AC=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AC)return;
      this.ctx=new AC();const c=this.ctx;
      this.master=c.createGain();this.master.gain.value=.55;this.master.connect(c.destination);
      this.engine=c.createOscillator();this.engine.type='triangle';this.engine.frequency.value=48;
      this.motor=c.createGain();this.motor.gain.value=0;this.engine.connect(this.motor);this.motor.connect(this.master);this.engine.start();
      const buffer=c.createBuffer(1,c.sampleRate*2,c.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      this.noiseBuffer=buffer;this.noise=c.createBufferSource();this.noise.buffer=buffer;this.noise.loop=true;
      const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1200;
      this.air=c.createGain();this.air.gain.value=0;this.noise.connect(filter);filter.connect(this.air);this.air.connect(this.master);this.noise.start();
    }
    try{await this.ctx.resume();}catch{}
  }
  tone(freq,duration=.12,volume=.12,type='sine',end=freq,delay=0){
    if(!this.ctx||!this.enabled)return;const c=this.ctx,t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(volume,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+duration+.02);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  noiseHit(duration,volume){if(!this.ctx||!this.enabled)return;const c=this.ctx,t=c.currentTime,n=c.createBufferSource(),g=c.createGain();n.buffer=this.noiseBuffer;g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);n.connect(g);g.connect(this.master);n.start();n.stop(t+duration);n.onended=()=>{n.disconnect();g.disconnect();};}
  event(e){
    if(e.type==='lane')this.noiseHit(.08,.04);
    if(e.type==='launch')this.tone(90,.18,.13,'sine',180);
    if(e.type==='charged')this.tone(660,.1,.04,'sine',880);
    if(e.type==='close')this.tone(430,.12,.07,'sine',720);
    if(e.type==='landing'){this.tone(75,.22,e.quality==='rough'?.23:.13,'triangle',35);this.noiseHit(.1,.06);if(e.quality==='perfect'){this.tone(660,.17,.11);this.tone(990,.24,.08,'sine',990,.1);}}
    if(e.type==='crash'){this.noiseHit(.65,.45);this.tone(140,.5,.3,'sawtooth',22);}
  }
  update(g,playing){
    if(!this.ctx)return;const c=this.ctx,t=c.currentTime,on=playing&&this.enabled;
    this.motor.gain.setTargetAtTime(on?.045:0,t,.1);this.engine.frequency.setTargetAtTime(43+g.speed*.75+g.vy*.25,t,.15);
    this.air.gain.setTargetAtTime(on?(g.thrusting?.13:.006):0,t,.04);
    // Sparse original pentatonic sequence, intentionally quieter than road sounds.
    if(on&&t>=this.nextNote){const notes=[220,0,329.63,0,293.66,0,196,0,220,0,440,329.63,0,293.66,0,196];const f=notes[this.note++%notes.length];if(f)this.tone(f,.44,.022,'triangle');this.nextNote=t+.28;}
  }
  setEnabled(value){this.enabled=value;if(this.ctx)this.master.gain.setTargetAtTime(value?.55:0,this.ctx.currentTime,.05);}
}
