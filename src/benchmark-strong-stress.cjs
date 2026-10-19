'use strict';
// Reproduce the selected stress profile through the public simulation API.
// Every outcome is retained. No policy or physical parameter is replaced.
const assert=require('node:assert/strict');
const Demo=require('./simulation.js');
const keys=['online','scalar','static','causal'];
const cases=[
  {networkId:'toy8',seed:20261013},
  {networkId:'feeder24',seed:20261013},
  {networkId:'feeder47',seed:20261013},
  {networkId:'feeder24',seed:17},
  {networkId:'feeder24',seed:29}
];

function runCase({networkId,seed}){
  const api=Demo.forNetwork(networkId),steps=240;
  const sim=new api.Simulation({networkId,seed,protocol:'adaptive-phi-v2',experiment:'communication',
    powerScenario:'forecasted-demand',preset:'mixed',beta:4,stressProfile:'strong-v1'});
  assert.equal(api.math.scheduledPower(2,15,'strong-v1'),0,'Selected profile has quiet intervals');
  const metrics=Object.fromEntries(keys.map(key=>[key,{
    minPu:Infinity,maxPu:-Infinity,voltageViolatingBusSamples:0,saturatedActuatorSamples:0,
    peakCommandKvar:0,peakRawKvar:0,sumStateCost:0,sumActuationCost:0,first60Cost:0,last60Cost:0,
    acMaxErrorPu:0,acMinPu:Infinity,acConverged:true,acChecks:0
  }]));
  let maxTotalKw=-Infinity,peakHomeKw=-Infinity,forecastSq=0,errorSq=0,targets=0;
  for(let t=0;t<steps;t++){
    sim.step();
    maxTotalKw=Math.max(maxTotalKw,sim.powerDeviation.reduce((a,b)=>a+b,0)*1000);
    for(const profile of api.constants.busProfiles)if(profile.role==='Homes')
      peakHomeKw=Math.max(peakHomeKw,sim.powerDeviation[profile.bus-1]*1000);
    for(let j=1;j<api.constants.N;j++){
      const actual=sim.lastSample.disturbance[j],forecast=sim.lastSample.forecast[j];
      forecastSq+=actual*actual;errorSq+=(forecast-actual)**2;targets++;
    }
    for(const key of keys){
      const result=metrics[key],voltage=sim.states[key].map(value=>1+value);
      result.minPu=Math.min(result.minPu,...voltage);
      result.maxPu=Math.max(result.maxPu,...voltage);
      result.voltageViolatingBusSamples+=voltage.slice(1).filter(value=>value<.95||value>1.05).length;
      result.saturatedActuatorSamples+=sim.saturation[key].filter(Boolean).length;
      result.peakCommandKvar=Math.max(result.peakCommandKvar,...sim.command[key].map(value=>Math.abs(value)*1000));
      result.peakRawKvar=Math.max(result.peakRawKvar,...sim.lastExecution.policies[key].raw.map(value=>Math.abs(value)*1000));
      const inputCost=.08*sim.command[key].reduce((sum,value)=>sum+value*value,0);
      result.sumActuationCost+=inputCost;result.sumStateCost+=sim.stage[key]-inputCost;
      if(t<60)result.first60Cost+=sim.stage[key];
      if(t>=180)result.last60Cost+=sim.stage[key];
      if(t%5===0){
        const inverterQ=api.math.padInput(sim.q[key]).map(value=>value*1000);
        const ac=api.math.radialAC(sim.power.loadP,sim.power.loadQ,inverterQ);
        result.acChecks++;result.acConverged=result.acConverged&&ac.converged;
        result.acMinPu=Math.min(result.acMinPu,...ac.voltage);
        result.acMaxErrorPu=Math.max(result.acMaxErrorPu,...ac.voltage.map((value,j)=>Math.abs(value-voltage[j])));
      }
    }
  }
  for(const key of keys){
    metrics[key].cumulativeCost=sim.cumulative[key];
    metrics[key].saturationFraction=metrics[key].saturatedActuatorSamples/(steps*api.constants.M);
    assert.ok(metrics[key].peakCommandKvar<=70+1e-8,'Existing command bound');
    assert.ok(metrics[key].acConverged,'Independent sampled AC calculations converge');
  }
  return {network:networkId,profile:'selected-short-surge',profileId:'short-surge-30',beta:4,quality:'mixed',seed,
    faultNoiseMultiplier:2,steps,maxTotalKw,peakHomeKw,forcingRmsPu:Math.sqrt(forecastSq/targets),
    forecastErrorRmsPu:Math.sqrt(errorSq/targets),normalizedForecastError:Math.sqrt(errorSq/forecastSq),
    updates:sim.learning.updates,topologyChanges:sim.continuousController.supportEvents.length,
    ranking:keys.slice().sort((a,b)=>sim.cumulative[a]-sim.cumulative[b]),metrics};
}

if(require.main===module){
  const json=process.argv.includes('--json'),outcomes=[];
  for(const item of cases){
    const result=runCase(item);outcomes.push(result);
    if(!json){
      console.log(result.network+' seed '+result.seed);
      for(const key of keys){const m=result.metrics[key];
        console.log(key+' cost '+m.cumulativeCost.toPrecision(8)+' voltage '+m.minPu.toFixed(6)+' to '+m.maxPu.toFixed(6)
          +' pu saturated '+(100*m.saturationFraction).toFixed(2)+'% AC error '+m.acMaxErrorPu.toPrecision(5)+' pu');}
    }
  }
  const report={schemaVersion:1,protocol:'adaptive-phi-v2',stressProfile:'strong-v1',profileId:'short-surge-30',
    stepsPerCase:240,beta:4,quality:'mixed',manualAttacks:false,acCheckEveryActions:5,
    interpretation:'Complete costs including startup and learning. No universal ranking or paper reproduction claim.',outcomes};
  if(json)console.log(JSON.stringify(report,null,2));
}
module.exports={cases,runCase};
