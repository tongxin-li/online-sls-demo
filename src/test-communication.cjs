'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {Simulation,model,constants,math}=require('./simulation.js');
const Calibration=require('./forecast-calibration.js');
const Response=require('./response-controller.js');

const keys=constants.controllers;
const zeroScores=()=>Array.from({length:constants.M},()=>Array(constants.N-1).fill(0));
const run=(sim,n)=>{for(let i=0;i<n;i++)sim.step();return sim.snapshot();};
const clone=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,tolerance=1e-12)=>{
  assert.equal(actual.length,expected.length);
  for(let i=0;i<actual.length;i++){
    if(Array.isArray(actual[i]))near(actual[i],expected[i],tolerance);
    else assert.ok(Math.abs(actual[i]-expected[i])<=tolerance,
      `entry ${i} differs by ${Math.abs(actual[i]-expected[i])}`);
  }
};
const communication=options=>new Simulation({experiment:'communication',seed:17,horizon:90,...options});

test('communication noise changes only forecast errors and preserves paired physical disturbances',()=>{
  const trials=constants.communicationBetas.map(beta=>communication({beta,horizon:45}));
  for(let t=0;t<40;t++){
    const states=trials.map(sim=>sim.step());
    for(let i=1;i<trials.length;i++){
      assert.deepEqual(states[i].lastSample.base,states[0].lastSample.base);
      near(states[i].lastSample.disturbance,states[0].lastSample.disturbance,1e-14);
    }
  }
  for(let q=0;q<trials[0].forecasts.length;q++){
    const zero=trials[0].forecasts[q];
    const previous=q?trials[0].forecasts[q-1].base:Array(constants.N).fill(0);
    const truth=math.matvec(model.powerToVoltage,zero.base.map((value,j)=>value-model.lag*previous[j]));
    near(zero.forecast,truth,1e-15);
    for(let b=1;b<trials.length;b++)for(let j=0;j<constants.N;j++){
      const expected=zero.forecast[j]+constants.communicationBetas[b]*(trials[3].forecasts[q].forecast[j]-zero.forecast[j]);
      assert.ok(Math.abs(trials[b].forecasts[q].forecast[j]-expected)<1e-14);
    }
  }
});

test('changing a source quality changes its forecast error by the declared factor without exposing labels to the fit',()=>{
  const good=communication({faultBuses:[],horizon:45});
  const bad=communication({faultBuses:[12],horizon:45});
  const truth=communication({beta:0,faultBuses:[],horizon:45});
  run(good,40);run(bad,40);run(truth,40);
  for(let q=0;q<good.forecasts.length;q++){
    assert.deepEqual(good.forecasts[q].base,bad.forecasts[q].base);
    for(let j=0;j<constants.N;j++){
      if(j!==11)assert.equal(good.forecasts[q].forecast[j],bad.forecasts[q].forecast[j]);
      else {
        const clean=truth.forecasts[q].forecast[j];
        assert.ok(Math.abs((bad.forecasts[q].forecast[j]-clean)-80*(good.forecasts[q].forecast[j]-clean))<1e-14);
      }
    }
  }
  const expected=Calibration.fit(bad.samples.slice(0,-1),{lambda:model.calibrationRidge});
  assert.deepEqual(bad.calibration.matrix,expected.matrix);
});

