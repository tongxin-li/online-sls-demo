'use strict';
// Reproducible comparison. The seed sequence, sample count, plant, objective,
// forecasts, initialization, and learning window are identical for all methods.
// Every sample, including the first 30 without adaptation, contributes to cost.
const {Simulation,constants,model}=require('./simulation.js');
const seeds=Array.from({length:20},(_,i)=>i+1);
const horizon=180;
const baselines=['scalar','static','causal'];
const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const stdev=values=>{
  const average=mean(values);
  return Math.sqrt(values.reduce((sum,value)=>sum+(value-average)**2,0)/(values.length-1));
};
const results=constants.forecastPresets.map(preset=>{
  const runs=seeds.map(seed=>{
    const simulation=new Simulation({seed,horizon,preset:preset.id});
    const voltageRange=Object.fromEntries(constants.controllers.map(key=>[key,
      {min:Math.min(...model.initialVoltage),max:Math.max(...model.initialVoltage)}]));
    const saturationCount=Object.fromEntries(constants.controllers.map(key=>[key,0]));
    let snapshot;
    for(let t=0;t<horizon;t++){
      snapshot=simulation.step();
      for(const key of constants.controllers){
        voltageRange[key].min=Math.min(voltageRange[key].min,...snapshot.voltages[key]);
        voltageRange[key].max=Math.max(voltageRange[key].max,...snapshot.voltages[key]);
        saturationCount[key]+=snapshot.saturation[key].filter(Boolean).length;
      }
    }
    return {seed,costs:snapshot.costs,voltageRange,saturationCount};
  });
  const means=Object.fromEntries(constants.controllers.map(key=>[key,mean(runs.map(run=>run.costs[key]))]));
  const standardDeviations=Object.fromEntries(constants.controllers.map(key=>[key,stdev(runs.map(run=>run.costs[key]))]));
  const comparisons=Object.fromEntries(baselines.map(key=>{
    const wins=runs.filter(run=>run.costs.online<run.costs[key]-1e-12).length;
    const ties=runs.filter(run=>Math.abs(run.costs.online-run.costs[key])<=1e-12).length;
    return [key,{wins,ties,losses:seeds.length-wins-ties,
      savingsPercent:100*(means[key]-means.online)/means[key]}];
  }));
  const voltageRange=Object.fromEntries(constants.controllers.map(key=>[key,{
    min:Math.min(...runs.map(run=>run.voltageRange[key].min)),
    max:Math.max(...runs.map(run=>run.voltageRange[key].max))}]));
  return {preset:preset.id,label:preset.label,means,standardDeviations,comparisons,voltageRange,runs};
});
const report={seeds,horizon,includesWarmup:true,interventions:[],controllers:constants.controllers,
  ridge:constants.rawRidge,window:constants.window,warmup:constants.warmup,preview:constants.preview,
  model:'Synthetic balanced radial LinDistFlow with inverter lag',
  sampleSeconds:constants.sampleSeconds,baseKv:constants.baseKv,baseMva:constants.baseMva,
  inverterBuses:constants.inverterBuses,inverterRatingKva:120,reactiveCommandLimitKvar:70,
  inverterTimeConstantSeconds:constants.tauSeconds,powerNoiseScaleKw:constants.amplitude*1000,
  referenceVoltage:model.referenceVoltage,
  objective:'35 sum((V - V_reference)^2) + 0.08 sum(bounded reactive command in pu squared)',
  forecast:'Current observed power plus calibrated changes in sealed raw power forecasts',
  scalarRestriction:'diag(1, alpha I_23), slack coefficient fixed at one',
  description:'Physical linear feeder benchmark with shared power forecast calibration',results};
if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
else {
  console.log('All 180 samples, seeds 1 through 20, no interventions, same seeded observations for all four controllers.');
  console.table(results.map(result=>({preset:result.preset,...Object.fromEntries(
    Object.entries(result.means).map(([key,value])=>[key,value.toFixed(6)]))})));
  console.table(results.flatMap(result=>baselines.map(key=>({preset:result.preset,baseline:key,
    onlineWins:result.comparisons[key].wins,onlineLosses:result.comparisons[key].losses,
    savingsPercent:result.comparisons[key].savingsPercent.toFixed(2)}))));
  console.log('Positive savings mean lower online cost. Run with --json for every seed and standard deviation.');
}
