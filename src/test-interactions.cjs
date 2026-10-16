'use strict';
// Run actual interface event handlers against the real engine. Rendering is
// intentionally replaced with noops; browser tests cover SVG and pointer layout.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const PowerDemo=require('./simulation.js');
const d3=require('../assets/d3.v7.min.js');
const TopologyTimeline=require('./topology-timeline.js');
const html=fs.readFileSync(path.join(__dirname,'interface.html'),'utf8');
const original=fs.readFileSync(path.join(__dirname,'interface.js'),'utf8');
const anchor="  announce('Ready');";
assert.equal(original.split(anchor).length,2,'Interface initialization anchor must be unique');
// Event cards and transient flashes are rendered and checked in the browser.
// Keep the actual history state and controls in this lightweight DOM harness.
const cardStart="    const cards=d3.select($('topology-events'))";
const cardEnd="    $('topology-events').hidden=total===0;";
assert.equal(original.split(cardStart).length,2,'Topology cards anchor must be unique');
const withoutCards=original.slice(0,original.indexOf(cardStart))+original.slice(original.indexOf(cardEnd));
const source=withoutCards.replace(anchor,
  '  drawNetwork=drawCost=drawStage=drawVoltage=drawConvergence=highlightTopology=()=>{};\n'+
  '  drawMatrix=drawTopologyHistory;\n'+
  '  root.bindTestBus=(element,bus)=>bindAttackTarget(element,()=>bus);\n'+
  '  root.testSummary=()=>comparisonSummary();\n'+
  '  root.testInspectPredictionLink=(receiver,source)=>inspectPredictionLink(receiver,source);\n'+
  '  root.testInspection=()=>predictionInspection();\n'+
  '  root.testForecastObservation=()=>inspectedForecastObservation();\n'+
  '  root.testIssuedForecasts=()=>simulation.forecasts;\n'+
  '  root.testDrawSeries=drawSeries;\n'+
  '  root.testPin=(value)=>{if(value!==undefined)pin=value;return pin;};\n'+
  '  root.testPowerContext=()=>powerRecoveryContext();\n'+
  '  root.testShownReference=()=>[...topologyFrame().reference];\n'+
  '  root.testComparison=()=>({active:activeSeries().map(item=>item.key),plotted:plottedSeries().map(item=>item.key),sameSparseSupport:sameSparseSupport()});\n'+anchor);
const plain=value=>JSON.parse(JSON.stringify(value));

class Clock {
  now=0;
  serial=0;
  tasks=new Map();
  setTimeout=(fn,delay=0)=>{const id=++this.serial;this.tasks.set(id,{fn,at:this.now+Math.max(0,Number(delay)||0)});return id;};
  clearTimeout=id=>this.tasks.delete(id);
  next(){return [...this.tasks].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];}
  async runNext(){
    const next=this.next();assert.ok(next,'Expected a scheduled callback');
    const [id,task]=next;this.tasks.delete(id);this.now=Math.max(this.now,task.at);task.fn();
    // Let the real async comparison handler resume after its zero delay yield.
    await Promise.resolve();await Promise.resolve();
  }
  async advance(milliseconds){
    const target=this.now+milliseconds;let count=0;
    while(this.next()&&this.next()[1].at<=target){assert.ok(++count<10000,'Timer loop must be bounded');await this.runNext();}
    this.now=target;
  }
  async until(predicate){for(let i=0;!predicate();i++){assert.ok(i<2000,'Condition did not become true');await this.runNext();}}
}

function target(tagName='DIV') {
  const listeners=new Map();
  return {tagName,style:{},dataset:{},children:[],value:'',textContent:'',hidden:false,disabled:false,checked:false,
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
    dispatch(type,detail={}){
      const event={target:this,defaultPrevented:false,repeat:false,altKey:false,ctrlKey:false,metaKey:false,
        button:0,pointerId:1,detail:0,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...detail};
      return (listeners.get(type)||[]).map(handler=>handler(event)).at(-1);
    },
    setAttribute(name,value){this[name]=String(value);},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},
    querySelector(selector){return this.children.find(child=>selector==='.pr-swatch'&&child.className?.startsWith('pr-swatch'))||null;},
    getBoundingClientRect(){return {width:550};},
    setPointerCapture(id){this.capturedPointer=id;},
    closest(){return null;}
  };
}

function harness(saved,experiment='prediction',reducedMotion=true) {
  const clock=new Clock(),nodes=new Map(),savedStates=[],captures=new Map();
  function element(tagName='DIV') {
    const node=target(tagName);
    node.setPointerCapture=id=>{node.capturedPointer=id;captures.set(id,node);};
    node.releasePointerCapture=id=>{if(captures.get(id)===node){captures.delete(id);node.dispatch('lostpointercapture',{pointerId:id});}};
    node.hasPointerCapture=id=>captures.get(id)===node;
    return node;
  }
  for(const match of html.matchAll(/<(\w+)[^>]*\bid="(pr-[^"]+)"/g)){
    const node=element(match[1].toUpperCase());node.id=match[2];nodes.set(node.id,node);
  }
  for(const input of html.matchAll(/<input\b[^>]*\bid="(pr-[^"]+)"[^>]*>/g)){
    nodes.get(input[1]).checked=/\bchecked\b/.test(input[0]);
  }
  // Read actual selected defaults so the harness cannot hide an HTML speed bug.
  for(const select of html.matchAll(/<select\b[^>]*\bid="(pr-[^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
    const options=[...select[2].matchAll(/<option\b([^>]*)>/g)];
    const selected=options.find(option=>/\bselected\b/.test(option[1]))||options[0];
    if(selected)nodes.get(select[1]).value=selected[1].match(/\bvalue="([^"]*)"/)[1];
  }
  // Existing interaction cases exercise Prediction; dedicated cases below cover
  // the new Communication default and its saved experiment controls.
  nodes.get('pr-experiment').value=experiment;
  nodes.get('pr-view').value=experiment==='communication'?'learning':'cost';
  const seriesButtons=new Map();
  for(const match of html.matchAll(/<button\b[^>]*\bdata-series="([^"]+)"[^>]*>/g)){
    const button=element('BUTTON');button.dataset.series=match[1];
    const swatch=element('SPAN');swatch.className='pr-swatch '+match[1];button.append(swatch);seriesButtons.set(match[1],button);
  }
  const root=target();root.querySelector=selector=>nodes.get(selector.slice(1));
  root.querySelectorAll=selector=>selector==='[data-series]'?[...seriesButtons.values()]:[];
  const document=Object.assign(target(),{getElementById:()=>root,createElement:tag=>target(tag.toUpperCase()),createTextNode:text=>({textContent:text})});
  const window=Object.assign(target(),{d3,PowerDemo,TopologyTimeline,matchMedia:()=>({matches:reducedMotion}),
    openai:{widgetState:saved,setWidgetState:state=>{savedStates.push(plain(state));return Promise.resolve();}}});
  vm.runInNewContext(source,{window,document,PowerDemo,d3,TopologyTimeline,console,
    performance:{now:()=>clock.now},setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,
    ResizeObserver:class{observe(){}},getComputedStyle:()=>({getPropertyValue:()=>''})},
    {filename:'interface.js'});
  const node=id=>nodes.get('pr-'+id);
  return {clock,document,window,node,drawSeries:(...args)=>root.testDrawSeries(...args),pin:value=>root.testPin(value),
    comparison:()=>plain(root.testComparison()),summary:()=>root.testSummary(),powerContext:()=>root.testPowerContext(),shownReference:()=>plain(root.testShownReference()),seriesButton:key=>seriesButtons.get(key),
    samples:count=>clock.advance(count*1000/Number(node('speed').value)),
    bus:bus=>{const svg=element('g');svg.dataset.bus=String(bus);root.bindTestBus(svg,bus);return svg;},
    pointer(type,underPointer,detail={}){
      const id=detail.pointerId??1,recipient=captures.get(id)||underPointer;
      const result=recipient.dispatch(type,{pointerId:id,pointerType:'mouse',...detail});
      if(type==='pointerup'||type==='pointercancel')recipient.releasePointerCapture(id);
      return result;
    },
    inspectLink:(receiver,source)=>root.testInspectPredictionLink(receiver,source),inspection:()=>plain(root.testInspection()),forecastObservation:()=>plain(root.testForecastObservation()),issuedForecasts:()=>plain(root.testIssuedForecasts()),
    snapshot:()=>root.powerDemo.getSnapshot(),state:()=>plain(root.powerDemo.getState()),
    saved:()=>savedStates.at(-1),
    event:(id,type,detail)=>node(id).dispatch(type,detail),
    click:(id,detail=0)=>node(id).dispatch('click',{detail}),
    change:(id,value)=>{node(id).value=String(value);return node(id).dispatch('change');},
    check:(id,checked)=>{node(id).checked=checked;return node(id).dispatch('change');},
    quickClick(){node('pulse').dispatch('pointerdown');node('pulse').dispatch('pointerup');node('pulse').dispatch('click',{detail:1});},
    key:(type,key,detail={})=>document.dispatch(type,{key,...detail})
  };
}
const pulses=h=>h.snapshot().eventLog.filter(event=>event.type==='pulse');

test('Space preserves native summary and link activation, including descendant targets',()=>{
  for(const selector of ['summary','a[href]'])for(const descendant of [false,true])for(const playing of [false,true]){
    const h=harness();if(playing)h.click('run');
    const initialTime=h.snapshot().t;
    const control=target(selector==='summary'?'SUMMARY':'A');
    const origin=descendant?target('SPAN'):control;
    origin.closest=selectors=>selectors.split(',').some(value=>value.trim()===selector)?control:null;
    let prevented=false;
    h.key('keydown',' ',{target:origin,preventDefault(){prevented=true;this.defaultPrevented=true;}});
    const context=selector+(descendant?' descendant':'')+(playing?' during playback':' while paused');
    assert.equal(prevented,false,context+' must retain its native Space behavior');
    assert.equal(h.state().playing,playing,context+' must not toggle playback');
    assert.equal(h.snapshot().t,initialTime,context+' must not advance the simulation');
  }
});

test('Space on the page background starts and pauses ordinary playback',async()=>{
  const h=harness(),background=target('DIV');
  let prevented=0;
  const press=()=>h.key('keydown',' ',{target:background,preventDefault(){prevented++;this.defaultPrevented=true;}});
  press();assert.equal(h.state().playing,true);assert.equal(prevented,1);
  const initialTime=h.snapshot().t;
  await h.samples(2);assert.equal(h.snapshot().t,initialTime+2);
  press();assert.equal(h.state().playing,false);assert.equal(prevented,2);
  await h.samples(2);assert.equal(h.snapshot().t,initialTime+2,'Paused playback must stop sampling');
});

test('pointer activation queues once and a paused attack starts playback without advancing time',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.event('pulse','pointerdown');h.event('pulse','pointerup');h.click('pulse',1);
  assert.equal(pulses(h).length,1);assert.equal(h.snapshot().pendingPulses.length,1);
  assert.equal(h.snapshot().t,0);assert.equal(h.state().playing,true);
  await h.samples(1);assert.equal(h.snapshot().t,1);assert.equal(pulses(h).length,1);
  assert.equal(h.snapshot().activePulses.length,1);
});

