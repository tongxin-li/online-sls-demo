'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Demo=require('./simulation.js'),Adaptive=require('./adaptive-response.js');
const {ResponseSpace,ResponseLearner,Controller,completedRow,objectiveGradient,math}=Adaptive;
const maxDelta=(a,b)=>Math.max(0,...a.flat(Infinity).map((v,i)=>Math.abs(v-b.flat(Infinity)[i])));
function stream(api,count=160){
  const n=api.constants.N-1,d=api.constants.preview;
  const truth=Array.from({length:count},(_,t)=>[0,...Array.from({length:n},(_,j)=>.0006*Math.sin(.19*t+.63*j)+.0003*Math.cos(.11*t*(j+1)))]);
  const forecasts=truth.map((w,t)=>({t,issuedAt:Math.max(0,t-d+1),forecast:w.map((v,j)=>j===0?0:v+.0007*(j%3===0?8:.05)*Math.cos(.7*t+.9*j))}));
  return{forecasts,samples:truth.map((disturbance,t)=>({t,disturbance}))};
}
function physicalStream(api,count=90){
  const simulation=new api.Simulation({protocol:'continuous-phi-v1',experiment:'communication',beta:4,powerScenario:'forecasted-demand',seed:20261013});
  for(let t=0;t<count;t++)simulation.step();simulation.sealPreview();
  return{samples:simulation.samples,forecasts:simulation.forecasts};
}
function tick(controller,t,data,state=null){
  controller.begin(t,data.samples.slice(0,t),data.forecasts);const commands={};
  for(const key of controller.api.constants.controllers)commands[key]=controller.command(key,state||Array(controller.n).fill(0)).map(v=>Math.max(-.07,Math.min(.07,v)));
  return controller.finish(commands);
}
function verifyColumn(api,column,support=null){
  const {B,K,A}=api.model,a=A[0][0],n=B.length,m=B[0].length;
  for(const [timeText,U] of Object.entries(column.U)){
    const time=Number(timeText),X=column.X[time]||math.zeros(n),next=column.X[time+1]||math.zeros(n),bu=math.mm(B,U),kx=math.mm(K,X);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++)assert.ok(Math.abs(next[i][j]-a*X[i][j]-bu[i][j])<1e-11);
    for(let i=0;i<m;i++)for(let j=0;j<n;j++){
      assert.ok(Math.abs(column.L[time][i][j]-U[i][j]+kx[i][j])<1e-11);
      if(support&&!support[i][j])assert.ok(Math.abs(column.L[time][i][j])<1e-10);
    }
  }
  const first=Math.min(...Object.keys(column.X).map(Number));assert.ok(column.X[first].flat().every(v=>Math.abs(v)<1e-12));
  const last=Math.max(...Object.keys(column.U).map(Number))+1;
  assert.ok((column.X[last]||math.zeros(n)).flat().every(v=>Math.abs(v)<1e-11));
}

test('full response coordinates reconstruct offline X U L and exact affine feasibility at every size',()=>{
  for(const network of Demo.networks){
    const api=Demo.forNetwork(network.id),dense=new ResponseSpace(api),selection=api.math.Response.supportFromScores(dense.kernel.scores,api.constants.inverterBuses,api.constants.remoteBudget,1e-12);
    for(const space of [dense,new ResponseSpace(api,selection.support)]){
      const reconstructed=space.column(space.prior,12),offline=space.kernel.column(12);
      for(const group of ['X','U','L'])for(const time of Object.keys(offline[group]))assert.ok(maxDelta(reconstructed[group][time],offline[group][time])<1e-11);
      verifyColumn(api,reconstructed,space.support);
    }
  }
});

