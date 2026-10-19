'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Demo=require('./simulation.js'),toy=Demo.forNetwork('toy8');
const baseline=require('./fixtures/strong-stress-standard.json');
const keys=toy.constants.controllers;
const options={protocol:'adaptive-phi-v2',experiment:'communication',powerScenario:'forecasted-demand',beta:4,seed:17};
const trial=extra=>new toy.Simulation({...options,...extra});
const run=(sim,count)=>{for(let i=0;i<count;i++)sim.step();return sim.snapshot();};
const near=(actual,expected,message,tolerance=1e-13)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,message+' '+actual+' versus '+expected);
const truth=(api,sim,t)=>api.math.matvec(api.model.powerToVoltage,sim.forecasts[t].base.map((value,i)=>value-api.model.lag*(t?sim.forecasts[t-1].base[i]:0)));
function legacyTrajectory(sim){
  const s=sim.snapshot();return {states:s.states,cumulative:s.cumulative,commandQ:s.commandQ,stage:s.stage,
    disturbances:s.lastSample.disturbances,forecasts:sim.forecasts.map(f=>({t:f.t,issuedAt:f.issuedAt,base:f.base,forecast:f.forecast}))};
}
function compareBaseline(actual,expected,field='trajectory'){
  if(typeof expected==='number'){near(actual,expected,field,1e-12);return;}
  if(expected===null||typeof expected!=='object'){assert.equal(actual,expected,field);return;}
  assert.ok(actual!==null&&typeof actual==='object',field+' remains an object');
  assert.equal(Array.isArray(actual),Array.isArray(expected),field+' retains its shape');
  assert.deepEqual(Object.keys(actual),Object.keys(expected),field+' retains every field and array entry');
  for(const key of Object.keys(expected))compareBaseline(actual[key],expected[key],field+'.'+key);
}

test('absent and explicit standard profiles preserve captured prechange v13 v14 and v15 trajectories exactly',()=>{
  // Captured from prechange 4e34cd7 with unchanged controller dependencies.
  // Math and floating point JSON bytes can differ between Node runtimes and
  // platforms. Cross runtime values use 1e-12 absolute tolerance; same runtime
  // omitted versus explicit Standard and archived replay remain exact.
  assert.equal(baseline.sourceRevision,'4e34cd76542a521466fc2a8da676da447ae7539e');
  assert.equal(baseline.actions,80);assert.equal(baseline.seed,17);assert.equal(baseline.network,'toy8');
  for(const fixture of baseline.cases){
    const protocol=fixture.protocol??undefined;
    const absent=trial({protocol}),standard=trial({protocol,stressProfile:'standard'});
    assert.deepEqual(run(absent,80),run(standard,80));
    compareBaseline(legacyTrajectory(absent),fixture.data);
    assert.equal(Object.hasOwn(absent.initialOptions,'stressProfile'),false,'Original replay options remain unchanged');
    assert.equal(Object.hasOwn(absent.snapshot(),'stressProfile'),false,'Original snapshot shape remains unchanged');
    assert.equal(absent.snapshot().forecastFaultScale??1,1);
  }
});

