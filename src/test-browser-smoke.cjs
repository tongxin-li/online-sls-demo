'use strict';

// Cloud browser validation only. Playwright is installed outside the repository.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

async function main() {
  let root = path.resolve(__dirname, '..');
  try { await fs.access(path.join(root, 'index.html')); }
  catch (_) { root = __dirname; }
  let entry = 'index.html';
  try { await fs.access(path.join(root, entry)); }
  catch (_) { entry = 'power-response-demo.html'; }
  const output = process.env.DEMO_SMOKE_OUTPUT || path.join(root, 'browser-results');
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, pathname === '/' ? entry : '.' + pathname);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch (_) { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [];
  const startedAt = performance.now(), timings = [];
  const mark = async name => {
    const elapsedSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(3));
    timings.push({ name, elapsedSeconds });
    console.log('Browser milestone ' + name + ' ' + elapsedSeconds + 's');
    await fs.writeFile(path.join(output, 'timings.json'), JSON.stringify({ timings }, null, 2));
  };
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.DEMO_SMOKE_CHANNEL ? { channel: process.env.DEMO_SMOKE_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    const address = `http://127.0.0.1:${server.address().port}`;
    await page.goto(address, { waitUntil: 'networkidle' });
    await page.locator('#pr-run').waitFor();
    await page.locator('#pr-speed').selectOption('32');
    const sample = async () => Number((await page.locator('#pr-clock').textContent()).match(/t = (\d+)/)[1]);
    const waitSamples = async count => {
      const initial = await sample();
      await page.waitForFunction(target => {
        const text = document.querySelector('#pr-clock').textContent;
        return Number(text.match(/t = (\d+)/)[1]) >= target;
      }, initial + count);
    };
    const pause = async () => {
      if (await page.locator('#pr-run').textContent() === 'Pause') await page.locator('#pr-run').click();
    };
    const checkVoltageMetrics = async surface => {
      const result=await surface.evaluate(()=>{
        const root=document.querySelector('#power-response-demo'),snapshot=root.powerDemo.getSnapshot();
        const rows=Array.from(document.querySelectorAll('#pr-voltage-metrics tr')).map(row=>({
          key:row.dataset.controller,current:Number(row.dataset.currentPu),peak:Number(row.dataset.peakPu),
          limited:Number(row.dataset.limited),shownCurrent:row.querySelector('.current-deviation').textContent,
          shownPeak:row.querySelector('.peak-deviation').textContent,shownLimited:row.querySelector('.limited-inverters').textContent
        }));
        const expected=Object.fromEntries(['online','scalar','static','causal'].map(key=>{
          const deviation=values=>Math.max(...values.map((value,i)=>Math.abs(1+value-snapshot.referenceVoltage[i])));
          const current=deviation(snapshot.states[key]);
          const peak=Math.max(current,...snapshot.initialVoltage.map((value,i)=>Math.abs(value-snapshot.referenceVoltage[i])),
            ...snapshot.history.map(entry=>deviation(entry.states[key])));
          return [key,{current,peak,limited:snapshot.saturation[key].filter(Boolean).length}];
        }));
        return {rows,expected,detail:document.querySelector('#pr-voltage-detail').textContent};
      });
      assert.deepEqual(result.rows.map(row=>row.key),['online','scalar','static','causal'],'All four controller diagnostics remain present');
      for(const row of result.rows) {
        const expected=result.expected[row.key];
        assert.ok(Math.abs(row.current-expected.current)<1e-12,'Current diagnostic matches measured nominal departure');
        assert.ok(Math.abs(row.peak-expected.peak)<1e-12,'Peak includes actual executed states in this phase');
        assert.equal(row.limited,expected.limited);
        assert.equal(row.shownCurrent,(1000*expected.current).toFixed(2));
        assert.equal(row.shownPeak,(1000*expected.peak).toFixed(2));
        assert.equal(row.shownLimited,expected.limited+'/8');
      }
      assert.match(result.detail,/Δ .* mpu/);
    };
    const checkForecastObservation = async surface => {
      const reading=await surface.evaluate(()=>{
        const root=document.querySelector('#power-response-demo'),snapshot=root.powerDemo.getSnapshot(),state=root.powerDemo.getState();
        const panel=document.querySelector('#pr-forecast-observation'),values=document.querySelector('#pr-forecast-values');
        const active=state.inspectedSource!==null&&[5,7,8,12,14,18,21,24].includes(state.selectedBus);
        const sample=snapshot.lastSample,index=state.inspectedSource-1;
        return {hidden:panel.hidden,valuesHidden:values.hidden,data:{...panel.dataset},active,
          expected:active&&state.historyIndex===null&&sample?{source:state.inspectedSource,receiver:state.selectedBus,
            action:sample.t,issuedAt:Math.max(0,sample.t-4),observedAt:sample.t+1,
            forecast:sample.forecast[index],realized:sample.disturbance[index],error:sample.forecast[index]-sample.disturbance[index]}:null,
          shown:Object.fromEntries(['forecast','realized','error'].map(key=>[key,document.querySelector('#pr-observed-'+key).textContent])),
          context:document.querySelector('#pr-forecast-support').textContent,phase:snapshot.phase};
      });
      assert.equal(reading.hidden,!reading.active);
      assert.equal(reading.valuesHidden,!reading.expected);
      assert.equal(reading.data.available,String(!!reading.expected));
      if(reading.expected){
        for(const [key,value] of Object.entries(reading.expected))assert.equal(Number(reading.data[key]),value,'Observed '+key+' matches the actual revealed pair');
        for(const key of ['forecast','realized','error'])assert.equal(reading.shown[key],(1000*reading.expected[key]).toFixed(3));
        assert.match(reading.context,reading.phase==='discovery'?/Discovery uses dense messages/:/deployed support.*Links fixed/);
      }else assert.equal(reading.data.forecast,'','Unavailable observations clear stale numeric metadata');
    };
    const checkSourceHistory = async surface => {
      const reading=await surface.evaluate(()=>{
        const root=document.querySelector('#power-response-demo'),snapshot=root.powerDemo.getSnapshot(),state=root.powerDemo.getState();
        const window=document.querySelector('#pr-forecast-window'),change=document.querySelector('#pr-forecast-change');
        return {snapshot:{t:snapshot.t,eventLog:snapshot.eventLog,lastSample:snapshot.lastSample?{forecast:snapshot.lastSample.forecast,disturbance:snapshot.lastSample.disturbance}:null},state,window:{...window.dataset},change:{...change.dataset},text:window.textContent,timing:change.textContent};
      });
      const {snapshot,state,window,change}=reading;
      const active=state.inspectedSource!==null&&[5,7,8,12,14,18,21,24].includes(state.selectedBus)&&state.historyIndex===null;
      assert.equal(window.available,String(!!active&&snapshot.t>0));
      if(active&&snapshot.t>0){
        assert.equal(Number(window.count),Math.min(60,snapshot.t));
        assert.equal(Number(window.firstObservedAt),Math.max(1,snapshot.t-59));assert.equal(Number(window.lastObservedAt),snapshot.t);
        assert.ok(Number(window.rmse)>=Math.abs(Number(window.bias))-1e-12);
        assert.match(reading.text,/revealed pairs.*RMSE.*mpu.*Bias.*mpu/);
      }else assert.equal(window.rmse,'','No stale or future statistics');
      const event=active?snapshot.eventLog.filter(event=>event.type==='forecast'&&event.bus===state.inspectedSource).at(-1):null;
      assert.equal(change.available,String(!!event));
      if(event){
        const issuedAt=Math.max(1,event.t),target=issuedAt+4;
        assert.equal(Number(change.changedAt),event.t);assert.equal(Number(change.issuedAt),issuedAt);
        assert.equal(Number(change.firstAction),target);assert.equal(Number(change.pairAt),target+1);
        assert.equal(change.issued,String(snapshot.t>issuedAt));assert.equal(change.observed,String(snapshot.t>target));
        assert.equal(Number(change.pairsInWindow),Math.min(60,Math.max(0,snapshot.t-target)));
      }
      return reading;
    };
    const checkCommandInspection = async surface => {
      const result=await surface.evaluate(()=>{
        const root=document.querySelector('#power-response-demo'),snapshot=root.powerDemo.getSnapshot(),state=root.powerDemo.getState();
        return {snapshot:{lastSample:snapshot.lastSample?{t:snapshot.lastSample.t}:null,commandQ:snapshot.commandQ,saturation:snapshot.saturation},state,rows:Array.from(document.querySelectorAll('#pr-command-rows tr')).map(row=>({
          data:{...row.dataset},shown:Array.from(row.querySelectorAll('td')).map(cell=>cell.textContent),title:row.title
        }))};
      });
      const {snapshot,state,rows}=result,active=state.inspectedSource!==null&&[5,7,8,12,14,18,21,24].includes(state.selectedBus)&&state.historyIndex===null&&snapshot.lastSample;
      assert.equal(rows.length,active?4:0,'No pending or historical commands presented as current');
      if(!active)return;
      assert.deepEqual(rows.map(row=>row.data.controller),['online','scalar','static','causal']);
      for(const row of rows){
        const data=row.data,key=data.controller,source=Number(data.sourceKvar),other=Number(data.otherKvar),feedback=Number(data.feedbackKvar),request=Number(data.requestedKvar),command=Number(data.commandKvar);
        assert.equal(Number(data.source),state.inspectedSource);assert.equal(Number(data.receiver),state.selectedBus);
        assert.equal(Number(data.action),snapshot.lastSample.t);
        assert.ok(Math.abs(source+other+feedback-request)<1e-8,'Parts reconstruct the request');
        assert.equal(command,snapshot.commandQ[key][state.selectedBus-1]);
        assert.ok(Math.abs(command-Math.max(-70,Math.min(70,request)))<1e-8,'Limiter matches actual executed command');
        assert.equal(data.limited,String(snapshot.saturation[key][state.selectedBus-1]));
        assert.ok(Number.isFinite(Number(data.gainNorm)));
        assert.match(row.title,/Temporal source gain norm/);
        const format=value=>(Math.abs(value)<.0005?0:value).toFixed(3);
        assert.deepEqual(row.shown,[...[source,other,feedback,request,command].map(format),Number(data.gainNorm).toPrecision(4)]);
        assert.ok(row.shown[5].length>0,'Temporal source gain is visible without hover');
        if(key==='causal'){assert.equal(source,0);assert.equal(other,0);assert.equal(Number(data.gainNorm),0);}
      }
    };
    const checkProtocol = async surface => {
      const reading=await surface.evaluate(()=>{
        const root=document.querySelector('#power-response-demo'),snapshot=root.powerDemo.getSnapshot(),state=root.powerDemo.getState();
        const phase=document.querySelector('#pr-phase');
        return {snapshot:{phase:snapshot.phase,experiment:snapshot.experiment,t:snapshot.t,discoveryRecord:snapshot.discoveryRecord?{t:snapshot.discoveryRecord.t}:null},state,data:{...phase.dataset},badge:phase.textContent,note:document.querySelector('#pr-phase-note').textContent,
          title:document.querySelector('#pr-matrix-title').textContent};
      });
      const {snapshot,state,data}=reading,deployed=snapshot.phase==='deployment',saved=state.historyIndex!==null;
      assert.equal(data.phase,snapshot.phase);
      assert.equal(data.view,saved?'saved-discovery':deployed?'comparison':'discovery');
      assert.equal(Number(data.discoverySamples),deployed?snapshot.discoveryRecord.t:snapshot.t);
      assert.equal(Number(data.comparisonSamples),deployed?snapshot.t:0);
      assert.equal(data.selection,deployed?'complete':'pending');assert.equal(data.synthesis,deployed?'complete':'pending');
      assert.equal(data.links,deployed?'fixed':'candidates');
      assert.equal(data.predictionWeights,deployed&&snapshot.experiment==='communication'?'fixed':'adaptive');
      if(saved){
        assert.match(reading.note,/Saved discovery links.*Plant and costs remain/);
        assert.match(reading.title,/Discovery links at/);
      }else if(deployed)assert.match(reading.note,/Offline selection and synthesis complete.*discovery samples.*Links/);
      else {assert.match(reading.badge,/Discovery/);assert.match(reading.note,/Dense discovery/);}
      return reading;
    };

    const checkEventMarkers = async surface => {
      const result=await surface.evaluate(()=>{
        const snapshot=document.querySelector('#power-response-demo').powerDemo.getSnapshot();
        return {snapshot:{t:snapshot.t,eventLog:snapshot.eventLog},charts:['pr-cost','pr-stage','pr-voltage'].map(id=>{
          const svg=document.getElementById(id),frame=svg.querySelector('[data-chart-frame]');
          return {id,hidden:svg.hidden||svg.style.display==='none',frame:frame?{x:Number(frame.getAttribute('x')),w:Number(frame.getAttribute('width'))}:null,
            badges:Array.from(svg.querySelectorAll('.intervention-badge')).map(node=>({data:{...node.dataset},label:node.getAttribute('aria-label'),title:node.querySelector('title').textContent})),
            lines:Array.from(svg.querySelectorAll('.intervention-markers line')).map(node=>({x1:Number(node.getAttribute('x1')),x2:Number(node.getAttribute('x2'))}))};
        })};
      });
      const snapshot=result.snapshot;
      for(const chart of result.charts.filter(chart=>!chart.hidden)){
        const domain=[chart.id==='pr-cost'?0:Math.max(0,snapshot.t-80),Math.max(1,snapshot.t)];
        const expected=snapshot.eventLog.map((event,order)=>({...event,order,type:event.type==='fault'?'forecast':event.type}))
          .filter(event=>['forecast','pulse','scenario'].includes(event.type)&&(event.type==='forecast'?event.t<=snapshot.t:event.t<snapshot.t))
          .map(event=>({...event,at:event.t+(event.type==='forecast'?0:1)}))
          .filter(event=>event.at>=domain[0]&&event.at<=domain[1]).sort((a,b)=>a.at-b.at||a.order-b.order);
        const times=chart.badges.flatMap(badge=>badge.data.eventSteps.split(',').map(Number));
        const types=chart.badges.flatMap(badge=>badge.data.eventTypes.split(','));
        assert.deepEqual(times,expected.map(event=>event.at),'Markers use actual setting time or first physical state time');
        assert.deepEqual(types,expected.map(event=>event.type),'No mixed events are relabeled as forecasts');
        assert.equal(chart.lines.length,chart.badges.length);
        for(let i=0;i<chart.badges.length;i++){
          const {data}=chart.badges[i],kinds=data.eventTypes.split(',');
          assert.equal(Number(data.disturbanceCount),kinds.filter(type=>type==='pulse').length);
          assert.equal(Number(data.forecastCount),kinds.filter(type=>type==='forecast').length);
          assert.equal(Number(data.scenarioCount),kinds.filter(type=>type==='scenario').length);
          const at=Number(data.eventSteps.split(',')[0]),x=chart.frame.x+2+(at-domain[0])/(domain[1]-domain[0])*(chart.frame.w-4);
          assert.ok(Math.abs(chart.lines[i].x1-x)<1e-7,'Marker geometry uses the current chart scale immediately');
          assert.equal(chart.lines[i].x1,chart.lines[i].x2);
        }
      }
    };

    const checkPlots = async () => {
      await checkEventMarkers(page);
      await checkVoltageMetrics(page);
      await checkProtocol(page);
      await checkForecastObservation(page);
      await checkSourceHistory(page);
      await checkCommandInspection(page);
      for (const chart of ['pr-cost', 'pr-stage', 'pr-voltage']) {
        const paths = await page.locator(`#${chart} path.data-series`).evaluateAll(elements => elements.map(element => element.getAttribute('d')));
        assert.equal(paths.length, 4, `${chart} retains all four controller curves`);
        assert.ok(paths.every(value => value && !/NaN|Infinity/.test(value)), `${chart} has finite measured paths`);
        assert.ok(await page.locator(`#${chart} .y-axis .tick`).count() < 12, `${chart} does not accumulate axis labels`);
      }
    };


    const checkKeyboardInspection = async () => {
      const before=await page.evaluate(()=>JSON.stringify(document.querySelector('#power-response-demo').powerDemo.getSnapshot()));
      let receiver=5,source=7;
      const current=()=>page.locator('#pr-matrix .matrix-cell[data-receiver="'+receiver+'"][data-source="'+source+'"]');
      await current().focus();
      for(const [key,nextReceiver,nextSource] of [['Enter',5,7],['ArrowRight',5,8],['ArrowDown',7,8],['Home',7,2],['End',7,24],['ArrowUp',5,24],[' ',5,24]]) {
        await current().press(key===' '?'Space':key);receiver=nextReceiver;source=nextSource;
        const reading=await page.evaluate(()=>{
          const root=document.querySelector('#power-response-demo');
          return {state:root.powerDemo.getState(),snapshot:JSON.stringify(root.powerDemo.getSnapshot()),
            focused:{source:document.activeElement.dataset.source,receiver:document.activeElement.dataset.receiver}};
        });
        assert.equal(reading.state.selectedBus,receiver);assert.equal(reading.state.inspectedSource,source);
        assert.equal(reading.state.playing,false);assert.equal(reading.snapshot,before,'Keyboard inspection cannot change the experiment');
        assert.equal(reading.focused.source,String(source));assert.equal(reading.focused.receiver,String(receiver));
        const connected=await current().getAttribute('data-connected')==='true';
        assert.equal(await page.locator('#pr-network .recommended path[data-inspected="true"]').count(),connected&&receiver!==source?1:0);
        assert.equal(await page.locator('#pr-matrix .matrix-cell[tabindex="0"]').count(),1,'Exactly one matrix cell is in the tab sequence');
      }
      // Native disclosure activation must not trigger the global playback shortcut.
      const title=page.locator('#pr-command-title'),open=await page.locator('#pr-command-inspector').getAttribute('open');
      await title.focus();await title.press('Space');
      assert.equal(await page.locator('#pr-command-inspector').getAttribute('open'),open===null?'':null);
      assert.equal(await page.evaluate(()=>document.querySelector('#power-response-demo').powerDemo.getState().playing),false);
      await title.press('Space');await checkCommandInspection(page);
    };

    const inspectLinks = async () => {
      const before = await page.evaluate(() => JSON.stringify(document.querySelector('#power-response-demo').powerDemo.getSnapshot()));
      const edge = await page.locator('#pr-matrix .matrix-cell[data-connected="true"]').evaluateAll(cells => {
        const cell=cells.find(cell=>cell.dataset.receiver!==cell.dataset.source);
        return {receiver:Number(cell.dataset.receiver),source:Number(cell.dataset.source)};
      });
      const inspect = async (source,connected,local=false) => {
        await page.locator('#pr-matrix .matrix-cell[data-receiver="'+edge.receiver+'"][data-source="'+source+'"]').click();
        const reading=await page.evaluate(() => {
          const root=document.querySelector('#power-response-demo');
          return {state:root.powerDemo.getState(),snapshot:JSON.stringify(root.powerDemo.getSnapshot())};
        });
        await checkForecastObservation(page);
      await checkSourceHistory(page);
      await checkCommandInspection(page);
        assert.equal(reading.snapshot,before,'Inspection changes no physical, forecast or control state');
        assert.equal(reading.state.selectedBus,edge.receiver);
        assert.equal(reading.state.inspectedSource,source);
        assert.equal(reading.state.playing,false);
        assert.equal(await page.locator('#pr-network [data-bus="'+source+'"]').getAttribute('data-inspection-role'),local?'local':'source');
        if(!local) assert.equal(await page.locator('#pr-network [data-bus="'+edge.receiver+'"]').getAttribute('data-inspection-role'),'receiver');
        const arcs=page.locator('#pr-network .recommended path[data-inspected="true"]');
        assert.equal(await arcs.count(),connected&&!local?1:0,'Highlight only the actual remote connection');
        if(connected&&!local) {
          assert.equal(await arcs.getAttribute('data-from'),String(source));
          assert.equal(await arcs.getAttribute('data-to'),String(edge.receiver));
          assert.notEqual(await arcs.getAttribute('data-change'),'removed');
        }
        assert.match(await page.locator('#pr-network').getAttribute('aria-description'),local?/Local source/:connected?/Selected link/:/No link/);
      };
      await inspect(edge.source,true);
      const absent=await page.locator('#pr-matrix .matrix-cell[data-receiver="'+edge.receiver+'"][data-connected="false"]').first().getAttribute('data-source');
      await inspect(Number(absent),false);
      await inspect(edge.receiver,true,true);
      await inspect(edge.source,true);
      const sourceState=async()=>page.evaluate(()=>{
        const root=document.querySelector('#power-response-demo'),snapshot=root.powerDemo.getSnapshot(),state=root.powerDemo.getState();
        return {faults:snapshot.faults,state:{selectedBus:state.selectedBus,inspectedSource:state.inspectedSource,playing:state.playing},
          unchanged:JSON.stringify({t:snapshot.t,phase:snapshot.phase,states:snapshot.states,cumulative:snapshot.cumulative,
            support:snapshot.deployedSupport,lastInputs:snapshot.lastInputs,pending:snapshot.pendingPulses,active:snapshot.activePulses,recommendations:snapshot.recommendations})};
      });
      const initial=await sourceState();
      for(let i=0;i<2;i++) {
        const prior=await sourceState(),wasNoisy=prior.faults.includes(edge.source);
        assert.equal(await page.locator('#pr-source-fault').getAttribute('aria-label'),(wasNoisy?'Repair':'Corrupt')+' forecast source at bus '+edge.source);
        await page.locator('#pr-source-fault').click();
        const after=await sourceState();
        await checkEventMarkers(page);
        await checkForecastObservation(page);
      await checkSourceHistory(page);
      await checkCommandInspection(page);
        assert.equal(after.faults.includes(edge.source),!wasNoisy,'Each explicit action toggles once');
        assert.deepEqual(after.faults.filter(bus=>bus!==edge.source),initial.faults.filter(bus=>bus!==edge.source),'Only inspected source changes');
        assert.deepEqual(after.state,initial.state,'Receiver, source selection and pause state remain unchanged');
        assert.equal(after.unchanged,initial.unchanged,'Reliability actions do not rewrite controls, state, costs or topology');
      }
      assert.deepEqual((await sourceState()).faults,initial.faults,'Second action repairs or corrupts back to initial state');
    };
    await mark('loaded');
    await checkKeyboardInspection();
    await inspectLinks();
    await mark('discovery inspection');
    await checkVoltageMetrics(page);
    await checkProtocol(page);
    await page.locator('#pr-command-title').click();
    assert.equal(await page.locator('#pr-command-inspector').getAttribute('open'),'');

    // Ordinary playback and repeated forecast toggles use the actual bus targets.
    await page.locator('#pr-run').click();
    await waitSamples(3);
    await pause();
    await page.getByRole('button', { name: 'Corrupt forecast at bus 7', exact: true }).click();
    await waitSamples(2);
    await page.getByRole('button', { name: 'Repair forecast at bus 7', exact: true }).click();
    await waitSamples(2);
    await pause();

    // A continuous bus attack survives the automatic learning handoff.
    await page.locator('#pr-intervention').selectOption('power');
    await page.getByRole('button', { name: 'Toggle continuous attack at bus 23', exact: true }).click();
    await waitSamples(3);
    assert.equal(await page.locator('#pr-pulse').getAttribute('aria-pressed'), 'true');
    await page.locator('#pr-adaptation > summary').click();
    await page.locator('#pr-compare').click();
    await page.waitForFunction(() => document.querySelector('#pr-phase').dataset.phase === 'deployment' && !document.querySelector('#pr-compare').disabled);
    assert.equal(await page.locator('#pr-pulse').getAttribute('aria-pressed'), 'true');
    await waitSamples(3);
    await page.locator('#pr-pulse').click();
    assert.equal(await page.locator('#pr-pulse').getAttribute('aria-pressed'), 'false');
    await pause();
    await page.locator('#pr-adaptation > summary').click();
    assert.equal(await page.locator('#pr-cost-detail tr').count(), 4);
    await checkPlots();
    await checkKeyboardInspection();
    await inspectLinks();

    await mark('comparison handoff and inspection');

    // Archived discovery connectivity is not a change to the deployed controller.
    const liveBefore=await page.evaluate(()=>JSON.stringify(document.querySelector('#power-response-demo').powerDemo.getSnapshot()));
    assert.ok(Number(await page.locator('#pr-topology-history').getAttribute('max'))>0,'Discovery produced inspectable link changes');
    await page.locator('#pr-topology-history').press('Home');
    await checkProtocol(page);
    assert.equal(await page.locator('#pr-matrix .matrix-columns text[data-noisy="true"]').count(),0,'Current quality is not painted onto historical links');
    assert.equal(await page.locator('#pr-source-fault').isDisabled(),true);
    assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('#power-response-demo').powerDemo.getSnapshot())),liveBefore);
    await page.screenshot({path:path.join(output,'protocol-history.png'),fullPage:true});
    await page.locator('#pr-matrix-view').selectOption('change');
    await checkProtocol(page);await checkForecastObservation(page);await checkSourceHistory(page);await checkCommandInspection(page);
    assert.equal(await page.locator('#pr-source-fault').isDisabled(),false,'Leaving history through matrix view restores live source actions immediately');
    assert.ok(await page.locator('#pr-matrix .matrix-columns text[data-noisy="true"]').count()>0,'Live source quality returns with current links');
    assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('#power-response-demo').powerDemo.getSnapshot())),liveBefore);
    await page.locator('#pr-matrix-view').selectOption('links');

    await mark('archived protocol inspection');

    // Metric changes during playback must retain finite curves and bounded labels.
    await page.locator('#pr-run').click();
    const switchingStart = await sample();
    for (const metric of Array.from({ length: 30 }, (_, index) => index % 2 ? 'total' : 'gap')) {
      await page.locator('#pr-cost-metric').selectOption(metric);
      const label = await page.locator('#pr-cost').getAttribute('aria-label');
      assert.match(label, metric === 'gap' ? /difference from fixed sparse/ : /Cumulative cost of 4/);
      await checkPlots();
    }
    await mark('thirty live metric switches');
    await waitSamples(2);
    assert.ok(await sample() > switchingStart, 'Playback continues during metric switching');
    await pause();
    await page.locator('#pr-adaptation > summary').click();
    await page.locator('#pr-power-scenario').selectOption('solar-outage');
    await page.locator('#pr-compare').click();
    await page.waitForFunction(()=>document.querySelector('#pr-phase').dataset.phase==='deployment'&&!document.querySelector('#pr-compare').disabled);
    await page.locator('#pr-adaptation > summary').click();
    await page.locator('#pr-run').click();
    await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().scenario.active);
    await pause();
    const outage=await page.evaluate(()=>document.querySelector('#power-response-demo').powerDemo.getSnapshot());
    assert.equal(outage.powerScenario,'solar-outage');assert.equal(outage.scenario.active,true);
    assert.ok(outage.scenario.appliedKw>0&&outage.scenario.appliedKw<=360+1e-8);
    for(const bus of [5,7,14,21])assert.ok(Math.abs(outage.generationP[bus-1])<1e-8);
    await page.locator('#pr-matrix .matrix-cell[data-receiver="5"][data-source="7"]').click();
    await checkForecastObservation(page);
      await checkSourceHistory(page);
      await checkCommandInspection(page);
    await checkEventMarkers(page);
    await page.locator('#pr-source-fault').click();
    await checkEventMarkers(page);
    await page.screenshot({path:path.join(output,'solar-outage.png'),fullPage:true});
    await page.locator('#pr-run').click();
    await page.waitForFunction(()=>document.querySelector('#power-response-demo').powerDemo.getSnapshot().t>=51);
    await pause();
    assert.match(await page.locator('#pr-scenario-status').textContent(),/Solar restored/);
    assert.ok(await page.locator('.intervention-badge[aria-label*="Solar"]').count()>0,'Markers identify actual solar changes');
    await checkPlots();
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });

    await mark('solar outage and desktop evidence');

    const audit=await browser.newPage({viewport:{width:1440,height:1000}});
    audit.on('pageerror',error=>errors.push(error.message));
    await audit.goto(address,{waitUntil:'networkidle'});
    await audit.locator('#pr-matrix .matrix-cell[data-receiver="5"][data-source="7"]').click();
    await audit.locator('#pr-source-fault').click();
    const errorsSeen=[];
    for(let i=0;i<62;i++){
      if(i===3)await audit.locator('#pr-source-fault').click();
      await audit.locator('#pr-step').click();
      const reading=await checkSourceHistory(audit),sample=reading.snapshot.lastSample;
      assert.equal(reading.state.playing,false);
      errorsSeen.push(sample.forecast[6]-sample.disturbance[6]);
      const window=errorsSeen.slice(-60),rmse=Math.sqrt(window.reduce((sum,value)=>sum+value*value,0)/window.length),bias=window.reduce((sum,value)=>sum+value,0)/window.length;
      assert.ok(Math.abs(Number(reading.window.rmse)-rmse)<1e-12,'DOM rolling error matches independently collected revealed pairs');
      assert.ok(Math.abs(Number(reading.window.bias)-bias)<1e-12,'DOM bias uses the actual signed errors');
    }
    await audit.screenshot({path:path.join(output,'forecast-history.png'),fullPage:true});
    await audit.close();
    await mark('independent sixty two pair error audit');

    // A narrow touch viewport keeps the controls usable and the page in bounds.
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const phone = await mobile.newPage();
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(address, { waitUntil: 'networkidle' });
    const touchEvents = [];
    await phone.exposeFunction('__recordSmokeTouch', event => touchEvents.push(event));
    await phone.evaluate(() => {
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'gotpointercapture', 'lostpointercapture']) {
        document.addEventListener(type, event => {
          const bus = event.target.closest('[data-bus]');
          window.__recordSmokeTouch({ type, detail: event.detail, pointerType: event.pointerType, bus: bus?.getAttribute('data-bus'), label: bus?.getAttribute('aria-label'), target: event.target.tagName, x: event.clientX, y: event.clientY });
        }, true);
      }
    });
    try {
      await phone.getByRole('button', { name: 'Corrupt forecast at bus 7', exact: true }).tap();
      await phone.getByRole('button', { name: 'Repair forecast at bus 7', exact: true }).waitFor();
      await phone.getByRole('button', { name: 'Repair forecast at bus 7', exact: true }).tap();
      await phone.getByRole('button', { name: 'Corrupt forecast at bus 7', exact: true }).waitFor();
      await phone.locator('#pr-intervention').selectOption('power');
      await phone.getByRole('button', { name: 'Toggle continuous attack at bus 23', exact: true }).tap();
      await phone.getByRole('button', { name: 'Stop attack at bus 23', exact: true }).waitFor();
      assert.equal(await phone.locator('#pr-pulse').getAttribute('aria-pressed'), 'true');
      const attackStart = Number((await phone.locator('#pr-clock').textContent()).match(/t = (\d+)/)[1]);
      await phone.waitForFunction(target => Number(document.querySelector('#pr-clock').textContent.match(/t = (\d+)/)[1]) >= target, attackStart + 3);
      await phone.getByRole('button', { name: 'Stop attack at bus 23', exact: true }).tap();
      await phone.getByRole('button', { name: 'Toggle continuous attack at bus 23', exact: true }).waitFor();
      assert.equal(await phone.locator('#pr-pulse').getAttribute('aria-pressed'), 'false');
    } catch (error) {
      const details = await phone.evaluate(() => ({
        bus7: document.querySelector('[data-bus="7"]')?.getAttribute('aria-label'),
        selectedAction: document.querySelector('#pr-pulse-label')?.textContent,
        clock: document.querySelector('#pr-clock')?.textContent,
        status: document.querySelector('#pr-event')?.textContent,
        alert: document.querySelector('#pr-error')?.textContent,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        scrollY
      }));
      const diagnostic = { passed: false, browser: browser.version(), check: 'mobile bus interactions', details, touchEvents, errors, failure: error.message };
      console.error(JSON.stringify(diagnostic, null, 2));
      await fs.writeFile(path.join(output, 'mobile-failure.json'), JSON.stringify(diagnostic, null, 2));
      await phone.screenshot({ path: path.join(output, 'mobile-failure.png'), fullPage: true });
      throw error;
    }
    await mark('repeated mobile forecast and power taps');
    await phone.locator('#pr-run').tap();
    await phone.locator('#pr-matrix .matrix-cell[data-receiver="5"][data-source="7"]').tap();
    const mobileBefore=await phone.evaluate(()=>{
      const root=document.querySelector('#power-response-demo');return {state:root.powerDemo.getState(),snapshot:root.powerDemo.getSnapshot()};
    });
    assert.equal(mobileBefore.state.playing,false);
    await phone.locator('#pr-command-title').tap();
    await checkCommandInspection(phone);
    assert.equal(await phone.locator('#pr-command-gain-heading').textContent(),'Gain norm');
    assert.equal(await phone.locator('#pr-command-rows .source-gain').count(),4);
    const scroller=phone.getByRole('region',{name:'Receiver command table',exact:true});
    await scroller.focus();
    for(let i=0;i<12;i++)await scroller.press('ArrowRight');
    await phone.waitForFunction(()=>document.querySelector('.pr-command-scroll').scrollLeft>0);
    const keyboardBefore=await phone.evaluate(()=>JSON.stringify(document.querySelector('#power-response-demo').powerDemo.getSnapshot()));
    await scroller.press('Space');
    assert.equal(await phone.evaluate(()=>document.querySelector('#power-response-demo').powerDemo.getState().playing),false,'Space in the command scroller must not start playback');
    assert.equal(await phone.evaluate(()=>JSON.stringify(document.querySelector('#power-response-demo').powerDemo.getSnapshot())),keyboardBefore);
    await scroller.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
    const gainBox=await phone.locator('#pr-command-rows .source-gain').first().boundingBox();
    assert.ok(gainBox.x>=0&&gainBox.x+gainBox.width<=390+1,'Gain is reachable inside the mobile table scroller');
    await phone.screenshot({path:path.join(output,'source-gains-mobile.png'),fullPage:true});
    for(const action of ['Corrupt','Repair']) {
      await phone.getByRole('button',{name:action+' forecast source at bus 7',exact:true}).tap();
      const mobileAfter=await phone.evaluate(()=>{
        const root=document.querySelector('#power-response-demo');return {state:root.powerDemo.getState(),snapshot:root.powerDemo.getSnapshot()};
      });
      await checkForecastObservation(phone);
      await checkSourceHistory(phone);
      await checkCommandInspection(phone);
      assert.equal(mobileAfter.snapshot.faults.includes(7),action==='Corrupt');
      assert.equal(mobileAfter.state.selectedBus,5);assert.equal(mobileAfter.state.inspectedSource,7);
      assert.equal(mobileAfter.state.playing,false);
      assert.equal(mobileAfter.snapshot.t,mobileBefore.snapshot.t);
      assert.deepEqual(mobileAfter.snapshot.states,mobileBefore.snapshot.states);
      assert.deepEqual(mobileAfter.snapshot.cumulative,mobileBefore.snapshot.cumulative);
    }
    await checkVoltageMetrics(phone);
    await checkProtocol(phone);
    await checkEventMarkers(phone);
    const sourceBounds=await phone.locator('#pr-source-fault').boundingBox();
    assert.ok(sourceBounds.width>=44&&sourceBounds.height>=44,'Explicit source action has a usable touch target');
    const dimensions = await phone.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport + 1, 'Mobile page does not overflow horizontally');
    const attackBounds = await phone.locator('#pr-pulse').boundingBox();
    assert.ok(attackBounds.width >= 44 && attackBounds.height >= 44, 'Primary touch target remains at least 44 pixels');
    await phone.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await phone.goto(address+'/environment.html',{waitUntil:'networkidle'});
    const reportLayout=await phone.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert.ok(reportLayout.page<=reportLayout.viewport+1,'Scientific report stays within the mobile page');
    await phone.screenshot({path:path.join(output,'environment.png'),fullPage:true});
    await mark('mobile inspection and responsive evidence');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ passed: true, browser: browser.version(), timings, touchEvents, checks: ['actual forecast setting timestamps and typed mixed event markers', 'keyboard matrix inspection and native command table scrolling', 'visible temporal source gain without hover', 'playback', 'repeated forecast bus clicks', 'continuous power attack', 'automatic handoff', 'actual protocol receipt and archived discovery view', 'matrix mode exit restores live source controls without advancing plant', 'four controller curves', 'nominal voltage diagnostics for all four controllers', 'live cost switching', 'repeated mobile forecast taps', 'explicit inspected source actions on desktop and mobile', 'raw revealed source forecast errors and issue times', 'rolling sixty-pair error and pending issuance timing', 'independent paused browser source error stream', 'actual receiver command decomposition and limiter on desktop and mobile', 'continuous mobile power attack', 'mobile touch and layout'], errors }, null, 2));
    console.log('Browser smoke passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
