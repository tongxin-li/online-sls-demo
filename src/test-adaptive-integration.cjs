'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Demo=require('./simulation.js');
const plan=require('../refinement/adaptive-response-plan.json').predefined_integration;
const keys=['online','scalar','static','causal'];
function apply(sim,api,t){
  if(t===plan.corrupt_first_inverter||t===plan.repair_first_inverter)sim.toggleFault(api.constants.inverterBuses[0]);
  if(t>=plan.held_power_on_last_bus[0]&&t<=plan.held_power_on_last_bus[1])sim.queuePulse(api.constants.N,plan.requested_kw,'held-target-v1');
}
for(const networkId of plan.networks)for(const quality of plan.quality)test(networkId+' '+quality+' full response learning preserves physics, baseline fairness and replay',()=>{
  const api=Demo.forNetwork(networkId),options={networkId,experiment:'communication',powerScenario:'forecasted-demand',preset:'mixed',beta:4,seed:plan.seed};
  if(quality==='reliable')options.faultBuses=[];
  if(quality==='all_noisy')options.faultBuses=Array.from({length:api.constants.N-1},(_,j)=>j+2);
  const sim=new api.Simulation({...options,protocol:'adaptive-phi-v2'}),old=new api.Simulation({...options,protocol:'continuous-phi-v1'});
  const totals=Object.fromEntries(keys.map(k=>[k,0]));let beforeBoundary,earlierUpdates=0;
  for(let t=0;t<plan.steps;t++){
    apply(sim,api,t);apply(old,api,t);sim.step();old.step();
    assert.equal(sim.t,t+1);assert.equal(sim.samples.length,t+1);assert.equal(sim.history.length,t+1);
    assert.deepEqual(sim.lastSample.powerDeviation,old.lastSample.powerDeviation,'Same physical exogenous input');
    assert.deepEqual(sim.forecasts[t],old.forecasts[t],'Same immutable raw forecast');
    for(const key of ['scalar','static','causal']){
      assert.deepEqual(sim.command[key],old.command[key],'Unchanged baseline command '+key);
      assert.deepEqual(sim.states[key],old.states[key],'Unchanged baseline state '+key);
      assert.equal(sim.cumulative[key],old.cumulative[key],'Unchanged baseline cost '+key);
    }
    for(const key of keys){totals[key]+=sim.stage[key];assert.equal(totals[key],sim.cumulative[key]);assert.ok(sim.command[key].every(x=>Number.isFinite(x)&&Math.abs(x)<=.07+1e-12));}
    const r=sim.lastExecution;
    assert.equal(r.action,t);assert.ok(r.trainedThrough===null||r.trainedThrough<t);
    if(t===179){beforeBoundary={...sim.cumulative};earlierUpdates=sim.learning.updates;}
    if(t===180)for(const key of keys)assert.equal(sim.cumulative[key],beforeBoundary[key]+sim.stage[key]);
  }
  const snap=sim.snapshot();assert.ok(snap.learning.updates>earlierUpdates,'Learning continues beyond old phase boundary');
  assert.equal(snap.planning.topologyAdaptive,true);
  assert.ok(sim.continuousController.learningTraffic,'Central learning traffic is separately reported');
  const restored=api.replayContinuous(sim.recordContinuous());
  assert.deepEqual(restored.snapshot(),snap,'Exact full state and history replay');
  restored.step();sim.step();assert.deepEqual(restored.snapshot(),sim.snapshot(),'Exact resumed action');
  console.log('ADAPTIVE_OUTCOME '+JSON.stringify({networkId,quality,seed:plan.seed,steps:plan.steps,costs:snap.cumulative,
    topology:snap.adaptation,updates:snap.learning.updates}));
});
