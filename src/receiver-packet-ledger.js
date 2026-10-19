/* Experimental support-learning foundation, deliberately absent from build.py.
 * No selector, support activation or controller replacement is implemented here.
 * Receiver inputs are explicit paid requests, never the simulator forecast array. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.ReceiverPacketLedger=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const integer=(x,min,name)=>{if(!Number.isSafeInteger(x)||x<min)throw new RangeError(name+' is invalid');return x;};
 const finite=(x,name)=>{if(!Number.isFinite(x))throw new TypeError(name+' must be finite');return x;};
 const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
 const reasons=['control','probe','transition'];
 const blank=()=>({packets:0,forecastScalars:0,correctionScalars:0,totalScalars:0,localScalars:0,remoteScalars:0});
 class Ledger{
  #config;#clock=0;#busy=false;#requests=[];#deliveries=[];#cache=new Map();#pending=new Map();
  #traffic=Object.fromEntries(reasons.map(reason=>[reason,blank()]));
  constructor({receiverBus,sourceBuses,support,remoteBudget,preview=5}={}){
   integer(receiverBus,2,'receiver');integer(remoteBudget,0,'remote budget');integer(preview,1,'preview');
   const list=(xs,name)=>{if(!Array.isArray(xs)||!xs.length||xs.some(x=>!Number.isSafeInteger(x)||x<2)||new Set(xs).size!==xs.length)throw new RangeError(name+' must contain distinct source buses');return xs.slice();};
   const sources=list(sourceBuses,'sources'),allowed=list(support,'support');
   if(!sources.includes(receiverBus)||!allowed.includes(receiverBus))throw new RangeError('Mandatory local source missing');
   if(allowed.some(source=>!sources.includes(source)))throw new RangeError('Unknown support source');
   if(allowed.length-1!==remoteBudget)throw new RangeError('Exact remote budget required');
   this.#config=freeze({receiverBus,sourceBuses:sources,support:allowed,remoteBudget,preview});
  }
  get action(){return this.#clock;}
  get config(){return this.#config;}
  #key(source,target){return source+'/'+target;}
  #source(source){integer(source,2,'source');if(!this.#config.sourceBuses.includes(source))throw new RangeError('Unknown source');}
  request({source,target,reason,delay=reason==='control'?0:1}={}){
   if(this.#busy)throw new Error('Delivery reader cannot mutate the ledger');
   this.#source(source);integer(target,0,'target');integer(delay,0,'delay');
   if(!reasons.includes(reason))throw new RangeError('Unknown request reason');
   const {preview,support}=this.#config,now=this.#clock,issuedAt=Math.max(0,target-preview+1);
   if(issuedAt>now)throw new RangeError('Forecast not issued');
   if(reason==='control'){
    if(!support.includes(source))throw new RangeError('Excluded control source');
    if(delay!==0)throw new RangeError('Ordinary control delivery uses the existing zero delay convention');
    if(!(now===0&&target<preview)&&target!==now+preview-1)throw new RangeError('Historical context requires transition retrieval');
   }else{
    if(delay<1)throw new RangeError('Probe and transition require at least one sample delay');
    if(reason==='probe'&&target>=now)throw new RangeError('Probe target is not revealed');
   }
   const arrivesAt=integer(now+delay,0,'arrival'),key=this.#key(source,target);
   if(this.#cache.has(key))return freeze({id:this.#cache.get(key).requestId,cached:true});
   if(this.#pending.has(key))return freeze({id:this.#pending.get(key).id,cached:false,pending:true});
   const request=freeze({id:this.#requests.length,receiver:this.#config.receiverBus,source,target,issuedAt,requestedAt:now,arrivesAt,reason});
   this.#requests.push(request);this.#pending.set(key,request);return freeze({id:request.id,cached:false,pending:true});
  }
  advance(action,readRequestedPacket){
   if(this.#busy)throw new Error('Reentrant delivery is forbidden');
   integer(action,0,'action');if(action<this.#clock)throw new RangeError('Clock cannot move backward');
   if(typeof readRequestedPacket!=='function')throw new TypeError('Explicit packet reader required');
   this.#clock=action;const receipts=[];this.#busy=true;
   try{for(const request of Array.from(this.#pending.values())){
    const key=this.#key(request.source,request.target);
    if(this.#pending.get(key)!==request||request.arrivesAt>action)continue;
    let payload,packet,error=null,status='accepted',transmitted=false;
    try{payload=readRequestedPacket(request);transmitted=true;}catch(failure){status='transport_failed';error=String(failure?.message||failure);}
    if(transmitted){
     // Charge every arrived packet before admissibility checks, including a
     // rejected numeric payload. A request alone is never delivered traffic.
     const traffic=this.#traffic[request.reason],remote=request.source!==request.receiver;
     traffic.packets++;traffic.forecastScalars++;traffic.correctionScalars++;traffic.totalScalars+=2;
     traffic[remote?'remoteScalars':'localScalars']+=2;
     try{
      if(payload.source!==request.source||payload.target!==request.target||payload.issuedAt!==request.issuedAt)throw new RangeError('Issued packet identity mismatch');
      const forecast=finite(payload.forecast,'forecast'),coefficient=finite(payload.coefficient,'coefficient');
      const availableAt=integer(payload.availableAt,0,'parameter availability'),trainedThrough=payload.trainedThrough;
      if(availableAt>action||(trainedThrough!==null&&(!Number.isSafeInteger(trainedThrough)||trainedThrough<0||trainedThrough>=action||trainedThrough+1>availableAt)))throw new RangeError('Future correction metadata');
      packet=freeze({...request,requestId:request.id,deliveredAt:action,forecast,coefficient,availableAt,trainedThrough});
      this.#cache.set(key,packet);
     }catch(failure){status='rejected';error=String(failure?.message||failure);}
    }
    this.#pending.delete(key);
    const receipt=freeze({requestId:request.id,source:request.source,target:request.target,reason:request.reason,
     requestedAt:request.requestedAt,arrivesAt:request.arrivesAt,deliveredAt:action,status,transmitted,
     forecastScalars:transmitted?1:0,correctionScalars:transmitted?1:0,error});
    this.#deliveries.push(receipt);receipts.push(receipt);
   }}finally{this.#busy=false;}
   return freeze(receipts);
  }
  read({source,target,purpose}={}){
   this.#source(source);integer(target,0,'target');
   if(!['control','evaluation'].includes(purpose))throw new RangeError('Explicit read purpose required');
   if(purpose==='control'&&!this.#config.support.includes(source))throw new RangeError('Excluded control source');
   const packet=this.#cache.get(this.#key(source,target));
   if(!packet||packet.deliveredAt>this.#clock)throw new RangeError('Paid packet not available');
   if(purpose==='evaluation'&&target>=this.#clock)throw new RangeError('Evaluation outcome is not revealed');
   return packet;
  }
  snapshot(){
   const byReason=Object.fromEntries(reasons.map(reason=>[reason,{...this.#traffic[reason]}]));
   const total=blank();for(const traffic of Object.values(byReason))for(const key of Object.keys(total))total[key]+=traffic[key];
   return freeze({version:'receiver-packet-ledger-foundation-v1',action:this.#clock,config:this.#config,
    requests:this.#requests.slice(),deliveries:this.#deliveries.slice(),pending:Array.from(this.#pending.values()),
    packets:Array.from(this.#cache.values()),traffic:{byReason,total}});
  }
 }
 return {Ledger};
});