test('analytic full X U mismatch and ridge gradient matches independent finite differences',()=>{
  const api=Demo.forNetwork('toy8'),space=new ResponseSpace(api),data=stream(api),rows=[25,26,27].map(action=>completedRow(action,space.depth,space.n,data.samples,data.forecasts));
  const z=space.prior.map((matrix,s)=>matrix.map((row,i)=>row.map((v,j)=>s>0&&s<2*space.depth?v+.003*Math.sin(s+i+j):0))),ridge=1e-6;
  const result=objectiveGradient(space,z,rows,ridge),epsilon=1e-5;
  for(const [s,i,j] of [[1,0,0],[2,1,3],[4,2,5],[6,0,6],[9,2,1]]){
    const plus=z.map(math.copy),minus=z.map(math.copy);plus[s][i][j]+=epsilon;minus[s][i][j]-=epsilon;
    const numeric=(objectiveGradient(space,plus,rows,ridge,{gradient:false}).value-objectiveGradient(space,minus,rows,ridge,{gradient:false}).value)/(2*epsilon);
    assert.ok(Math.abs(numeric-result.gradient[s][i][j])<1e-12,'finite difference matches full response coordinate');
  }
  const phi=space.responses(z),prior=space.responses(space.prior);let independent=0;
  for(const {h,w} of rows){
    let ex=Array(space.n).fill(0),eu=Array(space.m).fill(0);
    for(let s=0;s<2*space.depth;s++){
      const x=math.mv(phi.X[s],h[s]),offX=math.mv(prior.X[s],w[s]),u=math.mv(phi.U[s],h[s]),offU=math.mv(prior.U[s],w[s]);
      ex=ex.map((v,i)=>v+x[i]-offX[i]);eu=eu.map((v,i)=>v+u[i]-offU[i]);
    }
    independent+=.5*(ex.reduce((s,v)=>s+v*v,0)+eu.reduce((s,v)=>s+v*v,0))/rows.length;
  }
  let regularizer=0;for(const group of ['X','U'])for(let s=0;s<phi[group].length;s++)for(let i=0;i<phi[group][s].length;i++)for(let j=0;j<space.n;j++)regularizer+=(phi[group][s][i][j]-prior[group][s][i][j])**2;
  assert.ok(Math.abs(result.value-independent-.5*ridge*regularizer)<1e-16);
});

test('projected full response steps reduce the frozen completed-row objective and preserve forbidden gains',()=>{
  const api=Demo.forNetwork('toy8'),data=stream(api),dense=new ResponseSpace(api),selection=api.math.Response.supportFromScores(dense.kernel.scores,api.constants.inverterBuses,2,1e-12);
  const learner=new ResponseLearner(api,selection.support),rows=Array.from({length:35},(_,i)=>completedRow(i+20,5,7,data.samples,data.forecasts));
  const initial=learner.z.map(math.copy);let previous=objectiveGradient(learner.space,learner.z,rows,learner.ridge).value;
  for(let i=0;i<10;i++){
    const update=learner.update(rows);assert.ok(update.objectiveAfter<=previous+1e-15);previous=update.objectiveAfter;
    assert.ok(learner.space.residual(learner.z).support<1e-10);
  }
  assert.ok(math.zDistance(initial,learner.z)>1e-5);
  // The learned change must alter temporal/receiver directions, not merely one
  // scalar multiplying every response coefficient for a source.
  let nonScalar=0;
  const old=learner.space.responses(initial),now=learner.space.responses(learner.z);
  for(let source=0;source<7;source++){
    const a=old.U.flatMap(matrix=>matrix.map(row=>row[source])),b=now.U.flatMap(matrix=>matrix.map(row=>row[source]));
    const energy=a.reduce((s,v)=>s+v*v,0),scale=a.reduce((s,v,i)=>s+v*b[i],0)/Math.max(energy,1e-30);
    nonScalar=Math.max(nonScalar,...b.map((v,i)=>Math.abs(v-scale*a[i])));
  }
  assert.ok(nonScalar>1e-5,'actual full response directions change');
});

