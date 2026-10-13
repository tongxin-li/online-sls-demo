'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {Simulation, model, constants, math} = require('./simulation.js');
const {multiply,transpose,combine,frobenius,matvec,solveSPD,eye}=math;
const distance=(a,b)=>frobenius(combine(a,b,1,-1));
const vectorDistance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const controllers=['online','static','causal'];
const run=(sim,n)=>{for(let i=0;i<n;i++)sim.step();return sim.snapshot();};

// The model is the paper's densely coupled communication experiment. It is
// a linear voltage surrogate, not an AC power flow or an inverter model.
test('paper communication dynamics and stable fixed feedback satisfy the Riccati equation',()=>{
  const {A,P,Q,R,K}=model, at=transpose(A);
  const riccati=combine(combine(Q,multiply(at,multiply(P,A))),
    multiply(at,multiply(P,solveSPD(combine(R,P),multiply(P,A)))),1,-1);
  assert.ok(distance(P,riccati)<1e-10);
  assert.ok(model.dareResidual<1e-10);
  assert.ok(math.normInf(combine(A,K))<0.01);
  assert.equal(constants.edges.length,23);
  const W=model.distances.map((row,i)=>row.map((d,j)=>i===j?0:Math.exp(-d/2)));
  const degree=W.map(row=>row.reduce((s,v)=>s+v,0));
  const expected=W.map((row,i)=>row.map((v,j)=>(i===j?.4:0)+.58*v/Math.sqrt(degree[i]*degree[j])));
  assert.ok(distance(model.A,expected)<1e-15);
  assert.deepEqual(model.B,eye());
});

test('five preview coefficients satisfy the fixed feedback LQR formula',()=>{
  const s=combine(model.R,model.P), act=transpose(combine(model.A,model.K));
  let response=model.P;
  assert.equal(constants.preview,5);
  assert.equal(model.previewGains.length,5);
  for(const gain of model.previewGains) {
    const expected=solveSPD(s,response).map(row=>row.map(v=>-v));
    assert.ok(distance(gain,expected)<1e-14);
    response=multiply(act,response);
  }
  assert.ok(distance(model.previewGains[0],model.H.map(row=>row.map(v=>-v)))<1e-15);
});

test('all controllers use identical disturbances and the static controller uses the full immutable preview',()=>{
  const sim=new Simulation();
  for(let t=0;t<40;t++) {
    const previous=sim.snapshot(), next=sim.step();
    assert.ok(Object.isFrozen(next.lastSample));
    assert.ok(Object.isFrozen(next.lastSample.forecast));
    assert.deepEqual(next.lastPreview.map(p=>p.t),[t,t+1,t+2,t+3,t+4]);
    let expected=matvec(model.K,previous.states.static);
    for(let j=0;j<5;j++) {
      assert.ok(Object.isFrozen(next.lastPreview[j]));
      const ff=matvec(model.previewGains[j],next.lastPreview[j].forecast);
      expected=expected.map((v,i)=>v+ff[i]);
    }
    assert.ok(vectorDistance(next.lastInputs.static,expected)<1e-15);
    for(const key of controllers) {
      const ax=matvec(model.A,previous.states[key]);
      const recovered=next.states[key].map((v,i)=>v-ax[i]-next.lastInputs[key][i]);
      assert.ok(vectorDistance(recovered,next.lastSample.disturbance)<1e-15);
    }
    if(t<constants.warmup) assert.deepEqual(next.states.online,next.states.static);
  }
});

