'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Demo=require('./simulation.js'),Continuous=require('./continuous-response.js');
const plan=require('../refinement/continuous-response-plan.json');
const keys=['online','scalar','static','causal'];
const near=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,'Difference '+Math.abs(a-b));
const zeros=(n,m=n)=>Array.from({length:n},()=>Array(m).fill(0));
const mm=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((v,x,k)=>v+x*b[k][j],0)));
const add=(a,b)=>a.map((row,i)=>row.map((x,j)=>x+b[i][j]));
const matNear=(a,b,tol=1e-10)=>{assert.equal(a.length,b.length);a.forEach((row,i)=>row.forEach((v,j)=>near(v,b[i][j],tol)));};
const opts=(network,quality,seed)=>({networkId:network.id,protocol:'continuous-phi-v1',experiment:'communication',powerScenario:'forecasted-demand',
  beta:quality.beta,preset:'mixed',seed,faultBuses:quality.id==='reliable'?[]:quality.id==='all_noisy'?Array.from({length:network.N-1},(_,i)=>i+2):Demo.forNetwork(network.id).constants.forecastedDemand.noisySources.slice()});
function events(sim,network,action){
  const first=Demo.forNetwork(network.id).constants.inverterBuses[0],last=Demo.forNetwork(network.id).constants.inverterBuses.at(-1);
  for(const event of plan.forecast_switches)if(event.action===action){
    const bus=event.source==='first inverter'?first:last,want=event.operation==='corrupt';
    if(sim.faults.has(bus)!==want)sim.toggleFault(bus);
  }
  for(const event of plan.power_events){
    const active=Array.isArray(event.actions)?event.actions.includes(action):action>=event.actions.first&&action<=event.actions.last;
    if(!active)continue;
    const buses=event.buses==='last bus'?[network.N]:event.buses==='first inverter'?[first]:[first,network.N];
    for(const bus of buses)sim.queuePulse(bus,event.requestedKw,event.protocol==='held-target-v1'?'held-target-v1':null);
  }
}
function independentRaw(sim,key,action,coefficients){
  const api=Demo.forNetwork(sim.options.networkId),controller=sim.continuousController;
  const x=sim.costStates[key].slice(1).map((v,j)=>v-api.model.baseDrop[j+1]);
  const raw=api.model.K.map(row=>row.reduce((sum,v,j)=>sum+v*x[j],0));
  if(key==='causal')return raw;
  const kernel=key==='static'?controller.dense:controller.sparse,support=controller.permissions[key];
  for(const block of kernel.row(action))for(let r=0;r<raw.length;r++)for(let j=0;j<coefficients.length;j++)if(support[r][j])
    raw[r]+=block.L[r][j]*(key==='online'?coefficients[j]:1)*sim.forecasts[block.target].forecast[j+1];
  return raw;
}
for(const network of Demo.networks)test(network.id+' stationary columns preserve full affine feasibility including startup and both temporal ends',()=>{
  const api=Demo.forNetwork(network.id),controller=new Continuous.Controller(api),n=network.N-1,m=network.M;
  const F=add(api.model.A,mm(api.model.B,api.model.K));
  for(const kernel of [controller.dense,controller.sparse]){
    const support=kernel.support;
    const full=new api.math.Response.Synthesizer(api.model,api.constants.preview);
    const reference=full.column(kernel.planningHorizon,api.constants.preview+1,support);
    for(const group of ['X','U','L'])for(const time of Object.keys(reference[group]))matNear(kernel.interior[group][time],reference[group][time]);
    for(const target of [0,1,4,5,179,180,359,360,899]){
      const column=kernel.column(target),k=target+1,coefficient=Array.from({length:n},(_,j)=>[1,-.25,0,1.4][j%4]);
      const get=(group,t)=>{
        const matrix=column[group][t]||zeros(group==='X'?n:m,n);
        return matrix.map(row=>row.map((v,j)=>v*coefficient[j]));
      };
      const powers=[Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>+(i===j)))];
      const start=Math.max(0,target-api.constants.preview),end=target+api.constants.preview+2;
      for(let i=1;i<=end-k+1;i++)powers.push(mm(F,powers[i-1]));
      const state=t=>add(t>=k?powers[t-k]:zeros(n),get('X',t));
      const input=t=>add(t>=k?mm(api.model.K,powers[t-k]):zeros(m,n),get('U',t));
      for(let t=start;t<end;t++){
        const rhs=add(mm(api.model.A,state(t)),mm(api.model.B,input(t)));
        if(t===k-1)for(let j=0;j<n;j++)rhs[j][j]+=1;
        matNear(state(t+1),rhs);
        matNear(get('L',t),add(get('U',t),mm(api.model.K,get('X',t)).map(row=>row.map(v=>-v))));
        if(support)for(let r=0;r<m;r++)for(let j=0;j<n;j++)if(!support[r][j])near(get('L',t)[r][j],0,1e-11);
      }
      if(target<api.constants.preview)matNear(get('X',0),zeros(n));
      matNear(get('X',target+api.constants.preview+1),zeros(n));
    }
    for(const t of [0,1,5,180,360,900])for(const block of kernel.row(t)){
      assert.ok(block.target>=0&&block.target<=t+api.constants.preview-1);
      assert.ok(Math.max(0,block.target-api.constants.preview+1)<=t);
    }
  }
  for(let r=0;r<m;r++){
    assert.equal(controller.selection.support[r][api.constants.inverterBuses[r]-2],true);
    assert.ok(controller.selection.support[r].filter(Boolean).length-1<=network.remoteBudget);
  }
});

