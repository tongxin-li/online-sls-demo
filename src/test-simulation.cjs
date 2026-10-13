'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {Simulation,model,constants,math}=require('./simulation.js');
const {multiply,transpose,combine,frobenius,matvec,solveSPD,eye}=math;
const controllers=constants.controllers;
const distance=(a,b)=>frobenius(combine(a,b,1,-1));
const vectorDistance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const run=(sim,n)=>{for(let i=0;i<n;i++)sim.step();return sim.snapshot();};
const bounded=a=>a.map(v=>Math.max(-.07,Math.min(.07,v)));
const reg=s=>s.map((v,i)=>v-model.baseDrop[i]).slice(1);

test('radial sensitivity matrices come from positive line impedances with correct bases and slack',()=>{
  assert.equal(constants.edges.length,23);assert.equal(model.A.length,23);assert.equal(model.B[0].length,8);
  assert.equal(model.baseKv,12.47);assert.equal(model.baseMva,1);
  for(const edge of model.edgeData){
    assert.ok(edge.rOhm>0&&edge.xOhm>0);
    assert.ok(Math.abs(edge.rPu-edge.rOhm/(12.47**2))<1e-15);
  }
  assert.equal(new Set(model.order).size,24);
  assert.deepEqual(model.resistance[0],Array(24).fill(0));assert.deepEqual(model.reactance[0],Array(24).fill(0));
  for(let i=0;i<24;i++)for(let j=0;j<24;j++){
    let r=0,x=0;
    for(let e=0;e<23;e++){r+=model.paths[i][e]*model.paths[j][e]*model.edgeData[e].rPu;x+=model.paths[i][e]*model.paths[j][e]*model.edgeData[e].xPu;}
    assert.ok(Math.abs(model.resistance[i][j]-r)<1e-15);assert.ok(Math.abs(model.reactance[i][j]-x)<1e-15);
  }
  const s=new Simulation().snapshot();
  assert.deepEqual(s.voltage,s.referenceVoltage);assert.deepEqual(s.initialVoltage,s.referenceVoltage);
  assert.ok(Math.min(...s.referenceVoltage)>.95&&Math.max(...s.referenceVoltage)<=1.05);
  assert.ok(Math.abs(Math.min(...s.voltage)-.9873849473897026)<1e-14);
  assert.deepEqual(s.regulationStates.online,Array(24).fill(0));
});

test('general B DARE and five LQR preview coefficients are correct for the inverter lag model',()=>{
  const {A,B,P,Q,R,K}=model,at=transpose(A),bt=transpose(B),S=combine(R,multiply(bt,multiply(P,B)));
  const positiveGain=solveSPD(S,multiply(bt,multiply(P,A)));
  const rhs=combine(combine(Q,multiply(at,multiply(P,A))),multiply(at,multiply(P,multiply(B,positiveGain))),1,-1);
  assert.ok(distance(P,rhs)<1e-10);assert.ok(model.dareResidual<1e-10);
  assert.ok(distance(K,positiveGain.map(row=>row.map(v=>-v)))<1e-14);
  const act=transpose(combine(A,multiply(B,K)));let response=P;
  for(let j=0;j<5;j++){
    assert.ok(distance(model.previewGains[j],solveSPD(S,multiply(bt,response)).map(row=>row.map(v=>-v)))<1e-14);
    response=multiply(act,response);
    const expected=multiply(j<4?combine(model.previewGains[j],model.previewGains[j+1],1,-model.lag):model.previewGains[j],model.F);
    assert.ok(distance(model.powerPreviewGains[j],expected)<1e-14);
  }
  assert.ok(model.closedLoopNormInf<1);
  assert.ok(Math.abs(model.lag-Math.exp(-.5))<1e-15);
  for(let i=0;i<23;i++)for(let j=0;j<8;j++)assert.ok(Math.abs(B[i][j]-(1-model.lag)*model.reactance[i+1][constants.inverterBuses[j]-1])<1e-15);
});

