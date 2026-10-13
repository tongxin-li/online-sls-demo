/* Synthetic radial feeder with linear DistFlow voltage magnitudes and bounded
 * inverter reactive power commands. The actuator has a physical first order lag.
 * Shared matrix/scalar forecast calibration illustrates the paper's experiment;
 * this is not the full delayed projected FIR algorithm or its regret theorem.
 */
(function (root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PowerDemo=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const N=24, M=8, AMPLITUDE=.006, RAW_RIDGE=1.27e-5;
  const RIDGE=RAW_RIDGE/(AMPLITUDE*AMPLITUDE),PREVIEW=5,WINDOW=60,WARMUP=30,TOLERANCE=1e-5;
  const BASE_KV=12.47,BASE_MVA=1,POWER_BASE_KW=1000,SAMPLE_SECONDS=1,TAU_SECONDS=2;
  const LAG=Math.exp(-SAMPLE_SECONDS/TAU_SECONDS),Q_LIMIT=.07,S_RATING=.12;
  const PULSE_DEFAULT=100,PULSE_MIN=10,PULSE_MAX=150;
  const CONTROLLERS=['online','scalar','static','causal'];
  const INVERTER_BUSES=[5,7,8,12,14,18,21,24];
  const SOLAR_BUSES=[5,7,14,21],BATTERY_BUSES=[8,12,18,24];
  const PF_RATIO=Math.tan(Math.acos(.95));
  const EDGES=[[1,2],[2,3],[3,4],[4,5],[4,6],[6,7],[4,8],
    [3,9],[9,10],[9,11],[11,12],[1,15],[15,13],[13,14],[13,16],
    [16,17],[16,18],[18,19],[19,20],[20,21],[18,22],[22,23],[23,24]];
  const FORECAST_PRESETS=[
    {id:'reliable',label:'Reliable forecasts',faultBuses:[],gain:1,noise:.05,faultyGain:.15,faultyNoise:1.6},
    {id:'uniform',label:'Uniform corruption',faultBuses:Array.from({length:23},(_,i)=>i+2),
      gain:1,noise:.05,faultyGain:.65,faultyNoise:.65},
    {id:'mixed',label:'Mixed reliability',faultBuses:[3,6,9,12,15,18,21,24],
      gain:1,noise:.05,faultyGain:.15,faultyNoise:1.6}
  ];
  const BUS_PROFILES=Array.from({length:N},(_,i)=>{
    const bus=i+1;
    if(bus===1)return{bus,role:'Substation',eventName:'Fixed slack',decay:4,steps:16,
      attackable:false,inverterKvar:0,baseDemandKw:0,baseGenerationKw:0,reactiveRatio:0};
    const solar=SOLAR_BUSES.includes(bus),battery=BATTERY_BUSES.includes(bus);
    return{bus,role:solar?'Solar':battery?'Battery':'Homes',
      eventName:solar?'Cloud cover':battery?'Charging surge':'Demand surge',
      decay:solar?6:battery?2:3,steps:solar?24:battery?8:12,attackable:true,
      inverterKvar:solar||battery?70:0,inverterKva:solar||battery?120:0,
      baseDemandKw:battery?50:70,baseGenerationKw:solar?80:0,
      activePowerLimitKw:solar||battery?90:null,reactiveRatio:solar||battery?0:PF_RATIO};
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
  function exactScalarGain(stats) {
    // Restrict the SAME objective to G=diag(1,alpha I_23). Its ridge penalty
    // is lambda*23*(alpha-1)^2/2, because the slack is not a physical channel.
    // The slack coordinate is display padding, fixed at G[0][0]=1 in both
    // matrix and scalar models. Only the 23 physical forecast channels share alpha.
    const trace=a=>a.reduce((sum,row,i)=>sum+(i===0?0:row[i]),0);
    return trace(stats.T)/trace(stats.S);
  }
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

  function buildModel(){
    const children=Array.from({length:N},()=>[]),parent=Array(N).fill(-1),parentEdge=Array(N).fill(-1);
    const edgeData=EDGES.map(([from,to],index)=>{
      const rOhm=.45+.15*(index%4),xOhm=.30+.08*(index%3),zBase=BASE_KV*BASE_KV/BASE_MVA;
      children[from-1].push(to-1);parent[to-1]=from-1;parentEdge[to-1]=index;
      return{from,to,rOhm,xOhm,rPu:rOhm/zBase,xPu:xOhm/zBase};
    });
    const order=[0];for(let k=0;k<order.length;k++)order.push(...children[order[k]]);
    const paths=zeros(N,N-1);
    for(const i of order.slice(1)){paths[i]=paths[parent[i]].slice();paths[i][parentEdge[i]]=1;}
    const resistance=zeros(),reactance=zeros();
    for(let i=1;i<N;i++)for(let j=1;j<N;j++)for(let e=0;e<N-1;e++){
      resistance[i][j]+=paths[i][e]*paths[j][e]*edgeData[e].rPu;
      reactance[i][j]+=paths[i][e]*paths[j][e]*edgeData[e].xPu;
    }
    const baseP=BUS_PROFILES.map(p=>(p.baseDemandKw-p.baseGenerationKw)/POWER_BASE_KW);
    const baseQ=BUS_PROFILES.map(p=>p.baseDemandKw*PF_RATIO/POWER_BASE_KW);
    const baseDrop=matvec(resistance,baseP).map((v,i)=>-v-matvec(reactance,baseQ)[i]);
    const referenceVoltage=baseDrop.map(v=>1+v);
    // Magnitude LinDistFlow has no factor two. The corresponding squared
    // voltage equation has 2R and 2X instead.
    const powerToVoltage=resistance.map((row,i)=>row.map((r,j)=>-r-reactance[i][j]*BUS_PROFILES[j].reactiveRatio));
    const F=powerToVoltage.slice(1),X=reactance.slice(1).map(row=>INVERTER_BUSES.map(bus=>row[bus-1]));
    const A=eye(N-1).map(row=>row.map(v=>LAG*v));
    const B=X.map(row=>row.map(v=>(1-LAG)*v));
    const Q=eye(N-1).map(row=>row.map(v=>35*v)),R=eye(M).map(row=>row.map(v=>.08*v));
    const at=transpose(A),bt=transpose(B);
    let P=copy(Q),residual=Infinity,iterations=0;
    for(;iterations<2000;iterations++){
      const btp=multiply(bt,P),S=combine(R,multiply(btp,B));
      const gain=solveSPD(S,multiply(btp,A));
      const next=combine(combine(Q,multiply(at,multiply(P,A))),multiply(at,multiply(P,multiply(B,gain))),1,-1);
      residual=frobenius(combine(next,P,1,-1));P=next;
      if(residual<1e-12)break;
    }
    const S=combine(R,multiply(bt,multiply(P,B)));
    const K=solveSPD(S,multiply(bt,multiply(P,A))).map(row=>row.map(v=>-v));
    const closedLoop=combine(A,multiply(B,K)),act=transpose(closedLoop);
    const previewGains=[];let response=P;
    for(let j=0;j<PREVIEW;j++){
      previewGains.push(solveSPD(S,multiply(bt,response)).map(row=>row.map(v=>-v)));
      response=multiply(act,response);
    }
    // Raw power forecasts are sealed. Their derived voltage disturbance
    // predictions use the currently observed power and the same issued future
    // power forecasts. Collect coefficients of each predicted power vector.
    const powerPreviewGains=previewGains.map((gain,j)=>multiply(
      j+1<PREVIEW?combine(gain,previewGains[j+1],1,-LAG):gain,F));
    const distances=zeros();
    for(let i=0;i<N;i++)for(let j=0;j<N;j++)for(let e=0;e<N-1;e++)distances[i][j]+=Math.abs(paths[i][e]-paths[j][e]);
    return deepFreeze({A,B,Q,R,P,K,S,X,F,resistance,reactance,powerToVoltage,paths,
      baseP,baseQ,baseDrop,referenceVoltage,initialVoltage:referenceVoltage,
      previewGains,powerPreviewGains,edgeData,order,parent,parentEdge,children,distances,
      inverterBuses:INVERTER_BUSES,lag:LAG,qLimit:Q_LIMIT,inverterRating:S_RATING,
      baseKv:BASE_KV,baseMva:BASE_MVA,sampleSeconds:SAMPLE_SECONDS,tauSeconds:TAU_SECONDS,
      variant:'Synthetic radial LinDistFlow feeder with inverter lag',
      costReference:'Nominal feasible voltage profile',dareResidual:residual,
      dareIterations:iterations+1,closedLoopNormInf:normInf(closedLoop)});
  }
  const model=buildModel();
  function padInput(values){const padded=Array(N).fill(0);INVERTER_BUSES.forEach((bus,i)=>padded[bus-1]=values[i]);return padded;}
  function paddedGain(gain){const out=zeros();INVERTER_BUSES.forEach((bus,i)=>out[bus-1]=gain[i].slice());return out;}
  function recommendations(gain){
    const result=[];
    for(const receiver of INVERTER_BUSES){
      const ranked=[];
      for(let source=2;source<=N;source++)if(source!==receiver){
        const weight=gain[receiver-1][source-1]**2;
        if(weight>1e-20)ranked.push({from:source,to:receiver,weight});
      }
      ranked.sort((a,b)=>b.weight-a.weight||a.from-b.from);result.push(...ranked.slice(0,3));
    }
    return result;
  }
  function edgeChanges(before,after){
    const a=new Set(before.map(e=>e.from+','+e.to)),b=new Set(after.map(e=>e.from+','+e.to));
    let changes=0;for(const key of a)if(!b.has(key))changes++;for(const key of b)if(!a.has(key))changes++;
    return changes/2;
  }
  function boundedPowerDeviation(bus,value){
    const p=BUS_PROFILES[bus-1];
    if(bus===1)return 0;
    if(p.role==='Solar')return Math.max((p.baseGenerationKw-p.activePowerLimitKw)/1000,Math.min(p.baseGenerationKw/1000,value));
    if(p.role==='Battery')return Math.max(-p.activePowerLimitKw/1000,Math.min(p.activePowerLimitKw/1000,value));
    return Math.max(-p.baseDemandKw/1000,value);
  }
  function physicalPower(deviation){
    const loadP=model.baseP.map((v,i)=>(v+deviation[i])*1000);
    const loadQ=model.baseQ.map((v,i)=>(v+BUS_PROFILES[i].reactiveRatio*deviation[i])*1000);
    const demandP=BUS_PROFILES.map((p,i)=>p.role==='Solar'?p.baseDemandKw:
      p.role==='Battery'?p.baseDemandKw+Math.max(0,deviation[i]*1000):p.baseDemandKw+deviation[i]*1000);
    const generationP=BUS_PROFILES.map((p,i)=>p.role==='Solar'?p.baseGenerationKw-deviation[i]*1000:
      p.role==='Battery'?Math.max(0,-deviation[i]*1000):0);
    const inverterP=BUS_PROFILES.map((p,i)=>p.role==='Solar'?generationP[i]:p.role==='Battery'?-deviation[i]*1000:0);
    return{loadP,loadQ,demandP,generationP,inverterP};
  }
  function voltageFrom(deviation,q){
    const voltageEffect=matvec(model.powerToVoltage,deviation);
    const qEffect=matvec(model.reactance,padInput(q));
    return model.baseDrop.map((v,i)=>v+voltageEffect[i]+qEffect[i]);
  }
  function branchFlows(loadP,loadQ,q){
    const p=loadP.slice(),reactive=loadQ.map((v,i)=>v-padInput(q)[i]*1000),flows=Array(N-1);
    for(const bus of model.order.slice(1).reverse()){
      flows[model.parentEdge[bus]]={pKw:p[bus],qKvar:reactive[bus]};
      p[model.parent[bus]]+=p[bus];reactive[model.parent[bus]]+=reactive[bus];
    }
    return flows;
  }
  // Independent balanced constant-power AC reference. This verifies the linear
  // approximation; the interactive plant itself remains linear DistFlow.
  function radialAC(loadP,loadQ,inverterQ=Array(N).fill(0),tolerance=1e-11){
    let vr=Array(N).fill(1),vi=Array(N).fill(0),ir=[],ii=[],converged=false,iterations=0;
    for(;iterations<100;iterations++){
      const oldR=vr.slice(),oldI=vi.slice();ir=Array(N).fill(0);ii=Array(N).fill(0);
      for(let i=1;i<N;i++){
        const p=loadP[i]/1000,q=(loadQ[i]-inverterQ[i])/1000,den=vr[i]**2+vi[i]**2;
        if(!(den>1e-12))return{converged:false,iterations,voltage:vr.map((v,i)=>Math.hypot(v,vi[i]))};
        ir[i]=(p*vr[i]+q*vi[i])/den;ii[i]=(p*vi[i]-q*vr[i])/den;
      }
      for(const bus of model.order.slice(1).reverse()){ir[model.parent[bus]]+=ir[bus];ii[model.parent[bus]]+=ii[bus];}
      for(const bus of model.order.slice(1)){
        const edge=model.edgeData[model.parentEdge[bus]],parent=model.parent[bus];
        vr[bus]=vr[parent]-(edge.rPu*ir[bus]-edge.xPu*ii[bus]);
        vi[bus]=vi[parent]-(edge.rPu*ii[bus]+edge.xPu*ir[bus]);
      }
      if(Math.max(...vr.map((v,i)=>Math.hypot(v-oldR[i],vi[i]-oldI[i])))<tolerance){converged=true;iterations++;break;}
    }
    let lossesKw=0,lossesKvar=0;
    for(const bus of model.order.slice(1)){
      const edge=model.edgeData[model.parentEdge[bus]],current=ir[bus]**2+ii[bus]**2;
      lossesKw+=edge.rPu*current*1000;lossesKvar+=edge.xPu*current*1000;
    }
    return{converged,iterations,voltage:vr.map((v,i)=>Math.hypot(v,vi[i])),
      slackKw:ir[0]*1000,slackKvar:-ii[0]*1000,lossesKw,lossesKvar};
  }

  class Simulation{
    constructor(options={}){
      const id=options.preset===undefined?'mixed':options.preset;
      const preset=FORECAST_PRESETS.find(p=>p.id===id);
      if(!preset)throw new RangeError('Forecast preset must be reliable, uniform, or mixed');
      this.preset=preset;
      this.options={seed:options.seed===undefined?20261013:options.seed,
        horizon:options.horizon===undefined?480:options.horizon,preset:id,
        faultBuses:options.faultBuses===undefined?preset.faultBuses.slice():options.faultBuses.slice()};
      if(!Number.isInteger(this.options.horizon)||this.options.horizon<1)throw new Error('Invalid horizon');
      this.reset();
    }
    reset(){
      this.random=seededRandom(this.options.seed);this.t=0;this.mode='running';this.G=eye();this.scalarGain=1;
      this.powerDeviation=Array(N).fill(0);this.power=physicalPower(this.powerDeviation);
      this.q=Object.fromEntries(CONTROLLERS.map(key=>[key,Array(M).fill(0)]));
      this.command=Object.fromEntries(CONTROLLERS.map(key=>[key,Array(M).fill(0)]));
      this.saturation=Object.fromEntries(CONTROLLERS.map(key=>[key,Array(N).fill(false)]));
      this.states=Object.fromEntries(CONTROLLERS.map(key=>[key,model.baseDrop.slice()]));
      this.costStates=Object.fromEntries(CONTROLLERS.map(key=>[key,model.baseDrop.slice()]));
      this.cumulative=Object.fromEntries(CONTROLLERS.map(key=>[key,0]));
      this.stage=Object.fromEntries(CONTROLLERS.map(key=>[key,0]));
      this.faults=new Set(this.options.faultBuses.map(bus=>this.checkBus(bus)).filter(bus=>bus!==1));
      this.latent=Array.from({length:N+1},()=>this.random.normal());
      this.pulses=[];this.samples=[];this.history=[];this.eventLog=[];this.forecasts=[];this.lastPreview=[];
      this.lastPulseApplications=[];this.sealPreview();
      this.learning={updates:0,windowStart:null,windowEnd:null,windowSize:0,
        beforeLoss:null,afterLoss:null,gradientNorm:null,rawRms:null,calibratedRms:null};
      this.lastSample=null;this.lastInputs=null;this.fit=null;this.fitHistory=[];
      this.fitError=null;this.fitObjective=null;this.fitIteration=0;
      this.directGain=paddedGain(model.powerPreviewGains[0]);this.recommendations=recommendations(this.directGain);
      this.drift=0;this.changedEdges=0;this.sinceStable=0;this.lastTrainingTime=null;this.lastTrainingSampleCount=0;
      return this.snapshot();
    }
    checkBus(bus){if(!Number.isInteger(bus)||bus<1||bus>N)throw new Error('Bus must be an integer from 1 through 24');return bus;}
    queuePulse(bus,strength=PULSE_DEFAULT){
      this.checkBus(bus);
      if(!Number.isFinite(strength)||strength<PULSE_MIN||strength>PULSE_MAX)throw new RangeError('Pulse strength must be from 10 through 150 kW');
      if(bus===1)return false;
      if(this.mode==='completed')this.extend();
      if(this.mode!=='running')return false;
      const profile=BUS_PROFILES[bus-1];
      this.pulses.push({bus,strength,age:0,t:this.t,...profile,requestedKw:strength,appliedKw:null});
      this.eventLog.push(deepFreeze({t:this.t,type:'pulse',bus,strength,units:'kW',role:profile.role,
        eventName:profile.eventName,decay:profile.decay,steps:profile.steps,
        message:profile.eventName+' requested '+strength+' kW at bus '+bus}));return true;
    }
    extend(steps=480){
      if(!Number.isInteger(steps)||steps<1)throw new RangeError('Extension must be a positive number of steps');
      this.options.horizon+=steps;if(this.mode==='completed')this.mode='running';this.sealPreview();return this.snapshot();
    }
    sealPreview(){
      const end=Math.min(this.options.horizon,this.t+PREVIEW);
      while(this.forecasts.length<end){
        const rho=.72,innovation=Math.sqrt(1-rho*rho);
        this.latent=this.latent.map(v=>rho*v+innovation*this.random.normal());
        const base=Array.from({length:N},(_,i)=>i===0?0:AMPLITUDE*(.35*this.latent[0]+.65*this.latent[i+1]));
        const forecast=base.map((v,i)=>{
          const faulty=this.faults.has(i+1),noise=this.random.normal();
          return i===0?0:(faulty?this.preset.faultyGain:this.preset.gain)*v
            +AMPLITUDE*(faulty?this.preset.faultyNoise:this.preset.noise)*noise;
        });
        this.forecasts.push(deepFreeze({t:this.forecasts.length,base,forecast,units:'pu active power on 1 MVA'}));
      }
    }
    toggleFault(bus){
      this.checkBus(bus);if(bus===1||this.mode!=='running')return false;
      if(this.faults.has(bus))this.faults.delete(bus);else this.faults.add(bus);
      this.eventLog.push(deepFreeze({t:this.t,type:'forecast',bus,faulty:this.faults.has(bus),
        message:'Future power forecasts at bus '+bus+(this.faults.has(bus)?' corrupted':' repaired')}));return this.faults.has(bus);
    }
    updateGain(g){
      const gain=paddedGain(multiply(model.powerPreviewGains[0],g)),next=recommendations(gain);
      this.drift=frobenius(combine(gain,this.directGain,1,-1))/Math.max(frobenius(this.directGain),1e-12);
      this.changedEdges=edgeChanges(this.recommendations,next);this.sinceStable=this.changedEdges===0?this.sinceStable+1:0;
      this.G=g;this.directGain=gain;this.recommendations=next;
    }
    step(){
      if(this.mode!=='running')return this.snapshot();
      if(this.t>=this.options.horizon){this.mode='completed';return this.snapshot();}
      this.lastTrainingTime=this.samples.length?this.samples.at(-1).t:null;this.lastTrainingSampleCount=this.samples.length;
      if(this.samples.length>=WARMUP){
        const stats=statistics(this.samples),beforeLoss=objective(this.G,this.samples);
        this.updateGain(exactGain(stats));this.scalarGain=exactScalarGain(stats);
        this.learning={...this.learning,updates:this.learning.updates+1,windowStart:this.samples[0].t,
          windowEnd:this.samples.at(-1).t,windowSize:this.samples.length,beforeLoss,
          afterLoss:objective(this.G,this.samples),gradientNorm:frobenius(combine(multiply(this.G,stats.S),stats.T,1,-1))};
      }else{this.drift=0;this.changedEdges=0;this.sinceStable++;}
      this.sealPreview();this.lastPreview=this.forecasts.slice(this.t,Math.min(this.t+PREVIEW,this.options.horizon));
      const issued=this.forecasts[this.t],forecast=issued.forecast;
      const background=issued.base.map((v,i)=>boundedPowerDeviation(i+1,v));
      const requested=Array(N).fill(0);
      for(const event of this.pulses){event.requestedKw=event.strength*Math.exp(-event.age/event.decay);requested[event.bus-1]+=event.requestedKw;}
      const disturbance=background.map((v,i)=>boundedPowerDeviation(i+1,v+requested[i]/1000));
      const pulse=disturbance.map((v,i)=>(v-background[i])*1000);
      this.lastPulseApplications=[];
      for(let i=1;i<N;i++)if(requested[i]>0)this.lastPulseApplications.push({bus:i+1,requestedKw:requested[i],
        appliedKw:pulse[i],capped:pulse[i]<requested[i]-1e-9,eventName:BUS_PROFILES[i].eventName});
      for(const event of this.pulses){event.appliedKw=requested[event.bus-1]?event.requestedKw*pulse[event.bus-1]/requested[event.bus-1]:0;event.age++;}
      this.pulses=this.pulses.filter(event=>event.age<event.steps);
      const currentEffect=matvec(model.F,this.powerDeviation),nextEffect=matvec(model.F,disturbance);
      const voltageDisturbance=[0,...nextEffect.map((v,i)=>v-LAG*currentEffect[i])];
      const sample=deepFreeze({t:this.t,forecast,disturbance,base:background,pulse,
        voltageDisturbance,observedPower:this.powerDeviation.slice(),
        anchorForecast:this.t>0?this.forecasts[this.t-1].forecast:Array(N).fill(0),
        pulseApplications:this.lastPulseApplications.map(p=>({...p})),
        units:'pu active power on 1 MVA',pulseUnits:'kW',z:forecast.map(v=>v/AMPLITUDE),y:disturbance.map(v=>v/AMPLITUDE)});
      // Condition every method on the currently observed physical power.
      // The sealed forecast for that observation supplies an innovation anchor.
      // Future level predictions are d_current+G*(h_future-h_current).
      // Causal G=0 therefore holds current power rather than assuming it vanishes.
      const anchorForecast=this.t>0?this.forecasts[this.t-1].forecast:Array(N).fill(0);
      const common=Array(M).fill(0);
      for(let j=0;j<this.lastPreview.length;j++){
        const held=matvec(model.previewGains[j],currentEffect.map(v=>(1-LAG)*v));
        for(let i=0;i<M;i++)common[i]+=held[i];
      }
      const preview=Object.fromEntries(CONTROLLERS.map(key=>[key,Array(M).fill(0)]));
      this.lastPreview.forEach((prediction,index)=>{
        const powerGain=this.lastPreview.length<PREVIEW&&index===this.lastPreview.length-1
          ?multiply(model.previewGains[index],model.F):model.powerPreviewGains[index];
        const increment=prediction.forecast.map((v,i)=>v-anchorForecast[i]);
        const staticInput=matvec(powerGain,increment);
        const adaptiveInput=matvec(powerGain,matvec(this.G,increment));
        for(let i=0;i<M;i++){preview.online[i]+=adaptiveInput[i];preview.static[i]+=staticInput[i];preview.scalar[i]+=this.scalarGain*staticInput[i];}
      });
      const calibrated=matvec(this.G,forecast);
      this.learning.rawRms=Math.sqrt(squared(forecast.map((v,i)=>v-disturbance[i]))/(N-1));
      this.learning.calibratedRms=Math.sqrt(squared(calibrated.map((v,i)=>v-disturbance[i]))/(N-1));
      this.costStates=Object.fromEntries(CONTROLLERS.map(key=>[key,this.states[key].slice()]));
      const inputs={},rms={},regulationRms={};
      for(const key of CONTROLLERS){
        const x=this.states[key].slice(1).map((v,i)=>v-model.baseDrop[i+1]);
        const feedback=matvec(model.K,x);
        const raw=feedback.map((v,i)=>v+common[i]+preview[key][i]);
        const bounded=raw.map(v=>Math.max(-Q_LIMIT,Math.min(Q_LIMIT,v)));
        this.command[key]=bounded;this.saturation[key]=padInput(raw.map((v,i)=>Math.abs(v-bounded[i])>1e-12));
        this.stage[key]=35*squared(x)+.08*squared(bounded);this.cumulative[key]+=this.stage[key];
        this.q[key]=this.q[key].map((v,i)=>LAG*v+(1-LAG)*bounded[i]);
        this.states[key]=voltageFrom(disturbance,this.q[key]);inputs[key]=padInput(bounded);
        rms[key]=Math.sqrt(squared(this.states[key].slice(1))/(N-1));
        regulationRms[key]=Math.sqrt(squared(this.states[key].slice(1).map((v,i)=>v-model.baseDrop[i+1]))/(N-1));
      }
      this.powerDeviation=disturbance.slice();this.power=physicalPower(disturbance);
      this.lastInputs=deepFreeze(inputs);this.lastSample=sample;this.samples.push(sample);if(this.samples.length>WINDOW)this.samples.shift();
      this.t++;
      this.history.push(deepFreeze({t:this.t,costTime:sample.t,stateTime:this.t,...this.cumulative,
        stage:{...this.stage},rms,regulationRms,pulse:sample.pulse,costStates:this.costStates,
        states:Object.fromEntries(CONTROLLERS.map(key=>[key,this.states[key].slice()])),
        regulationStates:Object.fromEntries(CONTROLLERS.map(key=>[key,this.states[key].map((v,i)=>v-model.baseDrop[i])])),
        rawForecastRms:this.learning.rawRms,calibratedForecastRms:this.learning.calibratedRms,
        fitBefore:this.learning.beforeLoss,fitAfter:this.learning.afterLoss,fitResidual:this.learning.gradientNorm,
        drift:this.drift,changedEdges:this.changedEdges,calibrationLoss:objective(this.G,this.samples)}));
      if(this.t>=this.options.horizon)this.mode='completed';return this.snapshot();
    }
    freeze(){
      if(this.samples.length<WARMUP)return false;
      if(['frozen','fitting','converged'].includes(this.mode))return this.snapshot();
      const stats=statistics(this.samples.slice()),optimum=exactGain(stats);
      this.fit={...stats,optimum,scale:Math.max(frobenius(optimum),1e-12)};
      this.fitIteration=0;this.fitHistory=[];this.mode='frozen';this.sinceStable=0;this.changedEdges=0;this.measureFit();
      this.eventLog.push(deepFreeze({t:this.t,type:'freeze',message:'Power observation window frozen for optimizer convergence'}));return this.snapshot();
    }
    measureFit(){
      this.fitError=frobenius(combine(this.G,this.fit.optimum,1,-1))/this.fit.scale;this.fitObjective=objective(this.G,this.fit.samples);
      this.fitHistory.push(deepFreeze({iteration:this.fitIteration,error:this.fitError,objective:this.fitObjective,changedEdges:this.changedEdges}));
    }
    fitStep(count=12){
      if(!this.fit||['running','completed','converged'].includes(this.mode))return this.snapshot();
      if(!Number.isInteger(count)||count<1)throw new Error('Iteration count must be positive');
      this.mode='fitting';this.updateGain(gradientSteps(this.G,this.fit,count));this.fitIteration+=count;this.measureFit();
      if(this.fitError<TOLERANCE)this.mode='converged';return this.snapshot();
    }
    resume(){
      this.mode=this.t>=this.options.horizon?'completed':'running';this.fit=null;this.fitError=null;this.fitObjective=null;
      this.fitIteration=0;this.fitHistory=[];this.drift=0;this.changedEdges=0;this.sinceStable=0;return this.snapshot();
    }
    snapshot(){
      const voltages=Object.fromEntries(CONTROLLERS.map(key=>[key,this.states[key].map(v=>1+v)]));
      const inverterQ=Object.fromEntries(CONTROLLERS.map(key=>[key,padInput(this.q[key]).map(v=>v*1000)]));
      const commandQ=Object.fromEntries(CONTROLLERS.map(key=>[key,padInput(this.command[key]).map(v=>v*1000)]));
      const flows=Object.fromEntries(CONTROLLERS.map(key=>[key,branchFlows(this.power.loadP,this.power.loadQ,this.q[key])]));
      return{t:this.t,costTime:this.lastSample?this.lastSample.t:null,stateTime:this.t,horizon:this.options.horizon,
        mode:this.mode,seed:this.options.seed,preset:this.options.preset,presetLabel:this.preset.label,scalarGain:this.scalarGain,
        initialVoltage:model.initialVoltage.slice(),referenceVoltage:model.referenceVoltage.slice(),initialStates:model.baseDrop.slice(),
        voltage:voltages.online.slice(),voltages,inverterQ,commandQ,
        saturation:Object.fromEntries(CONTROLLERS.map(key=>[key,this.saturation[key].map(Boolean)])),
        ...Object.fromEntries(Object.entries(this.power).map(([key,value])=>[key,value.slice()])),
        powerDeviation:this.powerDeviation.slice(),
        edgeData:model.edgeData.map((edge,i)=>({...edge,pKw:flows.online[i].pKw,
          qKvar:Object.fromEntries(CONTROLLERS.map(key=>[key,flows[key][i].qKvar]))})),
        lastPulseApplications:this.lastPulseApplications.map(p=>({...p})),
        costStates:Object.fromEntries(CONTROLLERS.map(key=>[key,this.costStates[key].slice()])),
        learning:{...this.learning},lastPreview:this.lastPreview.slice(),
        pendingPulses:this.pulses.filter(e=>e.age===0).map(e=>({...e})),activePulses:this.pulses.filter(e=>e.age>0).map(e=>({...e})),
        states:Object.fromEntries(CONTROLLERS.map(key=>[key,this.states[key].slice()])),
        regulationStates:Object.fromEntries(CONTROLLERS.map(key=>[key,this.states[key].map((v,i)=>v-model.baseDrop[i])])),
        cumulative:{...this.cumulative},stage:{...this.stage},costs:{...this.cumulative},history:this.history.slice(),G:copy(this.G),directGain:copy(this.directGain),
        recommendations:this.recommendations.map(e=>({...e})),
        localChannels:INVERTER_BUSES.map(bus=>({from:bus,to:bus,weight:this.directGain[bus-1][bus-1]**2})),
        faults:[...this.faults].sort((a,b)=>a-b),eventLog:this.eventLog.slice(),lastSample:this.lastSample,lastInputs:this.lastInputs,
        drift:this.drift,changedEdges:this.changedEdges,sinceStable:this.sinceStable,sampleCount:this.samples.length,
        lastTrainingTime:this.lastTrainingTime,lastTrainingSampleCount:this.lastTrainingSampleCount,
        fitError:this.fitError,fitObjective:this.fitObjective,fitIteration:this.fitIteration,fitHistory:this.fitHistory.slice(),canFreeze:this.samples.length>=WARMUP};
    }
  }
  return{Simulation,model,constants:deepFreeze({N,M,edges:EDGES,edgeData:model.edgeData,inverterBuses:INVERTER_BUSES,
    amplitude:AMPLITUDE,ridge:RIDGE,rawRidge:RAW_RIDGE,preview:PREVIEW,window:WINDOW,warmup:WARMUP,
    busProfiles:BUS_PROFILES,controllers:CONTROLLERS,forecastPresets:FORECAST_PRESETS,tolerance:TOLERANCE,horizon:480,
    pulseDefault:PULSE_DEFAULT,pulseMin:PULSE_MIN,pulseMax:PULSE_MAX,pulseUnits:'kW',powerBaseKw:POWER_BASE_KW,
    baseKv:BASE_KV,baseMva:BASE_MVA,sampleSeconds:SAMPLE_SECONDS,tauSeconds:TAU_SECONDS,inverterKvar:70}),
    math:{zeros,eye,transpose,multiply,matvec,combine,frobenius,normInf,solveSPD,objective,statistics,exactGain,exactScalarGain,
      recommendations,physicalPower,voltageFrom,branchFlows,radialAC,padInput}};
});
