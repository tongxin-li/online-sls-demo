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
const html=fs.readFileSync(path.join(__dirname,'interface.html'),'utf8');
const original=fs.readFileSync(path.join(__dirname,'interface.js'),'utf8');
const anchor="  announce('Ready');";
assert.equal(original.split(anchor).length,2,'Interface initialization anchor must be unique');
const source=original.replace(anchor,
  '  drawNetwork=drawMatrix=drawCost=drawStage=drawVoltage=drawConvergence=()=>{};\n'+anchor);
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
    getBoundingClientRect(){return {width:550};},
    setPointerCapture(id){this.capturedPointer=id;},
    closest(){return null;}
  };
}

function harness(saved) {
  const clock=new Clock(),nodes=new Map(),savedStates=[];
  for(const match of html.matchAll(/<(\w+)[^>]*\bid="(pr-[^"]+)"/g)){
    const node=target(match[1].toUpperCase());node.id=match[2];nodes.set(node.id,node);
  }
  for(const [id,value] of Object.entries({speed:'1',strength:'100',view:'cost','matrix-view':'change',preset:'mixed'}))nodes.get('pr-'+id).value=value;
  const root=target();root.querySelector=selector=>nodes.get(selector.slice(1));root.querySelectorAll=()=>[];
  const document=Object.assign(target(),{getElementById:()=>root,createElement:tag=>target(tag.toUpperCase()),createTextNode:text=>({textContent:text})});
  const window=Object.assign(target(),{d3,PowerDemo,matchMedia:()=>({matches:true}),
    openai:{widgetState:saved,setWidgetState:state=>{savedStates.push(plain(state));return Promise.resolve();}}});
  vm.runInNewContext(source,{window,document,PowerDemo,d3,console,
    performance:{now:()=>clock.now},setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,
    ResizeObserver:class{observe(){}},getComputedStyle:()=>({getPropertyValue:()=>''})},
    {filename:'interface.js'});
  const node=id=>nodes.get('pr-'+id);
  return {clock,document,window,node,snapshot:()=>root.powerDemo.getSnapshot(),state:()=>plain(root.powerDemo.getState()),
    saved:()=>savedStates.at(-1),
    event:(id,type,detail)=>node(id).dispatch(type,detail),
    click:(id,detail=0)=>node(id).dispatch('click',{detail}),
    change:(id,value)=>{node(id).value=String(value);return node(id).dispatch('change');},
    quickClick(){node('pulse').dispatch('pointerdown');node('pulse').dispatch('pointerup');node('pulse').dispatch('click',{detail:1});},
    key:(type,key,detail={})=>document.dispatch(type,{key,...detail})
  };
}
const pulses=h=>h.snapshot().eventLog.filter(event=>event.type==='pulse');

 test('pointer activation queues once and a paused attack starts playback without advancing time',async()=>{
  const h=harness();h.event('pulse','pointerdown');h.event('pulse','pointerup');h.click('pulse',1);
  assert.equal(pulses(h).length,1);assert.equal(h.snapshot().pendingPulses.length,1);
  assert.equal(h.snapshot().t,0);assert.equal(h.state().playing,true);
  await h.clock.advance(1000);assert.equal(h.snapshot().t,1);assert.equal(pulses(h).length,1);
  assert.equal(h.snapshot().activePulses.length,1);
});

test('holding Attack adds one pulse per physical sample and release preserves playback',async()=>{
  const h=harness();h.event('pulse','pointerdown');await h.clock.advance(3000);
  assert.equal(h.snapshot().t,3);assert.deepEqual(pulses(h).map(event=>event.t),[0,1,2]);
  assert.equal(h.node('pulse').dataset.holding,'true');
  h.event('pulse','pointerup');h.click('pulse',1);await h.clock.advance(2000);
  assert.equal(h.snapshot().t,5);assert.equal(pulses(h).length,3);assert.equal(h.state().playing,true);
  assert.equal(h.node('pulse').dataset.holding,'false');assert.ok(h.snapshot().activePulses.length>0);
});

test('D hold ignores keyboard repeats and keyup stops only new attacks',async()=>{
  const h=harness();h.key('keydown','d');h.key('keydown','d',{repeat:true});
  await h.clock.advance(4000);assert.deepEqual(pulses(h).map(event=>event.t),[0,1,2,3]);
  h.key('keyup','D');await h.clock.advance(2000);
  assert.equal(pulses(h).length,4);assert.equal(h.snapshot().t,6);assert.equal(h.state().playing,true);
});

test('quick clicks preserve every pending and active pulse and do not reset time',async()=>{
  const h=harness();for(let i=0;i<5;i++)h.quickClick();
  assert.equal(pulses(h).length,5);assert.equal(h.snapshot().pendingPulses.length,5);assert.equal(h.snapshot().t,0);
  await h.clock.advance(1000);assert.equal(h.snapshot().activePulses.length,5);
  h.quickClick();h.quickClick();assert.equal(h.snapshot().activePulses.length,5);assert.equal(h.snapshot().pendingPulses.length,2);
  await h.clock.advance(1000);assert.equal(h.snapshot().t,2);assert.equal(h.snapshot().activePulses.length,7);
  assert.deepEqual(pulses(h).map(event=>event.t),[0,0,0,0,0,1,1]);
});