test('strong schedule has declared nonnegative peaks and branch delays at every network size',()=>{
  for(const network of Demo.networks){
    const api=Demo.forNetwork(network.id),meta=api.constants.strongDemand;
    assert.ok(Object.isFrozen(meta));assert.ok(Object.isFrozen(meta.noisySources));
    assert.equal(meta.profile,'strong-v1');assert.equal(meta.periodSeconds,30);assert.equal(meta.forecastFaultScale,2);
    assert.equal(meta.riseSeconds,2);assert.equal(meta.holdSeconds,4);assert.equal(meta.fallSeconds,2);
    assert.equal(meta.homeAmplitudeKw,120);assert.equal(meta.solarLossMaxKw,60);assert.equal(meta.batteryAmplitudeKw,60);
    for(const profile of api.constants.busProfiles){
      const original=profile.bus>24?profile.bus-23:profile.bus,delay=original>=13?4:0;
      const peak=profile.role==='Homes'?120:profile.role==='Solar'||profile.role==='Battery'?60:0;
      for(const t of [0,1,2,4,7,15,19,30,34,45,49,...[.5,1,1.5,2,3,5.5,6,6.5,7,7.5,8,9,29,30,30.5,31].map(phase=>delay+phase)]){
        const phase=Math.max(0,t-delay)%30;
        const envelope=phase<2?(1-Math.cos(Math.PI*phase/2))/2:phase<6?1:phase<8?(1+Math.cos(Math.PI*(phase-6)/2))/2:0;
        const expected=peak*envelope;
        near(1000*api.math.scheduledPower(profile.bus,t,'strong-v1'),expected,'Declared role and delay',1e-11);
      }
      near(1000*api.math.scheduledPower(profile.bus,3+delay,'strong-v1'),peak,'Declared peak',1e-11);
      for(const phase of [9,15,29])assert.equal(api.math.scheduledPower(profile.bus,phase+delay,'strong-v1'),0,'Surge ends before the quiet interval');
      near(api.math.scheduledPower(profile.bus,.5+delay,'strong-v1'),api.math.scheduledPower(profile.bus,30.5+delay,'strong-v1'),'Surge recurs after the quiet interval');
      assert.equal(api.math.scheduledPower(profile.bus,0,'strong-v1'),0);
    }
  }
  assert.throws(()=>trial({stressProfile:'undeclared'}),/Unknown stress profile/);
});

test('strong forecast errors double only corrupted sources at unchanged beta and leave quiet source noise unchanged',()=>{
  const standard=trial({faultBuses:[3,7]}),strong=trial({faultBuses:[3,7],stressProfile:'strong-v1'});
  run(standard,25);run(strong,25);
  assert.equal(strong.snapshot().stressProfile,'strong-v1');assert.equal(strong.snapshot().forecastFaultScale,2);
  assert.equal(strong.snapshot().beta,standard.snapshot().beta);
  let noisy=false,quiet=false;
  for(let t=0;t<standard.forecasts.length;t++){
    const a=truth(toy,standard,t),b=truth(toy,strong,t);
    for(let bus=2;bus<=toy.constants.N;bus++){
      const oldError=standard.forecasts[t].forecast[bus-1]-a[bus-1],newError=strong.forecasts[t].forecast[bus-1]-b[bus-1];
      const faulty=[3,7].includes(bus);
      near(newError,(faulty?2:1)*oldError,'Only corrupted source noise is doubled',1e-14);
      if(Math.abs(oldError)>1e-10){if(faulty)noisy=true;else quiet=true;}
    }
  }
  assert.ok(noisy&&quiet,'The check exercises nonzero errors in both source classes');
});