test('discovery scores equal an independent sum of executed direct gains with a matched offline scoring schedule',()=>{
  const sim=communication({horizon:75});
  const learned=zeroScores(),fixed=zeroScores();let count=0;
  assert.equal(sim.deployTopology(),false);
  for(let t=0;t<70;t++){
    const revealed=sim.samples.slice(-constants.window);
    const C=t<constants.warmup?Calibration.identity():Calibration.fit(revealed,{lambda:model.calibrationRidge}).matrix;
    const row=sim.segments[0].dense.rows[t];
    if(t>=constants.warmup){
      for(const block of row)for(let r=0;r<constants.M;r++)for(let j=0;j<constants.N-1;j++){
        let gain=0;
        for(let a=0;a<constants.N-1;a++)gain+=block.L[r][a]*C[a][j];
        learned[r][j]+=gain*gain;fixed[r][j]+=block.L[r][j]*block.L[r][j];
      }
      count++;
    }
    const state=sim.step();
    assert.equal(state.predictionDiagnostics.scoreSamples,count);
    assert.equal(sim.communicationScoreSamples,count);
    if(count){
      near(state.predictionDiagnostics.learnedScores,learned.map(row=>row.map(value=>value/count)),1e-10);
      near(state.predictionDiagnostics.baselineScores,fixed.map(row=>row.map(value=>value/count)),1e-10);
    }
    if(t===constants.warmup-1)assert.equal(state.canDeploy,false);
    if(t===constants.warmup)assert.equal(state.canDeploy,true);
    const before=clone(sim.communicationScores);
    sim.snapshot();sim.snapshot();
    assert.deepEqual(sim.communicationScores,before,'reading the interface must not add another observation');
  }
  const learnedMask=Response.supportFromScores(learned,constants.inverterBuses,constants.remoteBudget,1e-12);
  const fixedMask=Response.supportFromScores(fixed,constants.inverterBuses,constants.remoteBudget,1e-12);
  assert.ok(sim.deployTopology());
  assert.deepEqual(sim.deployedSupport.learned,learnedMask.support);
  assert.deepEqual(sim.deployedSupport.fixed,fixedMask.support);
});

test('the current attack cannot affect the calibration or topology scored for the same action',()=>{
  const clean=communication(),attacked=communication();
  run(clean,45);run(attacked,45);
  const revealed=attacked.samples.slice(-constants.window);
  attacked.queuePulse(23,100);
  const a=clean.step(),b=attacked.step();
  assert.deepEqual(a.calibration,b.calibration);
  assert.deepEqual(a.lastInputs,b.lastInputs);
  assert.deepEqual(a.predictionDiagnostics.learnedScores,b.predictionDiagnostics.learnedScores);
  assert.deepEqual(b.calibration.matrix,Calibration.fit(revealed,{lambda:model.calibrationRidge}).matrix);
  assert.equal(b.calibration.trainedThrough,44);
  assert.notDeepEqual(a.lastSample.disturbance,b.lastSample.disturbance);
  const nextRevealed=attacked.samples.slice(-constants.window),next=attacked.step();
  assert.deepEqual(next.calibration.matrix,Calibration.fit(nextRevealed,{lambda:model.calibrationRidge}).matrix);
  assert.equal(next.calibration.trainedThrough,45);
});

test('zero forecast noise selects the same sparse support and produces the same executed comparison costs',()=>{
  const sim=communication({beta:0,horizon:80});run(sim,65);
  assert.ok(sim.deployTopology());
  assert.deepEqual(sim.deployedSupport.learned,sim.deployedSupport.fixed);
  for(let t=0;t<75;t++){
    if(t===18||t===19)sim.queuePulse(23,100);
    if(t>=45&&t<50)sim.queuePulse(7,50);
    const state=sim.step();
    near(state.lastInputs.online,state.lastInputs.scalar,1e-14);
    near(state.states.online,state.states.scalar,1e-14);
    assert.ok(Math.abs(state.cumulative.online-state.cumulative.scalar)<1e-14);
  }
});

