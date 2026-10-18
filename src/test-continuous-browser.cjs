'use strict';
// Real fresh ongoing defaults, production controls and exact protocol 14 replay.
// No injected saved trial or alternative controller test hook.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
async function main(){
 const root=path.resolve(__dirname,'..'),output=path.join(process.env.DEMO_SMOKE_OUTPUT||path.join(root,'browser-results'),'ongoing');
 await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost'),file=path.resolve(root,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
   res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});res.end(await fs.readFile(file));
  }catch(_){res.writeHead(404).end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address='http://127.0.0.1:'+server.address().port,errors=[],results=[];let browser;
 const read=page=>page.evaluate(()=>{const d=document.querySelector('#power-response-demo').powerDemo,s=d.getSnapshot();return {s:{networkId:s.networkId,protocol:s.protocol,phase:s.phase,t:s.t,mode:s.mode,historyLength:s.history.length,learning:s.learning,cumulative:s.cumulative,commandQ:s.commandQ,states:s.states,lastExecution:s.lastExecution,deployedSupport:s.deployedSupport,traffic:s.traffic},ui:d.getState(),evidence:d.getLinkEvidence()};});

 // CDP observes actual native Run execution. It does not replace the plant,
 // scheduler, controller, renderer or issued observations.
 const profileState=page=>page.evaluate(()=>{const d=document.querySelector('#power-response-demo').powerDemo,s=d.getSnapshot();return {
  t:s.t,history:s.history.length,samples:s.sampleCount,sourceUpdates:s.learning.sourceUpdates,
  costs:s.cumulative,domNodes:document.getElementsByTagName('*').length,playing:d.getState().playing};});
 const startProfile=async(page,label)=>{
  const session=await page.context().newCDPSession(page),before=await profileState(page);
  const heapBefore=await session.send('Runtime.getHeapUsage');
  await session.send('Profiler.enable');await session.send('Profiler.setSamplingInterval',{interval:1000});
  await session.send('Profiler.start');return {session,label,before,heapBefore,started:Date.now()};
 };
 const finishProfile=async(page,record)=>{
  const {profile}=await record.session.send('Profiler.stop'),elapsedMs=Date.now()-record.started;
  const heapAfter=await record.session.send('Runtime.getHeapUsage'),after=await profileState(page);
  await record.session.detach();
  const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map();
  for(const node of profile.nodes)for(const child of node.children||[])parents.set(child,node.id);
  const stages={snapshot:'snapshot',step:'controller_and_plant',command:'controller_and_plant',begin:'controller_and_plant',
   finish:'controller_and_plant',prepareContinuousAction:'controller_and_plant',refreshContinuousScores:'controller_and_plant',
   diagnostics:'controller_and_plant',render:'render',renderControls:'render',drawNetwork:'network',
   drawMatrix:'matrix',drawCost:'cost_chart',drawVoltage:'voltage_chart',voltageMetrics:'voltage_metrics',
   drawResponseHistory:'response_history',inspectedResponseHistory:'response_history',save:'persistence'};
  const self=new Map(),attribution={};let sampledUs=0;
  for(let i=0;i<(profile.samples||[]).length;i++){
   const id=profile.samples[i],duration=profile.timeDeltas?.[i]??1000,node=nodes.get(id),frame=node?.callFrame||{};
   sampledUs+=duration;const key=[frame.functionName||'(anonymous)',frame.url||'',frame.lineNumber??-1].join('|');
   const item=self.get(key)||{function:frame.functionName||'(anonymous)',url:frame.url||'',line:(frame.lineNumber??-1)+1,selfUs:0};
   item.selfUs+=duration;self.set(key,item);
   let current=id,stage=null;
   while(current!==undefined){const name=nodes.get(current)?.callFrame.functionName;
    if(stages[name]){stage=stages[name];break;}current=parents.get(current);
   }
   stage=stage||(frame.functionName==='(idle)'?'idle':frame.functionName==='(garbage collector)'?'garbage_collection':'other');
   attribution[stage]=(attribution[stage]||0)+duration;
  }
  const summary={label:record.label,before:record.before,after,elapsedMs,heapBefore:record.heapBefore,heapAfter,
   samples:profile.samples?.length||0,sampledUs,attributionUs:attribution,
   hottestSelf:[...self.values()].sort((a,b)=>b.selfUs-a.selfUs).slice(0,40),
   caveat:'Profiler and browser assertions add overhead. Heap usage is an actual finite observation, not a retained heap or indefinite bound. Stack attribution uses the nearest named application frame.'};
  assert.ok(summary.samples>100,'Native CPU profile contains actual samples');
  assert.equal(after.history,after.t);assert.equal(after.samples,after.t,'Profiling preserves every revealed sample');
  assert.ok(after.sourceUpdates>record.before.sourceUpdates,'Causal learning continues during profiling');
  for(const key of ['online','scalar','static','causal'])assert.ok(after.costs[key]>=record.before.costs[key]);
  await fs.writeFile(path.join(output,record.label+'.cpuprofile'),JSON.stringify(profile));
  await fs.writeFile(path.join(output,record.label+'-profile.json'),JSON.stringify(summary,null,2));
  console.log('NATIVE_CPU_PROFILE '+JSON.stringify(summary));return summary;
 };
 const settings=async(page,fn)=>{const box=page.locator('#pr-adaptation');const open=await box.getAttribute('open')!==null;if(!open)await box.locator('summary').first().click();await fn();if(!open)await box.locator('summary').first().click();};
 const setting=(page,id,value)=>settings(page,()=>page.locator('#pr-'+id).selectOption(value));
 const pause=async page=>{if((await read(page)).ui.playing)await page.locator('#pr-run').click();};
 const advance=page=>settings(page,async()=>{await page.locator('#pr-compare').click();await page.waitForFunction(()=>!document.querySelector('#pr-compare').disabled);});
 try{
  browser=await chromium.launch({headless:true});
  for(const mobile of [false,true])for(const networkId of ['toy8','feeder24','feeder47']){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
   await context.addInitScript(({networkId})=>{
    const pending=sessionStorage.getItem('online-sls-demo-test-restore');
    if(pending){localStorage.setItem('online-sls-demo-v1',pending);sessionStorage.removeItem('online-sls-demo-test-restore');}
    window.__attackPointerEvents=[];
    for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','click'])document.addEventListener(type,event=>{
      if(event.target.closest?.('#pr-pulse, #pr-stop-attacks'))window.__attackPointerEvents.push({type,target:event.target.closest('#pr-pulse, #pr-stop-attacks').id,pointerType:event.pointerType??null,button:event.button,detail:event.detail,touch:event.sourceCapabilities?.firesTouchEvents??null});
    },true);
    window.addEventListener('blur',()=>window.__attackPointerEvents.push({type:'window-blur'}));
   },{networkId});
   const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(address,{waitUntil:'networkidle'});
   assert.equal((await read(page)).s.protocol,'continuous-phi-v1');
   assert.equal((await read(page)).s.t,0);assert.equal((await read(page)).ui.playing,false);
   assert.equal((await read(page)).ui.inspectedSource,7,'Fresh default inspection follows the main forecast target');
   if(networkId!=='feeder24')await page.locator('#pr-network-scenario').selectOption(networkId);
   await setting(page,'speed','32');
   assert.equal(await page.locator('#pr-response-history').getAttribute('hidden'),'','Executed gain SVG has a native hidden attribute until execution');
   assert.equal(await page.locator('#pr-response-history').isVisible(),false,'No executed gain plot before the first action');
   assert.equal((await read(page)).s.networkId,networkId);
   await settings(page,async()=>assert.equal(await page.locator('#pr-experiment').isVisible(),false,'No inapplicable legacy experiment selector'));
   const label=networkId+(mobile?'-phone':'-desktop');
   await page.screenshot({path:path.join(output,label+'-start.png'),fullPage:true});
   const nativeBefore=await read(page);
   const nativeStarted=Date.now();
   await page.evaluate(()=>{
    const m=window.__nativePlayback={frames:0,maxFrameGapMs:0,over50ms:0,over100ms:0,last:null,stopped:false,
      initialDomNodes:document.getElementsByTagName('*').length,initialHeapBytes:performance.memory?.usedJSHeapSize??null};
    const frame=now=>{if(m.stopped)return;if(m.last!==null){const gap=now-m.last;m.maxFrameGapMs=Math.max(m.maxFrameGapMs,gap);if(gap>50)m.over50ms++;if(gap>100)m.over100ms++;}m.last=now;m.frames++;requestAnimationFrame(frame);};
    requestAnimationFrame(frame);
   });
   await page.locator('#pr-run').click();await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=35);
   await page.locator('#pr-cost-gap').click();assert.equal((await read(page)).ui.playing,true);
   await page.locator('#pr-cost-total').click();
   const nativeSwitches=[],profiles=[];let nativeProfile=null;
   const nativeReceipt=()=>page.evaluate(()=>{
    const root=document.querySelector('#power-response-demo'),s=root.powerDemo.getSnapshot(),receipt=s.lastExecution;
    const r=window.PowerDemo.forNetwork(root.dataset.network).constants.inverterBuses.indexOf(7),j=5;
    return {action:receipt.action,trainedThrough:receipt.trainedThrough,coefficient:receipt.policies.online.receivedCoefficients[r][j],
      gain:receipt.policies.online.currentGains[r][j],raw:receipt.policies.online.raw[r],bounded:receipt.policies.online.bounded[r],corrupted:s.faults.includes(7)};
   });
   for(const target of [90,220,430,650]){
    await page.waitForFunction(target=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=target,target,{timeout:150000,polling:100});
    nativeSwitches.push(await nativeReceipt());
    if(networkId==='feeder47'&&target===650)nativeProfile=await startProfile(page,label+'-near-900');
    await page.locator('#pr-pulse').click();
    assert.equal((await read(page)).ui.playing,true,'Source corruption or repair does not pause native Run');
   }
   await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=901,null,{timeout:150000,polling:100});
   nativeSwitches.push(await nativeReceipt());
   assert.deepEqual(nativeSwitches.map(row=>row.corrupted),[false,true,false,true,false],'All predefined native corruption and repair switches execute');
   assert.ok(nativeSwitches.slice(1).some((row,i)=>Math.abs(row.gain-nativeSwitches[i].gain)>1e-10),'Actual received effective response weights change during native Run');
   for(const row of nativeSwitches){assert.ok(row.trainedThrough<row.action);assert.ok(Math.abs(row.bounded)<=.07+1e-11,'Receipt command uses per unit and must stay within 70 kvar on the 1 MVA base');}
   assert.equal((await read(page)).ui.playing,true,'Native Run must not stop at old finite boundaries');
   await pause(page);
   if(nativeProfile)profiles.push(await finishProfile(page,nativeProfile));
   const native=await read(page),nativeMetrics=await page.evaluate(()=>{
    const m=window.__nativePlayback;m.stopped=true;
    return {frames:m.frames,maxFrameGapMs:m.maxFrameGapMs,over50ms:m.over50ms,over100ms:m.over100ms,
      initialDomNodes:m.initialDomNodes,finalDomNodes:document.getElementsByTagName('*').length,
      initialHeapBytes:m.initialHeapBytes,finalHeapBytes:performance.memory?.usedJSHeapSize??null};
   });
   nativeMetrics.elapsedMs=Date.now()-nativeStarted;nativeMetrics.actions=native.s.t-nativeBefore.s.t;nativeMetrics.sourceSwitches=nativeSwitches;
   assert.ok(native.s.t>=901);assert.equal(native.s.phase,'ongoing');assert.equal(native.s.mode,'running');
   assert.equal(native.s.historyLength,native.s.t,'Native playback retains all observed samples');
   assert.equal(native.s.learning.sourceUpdates,Math.max(0,native.s.lastExecution.action-29),'One causal source fit per action after the 30 pair warmup');
   assert.ok(native.s.learning.sourceUpdates>(nativeBefore.s.learning.sourceUpdates??0));
   for(const key of ['online','scalar','static','causal'])assert.ok(native.s.cumulative[key]>nativeBefore.s.cumulative[key],'Native full physical costs continue '+key);
   assert.ok(nativeMetrics.frames>100,'Actual rendering frames are observed during native playback');
   console.log('NATIVE_PLAYBACK '+JSON.stringify({networkId,mobile,...nativeMetrics,costs:native.s.cumulative,sourceUpdates:native.s.learning.sourceUpdates}));
   await page.screenshot({path:path.join(output,label+'-native-long.png'),fullPage:true});
   const initial=await read(page),edge=initial.s.deployedSupport.links.find(e=>e.from!==e.to);
   const cell=page.locator('#pr-matrix .matrix-cell[data-receiver="'+edge.to+'"][data-source="'+edge.from+'"]');
   await cell.scrollIntoViewIfNeeded();if(mobile)await cell.tap();else{await cell.focus();await page.keyboard.press('Enter');}
   assert.equal((await read(page)).ui.inspectedSource,edge.from);
   if(mobile)await page.locator('#pr-source-fault').tap();else await page.locator('#pr-source-fault').click();
   await advance(page);const first=await read(page);
   assert.ok(first.s.t>180);assert.equal(first.s.phase,'ongoing');assert.equal(first.ui.comparisonComplete,false);
   assert.equal(first.evidence.ongoing,true);
   await page.locator('#pr-source-fault').click();
   await advance(page);const second=await read(page);assert.ok(second.s.t>360);assert.equal(second.s.historyLength,second.s.t);
   assert.ok(second.s.cumulative.online>=first.s.cumulative.online);
   await page.locator('#pr-intervention').selectOption('power');
   await setting(page,'bus','7');await page.locator('#pr-pulse').scrollIntoViewIfNeeded();
   const attackBox=await page.locator('#pr-pulse').boundingBox();
   if(mobile)await page.locator('#pr-pulse').tap();else await page.locator('#pr-pulse').click();
   if(mobile){
     const after=await page.locator('#pr-pulse').boundingBox();
     for(const dimension of ['x','y','width','height'])assert.ok(Math.abs(after[dimension]-attackBox[dimension])<1,'Touch attack geometry remains stable at activation '+dimension);
   }
   console.log('ATTACK_DIAGNOSTIC '+JSON.stringify(await page.evaluate(()=>{const d=document.querySelector('#power-response-demo').powerDemo,u=d.getState();return {mobile:matchMedia('(pointer:coarse)').matches,playing:u.playing,attacks:u.activeAttackBuses,intervention:u.intervention,selectedBus:u.selectedBus,attackMode:document.querySelector('#pr-attack-mode').value,pointerEvents:window.__attackPointerEvents,events:u.journal.slice(-3),button:document.querySelector('#pr-pulse').outerHTML};})));
   await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getState().activeAttackBuses.includes(7));
   await setting(page,'bus','5');if(mobile)await page.locator('#pr-pulse').tap();else await page.locator('#pr-pulse').click();
   const attackStart=(await read(page)).s.t;
   await page.waitForFunction(target=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=target,attackStart+5);
   await page.locator('#pr-stop-attacks').click();await pause(page);
   for(let i=0;i<3;i++)await advance(page);
   if(networkId==='feeder47'){
    const lateBefore=await read(page);assert.ok(lateBefore.s.t>1800,'Late profile follows the full growing history');
    const late=await startProfile(page,label+'-after-1800');
    await page.locator('#pr-run').click();
    await page.waitForFunction(target=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=target,lateBefore.s.t+100,{timeout:150000,polling:100});
    await pause(page);profiles.push(await finishProfile(page,late));
   }
   const final=await read(page);assert.ok(final.s.t>900);assert.equal(final.s.phase,'ongoing');assert.equal(final.ui.comparisonComplete,false);
   assert.equal(final.s.historyLength,final.s.t);assert.equal(final.s.mode,'running');
   assert.ok(final.s.learning.sourceUpdates>second.s.learning.sourceUpdates);
   for(const key of ['online','scalar','static','causal']){
    assert.ok(final.s.cumulative[key]>=second.s.cumulative[key]);
    assert.ok(final.s.commandQ[key].every(value=>Math.abs(value)<=70+1e-8));
   }
   assert.equal(await page.locator('#pr-cost-detail tr').count(),4);assert.equal(await page.locator('.pr-panel').count(),4);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   assert.match(await page.locator('#pr-transition-note').textContent(),/No reset or stop/);
   assert.equal(await page.locator('#pr-cost path.data-series').count(),4);
   const inspected=await page.evaluate(()=>{
     const d=document.querySelector('#power-response-demo').powerDemo,s=d.getSnapshot(),r=d.getResponseHistory(),el=document.querySelector('#pr-response-history');
     return {history:r,plotted:el.dataset,traffic:Array.from(document.querySelectorAll('#pr-cost-detail tr')).map(row=>({key:row.dataset.method,payload:row.querySelector('.pr-method-traffic')?.dataset,expected:s.traffic[row.dataset.method]})),
       statusWidth:document.querySelector('#pr-progress-learning-label').getBoundingClientRect().width,
       statusHeight:document.querySelector('#pr-experiment-progress').getBoundingClientRect().height,
       archive:document.querySelector('#pr-reference-study summary')?.textContent};
   });
   assert.equal(inspected.history.points.length,final.s.t);
   assert.equal(Number(inspected.plotted.lastAction),final.s.lastExecution.action);
   assert.equal(Number(inspected.plotted.lastGain),inspected.history.points.at(-1).gain);
   assert.ok(inspected.statusWidth>120,'Ongoing text uses the full column');
   assert.ok(inspected.statusHeight<180,'No obsolete stage column expands the strip');
   const axisSpacing=await page.evaluate(()=>Array.from(document.querySelectorAll('svg')).filter(svg=>svg.getBoundingClientRect().height>0&&svg.querySelector('[data-axis=x]')?.textContent).map(svg=>{
     const title=svg.querySelector('[data-axis=x]').getBoundingClientRect(),ticks=Array.from(svg.querySelectorAll('.x-axis .tick text')).map(el=>el.getBoundingClientRect());
     return {id:svg.id,gap:title.top-Math.max(...ticks.map(rect=>rect.bottom))};
   }));
   assert.ok(axisSpacing.some(axis=>axis.id==='pr-response-history'));
   for(const axis of axisSpacing)assert.ok(axis.gap>=2,'Axis caption separated from numeric ticks '+JSON.stringify(axis));
   for(const row of inspected.traffic){
    assert.equal(Number(row.payload.forecasts),row.expected.remoteForecastMessages);
    assert.equal(Number(row.payload.corrections),row.expected.remoteCorrectionScalars);
    assert.equal(Number(row.payload.probes),0);
   }
   if(networkId==='feeder24')assert.match(inspected.archive,/Archived frozen protocol/);
   const saved=await page.evaluate(()=>window.openai.widgetState);assert.equal(saved.privateContent.version,14);
   await page.reload({waitUntil:'networkidle'});const restored=await read(page);
   for(const field of ['t','cumulative','states','commandQ','lastExecution'])assert.deepEqual(restored.s[field],final.s[field],field+' exact UI replay');
   await page.screenshot({path:path.join(output,networkId+(mobile?'-phone':'-desktop')+'.png'),fullPage:true});
   await page.locator('.pr-matrix-panel').screenshot({path:path.join(output,networkId+(mobile?'-phone':'-desktop')+'-inspection.png')});
   const next=networkId==='toy8'?'feeder47':'toy8';await page.locator('#pr-network-scenario').selectOption(next);
   const switched=await read(page);assert.equal(switched.s.t,0);assert.equal(switched.ui.playing,false);assert.equal(switched.s.protocol,'continuous-phi-v1');
   const handoffs=[];
   for(const action of ['restart','new-scenario','network-scenario']){
    await pause(page);
    await page.evaluate(networkId=>sessionStorage.setItem('online-sls-demo-test-restore',JSON.stringify({privateContent:{
      version:13,networkId,phase:'discovery',t:8,events:[],selectedBus:7,speed:'32',view:'learning',matrixView:'links',intervention:'forecast',automaticComparison:false,
      initialOptions:{networkId,experiment:'communication',powerScenario:'reference',beta:4,preset:'mixed',seed:20261013,horizon:180}
    }})),networkId);
    await page.reload({waitUntil:'networkidle'});
    const archived=await read(page);assert.equal(archived.s.t,8);assert.notEqual(archived.s.protocol,'continuous-phi-v1');
    assert.equal(archived.ui.playing,false);assert.match(await page.locator('#pr-scenario-name').textContent(),/Archived trial/);
    await setting(page,'view','cost');
    await page.locator('#pr-cost-gap').click();await page.locator('#pr-cost-total').click();
    assert.deepEqual((await read(page)).s,archived.s,'Read only cost controls preserve the actual archived replay');
    if(action==='restart')await page.screenshot({path:path.join(output,label+'-archived-before-handoff.png'),fullPage:true});
    if(action==='network-scenario')await page.locator('#pr-network-scenario').selectOption(networkId==='toy8'?'feeder47':'toy8');
    else if(action==='new-scenario')await settings(page,()=>page.locator('#pr-new-scenario').click());
    else await page.locator('#pr-restart').click();
    const fresh=await read(page);assert.equal(fresh.s.protocol,'continuous-phi-v1');assert.equal(fresh.s.phase,'ongoing');
    assert.equal(fresh.s.historyLength,fresh.s.t);assert.equal(fresh.ui.playing,action==='new-scenario');
    assert.deepEqual(fresh.ui.activeAttackBuses,[]);assert.doesNotMatch(await page.locator('#pr-scenario-name').textContent(),/Archived trial/);
    if(action!=='new-scenario'){assert.equal(fresh.s.t,0);assert.ok(Object.values(fresh.s.cumulative).every(v=>v===0));}
    if(action==='restart')await page.screenshot({path:path.join(output,label+'-handoff-restart.png'),fullPage:true});
    await pause(page);const exact=await read(page);assert.equal((await page.evaluate(()=>window.openai.widgetState)).privateContent.version,14);
    await page.reload({waitUntil:'networkidle'});
    for(const field of ['t','cumulative','states','commandQ','lastExecution'])assert.deepEqual((await read(page)).s[field],exact.s[field],'Handoff exact replay '+action+' '+field);
    handoffs.push({action,protocol:exact.s.protocol,t:exact.s.t,passed:true});
   }
   console.log('ARCHIVED_HANDOFF '+JSON.stringify({networkId,mobile,handoffs}));
   results.push({networkId,mobile,actions:final.s.t,nativePlayback:nativeMetrics,profiles,handoffs,costs:final.s.cumulative,updates:final.s.learning.sourceUpdates,traffic:final.s.traffic,passed:true});
   console.log('Ongoing UI passed '+networkId+' '+(mobile?'phone':'desktop')+' '+final.s.t+' actions');
   await context.close();
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({passed:true,results,errors,pixelReview:'Screenshots captured for separate actual pixel inspection. Assertions are not pixel approval.'},null,2));
 }catch(error){
  if(browser)for(const [i,context]of browser.contexts().entries()){const page=context.pages().at(-1);if(page)await page.screenshot({path:path.join(output,'failure-'+i+'.png'),fullPage:true}).catch(()=>{});}
  await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,results,errors},null,2));throw error;
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