test('pointer cancellation and window blur release attacks without pausing playback',async()=>{
  for(const kind of ['pointercancel','lostpointercapture','blur']){
    const h=harness();h.event('pulse','pointerdown');await h.clock.advance(1000);
    if(kind==='blur')h.window.dispatch(kind);else h.event('pulse',kind);
    await h.clock.advance(2000);assert.equal(pulses(h).length,1,kind);assert.equal(h.snapshot().t,3,kind);assert.equal(h.state().playing,true,kind);
  }
});

test('hidden document pauses playback and clears the hold',async()=>{
  const h=harness();h.key('keydown','d');await h.clock.advance(1000);
  h.document.hidden=true;h.document.dispatch('visibilitychange');await h.clock.advance(4000);
  assert.equal(h.snapshot().t,1);assert.equal(h.state().playing,false);assert.equal(h.node('pulse').dataset.holding,'false');
});

test('late timers do not burst through missed physical samples',async()=>{
  const h=harness();h.quickClick();h.clock.now=10000;await h.clock.runNext();
  assert.equal(h.snapshot().t,1);assert.ok(h.clock.next()[1].at>=10150);
  await h.clock.advance(149);assert.equal(h.snapshot().t,1);
  await h.clock.advance(1);assert.equal(h.snapshot().t,2);
});

test('attacks interleave safely with comparison batches and continue after the batch',async()=>{
  const h=harness();const comparison=h.click('compare');assert.equal(h.node('run').disabled,true);
  h.event('pulse','pointerdown');await h.clock.runNext();
  assert.equal(h.snapshot().t,12);assert.equal(pulses(h).length,12);
  h.event('pulse','pointerup');h.click('pulse',1);await h.clock.runNext();
  assert.equal(h.snapshot().t,24);assert.equal(pulses(h).length,12);
  h.event('pulse','pointerdown');await h.clock.until(()=>!h.node('compare').disabled);await comparison;
  assert.equal(h.snapshot().t,180);assert.equal(pulses(h).length,168);assert.equal(h.state().playing,true);
  assert.equal(new Set(pulses(h).map(event=>event.t)).size,168);
  await h.clock.advance(1000);assert.equal(h.snapshot().t,181);assert.equal(pulses(h).length,169);
  h.event('pulse','pointerup');await h.clock.advance(1000);assert.equal(h.snapshot().t,182);assert.equal(pulses(h).length,169);
});

test('matrix reference survives pulses, forecast changes and exact saved replay',async()=>{
  const h=harness();h.quickClick();const initialReference=h.saved().privateContent.matrixReference;
  await h.clock.advance(35000);h.click('reference');h.click('run');
  const reference=h.saved().privateContent.matrixReference;assert.equal(reference.t,35);
  assert.equal(initialReference.t,0);h.quickClick();h.click('fault');
  assert.deepEqual(h.saved().privateContent.matrixReference,reference);
  await h.clock.advance(3000);h.click('run');
  const restored=harness(h.saved());
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  assert.deepEqual(restored.snapshot().states,h.snapshot().states);
  assert.deepEqual(restored.snapshot().eventLog,h.snapshot().eventLog);
  assert.equal(restored.state().playing,false);
  restored.click('fault');assert.deepEqual(restored.saved().privateContent.matrixReference,reference);
});

test('deployment replay is exact and Learn again starts a fresh discovery trial',async()=>{
  const h=harness();const comparison=h.click('compare');await h.clock.until(()=>!h.node('compare').disabled);await comparison;
  assert.equal(h.snapshot().canDeploy,true);h.click('deploy');assert.equal(h.snapshot().phase,'deployment');assert.equal(h.snapshot().t,0);
  assert.equal(h.node('deploy').textContent,'Learn again');assert.equal(h.node('deploy').disabled,false);
  h.key('keydown','d');await h.clock.advance(3000);h.key('keyup','d');h.click('run');
  const restored=harness(h.saved());assert.equal(restored.snapshot().phase,'deployment');
  assert.deepEqual(restored.snapshot().deployedSupport,h.snapshot().deployedSupport);
  assert.deepEqual(restored.snapshot().cumulative,h.snapshot().cumulative);
  h.click('deploy');assert.equal(h.snapshot().phase,'discovery');assert.equal(h.snapshot().t,0);
  assert.equal(h.snapshot().deployedSupport,null);assert.equal(h.snapshot().eventLog.length,0);assert.equal(h.state().playing,false);
  assert.equal(h.node('matrix-view').value,'change');assert.equal(h.snapshot().preset,'mixed');
});

test('fixed slack rejects pointer and keyboard attacks',()=>{
  const h=harness();h.change('bus',1);h.event('pulse','pointerdown');h.click('pulse',0);h.key('keydown','d');
  assert.equal(pulses(h).length,0);assert.equal(h.state().playing,false);assert.equal(h.node('pulse').disabled,true);
});
