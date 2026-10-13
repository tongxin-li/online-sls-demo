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
    { key:'static', label:'Static prediction', color:'var(--viz-series-2)', dash:'7 4' },
    { key:'causal', label:'Causal', color:'var(--viz-series-3)', dash:'2 4' }
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
  const matrixColors = { connected:'#840028', added:'var(--matrix-added, #25796e)', removed:'var(--matrix-removed, #c18a43)', local:'#bdb8bd', inactive:'#f0f1f3' };
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
    matrixReference = { t:snapshot.t, fitIteration:snapshot.fitIteration, edges:new Set((snapshot.recommendations || []).map(recommendationKey)) };
  }
  function selectBus(bus) {
    selectedBus = bus;
    $('bus').value = String(bus);
    render(); save();
  }
  function continueAfterAction() {
    if (!playing) { playing = true; schedule(); }
  }
  function save() {
    restored = true;
    if (!window.openai?.setWidgetState) return;
    const state = {
      modelContent: { scenario:'Synthetic 24 bus voltage regulation', variant:'Shared response calibration with fixed physical and deployed links', step:snapshot.t, mode:snapshot.mode, cumulativeCost:snapshot.cumulative, selectedBus, faultyBuses:snapshot.faults, fitError:snapshot.fitError },
      privateContent: { version:1, t:journal.length <= 200 ? snapshot.t : 0, journal:journal.length <= 200 ? journal : [], selectedBus, speed:$('speed').value, allLinks:$('all-links').checked, fitSteps:journal.length <= 200 ? fitSteps : 0, fitting:journal.length <= 200 && isFit() }
    };
    window.openai.setWidgetState(state).catch(() => {});
  }
  function hydrate(saved) {
    const data = saved?.privateContent;
    if (restored || !data || data.version !== 1) return;
    restored = true;
    selectedBus = Math.max(1, Math.min(24, Number(data.selectedBus) || 6));
    $('bus').value = String(selectedBus);
    if (['4','12','30'].includes(data.speed)) $('speed').value = data.speed;
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
        if (item.type === 'pulse') simulation.queuePulse(item.bus);
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
    announce('Saved experiment restored · Paused');
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
    if (snapshot.mode === 'completed') { stop(); announce('Episode complete · Freeze the data to inspect convergence'); }
    if (snapshot.mode === 'converged') { stop(); announce('Frozen fit converged · Relative error below 0.001%'); }
    render();
    if (snapshot.t % 30 === 0 || !playing) save();
  }
  function toggleRun() {
    if (playing) { stop(); announce(isFit() ? 'Fit paused' : 'Simulation paused'); save(); }
    else if (snapshot.mode !== 'completed' && snapshot.mode !== 'converged') {
      playing = true;
      announce(isFit() ? 'Fitting the frozen sample window' : 'Simulation running');
      schedule();
    }
    renderControls();
  }
  $('run').addEventListener('click', toggleRun);
  $('step').addEventListener('click', () => { stop(); tick(); save(); });
  $('restart').addEventListener('click', () => {
    stop(); simulation.reset(); snapshot = simulation.snapshot(); journal = []; fitSteps = 0; pin = null;
    captureMatrixReference();
    actionNote('A sudden load change at the selected bus. The simulation starts when you click.');
    announce('Same seed restored · Ready'); render(); save();
  });
  $('speed').addEventListener('change', save);
  $('bus').addEventListener('change', () => selectBus(Number($('bus').value)));
  $('all-links').addEventListener('change', () => { drawNetwork(); save(); });
  if ($('reference')) $('reference').addEventListener('click', () => {
    captureMatrixReference(); drawMatrix();
    announce('Connectivity reference saved at step ' + snapshot.t);
  });
  function pulse() {
    if ($('pulse').disabled) return;
    captureMatrixReference();
    simulation.queuePulse(selectedBus); journal.push({ t:snapshot.t, type:'pulse', bus:selectedBus });
    snapshot = simulation.snapshot();
    continueAfterAction();
    const message = 'Disturbance added at bus ' + selectedBus + ' for step ' + (snapshot.t + 1);
    announce(message + ' · Simulation running');
    actionNote(message + ' · Watch the network and cumulative cost respond');
    render(); save();
  }
  function fault() {
    if ($('fault').disabled) return;
    captureMatrixReference();
    simulation.toggleFault(selectedBus); journal.push({ t:snapshot.t, type:'fault', bus:selectedBus });
    snapshot = simulation.snapshot();
    continueAfterAction();
    const message = 'Forecast at bus ' + selectedBus + (snapshot.faults.includes(selectedBus) ? ' corrupted' : ' repaired') + ' at step ' + snapshot.t;
    announce(message + ' · Simulation running');
    actionNote(message + ' · Watch the colored matrix entries change as learning continues');
    render(); save();
  }
  $('pulse').addEventListener('click', pulse);
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
    else if (key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggleRun(); }
  });
  root.querySelectorAll('[data-series]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.series;
      if (visible.has(key) && visible.size > 1) visible.delete(key);
      else visible.add(key);
      button.setAttribute('aria-pressed', visible.has(key) ? 'true' : 'false');
      drawCost();
    });
  });
  function renderControls() {
    const frozen = isFit();
    $('clock').textContent = 'Step ' + snapshot.t + ' / ' + snapshot.horizon;
    $('learning').textContent = frozen ? 'Plant held · ' + snapshot.mode : snapshot.t < 30 ? 'Learning starts after 30 samples' : 'Learning from revealed samples';
    $('run').textContent = playing ? (frozen ? 'Pause fit' : 'Pause simulation') : (frozen ? 'Continue fit' : 'Run simulation');
    $('run').disabled = ['converged','completed'].includes(snapshot.mode);
    $('step').textContent = frozen ? 'One fit step' : 'One step';
    $('step').disabled = ['converged','completed'].includes(snapshot.mode);
    $('freeze').textContent = frozen ? 'Return to simulation' : 'Freeze data and fit';
    $('freeze').disabled = snapshot.t < 30;
    $('pulse').disabled = frozen || snapshot.mode === 'completed';
    $('fault').disabled = frozen || snapshot.mode === 'completed';
    $('fault').textContent = (snapshot.faults.includes(selectedBus) ? 'Repair' : 'Corrupt') + ' forecast';
    $('fit-title').textContent = frozen ? 'Convergence on frozen data' : 'Online adaptation';
    $('fit-detail').textContent = frozen ? 'Relative solution error ' + d3.format('.2~g')(100*(snapshot.fitError || 0)) + '%' : 'Rolling window of 60 revealed samples';
    $('mode-note').textContent = frozen ? 'A fixed ridge objective · Numerical convergence of this reduced model' : 'Freeze data to inspect convergence to a fixed ridge solution';
  }
  function drawNetwork() {
    const el = $('network');
    const width = Math.max(240, el.getBoundingClientRect().width);
    const instrument = document.body.classList.contains('research-site');
    const height = instrument ? 340 : 292;
    const svg = d3.select(el).attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height);
    const point = bus => [22 + positions[bus - 1][0] * (width - 48), 26 + positions[bus - 1][1] * (height - 54)];
    if (svg.select('defs').empty()) {
      svg.append('title').text('Fixed electrical feeder with learned prediction source recommendations');
      const defs = svg.append('defs');
      defs.append('marker').attr('id','pr-arrow').attr('viewBox','0 0 10 10').attr('refX',9).attr('refY',5).attr('markerUnits','userSpaceOnUse').attr('markerWidth',7).attr('markerHeight',7).attr('orient','auto').append('path').attr('d','M 0 0 L 10 5 L 0 10 Z').attr('fill','var(--viz-series-1)');
      svg.append('g').attr('class','physical');
      svg.append('g').attr('class','recommended');
      svg.append('g').attr('class','nodes');
    }
    svg.select('.physical').selectAll('line').data(PowerDemo.constants.edges).join('line')
      .attr('x1',e => point(e[0])[0]).attr('y1',e => point(e[0])[1]).attr('x2',e => point(e[1])[0]).attr('y2',e => point(e[1])[1])
      .attr('stroke','var(--foreground)').attr('stroke-opacity',.2).attr('stroke-width',1.4);
    const recommendations = snapshot.recommendations || [];
    const edges = $('all-links').checked ? recommendations : recommendations.filter(e => e.to === selectedBus);
    const extent = d3.extent(recommendations,e => e.weight);
    const strength = d3.scaleSqrt().domain([0,Math.max(extent[1] || 0,1e-12)]).range([1,3.5]);
    function arc(e) {
      const a = point(e.from), b = point(e.to), dx=b[0]-a[0], dy=b[1]-a[1], dist=Math.hypot(dx,dy)||1;
      const offset = e.from < e.to ? 1 : -1;
      const c=[(a[0]+b[0])/2 - dy*.18*offset, (a[1]+b[1])/2 + dx*.18*offset];
      const da = Math.hypot(c[0]-a[0],c[1]-a[1]) || 1, db=Math.hypot(b[0]-c[0],b[1]-c[1]) || 1;
      const start=[a[0]+12*(c[0]-a[0])/da,a[1]+12*(c[1]-a[1])/da];
      const end=[b[0]-14*(b[0]-c[0])/db,b[1]-14*(b[1]-c[1])/db];
      return 'M'+start.join(',')+' Q'+c.join(',')+' '+end.join(',');
    }
    svg.select('.recommended').selectAll('path').data(edges,e => e.from+'_'+e.to).join('path')
      .attr('d',arc).attr('fill','none').attr('stroke','var(--viz-series-1)').attr('stroke-width',e => strength(e.weight))
      .attr('opacity',e => e.to === selectedBus ? .9 : .16).attr('marker-end','url(#pr-arrow)');
    const nodes = svg.select('.nodes').selectAll('g').data(d3.range(1,25)).join(enter => {
      const g=enter.append('g').attr('class','cursor-interaction');
      g.append('circle').attr('class','voltage-halo'); g.append('circle').attr('class','bus-dot'); g.append('text').attr('class','bus-number'); g.append('text').attr('class','fault-mark'); g.append('title');
      return g;
    }).attr('transform',bus => 'translate('+point(bus).join(',')+')');
    nodes.on('click',(_e,bus) => selectBus(bus));
    nodes.select('.voltage-halo').attr('r',bus => 12+Math.min(10,Math.abs(snapshot.states.online[bus-1])*400)).attr('fill','var(--viz-series-1)').attr('fill-opacity',.12);
    nodes.select('.bus-dot').attr('r',11).attr('fill',bus => bus === selectedBus ? 'var(--primary)' : 'var(--background)').attr('stroke','var(--border)').attr('stroke-width',1);
    nodes.select('.bus-number').attr('text-anchor','middle').attr('dy','.35em').style('fill',bus => bus === selectedBus ? 'var(--primary-foreground)' : 'var(--foreground)').text(bus => bus);
    nodes.select('.fault-mark').attr('x',13).attr('y',-9).text(bus => snapshot.faults.includes(bus) ? '×' : '');
    nodes.select('title').text(bus => 'Bus '+bus+' voltage '+(1+snapshot.states.online[bus-1]).toFixed(4)+' pu'+(snapshot.faults.includes(bus)?' with faulty forecast':''));
    const voltage = 1 + snapshot.states.online[selectedBus - 1];
    $('bus-detail').textContent = 'Bus '+selectedBus+' · '+voltage.toFixed(4)+' pu · '+(snapshot.faults.includes(selectedBus)?'Faulty forecast':'Reliable forecast');
    const sources = recommendations.filter(e => e.to === selectedBus).map(e => e.from).join(', ');
    $('topology-label').textContent = $('all-links').checked ? '72 recommended remote links · Selected receiver highlighted' : 'Sources '+sources+' → bus '+selectedBus;
    $('links-detail').textContent = 'Gray lines show the electrical feeder · Arrows show recommended sources';
  }
  function drawMatrix() {
    const el = $('matrix');
    if (!el) return;
    if (!matrixReference) captureMatrixReference();
    const width = Math.max(300, el.getBoundingClientRect().width);
    const height = 340;
    const side = Math.min(288, width - 66);
    const cellSize = side / 24;
    const left = (width - side + 26) / 2;
    const top = 36;
    const recommendations = snapshot.recommendations || [];
    const current = new Set(recommendations.map(recommendationKey));
    const added = [...current].filter(key => !matrixReference.edges.has(key));
    const removed = [...matrixReference.edges].filter(key => !current.has(key));
    const sources = recommendations.filter(edge => edge.to === selectedBus).map(edge => edge.from).sort((a,b) => a-b);
    const selectedAdded = added.filter(key => Number(key.split(',')[0]) === selectedBus).length;
    const selectedRemoved = removed.filter(key => Number(key.split(',')[0]) === selectedBus).length;
    const changes = added.length + ' added · ' + removed.length + ' removed';
    const detail = 'Bus ' + selectedBus + ' receives from ' + sources.join(', ') + ' · ' + selectedAdded + ' added · ' + selectedRemoved + ' removed';
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
    svg.select('desc').text('Each entry represents a recommended source for a receiver. Burgundy entries are retained connections, teal entries are added connections, amber outlines are removed connections, and gray diagonal entries are local information. '+changes+' since step '+matrixReference.t+'. '+detail+'. Use the receiver buttons to select a bus.');
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
      .attr('fill',d=>d.change==='retained' ? matrixColors.connected : matrixColors[d.change] || matrixColors.inactive)
      .attr('stroke',d=>d.change==='removed' ? matrixColors.removed : 'none')
      .attr('stroke-width',d=>d.change==='removed' ? 1.4 : 0)
      .on('click',(_event,d)=>selectBus(d.receiver));
    // Removed recommendations remain outlined until the comparison reference changes.
    marks.filter(d=>d.change==='removed').attr('fill','var(--background)');
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
    const margin = {left:68,right:18,top:16,bottom:48};
    const frame={x:margin.left,y:margin.top,w:width-margin.left-margin.right,h:height-margin.top-margin.bottom};
    const svg=d3.select(el).attr('viewBox','0 0 '+width+' '+height).attr('height',height);
    svg.selectAll('*').remove();
    svg.append('title').text(el.getAttribute('aria-label'));
    const [xmin,xmax]=d3.extent(observations,d=>d.x);
    const [ymin,ymax]=d3.extent(observations.flatMap(d=>keys.map(k=>d[k])).filter(Number.isFinite));
    let yl=Math.min(0,ymin || 0), yh=ymax || 0;
    if (yl === yh) yh=yl+1;
    const pad=(yh-yl)*.06;
    const x=d3.scaleLinear().domain([xmin || 0,(xmax === xmin ? (xmin || 0)+1 : xmax) || 1]).range([frame.x+2,frame.x+frame.w-2]);
    const y=d3.scaleLinear().domain([yl,yh+pad]).range([frame.y+frame.h-2,frame.y+2]);
    svg.append('rect').attr('data-chart-frame','').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h).attr('fill','none').attr('stroke','var(--border)');
    svg.append('g').attr('class','grid').attr('transform','translate('+frame.x+',0)').call(d3.axisLeft(y).ticks(4).tickSize(-frame.w).tickFormat('')).selectAll('text').remove();
    const xticks = x.ticks(width < 400 ? 3 : 5).filter(Number.isInteger);
    svg.append('g').attr('class','x-axis').attr('transform','translate(0,'+(frame.y+frame.h)+')').call(d3.axisBottom(x).tickValues(xticks).tickSize(4).tickFormat(d3.format('d')));
    svg.append('g').attr('class','y-axis').attr('transform','translate('+frame.x+',0)').call(d3.axisLeft(y).ticks(4).tickSize(4).tickFormat(d3.format('.3~g')));
    svg.append('text').attr('class','axis-title').attr('data-axis','x').attr('x',frame.x+frame.w/2).attr('y',height-5).attr('text-anchor','middle').text(xTitle);
    svg.append('text').attr('class','axis-title').attr('data-axis','y').attr('transform','translate(14,'+(frame.y+frame.h/2)+') rotate(-90)').attr('text-anchor','middle').text(yTitle);
    const clip='pr-clip-'+el.id;
    svg.append('defs').append('clipPath').attr('id',clip).append('rect').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h);
    const marks=svg.append('g').attr('clip-path','url(#'+clip+')');
    return {svg,marks,x,y,frame,width,height};
  }
  function hover(chart,observations,items,xLabel) {
    const {svg,x,y,frame}=chart;
    const tip=$('tooltip');
    const guide=svg.append('line').attr('data-chart-hover-guide','').attr('y1',frame.y).attr('y2',frame.y+frame.h).attr('stroke','var(--foreground)').attr('stroke-opacity',.3).attr('display','none');
    const dots=svg.append('g');
    const overlay=svg.append('rect').attr('data-chart-hit','').attr('data-chart-hover-overlay','cross-series').attr('x',frame.x).attr('y',frame.y).attr('width',frame.w).attr('height',frame.h).attr('fill','transparent');
    function show(event) {
      const pointer=d3.pointer(event,svg.node());
      const px=Math.max(x.range()[0],Math.min(x.range()[1],pointer[0]));
      const xv=x.invert(px);
      const near=d3.bisector(d=>d.x).center(observations,xv);
      let lo=near, hi=near;
      if (observations[near].x > xv) lo=Math.max(0,near-1);
      else hi=Math.min(observations.length-1,near+1);
      const a=observations[lo],b=observations[hi],fraction=a.x===b.x?0:(xv-a.x)/(b.x-a.x);
      const values=items.map(s=>({...s,value:a[s.key]+fraction*(b[s.key]-a[s.key])}));
      guide.attr('x1',px).attr('x2',px).attr('display',null);
      dots.selectAll('circle').data(values).join('circle').attr('data-chart-hover-marker','').attr('r',3).attr('cx',px).attr('cy',d=>y(d.value)).attr('fill',d=>d.color);
      tip.replaceChildren();
      const title=document.createElement('span'); title.textContent=xLabel+' '+d3.format('.1f')(xv); tip.append(title);
      values.forEach(s=>{const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('span');label.textContent=s.label;value.textContent=d3.format('.4~g')(s.value);row.append(label,value);tip.append(row);});
      tip.style.display='block';
      const bounds=root.getBoundingClientRect();
      const sx=event.clientX-bounds.left, sy=event.clientY-bounds.top;
      tip.style.left=Math.max(0,Math.min(root.clientWidth-tip.offsetWidth,sx+12))+'px';
      tip.style.top=Math.max(0,sy-tip.offsetHeight-12)+'px';
    }
    overlay.on('pointermove',event=>{if(!pin)show(event);}).on('pointerleave',()=>{if(!pin){tip.style.display='none';guide.attr('display','none');dots.selectAll('*').remove();}}).on('click',event=>{pin=pin?null:svg.node().id;show(event);});
  }
  function drawInterventions(chart) {
    const events = journal.filter(item => ['pulse','fault'].includes(item.type) && item.t < snapshot.t).slice(-8);
    const groups = [];
    for (const item of events.slice().sort((a,b)=>a.t-b.t)) {
      const x = chart.x(item.t+1);
      const previous = groups[groups.length-1];
      if (previous && x-previous.right < 22) {
        previous.items.push(item);
        previous.right = x;
      } else groups.push({left:x,right:x,items:[item]});
    }
    const markers = chart.marks.append('g').attr('class','intervention-markers');
    for (const group of groups) {
      const {items} = group;
      const x = (group.left+group.right)/2;
      markers.append('line').attr('x1',x).attr('x2',x).attr('y1',chart.frame.y).attr('y2',chart.frame.y+chart.frame.h)
        .attr('stroke','var(--muted-foreground)').attr('stroke-opacity',.35).attr('stroke-width',1).attr('stroke-dasharray','3 4');
      const label = [...new Set(items.map(item=>item.type==='pulse'?'D':'E'))].sort().join('/');
      chart.svg.append('text').attr('class','intervention-label').attr('x',x).attr('y',chart.frame.y-5)
        .attr('data-event-count',items.length).attr('data-disturbance-count',items.filter(item=>item.type==='pulse').length)
        .attr('data-forecast-change-count',items.filter(item=>item.type==='fault').length)
        .attr('data-event-steps',items.map(item=>item.t+1).join(','))
        .attr('text-anchor','middle').attr('font-size',10).attr('fill','var(--muted-foreground)').text(label)
        .append('title').text(items.map(item=>(item.type==='pulse'?'Disturbance':'Forecast change')+' at bus '+item.bus+' · Step '+(item.t+1)).join(' · '));
    }
  }
  function tidyTicks(svg) {
    const nodes=svg.selectAll('.x-axis .tick text').nodes();
    for(let i=1;i<nodes.length;i++){const a=nodes[i-1].getBoundingClientRect(),b=nodes[i].getBoundingClientRect();if(a.right+4>b.left) nodes[i].style.display='none';}
    const yLabels=svg.selectAll('.y-axis .tick text').nodes();
    for(let i=1;i<yLabels.length;i++){const a=yLabels[i-1].getBoundingClientRect(),b=yLabels[i].getBoundingClientRect();if(b.bottom+4>a.top) yLabels[i].style.display='none';}
  }
  function drawCost() {
    const observations=[{x:0,online:0,static:0,causal:0},...snapshot.history.map(d=>({x:d.t,online:d.online,static:d.static,causal:d.causal}))];
    const items=series.filter(s=>visible.has(s.key));
    const chart=chartBase($('cost'),observations,series.map(s=>s.key),'Cost (weighted pu²)','Control step',document.body.classList.contains('research-site') ? 260 : 292);
    drawInterventions(chart);
    items.forEach(s=>chart.marks.append('path').datum(observations).attr('fill','none').attr('stroke',s.color).attr('stroke-width',2).attr('stroke-dasharray',s.dash).attr('d',d3.line().x(d=>chart.x(d.x)).y(d=>chart.y(d[s.key]))));
    hover(chart,observations,items,'Step');
    tidyTicks(chart.svg);
    const c=snapshot.cumulative;
    $('cost-detail').replaceChildren();
    for (const item of series) {
      const group=document.createElement('span'),label=document.createElement('span'),value=document.createElement('strong');
      group.className='pr-cost-value'; label.className='pr-cost-name';
      label.textContent=item.label; value.textContent=d3.format('.4f')(c[item.key]);
      group.append(label,value); $('cost-detail').append(group);
    }
  }
  function drawConvergence() {
    const frozen=isFit();
    let observations;
    if(frozen) observations=snapshot.fitHistory.map(d=>({x:d.iteration,value:100*d.error}));
    else observations=[{x:0,value:0},...snapshot.history.map(d=>({x:d.t,value:100*d.drift}))];
    if(!observations.length) observations=[{x:0,value:100*(snapshot.fitError || 0)}];
    $('convergence').setAttribute('aria-label',frozen?'Relative Frobenius error to the exact solution on frozen samples':'Relative Frobenius change in the shared response on each control step');
    const chart=chartBase($('convergence'),observations,['value'],frozen?'Solution error (%)':'Response change (%)',frozen?'Gradient iteration':'Control step',document.body.classList.contains('research-site') ? 260 : 204);
    if (!frozen) drawInterventions(chart);
    chart.marks.append('path').datum(observations).attr('fill','none').attr('stroke','var(--viz-series-1)').attr('stroke-width',2).attr('d',d3.line().x(d=>chart.x(d.x)).y(d=>chart.y(d.value)));
    hover(chart,observations,[{key:'value',label:frozen?'Solution error (%)':'Response change (%)',color:'var(--viz-series-1)'}],frozen?'Iteration':'Step');
    tidyTicks(chart.svg);
  }
  function render() {
    $('tooltip').style.display='none'; pin=null;
    renderControls(); drawNetwork(); drawMatrix(); drawCost(); drawConvergence();
  }
  announce('Ready at step 60 · Add a disturbance to begin');
  hydrate(window.openai?.widgetState);
  if (!matrixReference) captureMatrixReference();
  actionNote('A sudden load change at the selected bus. The simulation starts when you click.');
  window.addEventListener('openai:set_globals',e=>{if(!playing&&!restored&&!journal.length){hydrate(e.detail?.globals?.widgetState);render();}});
  new ResizeObserver(()=>render()).observe(root);
  render();
  // A read only inspection hook supports deterministic browser verification.
  root.powerDemo = { getSnapshot:() => simulation.snapshot(), getState:() => ({selectedBus,playing,fitSteps,journal:[...journal]}) };
})();
