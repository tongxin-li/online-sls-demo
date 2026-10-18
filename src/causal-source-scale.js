/* Causal source local scaling foundation for the candidate continuous protocol.
 * This module does not change the shipped engine or register a UI experiment.
 * It restricts the public mean loss correction objective to one scalar per
 * source. Receiver access and actual engine integration remain release gates. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CausalSourceScale=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=(x,name)=>{if(!Number.isFinite(x))throw new TypeError(name+' must be finite');return x;};
  const integer=(x,min,name)=>{if(!Number.isSafeInteger(x)||x<min)throw new RangeError(name+' must be an integer at least '+min);return x;};
  function fitSource(pairs,lambda){
    finite(lambda,'lambda');if(lambda<=0)throw new RangeError('lambda must be positive');
    if(!Array.isArray(pairs))throw new TypeError('Source pairs must be an array');
    if(!pairs.length)return Object.freeze({coefficient:1,count:0,rawRms:null,correctedRms:null,objective:0,rawObjective:0});
    let ff=0,fw=0;
    for(const pair of pairs){const f=finite(pair.forecast,'forecast'),w=finite(pair.forcing,'forcing');ff+=f*f;fw+=f*w;}
    const coefficient=(fw/pairs.length+lambda)/(ff/pairs.length+lambda);
    if(!Number.isFinite(ff)||!Number.isFinite(fw)||!Number.isFinite(coefficient))throw new RangeError('Source moments overflow');
    let raw=0,corrected=0;
    for(const {forecast,forcing} of pairs){raw+=(forecast-forcing)**2;corrected+=(coefficient*forecast-forcing)**2;}
    const objective=.5*(corrected/pairs.length+lambda*(coefficient-1)**2);
    if(!Number.isFinite(raw)||!Number.isFinite(corrected)||!Number.isFinite(objective))throw new RangeError('Source loss overflow');
    return Object.freeze({coefficient,count:pairs.length,rawRms:Math.sqrt(raw/pairs.length),
      correctedRms:Math.sqrt(corrected/pairs.length),objective,rawObjective:.5*raw/pairs.length});
  }
  class SourceScale{
    constructor({source,lambda,window=60,warmup=30,preview=5}={}){
      this.source=integer(source,2,'source');finite(lambda,'lambda');
      if(lambda<=0)throw new RangeError('lambda must be positive');
      this.lambda=lambda;this.window=integer(window,1,'window');this.warmup=integer(warmup,1,'warmup');
      this.preview=integer(preview,1,'preview');if(this.warmup>this.window)throw new RangeError('warmup exceeds window');
      this.pairs=[];this.count=0;this.updates=0;this.availableAt=0;this.trainedThrough=null;
      this.coefficient=1;this.parameterChange=0;this.fit=fitSource([],lambda);
    }
    observe(pair,now){
      integer(now,0,'now');
      const target=integer(pair.target,0,'target'),issuedAt=integer(pair.issuedAt,0,'issuedAt'),revealedAt=integer(pair.revealedAt,1,'revealedAt');
      if(target!==this.count)throw new RangeError('Source observations must arrive once in target order');
      if(issuedAt!==Math.max(0,target-this.preview+1))throw new RangeError('Forecast issue does not match sealed preview timing');
      if(revealedAt!==target+1||revealedAt>now||now<this.availableAt)throw new RangeError('Unrevealed or out of order source observation');
      const next=Object.freeze({target,issuedAt,revealedAt,forecast:finite(pair.forecast,'forecast'),forcing:finite(pair.forcing,'forcing')});
      const pairs=this.pairs.concat(next).slice(-this.window),count=this.count+1,ready=count>=this.warmup;
      const fit=ready?fitSource(pairs,this.lambda):this.fit,coefficient=ready?fit.coefficient:1;
      // All validation and the solve finish before any source state changes.
      this.pairs=pairs;this.count=count;this.availableAt=now;this.parameterChange=coefficient-this.coefficient;
      this.coefficient=coefficient;this.fit=fit;
      if(ready){this.updates++;this.trainedThrough=target;}
      return this.at(now);
    }
    at(action){
      integer(action,0,'action');if(action<this.availableAt)throw new RangeError('Requested action precedes available source data');
      return Object.freeze({source:this.source,coefficient:this.coefficient,totalPairs:this.count,windowCount:this.pairs.length,
        windowStart:this.pairs[0]?.target??null,windowEnd:this.pairs.at(-1)?.target??null,
        updates:this.updates,trainedThrough:this.trainedThrough,availableAt:this.availableAt,
        parameterChange:this.parameterChange,rawRms:this.fit.rawRms,correctedRms:this.fit.correctedRms});
    }
  }
  function receiverMessages({receiverBus,permission,remoteBudget,nodes,forecast,target,issuedAt,action,preview=5}){
    integer(action,0,'action');integer(target,0,'target');integer(issuedAt,0,'issuedAt');integer(preview,1,'preview');
    integer(remoteBudget,0,'remoteBudget');integer(receiverBus,2,'receiverBus');
    if(!Array.isArray(permission)||!permission.length||permission.some(v=>typeof v!=='boolean'))throw new TypeError('Boolean source permissions required');
    const n=permission.length,local=receiverBus-2;
    if(local>=n||!permission[local])throw new RangeError('Mandatory local source permission missing');
    if(permission.filter(Boolean).length-1>remoteBudget)throw new RangeError('Remote source budget exceeded');
    if(!Array.isArray(nodes)||nodes.length!==n||!Array.isArray(forecast)||forecast.length!==n)throw new RangeError('Source dimension mismatch');
    if(issuedAt!==Math.max(0,target-preview+1)||issuedAt>action||target>action+preview-1)throw new RangeError('Forecast is not causally available');
    const messages=[];
    for(let j=0;j<n;j++)if(permission[j]){
      // Excluded source nodes and raw forecasts are never accessed here.
      const report=nodes[j].at(action);if(report.source!==j+2)throw new RangeError('Source identity mismatch');
      integer(report.availableAt,0,'source available time');
      if(report.availableAt>action||(report.trainedThrough!==null&&(!Number.isSafeInteger(report.trainedThrough)||report.trainedThrough<0||report.trainedThrough>=action||report.trainedThrough+1>report.availableAt)))throw new RangeError('Future source parameter');
      messages.push(Object.freeze({source:j+2,forecast:finite(forecast[j],'admitted forecast'),
        coefficient:finite(report.coefficient,'source coefficient'),target,issuedAt,action,
        trainedThrough:report.trainedThrough,availableAt:report.availableAt,updates:report.updates}));
    }
    return Object.freeze(messages);
  }
  function prediction(gainRow,messages){
    if(!Array.isArray(gainRow)||!Array.isArray(messages))throw new TypeError('Gain row and messages required');
    const seen=new Set();let total=0;
    for(const message of messages){
      const column=integer(message.source,2,'source')-2;if(column>=gainRow.length||seen.has(column))throw new RangeError('Invalid or duplicate message source');
      seen.add(column);total+=finite(gainRow[column],'prediction gain')*finite(message.coefficient,'coefficient')*finite(message.forecast,'forecast');
    }
    if(!Number.isFinite(total))throw new RangeError('Prediction contribution overflow');return total;
  }
  function scaleColumn(column,coefficients){
    if(!Array.isArray(coefficients)||!coefficients.length||coefficients.some(v=>!Number.isFinite(v)))throw new TypeError('Finite source coefficients required');
    const scaled={...column};
    for(const group of ['X','U','L']){
      if(!column[group]||typeof column[group]!=='object')throw new TypeError('Response maps required');
      scaled[group]=Object.fromEntries(Object.entries(column[group]).map(([time,matrix])=>{
        if(!Array.isArray(matrix)||matrix.some(row=>!Array.isArray(row)||row.length!==coefficients.length))throw new RangeError('Response dimension mismatch');
        return [time,matrix.map(row=>row.map((v,j)=>{const value=finite(v,'response coefficient')*coefficients[j];if(!Number.isFinite(value))throw new RangeError('Scaled response overflow');return value;}))];
      }));
    }
    return scaled;
  }
  return {fitSource,SourceScale,receiverMessages,prediction,scaleColumn};
});
