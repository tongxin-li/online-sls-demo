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
  const simulation = new PowerDemo.Simulation();
  // Begin with a short deterministic history so every plot is immediately useful.
  for (let i=0;i<60;i++) simulation.step();
  const series = [
    { key:'online', label:'Adaptive', color:'var(--viz-series-1)', dash:null },
    { key:'static', label:'Fixed prediction', color:'var(--viz-series-2)', dash:'7 4' },
    { key:'causal', label:'Feedback only', color:'var(--viz-series-3)', dash:'2 4' }
  ];
  const visible = new Set(series.map(s => s.key));
  let selectedBus = 6;
  let playing = false;
  let timer = null;
  let snapshot = simulation.snapshot();
  let journal = [];
  let fitSteps = 0;
  let restored = false;
  let pin = null;
  let matrixReference = null;
  let lastPulse = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = () => reducedMotion ? 0 : Math.min(440, 700 / Number($('speed').value || 1));
  function animate(selection, name = 'update') {
    selection.interrupt(name);
    return reducedMotion ? selection : selection.transition(name).duration(duration()).ease(d3.easeCubicOut);
  }
  function color(value) {
    const variable = /^var\((--[^,)]+)/.exec(value);
    return variable ? getComputedStyle(root).getPropertyValue(variable[1]).trim() || '#245c48' : value;
  }
  const matrixColors = { connected:'var(--primary)', added:'var(--matrix-added, #328a9c)', removed:'var(--matrix-removed, #d39955)', local:'#b8c2bc', inactive:'#eff2ef' };
  const busRole = bus => bus === 1 ? 'Substation' : [5,7,14,21].includes(bus) ? 'Solar' : [8,12,18,24].includes(bus) ? 'Battery' : 'Homes';
  const busIcons = {
    Substation:'M-6 6H6M-4 6V-6H4V6M-6-3H6M-6 0H6M-4-6L4 6M4-6L-4 6',
    Solar:'M-6-3H6L7 4H-7ZM0-3V4M-6 0H6M0 4V7M-4 7H4M-4-6L-5-8M0-6V-9M4-6L5-8',
    Battery:'M-5-5H5V6H-5ZM-2-7H2M-2-1H2M0-3V1M-2 3H2',
    Homes:'M-7 0L0-6L7 0M-5-1V6H5V-1M-1 6V2H2V6'
  };
  function pulseMagnitude(value) { return Number(value).toFixed(3); }
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
  function selectBus(bus) {
    selectedBus = bus;
    $('bus').value = String(bus);
    render(); save();
  }
  function continueAfterAction() {
    if (!playing && snapshot.mode === 'running') { playing = true; schedule(); }
  }
  function save() {
    restored = true;
    if (!window.openai?.setWidgetState) return;
    const state = {
      modelContent: { scenario:'Synthetic 24 bus voltage regulation', variant:'Shared response calibration with fixed physical and deployed links', step:snapshot.t, mode:snapshot.mode, cumulativeCost:snapshot.cumulative, selectedBus, faultyBuses:snapshot.faults, fitError:snapshot.fitError },
      privateContent: { version:3, pulseStrength:$('strength').value, t:journal.length <= 200 ? snapshot.t : 0, journal:journal.length <= 200 ? journal : [], selectedBus, speed:$('speed').value, allLinks:$('all-links').checked, fitSteps:journal.length <= 200 ? fitSteps : 0, fitting:journal.length <= 200 && isFit() }
    };
    window.openai.setWidgetState(state).catch(() => {});
  }
  function hydrate(saved) {
    const data = saved?.privateContent;
    if (restored || !data || data.version !== 3) return;
    restored = true;
    selectedBus = Math.max(1, Math.min(24, Number(data.selectedBus) || 6));
    $('bus').value = String(selectedBus);
    $('speed').value = ['0.5','1','2','4'].includes(data.speed) ? data.speed : '1';
    if (['0.01','0.02','0.03'].includes(data.pulseStrength)) $('strength').value = data.pulseStrength;
    $('all-links').checked = !!data.allLinks;
    const items = Array.isArray(data.journal) ? data.journal.slice(0,200) : [];
    const t = Math.max(0, Math.min(480, Math.floor(Number(data.t) || 0)));
    simulation.reset();
    journal = [];
    for (let step = 0; step <= t; step++) {
      for (const item of items.filter(v => v.t === step)) {
        if (item.type === 'fit' && step >= 30) {
          simulation.freeze();
          for (let k=0; k<Math.min(3000,Math.max(0,Math.floor(item.count || 0))); k++) simulation.fitStep();
          simulation.resume(); journal.push(item); continue;
        }
        if (!Number.isInteger(item.bus) || item.bus < 1 || item.bus > 24) continue;
        if (item.type === 'pulse') {
          const strength = Number.isFinite(item.strength) && item.strength >= 0.005 && item.strength <= 0.03 ? item.strength : 0.02;
          simulation.queuePulse(item.bus, strength);
          item.strength = strength;
        }
        else if (item.type === 'fault') simulation.toggleFault(item.bus);
        else continue;
        journal.push(item);
      }
      if (step < t) simulation.step();
    }
    fitSteps = 0;
    if (data.fitting && t >= 30) {
      simulation.freeze();
      const count = Math.min(3000, Math.max(0, Number(data.fitSteps) || 0));
      for (let i = 0; i < count; i++) { simulation.fitStep(); fitSteps++; }
    }
    snapshot = simulation.snapshot();
    captureMatrixReference();
    announce('Experiment restored · Press Run');
  }
  function stop() {
    playing = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    if (!playing) return;
    timer = setTimeout(() => {
      tick();
      if (playing) schedule();
    }, 1000 / Number($('speed').value));
  }
  function tick() {
    if (isFit()) { simulation.fitStep(); fitSteps++; }
    else simulation.step();
    snapshot = simulation.snapshot();
    if (snapshot.mode === 'completed') { stop(); announce('Complete · Run to begin again'); }
    if (snapshot.mode === 'converged') { stop(); announce('Fit converged · Run to resume'); }
    render();
    if (snapshot.t % 30 === 0 || !playing) save();
  }
  function resetExperiment() {
    stop(); simulation.reset();
    for (let i = 0; i < 60; i++) simulation.step();
    snapshot = simulation.snapshot(); journal = []; fitSteps = 0; pin = null; lastPulse = null;
    captureMatrixReference();
    actionNote('Click a bus to add a load pulse.');
  }
  function toggleRun() {
    if (playing) { stop(); announce('Paused'); save(); }
    else {
      if (snapshot.mode === 'completed') resetExperiment();
      if (isFit()) {
        simulation.resume();
        journal.push({t:snapshot.t,type:'fit',count:fitSteps});
        fitSteps=0; snapshot=simulation.snapshot();
      }
      if (snapshot.mode === 'completed') resetExperiment();
      playing = true;
      announce('Regulating voltage');
      // A visible first sample confirms the click immediately.
      tick();
      if (playing) schedule();
    }
    render();
  }
  $('run').addEventListener('click', toggleRun);
  $('step').addEventListener('click', () => { stop(); tick(); save(); });
  $('restart').addEventListener('click', () => {
    resetExperiment(); announce('Ready'); render(); save();
  });
  $('speed').addEventListener('change', () => { if (playing) { clearTimeout(timer); schedule(); } save(); });
  $('strength').addEventListener('change', () => { drawNetwork(); save(); });
  if ($('adaptation')) $('adaptation').addEventListener('toggle', () => { if ($('adaptation').open) drawConvergence(); });
  $('bus').addEventListener('change', () => selectBus(Number($('bus').value)));
  $('all-links').addEventListener('change', () => { drawNetwork(); save(); });
  if ($('reference')) $('reference').addEventListener('click', () => {
    captureMatrixReference(); drawNetwork(); drawMatrix();
    announce('Connectivity reference saved at step ' + snapshot.t);
  });
  function pulseCooldown(bus) {
    const recent=journal.filter(item=>item.type==='pulse' && item.bus===bus).at(-1);
    return recent ? Math.max(0,12-(snapshot.t-recent.t)) : 0;
  }
  function canAttack(bus) { return !isFit() && snapshot.mode !== 'completed' && pulseCooldown(bus) === 0; }
  function pulse(bus = selectedBus) {
    if (!canAttack(bus)) return;
    stop();
    selectedBus = bus;
    $('bus').value = String(bus);
    captureMatrixReference();
    const strength = Number($('strength').value);
    const before = snapshot.stage.online;
    const pulseStep = snapshot.t;
    simulation.queuePulse(selectedBus, strength);
    journal.push({ t:pulseStep, type:'pulse', bus:selectedBus, strength });
    // The unexpected disturbance enters x at the first step. Its state cost is
    // charged at the next step, when calibration can also use the revealed sample.
    const steps = Math.min(2, snapshot.horizon - snapshot.t);
    for (let i = 0; i < steps; i++) simulation.step();
    snapshot = simulation.snapshot();
    lastPulse = {bus:selectedBus, strength, t:pulseStep, before, after:snapshot.stage.online, charged:steps === 2};
    continueAfterAction();
    const message = pulseMagnitude(strength) + ' pu pulse at bus ' + selectedBus;
    announce(message + (playing ? ' · Recovering' : ' · Complete'));
    actionNote('Bus ' + selectedBus + ' disturbed · Voltage recovering');
    render(); pulseRipple(selectedBus); save();
  }
  function fault() {
    if ($('fault').disabled) return;
    stop();
    captureMatrixReference();
    simulation.toggleFault(selectedBus); journal.push({ t:snapshot.t, type:'fault', bus:selectedBus });
    simulation.step();
    snapshot = simulation.snapshot();
    continueAfterAction();
    const message = 'Forecast at bus ' + selectedBus + (snapshot.faults.includes(selectedBus) ? ' corrupted' : ' repaired') + ' at step ' + snapshot.t;
    announce(message + (playing ? ' · Recovering' : ' · Complete'));
    actionNote(message + ' · Colored entries show changes in recommended sources');
    render(); save();
  }
  $('pulse').addEventListener('click', () => pulse());
  $('fault').addEventListener('click', fault);
  $('freeze').addEventListener('click', () => {
    stop();
    if (isFit()) {
      simulation.resume(); snapshot = simulation.snapshot();
      // A refit changes future actions. Preserve this in the replay journal.
      journal.push({ t:snapshot.t, type:'fit', count:fitSteps });
      fitSteps = 0;
      announce(snapshot.mode === 'completed' ? 'Episode complete' : 'Live data resumed · Press Run to continue');
    } else {
      simulation.freeze(); snapshot = simulation.snapshot(); fitSteps = 0;
      playing = true; schedule(); announce('Data frozen · Plant time and cumulative cost are held');
    }
    render(); save();
  });
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === 'd') { e.preventDefault(); pulse(); }
    else if (key === 'e') { e.preventDefault(); fault(); }
    else if (key === ' ' && !e.target.closest('button, [role=button]')) { e.preventDefault(); toggleRun(); }
  });
  root.querySelectorAll('[data-series]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.series;
      if (visible.has(key) && visible.size > 1) visible.delete(key);
      else visible.add(key);
      button.setAttribute('aria-pressed', visible.has(key) ? 'true' : 'false');
      drawCost(); drawStage();
    });
  });
  function renderControls() {
    const frozen = isFit();
    $('clock').textContent = 't = ' + snapshot.t;
    $('learning').textContent = frozen ? 'Plant held · ' + snapshot.mode : snapshot.t < 30 ? 'Learning starts after 30 samples' : 'Learning from revealed samples';
    $('run').textContent = playing ? 'Pause' : 'Run';
    $('run').disabled = false;
    $('run').setAttribute('aria-label',playing ? 'Pause simulation' : snapshot.mode === 'completed' ? 'Run a new simulation' : 'Run simulation');
    $('run').setAttribute('aria-pressed',String(playing));
    if ($('pulse-label')) $('pulse-label').textContent=pulseCooldown(selectedBus) ? 'Recovering '+pulseCooldown(selectedBus) : 'Attack bus '+selectedBus;
    $('step').textContent = frozen ? 'One fit step' : 'One step';
    $('step').disabled = ['converged','completed'].includes(snapshot.mode);
    $('freeze').textContent = frozen ? 'Return to simulation' : 'Freeze data and fit';
    $('freeze').disabled = snapshot.t < 30;
    $('pulse').disabled = !canAttack(selectedBus);
    $('strength').disabled = frozen || snapshot.mode === 'completed';
    $('fault').disabled = frozen || snapshot.mode === 'completed';
    $('fault').textContent = (snapshot.faults.includes(selectedBus) ? 'Repair' : 'Corrupt') + ' forecast';
    $('fit-title').textContent = frozen ? 'Convergence on frozen data' : 'Online adaptation';
    $('fit-detail').textContent = frozen ? 'Relative solution error ' + d3.format('.2~g')(100*(snapshot.fitError || 0)) + '%' : 'Rolling window of 60 revealed samples';
    $('mode-note').textContent = frozen ? 'A fixed ridge objective · Numerical convergence of this reduced model' : 'Freeze data to inspect convergence to a fixed ridge solution';
  }
  function pulseRipple(bus) {
    const node = d3.select($('network')).select('.nodes').selectAll('g.bus-node').filter(value => value === bus);
    if (reducedMotion || node.empty()) return;
    node.selectAll('.pulse-ripple').remove();
    node.append('circle').attr('class','pulse-ripple').attr('r',13).attr('fill','none')
      .attr('stroke',color('var(--viz-series-1)')).attr('stroke-width',2).attr('opacity',.9)
      .attr('pointer-events','none').transition('pulse').duration(1200).ease(d3.easeCubicOut)
      .attr('r',36).attr('stroke-width',.5).attr('opacity',0).remove();
  }
  function drawNetwork() {
    const el = $('network');
    const width = Math.max(240, el.getBoundingClientRect().width);
    const height = 250;
    const svg = d3.select(el).attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height)
      .attr('role','group').attr('aria-label','Power network. Activate a bus to inject the selected load pulse.');
    const point = bus => [25 + positions[bus - 1][0] * (width - 54), 26 + positions[bus - 1][1] * (height - 54)];
    if (svg.select('defs').empty()) {
      svg.append('title').text('Fixed electrical feeder with learned prediction source recommendations');
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
    const recommendations = snapshot.recommendations || [];
    const current = new Set(recommendations.map(recommendationKey));
    const reference = matrixReference?.edges || current;
    const retained = recommendations.map(edge => ({...edge, change:reference.has(recommendationKey(edge)) ? 'retained' : 'added'}));
    const removed = (matrixReference?.recommendations || []).filter(edge => !current.has(recommendationKey(edge))).map(edge => ({...edge,change:'removed'}));
    const allEdges = [...removed,...retained];
    const edges = $('all-links').checked ? allEdges : allEdges.filter(e => e.to === selectedBus);
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
      .attr('stroke-width',e => e.change === 'removed' ? 1.1 : strength(e.weight))
      .attr('opacity',e => e.to === selectedBus ? (e.change === 'removed' ? .5 : .88) : e.change === 'removed' ? .1 : .14);
    const nodes = svg.select('.nodes').selectAll('g.bus-node').data(d3.range(1,25),bus => bus).join(enter => {
      const g=enter.append('g').attr('class','bus-node').attr('role','button').attr('tabindex',0)
        .style('cursor','pointer').style('user-select','none');
      g.append('circle').attr('class','bus-hit').attr('r',20).attr('fill','transparent');
      g.append('circle').attr('class','voltage-halo').attr('r',12).attr('fill-opacity',0).attr('pointer-events','none');
      g.append('circle').attr('class','bus-dot').attr('pointer-events','none');
      g.append('path').attr('class','bus-icon').attr('fill','none').attr('stroke-width',1.2)
        .attr('stroke-linecap','round').attr('stroke-linejoin','round').attr('pointer-events','none');
      g.append('text').attr('class','bus-number').attr('pointer-events','none');
      g.append('text').attr('class','fault-mark').attr('pointer-events','none');
      const target=g.append('g').attr('class','bus-target').attr('opacity',0).attr('pointer-events','none');
      target.append('circle').attr('class','target-ring').attr('r',17).attr('fill','none')
        .attr('stroke','var(--attack, #c87938)').attr('stroke-width',1.4).attr('stroke-dasharray','4 3');
      target.append('path').attr('class','target-bolt').attr('d','M11-22L6-13H12L9-5L19-16H13L16-22Z')
        .attr('fill','var(--attack, #c87938)').attr('stroke','var(--background)').attr('stroke-width',1.2);
      g.append('title');
      return g;
    }).attr('transform',bus => 'translate('+point(bus).join(',')+')')
      .attr('data-bus',bus => bus).attr('data-role',bus => busRole(bus))
      .attr('aria-label',bus => 'Inject pulse at bus '+bus)
      .attr('aria-description',bus => busRole(bus)+', '+(1+snapshot.states.online[bus-1]).toFixed(3)+' pu'+(pulseCooldown(bus) ? ', recovering '+pulseCooldown(bus)+' steps' : ''))
      .attr('aria-disabled',bus => String(!canAttack(bus)))
      .style('cursor',bus=>canAttack(bus) ? 'pointer' : 'default')
      .on('click',(event,bus) => { event.preventDefault(); event.stopPropagation(); pulse(bus); })
      .on('pointerenter',function(_event,bus) {
        if (canAttack(bus)) d3.select(this).select('.bus-target').attr('opacity',1);
        showBusDetail(bus,true);
      })
      .on('pointerleave',function() { d3.select(this).select('.bus-target').attr('opacity',0); showBusDetail(selectedBus); })
      .on('focus',function(_event,bus) {
        if (canAttack(bus)) d3.select(this).select('.bus-target').attr('opacity',1);
        showBusDetail(bus,true);
      })
      .on('blur',function() { d3.select(this).select('.bus-target').attr('opacity',0); showBusDetail(selectedBus); })
      .on('keydown',(event,bus) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); pulse(bus); }
      });
    const deviation = bus => Math.min(1,Math.abs(snapshot.states.online[bus-1])/.03);
    const tint = bus => Math.abs(snapshot.states.online[bus-1]) > .02 ? '#d99c54' : '#7ea68b';
    animate(nodes.select('.voltage-halo')).attr('r',bus => 13+12*deviation(bus))
      .attr('fill',bus => tint(bus)).attr('fill-opacity',bus => .025+.22*deviation(bus));
    animate(nodes.select('.bus-dot')).attr('r',12)
      .attr('fill',bus => bus === selectedBus ? color('var(--primary)') : d3.interpolateRgb(color('var(--background)'), tint(bus))(deviation(bus)*.65))
      .attr('stroke',bus => bus === selectedBus ? color('var(--primary)') : '#bdcbc1').attr('stroke-width',1);
    nodes.select('.bus-icon').attr('d',bus=>busIcons[busRole(bus)])
      .attr('stroke',bus=>bus===selectedBus ? 'var(--primary-foreground)' : 'var(--primary)');
    nodes.select('.bus-number').attr('text-anchor','middle').attr('x',0).attr('y',23).attr('dy',null)
      .style('fill','var(--muted-foreground)').style('font-size','9px').text(bus => bus);
    nodes.select('.fault-mark').attr('x',13).attr('y',-9).text(bus => snapshot.faults.includes(bus) ? '×' : '');
    nodes.select('title').text(bus => busRole(bus)+' · Bus '+bus+' · '+(1+snapshot.states.online[bus-1]).toFixed(3)+' pu. '+(pulseCooldown(bus) ? 'Recovering '+pulseCooldown(bus)+' steps.' : 'Click for a '+pulseMagnitude($('strength').value)+' pu load pulse.'));
    nodes.filter(bus=>!canAttack(bus)).select('.bus-target').attr('opacity',0);
    showBusDetail(selectedBus);
    const voltages=snapshot.states.online.map(value=>1+value);
    const low=Math.min(...voltages), high=Math.max(...voltages);
    const inRange=low>=.95 && high<=1.05;
    if (lastPulse && snapshot.t-lastPulse.t >= 12) actionNote(inRange ? 'Voltage restored · Click a bus' : 'Controller restoring voltage');
    if ($('voltage-range')) $('voltage-range').textContent=low.toFixed(3)+' to '+high.toFixed(3)+' pu';
    if ($('voltage-status')) {
      $('voltage-status').title=inRange ? 'Within target' : 'Restoring voltage';
      $('voltage-status').dataset.state=inRange ? 'stable' : 'recovering';
    }
    const sources = recommendations.filter(e => e.to === selectedBus).map(e => e.from).join(', ');
    $('topology-label').textContent = $('all-links').checked ? 'All learned links' : 'Sources '+sources+' → bus '+selectedBus;
    $('links-detail').textContent = 'Icons are bus roles · Color shows voltage';
  }
  function showBusDetail(bus,hovered=false) {
    const voltage=1+snapshot.states.online[bus-1];
    $('bus-detail').textContent=busRole(bus)+' · Bus '+bus+' · '+voltage.toFixed(3)+' pu'+(pulseCooldown(bus) ? ' · Recovering '+pulseCooldown(bus)+' steps' : hovered && canAttack(bus) ? ' · Click to attack' : '');
  }

  function drawMatrix() {
    const el = $('matrix');
    if (!el) return;
    if (!matrixReference) captureMatrixReference();
    const width = Math.max(240, el.getBoundingClientRect().width);
    const height = 250;
    const side = Math.min(208, width - 66);
    const cellSize = side / 24;
    const left = (width - side + 26) / 2;
    const top = 30;
    const recommendations = snapshot.recommendations || [];
    const current = new Set(recommendations.map(recommendationKey));
    const added = [...current].filter(key => !matrixReference.edges.has(key));
    const removed = [...matrixReference.edges].filter(key => !current.has(key));
    const sources = recommendations.filter(edge => edge.to === selectedBus).map(edge => edge.from).sort((a,b) => a-b);
    const changes = added.length + ' added · ' + removed.length + ' removed';
    const detail = 'Bus ' + selectedBus + ' ← ' + sources.join(', ');
    if ($('matrix-reference')) $('matrix-reference').textContent = 'Changes since step ' + matrixReference.t;
    if ($('matrix-detail')) $('matrix-detail').textContent = detail;
    if ($('matrix-changes')) $('matrix-changes').textContent = changes;
    const svg = d3.select(el).attr('viewBox','0 0 '+width+' '+height).attr('height',height)
      .attr('role','group').attr('aria-label','Recommended communication connectivity matrix')
      .attr('aria-describedby','pr-matrix-description');
    if (svg.select('.matrix-cells').empty()) {
      svg.append('title').text('Recommended connectivity from source columns to receiver rows');
      svg.append('desc').attr('id','pr-matrix-description');
      svg.append('text').attr('class','matrix-axis matrix-source-title');
      svg.append('text').attr('class','matrix-axis matrix-receiver-title');
      svg.append('g').attr('class','matrix-columns');
      svg.append('g').attr('class','matrix-cells');
      svg.append('rect').attr('class','matrix-selected-row').attr('fill','none').attr('pointer-events','none');
      svg.append('g').attr('class','matrix-rows');
    }
    svg.select('desc').text('Each entry represents a recommended source for a receiver. Green entries are retained connections, blue entries are added connections, amber outlines are removed connections, and gray diagonal entries are local information. '+changes+' since step '+matrixReference.t+'. '+detail+'. Use the receiver buttons to select a bus.');
    svg.select('.matrix-source-title').attr('x',left+side/2).attr('y',12).attr('text-anchor','middle').attr('fill','var(--muted-foreground)').attr('font-size',11).text('Source bus');
    svg.select('.matrix-receiver-title').attr('transform','translate('+(left-35)+','+(top+side/2)+') rotate(-90)').attr('text-anchor','middle').attr('fill','var(--muted-foreground)').attr('font-size',11).text('Receiver bus');
    svg.select('.matrix-columns').selectAll('text').data(d3.range(1,25)).join('text')
      .attr('x',bus=>left+(bus-.5)*cellSize).attr('y',top-7).attr('text-anchor','middle')
      .attr('fill','var(--muted-foreground)').attr('font-size',9).text(bus=>bus);
    const cells = d3.range(1,25).flatMap(receiver => d3.range(1,25).map(source => {
      const key = receiver+','+source;
      const local = receiver === source;
      const connected = local || current.has(key);
      const change = local ? 'local' : current.has(key) ? (matrixReference.edges.has(key) ? 'retained' : 'added') : matrixReference.edges.has(key) ? 'removed' : 'inactive';
      return {receiver,source,connected,change};
    }));
    const marks = svg.select('.matrix-cells').selectAll('rect').data(cells,d=>d.receiver+','+d.source).join(enter=>{
      const rect=enter.append('rect').attr('class','matrix-cell').style('cursor','pointer');
      rect.append('title'); return rect;
    }).attr('x',d=>left+(d.source-1)*cellSize+.8).attr('y',d=>top+(d.receiver-1)*cellSize+.8)
      .attr('width',Math.max(1,cellSize-1.6)).attr('height',Math.max(1,cellSize-1.6))
      .attr('data-receiver',d=>d.receiver).attr('data-source',d=>d.source)
      .attr('data-connected',d=>String(d.connected)).attr('data-change',d=>d.change)
      .on('click',(_event,d)=>selectBus(d.receiver));
    // Persistent keyed cells let recommendations fade without rebuilding the matrix.
    animate(marks)
      .attr('fill',d=>color(d.change==='removed' ? 'var(--background)' : d.change==='retained' ? matrixColors.connected : matrixColors[d.change] || matrixColors.inactive))
      .attr('stroke',d=>d.change==='removed' ? color(matrixColors.removed) : 'transparent')
      .attr('stroke-width',d=>d.change==='removed' ? 1.4 : 0);
    marks.select('title').text(d=>d.source===d.receiver ? 'Bus '+d.receiver+' local information' : 'Source '+d.source+' to receiver '+d.receiver+' · '+(d.change==='inactive'?'Not recommended':d.change==='retained'?'Connected':d.change==='added'?'Added since reference':'Removed since reference'));
    svg.select('.matrix-selected-row').attr('x',left-.8).attr('y',top+(selectedBus-1)*cellSize-.5)
      .attr('width',side+1.6).attr('height',cellSize+1).attr('rx',1).attr('stroke','var(--foreground)').attr('stroke-width',1);
    const rows=svg.select('.matrix-rows').selectAll('g').data(d3.range(1,25)).join(enter=>{
      const group=enter.append('g').attr('role','button').attr('tabindex',0).style('cursor','pointer');
      group.append('rect').attr('x',-11).attr('width',22).attr('rx',2);
      group.append('text').attr('text-anchor','middle').attr('dy','.34em');
      return group;
    }).attr('transform',bus=>'translate('+(left-13)+','+(top+(bus-.5)*cellSize)+')')
      .attr('aria-label',bus=>'Select receiver bus '+bus).attr('aria-pressed',bus=>String(bus===selectedBus))
      .attr('data-receiver',bus=>bus).on('click',(_event,bus)=>selectBus(bus))
      .on('keydown',(event,bus)=>{
        if (event.key==='Enter'||event.key===' ') { event.preventDefault(); selectBus(bus); }
        else if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key==='Home' ? 1 : event.key==='End' ? 24 : Math.max(1,Math.min(24,bus+(event.key==='ArrowUp'?-1:1)));
          selectBus(next);
          svg.select('.matrix-rows').selectAll('g').filter(value=>value===next).node()?.focus();
        }
      });
    rows.select('rect').attr('y',-cellSize/2).attr('height',cellSize).attr('fill',bus=>bus===selectedBus?'var(--primary)':'transparent');
    rows.select('text').attr('font-size',10).attr('font-weight',bus=>bus===selectedBus?600:400)
      .attr('fill',bus=>bus===selectedBus?'var(--primary-foreground)':'var(--muted-foreground)').text(bus=>bus);
  }
  function chartBase(el, observations, keys, yTitle, xTitle, height) {
    const width = Math.max(240,el.getBoundingClientRect().width);
    const margin = {left:52,right:12,top:20,bottom:32};
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
    const yh=Math.max(yl + 1e-6,ymax || 0);
    const pad=(yh-yl)*.1;
    const x=d3.scaleLinear().domain([xmin || 0,(xmax === xmin ? (xmin || 0)+1 : xmax) || 1]).range([frame.x+2,frame.x+frame.w-2]);
    const y=d3.scaleLinear().domain([yl,yh+pad]).range([frame.y+frame.h-2,frame.y+2]);
    svg.select('[data-chart-frame]').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h);
    animate(svg.select('.grid').attr('transform','translate('+frame.x+',0)')).call(d3.axisLeft(y).ticks(4).tickSize(-frame.w).tickFormat(''));
    const xticks = x.ticks(width < 400 ? 3 : 5).filter(Number.isInteger);
    animate(svg.select('.x-axis').attr('transform','translate(0,'+(frame.y+frame.h)+')')).call(d3.axisBottom(x).tickValues(xticks).tickSize(4).tickFormat(d3.format('d')));
    animate(svg.select('.y-axis').attr('transform','translate('+frame.x+',0)')).call(d3.axisLeft(y).ticks(4).tickSize(4).tickFormat(d3.format('.3~g')));
    svg.select('[data-axis=x]').attr('x',frame.x+frame.w/2).attr('y',height-5).text(xTitle);
    svg.select('[data-axis=y]').attr('transform','translate(14,'+(frame.y+frame.h/2)+') rotate(-90)').text(yTitle);
    svg.select('clipPath rect').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h);
    const marks=svg.select('.chart-marks');
    return {svg,marks,x,y,frame,width,height};
  }
  function drawSeries(chart, observations, items, showCurrent = false) {
    const lines = chart.marks.selectAll('path.data-series').data(items,item => item.key).join(
      enter => enter.append('path').attr('class','data-series').attr('fill','none'),
      update => update,
      exit => exit.remove()
    ).attr('data-series-key',item => item.key).attr('stroke',item => item.color)
      .attr('stroke-width',item => item.key === 'online' ? 2.3 : 1.65).attr('stroke-dasharray',item => item.dash || null)
      .attr('stroke-linejoin','round').attr('stroke-linecap','round');
    animate(lines).attr('d',item => d3.line().defined(d => Number.isFinite(d[item.key])).x(d=>chart.x(d.x)).y(d=>chart.y(d[item.key]))(observations));
    const latest = observations[observations.length-1];
    const dots = chart.marks.selectAll('circle.latest-value').data(showCurrent ? items : [],item => item.key).join('circle')
      .attr('class','latest-value').attr('r',item => item.key === 'online' ? 3.5 : 2.5)
      .attr('fill',item => item.color).attr('stroke','var(--background)').attr('stroke-width',1);
    animate(dots).attr('cx',chart.x(latest.x)).attr('cy',item => chart.y(latest[item.key]));
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
    const domain = chart.x.domain();
    const events = journal.filter(item => ['pulse','fault'].includes(item.type) && item.t < snapshot.t && item.t+1 >= domain[0] && item.t+1 <= domain[1]).slice(-8);
    const groups = [];
    for (const item of events.slice().sort((a,b)=>a.t-b.t)) {
      const x = chart.x(item.t+1);
      const previous = groups[groups.length-1];
      if (previous && x-previous.right < 22) {
        previous.items.push(item);
        previous.right = x;
      } else groups.push({left:x,right:x,items:[item]});
    }
    groups.forEach(group => { group.key=group.items.map(item=>item.t+item.type+item.bus).join('_'); group.x=(group.left+group.right)/2; });
    const markers = chart.marks.selectAll('g.intervention-markers').data([null]).join('g').attr('class','intervention-markers');
    const lines = markers.selectAll('line').data(groups,group => group.key).join('line')
      .attr('y1',chart.frame.y).attr('y2',chart.frame.y+chart.frame.h)
      .attr('stroke','var(--muted-foreground)').attr('stroke-opacity',.28).attr('stroke-width',1).attr('stroke-dasharray','3 4');
    animate(lines).attr('x1',group=>group.x).attr('x2',group=>group.x);
    const labels = chart.svg.select('.intervention-labels').selectAll('text').data(groups,group=>group.key).join(enter=>{
      const label=enter.append('text').attr('class','intervention-label');
      label.append('title'); label.append('tspan'); return label;
    }).attr('y',chart.frame.y-6)
      .attr('data-event-count',group=>group.items.length).attr('data-disturbance-count',group=>group.items.filter(item=>item.type==='pulse').length)
      .attr('data-forecast-change-count',group=>group.items.filter(item=>item.type==='fault').length)
      .attr('data-event-steps',group=>group.items.map(item=>item.t+1).join(','))
      .attr('text-anchor','middle').attr('font-size',10).attr('fill','var(--muted-foreground)');
    animate(labels).attr('x',group=>group.x);
    labels.select('tspan').text(group=>[...new Set(group.items.map(item=>item.type==='pulse'?'D':'E'))].sort().join('/'));
    labels.select('title').text(group=>group.items.map(item=>item.type==='pulse' ? Number(item.strength || .025).toFixed(3)+' pu pulse at bus '+item.bus+' enters after the control at step '+(item.t+1)+'. Its state cost is charged at step '+(item.t+2)+'.' : 'Forecast change at bus '+item.bus+' · Step '+(item.t+1)).join(' '));
  }
  function drawCost() {
    const observations=[{x:0,online:0,static:0,causal:0},...snapshot.history.map(d=>({x:d.t,online:d.online,static:d.static,causal:d.causal}))];
    const items=series.filter(s=>visible.has(s.key));
    const chart=chartBase($('cost'),observations,series.map(s=>s.key),'Cost','Step',170);
    drawInterventions(chart);
    drawSeries(chart,observations,items);
    hover(chart,observations,items,'Step');
    const c=snapshot.cumulative;
    $('cost-detail').replaceChildren();
    for (const item of series) {
      const group=document.createElement('span'),label=document.createElement('span'),value=document.createElement('strong');
      group.className='pr-cost-value'; label.className='pr-cost-name';
      label.textContent=item.label; value.textContent=d3.format('.4f')(c[item.key]);
      group.append(label,value); $('cost-detail').append(group);
    }
  }
  function drawStage() {
    if (!$('stage')) return;
    let observations=snapshot.history.slice(-60).map(item=>({x:item.t,...item.stage}));
    if (!observations.length) observations=[{x:0,online:0,static:0,causal:0}];
    const items=series.filter(item=>visible.has(item.key));
    const chart=chartBase($('stage'),observations,series.map(item=>item.key),'Cost','Step',170);
    drawInterventions(chart);
    drawSeries(chart,observations,items,true);
    hover(chart,observations,items,'Step');
    $('stage-detail').textContent='Now '+d3.format('.4f')(snapshot.stage.online);
    if ($('live-cost')) $('live-cost').textContent=d3.format('.4f')(snapshot.stage.online);
    const pulseSummary = lastPulse
      ? 'Bus '+lastPulse.bus+' · '+(lastPulse.charged ? 'Cost '+d3.format('.4f')(lastPulse.before)+' → '+d3.format('.4f')(lastPulse.after) : 'Pulse applied at the final sample')
      : 'Click a bus to disturb the voltage.';
    if ($('impact-note')) $('impact-note').textContent=pulseSummary;
    if ($('pulse-summary')) $('pulse-summary').textContent=lastPulse ? pulseSummary : 'Hover a bus to attack';
  }
  function drawConvergence() {
    if ($('adaptation') && !$('adaptation').open) return;
    const frozen=isFit();
    let observations;
    if(frozen) observations=snapshot.fitHistory.map(d=>({x:d.iteration,value:100*d.error}));
    else observations=[{x:0,value:0},...snapshot.history.map(d=>({x:d.t,value:100*d.drift}))];
    if(!observations.length) observations=[{x:0,value:100*(snapshot.fitError || 0)}];
    $('convergence').setAttribute('aria-label',frozen?'Relative Frobenius error to the exact solution on frozen samples':'Relative Frobenius change in the shared response on each control step');
    const chart=chartBase($('convergence'),observations,['value'],frozen?'Solution error (%)':'Response change (%)',frozen?'Gradient iteration':'Control step',240);
    if (!frozen) drawInterventions(chart);
    else {
      chart.marks.select('.intervention-markers').selectAll('line').remove();
      chart.svg.select('.intervention-labels').selectAll('text').remove();
    }
    drawSeries(chart,observations,[{key:'value',color:'var(--viz-series-1)'}]);
    hover(chart,observations,[{key:'value',label:frozen?'Solution error (%)':'Response change (%)',color:'var(--viz-series-1)'}],frozen?'Iteration':'Step');
  }
  function render() {
    $('tooltip').style.display='none'; pin=null;
    renderControls(); drawNetwork(); drawMatrix(); drawCost(); drawStage(); drawConvergence();
  }
  announce('Ready');
  hydrate(window.openai?.widgetState);
  if (!matrixReference) captureMatrixReference();
  actionNote('Click a bus to add a load pulse.');
  window.addEventListener('openai:set_globals',e=>{if(!playing&&!restored&&!journal.length){hydrate(e.detail?.globals?.widgetState);render();}});
  new ResizeObserver(()=>render()).observe(root);
  render();
  // A read only inspection hook supports deterministic browser verification.
  root.powerDemo = { getSnapshot:() => simulation.snapshot(), getState:() => ({selectedBus,playing,fitSteps,journal:[...journal],lastPulse:lastPulse ? {...lastPulse} : null}) };
})();