test('completed-row timing excludes future truth and new packets never rewrite sealed columns',()=>{
  const api=Demo.forNetwork('toy8'),data=stream(api),a=new Controller(api,{warmup:3,reselectEvery:3}),b=new Controller(api,{warmup:3,reselectEvery:3});
  const changed=JSON.parse(JSON.stringify(data));
  for(let t=55;t<changed.samples.length;t++)changed.samples[t].disturbance.fill(999,1);
  for(let t=60;t<changed.forecasts.length;t++)changed.forecasts[t].forecast.fill(-999,1);
  let saved=null;
  for(let t=0;t<55;t++){
    const ra=tick(a,t,data),rb=tick(b,t,changed);assert.deepEqual(ra,rb);
    if(ra.trainedThrough!==null)assert.ok(ra.trainedThrough<t);
    if(t===42){const column=a.columns.get(46);saved={column,text:JSON.stringify(column)};}
    if(saved)assert.equal(JSON.stringify(saved.column),saved.text);
  }
  const unavailable=data.samples.slice(0,20);Object.defineProperty(unavailable,20,{get(){throw new Error('future truth read');}});
  assert.doesNotThrow(()=>completedRow(20,5,7,unavailable,data.forecasts));
  assert.throws(()=>completedRow(21,5,7,data.samples.slice(0,20),data.forecasts),/Unrevealed/);
  const c=new Controller(api);c.begin(0,[],data.forecasts);
  for(const f of data.forecasts)Object.defineProperty(f,'forecast',{get(){throw new Error('command reread forecast');}});
  assert.doesNotThrow(()=>c.command('online',Array(7).fill(0)));
});

for(const network of Demo.networks)test(network.id+' executes real support changes with bounded incoming traffic, retiring caches and exact replay',()=>{
  const api=Demo.forNetwork(network.id),data=physicalStream(api),a=new Controller(api,{warmup:5,reselectEvery:5}),b=new Controller(api,{warmup:5,reselectEvery:5});
  let changedCommand=false,sawRetiring=false;const savedColumns=[];
  for(let t=0;t<80;t++){
    const first=tick(a,t,data),second=tick(b,t,data);assert.deepEqual(first,second);
    assert.equal(first.learning.version,first.parameterVersion);
    assert.ok(Number.isFinite(first.learning.parameterDelta));
    for(const key of ['online','scalar'])assert.ok(first.newMessages[key].remote<=network.M*network.remoteBudget);
    assert.equal(first.newMessages.static.remote,network.M*(network.N-2));
    assert.equal(first.newMessages.causal.remote,0);
    assert.equal(first.learningTraffic.revealedSourcePairs,t*(network.N-1));
    assert.equal(first.learningTraffic.revealedScalarValues,2*t*(network.N-1));
    assert.ok(first.responseFeasibility.recurrence<1e-11);assert.ok(first.responseFeasibility.support<1e-10);
    for(const key of api.constants.controllers){
      assert.equal(first.policies[key].gainNorms.length,network.M);
      assert.deepEqual(first.policies[key].raw,first.policies[key].feedback.map((v,i)=>v+first.policies[key].prediction[i]));
      first.policies[key].sourceContributions.forEach((row,i)=>assert.ok(Math.abs(row.reduce((s,v)=>s+v,0)-first.policies[key].prediction[i])<1e-11));
    }
    changedCommand ||= maxDelta(first.policies.online.prediction,first.policies.scalar.prediction)>1e-8;
    sawRetiring ||= first.retiringLinks>0;
    if(t===25||t===60)savedColumns.push(...[...a.columns.values()].slice(-1));
  }
  assert.ok(a.updateCount>0);assert.ok(a.supportEvents.length>0);assert.ok(changedCommand);assert.ok(sawRetiring);
  assert.equal(a.supportHistory.length,a.supportEvents.length+1);
  for(const event of a.supportEvents)assert.ok(a.supportHistory.some(frame=>frame.t===event.action+1&&frame.action===event.action));
  for(const column of savedColumns)verifyColumn(api,column.policies.online,column.support);
  assert.ok(a.receipt.learningTraffic.parameterBroadcastMessages>0);assert.ok(a.receipt.learningTraffic.parameterScalars>0);
});
