'use strict';
// Fresh public v2 controls, measured support and immutable executed receipts.
// Legacy v13 and v14 replay are checked independently by the archived suites.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const keys=['online','scalar','static','causal'];
async function main(){
 const root=path.resolve(__dirname,'..'),output=path.join(process.env.DEMO_SMOKE_OUTPUT||path.join(root,'browser-results'),'adaptive');
 await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost'),file=path.resolve(root,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
   res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});res.end(await fs.readFile(file));
  }catch(_){res.writeHead(404).end();}
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address='http://127.0.0.1:'+server.address().port,errors=[],results=[];let browser;
 const read=page=>page.evaluate(()=>{
  const d=document.querySelector('#power-response-demo').powerDemo,s=d.getSnapshot();
  return {network:s.networkId,protocol:s.protocol,phase:s.phase,t:s.t,samples:s.sampleCount,history:s.history.length,
   costs:s.cumulative,states:s.states,commandQ:s.commandQ,lastExecution:s.lastExecution,adaptation:s.adaptation,
   learning:s.learning,options:s.initialOptions,attackProfile:s.attackProfile,links:s.recommendations,deployedSupport:s.deployedSupport,faults:s.faults,
   ui:d.getState(),evidence:d.getLinkEvidence(),gain:d.getResponseHistory()};
 });
 const click=async(page,selector,mobile)=>{const element=page.locator(selector);if(mobile)await element.tap();else await element.click();};
 const setting=async(page,id,value)=>{const box=page.locator('#pr-adaptation'),open=await box.getAttribute('open')!==null;
  if(!open)await box.locator('summary').first().click();await page.locator('#pr-'+id).selectOption(value);
  if(!open)await box.locator('summary').first().click();};
 const toggleRemoteSource=async(page,source,mobile)=>{
  await click(page,'#pr-matrix .matrix-cell[data-receiver="7"][data-source="'+source+'"]',mobile);
  await click(page,'#pr-source-fault',mobile);
  await click(page,'#pr-matrix .matrix-cell[data-receiver="7"][data-source="7"]',mobile);
 };
 const pause=async(page,mobile)=>{if((await read(page)).ui.playing)await click(page,'#pr-run',mobile);};
 const until=(page,t)=>page.waitForFunction(t=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=t,t,{timeout:180000,polling:100});
 const updateCount=s=>s.adaptation?.updateCount??s.adaptation?.updates??s.learning.updates;
 const near=(a,b,description)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-10,description+' '+a+' versus '+b);
 async function inspect(page,reason){
  const evidence=await page.evaluate(()=>{
   const d=document.querySelector('#power-response-demo').powerDemo,s=d.getRenderedSnapshot(),receivers=window.PowerDemo.forNetwork(s.networkId).constants.inverterBuses;
   const allowed=new Set(s.recommendations.map(e=>e.to+','+e.from));
   return {protocol:s.protocol,t:s.t,rows:receivers.length,sources:s.voltage.length-1,
    cells:[...document.querySelectorAll('#pr-matrix .matrix-cell')].map(node=>{
     const r=Number(node.dataset.receiver),j=Number(node.dataset.source),index=receivers.indexOf(r);
     return {source:j,receiver:r,connected:node.dataset.connected==='true',expected:r===j||allowed.has(r+','+j),
      actual:Number(node.dataset.weightChange),energy:s.predictionDiagnostics.receiverNormalizedChange[index][j-2]};
    }),receipt:s.lastExecution,source:d.getState().inspectedSource,receiver:d.getState().selectedBus,
    detail:d.getLinkEvidence(),gain:d.getResponseHistory(),receivers,
    labels:[document.querySelector('#pr-phase-note').textContent,document.querySelector('#pr-mode-note').textContent,document.querySelector('#pr-matrix-changes').textContent]};
  });
  assert.equal(evidence.protocol,'adaptive-phi-v2');assert.equal(evidence.cells.length,evidence.rows*evidence.sources);
  for(const cell of evidence.cells){assert.equal(cell.connected,cell.expected,'Actual incoming support '+reason);near(cell.actual,cell.energy,'Actual learned energy '+reason);}
  assert.doesNotMatch(evidence.labels.join(' '),/support fixed|fixed support|source corrections|one scalar per/i);
  if(evidence.receipt){
   const r=evidence.receivers.indexOf(evidence.receiver),j=evidence.source-2,p=evidence.receipt.policies.online;
   const row=evidence.detail.rows.find(row=>row.key==='online');
   near(row.currentGain,p.currentGains[r][j],'Inspector signed gain comes from executed receipt');
   near(row.gainNorm,p.gainNorms[r][j],'Inspector temporal norm comes from executed receipt');
   near(row.sourceKvar,1000*p.sourceContributions[r][j],'Inspector source command comes from executed receipt');
   assert.equal(row.score,null,'No fictitious source correction coefficient');
   assert.ok(evidence.gain.points.length>0);near(evidence.gain.points.at(-1).gain,p.currentGains[r][j],'Visible trace uses executed current gain');
   assert.equal(evidence.gain.points.at(-1).correction,null,'Full response is not presented as a source scalar');
   assert.ok(evidence.receipt.trainedThrough===null||evidence.receipt.trainedThrough<evidence.receipt.action,'No current truth enters the executed response');
   for(const key of keys){const policy=evidence.receipt.policies[key];
    for(let receiver=0;receiver<policy.raw.length;receiver++){
     near(policy.raw[receiver],policy.feedback[receiver]+policy.prediction[receiver],'Command decomposes before limiting');
     near(policy.prediction[receiver],policy.sourceContributions[receiver].reduce((a,b)=>a+b,0),'Every source contribution retained');
     near(policy.bounded[receiver],Math.max(-.07,Math.min(.07,policy.raw[receiver])),'Actual actuator bound');
    }
   }
  }
 }
 try{
  browser=await chromium.launch({headless:true,...(process.env.DEMO_BROWSER_CHANNEL?{channel:process.env.DEMO_BROWSER_CHANNEL}:{})});
  for(const mobile of [false,true])for(const network of ['toy8','feeder24','feeder47']){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
   const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
   await page.goto(address,{waitUntil:'networkidle'});
   assert.equal((await read(page)).protocol,'adaptive-phi-v2','Fresh default enters joint response protocol');
   if(network!=='feeder24')await page.locator('#pr-network-scenario').selectOption(network);
   const start=await read(page);assert.equal(start.network,network);assert.equal(start.t,0);assert.equal(start.ui.playing,false);
   assert.ok(Object.values(start.costs).every(value=>value===0));
   // manual-v1 deliberately starts at household bus 6, not an inverter.
   // Verify that default, then choose a real local receiver through the matrix.
   assert.equal(start.options.powerScenario,'interactive');assert.equal(start.attackProfile,'manual-v1');
   assert.equal(start.ui.selectedBus,6);assert.equal(start.ui.inspectedSource,null);
   assert.deepEqual(start.faults,[],'Fresh manual sources begin quiet');
   assert.equal(start.ui.intervention,'power','Manual power is the fresh interaction');
   await click(page,'#pr-matrix .matrix-cell[data-receiver="7"][data-source="7"]',mobile);
   const inspected=await read(page);
   assert.equal(inspected.ui.selectedBus,7);assert.equal(inspected.ui.inspectedSource,7);
   for(const field of ['t','costs','states','commandQ','lastExecution','links','faults'])
    assert.deepEqual(inspected[field],start[field],'Choosing a receiver is read only '+field);
   await setting(page,'speed','32');
   await inspect(page,'before playback');
   await click(page,'#pr-run',mobile);await until(page,75);await pause(page,mobile);
   const learned=await read(page);assert.ok(updateCount(learned)>0,'Actual response updates execute');await inspect(page,'after observed warmup');
   await click(page,'#pr-run',mobile);
   for(let i=0;i<4;i++){await click(page,'#pr-cost-gap',mobile);await click(page,'#pr-cost-total',mobile);}
   assert.equal((await read(page)).ui.playing,true,'Cost switching preserves playback');
   const beforeAttack=await read(page);
   // Predefined causal test rule: challenge the lowest numbered CURRENT remote
   // incoming source at inverter 7. A mandatory local source alone need not
   // justify a topology change. Do not select a source by a successful outcome.
   const remoteSource=beforeAttack.links.filter(e=>e.to===7&&e.from!==7).sort((a,b)=>a.from-b.from)[0]?.from;
   assert.ok(Number.isInteger(remoteSource),'A permitted remote source is available under the original budget');
   await page.locator('#pr-intervention').selectOption('forecast');
   await click(page,'#pr-pulse',mobile);assert.ok((await read(page)).faults.includes(7));
   await toggleRemoteSource(page,remoteSource,mobile);
   assert.ok((await read(page)).faults.includes(remoteSource),'Explicit user corruption reaches an admitted remote source');
   await until(page,beforeAttack.t+90);await pause(page,mobile);
   const corrupted=await read(page);await inspect(page,'after source corruption');
   assert.ok(updateCount(corrupted)>updateCount(learned),'Learning continues after corruption');
   assert.notDeepEqual(corrupted.lastExecution.policies.online.currentGains,learned.lastExecution.policies.online.currentGains,'Executed response changes after observations');
   await click(page,'#pr-pulse',mobile);assert.equal((await read(page)).faults.includes(7),false);
   await toggleRemoteSource(page,remoteSource,mobile);
   assert.equal((await read(page)).faults.includes(remoteSource),false,'The same remote source is explicitly repaired');
   if(!(await read(page)).ui.playing)await click(page,'#pr-run',mobile);await until(page,corrupted.t+90);await pause(page,mobile);
   const repaired=await read(page);await inspect(page,'after source repair');
   assert.ok(updateCount(repaired)>updateCount(corrupted),'Learning continues after repair');
   assert.notDeepEqual(repaired.lastExecution.policies.online.currentGains,corrupted.lastExecution.policies.online.currentGains,'Executed response changes after repaired observations');
   await page.locator('#pr-intervention').selectOption('power');
   await click(page,'#pr-pulse',mobile);const attack=await read(page);assert.ok(attack.ui.activeAttackBuses.includes(7));
   await until(page,attack.t+6);await click(page,'#pr-pulse',mobile);
   assert.equal((await read(page)).ui.activeAttackBuses.includes(7),false,'Repeated click stops only this bus');
   await click(page,'#pr-pulse',mobile);const again=await read(page);await until(page,again.t+6);
   await click(page,'#pr-stop-attacks',mobile);assert.deepEqual((await read(page)).ui.activeAttackBuses,[]);
   await until(page,Math.max(365,(await read(page)).t+8));await pause(page,mobile);
   const final=await read(page);await inspect(page,'after physical attacks and old boundaries');
   assert.equal(final.phase,'ongoing');assert.equal(final.history,final.t);assert.equal(final.samples,final.t);
   for(const key of keys){assert.ok(final.costs[key]>=repaired.costs[key]);assert.ok(final.commandQ[key].every(value=>Math.abs(value)<=70+1e-8));}
   assert.equal(await page.locator('#pr-cost-detail tr').count(),4);assert.equal(await page.locator('#pr-cost path.data-series').count(),4);
   assert.ok(final.ui.topology.events.length>0,'Explicit local and admitted remote corruption produce measured support changes');
   const actual=final.ui.topology.current.map(e=>e.to+','+e.from).sort(),expected=final.links.map(e=>e.to+','+e.from).sort();
   assert.deepEqual(actual,expected,'Topology history ends at actual incoming support');
   for(const event of final.ui.topology.events){assert.ok(event.added.length+event.removed.length>0);assert.ok(event.t<=final.t);}
   const saved=await page.evaluate(()=>window.openai.widgetState);assert.equal(saved.privateContent.version,15);
   await page.reload({waitUntil:'networkidle'});const replay=await read(page);
   for(const field of ['t','costs','states','commandQ','lastExecution','links'])assert.deepEqual(replay[field],final[field],'Exact v15 replay '+field);
   assert.deepEqual(replay.ui.topology,final.ui.topology,'Restored real topology history');
   assert.equal(replay.ui.playing,false);await inspect(page,'restored exact trial');
   await page.screenshot({path:path.join(output,network+(mobile?'-phone':'-desktop')+'.png'),fullPage:true});
   const beforeRestart=await read(page);await click(page,'#pr-restart',mobile);const restarted=await read(page);
   assert.equal(restarted.protocol,'adaptive-phi-v2');assert.equal(restarted.t,0);assert.equal(restarted.ui.playing,false);
   assert.ok(Object.values(restarted.costs).every(value=>value===0));assert.deepEqual(restarted.ui.topology.events,[]);
   const result={network,mobile,remoteSource,actions:final.t,responseUpdates:updateCount(final),topologyUpdates:final.ui.topology.events.length,costs:final.costs,
    checkpoints:[learned,corrupted,repaired].map(s=>({t:s.t,updates:updateCount(s),receiptAction:s.lastExecution.action,trainedThrough:s.lastExecution.trainedThrough})),
    exactReplay:true,restart:true,priorActions:beforeRestart.t,passed:true};
   results.push(result);console.log('ADAPTIVE_BROWSER '+JSON.stringify(result));await context.close();
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({passed:true,results,errors},null,2));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