test('shared ridge fitting uses exactly the previous revealed window and solves its declared objective',()=>{
  const clean=new Simulation(), pulsed=new Simulation();
  run(clean,30);run(pulsed,30);
  assert.deepEqual(clean.G,eye());
  const pairs=clean.samples.slice(), stats=math.statistics(pairs);
  const expected=math.exactGain(stats);
  assert.ok(Math.abs(constants.ridge-1.27e-5/constants.amplitude**2)<1e-15);
  pulsed.queuePulse(7,.02);
  const a=clean.step(),b=pulsed.step();
  assert.equal(a.lastTrainingTime,29);
  assert.equal(a.lastTrainingSampleCount,30);
  assert.ok(distance(a.G,expected)<1e-13);
  assert.ok(a.learning.gradientNorm<1e-12);
  assert.ok(a.learning.afterLoss<=a.learning.beforeLoss);
  assert.deepEqual(a.G,b.G);
  assert.deepEqual(a.lastPreview,b.lastPreview);
  assert.ok(Math.abs(b.lastSample.disturbance[6]-a.lastSample.disturbance[6]+.02)<1e-14);
  assert.notDeepEqual(clean.step().G,pulsed.step().G);
  run(clean,50);
  const snap=clean.snapshot();
  assert.equal(snap.lastTrainingSampleCount,60);
  assert.equal(snap.learning.windowEnd,snap.costTime-1);
  assert.equal(snap.learning.windowStart,snap.costTime-60);
});

test('equipment roles have distinct declared disturbance profiles without changing the common plant',()=>{
  const buses=[1,3,7,12],profiles=[];
  for(const bus of buses) {
    const clean=new Simulation(), attacked=new Simulation(),profile=constants.busProfiles[bus-1];
    attacked.queuePulse(bus,.02);profiles.push(profile.steps);
    assert.equal(attacked.snapshot().pendingPulses[0].eventName,profile.eventName);
    for(let age=0;age<26;age++) {
      const a=clean.step(),b=attacked.step();
      const expected=age<profile.steps?-.02*Math.exp(-age/profile.decay):0;
      assert.deepEqual(a.lastSample.forecast,b.lastSample.forecast);
      assert.ok(Math.abs(b.lastSample.pulse[bus-1]-expected)<1e-15);
      assert.ok(Math.abs(b.lastSample.disturbance[bus-1]-a.lastSample.disturbance[bus-1]-expected)<1e-15);
      for(let i=0;i<24;i++) if(i!==bus-1) assert.equal(a.lastSample.disturbance[i],b.lastSample.disturbance[i]);
    }
  }
  assert.equal(new Set(profiles).size,4);
});

test('multiple attacks can queue at the same sample and on every subsequent sample with exact superposition',()=>{
  const sim=new Simulation(),clean=new Simulation(),strength=.02,bus=7,profile=constants.busProfiles[bus-1];
  const before=sim.snapshot();
  for(let i=0;i<3;i++) assert.equal(sim.queuePulse(bus,strength),true);
  let queued=sim.snapshot();
  assert.equal(queued.pendingPulses.length,3);
  for(const key of ['t','states','stage','cumulative','G','history']) assert.deepEqual(queued[key],before[key]);
  for(let t=0;t<30;t++) {
    if(t>0&&t<8) assert.equal(sim.queuePulse(bus,strength),true);
    const a=clean.step(),b=sim.step();
    let expected=t<profile.steps?-3*strength*Math.exp(-t/profile.decay):0;
    for(let eventTime=1;eventTime<8&&eventTime<=t;eventTime++) {
      const age=t-eventTime;
      if(age<profile.steps)expected-=strength*Math.exp(-age/profile.decay);
    }
    assert.ok(Math.abs(b.lastSample.pulse[bus-1]-expected)<1e-15);
    assert.deepEqual(a.lastSample.forecast,b.lastSample.forecast);
    assert.equal(b.pendingPulses.length,0);
  }
  // Repeated attacks are intentionally not clipped to a visual voltage band.
  const overloaded=new Simulation();
  for(let i=0;i<5;i++)overloaded.queuePulse(bus,.03);
  assert.ok(overloaded.step().states.online[bus-1]<-.1);
});

test('invalid pulse values do not mutate state and every valid event records its amplitude and profile',()=>{
  const sim=new Simulation(),original=sim.snapshot();
  for(const invalid of [NaN,Infinity,-Infinity,0,-.025,.004,.151,'0.02',null])
    assert.throws(()=>sim.queuePulse(5,invalid),RangeError);
  assert.deepEqual(sim.snapshot(),original);
  for(const strength of [constants.pulseMin,.02,constants.pulseMax])assert.equal(sim.queuePulse(5,strength),true);
  assert.deepEqual(sim.snapshot().eventLog.map(e=>e.strength),[.005,.02,.15]);
  assert.ok(sim.snapshot().eventLog.every(Object.isFrozen));
  assert.ok(sim.snapshot().eventLog.every(e=>e.role==='Solar'&&e.steps===24));
});

