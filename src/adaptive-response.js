/* Causal shared full-response adaptation with online support reselection.
 * This is an experimental extension, not a literal implementation or new
 * convergence guarantee for Algorithm 1. Each issued column is immutable.
 * Feasibility refers to nominal commands before the shared physical clipping. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./continuous-response.js'):root.ContinuousResponse);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AdaptiveResponse=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Continuous){
  'use strict';
  const protocol='adaptive-phi-v2',keys=['online','scalar','static','causal'];
  const defaults=Object.freeze({window:60,warmup:30,reselectEvery:30,ridge:1e-6});
  const zeros=(m,n=m)=>Array.from({length:m},()=>Array(n).fill(0));
  const copy=a=>a.map(row=>row.slice()),transpose=a=>a[0].map((_,j)=>a.map(row=>row[j]));
  const mv=(a,x)=>a.map(row=>row.reduce((s,v,j)=>s+v*x[j],0));
  const mm=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((s,v,k)=>s+v*b[k][j],0)));
  const squared=a=>a.reduce((s,v)=>s+v*v,0),normInf=a=>Math.max(...a.map(row=>row.reduce((s,v)=>s+Math.abs(v),0)));
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  const integer=(value,min,name)=>{if(!Number.isSafeInteger(value)||value<min)throw new RangeError(name+' must be an integer at least '+min);return value;};
  const finite=(value,name)=>{if(!Number.isFinite(value))throw new TypeError(name+' must be finite');return value;};
  const pair=e=>e.from+','+e.to;
  const cloneZ=z=>z.map(copy);
  const immutableZ=z=>Object.isFrozen(z)&&z.every(matrix=>Object.isFrozen(matrix)&&matrix.every(row=>Object.isFrozen(row)));
  const zDistance=(a,b)=>Math.sqrt(a.reduce((sum,matrix,s)=>sum+matrix.reduce((part,row,i)=>part+row.reduce((t,v,j)=>t+(v-b[s][i][j])**2,0),0),0));

  class ResponseSpace{
    constructor(api,support=null){
      if(!Continuous)throw new Error('Load continuous-response.js before adaptive-response.js');
      this.api=api;this.n=api.model.A.length;this.m=api.model.B[0].length;this.depth=api.constants.preview;
      this.a=api.model.A[0][0];
      if(api.model.A.some((row,i)=>row.some((v,j)=>v!==(i===j?this.a:0))))throw new RangeError('Shared response coordinates require A = a I');
      this.B=api.model.B;this.gram=mm(transpose(this.B),this.B);
      this.C=mm(api.model.K,this.B);for(let i=0;i<this.m;i++)this.C[i][i]+=this.a;
      if(support!==null&&(!Array.isArray(support)||support.length!==this.m||support.some(row=>!Array.isArray(row)||row.length!==this.n||row.some(v=>typeof v!=='boolean'))))throw new RangeError('Invalid response support');
      this.support=support?freeze(copy(support)):null;this.kernel=Continuous.kernel(api,this.support);
      const count=2*this.depth+1;this.prior=Array.from({length:count},()=>zeros(this.m,this.n));
      // U_delta = Z_(delta+1) - a Z_delta, with Z_-d = 0. This obtains
      // the existing synthesized coordinates without an inverse of B.
      const column=this.kernel.interior;
      for(let s=0;s<count-1;s++){
        const U=column.U[column.k+s-this.depth];
        this.prior[s+1]=U.map((row,i)=>row.map((v,j)=>v+this.a*this.prior[s][i][j]));
      }
      this.prior[count-1]=zeros(this.m,this.n);freeze(this.prior);
      // C is block diagonal across independent radial arms. Project each exact
      // connected component separately, retaining all forecast source columns.
      // Cross-arm learned correlations are therefore allowed when admitted.
      this.groups=[];const unseen=new Set(Array.from({length:this.m},(_,i)=>i));
      while(unseen.size){
        const group=[unseen.values().next().value];unseen.delete(group[0]);
        for(let p=0;p<group.length;p++)for(const r of [...unseen])if(this.C[group[p]][r]!==0||this.C[r][group[p]]!==0){group.push(r);unseen.delete(r);}
        group.sort((a,b)=>a-b);this.groups.push(group);
      }
      this.projections=new Map();this.responseCache=new WeakMap();this.gainCache=new WeakMap();this.residualCache=new WeakMap();
    }
    basis(group,allowed){
      if(allowed.every(Boolean))return null;
      const d=this.depth,q=group.length,size=(2*d-1)*q,key=group.join(',')+'|'+allowed.map(Number).join('');
      if(this.projections.has(key))return this.projections.get(key);
      const constraints=[];
      for(let s=0;s<2*d;s++)for(let r=0;r<q;r++)if(!allowed[r]){
        const row=Array(size).fill(0);
        if(s+1<2*d)row[s*q+r]=1;
        if(s>0)for(let j=0;j<q;j++)row[(s-1)*q+j]-=this.C[group[r]][group[j]];
        constraints.push(row);
      }
      const basis=this.api.math.Response.math.nullspace(constraints,size);this.projections.set(key,basis);return basis;
    }
    project(z){
      const out=cloneZ(z),end=2*this.depth;out[0]=zeros(this.m,this.n);out[end]=zeros(this.m,this.n);
      if(!this.support)return out;
      for(const group of this.groups)for(let source=0;source<this.n;source++){
        const basis=this.basis(group,group.map(r=>this.support[r][source]));if(basis===null)continue;
        const input=[];for(let s=1;s<end;s++)for(const r of group)input.push(z[s][r][source]);
        const projected=Array(input.length).fill(0);
        for(const direction of basis){const scale=direction.reduce((sum,v,i)=>sum+v*input[i],0);for(let i=0;i<input.length;i++)projected[i]+=scale*direction[i];}
        let offset=0;for(let s=1;s<end;s++)for(const r of group)out[s][r][source]=projected[offset++];
      }
      return out;
    }
    predictionGains(z){
      const immutable=immutableZ(z);
      if(immutable&&this.gainCache.has(z))return this.gainCache.get(z);
      const L=[];
      for(let s=0;s<2*this.depth;s++){
        const cz=mm(this.C,z[s]);
        L.push(z[s+1].map((row,i)=>row.map((v,j)=>v-cz[i][j])));
      }
      if(immutable){freeze(L);this.gainCache.set(z,L);}return L;
    }
    responses(z){
      const immutable=immutableZ(z);
      if(immutable&&this.responseCache.has(z))return this.responseCache.get(z);
      const X=z.map(matrix=>mm(this.B,matrix)),U=[];
      for(let s=0;s<2*this.depth;s++)U.push(z[s+1].map((row,i)=>row.map((v,j)=>v-this.a*z[s][i][j])));
      const response={X,U,L:this.predictionGains(z)};
      if(immutable){freeze(response);this.responseCache.set(z,response);}return response;
    }
    column(z,target){
      integer(target,0,'Forecast target');
      if(target<this.depth)return this.kernel.column(target);
      const response=this.responses(z),k=target+1,out={k,target,pattern:this.kernel.interior.pattern};
      for(const group of ['X','U','L'])out[group]=Object.fromEntries(response[group].map((matrix,s)=>[k+s-this.depth,matrix]));
      return out;
    }
    scores(z){
      const scores=zeros(this.m,this.n),L=this.predictionGains(z);
      for(const matrix of L)for(let r=0;r<this.m;r++)for(let j=0;j<this.n;j++)scores[r][j]+=matrix[r][j]**2;
      return scores;
    }
    residual(z){
      const immutable=immutableZ(z);if(immutable&&this.residualCache.has(z))return this.residualCache.get(z);
      const {X,U,L}=this.responses(z),end=2*this.depth;let recurrence=0,support=0,boundary=0;
      for(const s of [0,end])for(const row of X[s])for(const v of row)boundary=Math.max(boundary,Math.abs(v));
      for(let s=0;s<end;s++){
        const bu=mm(this.B,U[s]);
        for(let i=0;i<this.n;i++)for(let j=0;j<this.n;j++)recurrence=Math.max(recurrence,Math.abs(X[s+1][i][j]-this.a*X[s][i][j]-bu[i][j]));
        if(this.support)for(let r=0;r<this.m;r++)for(let j=0;j<this.n;j++)if(!this.support[r][j])support=Math.max(support,Math.abs(L[s][r][j]));
      }
      const residual={recurrence,support,boundary};if(immutable){freeze(residual);this.residualCache.set(z,residual);}return residual;
    }
  }

  // Each row contains exactly the canonical issued forecasts and revealed
  // forcing at targets r-d ... r+d-1. No response is fitted to future truth.
  function completedRow(action,depth,n,samples,forecasts){
    integer(action,0,'Action');const row=action-depth;
    if(row<depth)return null;
    const h=[],w=[],targets=[];
    for(let s=0;s<2*depth;s++){
      const target=row-(s-depth)-1,sample=samples[target],issued=forecasts[target];
      if(!sample||sample.t!==target||!issued||issued.t!==target||issued.issuedAt!==Math.max(0,target-depth+1)||target>=action)throw new RangeError('Unrevealed completed response row');
      if(!Array.isArray(issued.forecast)||issued.forecast.length!==n+1||!Array.isArray(sample.disturbance)||sample.disturbance.length!==n+1)throw new RangeError('Completed row dimension mismatch');
      h.push(issued.forecast.slice(1).map(v=>finite(v,'Forecast')));w.push(sample.disturbance.slice(1).map(v=>finite(v,'Revealed forcing')));targets.push(target);
    }
    return freeze({row,availableAt:action,trainedThrough:Math.max(...targets),targets,h,w});
  }
  function objectiveGradient(space,z,rows,ridge,{gradient=true}={}){
    finite(ridge,'Ridge');if(ridge<=0)throw new RangeError('Ridge must be positive');
    const {m,n,depth:d,a,gram,prior}=space,end=2*d,grad=gradient?Array.from({length:end+1},()=>zeros(m,n)):null;
    let empirical=0,hEnergy=0,uEnergy=0;
    for(const {h,w} of rows){
      const xcoord=Array(m).fill(0),eu=Array(m).fill(0);
      for(let s=0;s<end;s++)for(let i=0;i<m;i++)for(let j=0;j<n;j++){
        xcoord[i]+=z[s][i][j]*h[s][j]-prior[s][i][j]*w[s][j];
        eu[i]+=(z[s+1][i][j]-a*z[s][i][j])*h[s][j]-(prior[s+1][i][j]-a*prior[s][i][j])*w[s][j];
      }
      const gx=mv(gram,xcoord);empirical+=.5*(xcoord.reduce((sum,v,i)=>sum+v*gx[i],0)+squared(eu));
      for(let s=1;s<end;s++){
        const difference=h[s-1].map((v,j)=>v-a*h[s][j]);hEnergy+=squared(h[s]);uEnergy+=squared(difference);
        if(gradient)for(let i=0;i<m;i++)for(let j=0;j<n;j++)grad[s][i][j]+=gx[i]*h[s][j]+eu[i]*difference[j];
      }
    }
    const count=Math.max(1,rows.length),delta=z.map((matrix,s)=>matrix.map((row,i)=>row.map((v,j)=>v-prior[s][i][j])));
    let regularizer=0;
    for(let s=1;s<end;s++){
      const gz=mm(gram,delta[s]);
      for(let i=0;i<m;i++)for(let j=0;j<n;j++){
        regularizer+=delta[s][i][j]*gz[i][j];
        if(gradient)grad[s][i][j]=grad[s][i][j]/count+ridge*(gz[i][j]+(1+a*a)*delta[s][i][j]-a*delta[s-1][i][j]-a*delta[s+1][i][j]);
      }
    }
    for(let s=0;s<end;s++)for(let i=0;i<m;i++)for(let j=0;j<n;j++)regularizer+=(delta[s+1][i][j]-a*delta[s][i][j])**2;
    const lipschitz=(normInf(gram)*hEnergy+uEnergy)/count+ridge*(normInf(gram)+(1+Math.abs(a))**2);
    return {value:empirical/count+.5*ridge*regularizer,empirical:empirical/count,regularizer:.5*ridge*regularizer,
      gradient:gradient?grad:null,lipschitz};
  }
  class ResponseLearner{
    constructor(api,support=null,options={}){
      this.api=api;this.ridge=options.ridge??api.constants.rawRidge??defaults.ridge;
      finite(this.ridge,'Ridge');if(this.ridge<=0)throw new RangeError('Ridge must be positive');
      this.space=new ResponseSpace(api,support);this.z=freeze(cloneZ(this.space.prior));this.updates=0;this.version=0;this.last=null;
    }
    update(rows){
      if(!rows.length)return null;
      const before=objectiveGradient(this.space,this.z,rows,this.ridge),old=this.z;let step=1/before.lipschitz,next,after;
      for(let attempt=0;attempt<12;attempt++){
        next=this.space.project(old.map((matrix,s)=>matrix.map((row,i)=>row.map((v,j)=>v-step*before.gradient[s][i][j]))));
        after=objectiveGradient(this.space,next,rows,this.ridge,{gradient:false});
        if(after.value<=before.value+1e-15*Math.max(1,before.value))break;step*=.5;
      }
      if(!Number.isFinite(after.value)||after.value>before.value+1e-12*Math.max(1,before.value))throw new Error('Projected response update failed its frozen data loss check');
      this.z=freeze(next);this.updates++;this.version++;
      this.last={updates:this.updates,version:this.version,parameterDelta:zDistance(next,old),gradientNorm:Math.sqrt(before.gradient.reduce((sum,matrix)=>sum+squared(matrix.flat()),0)),
        objectiveBefore:before.value,objectiveAfter:after.value,stepSize:step,lipschitz:before.lipschitz,
        trainedThrough:rows.at(-1).trainedThrough,rowThrough:rows.at(-1).row,availableAt:rows.at(-1).availableAt};
      return this.last;
    }
    changeSupport(support){
      const old=this.space,previous=this.z,next=new ResponseSpace(this.api,support);
      const correction=previous.map((matrix,s)=>matrix.map((row,i)=>row.map((v,j)=>v-old.prior[s][i][j])));
      const feasible=next.project(correction);this.z=freeze(next.project(next.prior.map((matrix,s)=>matrix.map((row,i)=>row.map((v,j)=>v+feasible[s][i][j])))));
      this.space=next;this.version++;return{parameterDelta:zDistance(this.z,previous),version:this.version,feasibility:next.residual(this.z)};
    }
  }

  class Controller{
    constructor(api,options={}){
      this.api=api;this.protocol=protocol;const {N,M,preview,inverterBuses,remoteBudget}=api.constants;
      this.n=N-1;this.m=M;this.depth=preview;this.window=integer(options.window??defaults.window,1,'Window');
      this.warmup=integer(options.warmup??defaults.warmup,1,'Warmup');if(this.warmup>this.window)throw new RangeError('Warmup exceeds window');
      this.reselectEvery=integer(options.reselectEvery??defaults.reselectEvery,1,'Reselection interval');
      this.dense=Continuous.kernel(api);this.fixedSelection=freeze(api.math.Response.supportFromScores(this.dense.scores,inverterBuses,remoteBudget,1e-12));
      this.selection=this.fixedSelection;this.sparse=Continuous.kernel(api,this.fixedSelection.support);
      this.scoreLearner=new ResponseLearner(api,null,options);this.learner=new ResponseLearner(api,this.selection.support,options);
      this.permissions={online:this.selection.support,scalar:this.fixedSelection.support,static:zeros(M,this.n).map(row=>row.map(()=>true)),causal:zeros(M,this.n).map(row=>row.map(()=>false))};
      this.observed=0;this.nextTarget=0;this.lastAction=-1;this.rows=[];this.completedRows=0;this.updateCount=0;this.topologyVersion=0;
      this.columns=new Map();this.revealed=[];this.revealedForecasts=[];this.supportEvents=[];this.supportHistory=[freeze({t:0,links:this.selection.links.map(e=>({...e}))})];
      this.learningTraffic={revealedSourcePairs:0,revealedScalarValues:0,parameterBroadcastMessages:0,parameterScalars:0,topologyBroadcastMessages:0};
      this.traffic=Object.fromEntries(keys.map(key=>[key,{forecastMessages:0,remoteForecastMessages:0,localForecastMessages:0,
        forecastValues:0,remoteForecastValues:0,localForecastValues:0,correctionScalars:0,remoteCorrectionScalars:0,probingMessages:0}]));
      this.sourceReports=[];this.receipt=null;this.pending=null;
      this.learning={completedRows:0,updates:0,windowSize:0,windowStart:null,windowEnd:null,trainedThrough:null,parameterDelta:0,objectiveBefore:null,objectiveAfter:null,stepSize:null};
      this.baselineScores=this.sparse.scores;this.learnedScores=this.learner.space.scores(this.learner.z);this.candidateScores=this.dense.scores;
    }
    update(action,samples,forecasts){
      const previousZ=this.learner.z;let supportProjection=null;
      for(let target=this.observed;target<action;target++){
        const sample=samples[target],issued=forecasts[target];
        if(!sample||sample.t!==target||!issued||issued.t!==target||issued.issuedAt!==Math.max(0,target-this.depth+1))throw new RangeError('Revealed samples must arrive in target order');
        if(!Array.isArray(sample.disturbance)||sample.disturbance.length!==this.n+1||!Array.isArray(issued.forecast)||issued.forecast.length!==this.n+1)throw new RangeError('Revealed telemetry dimension mismatch');
        const disturbance=sample.disturbance.map(v=>finite(v,'Revealed forcing')),forecast=issued.forecast.map(v=>finite(v,'Revealed forecast'));
        if(disturbance[0]!==0||forecast[0]!==0)throw new RangeError('Slack forcing must be zero');
        this.revealed.push(freeze({t:target,disturbance}));this.revealedForecasts.push(freeze({t:target,issuedAt:issued.issuedAt,forecast}));
        this.learningTraffic.revealedSourcePairs+=this.n;this.learningTraffic.revealedScalarValues+=2*this.n;
      }
      this.observed=action;const row=completedRow(action,this.depth,this.n,this.revealed,this.revealedForecasts);
      if(row){this.rows.push(row);this.rows=this.rows.slice(-this.window);this.completedRows++;}
      if(this.rows.length>=this.warmup){
        this.scoreLearner.update(this.rows);this.learner.update(this.rows);this.updateCount++;
        this.candidateScores=this.scoreLearner.space.scores(this.scoreLearner.z);
        if((this.updateCount-1)%this.reselectEvery===0){
          const next=this.api.math.Response.supportFromScores(this.candidateScores,this.api.constants.inverterBuses,this.api.constants.remoteBudget,1e-12);
          const oldPairs=new Set(this.selection.links.map(pair)),newPairs=new Set(next.links.map(pair));
          const added=next.links.filter(e=>!oldPairs.has(pair(e))),removed=this.selection.links.filter(e=>!newPairs.has(pair(e)));
          if(added.length||removed.length){
            const projection=this.learner.changeSupport(next.support);supportProjection=projection;this.selection=freeze(next);this.permissions.online=this.selection.support;this.topologyVersion++;
            this.supportEvents.push(freeze({t:action,action,topologyVersion:this.topologyVersion,added:added.map(e=>({...e})),removed:removed.map(e=>({...e})),links:next.links.map(e=>({...e})),projection}));
            this.supportHistory.push(freeze({t:action+1,action,links:next.links.map(e=>({...e}))}));this.learningTraffic.topologyBroadcastMessages+=this.m;
          }
        }
        this.learnedScores=this.learner.space.scores(this.learner.z);
      }
      this.learning={...this.learning,...this.learner.last,version:this.learner.version,gradientVersion:this.learner.last?.version??null,
        gradientParameterDelta:this.learner.last?.parameterDelta??0,parameterDelta:zDistance(this.learner.z,previousZ),supportProjection,
        objectiveSupportVersion:this.topologyVersion-(supportProjection?1:0),
        currentResponseObjective:supportProjection?objectiveGradient(this.learner.space,this.learner.z,this.rows,this.learner.ridge,{gradient:false}).value:this.learner.last?.objectiveAfter??null,
        completedRows:this.completedRows,updates:this.updateCount,
        windowSize:this.rows.length,windowStart:this.rows[0]?.row??null,windowEnd:this.rows.at(-1)?.row??null,
        trainedThrough:this.learner.last?.trainedThrough??null,fullResponse:true,sharedParameterExtension:true,topologyVersion:this.topologyVersion};
    }
    begin(action,samples,forecasts){
      integer(action,0,'Action');if(action!==this.lastAction+1||!Array.isArray(samples)||samples.length!==action)throw new RangeError('Adaptive actions require exactly the revealed prefix');
      if(this.pending)throw new Error('Finish the previous adaptive action');
      this.update(action,samples,forecasts);const newColumns=[],actionLinks=Object.fromEntries(keys.map(key=>[key,new Map()]));
      for(let target=this.nextTarget;target<action+this.depth;target++){
        const issued=forecasts[target];if(!issued||issued.t!==target||issued.issuedAt!==Math.max(0,target-this.depth+1)||issued.issuedAt>action)throw new RangeError('Forecast not issued');
        const column={target,issuedAt:issued.issuedAt,createdAt:action,version:this.learner.version,topologyVersion:this.topologyVersion,support:this.selection.support,policies:{},packets:{}};
        for(const key of keys){
          if(key==='causal')continue;
          column.policies[key]=freeze(key==='online'?this.learner.space.column(this.learner.z,target):(key==='scalar'?this.sparse:this.dense).column(target));
          column.packets[key]=Array.from({length:this.m},(_,r)=>{
            const messages=[];
            for(let j=0;j<this.n;j++)if(this.permissions[key][r][j]){
              const source=j+2,receiver=this.api.constants.inverterBuses[r],remote=source!==receiver;
              const message=freeze({source,forecast:finite(issued.forecast[j+1],'Admitted forecast'),target,issuedAt:issued.issuedAt,receivedAt:action});messages.push(message);
              actionLinks[key].set(source+','+receiver,{source,receiver,remote});this.traffic[key].forecastValues++;this.traffic[key][remote?'remoteForecastValues':'localForecastValues']++;
            }
            if(key!=='static'&&messages.filter(message=>message.source!==this.api.constants.inverterBuses[r]).length>this.api.constants.remoteBudget)throw new RangeError('Incoming prediction budget exceeded');
            return freeze(messages);
          });
        }
        this.columns.set(target,freeze(column));newColumns.push({target,issuedAt:issued.issuedAt,createdAt:action,version:column.version,topologyVersion:column.topologyVersion,firstAction:Math.max(0,target-this.depth+1),lastAction:target+this.depth});
      }
      // The initial preview is one bundle per admitted source/receiver edge,
      // containing depth values. Later bundles contain one newly issued value.
      const newMessages={};
      for(const key of keys){
        const links=[...actionLinks[key].values()],remote=links.filter(e=>e.remote).length;
        newMessages[key]={remote,local:links.length-remote,values:newColumns.length*links.length};
        this.traffic[key].forecastMessages+=links.length;this.traffic[key].remoteForecastMessages+=remote;this.traffic[key].localForecastMessages+=links.length-remote;
      }
      if(newColumns.length){
        this.learningTraffic.parameterBroadcastMessages+=this.m;
        this.learningTraffic.parameterScalars+=newColumns.reduce((sum,column)=>sum+Object.keys(this.columns.get(column.target).policies.online.L).length*this.selection.support.flat().filter(Boolean).length,0);
      }
      this.nextTarget=action+this.depth;for(const target of this.columns.keys())if(target<action-this.depth)this.columns.delete(target);
      this.lastAction=action;
      const incoming=new Set(this.selection.links.map(pair)),retiring=new Map();
      for(const column of this.columns.values()){
        const L=column.policies.online.L[action];if(!L)continue;
        for(let r=0;r<this.m;r++)for(const message of column.packets.online[r]){
          const edge={from:message.source,to:this.api.constants.inverterBuses[r]},j=message.source-2;
          if(edge.from!==edge.to&&!incoming.has(pair(edge))&&Math.abs(L[r][j])>1e-12)retiring.set(pair(edge),edge);
        }
      }
      this.pending={protocol,action,parameterAvailableAt:action,trainedThrough:this.learning.trainedThrough,parameterVersion:this.learner.version,
        topologyVersion:this.topologyVersion,learning:{...this.learning},incomingLinks:this.selection.links.map(e=>({...e})),
        retiringLinks:retiring.size,retiringLinkPairs:[...retiring.values()],newMessages,issuedColumns:newColumns,
        policies:{},traffic:JSON.parse(JSON.stringify(this.traffic)),learningTraffic:{...this.learningTraffic},
        responseFeasibility:this.learner.space.residual(this.learner.z)};
    }
    command(key,state){
      if(!keys.includes(key)||!this.pending)throw new Error('Begin the adaptive action before commands');
      if(!Array.isArray(state)||state.length!==this.n||state.some(v=>!Number.isFinite(v)))throw new RangeError('Invalid physical state');
      const feedback=mv(this.api.model.K,state),prediction=Array(this.m).fill(0),sourceContributions=zeros(this.m,this.n),currentGains=zeros(this.m,this.n),gainNorms=zeros(this.m,this.n);
      if(key!=='causal')for(const column of this.columns.values()){
        const L=column.policies[key].L[this.lastAction];if(!L)continue;
        for(let r=0;r<this.m;r++)for(const message of column.packets[key][r]){
          const j=message.source-2,value=L[r][j]*message.forecast;prediction[r]+=value;sourceContributions[r][j]+=value;gainNorms[r][j]+=L[r][j]**2;
          if(column.target===this.lastAction)currentGains[r][j]=L[r][j];
        }
      }
      const raw=feedback.map((v,r)=>v+prediction[r]);if(raw.some(v=>!Number.isFinite(v)))throw new RangeError('Nonfinite adaptive command');
      this.pending.policies[key]={feedback,prediction,raw,sourceContributions,currentGains,gainNorms:gainNorms.map(row=>row.map(Math.sqrt)),coefficients:null};return raw.slice();
    }
    finish(commands){
      for(const key of keys){
        if(!this.pending?.policies[key]||!Array.isArray(commands[key])||commands[key].length!==this.m||commands[key].some(v=>!Number.isFinite(v)))throw new Error('Missing executed adaptive policy');
        this.pending.policies[key].bounded=commands[key].slice();
      }
      this.receipt=freeze(this.pending);this.pending=null;return this.receipt;
    }
    diagnostics(){
      return {coefficients:null,reports:[],baselineScores:this.baselineScores,learnedScores:this.learnedScores,candidateScores:this.candidateScores,
        activeSupport:this.selection.support,selection:this.selection,fixedSelection:this.fixedSelection,learning:{...this.learning},
        supportEvents:this.supportEvents.slice(),supportHistory:this.supportHistory.slice(),retiringLinks:this.receipt?.retiringLinks??0,
        learningTraffic:{...this.learningTraffic},parameterVersion:this.learner.version};
    }
  }
  return {protocol,defaults,Controller,ResponseSpace,ResponseLearner,completedRow,objectiveGradient,
    math:{zeros,copy,mv,mm,transpose,zDistance}};
});