test('all four plants obey physical voltage, inverter lag, capability, and common disturbance equations',()=>{
  const sim=new Simulation();
  for(let t=0;t<100;t++){
    if(t===35||t===36)sim.queuePulse(23,150);
    if(t===65)sim.queuePulse(7,150);
    const previous=sim.snapshot(),current=sim.step();
    for(const key of controllers){
      assert.equal(current.voltages[key][0],1);assert.equal(current.lastInputs[key][0],0);
      const old=reg(previous.states[key]),next=reg(current.states[key]);
      const u=constants.inverterBuses.map(bus=>current.lastInputs[key][bus-1]);
      const expected=matvec(model.A,old),bu=matvec(model.B,u);
      assert.ok(vectorDistance(next,expected.map((v,i)=>v+bu[i]+current.lastSample.voltageDisturbance[i+1]))<1e-14);
      for(let bus=1;bus<=24;bus++){
        const q=current.inverterQ[key][bus-1],command=current.commandQ[key][bus-1];
        assert.ok(Math.abs(q)<=70+1e-12&&Math.abs(command)<=70+1e-12);
        assert.ok(Math.abs(q-model.lag*previous.inverterQ[key][bus-1]-(1-model.lag)*command)<1e-12);
        assert.equal(command,current.lastInputs[key][bus-1]*1000);
        if(!constants.inverterBuses.includes(bus))assert.equal(q,0);
        else assert.ok(q*q+current.inverterP[bus-1]**2<=120**2+1e-9);
      }
      const p=current.loadP.map(v=>v/1000),q=current.loadQ.map((v,i)=>(v-current.inverterQ[key][i])/1000);
      const rv=matvec(model.resistance,p),xv=matvec(model.reactance,q);
      assert.ok(vectorDistance(current.states[key],rv.map((v,i)=>-v-xv[i]))<1e-14);
    }
  }
});

test('static preview equals directly assembled disturbance predictions and shares the known measured term',()=>{
  const sim=new Simulation({horizon:37});
  for(let t=0;t<37;t++){
    const previous=sim.snapshot(),snap=sim.step();
    const currentF=matvec(model.F,previous.powerDeviation);
    let expected=matvec(model.K,reg(previous.states.static));
    let predictedPrevious=currentF;
    const anchor=t>0?sim.forecasts[t-1].forecast:Array(24).fill(0);
    snap.lastPreview.forEach((prediction,j)=>{
      const predictedPower=previous.powerDeviation.map((v,i)=>v+prediction.forecast[i]-anchor[i]);
      const predictedNext=matvec(model.F,predictedPower);
      const w=predictedNext.map((v,i)=>v-model.lag*predictedPrevious[i]);
      const ff=matvec(model.previewGains[j],w);expected=expected.map((v,i)=>v+ff[i]);predictedPrevious=predictedNext;
    });
    assert.ok(vectorDistance(snap.lastInputs.static,math.padInput(bounded(expected)))<1e-15);
    const causalFeedback=matvec(model.K,reg(previous.states.causal));
    const known=Array(8).fill(0);
    snap.lastPreview.forEach((prediction,j)=>{
      const hold=matvec(model.previewGains[j],currentF.map(v=>(1-model.lag)*v));
      for(let i=0;i<8;i++)known[i]+=hold[i];
    });
    assert.ok(vectorDistance(snap.lastInputs.causal,math.padInput(bounded(causalFeedback.map((v,i)=>v+known[i]))))<1e-15);
    assert.deepEqual(snap.lastSample.anchorForecast,anchor);
    assert.deepEqual(snap.lastSample.observedPower,previous.powerDeviation);
    assert.ok(Object.isFrozen(snap.lastSample.forecast));
    if(t<30){assert.deepEqual(snap.states.online,snap.states.static);assert.deepEqual(snap.states.scalar,snap.states.static);}
  }
});

test('cost is actual voltage profile error plus the actual bounded reactive command penalty',()=>{
  const sim=new Simulation(),sums=Object.fromEntries(controllers.map(key=>[key,0]));
  for(let t=0;t<180;t++){
    if(t===50)for(let k=0;k<20;k++)sim.queuePulse(23,150);
    const previous=sim.snapshot(),snap=sim.step();
    assert.equal(snap.costTime,t);assert.equal(snap.stateTime,t+1);
    assert.deepEqual(snap.costStates,previous.states);
    for(const key of controllers){
      const error=reg(previous.states[key]);
      const expected=35*error.reduce((s,v)=>s+v*v,0)+.08*snap.lastInputs[key].reduce((s,v)=>s+v*v,0);
      assert.ok(Math.abs(expected-snap.stage[key])<1e-14);sums[key]+=expected;
      assert.ok(Math.abs(sums[key]-snap.costs[key])<1e-12);
      assert.deepEqual(snap.history.at(-1).costStates[key],previous.states[key]);
    }
  }
  assert.ok(sim.history.some(row=>row.states.online.some(v=>v<-.05)),'voltage is never display clipped');
});

