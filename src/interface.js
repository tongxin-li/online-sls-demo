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
  let simulation = new PowerDemo.Simulation({preset:'mixed'});
  const series = [
    { key:'online', label:'Learned sparse', color:'var(--viz-series-1)', dash:null },
    { key:'scalar', label:'Fixed sparse', color:'var(--viz-series-4)', dash:'8 3' },
    { key:'static', label:'Dense prediction', color:'var(--viz-series-2)', dash:'5 3 1 3' },
    { key:'causal', label:'Feedback only', color:'var(--viz-series-3)', dash:'1 4' }
  ];
  const visible = new Set(series.map(s => s.key));
  const DISCOVERY_SAMPLES=180;
  const automaticComparison=()=>$('auto-compare').checked;
  // Discovery executes one dense predictive policy plus the feedback baseline.
  // Sparse labels become meaningful only after their constrained designs exist.
  function activeSeries() { return snapshot.phase==='deployment' ? series : series.filter(s=>s.key==='static'||s.key==='causal'); }
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
  const topology = new TopologyTimeline(snapshot);
  let historyIndex = null;
  let visualTopologyEvent = null;
  let journal = [];
  let fitSteps = 0;
  let restored = false;
  let pin = null;
  let matrixReference = null;
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
    return {event,links,reference:new Set((event?.before || links).map(recommendationKey))};
  }
  function reviewTopology(index) {
    historyIndex=index;visualTopologyEvent=index ? topology.events[index-1] : null;
    if(index!==null) $('matrix-view').value='links';
    drawNetwork();drawMatrix();highlightTopology();
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
    $('topology-gain').textContent='Weights changed '+d3.format('.3~g')(gain)+'%';
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
    $('topology-note').textContent=changing ? 'Weight changes do not always change connectivity.'
      : event ? (historyIndex===null?(snapshot.phase==='deployment'?'Last discovery':'Latest'):'Viewing')+' update at '+event.t+' s · Added '+label(event.added)+' · Removed '+label(event.removed)
      : historyIndex===0 ? 'Initial prediction links · Move the slider to review each update.'
      : snapshot.phase==='deployment' ? 'No link changes during discovery. Deployed links stay fixed.'
      : snapshot.t<6 ? 'Learning starts after five samples. Each link update is kept here.'
      : 'No links have changed yet. Learning weights may still change.';
    $('topology-note').title=snapshot.phase==='deployment' ? 'Discovery history. The deployed controller stays fixed.' : 'History displays observed connectivity only. Reviewing an update does not change the controller.';
  }
  function selectBus(bus) {
    selectedBus = bus;
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
      modelContent: { scenario:'24 bus LinDistFlow voltage regulation', variant:'Completed response learning and separate sparse deployment', phase:snapshot.phase, step:snapshot.t, mode:snapshot.mode, cumulativeCost:snapshot.cumulative, selectedBus, faultyBuses:snapshot.faults, fitError:snapshot.fitError },
      privateContent: { version:9, attackMode:$('attack-mode').value, phase:snapshot.phase, initialOptions:snapshot.initialOptions, discoveryRecord:snapshot.discoveryRecord, preset:snapshot.preset, matrixReference:matrixReference?{t:matrixReference.t,recommendations:matrixReference.recommendations}:null, automaticComparison:automaticComparison(), view:$('view').value, costMetric:$('cost-metric').value, matrixView:$('matrix-view').value, pulseStrength:$('strength').value, t:snapshot.t, events, selectedBus, speed:$('speed').value, allLinks:$('all-links').checked }
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
    if(restored||!data||![7,8,9].includes(data.version)) return;
    restored=true;
    $('auto-compare').checked=data.automaticComparison!==false;
    selectedBus=Math.max(1,Math.min(24,Math.floor(Number(data.selectedBus)||7)));
    $('bus').value=String(selectedBus);
    $('speed').value=data.version===9 && ['2','4','8','16','32'].includes(data.speed)?data.speed:'16';
    $('attack-mode').value=data.version===9 && data.attackMode==='pulse'?'pulse':'continuous';
    if(['50','100','150'].includes(data.pulseStrength)) $('strength').value=data.pulseStrength;
    $('all-links').checked=!!data.allLinks;
    $('matrix-view').value=data.version>=8 && data.matrixView==='change'?'change':'links';
    const preset=['reliable','uniform','mixed'].includes(data.preset)?data.preset:'mixed';
    if(data.phase==='deployment' && data.discoveryRecord) {
      simulation=new PowerDemo.Simulation(data.discoveryRecord.options || {preset});
      topology.reset(simulation.snapshot());
      replayRecord(data.discoveryRecord);
      simulation.deployTopology();
      topology.observe(simulation.snapshot());
    } else {
      simulation=new PowerDemo.Simulation(data.initialOptions || {preset});
      topology.reset(simulation.snapshot());
    }
    const initialLinks=simulation.snapshot().recommendations.map(e=>({...e}));
    replayRecord({t:data.t,events:data.events});
    snapshot=simulation.snapshot();
    $('preset').value=snapshot.preset;
    $('view').value=data.view==='learning'?'learning':'cost';
    $('cost-metric').value=data.costMetric==='gap' && snapshot.phase==='deployment'?'gap':'total';
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
    announce('Learning complete · Fresh comparison trial · Costs start at zero');
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
    if (!isFit() && lastPulse && snapshot.t>lastPulse.t) {
      const active=pulseStatus(lastPulse.bus).active;
      announce((active?'Pulse applied':'Pulse ended')+' · Bus '+lastPulse.bus+' · t = '+snapshot.t+' s');
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
    historyIndex=null;visualTopologyEvent=null;
    captureMatrixReference(); $('cost-metric').value='total';
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
      simulation=new PowerDemo.Simulation({preset:$('preset').value});resetExperiment();
      $('matrix-view').value='links';announce('New discovery · Press Run or attack a bus');render();save();return;
    }
    if(!snapshot.canDeploy) return;
    stop();
    enterComparison();
    playing=true;nextTickAt=0;schedule();
    actionNote(attackInstruction());
    render(); save();
  });
  $('preset').addEventListener('change', () => {
    stop(); simulation=new PowerDemo.Simulation({preset:$('preset').value});
    resetExperiment(); $('view').value='cost';
    announce(snapshot.presetLabel+' · Reset to t 0'); render(); save();
  });
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
      announce(startingPhase!==snapshot.phase?'Learning complete · Fresh comparison trial · t = '+snapshot.t+' s':'180 samples added · t = '+snapshot.t+' s');
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
  $('cost-metric').addEventListener('change',()=>{drawCost();save();});
  $('strength').addEventListener('change', () => { drawNetwork(); save(); });
  $('attack-mode').addEventListener('change',()=>{releaseAttack();renderControls();drawNetwork();save();});
  if ($('matrix-view')) $('matrix-view').addEventListener('change',()=>{historyIndex=null;drawNetwork();drawMatrix();save();});
  $('topology-history').addEventListener('input',()=>reviewTopology(Number($('topology-history').value)));
  $('history-live').addEventListener('click',()=>reviewTopology(null));
  if ($('view')) $('view').addEventListener('change', () => { renderLearningView(); drawConvergence(); drawCost(); save(); });
  $('bus').addEventListener('change', () => selectBus(Number($('bus').value)));
  $('all-links').addEventListener('change', () => { drawNetwork(); save(); });
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
  function fault() {
    if (!canAttack(selectedBus)) return;
    resumePlant();
    simulation.toggleFault(selectedBus); journal.push({t:snapshot.t,type:'fault',bus:selectedBus});
    snapshot=simulation.snapshot();
    const message='Bus '+selectedBus+' forecast '+(snapshot.faults.includes(selectedBus)?'corrupted':'repaired');
    announce(message); actionNote(message);
    render(); save();
  }
  function continuousMode() { return $('attack-mode').value==='continuous'; }
  function attackInstruction() { return continuousMode()?'Click a bus to start · Click again to stop':'Click for a pulse · Hold to repeat'; }
  function finishAttack() { releaseAttack();renderControls();drawNetwork();save(); }
  function activateAttack(bus,owner) {
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
      if(event.detail===0) {
        if(continuousMode()) activateAttack(getBus(),element);
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
  document.addEventListener('keyup',event=>{if(event.key.toLowerCase()==='d' && !heldAttack?.latched && !heldAttack?.owner) finishAttack();});
  window.addEventListener('blur',releaseAttack);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden) { stop(); renderControls(); save(); }
  });
  $('fault').addEventListener('click', fault);
  $('freeze').addEventListener('click', () => {
    stop();
    if (isFit()) {
      resumePlant();
      announce(snapshot.mode === 'completed' ? 'Episode complete' : 'Live data resumed · Press Run to continue');
    } else {
      if (!simulation.freeze()) return;
      snapshot = simulation.snapshot(); fitSteps = 0;
      if ($('view')) $('view').value='learning';
      playing = true; schedule(); announce('Data frozen · Voltage and cost are held');
    }
    render(); save();
  });
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === 'd') { e.preventDefault(); beginAttack(); }
    else if (key === 'e') { e.preventDefault(); fault(); }
    else if (key === ' ' && !e.target.closest('button, [role=button]')) { e.preventDefault(); toggleRun(); }
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
    const preparing=snapshot.phase==='discovery' && automaticComparison();
    const showCost=!preparing && $('view')?.value==='cost';
    $('view').hidden=preparing;
    if ($('cost-content')) $('cost-content').hidden=!showCost;
    if ($('learning-content')) $('learning-content').hidden=showCost;
    if ($('cost')) { $('cost').hidden=!showCost; $('cost').style.display=showCost?'':'none'; }
    if ($('convergence')) { $('convergence').hidden=showCost; $('convergence').style.display=showCost?'none':''; }
    if ($('learning-flow')) $('learning-flow').hidden=showCost;
    if ($('learning-title')) $('learning-title').textContent=preparing ? 'Learning progress' : showCost ? (snapshot.phase==='deployment'?'Controller comparison':'Learning run') : isFit() ? 'Fixed data diagnostic' : snapshot.phase==='deployment' ? 'Deployed controller' : 'Completed response learning';
    if ($('learning-kind')) $('learning-kind').textContent=showCost ? 'Accumulated quadratic cost' : isFit() ? 'Relative error (%)' : snapshot.phase==='deployment' ? 'Fixed prediction support' : 'Completed responses · Relative error (%)';
  }
  function renderControls() {
    const frozen=isFit();
    const deployed=snapshot.phase==='deployment';
    const completedRows=snapshot.learning?.completedRows || 0;
    const preparing=!deployed && automaticComparison();
    if($('phase')) { $('phase').textContent=deployed?'Comparison trial':preparing?'Learning '+Math.min(DISCOVERY_SAMPLES,snapshot.t)+' / '+DISCOVERY_SAMPLES+' s':snapshot.canDeploy?'Ready to compare':'Learning '+Math.min(30,completedRows)+'/30'; $('phase').dataset.phase=deployed?'deployment':'discovery'; }
    if($('deploy')) { $('deploy').hidden=preparing; $('deploy').disabled=comparing || (!deployed && !snapshot.canDeploy); $('deploy').textContent=deployed?'Learn again':'Compare controllers'; $('deploy').title=deployed?'Start a new discovery trial with these forecast settings':snapshot.canDeploy?'Start four controllers on the same fresh disturbance sequence':(snapshot.learning?.completedRows || 0)+' of 30 completed responses'; }
    if($('phase-note')) $('phase-note').textContent='Colors and line styles identify controllers · Hover for exact values';
    $('cost-metric').hidden=!deployed;
    if(!deployed) $('cost-metric').value='total';
    if(!plottedSeries().length) activeSeries().forEach(item=>visible.add(item.key));
    root.querySelectorAll('[data-series]').forEach(button=>{
      const item=series.find(item=>item.key===button.dataset.series);
      button.hidden=!activeSeries().includes(item);
      button.setAttribute('aria-pressed',String(visible.has(item.key)));
    });
    if($('matrix-title')) $('matrix-title').textContent=deployed?'Deployed prediction links':'Learning prediction links';
    $('clock').textContent=(deployed?'Comparison t = ':'Learning t = ')+snapshot.t+' s';
    $('learning').textContent=frozen?'Plant held · '+snapshot.mode:deployed?'Prediction links fixed':completedRows+' completed responses';
    $('run').textContent=playing?'Pause':frozen && snapshot.mode!=='converged'?'Fit':'Run';
    $('run').disabled=comparing;
    $('compare').disabled=comparing;
    $('compare').textContent=comparing ? 'Running…' : 'Advance 180';
    $('preset').disabled=comparing;
    $('restart').disabled=comparing;
    $('run').setAttribute('aria-label',playing?'Pause simulation':frozen?'Run frozen fit':'Run simulation');
    $('run').setAttribute('aria-pressed',String(playing));
    if ($('pulse-label')) $('pulse-label').textContent=heldAttack?.latched?'Stop attack':selectedBus===1?'Fixed substation':'Attack bus '+selectedBus;
    $('pulse').setAttribute('aria-pressed',String(!!heldAttack));
    $('pulse').title=heldAttack?.latched?'Stop the continuous attack at bus '+heldAttack.bus:attackInstruction();
    $('attack-hint').textContent=heldAttack?.latched?'Continuous · Bus '+heldAttack.bus:continuousMode()?'Click to start or stop':'Click or hold';
    $('step').textContent=frozen?'100 fit steps':'Step';
    $('step').disabled=comparing || snapshot.mode==='converged';
    $('freeze').textContent=frozen?'Return to simulation':'Inspect fixed data';
    $('freeze').disabled=comparing || deployed || !snapshot.canFreeze;
    $('freeze').hidden=preparing && !frozen;
    $('pulse').disabled=!heldAttack && !canAttack(selectedBus); $('strength').disabled=false; $('fault').disabled=!canAttack(selectedBus);
    $('fault').textContent=(snapshot.faults.includes(selectedBus)?'Repair':'Corrupt')+' forecast';
    $('fit-title').textContent=frozen?'Fixed data diagnostic':deployed?'Deployed prediction support':'Completed response learning';
    $('fit-detail').textContent=frozen?'Relative error '+d3.format('.2~g')(100*(snapshot.fitError || 0))+'%':deployed?'Prediction links stay fixed in this trial':completedRows+' completed responses · '+(snapshot.learning?.delay || 0)+' second completion delay';
    $('mode-note').textContent=frozen?'Trial and controller paused. Learned links stay unchanged.':deployed?'Change the forecast preset to begin a new discovery trial':preparing?(snapshot.t>=DISCOVERY_SAMPLES?'Comparison starts when playback resumes. Its costs start at zero.':'Comparison starts automatically after '+DISCOVERY_SAMPLES+' s of learning. Its costs start at zero.'):'The target changes as responses complete. Freeze to inspect convergence.';
    const i=selectedBus-1, sample=snapshot.lastSample;
    const write=(id,value)=>{if($(id))$(id).textContent=value;};
    write('flow-predict',selectedBus===1 ? 'Fixed slack' : sample ? 'ŵ '+d3.format('+.2~g')(sample.forecast[i])+' pu' : 'Awaiting forecast');
    write('flow-control',hasInverter(selectedBus) ? 'Q* '+d3.format('+.0f')(reactiveCommand(selectedBus))+' kvar' : 'No inverter');
    write('flow-observe',selectedBus===1 ? busVoltage(1).toFixed(3)+' pu' : sample ? 'w '+d3.format('+.2~g')(sample.disturbance[i])+' pu' : 'Awaiting response');
    write('flow-update',frozen ? snapshot.fitIteration+' iterations' : deployed ? 'Support fixed' : completedRows+' completed rows');
    renderLearningView();
  }
  function drawNetwork() {
    const el = $('network');
    const width = Math.max(240, el.getBoundingClientRect().width);
    const height = 220;
    const svg = d3.select(el).attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height)
      .attr('role','group').attr('aria-label','Radial power feeder. '+attackInstruction()+'. Disturbances change load, solar generation or battery charging.');
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
    const frame=topologyFrame(),recommendations=frame.links || [];
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
      .attr('stroke-dasharray',e => e.change === 'removed' ? '3 4' : null)
      .attr('marker-end',e => 'url(#pr-arrow-'+e.change+')');
    animate(links).attr('d',arc)
      .attr('stroke',e => color(e.change === 'retained' ? 'var(--viz-series-1)' : matrixColors[e.change]))
      .attr('stroke-width',e => e.change !== 'retained' ? 2.5 : Number.isFinite(e.weight)?strength(e.weight):1.5)
      .attr('opacity',e => e.change !== 'retained' ? .95 : e.to === selectedBus ? .7 : .12);
    const nodes = svg.select('.nodes').selectAll('g.bus-node').data(d3.range(1,25),bus => bus).join(enter => {
      const g=enter.append('g').attr('class','bus-node').attr('role','button').attr('tabindex',0)
        .style('cursor','pointer').style('user-select','none');
      g.append('text').attr('class','bus-number').attr('pointer-events','none');
      g.append('text').attr('class','fault-mark').attr('pointer-events','none');
      if (window.PowerEquipment) g.each(function(bus){PowerEquipment.render(d3.select(this),busRole(bus));});
      g.append('title');
      g.each(function(bus){bindAttackTarget(this,()=>bus);});
      return g;
    }).attr('transform',bus => 'translate('+point(bus).join(',')+')')
      .attr('data-bus',bus => bus).attr('data-role',bus => busRole(bus))
      .attr('aria-label',bus => bus===1 ? 'Fixed substation at bus 1' : (heldAttack?.latched && heldAttack.bus===bus?'Stop attack at bus ':continuousMode()?'Toggle continuous attack at bus ':'Hold to attack bus ')+bus)
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
        pulseId:status.id,phase:snapshot.t,attackPowerKw:appliedPulse(bus)?.applied,attackHeld:heldAttack?.bus===bus,attackLatched:heldAttack?.bus===bus && heldAttack.latched
      });
      const badge=d3.select(this).select('.pe-attack-badge');
      const badgeWidth=Number(badge.select('rect').attr('width')) || 60;
      badge.attr('transform','translate('+(point(bus)[0]>width-95 ? -badgeWidth-10 : 13)+' -16)');
    });
    nodes.select('.bus-number').attr('text-anchor','middle').attr('x',0).attr('y',27)
      .style('fill','var(--muted-foreground)').style('font-size','9px').text(bus=>bus);
    nodes.select('.fault-mark').attr('x',17).attr('y',-12).text(bus=>snapshot.faults.includes(bus)?'×':'');
    nodes.select('title').text(bus=>busRole(bus)+' · Bus '+bus+' · '+busVoltage(bus).toFixed(4)+' pu · '+powerDescription(bus)+(hasInverter(bus)?' · Q '+reactivePower(bus).toFixed(0)+' kvar':'')+'. '+(bus===1?'Fixed voltage substation.':disturbanceName(bus)+' '+pulseMagnitude($('strength').value)+' requested. '+attackInstruction()+'.'));
    showBusDetail(selectedBus);
    const voltages=d3.range(1,25).map(bus=>busVoltage(bus));
    const low=Math.min(...voltages), high=Math.max(...voltages);
    const inRange=low>=.95 && high<=1.05;
    const nearNominal=voltages.every((voltage,index)=>Math.abs(voltage-referenceVoltage(index+1))<.001);
    if(heldAttack) actionNote((heldAttack.latched?'Continuous · ':'Holding · ')+appliedPulseLabel(heldAttack.bus));
    else if (lastPulse && snapshot.t>lastPulse.t) actionNote(pulseStatus(lastPulse.bus).active ? appliedPulseLabel(lastPulse.bus) : nearNominal ? attackInstruction() : 'Restoring the nominal profile');
    else actionNote(attackInstruction());
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
      +(status.queued?' · '+status.queued+' queued':hovered && canAttack(bus)?(continuousMode()?' · Click to toggle attack':' · Hold to keep attacking'):'');
  }

  function drawMatrix() {
    const el=$('matrix'); if(!el) return;
    if(!matrixReference) captureMatrixReference();
    const diagnostics=snapshot.predictionDiagnostics;
    const receivers=PowerDemo.constants.inverterBuses, sources=d3.range(2,25);
    const changing=$('matrix-view').value==='change', deployed=snapshot.phase==='deployment';
    const width=Math.max(240,el.getBoundingClientRect().width),height=188;
    const left=40,top=35,cellWidth=(width-left-8)/sources.length,cellHeight=17;
    const frame=topologyFrame(),recommendations=frame.links || [],current=new Set(recommendations.map(recommendationKey));
    $('matrix-title').textContent=historyIndex===null ? (deployed?'Deployed prediction links':'Learning prediction links') : 'Prediction links at '+(frame.event?.t ?? topology.initialT)+' s';
    const added=[...current].filter(key=>!frame.reference.has(key)),removed=[...frame.reference].filter(key=>!current.has(key));
    const gainPercent=100*(diagnostics?.relativeGainChange || 0);
    const replaced=diagnostics?.changedLinkCount || 0;
    const matrixReceiver=hasInverter(selectedBus)?selectedBus:null;
    const selectedSources=recommendations.filter(e=>e.to===selectedBus).map(e=>e.from).sort((a,b)=>a-b);
    $('matrix-detail').textContent=changing ? 'Coefficient change '+d3.format('.3~g')(gainPercent)+'%' : matrixReceiver ? 'Inverter '+selectedBus+' ← '+selectedSources.join(', ') : 'Eight inverter receivers';
    $('matrix-changes').textContent=(deployed?(historyIndex===null?'Fixed deployment · ':'Discovery history · '):'')+added.length+' added · '+removed.length+' removed';
    $('matrix-changes').title='Changes in the displayed topology update';
    drawTopologyHistory();
    const delta=diagnostics?.receiverNormalizedChange || receivers.map(()=>sources.map(()=>0));
    const maximum=Math.max(.0001,...delta.flat().map(v=>Math.abs(v)));
    const shade=d3.scaleLinear().domain([-maximum,0,maximum]).range(['#c56c1b','#f5f5f7','#0071e3']).clamp(true);
    const changeLabel=d3.format('.2~g')(100*maximum)+'%';
    const key=$('matrix-key');key.replaceChildren();
    for(const [className,label] of changing ? [['decreased','−'+changeLabel],['change-scale','Change in row energy'],['increased','+'+changeLabel],['outline','Selected']]
      : [['connected','Selected'],['added','Added'],['removed','Removed']]) {
      const span=document.createElement('span'),icon=document.createElement('i');icon.className='pr-cell-key '+className;span.append(icon,document.createTextNode(label));key.append(span);
    }
    const svg=d3.select(el).attr('viewBox','0 0 '+width+' '+height).attr('height',height)
      .attr('role','group').attr('aria-label',changing?'Learning changes in predictive response weights':'Selected prediction sources for eight inverter receivers')
      .attr('data-gain-change',gainPercent).attr('data-source-changes',added.length).attr('data-offline-source-changes',replaced)
      .attr('data-history-index',historyIndex===null?'latest':historyIndex).attr('data-topology-updates',topology.cumulative.transitions);
    if(svg.select('.matrix-cells').empty()) {
      svg.append('title');svg.append('text').attr('class','matrix-source-title matrix-axis');
      svg.append('text').attr('class','matrix-receiver-title matrix-axis');
      svg.append('g').attr('class','matrix-columns');svg.append('g').attr('class','matrix-cells');
      svg.append('rect').attr('class','matrix-selected-row').attr('fill','none').attr('pointer-events','none');
      svg.append('g').attr('class','matrix-rows');
    }
    svg.select('title').text(changing?'Signed change in learned gain energy divided by each receiver’s offline energy. Outline shows selected sources.':'Rows are inverter receivers. Columns are prediction sources.');
    svg.select('.matrix-source-title').attr('x',left+(width-left)/2).attr('y',10).attr('text-anchor','middle').text('Source bus');
    svg.select('.matrix-receiver-title').attr('transform','translate(9,'+(top+cellHeight*4)+') rotate(-90)').attr('text-anchor','middle').text('Inverter');
    svg.select('.matrix-columns').selectAll('text').data(sources).join('text').attr('x',(_,i)=>left+(i+.5)*cellWidth).attr('y',top-8).attr('text-anchor','middle').text(bus=>bus);
    const cells=receivers.flatMap((receiver,i)=>sources.map((source,j)=>{
      const id=receiver+','+source,local=receiver===source,connected=local||current.has(id);
      const change=local?'local':current.has(id)?(frame.reference.has(id)?'retained':'added'):frame.reference.has(id)?'removed':'inactive';
      return {receiver,source,i,j,local,connected,change,delta:delta[i]?.[j] || 0};
    }));
    const marks=svg.select('.matrix-cells').selectAll('rect').data(cells,d=>d.receiver+','+d.source).join(enter=>{const r=enter.append('rect').attr('class','matrix-cell');r.append('title');return r;})
      .attr('x',d=>left+d.j*cellWidth+1).attr('y',d=>top+d.i*cellHeight+1).attr('width',Math.max(2,cellWidth-2)).attr('height',cellHeight-2).attr('rx',2)
      .attr('data-receiver',d=>d.receiver).attr('data-source',d=>d.source).attr('data-connected',d=>String(d.connected)).attr('data-change',d=>d.change).attr('data-weight-change',d=>d.delta)
      .style('cursor','pointer').on('click',(_event,d)=>selectBus(d.receiver));
    animate(marks).attr('fill',d=>changing?shade(d.delta):color(d.change==='removed'?'var(--background)':d.change==='retained'?matrixColors.connected:matrixColors[d.change] || matrixColors.inactive))
      .attr('stroke',d=>changing?(d.change==='added'?color(matrixColors.added):d.change==='removed'?color(matrixColors.removed):d.connected?'#404047':'transparent'):d.change==='removed'?color(matrixColors.removed):d.change==='added'?color(matrixColors.added):'transparent')
      .attr('stroke-width',d=>changing&&d.connected?1.2:d.change==='removed'?1.4:0).attr('stroke-dasharray',d=>changing&&d.change==='removed'?'2 2':null);
    marks.select('title').text(d=>'Bus '+d.source+' → inverter '+d.receiver+' · '+(d.connected?'Selected':'Not selected')
      +(changing?' · Energy change '+d3.format('+.3~g')(100*d.delta)+'% of offline receiver energy':'')
      +(d.local?' · Local source':''));
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
    animate(lines).attr('d',item => d3.line().defined(d => Number.isFinite(d[item.key])).x(d=>chart.x(d.x)).y(d=>chart.y(d[item.key]))(observations));
    chart.marks.selectAll('path.sample-symbol').remove();
    const latest = observations[observations.length-1];
    const dots = chart.marks.selectAll('circle.latest-value').data(showCurrent && latest ? paintOrder : [],item => item.key).join('circle')
      .attr('class','latest-value').attr('r',item => item.key === 'online' ? 2.7 : 2)
      .attr('fill',item => item.color).attr('stroke','var(--background)').attr('stroke-width',.8).order();
    if(latest) animate(dots).attr('cx',chart.x(latest.x)).attr('cy',item => chart.y(latest[item.key]));
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
    const events=journal.filter(item=>['pulse','fault'].includes(item.type) && item.t<snapshot.t && item.t+1>=domain[0] && item.t+1<=domain[1]);
    const groups=[];
    for(const item of events) {
      const x=chart.x(item.t+1), previous=groups.at(-1);
      if(previous && x-previous.right<78) {previous.items.push(item);previous.right=x;}
      else groups.push({left:x,right:x,items:[item]});
    }
    groups.forEach(group=>{
      const first=group.items[0]; group.key=first.t+'_'+first.type+'_'+first.bus;
      group.attacks=group.items.filter(item=>item.type==='pulse').length;
      group.count=group.attacks || group.items.length;
      group.label=group.attacks?(group.count>1?'Attacks':'Attack'):'Forecast';
      group.width=24+group.label.length*6;
      group.x=Math.max(chart.frame.x+group.width/2,Math.min(chart.frame.x+chart.frame.w-group.width/2,(group.left+group.right)/2));
    });
    const markers=chart.marks.selectAll('g.intervention-markers').data([null]).join('g').attr('class','intervention-markers');
    markers.selectAll('rect').data(groups,group=>group.key).join('rect')
      .attr('x',g=>g.left-2).attr('width',g=>Math.max(4,g.right-g.left+4))
      .attr('y',chart.frame.y).attr('height',chart.frame.h).attr('fill','var(--attack)').attr('opacity',.085);
    markers.selectAll('line').data(groups,group=>group.key).join('line')
      .interrupt().interrupt('update').attr('x1',g=>g.left).attr('x2',g=>g.left)
      .attr('y1',chart.frame.y).attr('y2',chart.frame.y+chart.frame.h)
      .attr('stroke','var(--attack)').attr('stroke-opacity',.65).attr('stroke-width',1.3).attr('stroke-dasharray','3 3');
    const labels=chart.svg.select('.intervention-labels').selectAll('g').data(groups,g=>g.key).join(enter=>{
      const badge=enter.append('g').attr('class','intervention-badge').attr('role','img');
      badge.append('title');badge.append('rect');badge.append('path');badge.append('text');return badge;
    }).attr('data-event-count',g=>g.items.length).attr('data-disturbance-count',g=>g.attacks)
      .attr('data-event-steps',g=>g.items.map(item=>item.t+1).join(','))
      .attr('aria-label',g=>g.attacks+' attacks and '+(g.items.length-g.attacks)+' forecast changes');
    // Position badges directly. They must never fly in from a stale chart scale.
    labels.interrupt().interrupt('update').attr('transform',g=>'translate('+g.x+','+(chart.frame.y-14)+')');
    labels.select('rect').attr('x',g=>-g.width/2).attr('y',-10).attr('width',g=>g.width).attr('height',20).attr('rx',6)
      .attr('fill',g=>g.attacks?'var(--attack)':'#687580');
    labels.select('path').attr('transform',g=>'translate('+(-g.width/2+4)+',-8) scale(.7)')
      .attr('d',g=>g.attacks?'M14 1 3 13h7l-1 10L21 9h-8z':'M10 2h4v12h-4z M10 17h4v4h-4z').attr('fill','#fff');
    labels.select('text').attr('x',8).attr('y',.5).attr('text-anchor','middle').attr('dominant-baseline','middle')
      .style('font-size','11px').style('font-weight','650').style('fill','#fff').text(g=>g.label);
    labels.select('title').text(g=>{
      const details=g.items.slice(-8).map(item=>item.type==='pulse'
        ? pulseMagnitude(item.strength || 100)+' at bus '+item.bus+' · Voltage and cost at t '+(item.t+1)+' s'
        : 'Forecast changed at bus '+item.bus+' · t '+(item.t+1)+' s');
      return g.attacks+' individual pulses in this shaded interval'+(g.items.length>8?' · Latest 8 events shown':'')+'\n'+details.join('\n');
    });
  }
  function drawCost() {
    const active=activeSeries(),items=plottedSeries();
    const gap=snapshot.phase==='deployment' && $('cost-metric').value==='gap';
    const observations=[{x:0,...Object.fromEntries(series.map(item=>[item.key,0]))},...snapshot.history.map(d=>({x:d.t,...Object.fromEntries(series.map(item=>[item.key,d[item.key]-(gap?d.scalar:0)]))}))];
    if ($('cost').hidden) return;
    $('cost').setAttribute('aria-label',gap?'Cumulative cost difference from fixed sparse. Zero is the fixed sparse baseline. Lower is better.':'Cumulative cost of '+active.length+' active controllers');
    const chart=chartBase($('cost'),observations,items.map(s=>s.key),gap?'Cost difference from fixed sparse':'Cumulative cost','Time (s)',140);
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
    const sparseComparison=comparativeCost(c.online,c.scalar);
    $('comparison-summary').textContent=snapshot.phase!=='deployment'
      ? 'Learning uses dense prediction. Sparse controllers are tested after you select Compare controllers.'
      : sameSparseSupport() ? 'Learned and fixed sparse selected identical links, so their curves coincide.'
      : c.scalar>1e-12 ? sparseComparison==='Equal' ? 'Different links · Equal cost so far' : sparseComparison==='Nearly equal' ? 'Different links · Nearly equal cost so far' : 'Learned cost is '+sparseComparison+' than fixed sparse'
      : 'Four controllers · Identical disturbances';
    $('cost-note').textContent=gap?'Gap = cumulative cost − fixed sparse cost · Below zero is better · Table shows total costs'
      : snapshot.phase==='deployment'?'Fresh comparison trial · Learning costs excluded · Identical disturbances':'Two active controllers · Learning continues as the trial runs';
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
    if ($('pulse-summary')) $('pulse-summary').textContent=summary;
  }
  function drawVoltage() {
    const el=$('voltage'); if(!el)return;
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
    if($('voltage-detail'))$('voltage-detail').textContent='Bus '+selectedBus+' voltage';
    if($('voltage-reference'))$('voltage-reference').textContent='Nominal '+reference.toFixed(4)+' pu';
    if($('state-value'))$('state-value').textContent=busVoltage(selectedBus).toFixed(4)+' pu';
  }
  function drawConvergence() {
    if (!$('convergence') || $('convergence').hidden) return;
    const frozen=isFit(), deployed=snapshot.phase==='deployment';
    const el=$('convergence'), svg=d3.select(el);
    const completedRows=snapshot.learning?.completedRows || 0;
    if(!frozen && (deployed || !snapshot.learning?.updateCount)) {
      const width=Math.max(240,el.getBoundingClientRect().width), height=140;
      const heading=deployed?'Prediction links are deployed':'Waiting for completed responses';
      const detail=deployed?'Support stays fixed throughout this trial':automaticComparison()?'Comparison will start automatically':'Run to collect completed responses';
      svg.attr('viewBox','0 0 '+width+' '+height).attr('height',height)
        .attr('aria-label',heading+'. '+detail+'.');
      svg.selectAll('*').remove();
      const wait=svg.append('g').attr('class','learning-wait');
      wait.append('text').attr('x',width/2).attr('y',48).attr('text-anchor','middle')
        .attr('fill','var(--foreground)').attr('font-size',13).text(heading);
      wait.append('text').attr('x',width/2).attr('y',70).attr('text-anchor','middle')
        .attr('fill','var(--muted-foreground)').attr('font-size',11).text(detail);
      if(!deployed) {
        wait.append('line').attr('x1',width/2-64).attr('x2',width/2+64).attr('y1',88).attr('y2',88)
          .attr('stroke','var(--border)').attr('stroke-width',3).attr('stroke-linecap','round');
        wait.append('line').attr('x1',width/2-64).attr('x2',width/2-64+128*Math.min(1,completedRows/30)).attr('y1',88).attr('y2',88)
          .attr('stroke','var(--primary)').attr('stroke-width',3).attr('stroke-linecap','round');
      }
      return;
    }
    if(!svg.select('.learning-wait').empty()) svg.selectAll('*').remove();
    const observations=frozen
      ? snapshot.fitHistory.filter(d=>Number.isFinite(d.error)).map(d=>({x:d.iteration,value:100*d.error}))
      : snapshot.history.filter(d=>Number.isFinite(d.prefixError)).map(d=>({x:d.t,value:100*d.prefixError}));
    if(!observations.length) return;
    $('convergence').setAttribute('aria-label',frozen?'Fixed data diagnostic. Relative error to the exact completed response optimizer on frozen data':'Relative error to the changing completed response optimizer');
    const chart=chartBase($('convergence'),observations,['value'],'Relative error (%)',frozen?'Gradient iteration':'Time (s)',140);
    if (!frozen) drawInterventions(chart);
    else {
      chart.marks.select('.intervention-markers').selectAll('*').remove();
      chart.svg.select('.intervention-labels').selectAll('*').remove();
    }
    drawSeries(chart,observations,[{key:'value',color:'var(--viz-series-1)'}]);
    hover(chart,observations,[{key:'value',label:'Relative error (%)',color:'var(--viz-series-1)'}],frozen?'Iteration':'Time (s)');
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
  root.powerDemo = { getSnapshot:() => simulation.snapshot(), getState:() => ({selectedBus,playing,fitSteps,journal:[...journal],lastPulse:lastPulse ? {...lastPulse} : null,topology:topology.export(),historyIndex}) };
})();