test('holding Attack adds one pulse per physical sample and release preserves playback',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.event('pulse','pointerdown');await h.samples(3);
  assert.equal(h.snapshot().t,3);assert.deepEqual(pulses(h).map(event=>event.t),[0,1,2]);
  assert.equal(h.node('pulse').dataset.holding,'true');
  h.event('pulse','pointerup');h.click('pulse',1);await h.samples(2);
  assert.equal(h.snapshot().t,5);assert.equal(pulses(h).length,3);assert.equal(h.state().playing,true);
  assert.equal(h.node('pulse').dataset.holding,'false');assert.ok(h.snapshot().activePulses.length>0);
});

test('D hold ignores keyboard repeats and keyup stops only new attacks',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.key('keydown','d');h.key('keydown','d',{repeat:true});
  await h.samples(4);assert.deepEqual(pulses(h).map(event=>event.t),[0,1,2,3]);
  h.key('keyup','D');await h.samples(2);
  assert.equal(pulses(h).length,4);assert.equal(h.snapshot().t,6);assert.equal(h.state().playing,true);
});

test('quick clicks preserve every pending and active pulse and do not reset time',async()=>{
  const h=harness();h.change('attack-mode','pulse');for(let i=0;i<5;i++)h.quickClick();
  assert.equal(pulses(h).length,5);assert.equal(h.snapshot().pendingPulses.length,5);assert.equal(h.snapshot().t,0);
  await h.samples(1);assert.equal(h.snapshot().activePulses.length,5);
  h.quickClick();h.quickClick();assert.equal(h.snapshot().activePulses.length,5);assert.equal(h.snapshot().pendingPulses.length,2);
  await h.samples(1);assert.equal(h.snapshot().t,2);assert.equal(h.snapshot().activePulses.length,7);
  assert.deepEqual(pulses(h).map(event=>event.t),[0,0,0,0,0,1,1]);
});

test('pointer cancellation and window blur release attacks without pausing playback',async()=>{
  for(const kind of ['pointercancel','lostpointercapture','blur']){
    const h=harness();h.change('attack-mode','pulse');h.event('pulse','pointerdown');await h.samples(1);
    if(kind==='blur')h.window.dispatch(kind);else h.event('pulse',kind);
    await h.samples(2);assert.equal(pulses(h).length,1,kind);assert.equal(h.snapshot().t,3,kind);assert.equal(h.state().playing,true,kind);
  }
});

test('hidden document pauses playback and clears the hold',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.key('keydown','d');await h.samples(1);
  h.document.hidden=true;h.document.dispatch('visibilitychange');await h.samples(4);
  assert.equal(h.snapshot().t,1);assert.equal(h.state().playing,false);assert.equal(h.node('pulse').dataset.holding,'false');
});

test('late timers do not burst through missed physical samples',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.quickClick();h.clock.now=10000;await h.clock.runNext();
  assert.equal(h.snapshot().t,1);const recoveryDelay=1000/Number(h.node('speed').value)*.15;
  assert.ok(h.clock.next()[1].at>=10000+recoveryDelay);
  await h.clock.advance(recoveryDelay-.01);assert.equal(h.snapshot().t,1);
  await h.clock.advance(.01);assert.equal(h.snapshot().t,2);
});

test('attacks interleave safely with comparison batches and continue after the batch',async()=>{
  const h=harness();h.check('auto-compare',false);h.change('attack-mode','pulse');const comparison=h.click('compare');assert.equal(h.node('run').disabled,true);
  h.event('pulse','pointerdown');await h.clock.runNext();
  assert.equal(h.snapshot().t,12);assert.equal(pulses(h).length,12);
  h.event('pulse','pointerup');h.click('pulse',1);await h.clock.runNext();
  assert.equal(h.snapshot().t,24);assert.equal(pulses(h).length,12);
  h.event('pulse','pointerdown');await h.clock.until(()=>!h.node('compare').disabled);await comparison;
  assert.equal(h.snapshot().t,180);assert.equal(pulses(h).length,168);assert.equal(h.state().playing,true);
  assert.equal(new Set(pulses(h).map(event=>event.t)).size,168);
  await h.samples(1);assert.equal(h.snapshot().t,181);assert.equal(pulses(h).length,169);
  h.event('pulse','pointerup');await h.samples(1);assert.equal(h.snapshot().t,182);assert.equal(pulses(h).length,169);
});

test('matrix reference survives pulses, forecast changes and exact saved replay',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.quickClick();const initialReference=h.saved().privateContent.matrixReference;
  await h.samples(35);h.click('run');
  const reference=h.saved().privateContent.matrixReference;assert.equal(reference.t,0);
  assert.deepEqual(reference,initialReference);h.quickClick();h.click('fault');
  assert.deepEqual(h.saved().privateContent.matrixReference,reference);
  await h.samples(3);h.click('run');
  const restored=harness(h.saved());
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(restored.snapshot().states,h.snapshot().states);
  assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
  assert.equal(restored.state().playing,false);
  restored.click('fault');assert.deepEqual(restored.saved().privateContent.matrixReference,reference);
});

test('deployment replay is exact and Learn again starts a fresh discovery trial',async()=>{
  const h=harness();h.check('auto-compare',false);h.change('attack-mode','pulse');const comparison=h.click('compare');await h.clock.until(()=>!h.node('compare').disabled);await comparison;
  assert.equal(h.snapshot().canDeploy,true);h.click('deploy');assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,0);
  assert.equal(h.node('deploy').textContent,'Learn again');assert.equal(h.node('deploy').disabled,false);
  h.key('keydown','d');await h.samples(3);h.key('keyup','d');h.click('run');
  const restored=harness(h.saved());assert.equal(restored.snapshot().phase,'deployment');
  assert.deepEqual(restored.snapshot().deployedSupport,h.snapshot().deployedSupport);
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  h.click('deploy');assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,0);
  assert.equal(h.snapshot().deployedSupport,null);assert.equal(h.snapshot().eventLog.length,0);assert.equal(h.state().playing,false);
  assert.equal(h.node('matrix-view').value,'links');assert.equal(h.snapshot().preset,'mixed');
});

test('fixed slack rejects pointer and keyboard attacks',()=>{
  const h=harness();h.change('attack-mode','pulse');h.change('bus',1);h.event('pulse','pointerdown');h.click('pulse',0);h.key('keydown','d');
  assert.equal(pulses(h).length,0);assert.equal(h.state().playing,false);assert.equal(h.node('pulse').disabled,true);
});

test('default playback advances sixteen physical samples per wall second',async()=>{
  const h=harness();h.change('attack-mode','pulse');assert.equal(h.node('speed').value,'16');
  h.quickClick();await h.clock.advance(1000);
  assert.equal(h.snapshot().t,16);assert.equal(pulses(h).length,1);
});

test('SVG bus press captures the pointer and holds that bus at the default speed',async()=>{
  const h=harness();h.change('attack-mode','pulse');const bus=h.bus(14);
  h.pointer('pointerdown',bus,{pointerId:41});
  assert.equal(bus.capturedPointer,41);assert.equal(bus.hasPointerCapture(41),true);
  assert.equal(bus.dataset.holding,'true');assert.equal(h.state().selectedBus,14);
  assert.equal(pulses(h).length,1);assert.equal(h.snapshot().t,0);
  await h.clock.advance(1000);
  assert.equal(h.snapshot().t,16);assert.deepEqual(pulses(h).map(event=>event.t),Array.from({length:16},(_,i)=>i));
  assert.ok(pulses(h).every(event=>event.bus===14));
  h.pointer('pointerup',bus,{pointerId:41});bus.dispatch('click',{detail:1});
  assert.equal(pulses(h).length,16);assert.equal(bus.dataset.holding,'false');
  await h.samples(2);assert.equal(h.snapshot().t,18);assert.equal(pulses(h).length,16);assert.equal(h.state().playing,true);
});

test('releasing outside a captured SVG bus ends the hold without stopping playback',async()=>{
  const h=harness();h.change('attack-mode','pulse');const bus=h.bus(8),outside=target();
  h.pointer('pointerdown',bus,{pointerId:17});await h.samples(3);
  h.pointer('pointermove',outside,{pointerId:17});
  h.pointer('pointerup',outside,{pointerId:17});
  assert.equal(bus.hasPointerCapture(17),false);assert.equal(bus.dataset.holding,'false');
  await h.samples(3);assert.equal(h.snapshot().t,6);assert.equal(pulses(h).length,3);assert.equal(h.state().playing,true);
});

test('touch cancellation on a captured SVG bus preserves previously applied attacks',async()=>{
  const h=harness();h.change('attack-mode','pulse');const bus=h.bus(12);
  h.pointer('pointerdown',bus,{pointerId:32,pointerType:'touch'});await h.samples(2);
  const attacks=h.snapshot().activePulses.length;
  h.pointer('pointercancel',target(),{pointerId:32,pointerType:'touch'});
  assert.equal(bus.dataset.holding,'false');assert.equal(bus.hasPointerCapture(32),false);
  assert.equal(h.snapshot().activePulses.length,attacks);
  await h.samples(2);assert.equal(pulses(h).length,2);assert.equal(h.snapshot().t,4);assert.equal(h.state().playing,true);
});

test('repeated SVG clicks add one pulse per gesture with no compatibility click duplication',()=>{
  const h=harness();h.change('attack-mode','pulse');const bus=h.bus(21);
  for(let i=0;i<4;i++){
    h.pointer('pointerdown',bus);h.pointer('pointerup',bus);bus.dispatch('click',{detail:i+1});
  }
  bus.dispatch('dblclick',{detail:2});
  assert.equal(pulses(h).length,4);assert.equal(h.snapshot().pendingPulses.length,4);
  assert.ok(pulses(h).every(event=>event.bus===21));assert.equal(h.snapshot().t,0);
});

test('Enter and Space hold an SVG bus and ignore repeated keyboard events',async()=>{
  for(const key of ['Enter',' ']){
    const h=harness();h.change('attack-mode','pulse');const bus=h.bus(18);
    bus.dispatch('keydown',{key});bus.dispatch('keydown',{key,repeat:true});await h.samples(4);
    assert.equal(pulses(h).length,4,key);assert.ok(pulses(h).every(event=>event.bus===18));
    bus.dispatch('keyup',{key});await h.samples(2);
    assert.equal(pulses(h).length,4,key);assert.equal(h.snapshot().t,6,key);assert.equal(bus.dataset.holding,'false');
  }
});

test('all playback modes preserve one held bus pulse per physical sample',async()=>{
  for(const rate of [2,4,8,16,32]){
    const h=harness();h.change('attack-mode','pulse');const bus=h.bus(5);h.change('speed',rate);h.pointer('pointerdown',bus);
    await h.clock.advance(1000);assert.equal(h.snapshot().t,rate);assert.equal(pulses(h).length,rate);
    assert.equal(new Set(pulses(h).map(event=>event.t)).size,rate);
    h.pointer('pointerup',bus);await h.clock.advance(1000);
    assert.equal(h.snapshot().t,2*rate);assert.equal(pulses(h).length,rate);assert.equal(h.state().playing,true);
  }
});

