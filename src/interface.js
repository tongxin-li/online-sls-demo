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
    announce('Same seed restored · Ready'); render(); save();
  });
  $('speed').addEventListener('change', save);
  $('bus').addEventListener('change', () => { selectedBus = Number($('bus').value); render(); save(); });
  $('all-links').addEventListener('change', () => { drawNetwork(); save(); });
  function pulse() {
    if ($('pulse').disabled) return;
    simulation.queuePulse(selectedBus); journal.push({ t:snapshot.t, type:'pulse', bus:selectedBus });
    snapshot = simulation.snapshot();
    announce('Load pulse queued at bus ' + selectedBus + ' · Unforecasted voltage sag'); render(); save();
  }
  function fault() {
    if ($('fault').disabled) return;
    simulation.toggleFault(selectedBus); journal.push({ t:snapshot.t, type:'fault', bus:selectedBus });
    snapshot = simulation.snapshot();
    announce('Bus ' + selectedBus + (snapshot.faults.includes(selectedBus) ? ' forecast corrupted' : ' forecast repaired'));
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
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
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
    const height = instrument ? (window.innerWidth > 720 ? 450 : 320) : 292;
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
    nodes.on('click',(_e,bus) => { selectedBus=bus; $('bus').value=String(bus); render(); save(); });
    nodes.select('.voltage-halo').attr('r',bus => 12+Math.min(10,Math.abs(snapshot.states.online[bus-1])*400)).attr('fill','var(--viz-series-1)').attr('fill-opacity',.12);
    nodes.select('.bus-dot').attr('r',11).attr('fill',bus => bus === selectedBus ? 'var(--primary)' : 'var(--background)').attr('stroke','var(--border)').attr('stroke-width',1);
    nodes.select('.bus-number').attr('text-anchor','middle').attr('dy','.35em').style('fill',bus => bus === selectedBus ? 'var(--primary-foreground)' : 'var(--foreground)').text(bus => bus);
    nodes.select('.fault-mark').attr('x',13).attr('y',-9).text(bus => snapshot.faults.includes(bus) ? '×' : '');
    nodes.select('title').text(bus => 'Bus '+bus+' voltage '+(1+snapshot.states.online[bus-1]).toFixed(4)+' pu'+(snapshot.faults.includes(bus)?' with faulty forecast':''));
    const voltage = 1 + snapshot.states.online[selectedBus - 1];
    $('bus-detail').textContent = 'Bus '+selectedBus+' · '+voltage.toFixed(4)+' pu · '+(snapshot.faults.includes(selectedBus)?'Faulty forecast':'Reliable forecast');
    const sources = recommendations.filter(e => e.to === selectedBus).map(e => e.from).join(', ');
    $('topology-label').textContent = $('all-links').checked ? '72 recommended remote links · Selected receiver highlighted' : 'Sources '+sources+' → bus '+selectedBus;
    $('links-detail').textContent = snapshot.changedEdges+' link '+(snapshot.changedEdges === 1 ? 'replacement' : 'replacements')+' this update · Deployed links fixed';
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
  function tidyTicks(svg) {
    const nodes=svg.selectAll('.x-axis .tick text').nodes();
    for(let i=1;i<nodes.length;i++){const a=nodes[i-1].getBoundingClientRect(),b=nodes[i].getBoundingClientRect();if(a.right+4>b.left) nodes[i].style.display='none';}
    const yLabels=svg.selectAll('.y-axis .tick text').nodes();
    for(let i=1;i<yLabels.length;i++){const a=yLabels[i-1].getBoundingClientRect(),b=yLabels[i].getBoundingClientRect();if(b.bottom+4>a.top) yLabels[i].style.display='none';}
  }
  function drawCost() {
    const observations=[{x:0,online:0,static:0,causal:0},...snapshot.history.map(d=>({x:d.t,online:d.online,static:d.static,causal:d.causal}))];
    const items=series.filter(s=>visible.has(s.key));
    const chart=chartBase($('cost'),observations,series.map(s=>s.key),'Cost (weighted pu²)','Control step',document.body.classList.contains('research-site') ? 232 : 292);
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
    const chart=chartBase($('convergence'),observations,['value'],frozen?'Solution error (%)':'Response change (%)',frozen?'Gradient iteration':'Control step',document.body.classList.contains('research-site') ? 185 : 204);
    chart.marks.append('path').datum(observations).attr('fill','none').attr('stroke','var(--viz-series-1)').attr('stroke-width',2).attr('d',d3.line().x(d=>chart.x(d.x)).y(d=>chart.y(d.value)));
    hover(chart,observations,[{key:'value',label:frozen?'Solution error (%)':'Response change (%)',color:'var(--viz-series-1)'}],frozen?'Iteration':'Step');
    tidyTicks(chart.svg);
  }
  function render() {
    $('tooltip').style.display='none'; pin=null;
    renderControls(); drawNetwork(); drawCost(); drawConvergence();
  }
  announce('60 sample warm start · Space to run or pause');
  hydrate(window.openai?.widgetState);
  window.addEventListener('openai:set_globals',e=>{if(!playing&&!restored&&!journal.length){hydrate(e.detail?.globals?.widgetState);render();}});
  new ResizeObserver(()=>render()).observe(root);
  render();
  // A read only inspection hook supports deterministic browser verification.
  root.powerDemo = { getSnapshot:() => simulation.snapshot(), getState:() => ({selectedBus,playing,fitSteps,journal:[...journal]}) };
})();
