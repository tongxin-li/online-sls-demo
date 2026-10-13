'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {Simulation, model, constants, math} = require('./simulation.js');
const {multiply,transpose,combine,frobenius,matvec,solveSPD,eye} = math;
const distance=(a,b)=>frobenius(combine(a,b,1,-1));
const vectorDistance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

test('Riccati equation and stable fixed feedback are numerically satisfied',()=>{
  const {A,P,Q,R,K}=model, at=transpose(A);
  const riccati=combine(combine(Q,multiply(at,multiply(P,A))),
    multiply(at,multiply(P,solveSPD(combine(R,P),multiply(P,A)))),1,-1);
  assert.ok(distance(P,riccati)<1e-10);
  assert.ok(model.dareResidual<1e-10);
  assert.ok(math.normInf(combine(A,K))<0.01);
  assert.equal(constants.edges.length,23);
  assert.ok(model.distances.every(row=>row.every(d=>d>=0)));
  assert.equal(model.A.length,24);
});

test('all controllers use the identical disturbance and immutable current forecast',()=>{
  const sim=new Simulation();
  for (let t=0;t<40;t++) {
    const previous=sim.snapshot(), next=sim.step();
    assert.ok(Object.isFrozen(next.lastSample));
    assert.ok(Object.isFrozen(next.lastSample.forecast));
    for (const key of ['online','static','causal']) {
      const ax=matvec(model.A,previous.states[key]);
      const recovered=next.states[key].map((v,i)=>v-ax[i]-next.lastInputs[key][i]);
      assert.ok(vectorDistance(recovered,next.lastSample.disturbance)<1e-15);
    }
    const staticPreview=matvec(model.H,next.lastSample.forecast);
    const staticFeedback=matvec(model.K,previous.states.static);
    assert.ok(vectorDistance(next.lastInputs.static,staticFeedback.map((v,i)=>v-staticPreview[i]))<1e-15);
    if(t<30) assert.deepEqual(next.states.online,next.states.static);
  }
});

test('learning consumes only previously revealed pairs',()=>{
  const clean=new Simulation(), pulsed=new Simulation();
  for(let t=0;t<30;t++) { clean.step(); pulsed.step(); }
  assert.deepEqual(clean.G,eye());
  const previousSamples=clean.samples.slice();
  const stats=math.statistics(previousSamples);
  let expected=eye();
  for(let k=0;k<4;k++) expected=combine(expected,
    combine(multiply(expected,stats.S),stats.T,1,-1),1,-stats.stepSize);
  pulsed.queuePulse(7);
  const a=clean.step(), b=pulsed.step();
  assert.equal(a.lastTrainingTime,29);
  assert.equal(a.lastTrainingSampleCount,30);
  assert.ok(distance(a.G,expected)<1e-13);
  assert.deepEqual(a.G,b.G);
  assert.deepEqual(a.lastSample.forecast,b.lastSample.forecast);
  assert.ok(Math.abs(b.lastSample.disturbance[6]-a.lastSample.disturbance[6]+0.025)<1e-14);
  assert.notDeepEqual(clean.step().G,pulsed.step().G);
});

test('a load spike is unforecasted and decays over exactly twelve steps',()=>{
  const a=new Simulation(), b=new Simulation();
  b.queuePulse(5);
  for(let i=0;i<14;i++) {
    const clean=a.step(), pulse=b.step();
    assert.deepEqual(clean.lastSample.forecast,pulse.lastSample.forecast);
    const expected=i<12?-0.025*Math.exp(-i/3):0;
    assert.ok(Math.abs(pulse.lastSample.pulse[4]-expected)<1e-15);
    assert.ok(Math.abs(pulse.lastSample.disturbance[4]-clean.lastSample.disturbance[4]-expected)<1e-15);
    for(let bus=0;bus<24;bus++) if(bus!==4)
      assert.equal(clean.lastSample.disturbance[bus],pulse.lastSample.disturbance[bus]);
  }
});