test('changing speed during a hold replaces the timer without losing or doubling attacks',async()=>{
  const h=harness();h.change('attack-mode','pulse');const bus=h.bus(7);h.pointer('pointerdown',bus);await h.samples(1);
  h.change('speed',32);assert.equal(h.clock.tasks.size,1);await h.clock.advance(1000);
  assert.equal(h.snapshot().t,33);assert.deepEqual(pulses(h).map(event=>event.t),Array.from({length:33},(_,i)=>i));
});

test('old algorithm saves start a clean paused trial instead of replaying incompatible controls',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.quickClick();await h.samples(3);h.click('run');
  for(const version of [7,8,9,10,11,12]){
    const old=plain(h.saved());old.privateContent.version=version;
    const restored=harness(old);
    assert.equal(restored.snapshot().t,0);assert.equal(restored.snapshot().phase,'discovery');
    assert.ok(Object.values(restored.snapshot().cumulative).every(value=>value===0));
    assert.equal(restored.snapshot().eventLog.length,0);assert.equal(restored.state().playing,false);
    assert.equal(restored.node('attack-mode').value,'continuous');assert.equal(restored.node('view').value,'cost');
    restored.quickClick();assert.equal(restored.saved().privateContent.version,13);
  }
});

test('version thirteen replay retains speed, attack mode and matrix view',async()=>{
  const h=harness();h.change('attack-mode','pulse');h.change('speed',16);h.change('matrix-view','change');h.quickClick();await h.samples(3);h.click('run');
  assert.equal(h.saved().privateContent.version,13);
  const restored=harness(h.saved());assert.equal(restored.node('speed').value,'16');assert.equal(restored.node('matrix-view').value,'change');
  assert.equal(restored.node('attack-mode').value,'pulse');
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
});

// A seeded integration fixture. Topology observations must agree across stepping,
// batch advancement and saved replay under the current learning algorithm.
function topologyHarness(){
  return harness({privateContent:{version:13,phase:'discovery',preset:'mixed',
    initialOptions:{seed:7,preset:'mixed'},t:0,events:[],selectedBus:7,
    automaticComparison:false,speed:'8',pulseStrength:'100',view:'cost',matrixView:'links'}});
}
async function compare(h){
  const completion=h.click('compare');await h.clock.until(()=>!h.node('compare').disabled);await completion;
}

test('Advance 180 retains every actual topology change observed by single stepping',async()=>{
  const fast=topologyHarness();await compare(fast);
  const timeline=fast.state().topology;
  assert.equal(fast.snapshot().t,180);assert.equal(timeline.lastT,180);
  assert.ok(timeline.events.length>0,'The fixture must contain actual learned connectivity changes');
  assert.deepEqual(timeline.current,timeline.events.at(-1).after);
  assert.equal(fast.node('topology-history').max,String(timeline.events.length));assert.equal(fast.node('topology-history').disabled,false);
  assert.equal(fast.node('history-count').textContent,timeline.events.length+' link updates');
  const single=topologyHarness();for(let i=0;i<180;i++)single.click('step');
  assert.deepEqual(single.state().topology,timeline);
  assert.deepEqual(single.snapshot().cumulative,fast.snapshot().cumulative);
});

test('version thirteen replay reconstructs topology events from every physical sample',async()=>{
  const h=topologyHarness();await compare(h);
  const bus=h.bus(14);h.pointer('pointerdown',bus);await h.samples(7);h.pointer('pointerup',bus);h.click('run');
  const restored=harness(h.saved());
  assert.equal(restored.saved(),undefined,'Restoration must not rewrite the saved trial');
  assert.deepEqual(restored.state().topology,h.state().topology);
  assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  assert.equal(restored.state().historyIndex,null);
});

test('deployment and its reset preserve the completed discovery history while Learn again clears it',async()=>{
  const h=topologyHarness();await compare(h);const discovery=h.state().topology;
  h.click('deploy');const frozen=h.state().topology;
  assert.deepEqual(frozen,{...discovery,phase:'deployment'});assert.equal(h.snapshot().t,0);
  await compare(h);assert.equal(h.snapshot().t,180);assert.deepEqual(h.state().topology,frozen);
  const restored=harness(h.saved());assert.deepEqual(restored.state().topology,frozen);
  assert.equal(restored.snapshot().phase,'deployment');
  h.node('topology-history').value='1';h.event('topology-history','input');
  h.click('restart');assert.equal(h.snapshot().t,0);assert.equal(h.snapshot().phase,'deployment');
  assert.deepEqual(h.state().topology,frozen);assert.equal(h.state().historyIndex,null);
  h.click('deploy');assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,0);
  assert.equal(h.state().topology.events.length,0);assert.equal(h.state().topology.lastT,0);
  assert.equal(h.state().topology.phase,'discovery');assert.equal(h.state().historyIndex,null);
});

test('Discovery reset discards old topology observations and starts from the new initial support',async()=>{
  const h=topologyHarness();await compare(h);assert.ok(h.state().topology.events.length>0);
  h.node('topology-history').value='2';h.event('topology-history','input');h.click('restart');
  const timeline=h.state().topology;
  assert.equal(h.snapshot().t,0);assert.equal(timeline.events.length,0);assert.equal(timeline.initialT,0);assert.equal(timeline.lastT,0);
  assert.deepEqual(timeline.initial,timeline.current);assert.equal(h.state().historyIndex,null);
  assert.equal(h.node('topology-history').disabled,true);assert.equal(h.node('history-count').textContent,'0 link updates');
});

test('history slider and Show latest change only the view, never the current engine state',async()=>{
  const h=topologyHarness();await compare(h);
  const before=h.snapshot(),timeline=h.state().topology;
  for(const index of [0,1,timeline.events.length]){
    h.node('topology-history').value=String(index);h.event('topology-history','input');
    assert.equal(h.state().historyIndex,index);assert.equal(h.node('history-live').textContent,'Show latest');
    assert.deepEqual(h.snapshot(),before);assert.deepEqual(h.state().topology,timeline);assert.equal(h.state().playing,false);
  }
  h.click('history-live');assert.equal(h.state().historyIndex,null);assert.equal(h.node('history-live').textContent,'Latest');
  assert.deepEqual(h.snapshot(),before);assert.deepEqual(h.state().topology,timeline);
  h.node('topology-history').value='1';h.event('topology-history','input');h.click('step');
  assert.equal(h.snapshot().t,181);assert.equal(h.state().historyIndex,1,'Reviewing history must not block live progression');
});

test('keyboard hold ends when its toolbar or bus loses focus, while unrelated blur leaves it active',async()=>{
  for(const kind of ['toolbar','bus'])for(const key of ['Enter',' ']){
    const h=harness();h.change('attack-mode','pulse');const owner=kind==='toolbar'?h.node('pulse'):h.bus(8);
    const other=kind==='toolbar'?h.bus(12):h.node('pulse');
    owner.dispatch('keydown',{key});await h.samples(2);
    other.dispatch('blur',{relatedTarget:owner});await h.samples(1);
    assert.equal(pulses(h).length,3,kind+' should ignore another target losing focus');
    assert.equal(owner.dataset.holding,'true');
    owner.dispatch('keydown',{key:'Tab'});owner.dispatch('blur',{relatedTarget:other});
    h.key('keyup',key,{target:other});await h.samples(2);
    assert.equal(owner.dataset.holding,'false',kind+' should release when focus moves');
    assert.equal(h.node('pulse').dataset.holding,'false');
    assert.equal(pulses(h).length,3,kind+' should not add attacks after blur');
    assert.equal(h.snapshot().t,5);assert.equal(h.state().playing,true);
  }
});

function pointerClick(h,element,pointerId=1){
  h.pointer('pointerdown',element,{pointerId});
  h.pointer('pointerup',element,{pointerId});
  element.dispatch('click',{detail:1});
}

test('Continuous is the default and a released bus click repeats one pulse per sample',async()=>{
  const h=harness(),bus=h.bus(14);
  assert.equal(h.node('attack-mode').value,'continuous');assert.equal(h.node('speed').value,'16');
  pointerClick(h,bus,51);
  assert.equal(bus.hasPointerCapture(51),false,'Native pointer release also delivers lostpointercapture');
  assert.equal(pulses(h).length,1,'Compatibility click must not toggle or duplicate activation');
  assert.equal(h.node('pulse-label').textContent,'Stop attack');assert.equal(h.node('pulse')['aria-pressed'],'true');
  await h.clock.advance(1000);
  assert.equal(h.snapshot().t,16);assert.equal(pulses(h).length,16);
  assert.deepEqual(pulses(h).map(event=>event.t),Array.from({length:16},(_,i)=>i));
  assert.ok(pulses(h).every(event=>event.bus===14));
  assert.equal(h.node('attack-hint').textContent,'Repeats until stopped');
});

test('clicking the same bus stops a continuous attack without adding a final pulse',async()=>{
  const h=harness(),bus=h.bus(7);pointerClick(h,bus);await h.samples(4);
  const active=h.snapshot().activePulses.length;pointerClick(h,bus);
  assert.equal(h.node('pulse-label').textContent,'Attack bus 7');assert.equal(h.node('pulse')['aria-pressed'],'false');
  assert.equal(h.snapshot().activePulses.length,active);assert.equal(pulses(h).length,4);
  await h.samples(3);assert.equal(h.snapshot().t,7);assert.equal(pulses(h).length,4);assert.equal(h.state().playing,true);
});

test('Stop attack targets the active continuous bus even after selection changes to the slack bus',async()=>{
  const h=harness(),bus=h.bus(8);pointerClick(h,bus);await h.samples(3);
  h.change('bus',1);assert.equal(h.node('pulse').disabled,false);assert.equal(h.node('pulse-label').textContent,'Stop attack');
  pointerClick(h,h.node('pulse'),23);await h.samples(3);
  assert.equal(pulses(h).length,3);assert.equal(h.snapshot().t,6);assert.equal(h.state().selectedBus,1);
  assert.equal(h.node('pulse-label').textContent,'Fixed substation');assert.equal(h.node('pulse').disabled,true);
});

test('clicking another bus transfers continuous attacks and preserves earlier applied pulses',async()=>{
  const h=harness(),first=h.bus(7),second=h.bus(14);
  pointerClick(h,first);await h.samples(3);const firstCount=h.snapshot().activePulses.filter(event=>event.bus===7).length;
  pointerClick(h,second,24);assert.equal(h.snapshot().activePulses.filter(event=>event.bus===7).length,firstCount);
  await h.samples(3);
  assert.deepEqual(pulses(h).map(event=>event.bus),[7,7,7,14,14,14]);
  assert.deepEqual(pulses(h).map(event=>event.t),[0,1,2,3,4,5]);
  assert.equal(h.state().selectedBus,14);assert.equal(h.node('pulse-label').textContent,'Stop attack');
});

test('touch cancellation stops a continuous attack while normal release keeps it active',async()=>{
  const h=harness(),bus=h.bus(12);
  h.pointer('pointerdown',bus,{pointerId:8,pointerType:'touch'});await h.samples(2);
  h.pointer('pointercancel',target(),{pointerId:8,pointerType:'touch'});await h.samples(2);
  assert.equal(pulses(h).length,2);assert.equal(h.node('pulse')['aria-pressed'],'false');assert.equal(h.state().playing,true);
  h.pointer('pointerdown',bus,{pointerId:9,pointerType:'touch'});
  h.pointer('pointerup',target(),{pointerId:9,pointerType:'touch'});bus.dispatch('click',{detail:1});
  await h.samples(3);assert.equal(pulses(h).length,5);assert.equal(h.node('pulse')['aria-pressed'],'true');
});