for(const network of Demo.networks)test(network.id+' executes all predefined quality and seed streams past old boundaries without reset',()=>{
  const api=Demo.forNetwork(network.id),outcomes=[];
  for(const quality of plan.quality_cases)for(const seed of plan.seeds){
    const sim=new api.Simulation(opts(network,quality,seed));let previous=Object.fromEntries(keys.map(k=>[k,0])),changedCommands=0,previousCoefficients=null;
    assert.equal(sim.options.horizon,null);assert.equal(sim.phase,'ongoing');
    assert.equal(sim.deployTopology(),false);assert.equal(sim.freeze(),false);
    for(let action=0;action<plan.steps;action++){
      events(sim,network,action);const snap=sim.step(),receipt=snap.lastExecution,c=receipt.sourceReports.map(r=>r.coefficient);
      assert.equal(snap.t,action+1);assert.equal(snap.mode,'running');assert.equal(snap.seed,seed);assert.equal(snap.phase,'ongoing');
      assert.equal(snap.history.length,action+1);assert.equal(receipt.action,action);
      assert.equal(receipt.trainedThrough,action>=30?action-1:null);
      for(const key of keys){
        assert.ok(Number.isFinite(snap.cumulative[key])&&snap.cumulative[key]>=previous[key]);previous[key]=snap.cumulative[key];
        const raw=independentRaw(sim,key,action,c),executed=receipt.policies[key];
        for(let r=0;r<network.M;r++){
          near(executed.raw[r],raw[r],1e-10);near(executed.raw[r],executed.feedback[r]+executed.prediction[r]);
          near(executed.bounded[r],Math.max(-.07,Math.min(.07,raw[r])));
          near(snap.commandQ[key][api.constants.inverterBuses[r]-1],1000*executed.bounded[r]);
        }
        assert.ok(snap.voltages[key].every(Number.isFinite));assert.equal(snap.voltages[key][0],1);
        snap.lastSample.disturbances[key].forEach((v,j)=>near(v,snap.lastSample.disturbance[j],1e-11));
      }
      if(previousCoefficients&&action>=30){
        const before=independentRaw(sim,'online',action,previousCoefficients);
        if(before.some((v,r)=>Math.abs(v-receipt.policies.online.raw[r])>1e-9))changedCommands++;
      }
      previousCoefficients=c;
      for(let r=0;r<network.M;r++)for(let j=0;j<network.N-1;j++){
        const admitted=sim.continuousController.selection.support[r][j],online=receipt.policies.online;
        if(!admitted){assert.equal(online.receivedCoefficients[r][j],null);assert.equal(online.sourceContributions[r][j],0);assert.equal(online.currentGains[r][j],0);}
        else near(online.receivedCoefficients[r][j],c[j]);
      }
      for(const report of receipt.sourceReports){
        assert.equal(report.totalPairs,action);assert.equal(report.availableAt,action);
        assert.equal(report.windowCount,Math.min(action,60));assert.equal(report.updates,Math.max(0,action-29));
      }
    }
    assert.ok(changedCommands>0,'Actual weight updates change executed raw commands on fixed current input');
    const snap=sim.snapshot(),edges=sim.continuousController.selection.links.length,issued=plan.steps+4;
    for(const key of ['online','scalar','static']){
      const traffic=snap.traffic[key],remote=key==='static'?network.M*(network.N-2):edges;
      assert.equal(traffic.remoteForecastMessages,issued*remote);assert.equal(traffic.localForecastMessages,issued*network.M);
      assert.equal(traffic.correctionScalars,key==='online'?traffic.forecastMessages:0);
      assert.equal(traffic.probingMessages,0);
      for(const box of sim.continuousController.boxes[key])assert.ok(box.packets.size<=10);
    }
    assert.equal(snap.traffic.causal.forecastMessages,0);
    outcomes.push({network:network.id,quality:quality.id,seed,steps:plan.steps,stageCosts:snap.cumulative,changedCommands,
      remoteLinks:{online:edges,scalar:edges,static:network.M*(network.N-2),causal:0}});
    if(seed===plan.seeds[0]&&quality.id==='mixed'){
      const record=JSON.parse(JSON.stringify(sim.recordContinuous())),copy=api.replayContinuous(record);
      assert.deepEqual(copy.snapshot(),snap,'New protocol replay is exact with all arbitrary attacks and repairs');
      assert.throws(()=>api.replayContinuous({...record,networkId:'different'}),/network/);
      assert.throws(()=>api.replayContinuous({...record,events:[{t:-1,type:'pulse',bus:2,strength:100}]}),/event order/);
      assert.throws(()=>api.replayContinuous({...record,events:[{t:0,type:'forecast',bus:1,faulty:false}]}),/event order/);
    }
  }
  console.log('Predeclared ongoing protocol acceptance outcomes '+JSON.stringify(outcomes));
});

