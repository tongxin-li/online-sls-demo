'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Demo=require('./simulation.js'),toy=Demo.forNetwork('toy8');
const keys=toy.constants.controllers;
const options={protocol:'adaptive-phi-v2',experiment:'communication',powerScenario:'interactive',attackProfile:'manual-v1',beta:4,seed:20261013};
const trial=(api=toy,extra={})=>new api.Simulation({...options,...extra});
const run=(sim,count)=>{for(let i=0;i<count;i++)sim.step();return sim.snapshot();};
const near=(actual,expected,message,tolerance=1e-12)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,message+' '+actual+' versus '+expected);
const truth=(api,sim,t)=>api.math.matvec(api.model.powerToVoltage,sim.forecasts[t].base.map((value,i)=>value-api.model.lag*(t?sim.forecasts[t-1].base[i]:0)));

test('interactive trials have no automatic attacks, outages or scheduled surges at every network size',()=>{
  for(const network of Demo.networks){
    const api=Demo.forNetwork(network.id),sim=trial(api),reference=new api.Simulation({...options,attackProfile:undefined,powerScenario:'reference',faultBuses:[]});
    assert.deepEqual(sim.snapshot().faults,[]);assert.deepEqual(sim.recordContinuous().events,[]);
    for(let t=0;t<(network.id==='toy8'?65:12);t++){
      const actual=sim.step(),quiet=reference.step();
      assert.deepEqual(actual.states,quiet.states,'Ordinary background and quiet forecast physics are unchanged');
      assert.deepEqual(actual.commandQ,quiet.commandQ);assert.deepEqual(actual.cumulative,quiet.cumulative);
      assert.deepEqual(actual.lastScenarioApplications,[]);assert.deepEqual(actual.lastPulseApplications,[]);
      assert.equal(actual.scenario.active,false);assert.equal(actual.scenario.appliedKw,0);
      assert.deepEqual(actual.faults,[]);assert.deepEqual(actual.eventLog,[]);
      assert.ok(sim.forecasts.every(forecast=>!Object.hasOwn(forecast,'scheduledPowerKw')));
    }
    assert.deepEqual(sim.forecasts,reference.forecasts,'The original 6 kW stochastic background and quiet issued forecasts remain exact');
    assert.equal(api.constants.amplitude,.006);assert.equal(api.constants.inverterKvar,70);
    const s=sim.snapshot();assert.equal(s.attackProfile,'manual-v1');assert.equal(s.initialOptions.attackProfile,'manual-v1');
    assert.deepEqual(s.attackSettings.strengthsKw,network.id==='toy8'?[150,450,900]:[50,150,300]);
    assert.equal(s.attackSettings.defaultKw,network.id==='toy8'?900:150);
    assert.equal(s.attackSettings.maxKw,network.id==='toy8'?900:300);
    assert.equal(s.attackSettings.forecastFaultScale,network.id==='toy8'?8:2);
    assert.equal(s.attackSettings.forecastNoiseCoefficient,network.id==='toy8'?32:8);
    s.attackSettings.forecastStdPu.forEach((value,i)=>near(value,api.model.forecastForcingScales[i]*4*s.attackSettings.forecastNoiseCoefficient,'Reported faulty source SD includes beta'));
  }
  assert.deepEqual(trial(toy,{faultBuses:[6]}).snapshot().faults,[6],'Explicit caller reliability settings remain supported');
  assert.throws(()=>trial(toy,{attackProfile:'unrecognized'}),/Unknown attack profile/);
  assert.throws(()=>trial(toy,{powerScenario:'forecasted-demand'}),/Manual attacks require the interactive scenario/);
});