test('losing capture before pointer release cancels continuous attacks',async()=>{
  const h=harness(),bus=h.bus(21);h.pointer('pointerdown',bus,{pointerId:17});await h.samples(2);
  bus.releasePointerCapture(17);await h.samples(2);
  assert.equal(pulses(h).length,2);assert.equal(h.node('pulse')['aria-pressed'],'false');assert.equal(h.state().playing,true);
});

test('Enter and Space toggle continuous bus and toolbar attacks and ignore keyup and repeats',async()=>{
  for(const kind of ['bus','toolbar'])for(const key of ['Enter',' ']){
    const h=harness(),owner=kind==='bus'?h.bus(18):h.node('pulse');
    owner.dispatch('keydown',{key});owner.dispatch('keydown',{key,repeat:true});owner.dispatch('keyup',{key});
    await h.samples(3);assert.equal(pulses(h).length,3,kind+' '+key);assert.equal(h.node('pulse')['aria-pressed'],'true');
    owner.dispatch('keydown',{key});owner.dispatch('keyup',{key});await h.samples(2);
    assert.equal(pulses(h).length,3,kind+' should stop on the second activation');assert.equal(h.state().playing,true);
  }
});

test('continuous attacks survive ordinary focus changes but stop on window blur',async()=>{
  const h=harness(),bus=h.bus(18);pointerClick(h,bus);await h.samples(2);
  bus.dispatch('blur',{relatedTarget:h.node('speed')});await h.samples(2);
  assert.equal(pulses(h).length,4);assert.equal(h.node('pulse')['aria-pressed'],'true');
  h.window.dispatch('blur');
  assert.equal(h.node('pulse').dataset.attackState,'fading','Window blur must repaint the released attack before another physical sample');
  assert.equal(h.node('attack-hint').textContent,'Disturbance fading');
  assert.equal(h.node('pulse')['aria-pressed'],'false');
  await h.samples(2);
  assert.equal(pulses(h).length,4);assert.equal(h.node('pulse')['aria-pressed'],'false');assert.equal(h.state().playing,true);
});

test('assistive clicks toggle continuous attacks exactly once per activation',async()=>{
  for(const kind of ['bus','toolbar']){
    const h=harness(),owner=kind==='bus'?h.bus(5):h.node('pulse');
    owner.dispatch('click',{detail:0});await h.samples(3);
    assert.equal(pulses(h).length,3);owner.dispatch('click',{detail:0});await h.samples(2);
    assert.equal(pulses(h).length,3);assert.equal(h.node('pulse')['aria-pressed'],'false');
  }
});

test('Pause ends a continuous attack and Run resumes only the plant',async()=>{
  const h=harness(),bus=h.bus(14);pointerClick(h,bus);await h.samples(4);h.click('run');
  await h.samples(3);assert.equal(h.snapshot().t,4);assert.equal(h.state().playing,false);assert.equal(h.node('pulse')['aria-pressed'],'false');
  h.click('run');await h.samples(2);assert.equal(h.snapshot().t,7);assert.equal(pulses(h).length,4);assert.equal(h.state().playing,true);
});

test('reloading an active continuous trial restores physical history but never restarts the attack',async()=>{
  const h=harness(),bus=h.bus(14);pointerClick(h,bus);await h.samples(4);
  h.change('speed',32);const saved=h.saved();assert.equal(saved.privateContent.version,13);assert.equal(saved.privateContent.attackMode,'continuous');
  const restored=harness(saved);assert.equal(restored.node('attack-mode').value,'continuous');assert.equal(restored.node('speed').value,'32');
  assert.equal(restored.state().playing,false);assert.equal(restored.node('pulse')['aria-pressed'],'false');
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
  await restored.samples(2);assert.equal(restored.snapshot().t,4);
  restored.click('run');await restored.samples(2);assert.equal(restored.snapshot().t,7);assert.equal(pulses(restored).length,4);
});

test('D remains an explicit hold shortcut in either attack mode',async()=>{
  for(const mode of ['continuous','pulse']){
    const h=harness();h.change('attack-mode',mode);h.key('keydown','d');h.key('keydown','d',{repeat:true});
    await h.samples(3);assert.equal(pulses(h).length,3);h.key('keyup','d');await h.samples(2);
    assert.equal(pulses(h).length,3);assert.equal(h.snapshot().t,5);assert.equal(h.node('pulse')['aria-pressed'],'false');
  }
});

test('changing attack mode stops repetition without deleting pending or applied disturbances',async()=>{
  const h=harness(),bus=h.bus(7);pointerClick(h,bus);await h.samples(3);
  h.change('attack-mode','pulse');await h.samples(2);assert.equal(pulses(h).length,3);assert.equal(h.state().playing,true);
  h.pointer('pointerdown',bus);await h.samples(2);h.change('attack-mode','continuous');h.pointer('pointerup',bus);bus.dispatch('click',{detail:1});
  await h.samples(2);assert.equal(pulses(h).length,5);assert.equal(h.node('pulse')['aria-pressed'],'false');
  assert.ok(h.snapshot().activePulses.length>0);
});

test('attack feedback separates continuous requests from fading and paused physical disturbances',async()=>{
  const h=harness(),bus=h.bus(7);
  assert.equal(h.node('pulse').dataset.attackState,'idle');
  assert.equal(h.node('attack-hint').textContent,'Click to start or stop');
  pointerClick(h,bus);
  assert.equal(h.snapshot().pendingPulses.length,1);
  assert.equal(h.node('pulse').dataset.attackState,'continuous','Active repetition takes precedence over its queued request');
  assert.equal(h.node('attack-hint').textContent,'Repeats until stopped');
  await h.samples(4);
  const tails=plain(h.snapshot().activePulses);
  pointerClick(h,bus);
  assert.deepEqual(h.snapshot().activePulses,tails,'Stopping new requests must preserve the applied disturbance');
  assert.equal(h.node('pulse').dataset.attackState,'fading');
  assert.equal(h.node('attack-hint').textContent,'Disturbance fading');
  h.click('run');
  assert.equal(h.node('pulse').dataset.attackState,'paused');
  assert.equal(h.node('attack-hint').textContent,'Paused · Disturbance remains');
  await h.samples(3);
  assert.deepEqual(h.snapshot().activePulses,tails,'Pause holds the physical disturbance at its current age');
  h.click('run');
  assert.equal(h.node('pulse').dataset.attackState,'fading');
  assert.equal(pulses(h).length,4,'Resume must not reactivate repetition');
  const remaining=Math.max(...h.snapshot().activePulses.map(event=>event.steps-event.age));
  await h.samples(remaining-1);
  assert.equal(h.node('pulse').dataset.attackState,'fading');
  assert.ok(h.snapshot().activePulses.length>0);
  await h.samples(1);
  assert.equal(h.snapshot().activePulses.length,0);
  assert.equal(h.node('pulse').dataset.attackState,'idle');
  assert.equal(h.node('attack-hint').textContent,'Click to start or stop');
});

test('pulse feedback distinguishes a held gesture from pending requests and fading tails',async()=>{
  const h=harness();h.change('attack-mode','pulse');
  assert.equal(h.node('attack-hint').textContent,'Click or hold');
  h.event('pulse','pointerdown');
  assert.equal(h.node('pulse').dataset.attackState,'held');
  assert.equal(h.node('attack-hint').textContent,'Release to stop');
  assert.equal(h.snapshot().pendingPulses.length,1);
  h.event('pulse','pointerup');h.click('pulse',1);
  assert.equal(h.node('pulse').dataset.attackState,'pending');
  assert.equal(h.node('attack-hint').textContent,'Queued for next sample');
  await h.samples(1);
  assert.equal(h.node('pulse').dataset.attackState,'fading');
  h.quickClick();
  assert.equal(h.snapshot().activePulses.length,1);assert.equal(h.snapshot().pendingPulses.length,1);
  assert.equal(h.node('pulse').dataset.attackState,'pending','A fresh pending request takes precedence over an older fading tail');
  h.key('keydown','d');
  assert.equal(h.node('pulse').dataset.attackState,'held','An explicit keyboard hold takes precedence over pending requests');
  assert.equal(h.node('attack-hint').textContent,'Release to stop');
  h.key('keyup','d');
  assert.equal(h.node('pulse').dataset.attackState,'pending');
  await h.samples(1);
  assert.equal(h.node('pulse').dataset.attackState,'fading');
  assert.equal(h.snapshot().activePulses.length,3);
});

test('attack feedback follows the active bus before selection and then the selected bus',async()=>{
  const h=harness();pointerClick(h,h.bus(7));await h.samples(2);
  h.change('bus',14);
  assert.equal(h.node('pulse').dataset.attackState,'continuous');
  assert.equal(h.node('pulse-label').textContent,'Stop attack');
  assert.equal(h.node('attack-hint').textContent,'Repeats until stopped');
  pointerClick(h,h.node('pulse'));
  assert.equal(h.state().selectedBus,14);assert.ok(h.snapshot().activePulses.every(event=>event.bus===7));
  assert.equal(h.node('pulse').dataset.attackState,'idle','An unrelated selected bus must not inherit another bus disturbance');
  h.change('bus',7);
  assert.equal(h.node('pulse').dataset.attackState,'fading');
  assert.equal(h.node('attack-hint').textContent,'Disturbance fading');
});

test('switching attack mode updates feedback while retaining queued and applied disturbances',async()=>{
  const h=harness();pointerClick(h,h.bus(7));
  h.change('attack-mode','pulse');
  assert.equal(h.snapshot().pendingPulses.length,1);
  assert.equal(h.node('pulse').dataset.attackState,'pending');
  assert.equal(h.node('attack-hint').textContent,'Queued for next sample');
  await h.samples(2);
  h.key('keydown','d');await h.samples(1);
  const tails=plain(h.snapshot().activePulses);
  h.change('attack-mode','continuous');
  assert.deepEqual(h.snapshot().activePulses,tails);
  assert.equal(h.node('pulse').dataset.attackState,'fading');
  assert.equal(h.node('attack-hint').textContent,'Disturbance fading');
  assert.equal(h.node('pulse')['aria-pressed'],'false');
});

test('legacy fixed data controls remain hidden and cannot pause the actual plant',async()=>{
  const h=harness();h.check('auto-compare',false);h.click('run');await h.samples(40);
  pointerClick(h,h.bus(7));await h.samples(2);pointerClick(h,h.bus(7));
  const physicalTime=h.snapshot().t;
  assert.equal(h.node('freeze').hidden,true);assert.equal(h.node('freeze').disabled,true);
  h.click('freeze');assert.equal(h.snapshot().mode,'running');assert.equal(h.state().playing,true);
  await h.samples(1);assert.equal(h.snapshot().t,physicalTime+1);
  assert.equal(h.node('pulse').dataset.attackState,'fading');
});