test('pulse strength is bounded, recorded, and superposes without changing the forecast',()=>{
  const clean=new Simulation(), pulsed=new Simulation();
  const original=pulsed.snapshot();
  for(const invalid of [NaN,Infinity,-Infinity,0,-0.025,0.004,0.151,'0.06',null])
    assert.throws(()=>pulsed.queuePulse(5,invalid),RangeError);
  assert.deepEqual(pulsed.snapshot(),original);
  assert.deepEqual(pulsed.pulses,[]);
  for(const strength of [constants.pulseMin,0.06,constants.pulseMax])
    assert.equal(pulsed.queuePulse(5,strength),true);
  assert.deepEqual(pulsed.pulses.map(event=>event.strength),[0.005,0.06,0.15]);
  assert.deepEqual(pulsed.snapshot().eventLog.map(event=>event.strength),[0.005,0.06,0.15]);
  assert.ok(pulsed.snapshot().eventLog.every(Object.isFrozen));
  for(let i=0;i<14;i++) {
    const previous=pulsed.snapshot();
    const a=clean.step(), b=pulsed.step();
    const expected=i<12?-(0.005+0.06+0.15)*Math.exp(-i/3):0;
    assert.deepEqual(a.lastSample.forecast,b.lastSample.forecast);
    assert.ok(Math.abs(b.lastSample.pulse[4]-expected)<1e-15);
    assert.ok(Math.abs(b.lastSample.disturbance[4]-a.lastSample.disturbance[4]-expected)<1e-15);
    for(const key of ['online','static','causal']) {
      const ax=matvec(model.A,previous.states[key]);
      const recovered=b.states[key].map((v,j)=>v-ax[j]-b.lastInputs[key][j]);
      assert.ok(vectorDistance(recovered,b.lastSample.disturbance)<1e-15);
    }
  }
});

test('pulse effects enter state before cost and learning without an artificial jump',()=>{
  const clean=new Simulation(), pulsed=new Simulation();
  for(let i=0;i<60;i++) { clean.step(); pulsed.step(); }
  const before=pulsed.snapshot();
  pulsed.queuePulse(7,0.06);
  const queued=pulsed.snapshot();
  for(const field of ['t','states','stage','cumulative','G','directGain','recommendations','history'])
    assert.deepEqual(queued[field],before[field]);

  const cleanRealized=clean.step(), realized=pulsed.step();
  assert.deepEqual(realized.G,cleanRealized.G);
  assert.deepEqual(realized.recommendations,cleanRealized.recommendations);
  assert.deepEqual(realized.stage,cleanRealized.stage);
  assert.deepEqual(realized.cumulative,cleanRealized.cumulative);
  assert.equal(realized.lastTrainingTime,59);
  for(const key of ['online','static','causal']) {
    const expected=cleanRealized.states[key].map((v,i)=>v-(i===6?0.06:0));
    assert.ok(vectorDistance(realized.states[key],expected)<1e-15);
  }

  const cleanCharged=clean.step(), charged=pulsed.step();
  assert.equal(charged.lastTrainingTime,60);
  assert.notDeepEqual(charged.G,cleanCharged.G);
  for(const key of ['online','static','causal']) {
    const expected=35*realized.states[key].reduce((s,x)=>s+x*x,0)
      +0.08*charged.lastInputs[key].reduce((s,u)=>s+u*u,0);
    assert.equal(charged.stage[key],expected);
    assert.ok(charged.stage[key]>cleanCharged.stage[key]+0.1);
    assert.equal(charged.cumulative[key],realized.cumulative[key]+expected);
  }
  assert.deepEqual(charged.recommendations,math.recommendations(charged.directGain));
  assert.deepEqual(charged.directGain,multiply(model.H,charged.G).map(row=>row.map(v=>-v)));
  assert.notDeepEqual(charged.recommendations,cleanCharged.recommendations);
});

test('the strongest UI pulse stays near nominal voltage in the seeded application scenario',()=>{
  // A regression for the displayed scenario, not a bound for every disturbance.
  // Inspect the actual state so rendering or display clipping cannot satisfy it.
  const strength=0.03;
  const checkVoltage=(snapshot,label)=>{
    snapshot.states.online.forEach((deviation,index)=>{
      const voltage=1+deviation;
      assert.ok(voltage>=0.95&&voltage<=1.05,
        `${label}, sample ${snapshot.t}, bus ${index+1}: ${voltage} pu`);
    });
  };
  for(let bus=1;bus<=constants.N;bus++) {
    const sim=new Simulation();
    for(let t=0;t<60;t++) sim.step();
    sim.queuePulse(bus,strength);
    for(let t=0;t<25;t++) checkVoltage(sim.step(),`single pulse at bus ${bus}`);
  }

  // The interface waits twelve model samples before allowing the same target
  // again. Verify repeated disturbances at that recovery interval as well.
  const spaced=new Simulation();
  for(let t=0;t<60;t++) spaced.step();
  for(let t=0;t<72;t++) {
    if(t<60&&t%12===0) spaced.queuePulse(7,strength);
    checkVoltage(spaced.step(),'repeated pulse at bus 7');
  }
});

test('forecast faults change future observations without rewriting prior pairs',()=>{
  const a=new Simulation(), b=new Simulation();
  for(let i=0;i<35;i++) { a.step(); b.step(); }
  const saved=JSON.stringify(b.samples);
  b.toggleFault(4);
  assert.equal(JSON.stringify(b.samples),saved);
  const clean=a.step(), faulty=b.step();
  assert.deepEqual(clean.lastSample.disturbance,faulty.lastSample.disturbance);
  assert.notEqual(clean.lastSample.forecast[3],faulty.lastSample.forecast[3]);
  for(let bus=0;bus<24;bus++) if(bus!==3)
    assert.equal(clean.lastSample.forecast[bus],faulty.lastSample.forecast[bus]);
});

