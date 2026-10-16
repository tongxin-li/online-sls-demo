'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {fit,identity,apply,compatibleMask,constants}=require('./forecast-calibration.js');
const n=constants.dimension;
const zeros=()=>Array(n).fill(0);
const distance=(a,b)=>Math.hypot(...a.flat().map((value,i)=>value-b.flat()[i]));
function basisSamples(gains=Array(n).fill(1),copies=2){
  return Array.from({length:n*copies},(_,t)=>{
    const source=t%n,forecast=zeros(),disturbance=zeros();
    forecast[source]=.01;disturbance[source]=.01*gains[source];return{forecast,disturbance};
  });
}

test('identity correction retains physical coordinate units and an explicit zero slack',()=>{
  const vector=Array.from({length:n},(_,i)=>.001*(i-11));
  assert.deepEqual(apply(identity(),vector),vector);
  assert.deepEqual(apply(identity(),[0,...vector]),[0,...vector]);
  assert.throws(()=>apply(identity(),[1,...vector]),/slack/);
  assert.throws(()=>fit([{forecast:[0,1],disturbance:[0,1]}]),/23 nonslack/);
});

test('no observations keeps the offline prior and fitting exact forecasts keeps identity',()=>{
  const empty=fit([]);assert.deepEqual(empty.matrix,identity());
  assert.equal(empty.scalar,1);assert.equal(empty.windowSize,0);assert.equal(empty.rawRms,null);
  const exact=fit(basisSamples());assert.ok(distance(exact.matrix,identity())<1e-14);
  assert.equal(exact.scalar,1);assert.ok(exact.matrixRms<1e-17);
});

test('matrix learns heterogeneous channel corruption without moving fixed data or choosing a favorable cost',()=>{
  const gains=Array.from({length:n},(_,i)=>i%2?.2:1.5),samples=basisSamples(gains),before=JSON.stringify(samples);
  const result=fit(samples);
  assert.ok(result.matrixRms<result.rawRms*.1);
  assert.ok(result.matrixRms<result.scalarRms*.1);
  assert.ok(result.matrixObjective<result.scalarObjective);
  assert.ok(result.scalarObjective<result.rawObjective);
  for(let i=0;i<n;i++)assert.ok(Math.abs(result.matrix[i][i]-gains[i])<.05);
  assert.equal(JSON.stringify(samples),before);
  assert.deepEqual(fit(samples),result);
});

test('scalar and matrix agree on isotropic calibration under the same Frobenius ridge objective',()=>{
  const gain=.3,copies=2,samples=basisSamples(Array(n).fill(gain),copies);
  const result=fit(samples),energy=copies*.01**2;
  const expected=(gain*energy+constants.lambda)/(energy+constants.lambda);
  assert.ok(Math.abs(result.scalar-expected)<1e-14);
  assert.ok(distance(result.matrix,identity().map(row=>row.map(value=>expected*value)))<1e-13);
  assert.ok(Math.abs(result.matrixObjective-result.scalarObjective)<1e-18);
});

test('both fits use only the last sixty supplied revealed observations',()=>{
  const old=basisSamples(Array(n).fill(20),2),recent=Array.from({length:60},(_,i)=>basisSamples(Array(n).fill(.4))[i%46]);
  const all=old.concat(recent),recentFit=fit(recent);
  assert.equal(fit(all).windowSize,60);assert.deepEqual(fit(all),recentFit);
  all[0].forecast.fill(500);all[0].disturbance.fill(-900);
  assert.deepEqual(fit(all),recentFit);
});

test('caller supplied past prefix excludes future disturbances from the action correction',()=>{
  const samples=basisSamples(Array(n).fill(.6),3),time=35;
  const before=fit(samples.slice(0,time));
  for(let i=time;i<samples.length;i++){samples[i].disturbance.fill(10);samples[i].forecast.fill(-10);}
  assert.deepEqual(fit(samples.slice(0,time)),before);
  assert.notDeepEqual(fit(samples),before,'the caller must explicitly exclude unrevealed samples');
});

test('support compatibility follows receiver inclusion rather than merely masking covariance entries',()=>{
  const support=[zeros().map((_,j)=>j===0||j===1),zeros().map((_,j)=>j===1||j===2)];
  const mask=compatibleMask(support);
  assert.equal(mask[0][1],true);assert.equal(mask[1][0],false);
  assert.equal(mask[2][1],true);assert.equal(mask[1][2],false);
  for(let a=0;a<n;a++)for(let b=0;b<n;b++)assert.equal(mask[a][b],support.every(row=>!row[a]||row[b]));
  assert.ok(compatibleMask().flat().every(Boolean));
});

test('a fitted support compatible matrix changes allowed actions while forbidden raw sources have zero effect',()=>{
  const support=[zeros().map((_,j)=>j===0||j===1),zeros().map((_,j)=>j===1||j===2)];
  const samples=basisSamples(Array(n).fill(.25));
  // Off diagonal calibration is needed to reconstruct source zero from source one.
  for(const sample of samples)sample.disturbance[0]+=.5*sample.forecast[1];
  const result=fit(samples,{support}),mask=compatibleMask(support);
  assert.ok(result.matrix[0][1]>.4);
  for(let a=0;a<n;a++)for(let b=0;b<n;b++)if(!mask[a][b])assert.equal(result.matrix[a][b],0);
  const gains=support.map((row,i)=>row.map((allowed,j)=>allowed?(i+1)*(j+1):0));
  let changed=false;
  for(let source=0;source<n;source++){
    const forecast=zeros();forecast[source]=.001;
    const corrected=apply(result.matrix,forecast);
    for(let receiver=0;receiver<support.length;receiver++){
      const before=gains[receiver].reduce((sum,value,j)=>sum+value*forecast[j],0);
      const after=gains[receiver].reduce((sum,value,j)=>sum+value*corrected[j],0);
      if(!support[receiver][source])assert.equal(after,0);
      else changed ||= Math.abs(after-before)>1e-6;
    }
  }
  assert.equal(changed,true);
});

test('padded and nonslack samples fit identically and invalid numerical inputs fail explicitly',()=>{
  const samples=basisSamples(Array(n).fill(.8));
  assert.deepEqual(fit(samples),fit(samples.map(sample=>({forecast:[0,...sample.forecast],disturbance:[0,...sample.disturbance]}))));
  assert.throws(()=>fit(samples,{lambda:0}),/positive/);
  assert.throws(()=>fit(samples,{lambda:Infinity}),/positive/);
  assert.throws(()=>fit(samples,{support:[[true]]}),/23 source/);
  const invalid=basisSamples();invalid[0].forecast[2]=NaN;
  assert.throws(()=>fit(invalid),/finite/);
});
