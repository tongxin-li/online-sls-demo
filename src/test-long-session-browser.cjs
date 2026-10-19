'use strict';
// Explicit long record fixtures exercise production hydration and resumed Step.
// They are not native playback throughput or fresh default acceptance trials.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const plan=require('../refinement/long-session-restoration-plan.json');
async function main(){
 const root=path.resolve(__dirname,'..'),output=process.env.DEMO_SMOKE_OUTPUT||path.join(root,'browser-results','long-session');
 await fs.mkdir(output,{recursive:true});const results=[],errors=[],fixtures=new Map();let browser;
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(root,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});
  res.end(await fs.readFile(file));
 }catch(_){res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true});
  for(const mobile of [false,true])for(const networkId of plan.networks){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
   await context.addInitScript(()=>{
    window.__longSessionFingerprint=async s=>{
     const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
     const keys=['networkId','protocol','t','phase','mode','initialOptions','states','cumulative','commandQ','lastExecution','sampleCount','learning','deployedSupport','traffic','faults','pendingPulses','eventLog','lastSample','sourceReports','predictionDiagnostics'];
     const chunks=[];let historyBytes=0;
     for(let i=0;i<s.history.length;i+=64){
      const part=s.history.slice(i,i+64),text=JSON.stringify(part);historyBytes+=new TextEncoder().encode(text).length;
      chunks.push(await hash(part));
     }
     return {physical:await hash(keys.map(key=>[key,s[key]])),history:await hash(chunks),entries:s.history.length,chunks:chunks.length,historyBytes};
    };
   });
   const page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',error=>errors.push({networkId,mobile,message:error.message}));
   await page.goto(address,{waitUntil:'networkidle'});
   if(!fixtures.has(networkId)){
    const generatedAt=Date.now();
    const fixture=await page.evaluate(async({networkId,plan})=>{
     const api=window.PowerDemo.forNetwork(networkId),sim=new api.Simulation({protocol:plan.protocol,networkId,experiment:'communication',powerScenario:plan.powerScenario,beta:plan.beta,preset:'mixed',seed:plan.seed});
     const first=api.constants.inverterBuses[0],last=api.constants.N;
     for(let action=0;action<plan.steps;action++){
      if(plan.faultSwitches.includes(action))sim.toggleFault(first);
      if(plan.pulseActions.includes(action))sim.queuePulse(first,50);
      if(plan.heldRanges.some(([start,end])=>action>=start&&action<=end)){
       sim.queuePulse(first,100,'held-target-v1');sim.queuePulse(last,100,'held-target-v1');
      }
      sim.step();if(action%100===0)await new Promise(resolve=>setTimeout(resolve,0));
     }
     const record=sim.recordContinuous(),before=await window.__longSessionFingerprint(sim.snapshot());
     sim.step();const next=await window.__longSessionFingerprint(sim.snapshot());
     return {saved:{privateContent:{version:14,continuousRecord:record,networkId,phase:'ongoing',t:record.steps,
      initialOptions:record.options,events:record.events,selectedBus:7,inspectedSource:7,speed:'32',view:'cost',costMetric:'total',matrixView:'change',
      intervention:'forecast',attackMode:'continuous',pulseStrength:'100',preset:'mixed',automaticComparison:true}},before,next};
    },{networkId,plan});
    fixture.generationMs=Date.now()-generatedAt;fixtures.set(networkId,fixture);
    await fs.writeFile(path.join(output,networkId+'-fixture.json'),JSON.stringify(fixture,null,2));
   }
   const fixture=fixtures.get(networkId),savedBytes=Buffer.byteLength(JSON.stringify(fixture.saved));
   await page.evaluate(saved=>localStorage.setItem('online-sls-demo-v1',JSON.stringify(saved)),fixture.saved);
   const restoreStarted=Date.now();await page.reload({waitUntil:'networkidle',timeout:120000});
   const restored=await page.evaluate(async()=>{
    const d=document.querySelector('#power-response-demo').powerDemo,s=d.getSnapshot(),reading=d.getResponseHistory();
    const sums={online:0,scalar:0,static:0,causal:0};
    let valid=s.history.length===s.t&&s.sampleCount===s.t;
    for(let i=0;i<s.history.length;i++){
     const e=s.history[i],r=e.execution;valid=valid&&e.t===i+1&&r.action===i&&r.trainedThrough===(i>=30?i-1:null);
     for(const key of Object.keys(sums))sums[key]+=e.stage[key];
    }
    return {fingerprint:await window.__longSessionFingerprint(s),t:s.t,phase:s.phase,mode:s.mode,protocol:s.protocol,
     playing:d.getState().playing,rendered:d.getRenderedSnapshot().t,historyValid:valid,sums,costs:s.cumulative,
     bounded:Object.values(s.commandQ).every(row=>row.every(v=>Math.abs(v)<=70+1e-8)),
     gainPoints:reading.points.length,lastGainAction:reading.points.at(-1).x,updates:s.learning.sourceUpdates};
   });
   const restoreMs=Date.now()-restoreStarted;
   assert.deepEqual(restored.fingerprint,fixture.before,'Complete physical state and every ordered history entry restore exactly '+networkId);
   assert.equal(restored.t,plan.steps);assert.equal(restored.phase,'ongoing');assert.equal(restored.protocol,plan.protocol);
   assert.equal(restored.playing,false);assert.equal(restored.mode,'running');assert.equal(restored.rendered,restored.t);
   assert.equal(restored.historyValid,true);assert.equal(restored.bounded,true);
   assert.equal(restored.gainPoints,plan.steps);assert.equal(restored.lastGainAction,plan.steps-1);
   for(const key of ['online','scalar','static','causal'])assert.ok(Math.abs(restored.sums[key]-restored.costs[key])<=1e-10*Math.max(1,restored.costs[key]),'Full accumulated stage costs '+key);
   const details=page.locator('#pr-adaptation');if(await details.getAttribute('open')===null)await details.locator('summary').first().click();
   await page.locator('#pr-step').click();
   const resumed=await page.evaluate(async()=>{const d=document.querySelector('#power-response-demo').powerDemo,s=d.getSnapshot();return {fingerprint:await window.__longSessionFingerprint(s),t:s.t,playing:d.getState().playing,updates:s.learning.sourceUpdates};});
   assert.deepEqual(resumed.fingerprint,fixture.next,'First actual UI action after long restore matches the production engine');
   assert.equal(resumed.t,plan.steps+1);assert.equal(resumed.playing,false);assert.equal(resumed.updates,restored.updates+1);
   await page.waitForFunction(target=>window.openai.widgetState?.privateContent?.continuousRecord?.steps===target,plan.steps+1);
   const secondStarted=Date.now();await page.reload({waitUntil:'networkidle',timeout:120000});
   const second=await page.evaluate(async()=>window.__longSessionFingerprint(document.querySelector('#power-response-demo').powerDemo.getSnapshot()));
   assert.deepEqual(second,fixture.next,'Resumed session is saved and restores exactly again');
   await page.screenshot({path:path.join(output,networkId+(mobile?'-phone':'-desktop')+'-long-restored.png'),fullPage:true});
   const result={networkId,mobile,steps:plan.steps,generationMs:fixture.generationMs,restoreMs,secondRestoreMs:Date.now()-secondStarted,
    savedBytes,historyBytes:fixture.before.historyBytes,historyEntries:fixture.before.entries,historyChunks:fixture.before.chunks,
    costs:restored.costs,sourceUpdates:restored.updates,exactFirstRestore:true,exactResumedStep:true,exactSecondRestore:true,passed:true};
   results.push(result);console.log('LONG_SESSION_RESTORATION '+JSON.stringify(result));
   await context.close();
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({passed:true,source:process.env.GITHUB_SHA,plan,results,errors,
   scope:'Saved session fixtures, production hydration and resumed Step. Not native playback speed. Finite retention evidence only.'},null,2));
 }catch(error){
  if(browser)for(const [i,context]of browser.contexts().entries()){const page=context.pages().at(-1);if(page)await page.screenshot({path:path.join(output,'failure-'+i+'.png'),fullPage:true}).catch(()=>{});}
  await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,results,errors},null,2));throw error;
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
