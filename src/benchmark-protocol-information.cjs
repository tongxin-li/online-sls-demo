'use strict';
// Preregistered audit only. Production simulation and UI remain unchanged.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
const {Simulation,constants,model,math}=require('./simulation.js');
const keys=constants.controllers,seeds=Array.from({length:20},(_,i)=>i+1),betas=constants.communicationBetas;
const horizon=180,solar=[5,7,14,21],mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clip=(bus,v)=>{const p=constants.busProfiles[bus-1];return p.role==='Solar'?Math.max((p.baseGenerationKw-p.activePowerLimitKw)/1000,Math.min(p.baseGenerationKw/1000,v)):v;};
function profile(t,seed){
  const values=Array(24).fill(0);
  solar.forEach((bus,i)=>{
    const jitter=((Math.imul((seed^0x5a17c9e3)>>>0,1664525)+1013904223+i*7)>>>0)%9;
    const age=t-(36+8*i+jitter);
    const fraction=age<=0?0:age<8?age/8:age<24?1:age<32?(32-age)/8:0;
    values[bus-1]=.04*fraction;
  });
  return values;
}
class ProtocolSimulation extends Simulation{
  constructor(options){super(options);this.information=options.information||'advance';}
  sealPreview(){
    const start=this.forecasts.length;
    if(!start){this.auditDeltas=[];this.auditNoise=[];}
    const before=start?this.forecasts[start-1].base.slice():Array(24).fill(0);
    super.sealPreview();
    const raw=this.forecasts.slice(start);
    for(let j=0;j<raw.length;j++){
      const i=start+j,old=raw[j],oldPrevious=j?raw[j-1].base:before;
      const backgroundPrevious=j?oldPrevious:oldPrevious.map((v,b)=>v-(this.auditDeltas[i-1]?.[b]||0));
      const newPrevious=i?this.forecasts[i-1].base:Array(24).fill(0);
      const offset=this.profile(i),base=old.base.map((v,b)=>clip(b+1,v+offset[b]));
      const delta=base.map((v,b)=>v-old.base[b]);
      const oldTruth=math.matvec(model.powerToVoltage,old.base.map((v,b)=>v-model.lag*oldPrevious[b]));
      const truth=math.matvec(model.powerToVoltage,base.map((v,b)=>v-model.lag*newPrevious[b]));
      const backgroundTruth=math.matvec(model.powerToVoltage,old.base.map((v,b)=>v-model.lag*backgroundPrevious[b]));
      const noise=old.forecast.map((v,b)=>v-oldTruth[b]);
      const informed=this.phase!=='deployment'||this.information!=='withheld';
      const target=informed?truth:backgroundTruth;
      const forecast=old.forecast.map((v,b)=>v+target[b]-oldTruth[b]);
      this.auditDeltas[i]=delta;this.auditNoise[i]=noise;
      // Replacement occurs inside issuance, before the record reaches a controller.
      // It never revises an earlier issued message or depends on future clicks.
      this.forecasts[i]=Object.freeze({...old,base:Object.freeze(base),forecast:Object.freeze(forecast)});
    }
  }
  profile(t){return profile(t,this.options.seed);}
}
class ZeroProfile extends ProtocolSimulation{profile(){return Array(24).fill(0);}}
function execute(seed,beta,information){
  const sim=new ProtocolSimulation({experiment:'communication',horizon,seed,beta,information});
  for(let t=0;t<horizon;t++)sim.step();
  const discovery=hash(sim.forecasts),discoveryProfiles=hash(sim.auditDeltas);
  assert.ok(sim.deployTopology());
  const support=hash({learned:sim.deployedSupport.learned,fixed:sim.deployedSupport.fixed});
  const coefficients=hash(sim.segments.map(s=>({online:s.designs.online,scalar:s.designs.scalar,static:s.designs.static})));
  const commands=[],feedbackCosts=[],physical=[],forecasts=[],noise=[],deltas=[];
  const ranges=Object.fromEntries(keys.map(k=>[k,{minPu:1,maxPu:0,limitedCommands:0,predictionEnergy:0}]));
  let firstPhysical=null,maxLossKw=0,maxForcing=0,last;
  for(let t=0;t<horizon;t++){
    last=sim.step();
    commands.push(Object.fromEntries(keys.map(k=>[k,sim.command[k].slice()])));
    feedbackCosts.push(last.cumulative.causal);physical.push(last.powerDeviation);forecasts.push(last.lastSample.forecast);
    noise.push(sim.auditNoise[t]);deltas.push(sim.auditDeltas[t]);
    const loss=sim.auditDeltas[t].reduce((a,b)=>a+b,0)*1000;
    if(loss>1e-9&&firstPhysical===null)firstPhysical=t;
    maxLossKw=Math.max(maxLossKw,loss);
    for(const bus of solar)assert.ok(last.generationP[bus-1]>=-1e-9&&last.generationP[bus-1]<=90+1e-9);
    const segment=sim.segments[0];
    for(const key of keys){
      const prediction=Array(8).fill(0);
      if(key!=='causal')for(const block of segment.designs[key].rows[t]){
        const term=math.matvec(block.L,sim.forecasts[block.k-1].forecast.slice(1));
        for(let k=0;k<8;k++)prediction[k]+=term[k];
      }
      const x=last.costStates[key].slice(1).map((v,i)=>v-model.baseDrop[i+1]),feedback=math.matvec(model.K,x);
      for(let k=0;k<8;k++)assert.ok(Math.abs(Math.max(-.07,Math.min(.07,feedback[k]+prediction[k]))-sim.command[key][k])<1e-11);
      ranges[key].predictionEnergy+=prediction.reduce((a,b)=>a+b*b,0);
      ranges[key].minPu=Math.min(ranges[key].minPu,...last.voltages[key]);
      ranges[key].maxPu=Math.max(ranges[key].maxPu,...last.voltages[key]);
      ranges[key].limitedCommands+=last.saturation[key].filter(Boolean).length;
    }
    maxForcing=Math.max(maxForcing,...last.lastSample.disturbance.map(Math.abs));
  }
  assert.equal(hash({learned:sim.deployedSupport.learned,fixed:sim.deployedSupport.fixed}),support);
  assert.equal(hash(sim.segments.map(s=>({online:s.designs.online,scalar:s.designs.scalar,static:s.designs.static}))),coefficients);
  assert.ok(maxLossKw<=160+1e-9);
  return {seed,beta,information,costs:last.totalCost,stageCosts:last.cumulative,terminalCosts:last.terminalCost,ranges,
    firstPhysical,maxLossKw,maxForcing,discovery,discoveryProfiles,support,coefficients,
    physicalHash:hash(physical),noiseHash:hash(noise),profileHash:hash(deltas),forecastHash:hash(forecasts),
    commands,feedbackCosts};
}
// A zero-profile adapter must preserve the original engine numerically.
for(const beta of [0,1,2]){
 const a=new Simulation({experiment:'communication',horizon:45,seed:1,beta}),b=new ZeroProfile({experiment:'communication',horizon:45,seed:1,beta});
 for(let t=0;t<40;t++){const x=a.step(),y=b.step();for(const k of keys)assert.ok(Math.abs(x.cumulative[k]-y.cumulative[k])<1e-12);}
}
const header={audit:'PV advance information protocol',version:1,seeds,betas,horizon,controllers:keys,
 profile:{buses:solar,maxLossPerSiteKw:40,maxTotalLossKw:160,riseSeconds:8,plateauSeconds:16,fallSeconds:8,startRule:'36 + 8*siteIndex + independent deterministic seed jitter 0..8',phaseSeed:'Discovery and fresh held out deployment seeds are distinct'},
 rationale:'Declared passing cloud loss at existing PV sites with retained reactive support. Synthetic bounded irradiance nowcast assumption, not measured field realism.',
 timing:'Existing immutable 5-block preview with 4-second advance. No future click information. Profile enters issuance before a message is exposed; revealed data enters discovery fitting only at existing engine times.',
 noise:'Original beta grid and absolute background-derived forcing error scales unchanged. This assumes greater relative forecast accuracy for a larger planned signal; not validated field forecasting.',
 pairing:'Identical phase physical streams, selected supports, synthesis coefficients and Gaussian errors between advance and withheld-information arms. Both discovery arms have advance information; only held out forecast profile component is withheld. All controllers within an arm see identical forecasts and realized disturbances.',
 changes:'Audit adapter only. Production engine, UI, defaults, common feedback, gains, objective and limits unchanged.',
 manuscript:'Only public README protocol is available. Discovery, offline selection, synthesis and fresh held out evaluation are retained. Added PV prior is a feeder diagnostic, not established manuscript fidelity or exact Algorithm 1.'};