test('manual fault toggles amplify only newly issued corrupted forecasts and preserve quiet source noise',()=>{
  const manual=trial(),reference=trial(toy,{attackProfile:undefined});run(manual,45);run(reference,45);
  const sealed=JSON.stringify(manual.forecasts),sealedLength=manual.forecasts.length;
  assert.equal(manual.toggleFault(6),true);assert.equal(reference.toggleFault(6),true);
  assert.equal(JSON.stringify(manual.forecasts),sealed,'The click cannot alter already issued values');
  run(manual,8);run(reference,8);
  let exercised=false;
  for(let t=sealedLength;t<manual.forecasts.length;t++){
    const actual=truth(toy,manual,t);
    for(let bus=2;bus<=toy.constants.N;bus++){
      const oldError=reference.forecasts[t].forecast[bus-1]-actual[bus-1],newError=manual.forecasts[t].forecast[bus-1]-actual[bus-1];
      near(newError,oldError*(bus===6?8:1),'Only the explicitly corrupted source receives the manual scale');
      if(bus===6&&Math.abs(oldError)>1e-8)exercised=true;
    }
  }
  assert.ok(exercised);assert.equal(JSON.stringify(manual.forecasts.slice(0,sealedLength)),sealed);
  const repairedAfter=manual.forecasts.length;
  assert.equal(manual.toggleFault(6),false);assert.equal(reference.toggleFault(6),false);
  run(manual,8);run(reference,8);
  assert.deepEqual(manual.forecasts.slice(repairedAfter),reference.forecasts.slice(repairedAfter),'Repair restores quiet forecasts without rewriting their sealed prefix');
});

test('manual requests respect per bus aggregate limits, preserve equipment bounds and reject invalid strengths',()=>{
  for(const network of Demo.networks){
    const api=Demo.forNetwork(network.id),sim=trial(api),max=sim.snapshot().attackSettings.maxKw;
    assert.throws(()=>sim.queuePulse(6,max+1),/Pulse strength/);assert.throws(()=>sim.queuePulse(6,9),/Pulse strength/);
    assert.throws(()=>sim.queuePulse(6,NaN),/Pulse strength/);assert.equal(sim.queuePulse(1,max),false);
    sim.queuePulse(6);assert.equal(sim.snapshot().pendingPulses[0].strength,sim.snapshot().attackSettings.defaultKw);
    sim.queuePulse(6,max);sim.queuePulse(6,max);
    for(const profile of api.constants.busProfiles.filter(p=>p.role==='Solar'||p.role==='Battery'))sim.queuePulse(profile.bus,max);
    const s=sim.step(),home=s.lastPulseApplications.find(p=>p.bus===6);
    near(home.appliedKw,max,'Repeated click requests have a per bus aggregate attack cap');
    assert.ok(home.requestedKw>max);assert.equal(home.capped,true);
    near(s.lastSample.pulse[5],max,'The displayed applied value equals the simulated load increment');
    for(const profile of api.constants.busProfiles){
      const deviation=s.powerDeviation[profile.bus-1]*1000;
      if(profile.role==='Solar')assert.ok(deviation<=80+1e-10&&deviation>=-10-1e-10,'Solar availability is unchanged');
      if(profile.role==='Battery')assert.ok(Math.abs(deviation)<=90+1e-10,'Battery power remains bounded at 90 kW');
    }
    for(const key of keys)assert.ok(s.commandQ[key].every(value=>Math.abs(value)<=70+1e-10),'All controllers retain the same reactive power limits');
    for(let i=0;i<4;i++){
      sim.queuePulse(6,max,'held-target-v1');const held=sim.step().lastPulseApplications.find(p=>p.bus===6);
      assert.ok(held.appliedKw<=max+1e-10,'Holding after repeated clicks cannot exceed the aggregate cap');
      assert.equal(sim.pulses.filter(p=>p.bus===6&&p.protocol==='held-target-v1').length,1,'Each hold replaces its previous held request');
    }
  }
  const archived=trial(toy,{attackProfile:undefined});assert.throws(()=>archived.queuePulse(6,151),/150 kW/);
  assert.equal(Object.hasOwn(archived.snapshot(),'attackSettings'),false);assert.equal(Object.hasOwn(archived.initialOptions,'attackProfile'),false);
});

