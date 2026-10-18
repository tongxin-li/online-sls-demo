/* Ongoing experimental causal prediction protocol.
 * Sources fit only their own revealed forcing. Receivers use admitted cached
 * messages and coefficient metadata. Offline support is fixed in this version.
 * Frozen response feasibility is distinct from stability of adaptive execution. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./causal-source-scale.js'):root.CausalSourceScale);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ContinuousResponse=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Scale){
  'use strict';
  const keys=['online','scalar','static','causal'];
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  const zeros=(m,n)=>Array.from({length:m},()=>Array(n).fill(0));
  const mv=(a,x)=>a.map(row=>row.reduce((sum,v,j)=>sum+v*x[j],0));
  const actionNumber=t=>{if(!Number.isSafeInteger(t)||t<0)throw new RangeError('Action must be a nonnegative integer');};
  function kernel(api,support=null){
    const {preview:depth,N,M}=api.constants,T=4*depth+1,anchor=depth+1,design=api.math.getDesign(T,support);
    const startup=design.columns.slice(0,depth),interior=design.columns[anchor-1];
    function column(target){
      actionNumber(target);
      const base=target<depth?startup[target]:interior,shift=target+1-base.k,out={k:target+1,target,pattern:base.pattern};
      for(const group of ['X','U','L'])out[group]=Object.fromEntries(Object.entries(base[group]).map(([time,value])=>[Number(time)+shift,value]));
      return out;
    }
    function row(action){
      actionNumber(action);const blocks=[];
      for(let target=Math.max(0,action-depth);target<action+depth;target++){
        const col=column(target),X=col.X[action],U=col.U[action],L=col.L[action];
        if(L)blocks.push({k:target+1,target,X:X||zeros(N-1,N-1),U:U||zeros(M,N-1),L});
      }
      return blocks;
    }
    const scores=zeros(M,N-1);
    for(const matrix of Object.values(interior.L))for(let r=0;r<M;r++)for(let j=0;j<N-1;j++)scores[r][j]+=matrix[r][j]**2;
    return {version:'stationary-preview-v1',planningHorizon:T,depth,startupTargets:depth,support:design.support,
      column,row,scores,interior,startup,design};
  }
  class Controller{
    constructor(api){
      if(!Scale)throw new Error('Causal source scaling must be loaded for the ongoing protocol');
      this.api=api;const {N,M,preview,remoteBudget,inverterBuses}=api.constants;
      this.n=N-1;this.m=M;this.depth=preview;this.observed=0;this.nextTarget=0;this.lastAction=-1;
      this.dense=kernel(api);this.selection=api.math.Response.supportFromScores(this.dense.scores,inverterBuses,remoteBudget,1e-12);
      this.sparse=kernel(api,this.selection.support);
      this.sources=Array.from({length:this.n},(_,j)=>new Scale.SourceScale({source:j+2,lambda:api.model.calibrationRidge,preview}));
      this.identity=Array.from({length:this.n},(_,j)=>({at:()=>({source:j+2,coefficient:1,trainedThrough:null,availableAt:0,updates:0})}));
      this.permissions={online:this.selection.support,scalar:this.selection.support,static:zeros(M,this.n).map(row=>row.map(()=>true)),causal:zeros(M,this.n).map(row=>row.map(()=>false))};
      this.boxes=Object.fromEntries(keys.map(key=>[key,Array.from({length:M},()=>({packets:new Map(),reports:new Map()}))]));
      this.traffic=Object.fromEntries(keys.map(key=>[key,{forecastMessages:0,remoteForecastMessages:0,localForecastMessages:0,correctionScalars:0,remoteCorrectionScalars:0,probingMessages:0}]));
      this.receipt=null;this.pending=null;this.sourceReports=this.sources.map(s=>s.at(0));
    }
    deliverPolicy(key,action,issued){
      if(key==='causal')return;
      const {inverterBuses,remoteBudget}=this.api.constants,n=this.n;
      // This view never reads an excluded coordinate just to build an array.
      const forecast=Array(n);for(let j=0;j<n;j++)Object.defineProperty(forecast,j,{get:()=>issued.forecast[j+1]});
      for(let r=0;r<this.m;r++){
        const messages=Scale.receiverMessages({receiverBus:inverterBuses[r],permission:this.permissions[key][r],
          remoteBudget:key==='static'?n-1:remoteBudget,nodes:key==='online'?this.sources:this.identity,
          forecast,target:issued.t,issuedAt:issued.issuedAt,action,preview:this.depth});
        const box=this.boxes[key][r];box.packets.set(issued.t,messages);
        for(const message of messages){
          box.reports.set(message.source-2,message);
          const remote=message.source!==inverterBuses[r],traffic=this.traffic[key];
          traffic.forecastMessages++;traffic[remote?'remoteForecastMessages':'localForecastMessages']++;
          if(key==='online'){traffic.correctionScalars++;if(remote)traffic.remoteCorrectionScalars++;}
        }
      }
    }
    begin(action,samples,forecasts){
      actionNumber(action);if(action!==this.lastAction+1||samples.length!==action)throw new RangeError('Ongoing actions require exactly the revealed prefix');
      for(let t=this.observed;t<action;t++){
        const sample=samples[t],issued=forecasts[t];
        if(sample.t!==t||issued.t!==t||issued.issuedAt!==Math.max(0,t-this.depth+1))throw new RangeError('Invalid revealed source timing');
        for(let j=0;j<this.n;j++)this.sources[j].observe({target:t,issuedAt:issued.issuedAt,revealedAt:t+1,
          forecast:issued.forecast[j+1],forcing:sample.disturbance[j+1]},action);
      }
      this.observed=action;this.sourceReports=this.sources.map(source=>source.at(action));
      for(let target=this.nextTarget;target<action+this.depth;target++){
        const issued=forecasts[target];if(!issued||issued.t!==target||issued.issuedAt>action)throw new RangeError('Forecast not issued');
        for(const key of keys)this.deliverPolicy(key,action,issued);
      }
      this.nextTarget=action+this.depth;
      for(const key of keys)for(const box of this.boxes[key])for(const target of box.packets.keys())if(target<action-this.depth)box.packets.delete(target);
      this.lastAction=action;
      this.pending={protocol:'continuous-phi-v1',action,parameterAvailableAt:action,trainedThrough:action>=30?action-1:null,
        sourceReports:this.sourceReports,policies:{},traffic:JSON.parse(JSON.stringify(this.traffic))};
    }
    command(key,state){
      if(!keys.includes(key)||!this.pending)throw new Error('Begin the ongoing action before commands');
      if(!Array.isArray(state)||state.length!==this.n||state.some(v=>!Number.isFinite(v)))throw new RangeError('Invalid physical state');
      const feedback=mv(this.api.model.K,state),prediction=Array(this.m).fill(0);
      const online=key==='online',sourceContributions=online?zeros(this.m,this.n):null,currentGains=online?zeros(this.m,this.n):null;
      const plan=key==='static'?this.dense:this.sparse;
      if(key!=='causal')for(const block of plan.row(this.lastAction)){
        for(let r=0;r<this.m;r++){
          const box=this.boxes[key][r],messages=box.packets.get(block.target);
          if(!messages)throw new Error('Required admitted forecast missing');
          for(const message of messages){
            const j=message.source-2,report=box.reports.get(j),coefficient=online?report.coefficient:1;
            if(report.availableAt>this.lastAction||(report.trainedThrough!==null&&report.trainedThrough>=this.lastAction))throw new RangeError('Future admitted parameter');
            const gain=block.L[r][j]*coefficient,value=gain*message.forecast;
            prediction[r]+=value;
            if(online){sourceContributions[r][j]+=value;if(block.target===this.lastAction)currentGains[r][j]=gain;}
          }
        }
      }
      const raw=feedback.map((v,r)=>v+prediction[r]);
      if(raw.some(v=>!Number.isFinite(v)))throw new RangeError('Nonfinite ongoing command');
      const result={feedback,prediction,raw};
      if(online)Object.assign(result,{sourceContributions,currentGains,
        receivedCoefficients:this.boxes.online.map(box=>Array.from({length:this.n},(_,j)=>box.reports.get(j)?.coefficient??null))});
      this.pending.policies[key]=result;return raw.slice();
    }
    finish(commands){
      for(const key of keys){if(!this.pending?.policies[key])throw new Error('Missing executed policy');this.pending.policies[key].bounded=commands[key].slice();}
      this.receipt=freeze(this.pending);this.pending=null;return this.receipt;
    }
    diagnostics(action){
      const reports=this.sourceReports,coefficients=reports.map(r=>r.coefficient),row=this.sparse.row(action);
      const baselineScores=zeros(this.m,this.n),learnedScores=zeros(this.m,this.n);
      for(const block of row)for(let r=0;r<this.m;r++)for(let j=0;j<this.n;j++){
        if(!this.selection.support[r][j])continue;
        baselineScores[r][j]+=block.L[r][j]**2;learnedScores[r][j]+=(block.L[r][j]*coefficients[j])**2;
      }
      return {coefficients,reports,baselineScores,learnedScores};
    }
  }
  return {kernel,Controller};
});
