'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {build,methods}=require('./build-reference-study.cjs');
const source=[path.join(__dirname,'..','benchmark-forecasted-scenario.json'),path.join(__dirname,'benchmark-forecasted-scenario.json')].find(file=>fs.existsSync(file));
const report=JSON.parse(fs.readFileSync(source,'utf8'));

test('Recorded view reproduces all four methods at every heldout error level',()=>{
  const html=build(report);
  assert.equal(html,fs.readFileSync(path.join(__dirname,'reference-study.html'),'utf8'));
  assert.equal((html.match(/data-study-method=/g)||[]).length,4);
  for(const method of methods){
    const group=html.split('data-study-method="'+method.key+'"')[1].split('data-study-method=')[0].split('</svg>')[0];
    for(const row of report.heldout)assert.ok(group.includes('data-beta="'+row.beta+'" data-ratio="'+row.means[method.key]/row.means.causal+'"'));
  }
  assert.match(html,/<details id="pr-reference-study" class="[^"]+">/);
  assert.ok(!html.includes(' open'));
  assert.match(html,/20 seeds per error level/);
  assert.match(html,/No clicked attacks/);
  assert.match(html,/Study costs include the terminal penalty/);
  assert.match(html,/Live curves show accumulated stage cost/);
});

test('All noisy ablation stays separate and preserves measured ratios',()=>{
  const html=build(report),ablation=report.allNoisyAblation;
  assert.match(html,/5 separate trials/);
  assert.equal((html.match(/data-ablation-method=/g)||[]).length,4);
  for(const method of methods)assert.ok(html.includes('data-ablation-method="'+method.key+'" data-ratio="'+ablation.means[method.key]/ablation.means.causal+'"'));
  assert.equal((html.match(/data-beta=/g)||[]).length,16,'Ablation is not added as a sweep point');
});

test('Recorded means cannot be silently changed independently of the seed evidence',()=>{
  const altered=JSON.parse(JSON.stringify(report));
  altered.heldout[0].means.online+=.01;
  assert.throws(()=>build(altered),/Recorded means match every seed/);
});