test('discovery exposes four executing controllers and cannot hide the last curve',async()=>{
  const h=harness();h.check('auto-compare',false);
  const all=['online','scalar','static','causal'];
  assert.deepEqual(h.comparison(),{active:all,plotted:all,sameSparseSupport:false});
  for(const key of all)assert.equal(h.seriesButton(key).hidden,false);
  assert.equal(h.node('cost-metric').hidden,false);assert.equal(h.node('cost-metric').value,'total');
  for(const key of ['online','scalar','static'])h.seriesButton(key).dispatch('click');
  assert.deepEqual(h.comparison().plotted,['causal']);
  h.seriesButton('causal').dispatch('click');assert.deepEqual(h.comparison().plotted,['causal']);
  assert.equal(h.seriesButton('causal')['aria-pressed'],'true');
  await compare(h);
  assert.deepEqual(h.comparison().active,all);assert.equal(h.node('deploy').disabled,false);
  assert.notEqual(h.snapshot().cumulative.online,h.snapshot().cumulative.static,'Matrix learning must affect executed discovery costs');
  assert.notEqual(h.snapshot().cumulative.scalar,h.snapshot().cumulative.static,'Scalar learning must affect executed discovery costs');
});

test('Compare controllers clears discovery attacks and schedules a fresh visible four controller trial',async()=>{
  const h=harness(),bus=h.bus(7);h.check('auto-compare',false);pointerClick(h,bus);await h.samples(40);
  assert.equal(h.snapshot().canDeploy,true);assert.equal(pulses(h).length,40);
  const discoveryOptions=plain(h.snapshot().initialOptions);
  for(const key of ['online','scalar','static'])h.seriesButton(key).dispatch('click');
  assert.deepEqual(h.comparison().plotted,['causal']);
  h.click('deploy');
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,0);assert.equal(h.state().playing,true);
  assert.equal(h.clock.tasks.size,1,'Exactly one playback timer must be scheduled');
  assert.ok(Object.values(h.snapshot().cumulative).every(value=>value===0));
  assert.equal(h.snapshot().eventLog.length,0);assert.equal(h.snapshot().pendingPulses.length,0);
  assert.equal(h.snapshot().activePulses.length,0);assert.equal(h.state().journal.length,0);
  assert.equal(h.node('pulse')['aria-pressed'],'false');assert.equal(h.node('cost-metric').hidden,false);
  assert.notEqual(h.snapshot().initialOptions.seed,discoveryOptions.seed,'Deployment uses an independent disturbance seed');
  assert.deepEqual(h.comparison().active,['online','scalar','static','causal']);
  assert.deepEqual(h.comparison().plotted,h.comparison().active);
  for(const key of h.comparison().active){assert.equal(h.seriesButton(key).hidden,false);assert.equal(h.seriesButton(key)['aria-pressed'],'true');}
  await h.samples(1);assert.equal(h.snapshot().t,1);assert.equal(pulses(h).length,0);
  assert.ok(Object.values(h.snapshot().cumulative).some(value=>value>0));
  await h.samples(3);assert.equal(pulses(h).length,0,'Continuous discovery attacks must not leak into the comparison');
  for(const key of ['online','scalar','static'])h.seriesButton(key).dispatch('click');
  assert.deepEqual(h.comparison().plotted,['causal']);
  h.seriesButton('causal').dispatch('click');assert.deepEqual(h.comparison().plotted,['causal']);
});

test('Learn again cancels comparison playback and attacks and restores the discovery cost view',async()=>{
  const h=harness();h.check('auto-compare',false);await compare(h);h.click('deploy');h.change('cost-metric','gap');
  pointerClick(h,h.bus(14));await h.samples(3);assert.ok(pulses(h).length>0);
  h.click('deploy');
  assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,0);assert.equal(h.state().playing,false);
  assert.equal(h.clock.tasks.size,0);assert.equal(h.node('pulse')['aria-pressed'],'false');
  assert.equal(h.snapshot().eventLog.length,0);assert.equal(h.snapshot().activePulses.length,0);
  assert.deepEqual(h.comparison().active,['online','scalar','static','causal']);assert.deepEqual(h.comparison().plotted,['online','scalar','static','causal']);
  assert.equal(h.node('cost-metric').hidden,false);assert.equal(h.node('cost-metric').value,'total');
  assert.equal(h.node('deploy').textContent,'Compare controllers');assert.equal(h.node('deploy').disabled,true);
  await h.samples(3);assert.equal(h.snapshot().t,0);
});

test('comparison gap measure survives saved replay without resuming playback or changing costs',async()=>{
  const h=harness();h.check('auto-compare',false);await compare(h);h.click('deploy');await h.samples(5);h.change('cost-metric','gap');
  const saved=h.saved();assert.equal(saved.privateContent.version,13);assert.equal(saved.privateContent.costMetric,'gap');
  const restored=harness(saved);
  assert.equal(restored.snapshot().phase,'deployment');assert.equal(restored.node('cost-metric').value,'gap');
  assert.equal(restored.node('cost-metric').hidden,false);assert.equal(restored.state().playing,false);
  assert.equal(restored.clock.tasks.size,0);assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(restored.snapshot().deployedSupport,h.snapshot().deployedSupport);
  assert.deepEqual(restored.comparison().active,['online','scalar','static','causal']);
  for(const value of [undefined,'invalid']){
    const legacy=plain(saved);if(value===undefined)delete legacy.privateContent.costMetric;else legacy.privateContent.costMetric=value;
    const old=harness(legacy);assert.equal(old.node('cost-metric').value,'total');assert.equal(old.state().playing,false);
    assert.deepEqual(old.snapshot().cumulative,h.snapshot().cumulative);
  }
  const discovery=harness({privateContent:{version:13,phase:'discovery',t:0,events:[],costMetric:'gap'}});
  assert.equal(discovery.node('cost-metric').value,'gap');assert.equal(discovery.node('cost-metric').hidden,false);
});

test('comparison reports measured costs without treating support equality as controller equality',async()=>{
  const h=harness();h.check('auto-compare',false);await compare(h);h.click('deploy');
  const support=h.snapshot().deployedSupport;
  assert.equal(h.comparison().sameSparseSupport,JSON.stringify(support.learned)===JSON.stringify(support.fixed));
  await h.samples(40);
  assert.notEqual(h.snapshot().cumulative.online,h.snapshot().cumulative.scalar,'Deployed learned weights must influence real costs');
  assert.ok(!h.summary().includes('curves coincide'));
  assert.match(h.summary(),/Matrix cost is|Matrix and scalar costs/);
  if(h.comparison().sameSparseSupport)assert.match(h.summary(),/Same links · Weights adapt independently/);
  h.click('deploy');assert.equal(h.comparison().sameSparseSupport,false);
});

test('automatic comparison keeps the four controller cost view visible during learning',()=>{
  const h=harness();
  assert.equal(h.node('auto-compare').checked,true);
  assert.equal(h.node('deploy').hidden,true);assert.equal(h.node('view').hidden,false);
  assert.equal(h.node('cost-content').hidden,false);assert.equal(h.node('learning-content').hidden,true);
  assert.equal(h.node('learning-title').textContent,'Controller comparison');
  assert.equal(h.node('phase').textContent,'Learning 0 / 180 s');
  h.change('view','learning');assert.equal(h.node('cost-content').hidden,true);assert.equal(h.node('learning-content').hidden,false);
  assert.equal(h.node('learning-title').textContent,'Forecast learning');assert.equal(h.node('freeze').hidden,true);
  h.change('view','cost');h.check('auto-compare',false);
  assert.equal(h.node('deploy').hidden,false);assert.equal(h.node('cost-content').hidden,false);
  assert.equal(h.saved().privateContent.automaticComparison,false);
});

test('playback hands off exactly after 180 discovery samples and starts comparison costs at zero',async()=>{
  const h=harness();h.click('run');await h.samples(178);
  assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,179);
  assert.ok(h.snapshot().cumulative.static>0);assert.equal(h.node('cost-content').hidden,false);
  const learningSeed=h.snapshot().initialOptions.seed;
  await h.samples(1);
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,0);
  assert.equal(h.snapshot().discoveryRecord.t,180);
  assert.ok(Object.values(h.snapshot().cumulative).every(value=>value===0));
  assert.notEqual(h.snapshot().initialOptions.seed,learningSeed);
  assert.equal(h.snapshot().eventLog.length,0);assert.equal(h.state().journal.length,0);
  assert.equal(h.state().playing,true);assert.equal(h.clock.tasks.size,1);
  assert.deepEqual(h.comparison().active,['online','scalar','static','causal']);
  assert.equal(h.node('cost-content').hidden,false);assert.equal(h.node('learning-content').hidden,true);
  assert.equal(h.node('deploy').textContent,'Learn again');assert.equal(h.node('deploy').hidden,false);
  assert.equal(h.saved().privateContent.phase,'deployment');assert.equal(h.saved().privateContent.t,0);
  await h.samples(2);assert.equal(h.snapshot().t,2);assert.ok(h.snapshot().cumulative.static>0);
});

test('held and continuous attacks survive the automatic handoff with one fresh pulse and no old tails',async()=>{
  for(const mode of ['pulse','continuous']){
    const h=harness(),bus=h.bus(7);h.change('attack-mode',mode);
    if(mode==='pulse')h.pointer('pointerdown',bus,{pointerId:61});else pointerClick(h,bus,61);
    await h.samples(179);assert.equal(h.snapshot().t,179);assert.ok(h.snapshot().activePulses.length>1);
    await h.samples(1);
    assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,0);
    assert.equal(h.node('pulse')['aria-pressed'],'true');
    assert.equal(h.node('pulse').dataset.attackState,mode==='pulse'?'held':'continuous');
    assert.equal(h.node('attack-hint').textContent,mode==='pulse'?'Release to stop':'Repeats until stopped');
    assert.equal(h.snapshot().activePulses.length,0,'The comparison plant must not inherit discovery pulse tails');
    assert.equal(h.snapshot().pendingPulses.length,1);assert.equal(pulses(h).length,1);
    assert.deepEqual(pulses(h).map(event=>[event.t,event.bus]),[[0,7]]);
    assert.deepEqual(h.state().journal,[{t:0,type:'pulse',bus:7,strength:100}]);
    assert.ok(Object.values(h.snapshot().cumulative).every(value=>value===0));
    if(mode==='pulse'){
      assert.equal(bus.dataset.holding,'true');assert.equal(bus.hasPointerCapture(61),true);
    }else assert.equal(h.node('pulse-label').textContent,'Stop attack');
    await h.samples(1);assert.equal(h.snapshot().t,1);assert.equal(pulses(h).length,1);
    await h.samples(1);assert.equal(h.snapshot().t,2);assert.deepEqual(pulses(h).map(event=>event.t),[0,1]);
    if(mode==='pulse')h.pointer('pointerup',bus,{pointerId:61});else pointerClick(h,bus,62);
    await h.samples(2);assert.equal(pulses(h).length,2);assert.equal(h.snapshot().t,4);
    assert.equal(h.state().playing,true);
    assert.equal(h.node('pulse').dataset.attackState,'fading');
  }
});