test('deployment starts a fresh paired physical trial and preserves only the selected topology evidence',()=>{
  const seed=17,sim=communication({seed});run(sim,65);
  const discovery=sim.snapshot(),discoveryEvidence=clone(discovery.predictionDiagnostics);
  const initialDiscoveryForecast=clone(sim.forecasts[0]);
  assert.ok(sim.deployTopology());
  const state=sim.snapshot(),deploymentSeed=(seed^0x9E3779B9)>>>0;
  assert.equal(state.phase,'deployment');assert.equal(state.seed,deploymentSeed);assert.equal(state.t,0);
  assert.equal(state.sampleCount,0);assert.equal(state.history.length,0);
  for(const key of keys){assert.equal(state.cumulative[key],0);assert.deepEqual(state.states[key],model.baseDrop);}
  assert.notDeepEqual(sim.forecasts[0].base,initialDiscoveryForecast.base);
  const independent=communication({seed:deploymentSeed});
  assert.deepEqual(sim.forecasts,independent.forecasts);
  assert.deepEqual(state.calibration.matrix,Calibration.identity());assert.equal(state.calibration.scalar,1);
  assert.equal(state.calibration.updates,0);assert.equal(state.calibration.windowSize,0);
  assert.deepEqual(state.predictionDiagnostics,{...discoveryEvidence,frozen:true});
  assert.equal(state.deployedSupport.scoreSamples,discovery.predictionDiagnostics.scoreSamples);
});

test('deployed commands use fixed synthesized gains and raw forecasts while forbidden sources remain zero',()=>{
  const sim=communication({horizon:80});run(sim,65);assert.ok(sim.deployTopology());
  for(const key of ['online','scalar']){
    const support=sim.deployedSupport[key==='online'?'learned':'fixed'];
    assert.equal(support.flat().filter(Boolean).length,constants.M*(constants.remoteBudget+1));
    for(let r=0;r<constants.M;r++){
      assert.equal(support[r][constants.inverterBuses[r]-2],true);
      assert.equal(support[r].filter(Boolean).length,constants.remoteBudget+1);
    }
    for(const row of sim.segments[0].designs[key].rows)for(const block of row)
      for(let r=0;r<constants.M;r++)for(let j=0;j<constants.N-1;j++)
        if(!support[r][j])assert.ok(Math.abs(block.L[r][j])<1e-12);
  }
  for(let t=0;t<70;t++){
    if(t>=25&&t<30)sim.queuePulse(12,50);
    const before=sim.snapshot(),state=sim.step();
    for(const key of keys){
      const x=before.states[key].slice(1).map((value,j)=>value-model.baseDrop[j+1]);
      const raw=math.matvec(model.K,x);
      if(key!=='causal')for(const block of sim.segments[0].designs[key].rows[t]){
        const forecast=sim.forecasts[block.k-1].forecast.slice(1);
        for(let r=0;r<constants.M;r++)for(let j=0;j<constants.N-1;j++)raw[r]+=block.L[r][j]*forecast[j];
      }
      const bounded=raw.map(value=>Math.max(-model.qLimit,Math.min(model.qLimit,value)));
      near(state.lastInputs[key],math.padInput(bounded),1e-13);
    }
  }
});

test('held out observations and repeated attacks cannot change frozen comparison coefficients or topology scores',()=>{
  const sim=communication({horizon:80});run(sim,65);assert.ok(sim.deployTopology());
  const initial=sim.snapshot(),designs=sim.segments[0].designs;
  const weights=clone(initial.directGain),scores=clone(initial.predictionDiagnostics),calibration=clone(initial.calibration);
  for(let t=0;t<70;t++){
    if(t>=15&&t<25)sim.queuePulse(23,100);
    if(t===32)sim.toggleFault(12);
    const state=sim.step();
    assert.deepEqual(state.calibration,calibration);
    assert.deepEqual(state.directGain,weights);
    assert.deepEqual(state.predictionDiagnostics,scores);
    assert.deepEqual(state.recommendations,initial.recommendations);
    assert.equal(state.predictionDiagnostics.frozen,true);
    assert.equal(state.calibration.updates,0);
    for(const key of ['online','scalar','static'])assert.equal(sim.segments[0].designs[key],designs[key]);
  }
  assert.equal(sim.samples.length,70,'comparison observations are recorded even though policies are fixed');
});
