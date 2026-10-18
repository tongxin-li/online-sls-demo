'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fitSource,SourceScale,receiverMessages,prediction,scaleColumn}=require('./causal-source-scale.js');
const Demo=require('./simulation.js'),Calibration=require('./forecast-calibration.js');
const lambda=Demo.model.calibrationRidge;
const pair=(target,forecast,forcing)=>({target,issuedAt:Math.max(0,target-4),revealedAt:target+1,forecast,forcing});
const node=(source=2)=>new SourceScale({source,lambda});
const near=(a,b,eps=1e-11)=>assert.ok(Math.abs(a-b)<=eps,'difference '+Math.abs(a-b));
const zeros=(n,m=n)=>Array.from({length:n},()=>Array(m).fill(0));
const mm=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((sum,x,k)=>sum+x*b[k][j],0)));
const add=(a,b)=>a.map((row,i)=>row.map((x,j)=>x+b[i][j]));
const matrixNear=(a,b,eps=1e-10)=>a.forEach((row,i)=>row.forEach((x,j)=>near(x,b[i][j],eps)));

test('source calibration starts only after thirty revealed pairs with a versioned available time',()=>{
  const n=node();assert.equal(n.at(0).coefficient,1);
  for(let t=0;t<29;t++)n.observe(pair(t,.004,.001),t+1);
  assert.equal(n.at(29).coefficient,1);assert.equal(n.at(29).updates,0);assert.equal(n.at(29).trainedThrough,null);
  const out=n.observe(pair(29,.004,.001),30);
  near(out.coefficient,(.004*.001+lambda)/(.004**2+lambda));
  assert.equal(out.availableAt,30);assert.equal(out.trainedThrough,29);assert.equal(out.updates,1);
  assert.equal(out.windowCount,30);assert.ok(Object.isFrozen(out));
});

test('diagonal source fits equal the independent existing constrained matrix normal equations at all sizes',()=>{
  for(const network of Demo.networks){
    const api=Demo.forNetwork(network.id),n=network.N-1,L=api.model.calibrationRidge;
    const sources=Array.from({length:n},(_,j)=>new SourceScale({source:j+2,lambda:L}));
    const samples=Array.from({length:60},(_,t)=>{
      const forecast=Array.from({length:n},(_,j)=>(.0001+.00005*(j%7))*Math.sin(.31*(t+1)*(j+1))+.00003*Math.cos(.19*(t+1)));
      const disturbance=forecast.map((x,j)=>(.3+.02*j)*x+.00003*Math.sin(.7*t+2*j));
      for(let j=0;j<n;j++)sources[j].observe(pair(t,forecast[j],disturbance[j]),t+1);
      return {forecast,disturbance};
    });
    const support=Array.from({length:n},(_,a)=>Array.from({length:n},(_,b)=>a===b));
    const reference=Calibration.fit(samples,{dimension:n,lambda:L,support});
    for(let a=0;a<n;a++)for(let b=0;b<n;b++)near(reference.matrix[a][b],a===b?sources[a].at(60).coefficient:0,1e-12);
    for(let j=0;j<n;j++)assert.ok(fitSource(samples.map(s=>({forecast:s.forecast[j],forcing:s.disturbance[j]})),L).objective<=fitSource(samples.map(s=>({forecast:s.forecast[j],forcing:s.disturbance[j]})),L).rawObjective+1e-20);
  }
});

test('future or repeated observations are rejected atomically and source labels are never read',()=>{
  const n=node(),p=pair(0,.001,.002);Object.defineProperty(p,'faulty',{get(){throw Error('quality label accessed');}});
  assert.throws(()=>n.observe(p,0),/Unrevealed/);assert.equal(n.at(0).totalPairs,0);
  n.observe(p,1);p.forecast=900;p.forcing=-800;
  assert.equal(n.pairs[0].forecast,.001);assert.equal(n.pairs[0].forcing,.002);
  const before=JSON.stringify(n.at(1));
  assert.throws(()=>n.observe(pair(0,.1,.2),2),/once/);
  assert.throws(()=>n.observe(pair(2,.1,.2),3),/once/);
  assert.throws(()=>n.observe(pair(1,.1,.2),1),/Unrevealed/);
  assert.throws(()=>n.observe({...pair(1,.1,.2),issuedAt:1},2),/sealed/);
  assert.throws(()=>n.at(0),/precedes/);assert.equal(JSON.stringify(n.at(1)),before);
});