test('cost and voltage histories share explicit sample times and charge actual pretransition states',()=>{
  const clean=new Simulation(),attacked=new Simulation();
  run(clean,60);run(attacked,60);
  attacked.queuePulse(7,.03);
  const a=clean.step(),b=attacked.step();
  assert.deepEqual(a.G,b.G);
  assert.deepEqual(a.stage,b.stage);
  assert.deepEqual(a.costStates,b.costStates);
  assert.equal(b.costTime,60);assert.equal(b.stateTime,61);
  for(const key of controllers) {
    assert.ok(vectorDistance(b.states[key],a.states[key].map((v,i)=>v-(i===6?.03:0)))<1e-15);
  }
  const c=clean.step(),d=attacked.step(),row=d.history.at(-1);
  assert.equal(d.costTime,61);assert.equal(d.stateTime,62);
  assert.deepEqual(d.costStates,b.states);
  assert.deepEqual(row.costStates,d.costStates);
  assert.deepEqual(row.states,d.states);
  assert.deepEqual(row.pulse,d.lastSample.pulse);
  for(const key of controllers) {
    const expected=35*b.states[key].reduce((s,x)=>s+x*x,0)+.08*d.lastInputs[key].reduce((s,u)=>s+u*u,0);
    assert.equal(d.stage[key],expected);
    assert.ok(d.stage[key]>c.stage[key]+.02);
  }
});

test('displayed forecast diagnostics are computed from the actual sealed forecast and revealed disturbance',()=>{
  const sim=new Simulation();run(sim,60);sim.queuePulse(3,.03);
  const snap=sim.step(),{forecast,disturbance}=snap.lastSample;
  const calibrated=matvec(snap.G,forecast);
  const rms=a=>Math.sqrt(a.reduce((s,v,i)=>s+(v-disturbance[i])**2,0)/24);
  assert.ok(Math.abs(snap.learning.rawRms-rms(forecast))<1e-15);
  assert.ok(Math.abs(snap.learning.calibratedRms-rms(calibrated))<1e-15);
  assert.equal(snap.history.at(-1).rawForecastRms,snap.learning.rawRms);
});

test('the strongest UI single pulse stays near nominal voltage for each equipment role',()=>{
  // This is a regression for the seeded scenario, not a hard constraint.
  for(let bus=1;bus<=24;bus++) {
    const sim=new Simulation();run(sim,60);sim.queuePulse(bus,.03);
    for(let t=0;t<30;t++)sim.step().states.online.forEach((deviation,index)=>{
      assert.ok(1+deviation>=.95&&1+deviation<=1.05,`pulse ${bus}, sample ${sim.t}, bus ${index+1}`);
    });
  }
});

test('fault toggles never rewrite forecasts that have already entered a preview',()=>{
  const clean=new Simulation(),changed=new Simulation();run(clean,35);run(changed,35);
  const saved=JSON.stringify(changed.samples),sealed=changed.snapshot().lastPreview;
  changed.toggleFault(4);
  assert.equal(JSON.stringify(changed.samples),saved);
  for(let t=35;t<39;t++) {
    const a=clean.step(),b=changed.step();
    assert.deepEqual(a.lastSample.forecast,b.lastSample.forecast);
    assert.deepEqual(a.lastSample.disturbance,b.lastSample.disturbance);
    for(const p of sealed) assert.deepEqual(changed.forecasts[p.t],p);
  }
  const a=clean.step(),b=changed.step();
  assert.notEqual(a.lastSample.forecast[3],b.lastSample.forecast[3]);
  assert.deepEqual(a.lastSample.disturbance,b.lastSample.disturbance);
  for(let i=0;i<24;i++)if(i!==3)assert.equal(a.lastSample.forecast[i],b.lastSample.forecast[i]);
});