test('strong physical forcing is shared by all controllers and respects equipment and control bounds',()=>{
  const fixedModel=JSON.stringify(toy.model),fixedConstants=JSON.stringify(toy.constants),sim=trial({stressProfile:'strong-v1'}),totals=Object.fromEntries(keys.map(key=>[key,0]));
  for(let t=0;t<80;t++){
    const s=sim.step(),w=truth(toy,sim,t);
    assert.deepEqual(s.lastSample.base,sim.forecasts[t].base);
    assert.deepEqual(s.powerDeviation,sim.forecasts[t].base,'Scheduled physical power enters exactly once');
    assert.equal(s.lastScenarioApplications.length,7);
    for(const key of keys){
      s.lastSample.disturbances[key].forEach((value,i)=>near(value,w[i],'Every controller has identical realized forcing'));
      assert.ok(s.commandQ[key].every(value=>Number.isFinite(value)&&Math.abs(value)<=70+1e-10));
      assert.ok(s.states[key].every(Number.isFinite));
      totals[key]+=s.stage[key];near(s.cumulative[key],totals[key],'Every executed stage cost remains in the total');
    }
    for(const profile of toy.constants.busProfiles){
      const value=s.powerDeviation[profile.bus-1]*1000;
      if(profile.role==='Solar')assert.ok(value>=-10-1e-10&&value<=80+1e-10);
      if(profile.role==='Battery')assert.ok(Math.abs(value)<=90+1e-10);
      if(profile.role==='Homes')assert.ok(value>=-70-1e-10);
      if(profile.role==='Substation')assert.equal(value,0);
    }
    const receipt=s.lastExecution;
    assert.ok(receipt.trainedThrough===null||receipt.trainedThrough<receipt.action,'No current or future truth enters the executed response');
  }
  assert.ok(sim.snapshot().adaptation.updateCount>0,'The strong trial exercises actual response learning');
  assert.deepEqual(sim.eventLog.filter(event=>event.type==='scenario').map(event=>event.t),[0,30,60]);
  assert.equal(JSON.stringify(toy.model),fixedModel,'Physical matrices, feedback and objective are unchanged');
  assert.equal(JSON.stringify(toy.constants),fixedConstants,'Controller and equipment constants are unchanged');
});

test('source changes and power attacks retain sealed forecasts and response columns and replay the strong trial exactly',()=>{
  const sim=trial({stressProfile:'strong-v1'});run(sim,42);
  const sealed=JSON.stringify(sim.forecasts),sealedLength=sim.forecasts.length,issued=[...sim.continuousController.columns.values()].at(-1),column=JSON.stringify(issued);
  sim.toggleFault(7);assert.equal(JSON.stringify(sim.forecasts),sealed);
  sim.queuePulse(4,100);assert.equal(JSON.stringify(sim.forecasts),sealed);
  for(let i=0;i<38;i++){
    if(i===12)sim.toggleFault(7);
    if(i===20)sim.queuePulse(8,50);
    sim.step();
    assert.equal(JSON.stringify(issued),column,'Already issued matrices and permissions never change');
    assert.equal(JSON.stringify(sim.forecasts.slice(0,sealedLength)),sealed,'Previously issued forecasts never change');
    const disturbances=sim.snapshot().lastSample.disturbances;
    for(const key of keys)disturbances[key].forEach((value,i)=>near(value,disturbances.online[i],'Manual physical stress is common to all controllers'));
  }
  const record=sim.recordContinuous();assert.equal(record.version,15);assert.equal(record.options.stressProfile,'strong-v1');
  assert.ok(Object.isFrozen(record));assert.ok(record.events.some(event=>event.type==='pulse'));assert.ok(record.events.some(event=>event.type==='forecast'));
  const replay=toy.replayContinuous(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(replay.snapshot(),sim.snapshot(),'Exact states, all costs, support, receipts and learning state');
  assert.deepEqual(replay.forecasts,sim.forecasts);assert.deepEqual(replay.recordContinuous(),record);
});

test('stronger declared power creates lower voltage and larger measured costs without requiring a preferred winner',()=>{
  // Zero noise isolates the physical schedule from its separate corruption setting.
  const standard=trial({beta:0}),strong=trial({beta:0,stressProfile:'strong-v1'});
  let standardMin=Infinity,strongMin=Infinity;
  for(let t=0;t<80;t++){
    const a=standard.step(),b=strong.step();standardMin=Math.min(standardMin,...a.voltage);strongMin=Math.min(strongMin,...b.voltage);
    const expected=truth(toy,strong,t);
    strong.forecasts[t].forecast.forEach((value,i)=>near(value,expected[i],'Zero beta still disables forecast noise'));
  }
  assert.ok(strongMin<standardMin-.001,'The stronger environment has a visible additional voltage deviation');
  for(const key of keys)assert.ok(strong.cumulative[key]>standard.cumulative[key],'Each controller retains the larger physical cost');
  assert.equal(strong.t,80);assert.equal(standard.t,80);
});