console.log('PROTOCOL_HEADER '+JSON.stringify(header));
const trials=[];
for(const beta of betas)for(const seed of seeds){
 const a=execute(seed,beta,'advance'),b=execute(seed,beta,'withheld');
 for(const k of ['discovery','discoveryProfiles','support','coefficients','physicalHash','noiseHash','profileHash'])assert.equal(a[k],b[k],k+' must be paired');
 assert.deepEqual(a.feedbackCosts,b.feedbackCosts,'Feedback only is identical under information ablation');
 assert.equal(a.costs.causal,b.costs.causal);
 const firstCommandDifference=Object.fromEntries(keys.map(k=>[k,a.commands.findIndex((row,t)=>row[k].some((v,i)=>Math.abs(v-b.commands[t][k][i])>1e-12))]));
 assert.equal(firstCommandDifference.causal,-1);
 assert.ok(firstCommandDifference.static>=0&&firstCommandDifference.static<a.firstPhysical,'Dense controller actually uses advance information before physical profile begins');
 delete a.commands;delete a.feedbackCosts;delete b.commands;delete b.feedbackCosts;
 const trial={seed,beta,advance:a,withheld:b,firstCommandDifference};trials.push(trial);
 console.log('PROTOCOL_TRIAL '+JSON.stringify(trial));
}
const results=betas.map(beta=>{
 const rows=trials.filter(r=>r.beta===beta),means=Object.fromEntries(['advance','withheld'].map(arm=>[arm,Object.fromEntries(keys.map(k=>[k,mean(rows.map(r=>r[arm].costs[k]))]))]));
 const compare=(left,right)=>({savingsPercent:100*(mean(right)-mean(left))/mean(right),wins:left.filter((x,i)=>x<right[i]-1e-12).length,ties:left.filter((x,i)=>Math.abs(x-right[i])<=1e-12).length,losses:left.filter((x,i)=>x>right[i]+1e-12).length});
 return {beta,means,advanceComparisons:Object.fromEntries(keys.slice(1).map(k=>[k,compare(rows.map(r=>r.advance.costs.online),rows.map(r=>r.advance.costs[k]))])),
 valueOfAdvance:Object.fromEntries(keys.map(k=>[k,compare(rows.map(r=>r.advance.costs[k]),rows.map(r=>r.withheld.costs[k]))]))};
});
const report={...header,engineRuns:trials.length*2,results,trials};
fs.writeFileSync(process.env.PROTOCOL_AUDIT_OUTPUT||'protocol-audit.json',JSON.stringify(report,null,2)+'\n');
console.log('PROTOCOL_SUMMARY '+JSON.stringify(results));
