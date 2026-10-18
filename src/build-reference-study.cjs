'use strict';
// Static display of the recorded study. No simulation parameters are changed.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const source=[path.join(__dirname,'..','benchmark-forecasted-scenario.json'),path.join(__dirname,'benchmark-forecasted-scenario.json')].find(file=>fs.existsSync(file));
const methods=[
  {key:'online',label:'Learned sparse',color:'var(--viz-series-1)',dash:'',shape:'circle'},
  {key:'scalar',label:'Fixed sparse',color:'var(--viz-series-4)',dash:'7 3',shape:'diamond'},
  {key:'static',label:'Dense prediction',color:'var(--viz-series-2)',dash:'5 3 1 3',shape:'square'},
  {key:'causal',label:'Feedback only',color:'var(--viz-series-3)',dash:'1 4',shape:'circle'}
];
const f=value=>Number(value).toFixed(3);
const pct=value=>(value<0?'−':'')+Math.abs(value).toFixed(2)+'%';
function build(report=JSON.parse(fs.readFileSync(source,'utf8'))){
  assert.deepEqual(report.heldout.map(row=>row.beta),[0,1,2,4]);
  const expectedSeeds=report.independentSeedSets.heldout;
  assert.equal(expectedSeeds.length,20);
  for(const row of report.heldout){
    assert.deepEqual(row.runs.map(run=>run.seed),expectedSeeds);
    for(const method of methods){
      const mean=row.runs.reduce((sum,run)=>sum+run.costs[method.key],0)/row.runs.length;
      assert.ok(Math.abs(mean-row.means[method.key])<1e-12,'Recorded means match every seed');
    }
  }
  assert.equal(report.allNoisyAblation.runs.length,5);
  const regimes=[
    {id:'reliable',label:'Reliable forecasts',note:'β 0 · 20 paired seeds',row:report.heldout.find(row=>row.beta===0),comparison:'static'},
    {id:'mixed',label:'Mixed source reliability',note:'β 4 · 20 paired seeds',row:report.heldout.find(row=>row.beta===4),comparison:'causal'},
    {id:'corrupted',label:'All sources corrupted',note:'β 4 · 5 separate trials',row:report.allNoisyAblation}
  ];
  for(const regime of regimes)for(const method of methods){
    const mean=regime.row.runs.reduce((sum,run)=>sum+run.costs[method.key],0)/regime.row.runs.length;
    assert.ok(Math.abs(mean-regime.row.means[method.key])<1e-12,'Recorded regime means match every seed');
  }
  const ratioMax=Math.ceil(Math.max(...regimes.flatMap(regime=>methods.map(method=>regime.row.means[method.key]/regime.row.means.causal)))*2)/2;
  const overview=regimes.map(regime=>{
    const row=regime.row,min=Math.min(...methods.map(method=>row.means[method.key]));
    const winners=methods.filter(method=>Math.abs(row.means[method.key]-min)<1e-12).map(method=>method.label);
    const comparison=regime.comparison&&row.comparisons[regime.comparison];
    const uncertainty=comparison?'Learned vs '+methods.find(method=>method.key===regime.comparison).label.toLowerCase()+' · '+pct(comparison.learnedSavingsPercent)+' savings · 95% paired interval '+comparison.pairedBootstrap95Percent.map(pct).join(' to '):'Separate counterexample · No interval reported';
    return `<section class="pr-study-regime" data-regime="${regime.id}" data-winner="${winners.join('|')}" aria-labelledby="pr-regime-${regime.id}">
      <div class="pr-regime-heading"><h4 id="pr-regime-${regime.id}">${regime.label}</h4><span>${regime.note}</span></div>
      <p class="pr-regime-winner">Lowest mean <strong>${winners.join(' and ')}</strong></p>
      <dl class="pr-regime-costs">${methods.map(method=>{
        const ratio=row.means[method.key]/row.means.causal;
        return `<div class="pr-regime-row${Math.abs(row.means[method.key]-min)<1e-12?' is-winner':''}" data-regime-method="${method.key}" data-cost-ratio="${ratio}"${regime.id==='corrupted'?' data-ablation-method="'+method.key+'" data-ratio="'+ratio+'"':''}><dt>${method.label}</dt><dd><span class="pr-regime-track" aria-hidden="true"><i style="width:${ratio/ratioMax*100}%;background:${method.color}"></i></span><span class="pr-regime-value">${f(ratio)}×</span></dd></div>`;
      }).join('')}</dl>
      <p class="pr-regime-uncertainty">${uncertainty}</p>
    </section>`;
  }).join('');
  const x=beta=>42+beta*72,y=ratio=>181-(ratio-.6)*116.6666666667;
  const marker=(method,cx,cy)=>method.shape==='diamond'?`<path d="M${cx} ${cy-5}l5 5-5 5-5-5z" fill="white" stroke="${method.color}" stroke-width="1.7"/>`:method.shape==='square'?`<rect x="${cx-3}" y="${cy-3}" width="6" height="6" fill="white" stroke="${method.color}" stroke-width="1.7"/>`:`<circle cx="${cx}" cy="${cy}" r="${method.key==='online'?3.5:2.3}" fill="${method.key==='online'?method.color:'white'}" stroke="${method.color}" stroke-width="1.6"/>`;
  const curves=[...methods.slice(1),methods[0]].map(method=>{
    const points=report.heldout.map(row=>({beta:row.beta,ratio:row.means[method.key]/row.means.causal}));
    return `<g data-study-method="${method.key}"><path d="${points.map((point,i)=>(i?'L':'M')+x(point.beta)+' '+y(point.ratio)).join(' ')}" fill="none" stroke="${method.color}" stroke-width="${method.key==='online'?2.5:1.8}" stroke-dasharray="${method.dash}"/>${points.map(point=>`<g data-beta="${point.beta}" data-ratio="${point.ratio}">${marker(method,x(point.beta),y(point.ratio))}<title>${method.label} · β ${point.beta} · ${f(point.ratio)} times feedback cost</title></g>`).join('')}</g>`;
  }).join('');
  const ratioRows=report.heldout.map(row=>`<tr><th scope="row">${row.beta}</th>${methods.map(method=>`<td>${f(row.means[method.key]/row.means.causal)}</td>`).join('')}</tr>`).join('');
  const intervals=report.heldout.flatMap(row=>methods.slice(1).map(method=>{
    const entry=row.comparisons[method.key];
    return `<tr><th scope="row">${row.beta}</th><td>${method.label}</td><td>${pct(entry.learnedSavingsPercent)}</td><td>${entry.pairedBootstrap95Percent.map(pct).join(' to ')}</td></tr>`;
  })).join('');
  const allNoisy=report.allNoisyAblation;
  return `<details id="pr-reference-study" class="pr-panel-details pr-reference-study">
  <summary>Across forecast quality</summary>
  <style>
    .pr-reference-study p { margin:8px 0; }
    .pr-reference-study svg { display:block; width:100%; height:auto; max-width:600px; margin:0 auto; overflow:visible; }
    .pr-reference-study svg text { font:12px var(--font-ui,system-ui,sans-serif); fill:var(--muted-foreground,#626269); }
    .pr-study-legend { display:grid; grid-template-columns:1fr 1fr; gap:5px 12px; margin:2px 0 12px; font-size:12px; }
    .pr-study-legend span { display:flex; align-items:center; gap:6px; }
    .pr-study-swatch { display:inline-block; width:22px; border-top:2px solid var(--study-color); }
    .pr-study-separate { padding:10px 0; border-top:1px solid var(--border,#e5e5e9); }
    .pr-study-separate strong { font-size:12px; font-weight:550; }
    .pr-study-ratios { display:grid; grid-template-columns:1fr 1fr; gap:5px 12px; margin:8px 0 0; font-size:12px; }
    .pr-study-ratios div { display:flex; gap:8px; justify-content:space-between; }
    .pr-study-ratios dt,.pr-study-ratios dd { margin:0; }
    .pr-study-ratios dd { font-variant-numeric:tabular-nums; }
    .pr-study-table-scroll { overflow-x:auto; max-width:100%; margin:8px 0; }
    .pr-reference-study table { width:100%; border-collapse:collapse; font-size:11px; font-variant-numeric:tabular-nums; }
    .pr-reference-study th,.pr-reference-study td { padding:7px 5px; text-align:right; border-bottom:1px solid var(--border,#e5e5e9); }
    .pr-reference-study th:first-child,.pr-reference-study .pr-study-intervals td:nth-child(2) { text-align:left; }
    .pr-reference-study th { font-weight:500; }
    .pr-reference-study caption { text-align:left; font-size:12px; margin:6px 0; }
    .pr-reference-study a { text-decoration:underline; text-underline-offset:2px; }
    .pr-reference-study .pr-study-table-scroll:focus-visible { outline:2px solid var(--primary,#0071e3); outline-offset:2px; }
    .pr-study-intro { font-size:17px; line-height:1.35; font-weight:600; letter-spacing:-.25px; color:var(--foreground,#202124); }
    .pr-study-overview { display:grid; gap:12px; margin:14px 0; }
    .pr-study-regime { padding:12px; border:1px solid var(--border,#e5e5e9); border-radius:10px; background:var(--background,#fff); min-width:0; }
    .pr-regime-heading { display:flex; align-items:baseline; flex-wrap:wrap; justify-content:space-between; gap:3px 10px; }
    .pr-regime-heading h4 { margin:0; font-size:14px; line-height:1.4; font-weight:600; color:var(--foreground,#202124); }
    .pr-regime-heading>span,.pr-regime-uncertainty { font-size:12px; line-height:1.5; color:var(--muted-foreground,#626269); }
    .pr-reference-study .pr-regime-winner { margin:3px 0 9px; font-size:12px; color:var(--muted-foreground,#626269); }
    .pr-regime-winner strong { margin-left:5px; color:var(--foreground,#202124); font-weight:600; }
    .pr-regime-costs { margin:0; display:grid; gap:7px; }
    .pr-regime-row { display:grid; grid-template-columns:120px minmax(0,1fr); align-items:center; gap:10px; font-size:12px; line-height:1.5; color:var(--foreground,#202124); }
    .pr-regime-row dt,.pr-regime-row dd { margin:0; background:transparent; color:inherit; }
    .pr-regime-row dd { display:grid; grid-template-columns:minmax(0,1fr) 48px; gap:8px; align-items:center; }
    .pr-regime-track { display:block; height:8px; border-radius:3px; background:var(--muted,#f3f3f5); overflow:hidden; }
    .pr-regime-track i { display:block; height:100%; border-radius:3px; }
    .pr-regime-value { text-align:right; font-variant-numeric:tabular-nums; }
    .pr-regime-row.is-winner { font-weight:600; }
    .pr-reference-study .pr-regime-uncertainty { margin:10px 0 0; padding-top:8px; border-top:1px solid var(--border,#e5e5e9); }
    @media(max-width:420px) { .pr-study-regime { padding:10px; } .pr-regime-row { grid-template-columns:108px minmax(0,1fr); gap:7px; } .pr-regime-row dd { grid-template-columns:minmax(0,1fr) 45px; gap:5px; } }
  </style>
  <p class="pr-caption">Recorded 24 bus study · No clicked attacks · Separate from your live trial</p>
  <p class="pr-study-intro">Forecast quality changes the winner</p>
  <p class="pr-caption">Mean total cost / feedback cost · Lower is better · Same bar scale in all three cases</p>
  <div class="pr-study-overview" aria-label="Three recorded forecast quality regimes">${overview}</div>
  <p class="pr-caption">24 remote links for either sparse design · 176 for dense · 0 for feedback. Local prediction and shared feedback are excluded.</p>
  <p class="pr-caption">Study costs include the terminal penalty. Live curves show accumulated stage cost.</p>
  <details class="pr-panel-details"><summary>All error levels and uncertainty</summary>
  <p class="pr-caption">Mixed reliability · 20 seeds per error level</p>
  <svg viewBox="0 0 360 226" role="img" aria-labelledby="pr-study-title pr-study-desc">
    <title id="pr-study-title">Controller cost across forecast error levels</title>
    <desc id="pr-study-desc">Ratio of mean total cost to feedback only. Lower is better and feedback is one. Dense prediction is cheapest at beta zero and one. Learned sparse is cheapest at beta two and four. Learned and fixed sparse coincide at beta zero. Each point summarizes the same twenty heldout seeds.</desc>
    <text x="42" y="17">Cost / feedback</text>
    ${[.6,1,1.4,1.8].map(value=>`<line x1="42" x2="330" y1="${y(value)}" y2="${y(value)}" stroke="var(--border,#e5e5e9)"/><text x="34" y="${y(value)+4}" text-anchor="end">${value.toFixed(1)}</text>`).join('')}
    ${curves}
    ${report.heldout.map(row=>`<text x="${x(row.beta)}" y="201" text-anchor="middle">${row.beta}</text>`).join('')}
    <text x="186" y="222" text-anchor="middle">Forecast error β</text>
  </svg>
  <div class="pr-study-legend" aria-label="Study controllers">${methods.map(method=>`<span><i class="pr-study-swatch" aria-hidden="true" style="--study-color:${method.color};${method.key!=='online'?'border-top-style:'+(method.key==='causal'?'dotted':'dashed')+';':''}"></i>${method.label}</span>`).join('')}</div>
    <div class="pr-study-table-scroll" role="region" tabindex="0" aria-label="Recorded cost ratios table"><table><caption>Mean total cost divided by mean feedback cost</caption><thead><tr><th scope="col">β</th>${methods.map(method=>`<th scope="col">${method.label}</th>`).join('')}</tr></thead><tbody>${ratioRows}</tbody></table></div>
    <div class="pr-study-table-scroll" role="region" tabindex="0" aria-label="Recorded learned savings uncertainty table"><table class="pr-study-intervals"><caption>Learned savings and 95% paired bootstrap intervals</caption><thead><tr><th scope="col">β</th><th scope="col">Compared with</th><th scope="col">Savings</th><th scope="col">95% interval</th></tr></thead><tbody>${intervals}</tbody></table></div>
    <p class="pr-caption">Negative savings mean higher cost. Intervals use 5000 paired resamples of the recorded trials and apply to savings, not individual chart points. This synthetic feeder study does not reproduce the paper’s numerical results.</p>
    <p class="pr-caption"><a href="benchmark-forecasted-scenario.json">Complete recorded study</a> · <a href="environment.html">Experimental setting</a></p>
  </details>
</details>
`;
}
if(require.main===module){
  const output=path.join(__dirname,'reference-study.html'),html=build();
  if(process.argv.includes('--check'))assert.equal(fs.readFileSync(output,'utf8'),html,'Reference study HTML must match recorded data');
  else fs.writeFileSync(output,html);
  console.log(process.argv.includes('--check')?'Reference study matches recorded data':output);
}
module.exports={build,methods};