test('a home attack changes physical P and Q after the command, never the issued forecasts or current gain',()=>{
  const clean=new Simulation(),attacked=new Simulation();run(clean,40);run(attacked,40);
  const before=attacked.snapshot();assert.equal(attacked.queuePulse(23,100),true);
  const queued=attacked.snapshot();for(const field of ['t','states','costs','G','history'])assert.deepEqual(queued[field],before[field]);
  const a=clean.step(),b=attacked.step();
  assert.deepEqual(a.lastPreview,b.lastPreview);assert.deepEqual(a.G,b.G);assert.deepEqual(a.lastInputs,b.lastInputs);
  assert.deepEqual(a.stage,b.stage);assert.ok(Math.abs(b.loadP[22]-a.loadP[22]-100)<1e-12);
  const ratio=Math.tan(Math.acos(.95));assert.ok(Math.abs(b.loadQ[22]-a.loadQ[22]-100*ratio)<1e-12);
  for(const key of controllers)for(let i=0;i<24;i++)assert.ok(Math.abs(b.states[key][i]-a.states[key][i]-model.powerToVoltage[i][22]*.1)<1e-14);
  assert.equal(b.lastPulseApplications[0].requestedKw,100);assert.ok(Math.abs(b.lastPulseApplications[0].appliedKw-100)<1e-12);
  const c=clean.step(),d=attacked.step();assert.notDeepEqual(c.G,d.G);assert.notDeepEqual(c.lastInputs.online,d.lastInputs.online);
  assert.ok(d.stage.online>c.stage.online);
});

test('slack is not attackable and physical solar and battery power limits are explicit',()=>{
  const sim=new Simulation(),initial=sim.snapshot();assert.equal(sim.queuePulse(1,100),false);assert.deepEqual(sim.snapshot(),initial);
  assert.equal(sim.toggleFault(1),false);
  for(const bus of [7,12]){
    const s=new Simulation();for(let n=0;n<4;n++)assert.equal(s.queuePulse(bus,150),true);
    const current=s.step(),profile=constants.busProfiles[bus-1],applied=current.lastPulseApplications.find(p=>p.bus===bus);
    assert.equal(applied.requestedKw,600);assert.equal(applied.capped,true);
    if(profile.role==='Solar'){assert.ok(Math.abs(current.generationP[bus-1])<1e-10);assert.ok(current.powerDeviation[bus-1]<=.08);}
    else assert.ok(Math.abs(current.inverterP[bus-1]+90)<1e-10);
    assert.ok(applied.appliedKw<150);
  }
  for(const bad of [NaN,Infinity,0,9,151,'100'])assert.throws(()=>sim.queuePulse(3,bad),RangeError);
});

test('home pulses can repeat at the same and subsequent samples with exact decay and no cooldown',()=>{
  const sim=new Simulation(),clean=new Simulation();
  sim.queuePulse(23,100);sim.queuePulse(23,100);
  const profile=constants.busProfiles[22];
  for(let t=0;t<15;t++){
    if(t===1)sim.queuePulse(23,50);
    const a=clean.step(),b=sim.step();
    let expected=t<profile.steps?200*Math.exp(-t/profile.decay):0;
    if(t>=1&&t-1<profile.steps)expected+=50*Math.exp(-(t-1)/profile.decay);
    assert.ok(Math.abs(b.loadP[22]-a.loadP[22]-expected)<1e-10);
    assert.equal(b.pendingPulses.length,0);
  }
});

