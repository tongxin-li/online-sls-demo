'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Ledger}=require('./receiver-packet-ledger.js'),Demo=require('./simulation.js');
const config=()=>({receiverBus:5,sourceBuses:[2,3,4,5,6,7,8],support:[2,5,7],remoteBudget:2,preview:5});
const ledger=()=>new Ledger(config());
const payload=request=>({source:request.source,target:request.target,issuedAt:request.issuedAt,
 forecast:request.source/1000+request.target/1e6,coefficient:.75,trainedThrough:null,availableAt:0});
const advance=(l,t)=>l.advance(t,payload);
test('packet configuration preserves mandatory local and exact remote permissions',()=>{
 for(const patch of [{support:[2,3,7]},{support:[2,5,5]},{support:[2,5,9]},{remoteBudget:1},
  {sourceBuses:[2,3,4,5,6,7,7]},{preview:0},{receiverBus:1}]){
  assert.throws(()=>new Ledger({...config(),...patch}));
 }
 const c=config(),l=new Ledger(c);c.support[0]=8;c.sourceBuses.length=0;
 assert.deepEqual(l.config.support,[2,5,7]);assert.ok(Object.isFrozen(l.config.support));
});
test('explicit request transport never reads excluded forecasts or quality and forcing labels',()=>{
 const l=ledger(),seen=[];
 assert.throws(()=>l.request({source:3,target:4,reason:'control'}),/Excluded/);
 l.request({source:5,target:4,reason:'control'});
 const packets=new Proxy({5:.01},{get(target,key){seen.push(key);if(key!=='5')throw Error('Excluded source access');return target[key];}});
 const receipt=l.advance(0,r=>Object.defineProperties({...payload(r),forecast:packets[r.source]},{
  quality:{get(){throw Error('Quality accessed');}},forcing:{get(){throw Error('Truth accessed');}}}));
 assert.deepEqual(seen,['5']);assert.equal(receipt[0].status,'accepted');
 assert.throws(()=>l.read({source:3,target:4,purpose:'control'}),/Excluded/);
});
test('probe latency uses actual arrivals and requests alone are not payload traffic',()=>{
 const l=ledger();advance(l,60);l.request({source:3,target:59,reason:'probe'});
 assert.equal(l.snapshot().traffic.total.totalScalars,0);
 assert.deepEqual(advance(l,60),[]);assert.throws(()=>l.read({source:3,target:59,purpose:'evaluation',asOfAction:59}),/not available/);
 assert.equal(advance(l,61)[0].deliveredAt,61);
 assert.equal(l.read({source:3,target:59,purpose:'evaluation',asOfAction:59}).issuedAt,55);
 assert.equal(l.snapshot().traffic.byReason.probe.totalScalars,2);
});
test('old missing context cannot use ordinary zero latency control delivery',()=>{
 const l=ledger();advance(l,60);
 assert.throws(()=>l.request({source:2,target:55,reason:'control'}),/Historical/);
 assert.throws(()=>l.request({source:2,target:55,reason:'transition',delay:0}),/delay/);
 l.request({source:2,target:55,reason:'transition',delay:2});
 assert.deepEqual(advance(l,61),[]);assert.equal(advance(l,62)[0].status,'accepted');
});
test('unissued forecasts and unrevealed evaluation actions cannot be used',()=>{
 const l=ledger();
 assert.throws(()=>l.request({source:5,target:5,reason:'control'}),/not issued/);
 assert.throws(()=>l.request({source:3,target:5,reason:'probe'}),/not issued/);
 assert.throws(()=>l.request({source:3,target:0,reason:'probe',delay:0}),/delay/);
 assert.throws(()=>l.request({source:5,target:0,reason:'unknown'}),/reason/);
 assert.equal(l.snapshot().requests.length,0);
 l.request({source:5,target:4,reason:'control'});advance(l,0);
 assert.throws(()=>l.read({source:5,target:4,purpose:'evaluation',asOfAction:0}),/not revealed/);
 assert.throws(()=>advance(l,-1));advance(l,10);assert.throws(()=>advance(l,9),/backward/);
});