test('cumulative cost is a finite unmodified sum of quadratic stage costs',()=>{
  const sim=new Simulation();
  const sums={online:0,static:0,causal:0};
  for(let t=0;t<480;t++) {
    if(t===80) sim.queuePulse(8);
    if(t===160) sim.toggleFault(8);
    const previous=sim.snapshot(), current=sim.step();
    for(const key of Object.keys(sums)) {
      const expected=35*previous.states[key].reduce((s,x)=>s+x*x,0)
        +0.08*current.lastInputs[key].reduce((s,u)=>s+u*u,0);
      assert.ok(Math.abs(expected-current.stage[key])<1e-14);
      sums[key]+=expected;
      assert.equal(current.cumulative[key],sums[key]);
      assert.ok(Number.isFinite(current.cumulative[key]));
      assert.ok(current.cumulative[key]>=previous.cumulative[key]);
    }
  }
  assert.equal(sim.mode,'completed');
  assert.equal(sim.samples.length,60);
  assert.equal(sim.history.length,480);
  const done=sim.snapshot(); sim.step();
  assert.deepEqual(sim.snapshot(),done);
});

test('frozen optimizer converges while the plant and cumulative costs remain unchanged',()=>{
  const sim=new Simulation();
  assert.equal(sim.freeze(),false);
  for(let i=0;i<100;i++) sim.step();
  const frozen=sim.freeze(), sample=frozen.lastSample;
  const frozenSamples=JSON.stringify(sim.samples);
  assert.equal(frozen.mode,'frozen');
  assert.equal(sim.queuePulse(2),false);
  assert.equal(sim.toggleFault(2),false);
  let previous=frozen, calls=0;
  while(sim.mode!=='converged'&&calls++<2000) {
    const current=sim.fitStep();
    assert.equal(current.t,frozen.t);
    assert.deepEqual(current.states,frozen.states);
    assert.deepEqual(current.cumulative,frozen.cumulative);
    assert.deepEqual(current.history,frozen.history);
    assert.equal(current.lastSample,sample);
    assert.equal(JSON.stringify(sim.samples),frozenSamples);
    assert.ok(current.fitError<=previous.fitError+1e-13);
    assert.ok(current.fitObjective<=previous.fitObjective+1e-13);
    previous=current;
  }
  assert.equal(sim.mode,'converged');
  assert.ok(sim.fitError<constants.tolerance);
  assert.ok(sim.fitIteration>0);
  assert.ok(sim.sinceStable>0);
  const g=math.combine(math.multiply(sim.G,sim.fit.S),sim.fit.T,1,-1);
  assert.ok(math.frobenius(g)<1e-4);
  sim.resume(); assert.equal(sim.mode,'running');
  assert.equal(sim.step().t,101);
});

test('each receiver retains the three strongest remote predictive channels',()=>{
  const sim=new Simulation();
  for(let i=0;i<90;i++) sim.step();
  const snap=sim.snapshot();
  assert.equal(snap.recommendations.length,72);
  assert.equal(snap.localChannels.length,24);
  const expected=math.multiply(model.H,snap.G).map(row=>row.map(x=>-x));
  assert.ok(distance(expected,snap.directGain)<1e-14);
  for(let receiver=1;receiver<=24;receiver++) {
    const selected=snap.recommendations.filter(e=>e.to===receiver);
    const ranked=Array.from({length:24},(_,j)=>({from:j+1,weight:expected[receiver-1][j]**2}))
      .filter(e=>e.from!==receiver).sort((a,b)=>b.weight-a.weight||a.from-b.from).slice(0,3);
    assert.deepEqual(selected.map(({from,weight})=>({from,weight})),ranked);
  }
});

test('seed and interventions replay exactly and snapshot edits cannot change plant state',()=>{
  const sim=new Simulation({seed:123});
  const run=()=>{
    for(let t=0;t<100;t++) {
      if(t===40) sim.queuePulse(7);
      if(t===43) sim.queuePulse(7,0.06);
      if(t===45) sim.queuePulse(12,0.10);
      if(t===75) sim.queuePulse(23,constants.pulseMin);
      if(t===60) sim.toggleFault(6);
      sim.step();
    }
    return sim.snapshot();
  };
  const first=run(); sim.reset(); const second=run();
  assert.deepEqual(first,second);
  second.states.online[0]=100; second.G[0][0]=100; second.costs.online=100;
  const intact=sim.snapshot();
  assert.notEqual(intact.states.online[0],100);
  assert.notEqual(intact.G[0][0],100);
  assert.notEqual(intact.costs.online,100);
});