test('shared and scalar ridge fits use the same previous revealed physical power window',()=>{
  const sim=new Simulation();run(sim,30);assert.deepEqual(sim.G,eye());
  const pairs=sim.samples.slice(),stats=math.statistics(pairs),expected=math.exactGain(stats),alpha=math.exactScalarGain(stats);
  let yz=0,zz=0;for(const pair of pairs)for(let i=0;i<24;i++){yz+=pair.y[i]*pair.z[i]/pairs.length;zz+=pair.z[i]**2/pairs.length;}
  assert.ok(Math.abs(alpha-(yz+23*constants.ridge)/(zz+23*constants.ridge))<1e-14);
  const scalar=a=>eye().map((row,i)=>row.map((v,j)=>i===0&&j===0?1:a*v)),optimum=math.objective(scalar(alpha),pairs);
  assert.ok(math.objective(expected,pairs)<=optimum+1e-12);
  for(const shift of [-.05,.05])assert.ok(math.objective(scalar(alpha+shift),pairs)>optimum);
  sim.queuePulse(23,100);const snap=sim.step();
  assert.ok(distance(snap.G,expected)<1e-13);assert.equal(snap.scalarGain,alpha);
  assert.equal(snap.lastTrainingTime,29);assert.equal(snap.lastTrainingSampleCount,30);
  assert.ok(snap.learning.gradientNorm<1e-12);assert.equal(snap.lastSample.forecast[0],0);assert.equal(snap.lastSample.disturbance[0],0);
  run(sim,50);const next=sim.snapshot();assert.equal(next.lastTrainingSampleCount,60);assert.equal(next.learning.windowEnd,next.costTime-1);
});

test('all presets have identical realized physical powers with deterministic channel corruption',()=>{
  const sims=constants.forecastPresets.map(p=>new Simulation({seed:17,preset:p.id,horizon:50}));
  for(let t=0;t<50;t++){
    const snaps=sims.map(sim=>sim.step());
    for(const snap of snaps){assert.deepEqual(snap.loadP,snaps[0].loadP);assert.deepEqual(snap.loadQ,snaps[0].loadQ);}
    const [reliable,uniform,mixed]=snaps.map(s=>s.lastSample);
    for(let i=1;i<24;i++){
      const raw=sims[0].forecasts[t].base[i],noise=(reliable.forecast[i]-raw)/(constants.amplitude*.05);
      assert.ok(Math.abs(uniform.forecast[i]-(.65*raw+constants.amplitude*.65*noise))<1e-15);
      const faulty=[3,6,9,12,15,18,21,24].includes(i+1);
      assert.ok(Math.abs(mixed.forecast[i]-((faulty?.15:1)*raw+constants.amplitude*(faulty?1.6:.05)*noise))<1e-15);
    }
  }
  for(const sim of sims){const final=sim.snapshot();sim.reset();run(sim,50);assert.deepEqual(sim.snapshot(),final);}
});

test('fault toggles never rewrite already issued power forecasts',()=>{
  for(const preset of constants.forecastPresets){
    const a=new Simulation({preset:preset.id}),b=new Simulation({preset:preset.id});b.toggleFault(4);
    for(let t=0;t<5;t++)assert.deepEqual(a.step().lastSample.forecast,b.step().lastSample.forecast);
    const x=a.step(),y=b.step();assert.notEqual(x.lastSample.forecast[3],y.lastSample.forecast[3]);assert.deepEqual(x.loadP,y.loadP);
  }
});

test('the displayed forecasts are physical power and learning diagnostics use revealed targets only',()=>{
  const sim=new Simulation();run(sim,60);sim.queuePulse(3,100);const snap=sim.step();
  const {forecast,disturbance}=snap.lastSample,calibrated=matvec(snap.G,forecast);
  const rms=x=>Math.sqrt(x.reduce((sum,v,i)=>sum+(v-disturbance[i])**2,0)/23);
  assert.ok(Math.abs(snap.learning.rawRms-rms(forecast))<1e-15);
  assert.ok(Math.abs(snap.learning.calibratedRms-rms(calibrated))<1e-15);
  assert.equal(snap.lastSample.units,'pu active power on 1 MVA');assert.equal(snap.lastSample.pulseUnits,'kW');
});

test('communication recommendations have only inverter receivers and no fictitious slack channels',()=>{
  const sim=new Simulation();run(sim,90);const snap=sim.snapshot();
  assert.equal(snap.localChannels.length,8);
  for(const edge of snap.recommendations){assert.ok(constants.inverterBuses.includes(edge.to));assert.ok(edge.from>1);assert.ok(edge.weight>0);assert.notEqual(edge.from,edge.to);}
  assert.ok(snap.recommendations.length<=24);
  const gain=multiply(model.powerPreviewGains[0],snap.G);
  constants.inverterBuses.forEach((bus,i)=>assert.ok(vectorDistance(gain[i],snap.directGain[bus-1])<1e-14));
  for(let bus=1;bus<=24;bus++)if(!constants.inverterBuses.includes(bus))assert.deepEqual(snap.directGain[bus-1],Array(24).fill(0));
});