test('a user attack visibly lowers toy voltage while all costs and controller disturbances remain measured',()=>{
  const weak=trial(),strong=trial();run(weak,45);run(strong,45);
  weak.queuePulse(6,150);strong.queuePulse(6,900);
  let firstWeak,firstStrong;
  const totals={...strong.cumulative};
  for(let t=0;t<20;t++){
    const a=weak.step(),b=strong.step();
    if(t===0){firstWeak=Math.min(...a.voltage);firstStrong=Math.min(...b.voltage);}
    for(const key of keys){
      b.lastSample.disturbances[key].forEach((value,i)=>near(value,b.lastSample.disturbances.online[i],'Identical physical forcing reaches all four controllers'));
      totals[key]+=b.stage[key];near(b.cumulative[key],totals[key],'Every stage stays in its controller total');
    }
    const ac=toy.math.radialAC(b.loadP,b.loadQ,b.inverterQ.online);
    assert.equal(ac.converged,true);assert.ok(Math.max(...b.voltage.map((v,i)=>Math.abs(v-ac.voltage[i])))<.0025);
  }
  assert.ok(firstStrong<firstWeak-.01,'The toy maximum gives at least one percent additional immediate voltage drop');
  assert.ok(firstStrong>.95,'A single maximum toy request stays within the calibrated moderate voltage stress range');
  for(const key of keys)assert.ok(strong.cumulative[key]>weak.cumulative[key],'The larger manual disturbance contributes its actual larger cost');
  assert.deepEqual(strong.forecasts,weak.forecasts,'Unexpected user power changes never become oracle forecasts');
});

test('all toy homes can be held repeatedly without unbounded accumulation and retain an AC check',()=>{
  const sim=trial();run(sim,45);let minimum=1;
  for(let t=0;t<12;t++){
    for(const profile of toy.constants.busProfiles.filter(p=>p.role==='Homes'))sim.queuePulse(profile.bus,900,'held-target-v1');
    const s=sim.step();minimum=Math.min(minimum,...s.voltage);
    for(const pulse of s.lastPulseApplications)near(pulse.appliedKw,900,'Every held home receives its selected maximum');
    const ac=toy.math.radialAC(s.loadP,s.loadQ,s.inverterQ.online);
    assert.ok(ac.converged);assert.ok(Math.max(...s.voltage.map((v,i)=>Math.abs(v-ac.voltage[i])))<.0025);
  }
  assert.ok(minimum>.95&&minimum<.965,'All homes at maximum create noticeable but bounded toy voltage stress');
  const settled=run(sim,18);assert.deepEqual(settled.activePulses,[]);assert.deepEqual(settled.lastPulseApplications,[]);
});

test('manual attacks retain causal full response adaptation, sealed columns and exact replay',()=>{
  const sim=trial();run(sim,45);
  const initial=sim.snapshot().adaptation,columns=[...sim.continuousController.columns.values()],sealed=columns.map(column=>JSON.stringify(column));
  sim.toggleFault(6);sim.queuePulse(6,900);
  for(let t=0;t<45;t++){
    if(t===10||t===11)sim.queuePulse(6,450);
    if(t>=20&&t<25)sim.queuePulse(4,900,'held-target-v1');
    if(t===32)sim.toggleFault(6);
    sim.step();
    columns.forEach((column,i)=>assert.equal(JSON.stringify(column),sealed[i],'An attack cannot rewrite previously issued response matrices or permissions'));
  }
  const after=sim.snapshot();assert.ok(after.adaptation.updateCount>initial.updateCount);assert.ok(after.adaptation.responseVersion>initial.responseVersion);
  assert.ok(Math.abs(after.predictionDiagnostics.overallRelativeEnergyChange)>1e-9,'Updates change the measured prediction response energy');
  assert.ok(after.eventLog.every(e=>e.type==='pulse'||e.type==='forecast'),'Every attack was explicitly recorded');
  const record=sim.recordContinuous();assert.equal(record.version,15);assert.equal(record.options.attackProfile,'manual-v1');
  const replay=toy.replayContinuous(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(replay.snapshot(),after);assert.deepEqual(replay.forecasts,sim.forecasts);assert.deepEqual(replay.recordContinuous(),record);
});