test('pausing after automatic handoff clears continuous attack intent and resume never reactivates it',async()=>{
  const h=harness();pointerClick(h,h.bus(14));await h.samples(180);
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().pendingPulses.length,1);
  h.click('run');assert.equal(h.state().playing,false);assert.equal(h.node('pulse')['aria-pressed'],'false');
  const events=pulses(h).length;
  h.click('run');await h.samples(3);
  assert.equal(h.snapshot().t,4);assert.equal(pulses(h).length,events);
});

test('Step can finish discovery and enter comparison while remaining paused',()=>{
  const h=harness();for(let sample=0;sample<179;sample++)h.click('step');
  assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,179);
  h.click('step');
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,0);
  assert.equal(h.state().playing,false);assert.equal(h.clock.tasks.size,0);
  assert.equal(h.snapshot().pendingPulses.length,0);
  h.click('step');assert.equal(h.snapshot().t,1);assert.equal(h.state().playing,false);assert.equal(h.clock.tasks.size,0);
});

test('Advance 180 counts physical samples across the automatic boundary and remains paused',async()=>{
  const h=harness();for(let sample=0;sample<130;sample++)h.click('step');
  await compare(h);
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().discoveryRecord.t,180);
  assert.equal(h.snapshot().t,130,'50 discovery and 130 comparison samples must total exactly 180');
  assert.equal(h.state().playing,false);assert.equal(h.clock.tasks.size,0);
  assert.match(h.node('event').textContent,/Learning complete.*t = 130 s/);
  await compare(h);assert.equal(h.snapshot().t,310);
  assert.match(h.node('event').textContent,/180 samples added.*t = 310 s/);
});

test('Advance 180 preserves an already continuous attack across handoff and resumes exactly one timer',async()=>{
  const h=harness(),bus=h.bus(7);pointerClick(h,bus);await h.samples(40);
  assert.equal(h.clock.tasks.size,1);assert.equal(pulses(h).length,40);
  await compare(h);
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().discoveryRecord.t,180);
  assert.equal(h.snapshot().t,40);assert.equal(pulses(h).length,40);
  assert.deepEqual(pulses(h).map(event=>event.t),Array.from({length:40},(_,i)=>i));
  assert.ok(pulses(h).every(event=>event.bus===7));
  assert.equal(h.node('pulse-label').textContent,'Stop attack');
  assert.equal(h.state().playing,true);assert.equal(h.clock.tasks.size,1);
  await h.samples(1);assert.equal(h.snapshot().t,41);assert.equal(pulses(h).length,41);
  pointerClick(h,bus);await h.samples(2);
  assert.equal(h.snapshot().t,43);assert.equal(pulses(h).length,41);
  assert.equal(h.node('pulse')['aria-pressed'],'false');
  assert.equal(h.state().playing,true);assert.equal(h.clock.tasks.size,1);
});

test('Learn again retains the automatic preference and returns to paused controller costs',async()=>{
  const h=harness();await compare(h);
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,0);
  pointerClick(h,h.bus(7));await h.samples(2);h.click('deploy');
  assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,0);
  assert.equal(h.node('auto-compare').checked,true);assert.equal(h.node('deploy').hidden,true);
  assert.equal(h.node('cost-content').hidden,false);assert.equal(h.node('learning-content').hidden,true);
  assert.equal(h.state().playing,false);assert.equal(h.clock.tasks.size,0);
  assert.equal(h.node('pulse')['aria-pressed'],'false');assert.equal(h.snapshot().pendingPulses.length,0);
});

test('saved discovery replays past the automatic threshold exactly and transitions only on a new sample',async()=>{
  const h=harness();h.check('auto-compare',false);await compare(h);h.click('step');
  const legacy=plain(h.saved());delete legacy.privateContent.automaticComparison;
  const restored=harness(legacy);
  assert.equal(restored.node('auto-compare').checked,true);assert.equal(restored.snapshot().phase,'discovery');
  assert.equal(restored.snapshot().t,181);assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);assert.equal(restored.state().playing,false);
  assert.equal(restored.saved(),undefined,'Restoration must not mutate or replace a historical trial');
  restored.click('step');assert.equal(restored.snapshot().phase,'deployment');assert.equal(restored.snapshot().t,1);
  assert.equal(restored.snapshot().discoveryRecord.t,181);assert.equal(restored.state().playing,false);
});

test('pending requests survive legacy discovery handoff without copying applied pulse tails',async()=>{
  const h=harness();h.check('auto-compare',false);await compare(h);h.change('attack-mode','pulse');
  h.quickClick();await h.samples(1);h.quickClick();h.click('run');
  assert.ok(h.snapshot().activePulses.length>0);assert.equal(h.snapshot().pendingPulses.length,1);
  const legacy=plain(h.saved());delete legacy.privateContent.automaticComparison;
  const restored=harness(legacy);assert.equal(restored.snapshot().pendingPulses.length,1);
  restored.click('run');
  assert.equal(restored.snapshot().phase,'deployment');assert.equal(restored.snapshot().t,1);
  assert.deepEqual(pulses(restored).map(event=>[event.t,event.bus]),[[0,7]]);
  assert.equal(restored.snapshot().activePulses.length,1);assert.equal(restored.snapshot().pendingPulses.length,0);
  await restored.samples(2);assert.equal(pulses(restored).length,1);
});

test('automatic handoff does not duplicate a same bus request queued at the legacy boundary',async()=>{
  const h=harness();h.check('auto-compare',false);await compare(h);
  h.check('auto-compare',true);pointerClick(h,h.bus(8));
  assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().pendingPulses.length,1);
  await h.samples(1);
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,1);
  assert.equal(pulses(h).length,1);assert.equal(h.snapshot().activePulses.length,1);
  assert.deepEqual(h.state().journal,[{t:0,type:'pulse',bus:8,strength:100}]);
  await h.samples(1);assert.deepEqual(pulses(h).map(event=>event.t),[0,1]);
});

test('hidden diagnostic controls cannot defer the automatic comparison transition',async()=>{
  const h=harness();h.check('auto-compare',false);await compare(h);
  h.click('freeze');assert.equal(h.snapshot().mode,'running');
  h.check('auto-compare',true);const restored=harness(h.saved());
  assert.equal(restored.snapshot().phase,'discovery');assert.equal(restored.snapshot().mode,'running');
  restored.click('step');assert.equal(restored.snapshot().phase,'deployment');assert.equal(restored.snapshot().t,1);
  assert.equal(restored.state().playing,false);assert.equal(restored.clock.tasks.size,0);
});


test('communication starts in learning and preserves the chosen noise across reset and learn again',async()=>{
  assert.match(html,/<option value="communication" selected>/);
  const h=harness(undefined,'communication');
  assert.equal(h.snapshot().experiment,'communication');assert.equal(h.snapshot().beta,1);assert.equal(h.snapshot().horizon,180);
  assert.equal(h.node('view').value,'learning');assert.equal(h.node('noise-control').hidden,false);
  assert.equal(h.node('preset-control').hidden,true);
  h.change('noise',2);assert.equal(h.snapshot().beta,2);assert.equal(h.snapshot().t,0);
  await compare(h);assert.equal(h.snapshot().phase,'deployment');assert.equal(h.node('view').value,'cost');
  assert.equal(h.node('view').hidden,true);assert.equal(h.snapshot().calibration.updates,0);
  h.click('restart');assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().beta,2);
  h.click('deploy');assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().beta,2);
  assert.equal(h.node('view').value,'learning');assert.equal(h.node('experiment').value,'communication');
});

test('communication comparison keeps all policies and reports actual gains or losses against both references',async()=>{
  const h=harness(undefined,'communication');await compare(h);h.click('run');await h.samples(15);h.click('run');
  assert.deepEqual(h.comparison().active,['online','scalar','static','causal']);
  assert.deepEqual(h.comparison().plotted,['online','scalar','static','causal']);
  assert.match(h.summary(),/fixed sparse/);assert.match(h.summary(),/dense prediction/);
  const c=h.snapshot().cumulative;
  for(const [reference,label] of [['scalar','fixed sparse'],['static','dense prediction']]){
    const percent=100*(c.online-c[reference])/c[reference];
    if(Math.abs(percent)>.05)assert.match(h.summary(),new RegExp((percent<0?'lower':'higher')+' than '+label));
  }
  assert.deepEqual(h.shownReference().sort(),h.snapshot().deployedSupport.fixedLinks.map(e=>e.to+','+e.from).sort());
  assert.equal(h.seriesButton('online').children.at(-1).textContent,'Learned sparse');
  assert.equal(h.seriesButton('scalar').children.at(-1).textContent,'Fixed sparse');
});

