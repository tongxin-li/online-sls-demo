'use strict';
// Real ongoing UI interactions through saved protocol 14. The public default
// remains legacy until this route and pixel review pass; no controller test hook.
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
 const read=page=>page.evaluate(()=>{const d=document.querySelector('#power-response-demo').powerDemo;return {s:d.getSnapshot(),ui:d.getState(),evidence:d.getLinkEvidence()};});
 const settings=async(page,fn)=>{const box=page.locator('#pr-adaptation');const open=await box.getAttribute('open')!==null;if(!open)await box.locator('summary').first().click();await fn();if(!open)await box.locator('summary').first().click();};
 const setting=(page,id,value)=>settings(page,()=>page.locator('#pr-'+id).selectOption(value));
 const pause=async page=>{if((await read(page)).ui.playing)await page.locator('#pr-run').click();};
 const advance=page=>settings(page,async()=>{await page.locator('#pr-compare').click();await page.waitForFunction(()=>!document.querySelector('#pr-compare').disabled);});
 try{
  browser=await chromium.launch({headless:true});
  for(const mobile of [false,true])for(const networkId of ['toy8','feeder24','feeder47']){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
   await context.addInitScript(({networkId})=>{
    const state={privateContent:{version:14,networkId,phase:'ongoing',t:0,selectedBus:7,speed:'32',view:'cost',matrixView:'change',intervention:'forecast',
     continuousRecord:{version:14,protocol:'continuous-phi-v1',networkId,options:{networkId,protocol:'continuous-phi-v1',experiment:'communication',powerScenario:'forecasted-demand',beta:4,preset:'mixed',seed:20261013},steps:0,events:[]}}};
    window.openai={widgetState:state,setWidgetState:async value=>{window.__savedTrial=value;}};
   },{networkId});
   const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(address,{waitUntil:'networkidle'});
   assert.equal((await read(page)).s.protocol,'continuous-phi-v1');
   await page.locator('#pr-run').click();await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=35);
   await page.locator('#pr-cost-gap').click();assert.equal((await read(page)).ui.playing,true);
   await page.locator('#pr-cost-total').click();await pause(page);
   const initial=await read(page),edge=initial.s.deployedSupport.links.find(e=>e.from!==e.to);
   const cell=page.locator('#pr-matrix .matrix-cell[data-receiver="'+edge.to+'"][data-source="'+edge.from+'"]');
   await cell.scrollIntoViewIfNeeded();if(mobile)await cell.tap();else{await cell.focus();await page.keyboard.press('Enter');}
   assert.equal((await read(page)).ui.inspectedSource,edge.from);
   await page.locator('#pr-source-fault').click();
   await advance(page);const first=await read(page);
   assert.ok(first.s.t>180);assert.equal(first.s.phase,'ongoing');assert.equal(first.ui.comparisonComplete,false);
   assert.equal(first.evidence.ongoing,true);
   await page.locator('#pr-source-fault').click();
   await advance(page);const second=await read(page);assert.ok(second.s.t>360);assert.equal(second.s.history.length,second.s.t);
   assert.ok(second.s.cumulative.online>=first.s.cumulative.online);
   await page.locator('#pr-intervention').selectOption('power');
   await setting(page,'bus','7');await page.locator('#pr-pulse').click();
   await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getState().activeAttackBuses.includes(7));
   await setting(page,'bus','5');await page.locator('#pr-pulse').click();
   await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>370);
   await page.locator('#pr-stop-attacks').click();await pause(page);
   for(let i=0;i<3;i++)await advance(page);
   const final=await read(page);assert.ok(final.s.t>900);assert.equal(final.s.phase,'ongoing');assert.equal(final.ui.comparisonComplete,false);
   assert.equal(final.s.history.length,final.s.t);assert.equal(final.s.mode,'running');
   assert.ok(final.s.learning.sourceUpdates>second.s.learning.sourceUpdates);
   for(const key of ['online','scalar','static','causal']){
    assert.ok(final.s.cumulative[key]>=second.s.cumulative[key]);
    assert.ok(final.s.commandQ[key].every(value=>Math.abs(value)<=70+1e-8));
   }
   assert.equal(await page.locator('#pr-cost-detail tr').count(),4);assert.equal(await page.locator('.pr-panel').count(),4);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   assert.match(await page.locator('#pr-transition-note').textContent(),/No reset or stop/);
   const saved=await page.evaluate(()=>window.__savedTrial);assert.equal(saved.privateContent.version,14);
   await context.addInitScript(saved=>{window.openai.widgetState=saved;},saved);
   await page.reload({waitUntil:'networkidle'});const restored=await read(page);
   for(const field of ['t','cumulative','states','commandQ','lastExecution'])assert.deepEqual(restored.s[field],final.s[field],field+' exact UI replay');
   await page.screenshot({path:path.join(output,networkId+(mobile?'-phone':'-desktop')+'.png'),fullPage:true});
   const next=networkId==='toy8'?'feeder47':'toy8';await page.locator('#pr-network-scenario').selectOption(next);
   const switched=await read(page);assert.equal(switched.s.t,0);assert.equal(switched.ui.playing,false);assert.equal(switched.s.protocol,'continuous-phi-v1');
   results.push({networkId,mobile,actions:final.s.t,costs:final.s.cumulative,updates:final.s.learning.sourceUpdates,traffic:final.s.traffic,passed:true});
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
