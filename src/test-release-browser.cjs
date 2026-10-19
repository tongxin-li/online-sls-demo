'use strict';
// The same built bytes are checked locally on candidates and at the sole
// canonical URL after a main push. No alternate controller or saved fixture.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {createHash}=require('node:crypto'),{chromium}=require('playwright');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const responseDistance=(a,b)=>Math.hypot(...a.flat().map((value,index)=>value-b.flat()[index]));
async function main(){
 const root=path.resolve(__dirname,'..'),output=process.env.DEMO_SMOKE_OUTPUT||path.join(root,'browser-results','release');
 const live=process.env.DEMO_VERIFY_PUBLIC==='true',canonical='https://tongxin.me/online-sls-demo/';
 await fs.mkdir(output,{recursive:true});
 let server,browser,activePage,activeCase,diagnosticWrites=Promise.resolve();const results=[],errors=[],expected={},diagnostics=[];
 const diagnostic=(kind,detail={})=>{
  const entry={at:new Date().toISOString(),case:activeCase||null,kind,...detail};diagnostics.push(entry);
  // Persist startup failures as they happen, including a browser that never initializes.
  diagnosticWrites=diagnosticWrites.then(()=>fs.appendFile(path.join(output,'release-browser-events.jsonl'),JSON.stringify(entry)+'\n'));
 };
 for(const file of ['index.html','environment.html'])expected[file]=hash(await fs.readFile(path.join(root,file)));
 try{
  if(!live){
   server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://localhost'),file=path.resolve(root,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});
    res.end(await fs.readFile(file));
   }catch(_){res.writeHead(404).end();}});
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  }
  const address=live?canonical:'http://127.0.0.1:'+server.address().port+'/';
  const verified={};
  for(const file of ['index.html','environment.html']){
   const url=new URL(file==='index.html'?'':file,address).href;let actual=null,status=null;
   const attempts=live?60:1;
   for(let attempt=0;attempt<attempts;attempt++){
    try{const response=await fetch(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
     status=response.status;actual=response.ok?hash(Buffer.from(await response.arrayBuffer())):null;
    }catch(error){status='network error';diagnostic('fetch-failure',{file,url,message:error.message});}
    diagnostic('built-bytes',{file,url,attempt:attempt+1,status,actual,expected:expected[file]});
    if(actual===expected[file])break;
    if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,2500));
   }
   assert.equal(actual,expected[file],'Exact built bytes for '+file+' at '+url+' status '+status);
   verified[file]={sha256:actual,status};
  }
  browser=await chromium.launch({headless:true,...(process.env.DEMO_BROWSER_CHANNEL?{channel:process.env.DEMO_BROWSER_CHANNEL}:{})});
  browser.on('disconnected',()=>diagnostic('browser-disconnected'));
  const read=page=>page.evaluate(()=>{const root=document.querySelector('#power-response-demo'),api=root.powerDemo,s=api.getSnapshot();
   const network=window.PowerDemo.forNetwork(root.dataset.network),ui=api.getState(),bus=ui.selectedBus;
   const row=network.constants.inverterBuses.indexOf(7),j=5,p=s.lastExecution?.policies.online;
   return {network:s.networkId,protocol:s.protocol,phase:s.phase,t:s.t,history:s.history.length,samples:s.sampleCount,
    stressProfile:s.stressProfile||'standard',attackProfile:s.attackProfile||null,attackSettings:s.attackSettings||null,
    powerScenario:s.powerScenario,scenario:s.scenario,events:s.eventLog,faults:s.faults,initialOptions:s.initialOptions,forecastFaultScale:s.forecastFaultScale||1,
    pendingPulses:s.pendingPulses,activePulses:s.activePulses,applications:s.lastPulseApplications,scenarioApplications:s.lastScenarioApplications,
    voltage:s.voltage,voltageHistory:s.history.map(entry=>({t:entry.t,value:1+entry.states.online[5]})),
    selectedStress:document.querySelector('#pr-stress-profile').value,pulseStrength:document.querySelector('#pr-strength').value,
    scenarioCaption:document.querySelector('#pr-scenario-description').textContent,
    noiseCaption:document.querySelector('#pr-noise-caption').textContent,
    expectedNoiseMpu:1000*(s.faults.includes(bus)&&s.attackSettings?.forecastStdPu?s.attackSettings.forecastStdPu[bus-1]:network.model.forecastForcingScales[bus-1]*s.beta*(s.faults.includes(bus)?4*(s.forecastFaultScale||1):.05)),
    costs:s.cumulative,states:s.states,commandQ:s.commandQ,lastExecution:s.lastExecution,
    gain:p?.gainNorms[row][j]??null,currentGain:p?.currentGains[row][j]??null,responseGains:p?.gainNorms??null,
    topologyAdaptive:s.deployedSupport?.topologyAdaptive,learning:s.learning,
    faulty:s.faults.includes(7),selectedBus:bus,intervention:ui.intervention,playing:ui.playing,attacks:ui.activeAttackBuses};
  });
  const checkNoiseCaption=value=>{
   const displayed=Number(value.noiseCaption.match(/Noise SD ([\d.e+-]+)/)?.[1]);
   assert.ok(Number.isFinite(displayed)&&Math.abs(displayed-value.expectedNoiseMpu)<=Math.max(1e-8,value.expectedNoiseMpu*.005),'Caption reports actual configured source noise in mpu');
  };
  const replayFields=['t','costs','states','commandQ','lastExecution','initialOptions','stressProfile','selectedStress','pulseStrength','attackProfile','attackSettings','powerScenario'];
  const checkManualStart=(value,network)=>{
   assert.equal(value.network,network);assert.equal(value.protocol,'adaptive-phi-v2');
   assert.equal(value.topologyAdaptive,true,'Fresh release executes online response and topology adaptation');
   assert.equal(value.t,0);assert.equal(value.playing,false);assert.equal(value.selectedBus,6);
   assert.equal(value.attackProfile,'manual-v1');assert.equal(value.initialOptions.attackProfile,'manual-v1');
   assert.equal(value.powerScenario,'interactive');assert.equal(value.initialOptions.powerScenario,'interactive');
   assert.equal(value.pulseStrength,network==='toy8'?'900':'150');assert.equal(value.intervention,'power');
   assert.equal(value.attackSettings.forecastNoiseCoefficient,network==='toy8'?32:8);
   assert.deepEqual(value.attackSettings.strengthsKw,network==='toy8'?[150,450,900]:[50,150,300]);
   assert.deepEqual(value.faults,[]);assert.deepEqual(value.events,[]);assert.deepEqual(value.attacks,[]);
   assert.deepEqual(value.pendingPulses,[]);assert.deepEqual(value.activePulses,[]);assert.deepEqual(value.scenarioApplications,[]);
   assert.ok(Object.values(value.costs).every(cost=>cost===0));
   assert.match(value.scenarioCaption,/No attacks until you act.*Background load varies/);checkNoiseCaption(value);
  };
  for(const mobile of [false,true])for(const network of ['toy8','feeder24','feeder47']){
   activeCase=network+(mobile?'-phone':'-desktop');diagnostic('case-start');
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
   const page=activePage=await context.newPage();page.setDefaultTimeout(30000);
   await page.addInitScript(()=>{const key='online-sls-release-archive',pending=sessionStorage.getItem(key);if(pending){localStorage.setItem('online-sls-demo-v1',pending);sessionStorage.removeItem(key);}});
   page.on('pageerror',error=>{errors.push(error.message);diagnostic('pageerror',{message:error.message,stack:error.stack});});
   page.on('console',message=>{if(['error','warning'].includes(message.type()))diagnostic('console',{level:message.type(),text:message.text()});});
   page.on('requestfailed',request=>diagnostic('requestfailed',{url:request.url(),method:request.method(),failure:request.failure()}));
   page.on('response',response=>{if(response.status()>=400||response.request().resourceType()==='script')diagnostic('response',{url:response.url(),status:response.status(),resourceType:response.request().resourceType()});});
   const response=await page.goto(address,{waitUntil:'networkidle'});
   diagnostic('navigation',{url:page.url(),status:response?.status()});
   assert.equal(hash(await response.body()),expected['index.html'],'Browser receives the same tested page bytes');
   await page.waitForFunction(()=>!!document.querySelector('#power-response-demo')?.powerDemo,{},{timeout:30000});
   diagnostic('ready');
   if(network!=='feeder24')await page.locator('#pr-network-scenario').selectOption(network);
   const fresh=await read(page);checkManualStart(fresh,network);
   assert.equal(await page.locator('#pr-strength-control').isVisible(),true,'Physical attack strength is in the primary controls');
   assert.equal(await page.locator('#pr-stress-profile').isVisible(),false,'Fresh manual trials have no preset stress selector');
   const settings=page.locator('#pr-adaptation');
   const setting=async(id,value)=>{const opened=await settings.getAttribute('open')!==null;if(!opened)await settings.locator('summary').first().click();await page.locator('#pr-'+id).selectOption(value);if(!opened)await settings.locator('summary').first().click();};
   await setting('speed','32');
   const activate=async selector=>{const node=page.locator(selector);if(mobile)await node.tap();else await node.click();};
   const until=target=>page.waitForFunction(target=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=target,target,{timeout:120000,polling:100});
   const archiveChecks=[];
   if(network==='toy8'){
    for(const stress of ['standard','strong-v1']){
     // Restore real archived records. A newly started trial always stays manual.
     const expectedArchive=await page.evaluate(({network,stress})=>{
      const api=window.PowerDemo.forNetwork(network),options={networkId:network,experiment:'communication',powerScenario:'forecasted-demand',beta:4,preset:'mixed',seed:20261013,protocol:'adaptive-phi-v2',...(stress==='strong-v1'?{stressProfile:stress}:{})};
      const sim=new api.Simulation(options);for(let i=0;i<7;i++)sim.step();
      const s=sim.snapshot(),record=sim.recordContinuous();
      sessionStorage.setItem('online-sls-release-archive',JSON.stringify({privateContent:{version:15,networkId:network,continuousRecord:record,phase:s.phase,t:s.t,selectedBus:7,speed:'32',pulseStrength:'100',attackMode:'continuous',view:'cost',matrixView:'change',intervention:'forecast',allLinks:true}}));
      return {t:s.t,costs:s.cumulative,states:s.states,commandQ:s.commandQ,lastExecution:s.lastExecution,initialOptions:s.initialOptions,stressProfile:s.stressProfile||'standard',powerScenario:s.powerScenario,faults:s.faults};
     },{network,stress});
     await page.reload({waitUntil:'networkidle'});const restored=await read(page);
     for(const field of Object.keys(expectedArchive))assert.deepEqual(restored[field],expectedArchive[field],'Exact archived '+stress+' replay '+field);
     assert.equal(restored.pulseStrength,'100','Archived custom strength restores unchanged');
     assert.equal(restored.playing,false);assert.equal(restored.attackProfile,null);assert.equal(restored.selectedStress,stress);checkNoiseCaption(restored);
     assert.equal(Object.hasOwn(restored.initialOptions,'attackProfile'),false,'Archived trials retain the original option shape');
     archiveChecks.push({stress,actions:restored.t,exactReplay:true});
    }
    await activate('#pr-restart');checkManualStart(await read(page),network);await setting('speed','32');
   }
   await activate('#pr-run');await until(40);await activate('#pr-run');const quiet=await read(page);
   assert.equal(quiet.playing,false);assert.deepEqual(quiet.faults,[]);assert.deepEqual(quiet.events,[]);
   assert.deepEqual(quiet.attacks,[]);assert.deepEqual(quiet.pendingPulses,[]);assert.deepEqual(quiet.activePulses,[]);
   assert.deepEqual(quiet.scenarioApplications,[]);assert.equal(quiet.scenario.active,false,'Quiet playback never schedules a physical attack');
   // Clicking the actual home glyph starts sustained user driven disturbance.
   await activate('.bus-node[data-bus="6"]');
   await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getState().activeAttackBuses.includes(6));
   const attackStart=await read(page);assert.equal(attackStart.playing,true);await until(attackStart.t+8);
   const sustained=await read(page),minimum=Math.min(...sustained.voltageHistory.filter(entry=>entry.t>quiet.t).map(entry=>entry.value));
   assert.ok(quiet.voltage[5]-minimum>(network==='toy8'?.005:.001),'User attack visibly lowers the selected home voltage with physical units');
   const applied=sustained.applications.filter(item=>item.bus===6);
   assert.ok(applied.length>0,'Continuous user attack keeps applying power each sample');
   assert.ok(applied.every(item=>item.appliedKw>0&&item.appliedKw<=sustained.attackSettings.maxKw+1e-8),'Applied attack respects its declared physical power cap');
   for(const command of Object.values(sustained.commandQ))assert.ok(command.every(value=>Math.abs(value)<=70+1e-8),'Every controller retains the same actuator limit under attack');
   assert.ok(sustained.events.filter(item=>item.type==='pulse'&&item.bus===6).length>=5,'Continuous attack queues repeated causal requests');
   await activate('#pr-stop-attacks');assert.deepEqual((await read(page)).attacks,[],'Stop all ends new continuous requests');
   await activate('.bus-node[data-bus="6"]');const repeated=await read(page);assert.ok(repeated.attacks.includes(6),'The same bus can be attacked again');
   await until(repeated.t+4);await activate('.bus-node[data-bus="6"]');assert.deepEqual((await read(page)).attacks,[],'Second bus click stops its attack');
   await page.locator('#pr-intervention').selectOption('forecast');await setting('bus','7');
   const before=await read(page);assert.equal(before.faulty,false);checkNoiseCaption(before);
   await activate('#pr-cost-gap');await activate('#pr-cost-total');
   assert.equal((await read(page)).playing,true,'Cost controls preserve playback');
   await activate('#pr-pulse');const noisy=await read(page);assert.equal(noisy.faulty,true);checkNoiseCaption(noisy);
   assert.ok(noisy.expectedNoiseMpu>before.expectedNoiseMpu*100,'Forecast corruption changes the actual noise scale, not only its label');
   await until(before.t+75);const corrupted=await read(page);
   assert.ok(responseDistance(corrupted.responseGains,before.responseGains)>1e-8,'Executed response matrices continue adapting after source corruption');
   await activate('#pr-pulse');assert.equal((await read(page)).faulty,false);
   await until(corrupted.t+75);const repaired=await read(page);
   assert.ok(responseDistance(repaired.responseGains,corrupted.responseGains)>1e-8,'Executed response matrices continue adapting after source repair');
   assert.ok(repaired.t>180);assert.equal(repaired.phase,'ongoing');assert.equal(repaired.playing,true);
   if((await read(page)).playing)await activate('#pr-run');
   const final=await read(page);assert.equal(final.history,final.t);assert.equal(final.samples,final.t);
   assert.ok(final.lastExecution.trainedThrough<final.lastExecution.action);
   for(const key of ['online','scalar','static','causal']){
    assert.ok(final.costs[key]>quiet.costs[key]);assert.ok(final.commandQ[key].every(value=>Math.abs(value)<=70+1e-8));
   }
   assert.equal(await page.locator('#pr-cost-detail tr').count(),4);
   assert.equal(await page.locator('#pr-cost path.data-series').count(),4);
   await page.reload({waitUntil:'networkidle'});const replay=await read(page);
   for(const field of replayFields)assert.deepEqual(replay[field],final[field],'Exact deployed replay '+field);
   await page.screenshot({path:path.join(output,activeCase+'.png'),fullPage:true});
   const checkpoint=value=>({t:value.t,gain:value.gain,currentGain:value.currentGain,responseGains:value.responseGains,
    action:value.lastExecution.action,trainedThrough:value.lastExecution.trainedThrough});
   const result={network,mobile,attackProfile:final.attackProfile,quietPlayback:{actions:quiet.t,noAttacks:true},manualPower:{bus:6,requestKw:Number(fresh.pulseStrength),baselinePu:quiet.voltage[5],minimumPu:minimum,continuous:true,repeated:true,stopped:true},forecast:{quietMpu:before.expectedNoiseMpu,noisyMpu:noisy.expectedNoiseMpu},archiveChecks,actions:final.t,before:checkpoint(before),corrupted:checkpoint(corrupted),repaired:checkpoint(repaired),costs:final.costs,exactReplay:true,passed:true};
   results.push(result);diagnostic('case-passed',{actions:final.t});console.log('RELEASE_PLAYBACK '+JSON.stringify(result));await context.close();activePage=null;
  }
  assert.deepEqual(errors,[]);
  const evidence={passed:true,mode:live?'canonical public':'same built local candidate',url:live?canonical:null,revision:process.env.GITHUB_SHA||null,verified,results,errors};
  await fs.writeFile(path.join(output,'release-verification.json'),JSON.stringify(evidence,null,2));
  console.log('RELEASE_VERIFICATION '+JSON.stringify(evidence));
 }catch(error){
  diagnostic('failure',{message:error.message,stack:error.stack});
  if(activePage&&!activePage.isClosed()){
   try{diagnostic('failure-page',{url:activePage.url(),state:await activePage.evaluate(()=>({ready:!!document.querySelector('#power-response-demo')?.powerDemo,error:document.querySelector('#pr-error')?.textContent,scripts:[...document.scripts].map(script=>script.src).filter(Boolean)}))});await activePage.screenshot({path:path.join(output,(activeCase||'startup')+'-failure.png'),fullPage:true,timeout:10000});}catch(captureError){diagnostic('capture-failure',{message:captureError.message});}
  }
  await fs.writeFile(path.join(output,'release-failure.json'),JSON.stringify({passed:false,case:activeCase||null,error:{message:error.message,stack:error.stack},results,errors,expected},null,2));throw error;
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await diagnosticWrites;await fs.writeFile(path.join(output,'release-browser-diagnostics.json'),JSON.stringify(diagnostics,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