test('continuous attacks survive communication handoff and saved trial replays paused with frozen control',async()=>{
  const h=harness(undefined,'communication');h.change('noise',2);h.change('intervention','power');
  const bus=h.bus(23);pointerClick(h,bus);await h.samples(185);h.click('run');
  assert.equal(h.snapshot().phase,'deployment');assert.ok(h.snapshot().eventLog.filter(e=>e.type==='pulse').length>=5);
  h.change('cost-metric','gap');const saved=h.saved(),r=harness(saved,'communication');
  assert.equal(r.snapshot().experiment,'communication');assert.equal(r.snapshot().beta,2);
  assert.equal(r.node('noise').value,'2');assert.equal(r.node('cost-metric').value,'gap');
  assert.equal(r.state().playing,false);assert.equal(r.snapshot().calibration.updates,0);
  assert.deepEqual(r.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(r.snapshot().deployedSupport,h.snapshot().deployedSupport);
});

test('switching experiments resets the trial without carrying topology or attack state',async()=>{
  const h=harness(undefined,'communication');pointerClick(h,h.bus(7));await h.samples(3);
  h.change('experiment','prediction');assert.equal(h.snapshot().experiment,'prediction');
  assert.equal(h.snapshot().t,0);assert.equal(h.state().playing,false);assert.equal(h.node('noise-control').hidden,true);
  assert.equal(h.node('preset-control').hidden,false);assert.equal(h.node('view').value,'cost');
  h.change('preset','uniform');assert.equal(h.snapshot().preset,'uniform');
  h.change('experiment','communication');assert.equal(h.snapshot().preset,'mixed');assert.equal(h.snapshot().beta,1);
  assert.equal(h.snapshot().deployedSupport,null);assert.equal(h.node('view').value,'learning');
});


const forecastEvents=h=>h.snapshot().eventLog.filter(event=>event.type==='forecast');

test('new sessions default to the relevant bus interaction and hide irrelevant controls',()=>{
  const communication=harness(undefined,'communication'),prediction=harness();
  assert.equal(communication.node('intervention').value,'forecast');
  assert.equal(communication.node('attack-mode').hidden,true);assert.equal(communication.node('strength').hidden,true);
  assert.equal(prediction.node('intervention').value,'power');
  assert.equal(prediction.node('attack-mode').hidden,false);assert.equal(prediction.node('strength').hidden,false);
  assert.match(communication.node('pulse-label').textContent,/Corrupt bus 7/);
});

test('forecast bus pointer gesture toggles once and never creates a power pulse',async()=>{
  const h=harness(undefined,'communication'),bus=h.bus(7);
  assert.equal(h.snapshot().faults.includes(7),false);
  pointerClick(h,bus);assert.equal(h.snapshot().faults.includes(7),true);
  assert.equal(forecastEvents(h).length,1);assert.equal(pulses(h).length,0);
  assert.equal(h.snapshot().pendingPulses.length,0);assert.equal(h.snapshot().activePulses.length,0);
  assert.equal(h.snapshot().t,0);assert.equal(h.state().playing,true);
  assert.equal(h.state().selectedBus,7);assert.equal(h.node('pulse-label').textContent,'Repair bus 7');
  await h.samples(6);assert.equal(forecastEvents(h).length,1);assert.equal(pulses(h).length,0);
  pointerClick(h,bus);assert.equal(h.snapshot().faults.includes(7),false);
  assert.equal(forecastEvents(h).length,2);assert.equal(h.node('pulse-label').textContent,'Corrupt bus 7');
  assert.ok(Object.values(h.snapshot().cumulative).every(Number.isFinite));
});

test('forecast Enter, Space and D toggle once despite key repeats and key release',async()=>{
  for(const key of ['Enter',' ','d']){
    const h=harness(undefined,'communication'),bus=h.bus(7);
    if(key==='d') {h.key('keydown',key);h.key('keydown',key,{repeat:true});}
    else {bus.dispatch('keydown',{key});bus.dispatch('keydown',{key,repeat:true});}
    await h.samples(4);
    if(key==='d')h.key('keyup',key);else bus.dispatch('keyup',{key});
    assert.equal(forecastEvents(h).length,1,key);assert.equal(h.snapshot().faults.includes(7),true,key);
    assert.equal(pulses(h).length,0,key);assert.equal(h.node('pulse').dataset.holding,'false',key);
    if(key==='d')h.key('keydown',key);else bus.dispatch('keydown',{key});
    assert.equal(forecastEvents(h).length,2,key);assert.equal(h.snapshot().faults.includes(7),false,key);
  }
});

test('forecast primary action and assistive click toggle the selected bus without power requests',()=>{
  const h=harness(undefined,'communication');h.change('bus',14);
  h.quickClick();assert.equal(h.snapshot().faults.includes(14),true);assert.equal(forecastEvents(h).length,1);
  h.click('pulse',0);assert.equal(h.snapshot().faults.includes(14),false);assert.equal(forecastEvents(h).length,2);
  assert.equal(pulses(h).length,0);assert.equal(h.node('attack-mode').hidden,true);
});

test('switching interaction ends continuous power requests and preserves physical tails and costs',async()=>{
  const h=harness(undefined,'communication');h.change('intervention','power');
  pointerClick(h,h.bus(23));await h.samples(4);
  const before=h.snapshot(),count=pulses(h).length;
  h.change('intervention','forecast');
  assert.equal(h.node('pulse').dataset.holding,'false');assert.equal(h.node('attack-mode').hidden,true);
  assert.deepEqual(h.snapshot().cumulative,before.cumulative);assert.deepEqual(h.snapshot().activePulses,before.activePulses);
  await h.samples(4);assert.equal(pulses(h).length,count);assert.ok(h.snapshot().activePulses.length>0);
  pointerClick(h,h.bus(7));assert.equal(forecastEvents(h).length,1);assert.equal(pulses(h).length,count);
  assert.equal(h.powerContext(),'Includes load recovery · Clicked power disturbances are not forecast');
  h.change('intervention','power');assert.equal(h.node('attack-mode').hidden,false);
  pointerClick(h,h.bus(23));await h.samples(2);assert.ok(pulses(h).length>count);
});

test('forecast interaction save restores the exact paused trial and selected action',async()=>{
  const h=harness(undefined,'communication');pointerClick(h,h.bus(7));await h.samples(45);
  pointerClick(h,h.bus(12));await h.samples(5);h.click('run');
  const saved=h.saved(),r=harness(saved);
  assert.equal(saved.privateContent.version,13);assert.equal(saved.privateContent.intervention,'forecast');
  assert.equal(r.node('intervention').value,'forecast');assert.equal(r.node('attack-mode').hidden,true);
  assert.deepEqual(r.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(r.snapshot().states,h.snapshot().states);assert.deepEqual(r.snapshot().faults,h.snapshot().faults);
  assert.deepEqual(r.snapshot().eventLog,h.snapshot().eventLog);assert.equal(r.state().playing,false);
  assert.equal(pulses(r).length,0);assert.equal(r.powerContext(),'');
});

test('forecast source settings survive automatic comparison and deployed replay',async()=>{
  const h=harness(undefined,'communication');pointerClick(h,h.bus(7));
  await h.samples(185);h.click('run');
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().faults.includes(7),true);
  assert.equal(h.node('intervention').value,'forecast');assert.equal(pulses(h).length,0);
  assert.equal(h.snapshot().calibration.updates,0);assert.equal(h.node('view').value,'cost');
  const r=harness(h.saved());assert.equal(r.node('intervention').value,'forecast');
  assert.deepEqual(r.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(r.snapshot().deployedSupport,h.snapshot().deployedSupport);
  assert.deepEqual(r.snapshot().faults,h.snapshot().faults);assert.equal(r.state().playing,false);
});

test('reliability changes leave deployed links fixed and Learn again retains the current source map',async()=>{
  const h=harness(undefined,'communication');await compare(h);
  const support=plain(h.snapshot().deployedSupport.learned);
  pointerClick(h,h.bus(7));assert.equal(h.snapshot().faults.includes(7),true);
  assert.match(h.node('event').textContent,/Links remain fixed/);
  await h.samples(4);assert.deepEqual(h.snapshot().deployedSupport.learned,support);
  const currentFaults=plain(h.snapshot().faults);
  h.click('deploy');assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,0);
  assert.deepEqual(h.snapshot().faults,currentFaults);assert.equal(h.node('intervention').value,'forecast');
  assert.equal(h.snapshot().deployedSupport,null);assert.equal(h.state().playing,false);
});

test('zero noise forecast configuration is explicit and never claims active corruption',()=>{
  const h=harness(undefined,'communication');h.change('noise',0);pointerClick(h,h.bus(7));
  assert.equal(h.snapshot().faults.includes(7),true);assert.equal(pulses(h).length,0);
  assert.equal(h.node('pulse').dataset.attackState,'quiet');
  assert.match(h.node('attack-hint').textContent,/No noise at β 0/);
  assert.match(h.node('pulse').title,/disabled at β 0/);assert.match(h.node('event').textContent,/No noise at β 0/);
});


test('switching cost quantities during playback clears stale readings without changing the experiment',async()=>{
  const h=harness(undefined,'communication');h.click('run');await h.samples(20);
  const initial=h.snapshot(),tasks=h.clock.tasks.size;
  for(const metric of ['gap','total','gap','total']){
    h.node('tooltip').style.display='block';h.pin('pr-cost');h.change('cost-metric',metric);
    assert.equal(h.pin(),null,'Pinned values from the former quantity must be dismissed');
    assert.equal(h.node('tooltip').style.display,'none');
    assert.equal(h.state().playing,true);assert.equal(h.clock.tasks.size,tasks);
    assert.equal(h.snapshot().t,initial.t);assert.deepEqual(h.snapshot().cumulative,initial.cumulative);
  }
  await h.samples(2);assert.equal(h.snapshot().t,initial.t+2);
});

test('sample paths and latest markers use the current scale immediately when quantity and sample count change',()=>{
  const h=harness(undefined,'prediction',false),selections=new Map();
  function selection(selector){
    if(selections.has(selector))return selections.get(selector);
    const value={dataValues:[],attributes:new Map(),interruptions:[],
      data(values){this.dataValues=values;return this;},join(){return this;},order(){return this;},remove(){return this;},
      attr(name,value){this.attributes.set(name,this.dataValues.map(item=>typeof value==='function'?value(item):value));return this;},
      interrupt(name){this.interruptions.push(name??'default');return this;},
      transition(){assert.fail('Measured curves must not morph between incompatible scales');}
    };selections.set(selector,value);return value;
  }
  const items=[{key:'online',color:'blue'},{key:'scalar',color:'purple'}];
  const chart={marks:{selectAll:selection},x:value=>value*10,y:value=>100-value*20};
  h.drawSeries(chart,[{x:0,online:0,scalar:0},{x:1,online:2,scalar:3}],items,true);
  assert.deepEqual(plain(selection('path.data-series').attributes.get('d')),['M0,100L10,40','M0,100L10,60']);
  // The next frame has both a different quantity and an extra measured sample.
  const gapChart={...chart,y:value=>50-value*30};
  h.drawSeries(gapChart,[{x:0,online:0,scalar:0},{x:1,online:-1,scalar:0},{x:2,online:-2,scalar:0}],items,true);
  assert.deepEqual(plain(selection('path.data-series').attributes.get('d')),['M0,50L10,50L20,50','M0,50L10,80L20,110']);
  assert.deepEqual(plain(selection('circle.latest-value').attributes.get('cy')),[50,110]);
  assert.ok(selection('path.data-series').interruptions.includes('update'));
  assert.ok(selection('circle.latest-value').interruptions.includes('update'));
});


test('touch clicks with zero detail do not toggle a forecast twice after pointer activation',()=>{
  const h=harness(undefined,'communication'),bus=h.bus(7);
  function touchTap(id){
    h.pointer('pointerdown',bus,{pointerId:id,pointerType:'touch'});
    bus.dispatch('gotpointercapture',{pointerId:id,pointerType:'touch'});
    // Pointer release delivers lostpointercapture before the synthesized click.
    h.pointer('pointerup',bus,{pointerId:id,pointerType:'touch'});
    bus.dispatch('click',{detail:0,pointerId:id,pointerType:'touch'});
  }
  touchTap(41);
  assert.equal(h.snapshot().faults.includes(7),true);assert.equal(forecastEvents(h).length,1);
  touchTap(42);
  assert.equal(h.snapshot().faults.includes(7),false);assert.equal(forecastEvents(h).length,2);
  // Assistive and keyboard clicks have no pointer source and remain supported.
  bus.dispatch('click',{detail:0,pointerType:''});
  assert.equal(h.snapshot().faults.includes(7),true);assert.equal(forecastEvents(h).length,3);
  bus.dispatch('click',{detail:0});
  assert.equal(h.snapshot().faults.includes(7),false);assert.equal(forecastEvents(h).length,4);
});

test('zero detail touch clicks preserve a latched power attack until the next tap',async()=>{
  const h=harness(undefined,'communication');h.change('intervention','power');const bus=h.bus(23);
  const tap=id=>{
    h.pointer('pointerdown',bus,{pointerId:id,pointerType:'touch'});
    h.pointer('pointerup',bus,{pointerId:id,pointerType:'touch'});
    bus.dispatch('click',{detail:0,pointerId:id,pointerType:'touch'});
  };
  tap(51);assert.equal(h.node('pulse')['aria-pressed'],'true');
  await h.samples(3);assert.equal(pulses(h).length,3);
  tap(52);assert.equal(h.node('pulse')['aria-pressed'],'false');
  const count=pulses(h).length;await h.samples(2);assert.equal(pulses(h).length,count);
});

test('prediction link inspection uses current support without changing plant or forecast state',async()=>{
  const h=harness(undefined,'communication');
  const verify=()=>{
    const before=plain(h.snapshot());
    const edge=before.recommendations.find(edge=>edge.from!==edge.to);
    assert.ok(edge,'Actual candidate or deployed support exists');
    h.inspectLink(edge.to,edge.from);
    assert.deepEqual(h.inspection(),{source:edge.from,receiver:edge.to,local:false,connected:true,
      label:'Source bus '+edge.from+' → inverter '+edge.to+' · Selected link · '+(before.phase==='deployment'?'Deployed':'Candidate')});
    const absent=Array.from({length:23},(_,i)=>i+2).find(bus=>bus!==edge.to&&!before.recommendations.some(e=>e.to===edge.to&&e.from===bus));
    h.inspectLink(edge.to,absent);
    assert.equal(h.inspection().connected,false,'An absent source must not fabricate a link');
    h.inspectLink(edge.to,edge.to);
    assert.equal(h.inspection().local,true);
    assert.equal(h.inspection().connected,true);
    assert.deepEqual(plain(h.snapshot()),before,'Inspection cannot change samples, faults, controls or deployed support');
    assert.equal(h.state().playing,false,'Inspection cannot start playback');
    assert.equal(h.state().journal.length,0,'Inspection cannot inject interventions');
  };
  verify();
  h.check('auto-compare',false);await compare(h);h.click('deploy');h.click('run');
  assert.equal(h.snapshot().phase,'deployment');
  verify();
  h.change('bus',2);
  assert.equal(h.inspection(),null,'Selecting a nonreceiver clears stale inspection');
});

test('inspected source action toggles reliability without selecting the receiver as the fault target',()=>{
  const h=harness(undefined,'communication');h.inspectLink(5,7);
  const before=plain(h.snapshot());
  assert.equal(h.node('source-controls').hidden,false);assert.equal(h.node('source-fault').textContent,'Corrupt source 7');
  h.click('source-fault');
  assert.equal(h.state().selectedBus,5);assert.equal(h.state().inspectedSource,7);
  assert.equal(h.state().playing,false);assert.equal(h.snapshot().t,before.t);
  assert.deepEqual(plain(h.snapshot().faults),before.faults.concat(7).sort((a,b)=>a-b));
  assert.deepEqual(plain(h.snapshot().cumulative),before.cumulative);
  assert.deepEqual(plain(h.snapshot().states),before.states);
  assert.deepEqual(plain(h.snapshot().pendingPulses),before.pendingPulses);
  assert.equal(h.state().journal.at(-1).bus,7);assert.equal(h.state().journal.at(-1).type,'fault');
  assert.equal(h.node('source-fault').textContent,'Repair source 7');
  const restored=harness(h.saved());
  assert.equal(restored.state().selectedBus,5);assert.equal(restored.state().inspectedSource,7);
  assert.deepEqual(restored.snapshot().faults,h.snapshot().faults);
  assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
  assert.deepEqual(restored.snapshot().states,h.snapshot().states);
  restored.click('source-fault');assert.deepEqual(plain(restored.snapshot().faults),before.faults);
  assert.equal(restored.state().playing,false);
});

test('inspected reliability action changes only newly issued forecasts at its source',()=>{
  const changed=harness(undefined,'communication'),reference=harness(undefined,'communication');
  for(const h of [changed,reference]) {h.click('step');h.inspectLink(5,7);}
  const issued=changed.issuedForecasts();assert.ok(issued.length>0);
  changed.click('source-fault');
  assert.deepEqual(changed.issuedForecasts(),issued,'Already issued forecasts cannot be rewritten');
  for(let i=0;i<7;i++) {changed.click('step');reference.click('step');}
  const actual=changed.issuedForecasts(),control=reference.issuedForecasts();
  assert.equal(actual.length,control.length);
  let different=0;
  for(let i=0;i<actual.length;i++) {
    assert.deepEqual(actual[i].base,control[i].base,'Physical disturbance generator stays paired');
    for(let j=0;j<24;j++) {
      if(j===6&&i>=issued.length) {if(actual[i].forecast[j]!==control[i].forecast[j])different++;}
      else assert.equal(actual[i].forecast[j],control[i].forecast[j],'Other sources and issued forecasts stay identical');
    }
  }
  assert.ok(different>0,'Future source 7 forecasts actually change');
});

test('inspected source action preserves deployed support, replay and Learn again reliability',async()=>{
  const h=harness(undefined,'communication');h.check('auto-compare',false);await compare(h);h.click('deploy');h.click('run');
  h.inspectLink(5,7);
  const before=plain(h.snapshot());h.click('source-fault');
  assert.deepEqual(plain(h.snapshot().deployedSupport),before.deployedSupport);
  assert.deepEqual(plain(h.snapshot().predictionDiagnostics),before.predictionDiagnostics);
  assert.deepEqual(plain(h.snapshot().cumulative),before.cumulative);
  assert.deepEqual(plain(h.snapshot().states),before.states);
  assert.match(h.node('source-status').textContent,/Links fixed/);
  const restored=harness(h.saved());
  assert.equal(restored.state().inspectedSource,7);
  assert.deepEqual(restored.snapshot().deployedSupport,h.snapshot().deployedSupport);
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
  const faults=plain(h.snapshot().faults);
  h.click('deploy');assert.equal(h.snapshot().phase,'discovery');assert.deepEqual(plain(h.snapshot().faults),faults);
});

test('source actions cannot mutate reliability in saved history or with zero forecast noise',()=>{
  const h=harness(undefined,'communication');h.inspectLink(5,7);
  const before=plain(h.snapshot());h.event('topology-history','input');
  assert.equal(h.node('source-fault').disabled,true);h.click('source-fault');
  assert.deepEqual(plain(h.snapshot()),before);
  h.click('history-live');assert.equal(h.node('source-fault').disabled,false);
  h.change('noise',0);h.inspectLink(5,7);
  assert.equal(h.node('source-fault').disabled,true);const quiet=plain(h.snapshot());h.click('source-fault');
  assert.deepEqual(plain(h.snapshot()),quiet);
  h.change('bus',2);assert.equal(h.node('source-controls').hidden,true);
});

test('power scenario selection preserves exact replay and Learn again while keeping reference available',async()=>{
  const h=harness(undefined,'communication');
  assert.equal(h.snapshot().powerScenario,'reference');
  h.change('power-scenario','solar-outage');await compare(h);
  assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().powerScenario,'solar-outage');
  for(let i=0;i<55;i++)h.click('step');
  const restored=harness(h.saved());
  assert.equal(restored.node('power-scenario').value,'solar-outage');
  assert.deepEqual(restored.snapshot().states,h.snapshot().states);
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
  h.click('deploy');assert.equal(h.snapshot().powerScenario,'solar-outage');
  h.change('power-scenario','reference');assert.equal(h.snapshot().powerScenario,'reference');
  assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,0);assert.equal(h.state().playing,false);
});