test('cost is the finite unmodified sum of quadratic stage costs with a correctly truncated final preview',()=>{
  const sim=new Simulation(),sums={online:0,static:0,causal:0};
  for(let t=0;t<480;t++) {
    if(t===80)sim.queuePulse(8);
    if(t===160)sim.toggleFault(8);
    const previous=sim.snapshot(),current=sim.step();
    for(const key of controllers) {
      const expected=35*previous.states[key].reduce((s,x)=>s+x*x,0)+.08*current.lastInputs[key].reduce((s,u)=>s+u*u,0);
      assert.ok(Math.abs(expected-current.stage[key])<1e-14);
      sums[key]+=expected;
      assert.equal(current.cumulative[key],sums[key]);
      assert.ok(Number.isFinite(current.cumulative[key]));
    }
  }
  assert.equal(sim.mode,'completed');assert.equal(sim.samples.length,60);assert.equal(sim.history.length,480);
  assert.equal(sim.snapshot().lastPreview.length,1);
  const done=sim.snapshot();sim.step();assert.deepEqual(sim.snapshot(),done);
});

test('a completed episode can extend and accept an attack at its next control sample',()=>{
  const sim=new Simulation({horizon:3});run(sim,3);
  const completed=sim.snapshot();assert.equal(completed.mode,'completed');
  assert.equal(sim.queuePulse(12,.02),true);
  const queued=sim.snapshot();assert.equal(queued.t,3);assert.equal(queued.horizon,483);
  assert.equal(queued.mode,'running');assert.equal(queued.pendingPulses.length,1);
  assert.deepEqual(queued.cumulative,completed.cumulative);
  const next=sim.step();assert.equal(next.t,4);assert.equal(next.lastSample.pulse[11],-.02);
  assert.equal(next.lastPreview.length,5);
  assert.throws(()=>sim.extend(0),RangeError);
});

test('frozen optimization has a fixed target and leaves plant, observations, and cost unchanged',()=>{
  const sim=new Simulation();assert.equal(sim.freeze(),false);run(sim,100);
  const frozen=sim.freeze(),observations=JSON.stringify(sim.samples);
  assert.equal(frozen.mode,'frozen');assert.equal(sim.queuePulse(2),false);
  let previous=frozen,calls=0;
  while(sim.mode!=='converged'&&calls++<2000) {
    const current=sim.fitStep();
    assert.equal(current.t,frozen.t);assert.deepEqual(current.states,frozen.states);
    assert.deepEqual(current.cumulative,frozen.cumulative);assert.deepEqual(current.history,frozen.history);
    assert.equal(JSON.stringify(sim.samples),observations);
    assert.ok(current.fitError<=previous.fitError+1e-13);
    assert.ok(current.fitObjective<=previous.fitObjective+1e-13);
    previous=current;
  }
  assert.equal(sim.mode,'converged');assert.ok(sim.fitError<constants.tolerance);
  sim.resume();assert.equal(sim.step().t,101);
});

test('recommendations rank three remote channels per receiver without changing the deployed controller',()=>{
  const sim=new Simulation();run(sim,90);const snap=sim.snapshot();
  assert.equal(snap.recommendations.length,72);assert.equal(snap.localChannels.length,24);
  const expected=multiply(model.H,snap.G).map(row=>row.map(v=>-v));
  assert.ok(distance(expected,snap.directGain)<1e-14);
  assert.deepEqual(snap.recommendations,math.recommendations(expected));
  for(let bus=1;bus<=24;bus++)assert.equal(snap.recommendations.filter(e=>e.to===bus).length,3);
});

test('seed and interventions replay exactly and snapshot arrays cannot mutate the model',()=>{
  const sim=new Simulation({seed:123});
  const play=()=>{
    for(let t=0;t<100;t++) {
      if(t===40||t===43)sim.queuePulse(7,.02);
      if(t===45)sim.queuePulse(12,.03);
      if(t===60)sim.toggleFault(6);
      sim.step();
    }
    return sim.snapshot();
  };
  const first=play();sim.reset();const second=play();assert.deepEqual(first,second);
  second.states.online[0]=100;second.costStates.online[0]=100;second.G[0][0]=100;second.learning.updates=1000;
  const intact=sim.snapshot();assert.notEqual(intact.states.online[0],100);
  assert.notEqual(intact.costStates.online[0],100);assert.notEqual(intact.G[0][0],100);
  assert.notEqual(intact.learning.updates,1000);
});