test('issued preview probes are legal while future replay issuance and current correction leakage are rejected',()=>{
 const l=ledger();advance(l,60);l.request({source:3,target:64,reason:'probe'});advance(l,61);
 assert.throws(()=>l.read({source:3,target:64,purpose:'evaluation',asOfAction:59}),/issued after/);
 const p=l.read({source:3,target:64,purpose:'evaluation',asOfAction:60});
 assert.equal(p.issuedAt,60);assert.equal(p.target,64);
 assert.equal(Object.hasOwn(p,'coefficient'),false);assert.equal(Object.hasOwn(p,'trainedThrough'),false);
 assert.throws(()=>l.read({source:3,target:64,purpose:'evaluation'}),/replayed action/);
});

test('independent scalar arithmetic separates control probe transition and local traffic',()=>{
 const l=ledger();
 l.request({source:5,target:0,reason:'control'});l.request({source:2,target:0,reason:'control'});advance(l,0);
 advance(l,60);l.request({source:3,target:59,reason:'probe'});l.request({source:5,target:58,reason:'transition'});
 advance(l,61);
 const traffic=l.snapshot().traffic;
 assert.deepEqual(traffic.total,{packets:4,forecastScalars:4,correctionScalars:4,totalScalars:8,localScalars:4,remoteScalars:4});
 assert.deepEqual(Object.values(traffic.byReason).map(t=>t.totalScalars),[4,2,2]);
});
test('paid cached probes remain unavailable to the fixed support control path',()=>{
 const l=ledger();advance(l,60);
 const request=l.request({source:3,target:59,reason:'probe'});advance(l,61);
 assert.equal(l.request({source:3,target:59,reason:'probe'}).id,request.id);
 assert.equal(l.request({source:3,target:59,reason:'probe'}).cached,true);
 assert.equal(l.read({source:3,target:59,purpose:'evaluation',asOfAction:59}).source,3);
 assert.throws(()=>l.read({source:3,target:59,purpose:'control'}),/Excluded/);
 assert.equal(l.snapshot().traffic.total.totalScalars,2);
 assert.deepEqual(l.config.support,[2,5,7]);assert.equal(l.activateSupport,undefined);
});
test('receipts copy and freeze forecasts and correction versions after sender mutation',()=>{
 const l=ledger();l.request({source:5,target:4,reason:'control'});
 const sent=payload({source:5,target:4,issuedAt:0});l.advance(0,()=>sent);
 sent.forecast=999;sent.coefficient=999;
 const p=l.read({source:5,target:4,purpose:'control'});
 assert.ok(Math.abs(p.forecast-.005004)<1e-15);assert.equal(p.coefficient,.75);
 assert.throws(()=>{p.forecast=7;},TypeError);
 assert.throws(()=>{l.snapshot().deliveries.push({});},TypeError);
});
test('invalid numeric identity and future metadata payloads are charged then rejected',()=>{
 const bad=[{forecast:NaN},{coefficient:Infinity},{availableAt:1},{trainedThrough:0,availableAt:0},
  {source:7},{target:3},{issuedAt:1},{trainedThrough:-1}];
 for(const change of bad){
  const l=ledger();l.request({source:5,target:4,reason:'control'});l.request({source:2,target:4,reason:'control'});
  const receipts=l.advance(0,r=>r.source===5?{...payload(r),...change}:payload(r));
  assert.deepEqual(receipts.map(r=>r.status),['rejected','accepted']);
  assert.equal(l.snapshot().traffic.total.totalScalars,4);
  assert.throws(()=>l.read({source:5,target:4,purpose:'control'}),/not available/);
  assert.equal(l.read({source:2,target:4,purpose:'control'}).source,2);
 }
});
test('transport failures have no invented delivered scalars and remain in the audit',()=>{
 const l=ledger();l.request({source:5,target:4,reason:'control'});
 assert.equal(l.advance(0,()=>{throw Error('transport offline');})[0].status,'transport_failed');
 assert.equal(l.snapshot().traffic.total.totalScalars,0);
 assert.equal(l.snapshot().deliveries[0].error,'transport offline');
 l.request({source:5,target:4,reason:'control'});advance(l,0);
 assert.equal(l.snapshot().deliveries.length,2);assert.equal(l.snapshot().traffic.total.totalScalars,2);
});
test('duplicate pending and admitted requests neither reread nor double charge',()=>{
 const l=ledger();const a=l.request({source:5,target:4,reason:'control'});
 assert.equal(l.request({source:5,target:4,reason:'control'}).id,a.id);
 let reads=0;const reader=r=>{reads++;return payload(r);};
 l.advance(0,reader);l.advance(0,reader);
 assert.equal(l.request({source:5,target:4,reason:'control'}).cached,true);
 assert.equal(reads,1);assert.equal(l.snapshot().requests.length,1);
 assert.equal(l.snapshot().traffic.total.totalScalars,2);
});
test('delivery reader cannot add requests or reenter a delivery batch',()=>{
 const l=ledger();l.request({source:5,target:4,reason:'control'});
 l.advance(0,r=>{
  assert.throws(()=>l.request({source:2,target:4,reason:'control'}),/mutate/);
  assert.throws(()=>l.advance(1,payload),/Reentrant/);return payload(r);
 });
 assert.equal(l.action,0);assert.equal(l.snapshot().traffic.total.totalScalars,2);
});
for(const network of Demo.networks)test(network.id+' actual inverter placement and budget give independent packet counts',()=>{
 const api=Demo.forNetwork(network.id),c=api.constants,sources=Array.from({length:c.N-1},(_,j)=>j+2);let scalars=0;
 for(const receiverBus of c.inverterBuses){
  const support=[receiverBus,...sources.filter(s=>s!==receiverBus).slice(0,c.remoteBudget)];
  const l=new Ledger({receiverBus,sourceBuses:sources,support,remoteBudget:c.remoteBudget,preview:c.preview});
  for(const source of support)for(let target=0;target<c.preview;target++)l.request({source,target,reason:'control'});
  advance(l,0);const traffic=l.snapshot().traffic.total;
  assert.equal(traffic.localScalars,2*c.preview);assert.equal(traffic.remoteScalars,2*c.preview*c.remoteBudget);
  scalars+=traffic.totalScalars;
 }
 assert.equal(scalars,2*c.preview*c.M*(c.remoteBudget+1));
});
test('6001 logical actions retain deterministic paid receipts without full history scans for delivery',()=>{
 function run(){
  const l=ledger();let probes=0,transitions=0;
  for(let action=0;action<6001;action++){
   advance(l,action);
   for(const source of [2,5,7])for(let target=action===0?0:action+4;target<=action+4;target++)l.request({source,target,reason:'control'});
   if(action>0&&action%60===0){l.request({source:3,target:action-1,reason:'probe'});probes++;}
   if(action>0&&action%120===0){l.request({source:4,target:action-2,reason:'transition'});transitions++;}
   advance(l,action);
  }
  advance(l,6002);const s=l.snapshot(),control=3*(6001+4);
  assert.equal(s.requests.length,control+probes+transitions);assert.equal(s.deliveries.length,s.requests.length);
  assert.equal(s.traffic.byReason.control.totalScalars,2*control);
  assert.equal(s.traffic.byReason.probe.totalScalars,2*probes);
  assert.equal(s.traffic.byReason.transition.totalScalars,2*transitions);
  assert.equal(s.traffic.total.localScalars,2*(6001+4));
  assert.equal(s.traffic.total.totalScalars,2*(control+probes+transitions));
  assert.ok(s.deliveries.every(r=>r.status==='accepted'));
  return s;
 }
 assert.deepEqual(run(),run());
});
test('foundation import does not change the production protocol or physical execution',()=>{
 const opts={networkId:'toy8',protocol:'continuous-phi-v1',experiment:'communication',powerScenario:'forecasted-demand',seed:21};
 const a=new (Demo.forNetwork('toy8').Simulation)(opts),b=new (Demo.forNetwork('toy8').Simulation)(opts);
 const l=ledger();l.request({source:5,target:4,reason:'control'});advance(l,0);
 for(let t=0;t<40;t++){a.step();b.step();}
 assert.deepEqual(a.snapshot(),b.snapshot());assert.equal(a.snapshot().protocol,'continuous-phi-v1');
 const fs=require('node:fs'),path=require('node:path');
 const build=fs.readFileSync(path.join(__dirname,'..','build.py'),'utf8');
 assert.equal(build.includes('receiver-packet-ledger.js'),false,'No unaccepted protocol enters the shipped bundle');
});