test('source observation uses only the last revealed forcing pair with exact issue timing and replay',()=>{
  const h=harness(undefined,'communication');h.inspectLink(5,7);
  assert.equal(h.forecastObservation(),null);
  assert.equal(h.node('forecast-values').hidden,true);
  assert.match(h.node('forecast-timing').textContent,/Run or step/);
  for(let i=0;i<12;i++) {
    h.click('step');
    const snapshot=h.snapshot(),sample=snapshot.lastSample,issued=h.issuedForecasts()[sample.t];
    const expected={source:7,receiver:5,action:sample.t,issuedAt:issued.issuedAt,observedAt:snapshot.t,
      forecast:sample.forecast[6],realized:sample.disturbance[6],error:sample.forecast[6]-sample.disturbance[6]};
    assert.deepEqual(h.forecastObservation(),expected);
    assert.ok(expected.issuedAt<=expected.action&&expected.observedAt===expected.action+1);
    assert.equal(expected.forecast,issued.forecast[6]);
    assert.equal(h.node('forecast-observation').dataset.observedAt,String(snapshot.t));
    assert.equal(h.node('observed-error').textContent,(1000*expected.error).toFixed(3));
    assert.equal(h.state().playing,false);
  }
  const before=plain(h.snapshot()),observation=h.forecastObservation();
  h.inspectLink(5,14);assert.equal(h.forecastObservation().forecast,before.lastSample.forecast[13]);
  assert.deepEqual(plain(h.snapshot()),before,'Inspection never changes the experiment');
  h.inspectLink(5,7);
  const restored=harness(h.saved());
  assert.deepEqual(restored.forecastObservation(),observation,'Version 13 replay recreates the exact revealed observation');
});

test('source reliability toggles do not rewrite observed or already issued forecasts',()=>{
  const changed=harness(undefined,'communication'),reference=harness(undefined,'communication');
  for(const h of [changed,reference]){h.click('step');h.inspectLink(5,7);}
  const observation=changed.forecastObservation(),issued=changed.issuedForecasts();
  changed.click('source-fault');
  assert.deepEqual(changed.forecastObservation(),observation,'Current reliability is not retroactive');
  assert.deepEqual(changed.issuedForecasts(),issued);
  let observedDifference=false;
  for(let i=0;i<8;i++){
    changed.click('step');reference.click('step');
    const actual=changed.forecastObservation(),control=reference.forecastObservation();
    if(actual.action<issued.length)assert.equal(actual.forecast,control.forecast,'Sealed preview remains unchanged');
    else if(actual.forecast!==control.forecast)observedDifference=true;
    assert.ok(Math.abs(actual.realized-control.realized)<1e-12,'Only source reliability changed, not physical forcing');
  }
  assert.equal(observedDifference,true,'Changed source error becomes observable after the sealed preview');
});

test('source observation distinguishes dense discovery from frozen deployed support and saved history',async()=>{
  const h=harness(undefined,'communication');h.inspectLink(5,7);h.click('step');
  assert.match(h.node('forecast-support').textContent,/Discovery uses dense messages/);
  h.event('topology-history','input');
  assert.equal(h.forecastObservation(),null);assert.equal(h.node('forecast-values').hidden,true);
  assert.equal(h.node('forecast-observation').dataset.forecast,'','History must not carry stale current values');
  assert.match(h.node('forecast-timing').textContent,/Return to Latest/);
  h.click('history-live');assert.ok(h.forecastObservation());
  h.check('auto-compare',false);await compare(h);h.click('deploy');h.click('run');
  h.inspectLink(5,7);assert.equal(h.forecastObservation(),null,'Fresh comparison has no revealed samples');
  h.click('step');const snapshot=plain(h.snapshot());
  const edge=snapshot.recommendations.find(edge=>edge.from!==edge.to);
  h.inspectLink(edge.to,edge.from);assert.match(h.node('forecast-support').textContent,/Permitted by deployed support/);
  const absent=Array.from({length:23},(_,i)=>i+2).find(bus=>bus!==edge.to&&!snapshot.recommendations.some(e=>e.to===edge.to&&e.from===bus));
  h.inspectLink(edge.to,absent);assert.match(h.node('forecast-support').textContent,/Excluded from deployed support/);
  assert.equal(h.forecastObservation().forecast,snapshot.lastSample.forecast[absent-1],'Excluded source can be audited, not sent on a fabricated link');
  assert.deepEqual(plain(h.snapshot()),snapshot);
});