test('actual source coefficients and prediction contributions respond to revealed corruption and repair',()=>{
  const n=node(),checkpoints=[];
  for(let t=0;t<150;t++){
    n.observe(pair(t,t>=30&&t<90?.004:.001,.001),t+1);
    if([29,89,149].includes(t))checkpoints.push(n.at(t+1));
  }
  near(checkpoints[0].coefficient,1);assert.ok(checkpoints[1].coefficient<.3);near(checkpoints[2].coefficient,1);
  const values=checkpoints.map(report=>prediction([2],[{source:2,forecast:.001,coefficient:report.coefficient}]));
  assert.ok(values[0]-values[1]>.001);near(values[0],values[2]);
  assert.deepEqual(checkpoints.map(x=>x.trainedThrough),[29,89,149]);
  assert.deepEqual(checkpoints.map(x=>x.availableAt),[30,90,150]);
});

test('receiver access reads only permitted raw messages and source parameters with mandatory local support',()=>{
  const permission=[true,false,false,true,false,true,false],seen=[];
  const report=j=>({source:j+2,coefficient:j===5?0:1,trainedThrough:8,availableAt:9,updates:1});
  const nodes=new Proxy(Array.from({length:7},(_,j)=>({at(action){seen.push('node'+j);assert.equal(action,10);return report(j);}})),{
    get(target,key){if(/^\d+$/.test(String(key))&&!permission[Number(key)])throw Error('Excluded parameter accessed');return Reflect.get(target,key);}
  });
  const forecast=new Proxy(Array.from({length:7},(_,j)=>j/1000),{get(target,key){if(/^\d+$/.test(String(key))){if(!permission[Number(key)])throw Error('Excluded forecast accessed');seen.push('forecast'+key);}return Reflect.get(target,key);}});
  const messages=receiverMessages({receiverBus:5,permission,remoteBudget:2,nodes,forecast,target:14,issuedAt:10,action:10});
  assert.deepEqual(messages.map(x=>x.source),[2,5,7]);assert.equal(messages.length,3,'A zero gain still consumes its permitted channel');
  assert.deepEqual(seen,['node0','forecast0','node3','forecast3','node5','forecast5']);
  assert.equal(messages[2].coefficient,0);assert.ok(Object.isFrozen(messages)&&messages.every(Object.isFrozen));
  assert.throws(()=>receiverMessages({receiverBus:5,permission,remoteBudget:1,nodes,forecast,target:14,issuedAt:10,action:10}),/budget/);
  assert.throws(()=>receiverMessages({receiverBus:5,permission:permission.map((x,j)=>j===3?false:x),remoteBudget:2,nodes,forecast,target:14,issuedAt:10,action:10}),/local/);
  assert.throws(()=>receiverMessages({receiverBus:5,permission,remoteBudget:2,nodes,forecast,target:15,issuedAt:11,action:10}),/available/);
});

test('frozen admitted messages retain the exact command parameter version after later observations',()=>{
  const n=node();for(let t=0;t<30;t++)n.observe(pair(t,.004,.001),t+1);
  const messages=receiverMessages({receiverBus:2,permission:[true],remoteBudget:0,nodes:[n],forecast:[.003],target:34,issuedAt:30,action:30});
  const before=prediction([2],messages),coefficient=messages[0].coefficient;
  for(let t=30;t<90;t++)n.observe(pair(t,.001,.001),t+1);
  assert.notEqual(n.at(90).coefficient,coefficient);assert.equal(prediction([2],messages),before);
  assert.equal(messages[0].trainedThrough,29);assert.equal(messages[0].availableAt,30);
  assert.throws(()=>prediction([2],messages.concat(messages)),/duplicate/);
});

