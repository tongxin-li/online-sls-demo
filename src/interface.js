(function () {
  'use strict';
  const root = document.getElementById('power-response-demo');
  const $ = id => root.querySelector('#pr-' + id);
  const error = $('error');
  if (!window.d3 || !window.PowerDemo) {
    error.hidden = false;
    error.textContent = 'The chart library could not load. Reopen with an internet connection.';
    root.querySelectorAll('button').forEach(b => { b.disabled = true; });
    return;
  }
  const d3 = window.d3;
  function optionsFromControls() {
    const experiment=$('experiment').value==='prediction'?'prediction':'communication';
    const beta=Number($('noise').value);
    return {experiment,powerScenario:$('power-scenario').value || 'reference',beta:[0,.25,.5,1,2].includes(beta)?beta:1,preset:experiment==='communication'?'mixed':$('preset').value,
      ...(experiment==='communication'?{horizon:180}:{})};
  }
  let simulation = new PowerDemo.Simulation(optionsFromControls());
  const series = [
    { key:'online', label:'Matrix adaptation', color:'var(--viz-series-1)', dash:null },
    { key:'scalar', label:'Scalar adaptation', color:'var(--viz-series-4)', dash:'8 3' },
    { key:'static', label:'Fixed prediction', color:'var(--viz-series-2)', dash:'5 3 1 3' },
    { key:'causal', label:'Feedback only', color:'var(--viz-series-3)', dash:'1 4' }
  ];
  const visible = new Set(series.map(s => s.key));
  const DISCOVERY_SAMPLES=180;
  const automaticComparison=()=>$('auto-compare').checked;
  // All four policies execute throughout discovery and the fresh comparison.
  function communicationComparison() { return snapshot.experiment==='communication' && snapshot.phase==='deployment'; }
  function activeSeries() {
    const labels=communicationComparison()?['Learned sparse','Fixed sparse','Dense prediction','Feedback only']
      :['Matrix adaptation','Scalar adaptation','Fixed prediction','Feedback only'];
    series.forEach((item,i)=>{item.label=labels[i];});
    return series;
  }
  function gapReference() { return communicationComparison()?'fixed sparse':'scalar adaptation'; }
  function forecastMode() { return $('intervention').value==='forecast'; }
  function forecastNoiseEnabled() { return snapshot.experiment!=='communication'||snapshot.beta>0; }
  function forecastNoisy(bus) { return forecastNoiseEnabled()&&snapshot.faults.includes(bus); }
  function powerRecoveryContext() {
    if(snapshot.powerScenario==='solar-outage'&&snapshot.phase==='deployment')return 'Includes solar outage recovery · Outage is not forecast';
    return journal.some(item=>item.type==='pulse')?'Includes load recovery · Clicked power disturbances are not forecast':'';
  }
  function forecastInstruction(bus=selectedBus) {
    if(!forecastNoiseEnabled()) return 'No forecast noise at β 0';
    return snapshot.faults.includes(bus)?'Bus '+bus+' forecast noisy · Click to repair':'Click a bus to corrupt its forecast';
  }
  function predictionBudget(displayedLinks=null) {
    const receivers=PowerDemo.constants.inverterBuses;
    const sources=snapshot.predictionDiagnostics?.sourceBuses || Array.from({length:23},(_,i)=>i+2);
    const dense=receivers.reduce((sum,bus)=>sum+sources.filter(source=>source!==bus).length,0);
    const links=displayedLinks || snapshot.deployedSupport?.links || snapshot.recommendations || [];
    const fixed=snapshot.deployedSupport?.fixedLinks || snapshot.predictionDiagnostics?.offlineLinks || [];
    const fixedKeys=new Set(fixed.map(recommendationKey)),noisy=new Set(snapshot.faults || []);
    const noisyCount=edges=>edges.filter(edge=>edge.from!==edge.to&&noisy.has(edge.from)).length;
    return {dense,remote:links.filter(edge=>edge.from!==edge.to).length,
      replaced:links.filter(edge=>edge.from!==edge.to&&!fixedKeys.has(recommendationKey(edge))).length,
      noisy:noisyCount(links),fixedNoisy:noisyCount(fixed)};
  }
  function plottedSeries() { return activeSeries().filter(s=>visible.has(s.key)); }
  function sameSparseSupport() {
    const support=snapshot.deployedSupport;
    return !!support && JSON.stringify(support.learned)===JSON.stringify(support.fixed);
  }
  let selectedBus = 7;
  let playing = false;
  let comparing = false;
  let timer = null;
  let nextTickAt = 0;
  let heldAttack = null;
  let snapshot = simulation.snapshot();
  $('intervention').value=snapshot.experiment==='communication'?'forecast':'power';
  const topology = new TopologyTimeline(snapshot);
  let historyIndex = null;
  let visualTopologyEvent = null;
  let journal = [];
  let fitSteps = 0;
  let restored = false;
  let pin = null;
  let matrixReference = null;
  let inspectedSource = null;
  let lastPulse = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = () => reducedMotion ? 0 : 1000 / Number($('speed').value || 16);
  function animate(selection, name = 'update') {
    selection.interrupt(name);
    return reducedMotion ? selection : selection.transition(name).duration(duration()).ease(d3.easeLinear);
  }
  function updateAxis(selection,axis) {
    // Axis transitions also live on ticks and text. Cancel descendants before
    // joining ticks so rapid renders cannot leave old labels in flight.
    selection.interrupt().interrupt('update');
    selection.selectAll('*').interrupt().interrupt('update');
    selection.call(axis);
  }
  function color(value) {
    const variable = /^var\((--[^,)]+)/.exec(value);
    return variable ? getComputedStyle(root).getPropertyValue(variable[1]).trim() || '#0071e3' : value;
  }
  const matrixColors = { connected:'var(--primary)', added:'var(--matrix-added, #168b79)', removed:'var(--matrix-removed, #cf8a2b)', local:'#c1c1c7', inactive:'#f0f0f3' };
  const busRole = bus => PowerDemo.constants.busProfiles?.[bus-1]?.role || (bus === 1 ? 'Substation' : [5,7,14,21].includes(bus) ? 'Solar' : [8,12,18,24].includes(bus) ? 'Battery' : 'Homes');
  function pulseMagnitude(value) { return Math.round(Number(value))+' kW'; }
  function costFormat(value) { return value===0 ? '0' : d3.format('.4~g')(value); }
  function busVoltage(bus,key='online',state=snapshot) {
    if(key==='online' && Array.isArray(state.voltage)) return state.voltage[bus-1];
    return state.voltage?.[key]?.[bus-1] ?? 1+(state.states?.[key]?.[bus-1] || 0);
  }
  function referenceVoltage(bus) { return snapshot.referenceVoltage?.[bus-1] ?? snapshot.initialVoltage?.[bus-1] ?? 1; }
  function hasInverter(bus) { return (snapshot.localChannels || []).some(edge=>edge.to===bus); }
  function reactivePower(bus,key='online') { return snapshot.inverterQ?.[key]?.[bus-1] || 0; }
  function reactiveCommand(bus,key='online') { return snapshot.commandQ?.[key]?.[bus-1] || 0; }
  function powerDescription(bus) {
    if(bus===1) return 'Fixed slack';
    const role=busRole(bus), demand=snapshot.demandP?.[bus-1], generation=snapshot.generationP?.[bus-1], battery=snapshot.inverterP?.[bus-1];
    if(role==='Solar' && Number.isFinite(generation)) return 'PV '+generation.toFixed(0)+' kW';
    if(role==='Battery' && Number.isFinite(battery)) return Math.abs(battery)<.05 ? 'Battery idle' : (battery<0?'Charging ':'Discharging ')+Math.abs(battery).toFixed(0)+' kW';
    if(Number.isFinite(demand)) return 'Load '+demand.toFixed(0)+' kW';
    const p=snapshot.loadP?.[bus-1];
    return Number.isFinite(p) ? Math.abs(p).toFixed(0)+' kW '+(p<0?'export':'load') : '';
  }
  function appliedPulse(bus) {
    const applications=(snapshot.lastPulseApplications || snapshot.lastSample?.pulseApplications || []).filter(item=>item.bus===bus);
    if(!applications.length) return null;
    return {requested:applications.reduce((sum,item)=>sum+item.requestedKw,0),applied:applications.reduce((sum,item)=>sum+item.appliedKw,0),capped:applications.some(item=>item.capped)};
  }
  function appliedPulseLabel(bus) {
    const power=appliedPulse(bus);
    if(!power) return 'Pulse active';
    return disturbanceName(bus)+' '+Math.round(power.applied)+' kW applied'+(power.capped?' · Equipment limit':'');
  }
  function disturbanceName(bus) { return busRole(bus)==='Solar' ? 'PV loss' : busRole(bus)==='Battery' ? 'Charging surge' : 'Load surge'; }
  const positions = [
    [.03,.48],[.12,.28],[.27,.28],[.43,.16],[.43,.01],[.60,.12],
    [.77,.03],[.61,.31],[.27,.48],[.44,.38],[.44,.57],[.61,.49],
    [.28,.76],[.28,.96],[.12,.68],[.45,.78],[.45,.96],[.62,.76],
    [.77,.64],[.91,.52],[.97,.35],[.77,.91],[.91,.84],[.98,.68]
  ];
  for (let bus = 1; bus <= 24; bus++) {
    const option = document.createElement('option');
    option.value = String(bus);
    option.textContent = String(bus);
    $('bus').append(option);
  }
  $('bus').value = String(selectedBus);
  function isFit() { return ['frozen','fitting','converged'].includes(snapshot.mode); }
  function announce(message) { $('event').textContent = message; }
  function actionNote(message) { if ($('action-note')) $('action-note').textContent = message; }
  function recommendationKey(edge) { return edge.to + ',' + edge.from; }
  function captureMatrixReference() {
    matrixReference = { t:snapshot.t, fitIteration:snapshot.fitIteration, edges:new Set((snapshot.recommendations || []).map(recommendationKey)), recommendations:(snapshot.recommendations || []).map(edge => ({...edge})) };
  }
  function advanceSample() {
    const next=simulation.step();
    const event=topology.observe(next);
    if(event && historyIndex===null) visualTopologyEvent=event;
    return next;
  }
  function topologyFrame() {
    const event=historyIndex===null ? topology.latest : historyIndex ? topology.events[historyIndex-1] : null;
    const links=historyIndex===null ? snapshot.recommendations : topology.at(historyIndex);
    const reference=communicationComparison()&&historyIndex===null?snapshot.deployedSupport.fixedLinks:(event?.before || links);
    return {event,links,reference:new Set(reference.map(recommendationKey))};
  }
  function reviewTopology(index) {
    historyIndex=index;visualTopologyEvent=index ? topology.events[index-1] : null;
    if(index!==null) $('matrix-view').value='links';
    renderProtocol();renderInspectedSource();drawNetwork();drawMatrix();highlightTopology();
  }
  function highlightTopology() {
    if(!visualTopologyEvent) return;
    const event=visualTopologyEvent;visualTopologyEvent=null;
    if(reducedMotion) return;
    const receivers=new Set([...event.added,...event.removed].map(e=>e.to));
    const edges=new Set([...event.added,...event.removed].map(recommendationKey));
    const changed=d3.select(root).selectAll('.matrix-cell, .recommended path, .bus-node').filter(function(){
      if(this.dataset.bus) return receivers.has(Number(this.dataset.bus));
      const to=Number(this.dataset.receiver || this.dataset.to),from=Number(this.dataset.source || this.dataset.from);
      return edges.has(to+','+from);
    });
    changed.classed('pr-link-flash',false);
    changed.each(function(){void this.getBoundingClientRect();});
    changed.classed('pr-link-flash',true);
  }
  function drawTopologyHistory() {
    const total=topology.cumulative.transitions,changing=$('matrix-view').value==='change';
    const index=historyIndex===null ? total : historyIndex;
    const control=$('topology-history');
    control.max=String(total);control.value=String(index);control.disabled=changing || total===0;
    control.setAttribute('aria-valuetext',index ? 'Update '+index+' at second '+topology.events[index-1].t : 'Initial topology');
    $('history-count').textContent=total+' link update'+(total===1?'':'s');
    const gain=100*(snapshot.predictionDiagnostics?.relativeGainChange || 0);
    $('topology-status').textContent=historyIndex!==null?'Viewing saved topology':snapshot.phase==='deployment'?'Deployed links fixed':topology.latest && snapshot.t-topology.latest.t<8?'Link changed at '+topology.latest.t+' s':'Connectivity unchanged';
    $('topology-gain').textContent=communicationComparison()?'Learned scores fixed':'Weights changed '+d3.format('.3~g')(gain)+'%';
    const cards=d3.select($('topology-events')).selectAll('button').data(topology.events.slice(-3),e=>e.index).join(enter=>{
      const b=enter.append('button').attr('type','button');b.append('span');b.append('strong');return b;
    }).attr('aria-pressed',e=>String(historyIndex===e.index || historyIndex===null && e.index===total))
      .attr('title',e=>'At '+e.t+' seconds. '+e.removed.map(x=>'Removed '+x.from+' → '+x.to).join('. ')+'. '+e.added.map(x=>'Added '+x.from+' → '+x.to).join('. '))
      .on('click',(_event,e)=>reviewTopology(e.index));
    cards.select('span').text(e=>e.t+' s · '+(new Set(e.added.map(x=>x.to)).size===1?'Inverter '+e.added[0].to:e.added.length+' sources'));
    cards.select('strong').text(e=>e.added.length===1 && e.removed.length===1?'Source '+e.removed[0].from+' → '+e.added[0].from:e.added.length+' added · '+e.removed.length+' removed');
    $('topology-events').hidden=total===0;
    $('history-live').setAttribute('aria-pressed',String(historyIndex===null));
    $('history-live').textContent=historyIndex===null ? 'Latest' : 'Show latest';
    $('history-live').disabled=changing;
    const {event}=topologyFrame();
    const label=edges=>edges.map(e=>e.from+' → '+e.to).join(', ');
    $('topology-note').textContent=changing ? (communicationComparison()?'Saved discovery scores · Deployed prediction weights stay fixed':'Weight changes do not always change connectivity.')
      : communicationComparison()&&historyIndex===null ? 'Green and amber compare learned links with fixed sparse · Use history to inspect discovery'
      : event ? (historyIndex===null?(snapshot.phase==='deployment'?'Last discovery':'Latest'):'Viewing')+' update at '+event.t+' s · Added '+label(event.added)+' · Removed '+label(event.removed)
      : historyIndex===0 ? 'Initial prediction links · Move the slider to review each update.'
      : snapshot.phase==='deployment' ? 'No link changes during discovery. Deployed links stay fixed.'
      : snapshot.t<30 ? 'Weights start adapting at 30 s. Each link update is kept here.'
      : 'No links have changed yet. Learning weights may still change.';
    $('topology-note').title=snapshot.phase==='deployment' ? (communicationComparison()?'Discovery history. Deployed links and prediction weights stay fixed.':'Discovery history. Deployed links stay fixed while prediction weights continue adapting.') : 'History displays observed connectivity only. Reviewing an update does not change the controller.';
  }
  // Reconstruct the last executed command from the exact issued preview and
  // calibration retained for that action. No future realized forcing is read.
  function commandContributions(view,segments,forecasts,source,receiver) {
    if(!view.lastSample) return null;
    const action=view.lastSample.t,row=PowerDemo.constants.inverterBuses.indexOf(receiver),column=source-2;
    const segment=segments.find(item=>action>=item.start&&action<item.end);
    if(row<0 || column<0 || column>=23 || !segment) return null;
    const fixed=view.phase==='deployment'&&view.experiment==='communication';
    const rows=['online','scalar','static','causal'].map(key=>{
      const state=view.costStates[key].slice(1).map((value,i)=>value-PowerDemo.model.baseDrop[i+1]);
      const feedback=PowerDemo.model.K[row].reduce((sum,value,i)=>sum+value*state[i],0);
      let prediction=0,sourcePart=0,gainSquared=0;
      if(key!=='causal') for(const block of segment.designs[key].rows[action-segment.start]) {
        const forecast=forecasts[segment.start+block.k-1].forecast.slice(1),gain=block.L[row];
        const correction=!fixed&&key==='online'?view.calibration.matrix:null;
        const corrected=correction?PowerDemo.math.matvec(correction,forecast)
          :!fixed&&key==='scalar'?forecast.map(value=>value*view.calibration.scalar):forecast;
        prediction+=gain.reduce((sum,value,j)=>sum+value*corrected[j],0);
        const sourceGain=correction?gain.reduce((sum,value,j)=>sum+value*correction[j][column],0)
          :gain[column]*(!fixed&&key==='scalar'?view.calibration.scalar:1);
        sourcePart+=sourceGain*forecast[column];gainSquared+=sourceGain**2;
      }
      return {key,sourceKvar:1000*sourcePart,otherKvar:1000*(prediction-sourcePart),
        feedbackKvar:1000*feedback,requestedKvar:1000*(feedback+prediction),
        commandKvar:view.commandQ[key][receiver-1],gainNorm:Math.sqrt(gainSquared),
        limited:view.saturation[key][receiver-1]};
    });
    return {source,receiver,action,rows};
  }
  function inspectedCommand() {
    const inspection=predictionInspection();
    return !inspection || historyIndex!==null ? null
      : commandContributions(snapshot,simulation.segments,simulation.forecasts,inspection.source,inspection.receiver);
  }
  function renderCommandInspection(inspection) {
    const reading=inspectedCommand(),panel=$('command-inspector');
    panel.hidden=!inspection;
    $('command-title').textContent=reading ? 'Command at inverter '+reading.receiver+' · Action '+reading.action+' s'
      : 'Command breakdown · '+(historyIndex!==null?'Show Latest':'Step to reveal');
    const body=$('command-rows');body.replaceChildren();
    if(!reading) return;
    const names=Object.fromEntries(activeSeries().map(item=>[item.key,item.label]));
    const format=value=>(Math.abs(value)<.0005?0:value).toFixed(3);
    for(const item of reading.rows) {
      const row=document.createElement('tr');row.dataset.controller=item.key;
      row.dataset.source=reading.source;row.dataset.receiver=reading.receiver;row.dataset.action=reading.action;
      for(const key of ['sourceKvar','otherKvar','feedbackKvar','requestedKvar','commandKvar','gainNorm','limited'])row.dataset[key]=String(item[key]);
      row.title='Temporal source gain norm '+item.gainNorm.toPrecision(4)+' pu command / pu forcing'
        +(item.limited?' · Request limited to ±70 kvar':' · Request not limited');
      const label=document.createElement('th');label.scope='row';label.textContent=names[item.key];row.append(label);
      for(const key of ['sourceKvar','otherKvar','feedbackKvar','requestedKvar','commandKvar']) {
        const cell=document.createElement('td');cell.textContent=format(item[key]);row.append(cell);
      }
      body.append(row);
    }
  }
  // Read only the last revealed pair. Never read a future forcing or forecast base.
  function inspectedForecastObservation() {
    const inspection=predictionInspection(),sample=snapshot.lastSample;
    if(!inspection || historyIndex!==null || !sample) return null;
    const index=inspection.source-1;
    const forecast=sample.forecast[index],realized=sample.disturbance[index];
    return {source:inspection.source,receiver:inspection.receiver,action:sample.t,
      issuedAt:Math.max(0,sample.t-PowerDemo.constants.preview+1),observedAt:sample.t+1,
      forecast,realized,error:forecast-realized};
  }
  function forecastErrorWindow(samples,source,observedThrough,limit=60) {
    const window=samples.filter(sample=>sample.t<observedThrough).slice(-limit);
    if(!window.length) return null;
    const errors=window.map(sample=>sample.forecast[source-1]-sample.disturbance[source-1]);
    return {count:window.length,firstAction:window[0].t,lastAction:window.at(-1).t,
      firstObservedAt:window[0].t+1,lastObservedAt:window.at(-1).t+1,
      rmse:Math.sqrt(errors.reduce((sum,error)=>sum+error*error,0)/errors.length),
      bias:errors.reduce((sum,error)=>sum+error,0)/errors.length};
  }
  function inspectedSourceHistory() {
    const inspection=predictionInspection();
    if(!inspection || historyIndex!==null) return null;
    const source=inspection.source,stats=forecastErrorWindow(simulation.samples,source,snapshot.t);
    const event=snapshot.eventLog.filter(event=>event.type==='forecast'&&event.bus===source).at(-1);
    let change=null;
    if(event) {
      // Reset seals the initial preview at t=0. Later actions seal one new
      // message before executing. Paused toggles cannot rewrite that prefix.
      const issuedAt=Math.max(1,event.t),firstAction=issuedAt+PowerDemo.constants.preview-1;
      const message=simulation.forecasts[firstAction];
      change={changedAt:event.t,firstAction,issuedAt,pairAt:firstAction+1,
        issued:!!message,observed:!!stats&&stats.lastAction>=firstAction,
        pairsInWindow:simulation.samples.filter(sample=>sample.t<snapshot.t).slice(-60).filter(sample=>sample.t>=firstAction).length};
    }
    return {source,stats,change};
  }
  function renderSourceHistory() {
    const reading=inspectedSourceHistory(),stats=reading?.stats,change=reading?.change;
    const window=$('forecast-window'),timing=$('forecast-change');
    window.hidden=timing.hidden=!reading;
    window.dataset.available=String(!!stats);
    for(const key of ['count','firstAction','lastAction','firstObservedAt','lastObservedAt','rmse','bias'])
      window.dataset[key]=stats ? String(stats[key]) : '';
    window.textContent=stats ? 'Last '+stats.count+' revealed pairs · RMSE '+(1000*stats.rmse).toFixed(3)+' mpu · Bias '+(1000*stats.bias).toFixed(3)+' mpu'
      : 'No revealed pairs yet';
    window.title=stats ? 'Observed '+stats.firstObservedAt+' to '+stats.lastObservedAt+' s in this phase. RMSE is root mean square raw forecast minus forcing error. Bias is its signed mean. Past settings and unforecast power may contribute.'
      : 'Only revealed observations enter this summary. The window holds at most 60 pairs.';
    timing.dataset.available=String(!!change);
    for(const key of ['changedAt','firstAction','issuedAt','pairAt','issued','observed','pairsInWindow'])
      timing.dataset[key]=change ? String(change[key]) : '';
    timing.textContent=!reading ? '' : !forecastNoiseEnabled() ? 'Noise disabled at β 0 · Unforecast power may still cause error'
      : !change ? 'Initial setting in this phase · Issued forecasts stay fixed'
      : (change.issued?'Issued ':'Next issue ')+change.issuedAt+' s · Forecast target '+change.firstAction+' s'
        +' · First pair '+(change.observed?'revealed ':'due ')+change.pairAt+' s · '+change.pairsInWindow+'/'+(stats?.count || 0)+' window pairs use latest setting';
    timing.title=change ? 'Latest source setting changed at '+change.changedAt+' s. A newly issued message can enter the current preview command before its target is observed. These times do not promise improved error. Repeated toggles before issue use the latest setting.'
      : 'Reliability is a setting for newly issued forecasts, not a label inferred from observed error.';
  }
  function renderForecastObservation(inspection) {
    const panel=$('forecast-observation'),observation=inspectedForecastObservation();
    panel.hidden=!inspection;
    renderSourceHistory();
    $('forecast-values').hidden=!observation;
    panel.dataset.available=String(!!observation);
    for(const key of ['source','receiver','action','issuedAt','observedAt','forecast','realized','error'])
      panel.dataset[key]=observation ? String(observation[key]) : '';
    $('forecast-timing').textContent=observation
      ? 'Source '+observation.source+' · Action '+observation.action+' s · Issued '+observation.issuedAt+' s · Revealed '+observation.observedAt+' s'
      : historyIndex!==null ? 'Saved links · Return to Latest for current observations'
      : 'Run or step to reveal a source observation';
    for(const key of ['forecast','realized','error'])
      $('observed-'+key).textContent=observation ? (1000*observation[key]).toFixed(3) : '—';
    $('forecast-support').textContent=!inspection ? '' : historyIndex!==null ? 'Current sample hidden while reviewing saved links'
      : snapshot.phase==='discovery' ? 'Discovery uses dense messages · Displayed links are candidates'
      : (inspection.connected ? 'Permitted by deployed support' : 'Excluded from deployed support')+' at inverter '+inspection.receiver+' · '+(snapshot.experiment==='communication'?'Learned sparse':'Matrix adaptation')+' · Links fixed';
  }
  function renderInspectedSource() {
    const inspection=predictionInspection(),control=$('source-fault');
    renderForecastObservation(inspection);
    renderCommandInspection(inspection);
    $('source-controls').hidden=!inspection;
    const bus=inspection?.source;
    const noisy=!!inspection && snapshot.faults.includes(bus);
    control.textContent=(noisy?'Repair':'Corrupt')+' source '+(bus || '');
    control.setAttribute('aria-label',(noisy?'Repair':'Corrupt')+' forecast source at bus '+(bus || ''));
    control.setAttribute('aria-pressed',String(noisy));
    control.disabled=!inspection || comparing || historyIndex!==null || !forecastNoiseEnabled();
    control.dataset.source=bus || '';
    $('source-status').textContent=!inspection?'':historyIndex!==null?'Saved links · Show latest to change reliability'
      :!forecastNoiseEnabled()?'Noise disabled at β 0':(noisy?'Noisy until repaired':'Quiet until corrupted')+' · New forecasts only'+(snapshot.phase==='deployment'?' · Links fixed':'');
    control.title='Change forecast source '+(bus || '')+' without changing the receiving inverter or starting playback. Already issued forecasts remain unchanged.';
  }
  function toggleInspectedForecast() {
    const inspection=predictionInspection();
    if(!inspection || comparing || historyIndex!==null || !forecastNoiseEnabled()) return;
    fault(inspection.source,{preserveSelection:true});
  }
  function inspectPredictionLink(receiver,source) {
    inspectedSource=source;
    selectBus(receiver);
  }
  function predictionInspection() {
    if(inspectedSource===null || !hasInverter(selectedBus)) return null;
    const frame=topologyFrame();
    const local=inspectedSource===selectedBus;
    const connected=local || (frame.links || []).some(edge=>edge.from===inspectedSource && edge.to===selectedBus);
    return {source:inspectedSource,receiver:selectedBus,local,connected,
      label:'Source bus '+inspectedSource+' → inverter '+selectedBus+' · '+(local?'Local source':connected?'Selected link':'No link')
        +' · '+(historyIndex!==null?'Saved discovery':snapshot.phase==='deployment'?'Deployed':'Candidate')};
  }
  function selectBus(bus) {
    selectedBus = bus;
    if(!hasInverter(bus)) inspectedSource=null;
    $('bus').value = String(bus);
    render(); save();
  }
  function resumePlant() {
    if (isFit()) {
      simulation.resume();
      journal.push({t:snapshot.t,type:'fit',count:fitSteps});
      fitSteps=0;
    }
    if (simulation.mode === 'completed') simulation.extend();
    snapshot=simulation.snapshot();
  }
  function save() {
    restored = true;
    if (!window.openai?.setWidgetState) return;
    const events=snapshot.eventLog || [];
    const state = {
      modelContent: { scenario:'24 bus LinDistFlow voltage regulation', variant:snapshot.experiment==='communication'?'Communication topology comparison':'Shared prediction adaptation and sparse deployment', phase:snapshot.phase, step:snapshot.t, mode:snapshot.mode, cumulativeCost:snapshot.cumulative, selectedBus, faultyBuses:snapshot.faults, fitError:snapshot.fitError },
      privateContent: { version:13, intervention:$('intervention').value, attackMode:$('attack-mode').value, phase:snapshot.phase, initialOptions:snapshot.initialOptions, discoveryRecord:snapshot.discoveryRecord, preset:snapshot.preset, matrixReference:matrixReference?{t:matrixReference.t,recommendations:matrixReference.recommendations}:null, automaticComparison:automaticComparison(), view:$('view').value, costMetric:$('cost-metric').value, matrixView:$('matrix-view').value, pulseStrength:$('strength').value, t:snapshot.t, events, selectedBus, inspectedSource, speed:$('speed').value, allLinks:$('all-links').checked }
    };
    window.openai.setWidgetState(state).catch(() => {});
  }
  function replayRecord(record) {
    const events=Array.isArray(record?.events)?record.events:[];
    const target=Number.isSafeInteger(record?.t) && record.t>=0 ? record.t : 0;
    const eventsAt=new Map();
    for(const item of events) {
      if(!Number.isSafeInteger(item.t) || item.t<0 || item.t>target) continue;
      if(!eventsAt.has(item.t)) eventsAt.set(item.t,[]);
      eventsAt.get(item.t).push(item);
    }
    for(let step=0;step<=target;step++) {
      for(const item of eventsAt.get(step) || []) {
        if(item.type==='extend') { simulation.extend(item.steps); continue; }
        if(item.type==='freeze') { simulation.freeze(); continue; }
        if(item.type==='fit') { simulation.fitStep(Math.max(1,Math.floor(item.count || item.steps || 1))); continue; }
        if(item.type==='resume') { simulation.resume(); continue; }
        if(!Number.isInteger(item.bus)||item.bus<2||item.bus>24) continue;
        if(item.type==='pulse') simulation.queuePulse(item.bus,[50,100,150].includes(item.strength)?item.strength:100);
        else if(item.type==='forecast'||item.type==='fault') simulation.toggleFault(item.bus);
      }
      if(step<target) {
        if(simulation.mode==='completed') simulation.extend();
        advanceSample();
      }
    }
  }
  function hydrate(saved) {
    const data=saved?.privateContent;
    if(restored||!data||data.version!==13) return;
    restored=true;
    $('auto-compare').checked=data.automaticComparison!==false;
    selectedBus=Math.max(1,Math.min(24,Math.floor(Number(data.selectedBus)||7)));
    $('bus').value=String(selectedBus);
    inspectedSource=hasInverter(selectedBus)&&Number.isInteger(data.inspectedSource)&&data.inspectedSource>=2&&data.inspectedSource<=24?data.inspectedSource:null;
    $('speed').value=['2','4','8','16','32'].includes(data.speed)?data.speed:'16';
    $('attack-mode').value=data.attackMode==='pulse'?'pulse':'continuous';
    $('intervention').value=data.intervention==='forecast'?'forecast':'power';
    if(['50','100','150'].includes(data.pulseStrength)) $('strength').value=data.pulseStrength;
    $('all-links').checked=!!data.allLinks;
    $('matrix-view').value=data.matrixView==='change'?'change':'links';
    const preset=['reliable','uniform','mixed'].includes(data.preset)?data.preset:'mixed';
    const savedOptions=data.phase==='deployment'&&data.discoveryRecord?data.discoveryRecord.options:data.initialOptions;
    $('experiment').value=savedOptions?.experiment==='prediction'?'prediction':'communication';
    $('noise').value=String([0,.25,.5,1,2].includes(savedOptions?.beta)?savedOptions.beta:1);
    $('preset').value=preset;
    $('power-scenario').value=savedOptions?.powerScenario==='solar-outage'?'solar-outage':'reference';
    if(data.phase==='deployment' && data.discoveryRecord) {
      simulation=new PowerDemo.Simulation(data.discoveryRecord.options || optionsFromControls());
      topology.reset(simulation.snapshot());
      replayRecord(data.discoveryRecord);
      simulation.deployTopology();
      topology.observe(simulation.snapshot());
    } else {
      simulation=new PowerDemo.Simulation(data.initialOptions || optionsFromControls());
      topology.reset(simulation.snapshot());
    }
    const initialLinks=simulation.snapshot().recommendations.map(e=>({...e}));
    replayRecord({t:data.t,events:data.events});
    snapshot=simulation.snapshot();
    $('preset').value=snapshot.preset; $('experiment').value=snapshot.experiment; $('noise').value=String(snapshot.beta);
    $('view').value=data.view==='learning'?'learning':'cost';
    $('cost-metric').value=data.costMetric==='gap'?'gap':'total';
    journal=(snapshot.eventLog || []).filter(item=>item.type==='pulse'||item.type==='forecast'||item.type==='fault').map(item=>({...item,type:item.type==='forecast'?'fault':item.type}));
    fitSteps=snapshot.fitIteration || 0;
    if(data.matrixReference?.recommendations) matrixReference={...data.matrixReference,edges:new Set(data.matrixReference.recommendations.map(recommendationKey))};
    else matrixReference={t:0,recommendations:initialLinks,edges:new Set(initialLinks.map(recommendationKey))};
    const restoredPulse=journal.filter(item=>item.type==='pulse').at(-1);
    if(restoredPulse) lastPulse={...restoredPulse,before:snapshot.history.find(item=>(item.costTime ?? item.t-1)===restoredPulse.t-1)?.stage.online || 0};
    announce('Trial restored · Press Run');
  }

  function releaseAttack() {
    if(heldAttack?.owner) heldAttack.owner.dataset.holding='false';
    heldAttack = null;
    $('pulse').dataset.holding='false';
  }
  function stop(preserveAttack=false) {
    if(!preserveAttack) releaseAttack();
    nextTickAt = 0;
    playing = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    if (!playing) return;
    const period=1000 / Number($('speed').value);
    if(!nextTickAt) nextTickAt=performance.now()+period;
    timer=setTimeout(() => {
      timer=null;
      tick();
      // Never burst through missed samples after a busy or hidden frame.
      nextTickAt=Math.max(nextTickAt+period,performance.now()+period*.15);
      if(playing) schedule();
    },Math.max(0,nextTickAt-performance.now()));
  }
  function enterComparison(preserveAttack=false) {
    // Transfer requests not yet applied, not decaying disturbances from the old plant.
    const requests=preserveAttack ? simulation.snapshot().pendingPulses.map(p=>({bus:p.bus,strength:p.strength})) : [];
    if(!simulation.deployTopology()) return false;
    snapshot=simulation.snapshot();
    topology.observe(snapshot);historyIndex=null;visualTopologyEvent=null;
    journal=[];fitSteps=0;pin=null;lastPulse=null;
    if(preserveAttack && heldAttack) {
      if(!requests.some(p=>p.bus===heldAttack.bus)) requests.push({bus:heldAttack.bus,strength:Number($('strength').value)});
      heldAttack.lastQueuedAt=0;
    } else releaseAttack();
    for(const request of requests) {
      simulation.queuePulse(request.bus,request.strength);
      journal.push({t:0,type:'pulse',...request});
      lastPulse={...request,t:0,before:0};
    }
    snapshot=simulation.snapshot();
    captureMatrixReference();$('view').value='cost';$('cost-metric').value='total';
    visible.clear();series.forEach(item=>visible.add(item.key));
    announce('Sparse controllers synthesized · Fresh comparison · Costs start at zero');
    return true;
  }
  function startAutomaticComparison() {
    if(!automaticComparison() || simulation.phase!=='discovery' || isFit()
      || simulation.t<DISCOVERY_SAMPLES || !simulation.snapshot().canDeploy) return false;
    return enterComparison(true);
  }
  function advanceLiveSample() {
    // Replayed records never call this function. Their historical phase is retained.
    let transitioned=startAutomaticComparison();
    if(simulation.mode==='completed') simulation.extend();
    if(heldAttack && heldAttack.lastQueuedAt<simulation.t) pulse(heldAttack.bus,{repeated:true});
    advanceSample();snapshot=simulation.snapshot();
    transitioned=startAutomaticComparison() || transitioned;
    if(transitioned) save();
    return transitioned;
  }
  function tick() {
    if (isFit()) { simulation.fitStep(100); fitSteps+=100; }
    else advanceLiveSample();
    snapshot = simulation.snapshot();
    if (!forecastMode() && !isFit() && lastPulse && snapshot.t>lastPulse.t) {
      const state=attackState(lastPulse.bus);
      announce((state==='continuous'||state==='held'?'Adding attacks':state==='fading'?'Disturbance fading':state==='paused'?'Paused':'Disturbance ended')+' · Bus '+lastPulse.bus+' · t = '+snapshot.t+' s');
    }
    if (snapshot.mode === 'completed' && !playing) announce('Run or Step to continue');
    if (snapshot.mode === 'converged') { stop(); announce('Fit converged · Return to simulation'); }
    render();
    if (snapshot.t % 30 === 0 || !playing) save();
  }
  function resetExperiment() {
    stop(); simulation.reset();
    snapshot = simulation.snapshot(); journal = []; fitSteps = 0; pin = null; lastPulse = null;
    if(snapshot.phase==='discovery') topology.reset(snapshot);
    else topology.observe(snapshot);
    historyIndex=null;visualTopologyEvent=null;inspectedSource=null;
    captureMatrixReference(); $('cost-metric').value='total';
    $('view').value=snapshot.experiment==='communication'&&snapshot.phase==='discovery'?'learning':'cost';
    actionNote(attackInstruction());
  }
  function toggleRun() {
    if (comparing) return;
    if (playing) { stop(); announce('Paused'); save(); }
    else {
      if (snapshot.mode === 'completed') { simulation.extend(); snapshot=simulation.snapshot(); }
      if (snapshot.mode === 'converged') resumePlant();
      playing = true;
      announce(isFit() ? 'Fitting the frozen responses' : 'Regulating feeder voltage');
      tick();
      if (playing) schedule();
    }
    render();
  }
  $('run').addEventListener('click', toggleRun);
  $('deploy').addEventListener('click', () => {
    if(comparing) return;
    if(snapshot.phase==='deployment') {
      simulation=new PowerDemo.Simulation({...optionsFromControls(),faultBuses:snapshot.faults.slice()});resetExperiment();
      $('intervention').value=snapshot.experiment==='communication'?'forecast':'power';
      $('matrix-view').value='links';announce('New discovery · Press Run or attack a bus');render();save();return;
    }
    if(!snapshot.canDeploy) return;
    stop();
    enterComparison();
    playing=true;nextTickAt=0;schedule();
    actionNote(attackInstruction());
    render(); save();
  });
  function startSelectedExperiment() {
    stop(); simulation=new PowerDemo.Simulation(optionsFromControls());
    resetExperiment(); $('intervention').value=snapshot.experiment==='communication'?'forecast':'power';
    visible.clear();series.forEach(item=>visible.add(item.key));
    announce((snapshot.experiment==='communication'?'Communication topology':snapshot.presetLabel)+' · New learning trial'); render(); save();
  }
  $('preset').addEventListener('change',startSelectedExperiment);
  $('experiment').addEventListener('change',startSelectedExperiment);
  $('noise').addEventListener('change',startSelectedExperiment);
  $('power-scenario').addEventListener('change',startSelectedExperiment);
  $('compare').addEventListener('click', async () => {
    if (comparing) return;
    stop(true); resumePlant(); comparing=true; $('view').value='cost';
    const startingPhase=snapshot.phase;
    try {
      for (let done=0; done<180; done+=12) {
        // Yield between batches so progress and controls remain responsive.
        renderControls();
        await new Promise(resolve=>setTimeout(resolve,0));
        for (let k=0;k<12;k++) advanceLiveSample();
        snapshot=simulation.snapshot();
        announce('Advancing '+(done+12)+' / 180 samples');
        if ((done+12)%36===0) render();
      }
      announce(startingPhase!==snapshot.phase?'Discovery complete · Fresh comparison trial · t = '+snapshot.t+' s':'180 samples added · t = '+snapshot.t+' s');
    } finally {
      comparing=false;
      if(heldAttack && !playing) {playing=true;nextTickAt=0;schedule();}
      render(); save();
    }
  });
  $('step').addEventListener('click', () => { stop(); if(snapshot.mode==='completed'){simulation.extend();snapshot=simulation.snapshot();} tick(); save(); });
  $('restart').addEventListener('click', () => {
    resetExperiment(); announce('Ready'); render(); save();
  });
  $('speed').addEventListener('change', () => { if (playing) { clearTimeout(timer); nextTickAt=0; schedule(); } save(); });
  $('auto-compare').addEventListener('change',()=>{render();save();});
  $('cost-metric').addEventListener('change',()=>{
    // A pinned reading belongs to the previous quantity and scale.
    $('tooltip').style.display='none';pin=null;
    drawCost();save();
  });
  $('strength').addEventListener('change', () => { drawNetwork(); save(); });
  $('attack-mode').addEventListener('change',()=>{releaseAttack();renderControls();drawNetwork();save();});
  $('intervention').addEventListener('change',()=>{
    const stopped=!!heldAttack;releaseAttack();
    announce((stopped?'Power attack stopped · ':'')+(forecastMode()?'Click a bus to change forecast reliability':'Click a bus to disturb physical power'));
    render();save();
  });
  if ($('matrix-view')) $('matrix-view').addEventListener('change',()=>{historyIndex=null;renderProtocol();renderInspectedSource();drawNetwork();drawMatrix();save();});
  $('topology-history').addEventListener('input',()=>reviewTopology(Number($('topology-history').value)));
  $('history-live').addEventListener('click',()=>reviewTopology(null));
  if ($('view')) $('view').addEventListener('change', () => { renderLearningView(); drawConvergence(); drawCost(); save(); });
  $('bus').addEventListener('change', () => selectBus(Number($('bus').value)));
  $('all-links').addEventListener('change', () => { drawNetwork(); save(); });
  $('source-fault').addEventListener('click',toggleInspectedForecast);
  if ($('reference')) $('reference').addEventListener('click', () => {
    captureMatrixReference(); drawNetwork(); drawMatrix();
    announce('Connectivity reference saved at step ' + snapshot.t);
  });
  function pulseStatus(bus) {
    const events=(snapshot.activePulses || []).filter(item=>item.bus===bus);
    const queued=(snapshot.pendingPulses || []).filter(item=>item.bus===bus).length;
    const applied=journal.filter(item=>item.type==='pulse' && item.bus===bus && item.t<snapshot.t);
    const latest=applied.at(-1);
    return {queued,active:events.some(item=>item.age>0),activeCount:events.length,
      id:latest ? latest.t+'_'+applied.length : null};
  }
  function attackState(bus=selectedBus) {
    if(heldAttack?.bus===bus) return heldAttack.latched?'continuous':'held';
    const status=pulseStatus(bus);
    if(status.queued) return 'pending';
    if(status.active) return (playing && !isFit()) || comparing ? 'fading' : 'paused';
    return 'idle';
  }
  function attackFeedback(bus=selectedBus) {
    const state=attackState(bus);
    return {state,hint:state==='continuous'?'Repeats until stopped':state==='held'?'Release to stop':state==='pending'?'Queued for next sample':state==='fading'?'Disturbance fading':state==='paused'?'Paused · Disturbance remains':continuousMode()?'Click to start or stop':'Click or hold'};
  }
  function canAttack(bus=selectedBus) { return bus!==1; }
  function pulse(bus = selectedBus,{repeated=false}={}) {
    if (!canAttack(bus)) return;
    // A click schedules an unexpected disturbance for the next control sample.
    // It never advances plant time or removes an earlier attack.
    resumePlant();
    selectedBus = bus;
    $('bus').value = String(bus);
    const strength = Number($('strength').value);
    const before = snapshot.stage.online;
    const pulseStep = snapshot.t;
    simulation.queuePulse(selectedBus, strength);
    journal.push({t:pulseStep,type:'pulse',bus:selectedBus,strength});
    snapshot=simulation.snapshot();
    if(heldAttack) heldAttack.lastQueuedAt=pulseStep;
    lastPulse={bus:selectedBus,strength,t:pulseStep,before};
    const count=pulseStatus(bus).queued;
    const message=disturbanceName(bus)+' · '+pulseMagnitude(strength)+' queued'+(count>1?' × '+count:'')+' at bus '+bus;
    announce(message+' · t = '+pulseStep);
    if(!playing && !comparing) {
      playing=true; nextTickAt=0; schedule();
    }
    actionNote(heldAttack?(heldAttack.latched?'Continuous attack · Bus ':'Holding bus ')+selectedBus:'Pulse queued');
    // Queuing an event must not restart every chart transition.
    if(!repeated) { renderControls(); drawNetwork(); save(); }
  }
  function fault(bus=selectedBus,{startPlayback=false,preserveSelection=false}={}) {
    if (!canAttack(bus)) return;
    if(!preserveSelection) {selectedBus=bus;$('bus').value=String(bus);}
    resumePlant();
    simulation.toggleFault(bus); journal.push({t:snapshot.t,type:'fault',bus});
    snapshot=simulation.snapshot();
    const message='Bus '+bus+' forecast '+(snapshot.faults.includes(bus)?'marked noisy':'marked quiet')
      +(!forecastNoiseEnabled()?' · No noise at β 0':snapshot.phase==='deployment'?' · Links remain fixed':' · New forecasts use this setting');
    if(startPlayback&&!playing&&!comparing) {playing=true;nextTickAt=0;schedule();}
    announce(message); actionNote(message);
    render(); save();
  }
  function continuousMode() { return $('attack-mode').value==='continuous'; }
  function attackInstruction() { return forecastMode()?forecastInstruction():continuousMode()?'Click a bus to start · Click again to stop':'Click for a pulse · Hold to repeat'; }
  function finishAttack() {
    const bus=heldAttack?.bus;
    releaseAttack();renderControls();drawNetwork();save();
    if(bus) announce('New attacks stopped · Bus '+bus+(pulseStatus(bus).active || pulseStatus(bus).queued?' · Existing disturbance remains':''));
  }
  function activateAttack(bus,owner) {
    if(forecastMode()) { fault(bus,{startPlayback:true});return; }
    if(continuousMode()) {
      if(heldAttack?.latched && heldAttack.bus===bus) finishAttack();
      else beginAttack(bus,null,true);
    } else beginAttack(bus,owner);
  }
  function beginAttack(bus=selectedBus,owner=null,latched=false) {
    if(!canAttack(bus)) return;
    releaseAttack();
    heldAttack={bus,lastQueuedAt:-1,owner,latched}; $('pulse').dataset.holding='true';
    if(owner) owner.dataset.holding='true';
    pulse(bus);
  }
  function bindAttackTarget(element,getBus) {
    let pointerBus=null;
    element.addEventListener('pointerdown',event=>{
      const bus=getBus();
      if(event.button!==0 || !canAttack(bus)) return;
      event.preventDefault();event.stopPropagation();
      pointerBus=bus;element.setPointerCapture(event.pointerId);
      activateAttack(bus,element);
    });
    element.addEventListener('pointerup',event=>{
      event.stopPropagation();pointerBus=null;
      if(heldAttack?.owner===element && !heldAttack.latched) finishAttack();
    });
    for(const type of ['pointercancel','lostpointercapture']) element.addEventListener(type,event=>{
      event.stopPropagation();
      if(pointerBus!==null && heldAttack?.bus===pointerBus) finishAttack();
      pointerBus=null;
    });
    element.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      // Some Chromium versions emit a touch click with detail 0. The touch
      // already activated on pointerdown, so only clicks without a pointer
      // source represent keyboard or assistive activation here.
      if(event.detail===0 && !event.pointerType) {
        if(forecastMode()||continuousMode()) activateAttack(getBus(),element);
        else if(!heldAttack) pulse(getBus());
      }
    });
    element.addEventListener('blur',()=>{
      if(heldAttack?.owner===element && !heldAttack.latched) finishAttack();
    });
    element.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' ') {
        event.preventDefault();event.stopPropagation();
        if(!event.repeat) activateAttack(getBus(),element);
      }
    });
    element.addEventListener('keyup',event=>{
      if(event.key==='Enter'||event.key===' ') {
        event.preventDefault();event.stopPropagation();
        if(heldAttack?.owner===element && !heldAttack.latched) finishAttack();
      }
    });
  }
  bindAttackTarget($('pulse'),()=>heldAttack?.latched ? heldAttack.bus : selectedBus);
  document.addEventListener('keyup',event=>{if(event.key.toLowerCase()==='d' && !forecastMode() && !heldAttack?.latched && !heldAttack?.owner) finishAttack();});
  window.addEventListener('blur',()=>{if(heldAttack) finishAttack();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden) { stop(); renderControls(); drawNetwork(); save(); }
  });
  $('fault').addEventListener('click',()=>fault());
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === 'd') { e.preventDefault(); if(forecastMode()) activateAttack(selectedBus,null); else beginAttack(); }
    else if (key === 'e') { e.preventDefault(); fault(); }
    else if (key === ' ' && !e.target.closest('button, [role=button], summary, a[href]')) { e.preventDefault(); toggleRun(); }
  });
  root.querySelectorAll('[data-series]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.series;
      if (visible.has(key) && plottedSeries().length > 1) visible.delete(key);
      else visible.add(key);
      button.setAttribute('aria-pressed', visible.has(key) ? 'true' : 'false');
      drawCost(); drawStage(); drawVoltage();
    });
  });
  function renderLearningView() {
    if(communicationComparison()) $('view').value='cost';
    const showCost=$('view')?.value==='cost';
    $('view').hidden=communicationComparison();
    if ($('cost-content')) $('cost-content').hidden=!showCost;
    if ($('learning-content')) $('learning-content').hidden=showCost;
    if ($('cost')) { $('cost').hidden=!showCost; $('cost').style.display=showCost?'':'none'; }
    if ($('convergence')) { $('convergence').hidden=showCost; $('convergence').style.display=showCost?'none':''; }
    if ($('learning-flow')) $('learning-flow').hidden=showCost;
    if ($('learning-title')) $('learning-title').textContent=showCost ? (snapshot.experiment==='communication'&&snapshot.phase==='discovery'?'Discovery costs':'Controller comparison') : snapshot.experiment==='communication'?'Learning the topology':'Forecast learning';
    if ($('learning-kind')) $('learning-kind').textContent='Original dashed · Matrix adaptation solid';
  }
  function protocolStatus() {
    const deployed=snapshot.phase==='deployment',saved=historyIndex!==null;
    return {phase:deployed?'deployment':'discovery',view:saved?'saved-discovery':deployed?'comparison':'discovery',
      discoverySamples:deployed?(snapshot.discoveryRecord?.t ?? snapshot.deployedSupport?.discoveryTime ?? 0):snapshot.t,
      comparisonSamples:deployed?snapshot.t:0,selection:deployed?'complete':'pending',synthesis:deployed?'complete':'pending',
      links:deployed?'fixed':'candidates',predictionWeights:deployed&&snapshot.experiment==='communication'?'fixed':'adaptive',
      historyAt:saved?(historyIndex?topology.events[historyIndex-1]?.t:topology.initialT) ?? 0:null};
  }
  function renderProtocol() {
    const status=protocolStatus(),deployed=status.phase==='deployment',phase=$('phase');
    const receipt=deployed?'Offline selection and synthesis complete · '+status.discoverySamples+' discovery samples · Fresh comparison · '
      +(status.predictionWeights==='fixed'?'Links and prediction weights fixed':'Links fixed · Prediction correction adapts')
      :'Dense discovery · Candidate sparse links · Offline selection and synthesis at comparison';
    phase.textContent=deployed?'Comparison trial':automaticComparison()
      ?'Discovery '+snapshot.t+' / '+DISCOVERY_SAMPLES+' s':'Discovery '+snapshot.t+' s';
    for(const [key,value] of Object.entries(status))phase.dataset[key]=value===null?'':String(value);
    phase.title=receipt+' · No joint online topology adaptation is claimed.';
    $('phase-note').textContent=status.view==='saved-discovery'
      ? 'Saved discovery links at '+status.historyAt+' s · Plant and costs remain in '+(deployed?'comparison':'discovery')+' · Latest restores current links'
      :receipt;
    $('phase-note').title=receipt;
    $('matrix-title').textContent=status.view==='saved-discovery'?'Discovery links at '+status.historyAt+' s'
      :deployed?'Deployed prediction links':'Candidate prediction links';
  }
  function renderControls() {
    renderInspectedSource();
    const frozen=isFit();
    const deployed=snapshot.phase==='deployment',communication=snapshot.experiment==='communication';
    const completedRows=snapshot.learning?.completedRows || 0;
    const preparing=!deployed && automaticComparison();
    renderProtocol();
    if($('deploy')) { $('deploy').hidden=preparing; $('deploy').disabled=comparing || (!deployed && !snapshot.canDeploy); $('deploy').textContent=deployed?'Learn again':'Compare controllers'; $('deploy').title=deployed?'Start a new discovery trial with these forecast settings':snapshot.canDeploy?'Start four controllers on the same fresh disturbance sequence':'Collecting observed samples for comparison'; }

    $('noise-control').hidden=!communication; $('noise-caption').hidden=!communication; $('preset-control').hidden=communication;
    const beta=snapshot.beta || 0;
    $('noise-caption').textContent=beta===0?'No forecast noise':'Noise SD · Noisy buses '+d3.format('.3~g')(4*beta)+'× reference scale · Quiet buses '+d3.format('.3~g')(.05*beta)+'×';
    $('noise-caption').title='Forecast error standard deviation in pu uses the declared physical voltage forcing reference scale for each source. This scale is set by the feeder and disturbance generator, not estimated from the current run. β multiplies all source noise levels.';
    $('experiment').disabled=comparing; $('noise').disabled=comparing; $('power-scenario').disabled=comparing;
    const scenario=snapshot.scenario;
    $('scenario-status').hidden=scenario?.id!=='solar-outage';
    $('scenario-status').textContent=snapshot.phase!=='deployment'?'Solar outage reserved for comparison · Four sites · 30 to 50 s':snapshot.t<=30?'Solar outage starts at comparison 30 s':scenario.active?'Solar outage · '+scenario.requestedKw.toFixed(1)+' kW requested · '+scenario.appliedKw.toFixed(1)+' kW applied':'Solar restored · Background power continues';
    const gapOption=$('cost-metric').querySelector('option[value="gap"]');
    if(gapOption) gapOption.textContent=communicationComparison()?'Difference vs fixed sparse':'Difference vs scalar';
    const matrixChangeOption=$('matrix-view').querySelector('option[value="change"]');
    if(matrixChangeOption) matrixChangeOption.textContent=communicationComparison()?'Learned scores':'Learning weights';
    $('cost-metric').hidden=false;
    if(!plottedSeries().length) activeSeries().forEach(item=>visible.add(item.key));
    root.querySelectorAll('[data-series]').forEach(button=>{
      const item=series.find(item=>item.key===button.dataset.series);
      button.hidden=!activeSeries().includes(item);
      const swatch=button.querySelector('.pr-swatch');
      if(swatch) button.replaceChildren(swatch,document.createTextNode(item.label));
      button.setAttribute('aria-pressed',String(visible.has(item.key)));
    });

    $('clock').textContent=(deployed?'Comparison t = ':'Discovery t = ')+snapshot.t+' s';
    $('learning').textContent=frozen?'Plant held · '+snapshot.mode:deployed?'Prediction links fixed':completedRows+' completed responses';
    $('run').textContent=playing?'Pause':frozen && snapshot.mode!=='converged'?'Fit':'Run';
    $('run').disabled=comparing;
    $('compare').disabled=comparing;
    $('compare').textContent=comparing ? 'Running…' : 'Advance 180';
    $('preset').disabled=comparing;
    $('restart').disabled=comparing;
    $('run').setAttribute('aria-label',playing?'Pause simulation':frozen?'Run frozen fit':'Run simulation');
    $('run').setAttribute('aria-pressed',String(playing));
    const forecast=forecastMode();root.dataset.interaction=forecast?'forecast':'power';
    $('attack-mode').hidden=forecast;$('strength').hidden=forecast;
    if ($('pulse-label')) $('pulse-label').textContent=!forecast&&heldAttack?.latched?'Stop attack':selectedBus===1?'Fixed substation':forecast
      ?(snapshot.faults.includes(selectedBus)?'Repair':'Corrupt')+' bus '+selectedBus:'Attack bus '+selectedBus;
    $('pulse').setAttribute('aria-pressed',String(forecast?snapshot.faults.includes(selectedBus):!!heldAttack));
    $('pulse').dataset.holding=String(!!heldAttack);
    $('pulse').title=forecast?(!forecastNoiseEnabled()?'Noise is disabled at β 0. This toggles the configured source label only.':'Toggle noisy forecasts from bus '+selectedBus+'. Only newly issued forecasts change.'):heldAttack?.latched?'Stop the continuous attack at bus '+heldAttack.bus:attackInstruction();
    const feedback=attackFeedback(heldAttack?.bus ?? selectedBus);
    $('pulse').dataset.attackState=forecast?(forecastNoisy(selectedBus)?'noisy':'quiet'):feedback.state;
    $('attack-hint').textContent=forecast?(snapshot.phase==='deployment'?'Links remain fixed':forecastNoiseEnabled()?'New forecasts only':'No noise at β 0'):feedback.hint;
    $('step').textContent=frozen?'100 fit steps':'Step';
    $('step').disabled=comparing || snapshot.mode==='converged';
    $('freeze').hidden=true;
    $('freeze').disabled=true;
    $('pulse').disabled=!heldAttack && !canAttack(selectedBus); $('strength').disabled=false; $('fault').disabled=!canAttack(selectedBus);
    $('fault').textContent=(snapshot.faults.includes(selectedBus)?'Repair':'Corrupt')+' forecast';
    const calibration=snapshot.calibration;
    $('fit-title').textContent='Shared prediction adaptation';
    $('fit-detail').textContent='First update at 30 s · Uses up to 60 revealed samples · Five second preview';
    $('mode-note').textContent=communicationComparison()?'Learning complete · Links and prediction weights stay fixed.'
      :(deployed?'Links stay fixed while prediction weights adapt. ':preparing?'Fresh comparison starts after 180 s. ':'')+'Errors are measured before each observed sample enters learning.';
    const i=selectedBus-1, sample=snapshot.lastSample;
    const write=(id,value)=>{if($(id))$(id).textContent=value;};
    write('flow-predict',selectedBus===1 ? 'Fixed slack' : sample ? 'ŵ '+d3.format('+.2~g')(sample.forecast[i])+' pu' : 'Awaiting forecast');
    write('flow-control',hasInverter(selectedBus) ? 'Q* '+d3.format('+.0f')(reactiveCommand(selectedBus))+' kvar' : 'No inverter');
    write('flow-observe',selectedBus===1 ? busVoltage(1).toFixed(3)+' pu' : sample ? 'w '+d3.format('+.2~g')(sample.disturbance[i])+' pu' : 'Awaiting response');
    write('flow-update',communicationComparison()?'Learning complete':calibration?.updates ? calibration.windowSize+' revealed samples' : 'Starts at 30 s');
    renderLearningView();
  }
  function drawNetwork() {
    const el = $('network');
    const width = Math.max(240, el.getBoundingClientRect().width);
    const height = 220;
    const svg = d3.select(el).attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height)
      .attr('role','group').attr('aria-label','Radial power feeder. '+attackInstruction()+(forecastMode()?'. Changes forecast reliability, not physical power.':'. Disturbances change load, solar generation or battery charging.'));
    const point = bus => [25 + positions[bus - 1][0] * (width - 54), 26 + positions[bus - 1][1] * (height - 54)];
    if (svg.select('defs').empty()) {
      svg.append('title').text('Radial electrical feeder and prediction source links');
      const defs = svg.append('defs');
      for (const [name,fill] of [['retained',color('var(--viz-series-1)')],['added',color(matrixColors.added)],['removed',color(matrixColors.removed)]]) {
        defs.append('marker').attr('id','pr-arrow-'+name).attr('viewBox','0 0 10 10').attr('refX',9).attr('refY',5).attr('markerUnits','userSpaceOnUse').attr('markerWidth',7).attr('markerHeight',7).attr('orient','auto').append('path').attr('d','M 0 0 L 10 5 L 0 10 Z').attr('fill',fill);
      }
      svg.append('g').attr('class','physical');
      svg.append('g').attr('class','recommended');
      svg.append('g').attr('class','nodes');
    }
    svg.select('.physical').selectAll('line').data(PowerDemo.constants.edges).join('line')
      .attr('x1',e => point(e[0])[0]).attr('y1',e => point(e[0])[1]).attr('x2',e => point(e[1])[0]).attr('y2',e => point(e[1])[1])
      .attr('stroke','var(--foreground)').attr('stroke-opacity',.15).attr('stroke-width',1.3);
    const frame=topologyFrame(),recommendations=frame.links || [],inspection=predictionInspection();
    svg.attr('aria-description',inspection?inspection.label:historyIndex!==null?'Saved discovery prediction links. Physical buses show the current plant state.':'Inspect a matrix cell to locate its source and inverter here.');
    const current = new Set(recommendations.map(recommendationKey));
    const reference = frame.reference;
    const retained = recommendations.map(edge => ({...edge, change:reference.has(recommendationKey(edge)) ? 'retained' : 'added'}));
    const removed = (frame.event?.before || []).filter(edge => !current.has(recommendationKey(edge))).map(edge => ({...edge,change:'removed'}));
    const allEdges = [...removed,...retained];
    const edges = $('all-links').checked ? allEdges : allEdges.filter(e => e.to === selectedBus || e.change !== 'retained');
    const strength = d3.scaleSqrt().domain([0,Math.max(d3.max(recommendations,e => e.weight) || 0,1e-12)]).range([1,3]);
    function arc(e) {
      const a = point(e.from), b = point(e.to), dx=b[0]-a[0], dy=b[1]-a[1];
      const offset = e.from < e.to ? 1 : -1;
      const c=[(a[0]+b[0])/2 - dy*.18*offset, (a[1]+b[1])/2 + dx*.18*offset];
      const da = Math.hypot(c[0]-a[0],c[1]-a[1]) || 1, db=Math.hypot(b[0]-c[0],b[1]-c[1]) || 1;
      const start=[a[0]+12*(c[0]-a[0])/da,a[1]+12*(c[1]-a[1])/da];
      const end=[b[0]-14*(b[0]-c[0])/db,b[1]-14*(b[1]-c[1])/db];
      return 'M'+start.join(',')+' Q'+c.join(',')+' '+end.join(',');
    }
    const links = svg.select('.recommended').selectAll('path').data(edges,e => e.from+'_'+e.to).join(
      enter => enter.append('path').attr('d',arc).attr('opacity',0),
      update => update,
      exit => { if (reducedMotion) exit.remove(); else exit.interrupt('update').transition('update').duration(240).attr('opacity',0).remove(); }
    ).attr('fill','none').attr('data-from',e => e.from).attr('data-to',e => e.to).attr('data-change',e => e.change)
      .attr('data-inspected',e=>String(!!inspection && inspection.connected && !inspection.local && e.change!=='removed' && e.from===inspection.source && e.to===inspection.receiver))
      .attr('stroke-dasharray',e => e.change === 'removed' ? '3 4' : null)
      .attr('marker-end',e => 'url(#pr-arrow-'+e.change+')');
    animate(links).attr('d',arc)
      .attr('stroke',e => color(e.change === 'retained' ? 'var(--viz-series-1)' : matrixColors[e.change]))
      .attr('stroke-width',e => inspection?.connected && e.change!=='removed' && e.from===inspection.source && e.to===inspection.receiver ? 4 : e.change !== 'retained' ? 2.5 : Number.isFinite(e.weight)?strength(e.weight):1.5)
      .attr('opacity',e => inspection?.connected && e.change!=='removed' && e.from===inspection.source && e.to===inspection.receiver ? 1 : e.change !== 'retained' ? .95 : e.to === selectedBus ? .7 : .12);
    const nodes = svg.select('.nodes').selectAll('g.bus-node').data(d3.range(1,25),bus => bus).join(enter => {
      const g=enter.append('g').attr('class','bus-node').attr('role','button').attr('tabindex',0)
        .style('cursor','pointer').style('user-select','none');
      g.append('circle').attr('class','pr-inspection-ring').attr('r',21).attr('fill','none').attr('pointer-events','none');
      g.append('text').attr('class','bus-number').attr('pointer-events','none');
      g.append('text').attr('class','fault-mark').attr('pointer-events','none');
      if (window.PowerEquipment) g.each(function(bus){PowerEquipment.render(d3.select(this),busRole(bus));});
      const forecastBadge=g.append('g').attr('class','pr-forecast-badge').attr('transform','translate(16 11)').attr('pointer-events','none');
      forecastBadge.append('circle').attr('r',8);
      forecastBadge.append('path').attr('d','M-5 0H-3L-1-4 2 4 4 0H5');
      forecastBadge.append('title');
      g.append('title').attr('class','bus-description');
      g.each(function(bus){bindAttackTarget(this,()=>bus);});
      return g;
    }).attr('transform',bus => 'translate('+point(bus).join(',')+')')
      .attr('data-bus',bus => bus).attr('data-role',bus => busRole(bus))
      .attr('data-inspection-role',bus=>inspection ? (bus===inspection.source && bus===inspection.receiver?'local':bus===inspection.source?'source':bus===inspection.receiver?'receiver':'none') : 'none')
      .attr('aria-label',bus => bus===1 ? 'Fixed substation at bus 1' : forecastMode()?(snapshot.faults.includes(bus)?'Repair':'Corrupt')+' forecast at bus '+bus:(heldAttack?.latched && heldAttack.bus===bus?'Stop attack at bus ':continuousMode()?'Toggle continuous attack at bus ':'Hold to attack bus ')+bus)
      .attr('aria-description',bus => busRole(bus)+', '+busVoltage(bus).toFixed(4)+' pu'+(appliedPulse(bus)?', '+appliedPulseLabel(bus):pulseStatus(bus).queued?', pulse pending':''))
      .attr('aria-disabled',bus => String(!canAttack(bus)))
      .style('cursor',bus=>canAttack(bus) ? 'pointer' : 'default')
      .on('pointerenter',function(_event,bus) {
        showBusDetail(bus,true);
      })
      .on('pointerleave',function() { showBusDetail(selectedBus); })
      .on('focus',function(_event,bus) {
        showBusDetail(bus,true);
      })
      .on('blur',function() { showBusDetail(selectedBus); });
    nodes.each(function(bus){
      if (!window.PowerEquipment) return;
      const status=pulseStatus(bus);
      PowerEquipment.update(d3.select(this),{
        voltage:busVoltage(bus),referenceVoltage:referenceVoltage(bus),input:reactivePower(bus),
        inputScale:PowerDemo.constants.busProfiles?.[bus-1]?.inverterKvar || 100,selected:bus===selectedBus,activePulse:status.active,activePulses:status.activeCount,queuedPulses:status.queued,
        pulseId:status.id,phase:snapshot.t,attackPowerKw:appliedPulse(bus)?.applied,attackHeld:heldAttack?.bus===bus,attackLatched:heldAttack?.bus===bus && heldAttack.latched,paused:!((playing && !isFit()) || comparing)
      });
      const badge=d3.select(this).select('.pe-attack-badge');
      const badgeWidth=Number(badge.select('rect').attr('width')) || 60;
      badge.attr('transform','translate('+(point(bus)[0]>width-95 ? -badgeWidth-10 : 13)+' -16)');
    });
    nodes.select('.bus-number').attr('text-anchor','middle').attr('x',0).attr('y',27)
      .style('fill','var(--muted-foreground)').style('font-size','9px').text(bus=>bus);
    nodes.select('.pr-inspection-ring')
      .attr('display',bus=>inspection && (bus===inspection.source || bus===inspection.receiver)?null:'none')
      .attr('stroke',bus=>bus===inspection?.source?'var(--primary)':'var(--foreground)').attr('stroke-width',2)
      .attr('stroke-dasharray',bus=>bus===inspection?.source && bus!==inspection.receiver?'3 3':null);
    nodes.attr('data-forecast-noisy',bus=>String(forecastNoisy(bus)));
    nodes.select('.pr-forecast-badge').attr('display',bus=>forecastNoisy(bus)?null:'none')
      .select('title').text(bus=>'Bus '+bus+' has a noisy forecast channel. This marker shows the current error generator setting, not a learner input.');
    nodes.select('.fault-mark').text('');
    nodes.select('.bus-description').text(bus=>busRole(bus)+' · Bus '+bus+' · '+busVoltage(bus).toFixed(4)+' pu · '+powerDescription(bus)+(hasInverter(bus)?' · Q '+reactivePower(bus).toFixed(0)+' kvar':'')+'. '+(bus===1?'Fixed voltage substation.':forecastMode()?(forecastNoisy(bus)?'Noisy forecast channel. ':'Quiet forecast channel. ')+(snapshot.faults.includes(bus)?'Click to repair new forecasts.':'Click to corrupt new forecasts.'):disturbanceName(bus)+' '+pulseMagnitude($('strength').value)+' requested. '+attackInstruction()+'.'));
    showBusDetail(selectedBus);
    const voltages=d3.range(1,25).map(bus=>busVoltage(bus));
    const low=Math.min(...voltages), high=Math.max(...voltages);
    const inRange=low>=.95 && high<=1.05;
    const nearNominal=voltages.every((voltage,index)=>Math.abs(voltage-referenceVoltage(index+1))<.001);
    const feedbackBus=heldAttack?.bus ?? (attackState(selectedBus)!=='idle'?selectedBus:lastPulse?.bus ?? selectedBus);
    const feedback=attackFeedback(feedbackBus);
    if(forecastMode()) actionNote(forecastInstruction());
    else if(feedback.state==='continuous' || feedback.state==='held') actionNote('Adding attacks · Bus '+feedbackBus);
    else if(feedback.state==='pending') actionNote('Queued at bus '+feedbackBus+' · Next sample');
    else if(feedback.state==='fading' || feedback.state==='paused') actionNote((feedback.state==='paused'?'Paused':'Fading')+' · '+appliedPulseLabel(feedbackBus));
    else actionNote(nearNominal ? attackInstruction() : 'Restoring the nominal profile');
    if ($('voltage-range')) $('voltage-range').textContent=low.toFixed(3)+' to '+high.toFixed(3)+' pu';
    if ($('voltage-status')) {
      $('voltage-status').title=inRange ? 'Within illustrative band' : 'Restoring voltage';
      $('voltage-status').dataset.state=inRange ? 'stable' : 'recovering';
    }
    const sources = recommendations.filter(e => e.to === selectedBus).map(e => e.from).join(', ');
    $('topology-label').textContent = $('all-links').checked ? 'All learned links' : hasInverter(selectedBus) ? 'Sources '+sources+' → inverter '+selectedBus : 'No inverter at bus '+selectedBus;
    $('links-detail').textContent = 'Prediction links · Electrical feeder and feedback remain fixed';
  }
  function showBusDetail(bus,hovered=false) {
    const status=pulseStatus(bus);
    $('bus-detail').textContent='Bus '+bus+' · '+busVoltage(bus).toFixed(4)+' pu · '+powerDescription(bus)
      +(hasInverter(bus)?' · Q '+reactivePower(bus).toFixed(0)+' kvar':'')
      +(forecastMode()&&bus!==1?' · Forecast '+(forecastNoisy(bus)?'noisy':'quiet'):'')
      +(status.queued?' · '+status.queued+' queued':hovered && canAttack(bus)?(forecastMode()?' · Click to '+(snapshot.faults.includes(bus)?'repair':'corrupt'):continuousMode()?' · Click to toggle attack':' · Hold to keep attacking'):'');
  }

  function drawMatrix() {
    const el=$('matrix'); if(!el) return;
    renderProtocol();
    if(!matrixReference) captureMatrixReference();
    const diagnostics=snapshot.predictionDiagnostics;
    const receivers=PowerDemo.constants.inverterBuses, sources=d3.range(2,25);
    const changing=$('matrix-view').value==='change', deployed=snapshot.phase==='deployment';
    const width=Math.max(240,el.getBoundingClientRect().width);
    const left=40,cellWidth=(width-left-8)/sources.length,cellHeight=17;
    const staggered=cellWidth<18,top=staggered?48:35,height=top+153;
    const frame=topologyFrame(),recommendations=frame.links || [],current=new Set(recommendations.map(recommendationKey));

    const added=[...current].filter(key=>!frame.reference.has(key)),removed=[...frame.reference].filter(key=>!current.has(key));
    const gainPercent=100*(diagnostics?.relativeGainChange || 0);
    const budget=predictionBudget(recommendations);
    const showSourceQuality=snapshot.experiment==='communication'&&snapshot.beta>0&&historyIndex===null;
    const noisySources=new Set(showSourceQuality?snapshot.faults:[]);
    $('link-budget').textContent=(historyIndex!==null?'Saved · ':deployed?'':'Candidate · ')+budget.remote+' of '+budget.dense+' remote links · '+budget.replaced+' replaced';
    $('link-budget').title='Replacements relative to the offline fixed sparse topology. Remote prediction channels only. Local predictions and common state feedback are excluded.';
    $('noisy-links').hidden=!showSourceQuality||!deployed||historyIndex!==null;
    $('noisy-links').textContent=budget.noisy+' noisy remote links used · Fixed sparse '+budget.fixedNoisy;
    $('noisy-links').title='Counts use the displayed deployed support and current source noise settings. Noise labels describe the error generator and are not supplied to the learner.';
    const replaced=diagnostics?.changedLinkCount || 0;
    const matrixReceiver=hasInverter(selectedBus)?selectedBus:null;
    const selectedSources=recommendations.filter(e=>e.to===selectedBus).map(e=>e.from).sort((a,b)=>a-b);
    $('matrix-detail').textContent=changing ? (communicationComparison()?'Saved discovery scores':'Coefficient change '+d3.format('.3~g')(gainPercent)+'%') : matrixReceiver ? 'Inverter '+selectedBus+' ← '+selectedSources.join(', ') : 'Eight inverter receivers';
    $('matrix-changes').textContent=(deployed?(historyIndex===null?(communicationComparison()?'vs fixed sparse · ':'Fixed links · '):'Discovery history · '):'')+added.length+' added · '+removed.length+' removed';
    $('matrix-changes').title=communicationComparison()&&historyIndex===null?'Deployed learned topology compared with fixed sparse':'Changes in the displayed topology update';
    drawTopologyHistory();
    const delta=diagnostics?.receiverNormalizedChange || receivers.map(()=>sources.map(()=>0));
    const maximum=Math.max(.0001,...delta.flat().map(v=>Math.abs(v)));
    const shade=d3.scaleLinear().domain([-maximum,0,maximum]).range(['#c56c1b','#f5f5f7','#0071e3']).clamp(true);
    const changeLabel=d3.format('.2~g')(100*maximum)+'%';
    const key=$('matrix-key');key.replaceChildren();
    for(const [className,label] of changing ? [['decreased','−'+changeLabel],['change-scale','Change in row energy'],['increased','+'+changeLabel],['outline','Selected']]
      : [['connected','Selected'],['added','Added'],['removed','Removed'],['local','Local']]) {
      const span=document.createElement('span'),icon=document.createElement('i');icon.className='pr-cell-key '+className;span.append(icon,document.createTextNode(label));key.append(span);
    }
    if(showSourceQuality) {
      const label=document.createElement('span'),icon=document.createElement('i');
      icon.className='pr-cell-key noisy-source';label.append(icon,document.createTextNode('Noisy source'));
      label.title='Amber source numbers currently have larger forecast noise. These labels describe the error generator and are not learner inputs.';
      key.append(label);
    }
    const svg=d3.select(el).attr('viewBox','0 0 '+width+' '+height).attr('height',height)
      .attr('role','group').attr('aria-label',historyIndex!==null?'Saved discovery prediction sources for eight inverter receivers':changing?'Learning changes in predictive response weights':'Current selected prediction sources for eight inverter receivers')
      .attr('data-gain-change',gainPercent).attr('data-source-changes',added.length).attr('data-offline-source-changes',replaced)
      .attr('data-history-index',historyIndex===null?'latest':historyIndex).attr('data-topology-updates',topology.cumulative.transitions);
    if(svg.select('.matrix-cells').empty()) {
      svg.append('title');svg.append('text').attr('class','matrix-source-title matrix-axis');
      svg.append('text').attr('class','matrix-receiver-title matrix-axis');
      svg.append('g').attr('class','matrix-columns');svg.append('g').attr('class','matrix-cells');
      svg.append('rect').attr('class','matrix-selected-row').attr('fill','none').attr('pointer-events','none');
      svg.append('rect').attr('class','matrix-inspected-cell').attr('fill','none').attr('pointer-events','none');
      svg.append('g').attr('class','matrix-rows');
    }
    svg.select('title').text(changing?'Signed change in learned gain energy divided by each receiver’s offline energy. Outline shows selected sources.':'Rows are inverter receivers. Columns are prediction sources.');
    svg.select('.matrix-source-title').attr('x',left+(width-left)/2).attr('y',10).attr('text-anchor','middle').text('Source bus');
    svg.select('.matrix-receiver-title').attr('transform','translate(9,'+(top+cellHeight*4)+') rotate(-90)').attr('text-anchor','middle').text('Inverter');
    const labelY=(_,i)=>top-8-(staggered&&i%2===0?14:0);
    svg.select('.matrix-columns').selectAll('line').data(staggered?sources:[]).join('line')
      .attr('x1',(_,i)=>left+(i+.5)*cellWidth).attr('x2',(_,i)=>left+(i+.5)*cellWidth)
      .attr('y1',(bus,i)=>labelY(bus,i)+3).attr('y2',top-3).attr('stroke','#d9d9df');
    const sourceLabels=svg.select('.matrix-columns').selectAll('text').data(sources).join('text').attr('x',(_,i)=>left+(i+.5)*cellWidth).attr('y',labelY).attr('text-anchor','middle')
      .attr('data-inspected',bus=>String(bus===inspectedSource)).attr('data-noisy',bus=>String(noisySources.has(bus)))
      .attr('aria-label',bus=>'Source bus '+bus+(noisySources.has(bus)?' · Noisy forecast source':''))
      .text(bus=>bus);
    sourceLabels.append('title').text(bus=>'Bus '+bus+(noisySources.has(bus)?' · Noisy forecast source':showSourceQuality?' · Quiet forecast source':'')
      +(showSourceQuality?' · Current error generator label, not a learner input':''));
    const cells=receivers.flatMap((receiver,i)=>sources.map((source,j)=>{
      const id=receiver+','+source,local=receiver===source,connected=local||current.has(id);
      const change=local?'local':current.has(id)?(frame.reference.has(id)?'retained':'added'):frame.reference.has(id)?'removed':'inactive';
      return {receiver,source,i,j,local,connected,change,delta:delta[i]?.[j] || 0};
    }));
    const inspected=cells.find(d=>d.receiver===matrixReceiver&&d.source===inspectedSource);
    const connectionStatus=d=>d.local?'Local source':d.change==='added'?'Added link':d.change==='removed'?'Removed link':d.connected?'Selected link':'No link';
    const cellLabel=d=>'Bus '+d.source+' → inverter '+d.receiver+' · '+connectionStatus(d)
      +(changing?' · Energy change '+d3.format('+.3~g')(100*d.delta)+'% of offline receiver energy':'');
    if(inspected) $('matrix-detail').textContent=cellLabel(inspected);
    $('matrix-detail').title=inspected?'Inspect with arrow keys. This only changes the view.':'Tap a cell to inspect a source and receiver. This only changes the view.';
    $('matrix-inspect-hint').style.visibility=inspected?'hidden':'visible';
    const inspect=(receiver,source,focus=false)=>{
      inspectPredictionLink(receiver,source);
      if(focus) svg.select('.matrix-cells').selectAll('rect').filter(d=>d.receiver===receiver&&d.source===source).node()?.focus();
    };
    const marks=svg.select('.matrix-cells').selectAll('rect').data(cells,d=>d.receiver+','+d.source).join(enter=>{const r=enter.append('rect').attr('class','matrix-cell');r.append('title');return r;})
      .attr('x',d=>left+d.j*cellWidth+1).attr('y',d=>top+d.i*cellHeight+1).attr('width',Math.max(2,cellWidth-2)).attr('height',cellHeight-2).attr('rx',2)
      .attr('data-receiver',d=>d.receiver).attr('data-source',d=>d.source).attr('data-connected',d=>String(d.connected)).attr('data-change',d=>d.change).attr('data-weight-change',d=>d.delta)
      .attr('role','button').attr('aria-label',d=>'Inspect '+cellLabel(d))
      .attr('tabindex',d=>d.receiver===(matrixReceiver||receivers[0])&&d.source===(inspectedSource||sources[0])?0:-1)
      .style('cursor','pointer').on('click',(_event,d)=>inspect(d.receiver,d.source))
      .on('keydown',(event,d)=>{
        if(event.key==='Enter'||event.key===' ') {event.preventDefault();inspect(d.receiver,d.source);}
        else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
          event.preventDefault();event.stopPropagation();
          const row=Math.max(0,Math.min(receivers.length-1,d.i+(event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0)));
          const column=event.key==='Home'?0:event.key==='End'?sources.length-1:Math.max(0,Math.min(sources.length-1,d.j+(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0)));
          inspect(receivers[row],sources[column],true);
        }
      });
    animate(marks).attr('fill',d=>changing?shade(d.delta):color(d.change==='removed'?'var(--background)':d.change==='retained'?matrixColors.connected:matrixColors[d.change] || matrixColors.inactive))
      .attr('stroke',d=>changing?(d.change==='added'?color(matrixColors.added):d.change==='removed'?color(matrixColors.removed):d.connected?'#404047':'transparent'):d.change==='removed'?color(matrixColors.removed):d.change==='added'?color(matrixColors.added):'transparent')
      .attr('stroke-width',d=>changing&&d.connected?1.2:d.change==='removed'?1.4:0).attr('stroke-dasharray',d=>changing&&d.change==='removed'?'2 2':null);
    marks.select('title').text(cellLabel);
    svg.select('.matrix-inspected-cell').attr('x',left+(inspected?.j||0)*cellWidth-.5).attr('y',top+(inspected?.i||0)*cellHeight-.5)
      .attr('width',cellWidth+1).attr('height',cellHeight+1).attr('rx',3).attr('stroke','#1d1d1f').attr('stroke-width',2).attr('display',inspected?null:'none');
    svg.select('.matrix-selected-row').attr('x',left-2).attr('y',top+receivers.indexOf(matrixReceiver)*cellHeight-1)
      .attr('width',width-left-5).attr('height',cellHeight+2).attr('rx',3).attr('stroke','#1d1d1f').attr('stroke-width',1).attr('display',matrixReceiver?null:'none');
    const rows=svg.select('.matrix-rows').selectAll('g').data(receivers).join(enter=>{
      const g=enter.append('g').attr('role','button').attr('tabindex',0).style('cursor','pointer');
      g.append('rect').attr('x',-10).attr('width',20).attr('height',cellHeight).attr('y',-cellHeight/2).attr('rx',3);
      g.append('text').attr('text-anchor','middle').attr('dy','.34em');return g;
    }).attr('transform',(bus,i)=>'translate('+(left-15)+','+(top+(i+.5)*cellHeight)+')')
      .attr('aria-label',bus=>'Select inverter '+bus).attr('aria-pressed',bus=>String(bus===selectedBus))
      .on('click',(_event,bus)=>selectBus(bus)).on('keydown',(event,bus)=>{
        if(event.key==='Enter'||event.key===' ') {event.preventDefault();selectBus(bus);}
        else if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
          event.preventDefault();const i=receivers.indexOf(bus),next=event.key==='Home'?receivers[0]:event.key==='End'?receivers.at(-1):receivers[Math.max(0,Math.min(receivers.length-1,i+(event.key==='ArrowUp'?-1:1)))];
          selectBus(next);svg.select('.matrix-rows').selectAll('g').filter(value=>value===next).node()?.focus();
        }
      });
    rows.select('rect').attr('fill',bus=>bus===selectedBus?'var(--primary)':'transparent');
    rows.select('text').style('fill',bus=>bus===selectedBus?'#fff':'var(--muted-foreground)').text(bus=>bus);
  }
  function chartBase(el, observations, keys, yTitle, xTitle, height, options={}) {
    const width = Math.max(240,el.getBoundingClientRect().width);
    const margin = {left:52,right:12,top:25,bottom:26};
    const frame={x:margin.left,y:margin.top,w:width-margin.left-margin.right,h:height-margin.top-margin.bottom};
    const svg=d3.select(el).attr('viewBox','0 0 '+width+' '+height).attr('height',height);
    const clip='pr-clip-'+el.id;
    if (svg.select('.chart-marks').empty()) {
      svg.append('title');
      svg.append('rect').attr('data-chart-frame','').attr('fill','none').attr('stroke','var(--border)');
      svg.append('g').attr('class','grid');
      svg.append('g').attr('class','x-axis');
      svg.append('g').attr('class','y-axis');
      svg.append('text').attr('class','axis-title').attr('data-axis','x').attr('text-anchor','middle');
      svg.append('text').attr('class','axis-title').attr('data-axis','y').attr('text-anchor','middle');
      svg.append('defs').append('clipPath').attr('id',clip).append('rect');
      svg.append('g').attr('class','chart-marks').attr('clip-path','url(#'+clip+')');
      svg.append('g').attr('class','intervention-labels');
    }
    svg.select('title').text(el.getAttribute('aria-label'));
    const [xmin,xmax]=d3.extent(observations,d=>d.x);
    const [ymin,ymax]=d3.extent(observations.flatMap(d=>keys.map(k=>d[k])).filter(Number.isFinite));
    const yl=Math.min(0,ymin || 0);
    const yh=Number.isFinite(ymax) && ymax>yl ? ymax : yl+1;
    const pad=(yh-yl)*.1;
    const x=d3.scaleLinear().domain(options.xDomain || [xmin || 0,(xmax === xmin ? (xmin || 0)+1 : xmax) || 1]).range([frame.x+2,frame.x+frame.w-2]);
    const y=d3.scaleLinear().domain(options.yDomain || [yl,yh+pad]).range([frame.y+frame.h-2,frame.y+2]);
    svg.select('[data-chart-frame]').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h);
    updateAxis(svg.select('.grid').attr('transform','translate('+frame.x+',0)'),d3.axisLeft(y).ticks(height<150?3:4).tickSize(-frame.w).tickFormat(''));
    const xticks = x.ticks(width < 400 ? 3 : 5).filter(Number.isInteger);
    updateAxis(svg.select('.x-axis').attr('transform','translate(0,'+(frame.y+frame.h)+')'),d3.axisBottom(x).tickValues(xticks).tickSize(4).tickFormat(d3.format('d')));
    updateAxis(svg.select('.y-axis').attr('transform','translate('+frame.x+',0)'),d3.axisLeft(y).ticks(height<150?3:4).tickSize(4).tickFormat(d3.format(options.yFormat || '.3~g')));
    svg.select('[data-axis=x]').attr('x',frame.x+frame.w/2).attr('y',height-5).text(xTitle);
    // Plot captions already name these quantities. Keep units accessible without
    // crowding the numeric ticks with a duplicate vertical label.
    svg.select('[data-axis=y]').text('').attr('aria-hidden','true');
    svg.select('.y-axis').attr('aria-label',yTitle);
    svg.select('clipPath rect').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h);
    const marks=svg.select('.chart-marks');
    return {svg,marks,x,y,frame,width,height};
  }
  function drawSeries(chart, observations, items, showCurrent = false) {
    // Put the learned controller last while preserving exact overlaps and sample values.
    const paintOrder=items.filter(item=>item.key!=='online').concat(items.filter(item=>item.key==='online'));
    const lines = chart.marks.selectAll('path.data-series').data(paintOrder,item => item.key).join(
      enter => enter.append('path').attr('class','data-series').attr('fill','none'),
      update => update,
      exit => exit.remove()
    ).order().attr('data-series-key',item => item.key).attr('stroke',item => item.color)
      .attr('stroke-width',item => item.key === 'online' ? 2.2 : 1.8).attr('stroke-dasharray',item => item.dash || null)
      .attr('stroke-linejoin','round').attr('stroke-linecap','round');
    // Repaint measured samples together with the axes. SVG path interpolation
    // blends unrelated points when the sample count or metric changes and can
    // briefly display invented curves against the new scale.
    lines.interrupt().interrupt('update').attr('d',item => d3.line().defined(d => Number.isFinite(d[item.key])).x(d=>chart.x(d.x)).y(d=>chart.y(d[item.key]))(observations));
    chart.marks.selectAll('path.sample-symbol').remove();
    const latest = observations[observations.length-1];
    const dots = chart.marks.selectAll('circle.latest-value').data(showCurrent && latest ? paintOrder : [],item => item.key).join('circle')
      .attr('class','latest-value').attr('r',item => item.key === 'online' ? 2.7 : 2)
      .attr('fill',item => item.color).attr('stroke','var(--background)').attr('stroke-width',.8).order();
    if(latest) dots.interrupt().interrupt('update').attr('cx',chart.x(latest.x)).attr('cy',item => chart.y(latest[item.key]));
  }

  function hover(chart,observations,items,xLabel) {
    const {svg,x,y,frame}=chart;
    const tip=$('tooltip');
    const guide=svg.selectAll('[data-chart-hover-guide]').data([null]).join('line').attr('data-chart-hover-guide','').attr('y1',frame.y).attr('y2',frame.y+frame.h).attr('stroke','var(--foreground)').attr('stroke-opacity',.3).attr('display','none');
    const dots=svg.selectAll('g.hover-dots').data([null]).join('g').attr('class','hover-dots');
    dots.selectAll('circle').remove();
    const overlay=svg.selectAll('[data-chart-hit]').data([null]).join('rect').attr('data-chart-hit','').attr('data-chart-hover-overlay','cross-series').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h).attr('fill','transparent').raise();
    function show(event) {
      const pointer=d3.pointer(event,svg.node());
      const xv=x.invert(Math.max(x.range()[0],Math.min(x.range()[1],pointer[0])));
      const near=d3.bisector(d=>d.x).center(observations,xv);
      const observation=observations[near];
      const px=x(observation.x);
      // Tooltips report actual sampled costs rather than interpolated readings.
      const values=items.map(item=>({...item,value:observation[item.key]}));
      guide.attr('x1',px).attr('x2',px).attr('display',null);
      dots.selectAll('circle').data(values,item=>item.key).join('circle').attr('data-chart-hover-marker','').attr('r',3).attr('cx',px).attr('cy',d=>y(d.value)).attr('fill',d=>d.color);
      tip.replaceChildren();
      const title=document.createElement('span'); title.textContent=xLabel+' '+observation.x; tip.append(title);
      values.forEach(item=>{const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('span');label.textContent=item.label;value.textContent=d3.format('.4~g')(item.value);row.append(label,value);tip.append(row);});
      tip.style.display='block';
      const bounds=root.getBoundingClientRect();
      const sx=event.clientX-bounds.left, sy=event.clientY-bounds.top;
      tip.style.left=Math.max(0,Math.min(root.clientWidth-tip.offsetWidth,sx+12))+'px';
      tip.style.top=Math.max(0,sy-tip.offsetHeight-12)+'px';
    }
    overlay.on('pointermove',event=>{if(!pin)show(event);}).on('pointerleave',()=>{if(!pin){tip.style.display='none';guide.attr('display','none');dots.selectAll('circle').remove();}}).on('click',event=>{pin=pin?null:svg.node().id;show(event);});
  }
  function drawInterventions(chart) {
    const domain=chart.x.domain();
    const scenarioEvents=(snapshot.eventLog || []).filter(item=>item.type==='scenario').map(item=>({...item,bus:0}));
    const events=[...journal,...scenarioEvents].sort((a,b)=>a.t-b.t).filter(item=>['pulse','fault','scenario'].includes(item.type) && item.t<snapshot.t && item.t+1>=domain[0] && item.t+1<=domain[1]);
    const groups=[];
    for(const item of events) {
      const x=chart.x(item.t+1), previous=groups.at(-1);
      if(previous && x-previous.right<120) {previous.items.push(item);previous.right=x;}
      else groups.push({left:x,right:x,items:[item]});
    }
    groups.forEach(group=>{
      const first=group.items[0]; group.key=first.t+'_'+first.type+'_'+first.bus;
      group.attacks=group.items.filter(item=>item.type==='pulse').length;
      group.count=group.attacks || group.items.length;
      group.scenario=group.items.some(item=>item.type==='scenario');
      group.label=group.scenario?'Solar event':group.attacks?(group.count>1?'Attacks':'Attack'):'Forecast changed';
      group.width=(group.attacks?24:16)+group.label.length*6;
      group.x=Math.max(chart.frame.x+group.width/2,Math.min(chart.frame.x+chart.frame.w-group.width/2,(group.left+group.right)/2));
    });
    const markers=chart.marks.selectAll('g.intervention-markers').data([null]).join('g').attr('class','intervention-markers');
    markers.selectAll('rect').data(groups,group=>group.key).join('rect')
      .attr('x',g=>g.left-2).attr('width',g=>Math.max(4,g.right-g.left+4))
      .attr('y',chart.frame.y).attr('height',chart.frame.h).attr('fill',g=>g.attacks?'var(--attack)':'#687580').attr('opacity',.085);
    markers.selectAll('line').data(groups,group=>group.key).join('line')
      .interrupt().interrupt('update').attr('x1',g=>g.left).attr('x2',g=>g.left)
      .attr('y1',chart.frame.y).attr('y2',chart.frame.y+chart.frame.h)
      .attr('stroke',g=>g.attacks?'var(--attack)':'#687580').attr('stroke-opacity',.65).attr('stroke-width',1.3).attr('stroke-dasharray','3 3');
    const labels=chart.svg.select('.intervention-labels').selectAll('g').data(groups,g=>g.key).join(enter=>{
      const badge=enter.append('g').attr('class','intervention-badge').attr('role','img');
      badge.append('title');badge.append('rect');badge.append('path');badge.append('text');return badge;
    }).attr('data-event-count',g=>g.items.length).attr('data-disturbance-count',g=>g.attacks)
      .attr('data-event-steps',g=>g.items.map(item=>item.t+1).join(','))
      .attr('aria-label',g=>g.scenario?g.items.filter(item=>item.type==='scenario').map(item=>item.message).join(' · '):g.attacks?g.attacks+' power pulses and '+(g.items.length-g.attacks)+' forecast changes':'Forecast reliability changed at '+[...new Set(g.items.map(item=>'bus '+item.bus))].join(', '));
    // Position badges directly. They must never fly in from a stale chart scale.
    labels.interrupt().interrupt('update').attr('transform',g=>'translate('+g.x+','+(chart.frame.y-14)+')');
    labels.select('rect').attr('x',g=>-g.width/2).attr('y',-10).attr('width',g=>g.width).attr('height',20).attr('rx',6)
      .attr('fill',g=>g.attacks?'var(--attack)':'#687580');
    labels.select('path').attr('transform',g=>'translate('+(-g.width/2+4)+',-8) scale(.7)')
      .attr('d',g=>g.attacks?'M14 1 3 13h7l-1 10L21 9h-8z':null).attr('fill','#fff');
    labels.select('text').attr('x',g=>g.attacks?8:0).attr('y',.5).attr('text-anchor','middle').attr('dominant-baseline','middle')
      .style('font-size','11px').style('font-weight','650').style('fill','#fff').text(g=>g.label);
    labels.select('title').text(g=>{
      const details=g.items.slice(-8).map(item=>item.type==='pulse'
        ? pulseMagnitude(item.strength || 100)+' at bus '+item.bus+' · Voltage and cost at t '+(item.t+1)+' s'
        : item.type==='scenario'?item.message+' · Applied at t '+(item.t+1)+' s': 'Bus '+item.bus+' forecast reliability changed · New forecasts only · t '+item.t+' s');
      const explanation=g.scenario?'Scheduled physical generation change · Absent from forecasts':g.attacks?g.attacks+' individual power pulses in this shaded interval':'Forecast settings changed here · This marker is not a power disturbance';
      return explanation+(g.items.length>8?' · Latest 8 events shown':'')+'\n'+details.join('\n');
    });
  }
  function drawCost() {
    const active=activeSeries(),items=plottedSeries();
    const gap=$('cost-metric').value==='gap';
    const observations=[{x:0,...Object.fromEntries(series.map(item=>[item.key,0]))},...snapshot.history.map(d=>({x:d.t,...Object.fromEntries(series.map(item=>[item.key,d[item.key]-(gap?d.scalar:0)]))}))];
    if ($('cost').hidden) return;
    $('cost').setAttribute('aria-label',gap?'Cumulative cost difference from '+gapReference()+'. Zero is the reference. Lower is better.':'Cumulative cost of '+active.length+' active controllers');
    const chart=chartBase($('cost'),observations,items.map(s=>s.key),gap?'Cost difference':'Cumulative cost','Time (s)',140);
    chart.marks.selectAll('line.cost-reference').data(gap?[0]:[]).join('line').attr('class','cost-reference')
      .attr('x1',chart.frame.x).attr('x2',chart.frame.x+chart.frame.w).attr('y1',chart.y(0)).attr('y2',chart.y(0))
      .attr('stroke','var(--muted-foreground)').attr('stroke-opacity',.35);
    drawInterventions(chart);
    drawSeries(chart,observations,items);
    hover(chart,observations,items,gap?'Cost difference at t':'Time (s)');
    const c=snapshot.cumulative;
    $('cost-detail').replaceChildren();
    for (const item of active) {
      const row=document.createElement('tr'), label=document.createElement('th'), value=document.createElement('td'), difference=document.createElement('td');
      const swatch=document.createElement('span'); swatch.className='pr-swatch '+item.key;
      label.scope='row'; label.append(swatch,document.createTextNode(item.label));
      value.textContent=costFormat(c[item.key]);value.title=d3.format('.10~g')(c[item.key]);
      value.dataset.cost=String(c[item.key]);
      difference.textContent=item.key==='causal' ? 'Reference' : comparativeCost(c[item.key],c.causal);
      row.dataset.method=item.key; row.append(label,value,difference); $('cost-detail').append(row);
    }
    $('comparison-summary').textContent=comparisonSummary();
    const recovery=powerRecoveryContext();
    $('cost-note').textContent=gap?'Below zero is cheaper · '+(recovery?'Totals include load recovery':'Table shows totals')
      : recovery || (snapshot.phase==='deployment'?(communicationComparison()?'Learning costs excluded · Prediction links only · Common feedback unchanged':'Fresh comparison · Learning costs excluded · Identical disturbances'):'Dense messages during learning · Adaptation starts at 30 s');
  }
  function comparisonSummary() {
    const c=snapshot.cumulative,comparison=comparativeCost(c.online,c.scalar);
    if(snapshot.experiment==='communication') {
      if(snapshot.phase!=='deployment') return 'Discovery costs · Sparse controllers have not been deployed';
      const dense=comparativeCost(c.online,c.static),budget=predictionBudget();
      if(comparison==='Pending'||dense==='Pending') return 'Fresh trial · '+budget.remote+' remote links for each sparse controller · '+budget.dense+' for dense';
      const describe=(value,name)=>value==='Equal'||value==='Nearly equal'?value.toLowerCase()+' to '+name:value+' than '+name;
      return (sameSparseSupport()?'Same selected links · ':'')+'Learned cost is '+describe(comparison,'fixed sparse')+' · '+describe(dense,'dense prediction');
    }
    const support=snapshot.phase==='deployment' && sameSparseSupport() ? 'Same links · Weights adapt independently. ' : '';
    return support+(comparison==='Pending'?'Run to compare all four controllers':comparison==='Equal' || comparison==='Nearly equal'
      ? 'Matrix and scalar costs are '+comparison.toLowerCase()+' so far'
      : 'Matrix cost is '+comparison+' than scalar adaptation');
  }
  function comparativeCost(value,reference) {
    if (!(reference>1e-12)) return 'Pending';
    if(Math.abs(value-reference)<=1e-12) return 'Equal';
    const percent=100*(value-reference)/reference;
    return Math.abs(percent)<.05 ? 'Nearly equal' : d3.format('.1f')(Math.abs(percent))+'% '+(percent<0?'lower':'higher');
  }

  function responseWindow() { return [Math.max(0,snapshot.t-80),Math.max(1,snapshot.t)]; }
  function drawStage() {
    if (!$('stage')) return;
    const domain=responseWindow();
    let observations=snapshot.history.filter(item=>(item.costTime ?? item.t-1)>=domain[0]).map(item=>({x:item.costTime ?? item.t-1,...item.stage}));
    if(!observations.length) observations=[{x:0,...Object.fromEntries(series.map(item=>[item.key,0]))}];
    const items=plottedSeries();
    const chart=chartBase($('stage'),observations,items.map(item=>item.key),'Cost','Time (s)',110,{xDomain:domain});
    drawInterventions(chart); drawSeries(chart,observations,items,true); hover(chart,observations,items,'Cost at t');
    $('stage-detail').textContent='Cost at t '+Math.max(0,snapshot.t-1)+' · '+costFormat(snapshot.stage.online);
    if ($('live-cost')) $('live-cost').textContent=costFormat(snapshot.stage.online);
    let summary='Voltage and cost share time t';
    if(lastPulse) {
      const charge=snapshot.history.find(item=>(item.costTime ?? item.t-1)===lastPulse.t+1);
      lastPulse.charged=!!charge;
      if(charge) lastPulse.after=charge.stage.online;
      summary=snapshot.t===lastPulse.t ? 'Queued at t '+lastPulse.t+' · Run or Step' : charge ? 'Cost '+d3.format('.3~g')(lastPulse.before)+' → '+d3.format('.3~g')(charge.stage.online) : 'Voltage changed · Cost appears next step';
    }
    if ($('impact-note')) $('impact-note').textContent=summary;
    if ($('pulse-summary')) $('pulse-summary').textContent=forecastMode()?'':summary;
  }
  function drawVoltage() {
    const el=$('voltage'); if(!el)return;
    const metrics=PowerDemo.voltageMetrics(snapshot);
    const rows=d3.select($('voltage-metrics')).selectAll('tr').data(activeSeries(),item=>item.key).join(enter=>{
      const row=enter.append('tr');row.append('th').attr('scope','row');
      row.append('td').attr('class','current-deviation');row.append('td').attr('class','peak-deviation');
      row.append('td').attr('class','limited-inverters');return row;
    }).attr('data-controller',item=>item.key)
      .attr('data-current-pu',item=>metrics[item.key].currentMaxPu).attr('data-peak-pu',item=>metrics[item.key].peakMaxPu)
      .attr('data-limited',item=>metrics[item.key].limitedCount);
    rows.select('th').text(item=>item.label);
    rows.select('.current-deviation').text(item=>(1000*metrics[item.key].currentMaxPu).toFixed(2))
      .attr('title',item=>'Largest absolute departure from nominal now at bus '+metrics[item.key].currentBus);
    rows.select('.peak-deviation').text(item=>(1000*metrics[item.key].peakMaxPu).toFixed(2))
      .attr('title',item=>'Peak at bus '+metrics[item.key].peakBus+' at t '+metrics[item.key].peakTime+' s in this phase');
    rows.select('.limited-inverters').text(item=>metrics[item.key].limitedCount+'/'+PowerDemo.constants.inverterBuses.length)
      .attr('title','Inverters whose reactive command was clipped at the last executed action');
    const domain=responseWindow(), index=selectedBus-1;
    let observations=snapshot.history.filter(item=>(item.stateTime ?? item.t)>=domain[0]).map(item=>({
      x:item.stateTime ?? item.t,
      ...Object.fromEntries(series.map(s=>[s.key,1+(item.states?.[s.key]?.[index] || 0)]))
    }));
    if(domain[0]===0) observations.unshift({x:0,...Object.fromEntries(series.map(item=>[item.key, snapshot.initialVoltage?.[index] ?? 1+(snapshot.initialStates?.[item.key]?.[index] ?? snapshot.history[0]?.costStates?.[item.key]?.[index] ?? snapshot.states[item.key][index])]))});
    if(!observations.length) observations=[{x:snapshot.t,...Object.fromEntries(series.map(s=>[s.key,1+snapshot.states[s.key][index]]))}];
    const items=plottedSeries();
    const values=observations.flatMap(item=>items.map(s=>item[s.key]));
    const reference=referenceVoltage(selectedBus);
    const low=Math.min(reference,...values),high=Math.max(reference,...values);
    const margin=Math.max(.001,(high-low)*.12);
    const chart=chartBase(el,observations,items.map(s=>s.key),'Voltage (pu)','Time (s)',110,{xDomain:domain,yDomain:[low-margin,high+margin],yFormat:'.4f'});
    chart.marks.selectAll('rect.goal-band').data([null]).join('rect').attr('class','goal-band')
      .attr('x',chart.frame.x).attr('width',chart.frame.w).attr('y',chart.y(1.05)).attr('height',chart.y(.95)-chart.y(1.05))
      .attr('fill','var(--primary)').attr('opacity',.055).lower();
    chart.marks.selectAll('line.voltage-target').data([.95,reference,1.05]).join('line').attr('class','voltage-target')
      .attr('x1',chart.frame.x).attr('x2',chart.frame.x+chart.frame.w).attr('y1',d=>chart.y(d)).attr('y2',d=>chart.y(d))
      .attr('stroke','var(--primary)').attr('stroke-opacity',d=>d===reference?.5:.18).attr('stroke-dasharray','3 4');
    drawInterventions(chart); drawSeries(chart,observations,items,true); hover(chart,observations,items,'Voltage at t');
    if($('voltage-detail'))$('voltage-detail').textContent='Bus '+selectedBus+' · Δ '+d3.format('+.2f')(1000*(busVoltage(selectedBus)-reference))+' mpu';
    if($('voltage-reference'))$('voltage-reference').textContent='Nominal '+reference.toFixed(4)+' pu';
    if($('state-value'))$('state-value').textContent=busVoltage(selectedBus).toFixed(4)+' pu';
  }
  function drawConvergence() {
    if (!$('convergence') || $('convergence').hidden) return;
    const el=$('convergence'),svg=d3.select(el);
    const observations=snapshot.history.filter(d=>Number.isFinite(d.rawForecastRms) && Number.isFinite(d.calibratedForecastRms))
      .map(d=>({x:d.t,raw:d.rawForecastRms,adapted:d.calibratedForecastRms}));
    if(!observations.length) {
      const width=Math.max(240,el.getBoundingClientRect().width),height=140;
      svg.attr('viewBox','0 0 '+width+' '+height).attr('height',height).attr('aria-label','Run to observe forecast errors');
      svg.selectAll('*').remove();
      svg.append('text').attr('class','learning-wait').attr('x',width/2).attr('y',60).attr('text-anchor','middle')
        .attr('fill','var(--muted-foreground)').attr('font-size',12).text('Run to observe forecast errors');
      return;
    }
    if(!svg.select('.learning-wait').empty()) svg.selectAll('*').remove();
    const items=[{key:'raw',label:'Original forecast',color:'var(--viz-series-2)',dash:'5 3'},
      {key:'adapted',label:'Matrix adaptation',color:'var(--viz-series-1)'}];
    el.setAttribute('aria-label','Original and matrix adapted forecast error in per unit, measured before learning each sample');
    const chart=chartBase(el,observations,items.map(item=>item.key),'Forecast error (pu)','Time (s)',140);
    drawInterventions(chart);drawSeries(chart,observations,items);hover(chart,observations,items,'Time (s)');
  }
  function render() {
    $('tooltip').style.display='none'; pin=null;
    renderControls(); drawNetwork(); drawMatrix(); drawCost(); drawStage(); drawVoltage(); drawConvergence();highlightTopology();
  }
  announce('Ready');
  hydrate(window.openai?.widgetState);
  if (!matrixReference) captureMatrixReference();
  actionNote(snapshot.pendingPulses?.length ? 'Pulse queued · Run or Step' : attackInstruction());
  window.addEventListener('openai:set_globals',e=>{if(!playing&&!restored&&!journal.length){hydrate(e.detail?.globals?.widgetState);render();}});
  new ResizeObserver(()=>render()).observe(root);
  render();
  // A read only inspection hook supports deterministic browser verification.
  root.powerDemo = { getSnapshot:() => simulation.snapshot(), getState:() => ({selectedBus,inspectedSource,playing,intervention:$('intervention').value,fitSteps,journal:[...journal],lastPulse:lastPulse ? {...lastPulse} : null,topology:topology.export(),historyIndex}) };
})();