test('corruption changes a raw preview before learning its error and changes actual weights only after reveal',()=>{
  const api=Demo.forNetwork('toy8'),options={protocol:'continuous-phi-v1',powerScenario:'forecasted-demand',beta:4,preset:'reliable',faultBuses:[],seed:20261013};
  const a=new api.Simulation(options),b=new api.Simulation(options),bus=api.constants.inverterBuses[0],j=bus-2;
  for(let t=0;t<60;t++){a.step();b.step();}
  const sealed=a.forecasts.map(f=>JSON.stringify(f));a.toggleFault(bus);
  for(let action=60;action<=66;action++){
    const aa=a.step(),bb=b.step();
    for(let i=0;i<sealed.length;i++)assert.equal(JSON.stringify(a.forecasts[i]),sealed[i]);
    if(action<65)near(aa.lastExecution.sourceReports[j].coefficient,bb.lastExecution.sourceReports[j].coefficient,1e-9);
    if(action===60)assert.notEqual(a.forecasts[64].forecast[bus-1],b.forecasts[64].forecast[bus-1]);
    if(action===65)assert.ok(Math.abs(aa.lastExecution.sourceReports[j].coefficient-bb.lastExecution.sourceReports[j].coefficient)>1e-8);
  }
  assert.equal(a.forecasts[64].issuedAt,60);
});

test('ongoing source admission rejects future prefixes and history and costs keep growing through 1801 actions',()=>{
  const api=Demo.forNetwork('toy8'),sim=new api.Simulation({protocol:'continuous-phi-v1',powerScenario:'forecasted-demand',beta:4});
  for(let action=0;action<plan.long_history.steps;action++){
    if([179,180,359,360,479,480,900,1200].includes(action))sim.queuePulse(8,100,'held-target-v1');
    sim.step();
  }
  const snap=sim.snapshot();assert.equal(snap.t,1801);assert.equal(snap.history.length,1801);assert.equal(snap.mode,'running');
  assert.ok(snap.history.at(-1).online>snap.history[179].online);assert.equal(sim.samples.length,1801);
  assert.equal(sim.continuousController.sources[0].pairs.length,60);
  const state=snap.states.online.slice(),cost=snap.cumulative.online;sim.extend(100);assert.equal(sim.t,1801);
  assert.deepEqual(sim.snapshot().states.online,state);assert.equal(sim.snapshot().cumulative.online,cost);
  assert.throws(()=>sim.continuousController.begin(1802,sim.samples,sim.forecasts),/revealed prefix/);
  const legacy=new api.Simulation({horizon:1});assert.throws(()=>legacy.recordContinuous(),/legacy/);
  assert.throws(()=>new api.Simulation({protocol:'unknown'}),/protocol/);
});

test('ongoing solar outage remains a shared unforecast physical event with all costs',()=>{
  const sim=new Demo.Simulation({protocol:'continuous-phi-v1',powerScenario:'solar-outage',beta:4});
  for(let t=0;t<52;t++)sim.step();
  const starts=sim.eventLog.filter(e=>e.type==='scenario');assert.deepEqual(starts.map(e=>[e.t,e.action]),[[30,'start'],[50,'restore']]);
  assert.ok(sim.history[30].online>sim.history[29].online);
  for(const key of keys)sim.lastSample.disturbances[key].forEach((v,j)=>near(v,sim.lastSample.disturbance[j],1e-11));
});
