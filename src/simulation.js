/* Shared predictive response calibration for the interactive voltage demo.
 * Uses the manuscript communication plant and a five sample LQR preview.
 * This restricted shared multiplier is not the full delayed FIR projected
 * response algorithm and does not inherit that algorithm's regret theorem.
 * Every controller receives the same immutable disturbance and forecast pair.
 * Costs use x_t' Q x_t + u_t' R u_t, with no terminal cost.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PowerDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const N = 24;
  const AMPLITUDE = 0.006;
  const RAW_RIDGE = 1.27e-5;
  // Mean squared forecast loss is normalized by AMPLITUDE squared. The raw
  // ridge value follows the voltage experiment, but this explicit mean loss
  // differs from the manuscript's full response weighted objective.
  const RIDGE = RAW_RIDGE / (AMPLITUDE * AMPLITUDE);
  const PREVIEW = 5;
  const WINDOW = 60;
  const WARMUP = 30;
  const TOLERANCE = 1e-5;
  const PULSE_DEFAULT = 0.02;
  const PULSE_MIN = 0.005;
  const PULSE_MAX = 0.15;
  const EDGES = [[1,2],[2,3],[3,4],[4,5],[4,6],[6,7],[4,8],
    [3,9],[9,10],[9,11],[11,12],[1,15],[15,13],[13,14],[13,16],
    [16,17],[16,18],[18,19],[19,20],[20,21],[18,22],[22,23],[23,24]];

  const BUS_PROFILES = Array.from({length:N},(_,i)=> {
    const bus=i+1;
    if (bus===1) return {bus,role:'Substation',eventName:'Feeder disturbance',decay:4,steps:16};
    if ([5,7,14,21].includes(bus)) return {bus,role:'Solar',eventName:'Cloud cover',decay:6,steps:24};
    if ([8,12,18,24].includes(bus)) return {bus,role:'Battery',eventName:'Inverter outage',decay:2,steps:8};
    return {bus,role:'Homes',eventName:'Demand surge',decay:3,steps:12};
  });

  function zeros(n = N, m = n) { return Array.from({length:n}, () => Array(m).fill(0)); }
  function eye(n = N) { const a = zeros(n); for (let i=0;i<n;i++) a[i][i]=1; return a; }
  function copy(a) { return a.map(row => row.slice()); }
  function transpose(a) { return a[0].map((_,j) => a.map(row => row[j])); }
  function multiply(a,b) {
    const c = zeros(a.length,b[0].length);
    for (let i=0;i<a.length;i++) for (let k=0;k<b.length;k++) {
      const v = a[i][k];
      for (let j=0;j<b[0].length;j++) c[i][j] += v*b[k][j];
    }
    return c;
  }
  function matvec(a,x) { return a.map(row => row.reduce((v,e,j) => v+e*x[j],0)); }
  function combine(a,b,alpha=1,beta=1) { return a.map((row,i) => row.map((v,j) => alpha*v+beta*b[i][j])); }
  function frobenius(a) { return Math.sqrt(a.reduce((s,row) => s+row.reduce((t,v) => t+v*v,0),0)); }
  function normInf(a) { return Math.max(...a.map(row => row.reduce((s,v) => s+Math.abs(v),0))); }
  function squared(x) { return x.reduce((s,v) => s+v*v,0); }
  function deepFreeze(x) {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) {
      Object.values(x).forEach(deepFreeze); Object.freeze(x);
    }
    return x;
  }

  // Solve A X = B for symmetric positive definite A without explicit inversion.
  function solveSPD(a,b) {
    const n=a.length, m=b[0].length, l=zeros(n), y=zeros(n,m), x=zeros(n,m);
    for (let i=0;i<n;i++) for (let j=0;j<=i;j++) {
      let v=a[i][j];
      for (let k=0;k<j;k++) v -= l[i][k]*l[j][k];
      if (i===j) {
        if (!(v>0)) throw new Error('Matrix must be positive definite');
        l[i][j]=Math.sqrt(v);
      } else l[i][j]=v/l[j][j];
    }
    for (let i=0;i<n;i++) for (let j=0;j<m;j++) {
      let v=b[i][j];
      for (let k=0;k<i;k++) v -= l[i][k]*y[k][j];
      y[i][j]=v/l[i][i];
    }
    for (let i=n-1;i>=0;i--) for (let j=0;j<m;j++) {
      let v=y[i][j];
      for (let k=i+1;k<n;k++) v -= l[k][i]*x[k][j];
      x[i][j]=v/l[i][i];
    }
    return x;
  }

  function buildModel() {
    const adjacency=Array.from({length:N},()=>[]);
    for (const [a,b] of EDGES) { adjacency[a-1].push(b-1); adjacency[b-1].push(a-1); }
    const distances=zeros();
    for (let i=0;i<N;i++) {
      const d=Array(N).fill(-1), queue=[i]; d[i]=0;
      for (let q=0;q<queue.length;q++) for (const j of adjacency[queue[q]]) {
        if (d[j]<0) { d[j]=d[queue[q]]+1; queue.push(j); }
      }
      distances[i]=d;
    }
    const w=distances.map((row,i)=>row.map((d,j)=>i===j?0:Math.exp(-d/2)));
    const degree=w.map(row=>row.reduce((s,v)=>s+v,0));
    const A=w.map((row,i)=>row.map((v,j)=>(i===j?0.4:0)+0.58*v/Math.sqrt(degree[i]*degree[j])));
    const Q=eye().map(row=>row.map(v=>35*v));
    const R=eye().map(row=>row.map(v=>0.08*v));
    const at=transpose(A);
    let P=copy(Q), residual=Infinity, iterations=0;
    for (;iterations<500;iterations++) {
      const H=solveSPD(combine(R,P),P);
      const next=combine(Q,multiply(at,multiply(combine(P,multiply(P,H),1,-1),A)));
      residual=frobenius(combine(next,P,1,-1));
      P=next;
      if (residual<1e-12) break;
    }
    const H=solveSPD(combine(R,P),P);
    const K=multiply(H,A).map(row=>row.map(v=>-v));
    // For fixed feedback A_c=A+K and perfect future disturbances, the LQR
    // preview term is -sum_j (R+P)^-1 (A_c')^j P w[t+j]. We retain five
    // immutable predictions and put the shared multiplier G on their right.
    const previewGains=[], closedLoopTranspose=transpose(combine(A,K));
    let response=P;
    for (let j=0;j<PREVIEW;j++) {
      previewGains.push(solveSPD(combine(R,P),response).map(row=>row.map(v=>-v)));
      response=multiply(closedLoopTranspose,response);
    }
    return deepFreeze({A,B:eye(),Q,R,P,H,K,previewGains,distances,
      variant:'Manuscript dense communication voltage surrogate',dareResidual:residual,
      dareIterations:iterations+1,closedLoopNormInf:normInf(combine(A,K))});
  }
  const model=buildModel();

  function seededRandom(seed) {
    let state=seed>>>0;
    function uniform() {
      state += 0x6D2B79F5;
      let z=state;
      z=Math.imul(z^(z>>>15),z|1);
      z ^= z+Math.imul(z^(z>>>7),z|61);
      return ((z^(z>>>14))>>>0)/4294967296;
    }
    let spare=null;
    return {normal() {
      if (spare!==null) { const x=spare; spare=null; return x; }
      const r=Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,uniform())));
      const theta=2*Math.PI*uniform();
      spare=r*Math.sin(theta); return r*Math.cos(theta);
    }};
  }

  function statistics(samples) {
    const S=zeros(), T=zeros();
    for (const sample of samples) for (let i=0;i<N;i++) for (let j=0;j<N;j++) {
      S[i][j] += sample.z[i]*sample.z[j]/samples.length;
      T[i][j] += sample.y[i]*sample.z[j]/samples.length;
    }
    for (let i=0;i<N;i++) { S[i][i]+=RIDGE; T[i][i]+=RIDGE; }
    // The largest absolute row sum bounds the covariance spectral norm.
    return {S,T,stepSize:0.95/normInf(S),samples};
  }
  function exactGain(stats) { return transpose(solveSPD(stats.S,transpose(stats.T))); }
  function gradientSteps(g,stats,count) {
    let result=g;
    for (let k=0;k<count;k++) {
      const gradient=combine(multiply(result,stats.S),stats.T,1,-1);
      result=combine(result,gradient,1,-stats.stepSize);
    }
    return result;
  }
  function objective(g,samples) {
    if (!samples.length) return 0;
    let loss=0;
    for (const pair of samples) {
      const predicted=matvec(g,pair.z);
      for (let i=0;i<N;i++) loss += (predicted[i]-pair.y[i])**2/(2*samples.length);
    }
    for (let i=0;i<N;i++) for (let j=0;j<N;j++) loss += RIDGE/2*(g[i][j]-(i===j?1:0))**2;
    return loss;
  }
  function recommendations(gain) {
    const result=[];
    for (let receiver=0;receiver<N;receiver++) {
      const ranked=[];
      for (let source=0;source<N;source++) if (source!==receiver)
        ranked.push({from:source+1,to:receiver+1,weight:gain[receiver][source]**2});
      ranked.sort((a,b)=>b.weight-a.weight||a.from-b.from);
      result.push(...ranked.slice(0,3));
    }
    return result;
  }
  function edgeChanges(before,after) {
    const first=new Set(before.map(e=>e.from+','+e.to));
    const second=new Set(after.map(e=>e.from+','+e.to));
    let count=0;
    for (const key of first) if (!second.has(key)) count++;
    for (const key of second) if (!first.has(key)) count++;
    return count/2;
  }

  class Simulation {
    constructor(options={}) {
      this.options={seed:options.seed===undefined?20261013:options.seed,
        horizon:options.horizon===undefined?480:options.horizon,
        faultBuses:options.faultBuses===undefined?[3,6,9,12,15,18,21,24]:options.faultBuses.slice()};
      if (!Number.isInteger(this.options.horizon)||this.options.horizon<1) throw new Error('Invalid horizon');
      this.reset();
    }
    reset() {
      this.random=seededRandom(this.options.seed);
      this.t=0; this.mode='running'; this.G=eye();
      this.states={online:Array(N).fill(0),static:Array(N).fill(0),causal:Array(N).fill(0)};
      this.cumulative={online:0,static:0,causal:0};
      this.stage={online:0,static:0,causal:0};
      this.faults=new Set(this.options.faultBuses.map(bus=>this.checkBus(bus)));
      this.latent=Array.from({length:N+1},()=>this.random.normal());
      this.pulses=[]; this.samples=[]; this.history=[]; this.eventLog=[];
      this.forecasts=[]; this.sealPreview();
      this.lastPreview=[]; this.costStates=Object.fromEntries(Object.entries(this.states).map(([k,v])=>[k,v.slice()]));
      this.learning={updates:0,windowStart:null,windowEnd:null,windowSize:0,
        beforeLoss:null,afterLoss:null,gradientNorm:null,rawRms:null,calibratedRms:null};
      this.lastSample=null; this.lastInputs=null; this.fit=null; this.fitHistory=[];
      this.fitError=null; this.fitObjective=null; this.fitIteration=0;
      this.directGain=multiply(model.H,this.G).map(row=>row.map(v=>-v));
      this.recommendations=recommendations(this.directGain);
      this.drift=0; this.changedEdges=0; this.sinceStable=0;
      this.lastTrainingTime=null; this.lastTrainingSampleCount=0;
      return this.snapshot();
    }
    checkBus(bus) {
      if (!Number.isInteger(bus)||bus<1||bus>N) throw new Error('Bus must be an integer from 1 through 24');
      return bus;
    }
    queuePulse(bus,strength=PULSE_DEFAULT) {
      this.checkBus(bus);
      if (!Number.isFinite(strength)||strength<PULSE_MIN||strength>PULSE_MAX)
        throw new RangeError('Pulse strength must be from 0.005 through 0.15 per unit');
      if (this.mode==='completed') this.extend();
      if (this.mode!=='running') return false;
      const profile=BUS_PROFILES[bus-1];
      this.pulses.push({bus,strength,age:0,t:this.t,...profile});
      this.eventLog.push(deepFreeze({t:this.t,type:'pulse',bus,strength,
        role:profile.role,eventName:profile.eventName,decay:profile.decay,steps:profile.steps,
        message:profile.eventName+' of '+strength+' per unit at bus '+bus}));
      return true;
    }
    extend(steps=480) {
      if (!Number.isInteger(steps)||steps<1) throw new RangeError('Extension must be a positive number of steps');
      this.options.horizon+=steps;
      if (this.mode==='completed') this.mode='running';
      this.sealPreview();
      return this.snapshot();
    }
    sealPreview() {
      const end=Math.min(this.options.horizon,this.t+PREVIEW);
      while (this.forecasts.length<end) {
        const rho=0.72, innovation=Math.sqrt(1-rho*rho);
        this.latent=this.latent.map(v=>rho*v+innovation*this.random.normal());
        const base=Array.from({length:N},(_,i)=>AMPLITUDE*(0.35*this.latent[0]+0.65*this.latent[i+1]));
        const forecast=base.map((v,i)=>{
          const faulty=this.faults.has(i+1);
          return (faulty?0.15:1)*v+AMPLITUDE*(faulty?1.6:0.05)*this.random.normal();
        });
        this.forecasts.push(deepFreeze({t:this.forecasts.length,base,forecast}));
      }
    }
    toggleFault(bus) {
      this.checkBus(bus);
      if (this.mode!=='running') return false;
      if (this.faults.has(bus)) this.faults.delete(bus); else this.faults.add(bus);
      this.eventLog.push(deepFreeze({t:this.t,type:'forecast',bus,faulty:this.faults.has(bus),
        message:'Forecast at bus '+bus+(this.faults.has(bus)?' corrupted':' repaired')}));
      return this.faults.has(bus);
    }
    updateGain(g) {
      const gain=multiply(model.H,g).map(row=>row.map(v=>-v));
      const next=recommendations(gain);
      this.drift=frobenius(combine(gain,this.directGain,1,-1))/Math.max(frobenius(this.directGain),1e-12);
      this.changedEdges=edgeChanges(this.recommendations,next);
      this.sinceStable=this.changedEdges===0?this.sinceStable+1:0;
      this.G=g; this.directGain=gain; this.recommendations=next;
    }
    step() {
      if (this.mode!=='running') return this.snapshot();
      if (this.t>=this.options.horizon) { this.mode='completed'; return this.snapshot(); }
      // History stops at t minus one. No current target is available to this update.
      this.lastTrainingTime=this.samples.length?this.samples[this.samples.length-1].t:null;
      this.lastTrainingSampleCount=this.samples.length;
      if (this.samples.length>=WARMUP) {
        const stats=statistics(this.samples);
        const beforeLoss=objective(this.G,this.samples);
        this.updateGain(exactGain(stats));
        this.learning={...this.learning,updates:this.learning.updates+1,
          windowStart:this.samples[0].t,windowEnd:this.samples.at(-1).t,
          windowSize:this.samples.length,beforeLoss,afterLoss:objective(this.G,this.samples),
          gradientNorm:frobenius(combine(multiply(this.G,stats.S),stats.T,1,-1))};
      } else { this.drift=0; this.changedEdges=0; this.sinceStable++; }

      // Forecasts become immutable when they first enter the visible five
      // sample preview. New pulses never rewrite any of these predictions.
      this.sealPreview();
      const {base,forecast}=this.forecasts[this.t];
      this.lastPreview=this.forecasts.slice(this.t,Math.min(this.t+PREVIEW,this.options.horizon));
      // Unexpected demand is realized only after the forecast has been sealed.
      const disturbance=base.slice(), pulse=Array(N).fill(0);
      for (const event of this.pulses) {
        const value=-event.strength*Math.exp(-event.age/event.decay);
        disturbance[event.bus-1]+=value; pulse[event.bus-1]+=value; event.age++;
      }
      this.pulses=this.pulses.filter(event=>event.age<event.steps);
      const sample=deepFreeze({t:this.t,forecast,disturbance,base,pulse,
        z:forecast.map(v=>v/AMPLITUDE),y:disturbance.map(v=>v/AMPLITUDE)});
      const preview={online:Array(N).fill(0),static:Array(N).fill(0),causal:Array(N).fill(0)};
      this.lastPreview.forEach((prediction,index)=>{
        const staticInput=matvec(model.previewGains[index],prediction.forecast);
        const adaptiveInput=matvec(model.previewGains[index],matvec(this.G,prediction.forecast));
        for(let i=0;i<N;i++) {
          preview.online[i]+=adaptiveInput[i]; preview.static[i]+=staticInput[i];
        }
      });
      const calibrated=matvec(this.G,forecast);
      this.learning.rawRms=Math.sqrt(squared(forecast.map((v,i)=>v-disturbance[i]))/N);
      this.learning.calibratedRms=Math.sqrt(squared(calibrated.map((v,i)=>v-disturbance[i]))/N);
      this.costStates=Object.fromEntries(Object.entries(this.states).map(([k,v])=>[k,v.slice()]));
      const inputs={}, rms={};
      for (const key of ['online','static','causal']) {
        const x=this.states[key], feedback=matvec(model.K,x);
        const u=feedback.map((v,i)=>v+preview[key][i]);
        this.stage[key]=35*squared(x)+0.08*squared(u);
        this.cumulative[key]+=this.stage[key];
        const ax=matvec(model.A,x);
        this.states[key]=ax.map((v,i)=>v+u[i]+disturbance[i]);
        inputs[key]=u;
        rms[key]=Math.sqrt(squared(this.states[key])/N);
      }
      this.lastInputs=deepFreeze(inputs); this.lastSample=sample;
      this.samples.push(sample); if (this.samples.length>WINDOW) this.samples.shift();
      this.t++;
      this.history.push(deepFreeze({t:this.t,costTime:sample.t,stateTime:this.t,
        ...this.cumulative,stage:{...this.stage},rms,pulse:sample.pulse,
        costStates:this.costStates,
        states:Object.fromEntries(Object.entries(this.states).map(([k,v])=>[k,v.slice()])),
        rawForecastRms:this.learning.rawRms,calibratedForecastRms:this.learning.calibratedRms,
        fitBefore:this.learning.beforeLoss,fitAfter:this.learning.afterLoss,
        fitResidual:this.learning.gradientNorm,
        drift:this.drift,changedEdges:this.changedEdges,
        calibrationLoss:objective(this.G,this.samples)}));
      if (this.t>=this.options.horizon) this.mode='completed';
      return this.snapshot();
    }
    freeze() {
      if (this.samples.length<WARMUP) return false;
      if (this.mode==='frozen'||this.mode==='fitting'||this.mode==='converged') return this.snapshot();
      const stats=statistics(this.samples.slice());
      const optimum=exactGain(stats);
      this.fit={...stats,optimum,scale:Math.max(frobenius(optimum),1e-12)};
      this.fitIteration=0; this.fitHistory=[]; this.mode='frozen';
      this.sinceStable=0; this.changedEdges=0;
      this.measureFit();
      this.eventLog.push(deepFreeze({t:this.t,type:'freeze',message:'Observation window frozen for optimizer convergence'}));
      return this.snapshot();
    }
    measureFit() {
      this.fitError=frobenius(combine(this.G,this.fit.optimum,1,-1))/this.fit.scale;
      this.fitObjective=objective(this.G,this.fit.samples);
      this.fitHistory.push(deepFreeze({iteration:this.fitIteration,error:this.fitError,
        objective:this.fitObjective,changedEdges:this.changedEdges}));
    }
    fitStep(count=12) {
      if (!this.fit||this.mode==='running'||this.mode==='completed'||this.mode==='converged') return this.snapshot();
      if (!Number.isInteger(count)||count<1) throw new Error('Iteration count must be positive');
      this.mode='fitting';
      this.updateGain(gradientSteps(this.G,this.fit,count));
      this.fitIteration+=count; this.measureFit();
      if (this.fitError<TOLERANCE) this.mode='converged';
      return this.snapshot();
    }
    resume() {
      this.mode=this.t>=this.options.horizon?'completed':'running';
      this.fit=null; this.fitError=null; this.fitObjective=null;
      this.fitIteration=0; this.fitHistory=[];
      this.drift=0; this.changedEdges=0; this.sinceStable=0;
      return this.snapshot();
    }
    snapshot() {
      return {t:this.t,costTime:this.lastSample?this.lastSample.t:null,stateTime:this.t,
        horizon:this.options.horizon,mode:this.mode,seed:this.options.seed,
        costStates:Object.fromEntries(Object.entries(this.costStates).map(([k,v])=>[k,v.slice()])),
        learning:{...this.learning},lastPreview:this.lastPreview.slice(),
        pendingPulses:this.pulses.filter(event=>event.age===0).map(event=>({...event})),
        activePulses:this.pulses.filter(event=>event.age>0).map(event=>({...event})),
        states:Object.fromEntries(Object.entries(this.states).map(([k,v])=>[k,v.slice()])),
        cumulative:{...this.cumulative},stage:{...this.stage},costs:{...this.cumulative},
        history:this.history.slice(),G:copy(this.G),directGain:copy(this.directGain),
        recommendations:this.recommendations.map(e=>({...e})),
        localChannels:Array.from({length:N},(_,i)=>({from:i+1,to:i+1,weight:this.directGain[i][i]**2})),
        faults:[...this.faults].sort((a,b)=>a-b),eventLog:this.eventLog.slice(),
        lastSample:this.lastSample,lastInputs:this.lastInputs,
        drift:this.drift,changedEdges:this.changedEdges,sinceStable:this.sinceStable,
        sampleCount:this.samples.length,lastTrainingTime:this.lastTrainingTime,
        lastTrainingSampleCount:this.lastTrainingSampleCount,
        fitError:this.fitError,fitObjective:this.fitObjective,fitIteration:this.fitIteration,
        fitHistory:this.fitHistory.slice(),canFreeze:this.samples.length>=WARMUP};
    }
  }

  return {Simulation,model,constants:deepFreeze({N,edges:EDGES,amplitude:AMPLITUDE,
    ridge:RIDGE,rawRidge:RAW_RIDGE,preview:PREVIEW,window:WINDOW,warmup:WARMUP,
    busProfiles:BUS_PROFILES,tolerance:TOLERANCE,horizon:480,
    pulseDefault:PULSE_DEFAULT,pulseMin:PULSE_MIN,pulseMax:PULSE_MAX}),
    math:{zeros,eye,transpose,multiply,matvec,combine,frobenius,normInf,solveSPD,objective,statistics,exactGain,recommendations}};
});