test('source learning crosses old boundaries with bounded estimator memory and full counters',()=>{
  const n=node();for(let t=0;t<1801;t++)n.observe(pair(t,.001*Math.sin(t+.2),.0007*Math.sin(t+.2)),t+1);
  const out=n.at(1801);assert.equal(out.totalPairs,1801);assert.equal(out.windowCount,60);
  assert.equal(n.pairs.length,60);assert.equal(out.windowStart,1741);assert.equal(out.trainedThrough,1800);
  assert.equal(out.updates,1801-30+1);assert.ok(Number.isFinite(out.coefficient));
});

test('invalid numeric fits and future source metadata cannot enter a receiver response',()=>{
  assert.throws(()=>fitSource([{forecast:Infinity,forcing:0}],lambda),/finite/);
  assert.throws(()=>fitSource([{forecast:1e200,forcing:1e200}],lambda),/overflow/);
  assert.throws(()=>new SourceScale({source:2,lambda:0}),/positive/);
  const nodes=[{at(){return {source:2,coefficient:1,availableAt:2,trainedThrough:1,updates:1};}}];
  assert.throws(()=>receiverMessages({receiverBus:2,permission:[true],remoteBudget:0,nodes,forecast:[.001],target:4,issuedAt:0,action:1}),/Future/);
  const n=new SourceScale({source:2,lambda,warmup:1});n.observe(pair(0,.001,.001),1);
  const before=JSON.stringify(n.at(1));assert.throws(()=>n.observe(pair(1,1e200,1e200),2),/overflow/);assert.equal(JSON.stringify(n.at(1)),before);
});

for(const network of Demo.networks)test(network.id+' diagonal scaling preserves independently reconstructed full response feasibility',()=>{
  const api=Demo.forNetwork(network.id),{model,constants,math}=api,n=network.N-1,m=network.M,T=9;
  const support=constants.inverterBuses.map((bus,r)=>{
    const row=Array(n).fill(false);row[bus-2]=true;
    Array.from({length:n},(_,j)=>(j+r)%n).filter(j=>j!==bus-2).slice(0,network.remoteBudget).forEach(j=>row[j]=true);return row;
  });
  const design=math.getDesign(T,support),before=JSON.stringify(design.columns),scales=Array.from({length:n},(_,j)=>[1,-.25,0,1.5][j%4]);
  const F=add(model.A,mm(model.B,model.K)),powers=[Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>+(i===j)))];
  for(let t=1;t<=T;t++)powers.push(mm(F,powers[t-1]));
  for(const column of design.columns){
    const scaled=scaleColumn(column,scales),k=column.k;
    const get=(group,t)=>scaled[group][t]||zeros(group==='X'?n:m,n);
    const phiX=t=>add(t>=k?powers[t-k]:zeros(n),get('X',t));
    const phiU=t=>add(t>=k?mm(model.K,powers[t-k]):zeros(m,n),get('U',t));
    for(let t=0;t<T;t++){
      const next=phiX(t+1),rhs=add(mm(model.A,phiX(t)),mm(model.B,phiU(t)));
      if(t===k-1)for(let i=0;i<n;i++)rhs[i][i]+=1;
      matrixNear(next,rhs);matrixNear(get('L',t),add(get('U',t),mm(model.K,get('X',t)).map(row=>row.map(x=>-x))));
      for(let r=0;r<m;r++)for(let j=0;j<n;j++)if(!support[r][j])near(get('L',t)[r][j],0);
    }
    for(const group of ['X','U','L'])assert.deepEqual(Object.keys(scaled[group]),Object.keys(column[group]));
  }
  assert.equal(JSON.stringify(design.columns),before,'Feasibility verification never edits cached synthesis');
  for(let r=0;r<m;r++){assert.equal(support[r][constants.inverterBuses[r]-2],true);assert.equal(support[r].filter(Boolean).length,network.remoteBudget+1);}
});