test('independent radial AC sweeps validate the linear feeder and satisfy loss balance',()=>{
  const cases=[new Simulation().snapshot()];
  for(const bus of [3,7,12,23,24]){
    const sim=new Simulation();run(sim,40);sim.queuePulse(bus,150);for(let t=0;t<5;t++)cases.push(sim.step());
  }
  let maxError=0;
  for(const snap of cases)for(const key of controllers){
    const ac=math.radialAC(snap.loadP,snap.loadQ,snap.inverterQ[key]);
    assert.equal(ac.converged,true);assert.equal(ac.voltage[0],1);
    assert.ok(Math.abs(ac.slackKw-snap.loadP.reduce((s,v)=>s+v,0)-ac.lossesKw)<1e-6);
    assert.ok(Math.abs(ac.slackKvar-snap.loadQ.reduce((s,v)=>s+v,0)+snap.inverterQ[key].reduce((s,v)=>s+v,0)-ac.lossesKvar)<1e-6);
    const error=Math.max(...ac.voltage.map((v,i)=>Math.abs(v-snap.voltages[key][i])));maxError=Math.max(maxError,error);
  }
  assert.ok(maxError<.0005,`maximum voltage magnitude error ${maxError}`);
});

test('frozen fitting changes neither feeder state, powers, clocks, commands, nor accumulated cost',()=>{
  const sim=new Simulation();assert.equal(sim.freeze(),false);run(sim,100);const frozen=sim.freeze();
  let last=frozen,calls=0;
  while(sim.mode!=='converged'&&calls++<1000){
    const snap=sim.fitStep();
    for(const key of ['t','states','loadP','loadQ','inverterQ','commandQ','costs','history'])assert.deepEqual(snap[key],frozen[key]);
    assert.ok(snap.fitError<=last.fitError+1e-13);assert.ok(snap.fitObjective<=last.fitObjective+1e-13);last=snap;
  }
  assert.equal(sim.mode,'converged');assert.ok(sim.snapshot().fitError<constants.tolerance);sim.resume();assert.equal(sim.step().t,101);
});

test('completed episodes extend, interventions replay, and returned arrays cannot mutate physics',()=>{
  const short=new Simulation({horizon:3});run(short,3);assert.equal(short.queuePulse(23,50),true);assert.equal(short.step().t,4);
  const sim=new Simulation({seed:123});
  const play=()=>{for(let t=0;t<100;t++){if(t===40||t===41)sim.queuePulse(7,100);if(t===60)sim.toggleFault(6);sim.step();}return sim.snapshot();};
  const first=play();sim.reset();const second=play();assert.deepEqual(first,second);
  second.voltage[0]=0;second.inverterQ.online[4]=999;second.loadP[2]=999;second.states.online[0]=1;
  const intact=sim.snapshot();assert.equal(intact.voltage[0],1);assert.notEqual(intact.inverterQ.online[4],999);assert.notEqual(intact.loadP[2],999);assert.equal(intact.states.online[0],0);
});


test('unforecasted persistent demand causes a causal inverter response without pulse metadata or future access',()=>{
  const sim=new Simulation({horizon:10});
  // Deterministic zero background isolates the actuator's physical feedback.
  // These are fixed test fixtures, not an option in the public experiment.
  sim.forecasts=Array.from({length:10},(_,t)=>Object.freeze({t,base:Object.freeze(Array(24).fill(0)),
    forecast:Object.freeze(Array(24).fill(0)),units:'pu active power on 1 MVA'}));
  sim.queuePulse(23,100);
  const entered=sim.step();
  assert.ok(entered.commandQ.causal.every(v=>Math.abs(v)<1e-14));
  assert.ok(entered.regulationStates.causal[22]<0);
  // Remove all event metadata after observation. The response must be driven
  // by measured power, even though the control has no remaining event record.
  sim.pulses=[];sim.eventLog=[];
  const persistent=.1*Math.exp(-1/3);
  const nextPower=Array(24).fill(0);nextPower[22]=persistent;
  sim.forecasts[1]=Object.freeze({...sim.forecasts[1],base:Object.freeze(nextPower)});
  const recovered=sim.step();
  assert.ok(recovered.commandQ.causal.some(v=>v>1));
  const uncontrolled=math.voltageFrom(recovered.powerDeviation,Array(8).fill(0));
  assert.ok(Math.abs(reg(recovered.states.causal)[21])<Math.abs(reg(uncontrolled)[21]));
  assert.deepEqual(recovered.lastSample.anchorForecast,Array(24).fill(0));
});
