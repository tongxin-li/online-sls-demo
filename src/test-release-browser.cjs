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
 let server,browser;const results=[],errors=[],expected={};
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
    }catch(_){status='network error';}
    if(actual===expected[file])break;
    if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,2500));
   }
   assert.equal(actual,expected[file],'Exact built bytes for '+file+' at '+url+' status '+status);
   verified[file]={sha256:actual,status};
  }
  browser=await chromium.launch({headless:true,...(process.env.DEMO_BROWSER_CHANNEL?{channel:process.env.DEMO_BROWSER_CHANNEL}:{})});
  const read=page=>page.evaluate(()=>{const root=document.querySelector('#power-response-demo'),api=root.powerDemo,s=api.getSnapshot();
   const row=window.PowerDemo.forNetwork(root.dataset.network).constants.inverterBuses.indexOf(7),j=5,p=s.lastExecution?.policies.online;
   return {network:s.networkId,protocol:s.protocol,phase:s.phase,t:s.t,history:s.history.length,samples:s.sampleCount,
    costs:s.cumulative,states:s.states,commandQ:s.commandQ,lastExecution:s.lastExecution,
    gain:p?.gainNorms[row][j]??null,currentGain:p?.currentGains[row][j]??null,responseGains:p?.gainNorms??null,
    topologyAdaptive:s.deployedSupport?.topologyAdaptive,learning:s.learning,
    faulty:s.faults.includes(7),playing:api.getState().playing,attacks:api.getState().activeAttackBuses};
  });
  for(const mobile of [false,true])for(const network of ['toy8','feeder24','feeder47']){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
   const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
   const response=await page.goto(address,{waitUntil:'networkidle'});
   assert.equal(hash(await response.body()),expected['index.html'],'Browser receives the same tested page bytes');
   if(network!=='feeder24')await page.locator('#pr-network-scenario').selectOption(network);
   const fresh=await read(page);assert.equal(fresh.network,network);assert.equal(fresh.protocol,'adaptive-phi-v2');
   assert.equal(fresh.topologyAdaptive,true,'Fresh release executes online response and topology adaptation');
   assert.equal(fresh.t,0);assert.equal(fresh.playing,false);
   const settings=page.locator('#pr-adaptation');await settings.locator('summary').first().click();
   await page.locator('#pr-speed').selectOption('32');await settings.locator('summary').first().click();
   const activate=async selector=>{const node=page.locator(selector);if(mobile)await node.tap();else await node.click();};
   const until=target=>page.waitForFunction(target=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=target,target,{timeout:120000,polling:100});
   await activate('#pr-run');await until(40);const before=await read(page);
   await activate('#pr-cost-gap');await activate('#pr-cost-total');
   assert.equal((await read(page)).playing,true,'Cost controls preserve playback');
   await activate('#pr-pulse');assert.equal((await read(page)).faulty,true);
   await until(before.t+75);const corrupted=await read(page);
   assert.ok(responseDistance(corrupted.responseGains,before.responseGains)>1e-8,'Executed response matrices continue adapting after source corruption');
   await activate('#pr-pulse');assert.equal((await read(page)).faulty,false);
   await until(corrupted.t+75);const repaired=await read(page);
   assert.ok(responseDistance(repaired.responseGains,corrupted.responseGains)>1e-8,'Executed response matrices continue adapting after source repair');
   assert.ok(repaired.t>180);assert.equal(repaired.phase,'ongoing');assert.equal(repaired.playing,true);
   await page.locator('#pr-intervention').selectOption('power');await activate('#pr-pulse');
   await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getState().activeAttackBuses.includes(7));
   const attack=await read(page);await until(attack.t+5);
   await activate('#pr-stop-attacks');if((await read(page)).playing)await activate('#pr-run');
   const final=await read(page);assert.equal(final.history,final.t);assert.equal(final.samples,final.t);
   assert.ok(final.lastExecution.trainedThrough<final.lastExecution.action);
   for(const key of ['online','scalar','static','causal']){
    assert.ok(final.costs[key]>before.costs[key]);assert.ok(final.commandQ[key].every(value=>Math.abs(value)<=70+1e-8));
   }
   assert.equal(await page.locator('#pr-cost-detail tr').count(),4);
   assert.equal(await page.locator('#pr-cost path.data-series').count(),4);
   await page.reload({waitUntil:'networkidle'});const replay=await read(page);
   for(const field of ['t','costs','states','commandQ','lastExecution'])assert.deepEqual(replay[field],final[field],'Exact deployed replay '+field);
   await page.screenshot({path:path.join(output,network+(mobile?'-phone':'-desktop')+'.png'),fullPage:true});
   const checkpoint=value=>({t:value.t,gain:value.gain,currentGain:value.currentGain,responseGains:value.responseGains,
    action:value.lastExecution.action,trainedThrough:value.lastExecution.trainedThrough});
   const result={network,mobile,actions:final.t,before:checkpoint(before),corrupted:checkpoint(corrupted),repaired:checkpoint(repaired),costs:final.costs,exactReplay:true,passed:true};
   results.push(result);console.log('RELEASE_PLAYBACK '+JSON.stringify(result));await context.close();
  }
  assert.deepEqual(errors,[]);
  const evidence={passed:true,mode:live?'canonical public':'same built local candidate',url:live?canonical:null,revision:process.env.GITHUB_SHA||null,verified,results,errors};
  await fs.writeFile(path.join(output,'release-verification.json'),JSON.stringify(evidence,null,2));
  console.log('RELEASE_VERIFICATION '+JSON.stringify(evidence));
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
