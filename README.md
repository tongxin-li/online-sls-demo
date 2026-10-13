# Keeping the Grid Steady

[Open the hosted experiment](https://tongxin.me/online-sls-demo/)

An interactive 24 bus distribution feeder with LinDistFlow voltages, bounded inverter reactive dispatch and shared prediction learning. Click a home, solar plant or battery to disturb its power. Compare Adaptive against Scalar adaptation, Fixed prediction and Feedback only on identical disturbances.

The control goal is to restore the fixed nominal voltage profile after power changes. This constructed feeder illustrates shared matrix adaptation. It does not reproduce the manuscript plant, the full delayed FIR update in Algorithm 1, or the paper's numerical results.

## Feeder and operating point

The model is a balanced radial feeder with bus 1 fixed at 1 pu. Power uses a 1 MVA base and voltage uses a 12.47 kV line to line base. For zero based branch index e, resistance is `0.45 + 0.15 (e mod 4)` ohms and reactance is `0.30 + 0.08 (e mod 3)` ohms. The topology and all parameters are declared in `src/simulation.js`.

Homes consume 70 kW at power factor 0.95. Battery buses have 50 kW of baseline demand. Solar buses generate 80 kW. Inverters are installed at buses 5, 7, 8, 12, 14, 18, 21 and 24. Their rating is 120 kVA and their reactive command limit is 70 kvar in either direction.

Let D contain root paths for the 23 nonslack buses. Voltage magnitude sensitivities are

```
Rv = D diag(r_pu) D'
Xv = D diag(x_pu) D'
v = 1 - Rv p_net - Xv q_load + Xv E q_inv
```

E maps the eight inverters to their buses. This is the voltage magnitude approximation, with no factor of two. The squared voltage form of LinDistFlow uses that factor. Line losses are neglected. The model omits unbalanced phases, protection and frequency dynamics.

The fixed reference vbar is computed once from nominal demand and generation with zero reactive inverter injection. All controllers share it. It is not changed by forecasts, attacks, seeds or measured performance.

Reactive commands have a two second actuator time constant with one second samples

```
a = exp(-1 / 2)
q_inv[t+1] = a q_inv[t] + (1-a) u[t]
x[t] = v[t] - vbar
x[t+1] = a x[t] + (1-a) Xv E u[t] + F (d[t+1] - a d[t])
```

Here d is the change in net active demand relative to the nominal operating point. For homes, a power factor of 0.95 maps active changes to reactive demand changes. Solar and battery changes affect net active power only. F combines the corresponding Rv and Xv sensitivities. The plant state shown on screen is actual voltage, while the controller and cost use deviations from vbar.

The stage cost is `35 ||v[t] - vbar||² + 0.08 ||u[t]||²`. Commands u use the 1 MVA base. The reactive command penalty is distinct from actual inverter injection, which follows the actuator lag. Saturation is applied before computing this penalty. Actual voltage is never clipped. The 0.95 to 1.05 pu band is a displayed operating band, not an enforced voltage constraint.

## Prediction and control

A general input matrix Riccati solve supplies a fixed LQR feedback gain and five preview gains. All forecasts are anchored to currently measured power. For a raw forecast h and current observation d, the conditioned future prediction is

```
dhat[t+k] = d[t] + G (h[t+k] - h[t])
```

The current raw forecast h[t] was issued before d[t] was revealed. At the initial sample both are zero. Adaptive uses its fitted G, Scalar uses alpha I, Fixed uses I and Feedback only uses zero. Feedback therefore holds current power across the preview. Prediction controllers add their calibrated forecast changes to that same measured anchor. This holds the current forecast residual constant across the preview and responds to unforecast load changes using measurements alone. No pulse metadata is supplied to any controller.

The conditioned power sequence is mapped through F to voltage disturbance increments. This causal conditioning is a declared browser forecast model, not a step from the paper's full Algorithm 1.

Raw power forecasts are immutable after entering the preview. A transformed voltage disturbance preview also depends on currently measured power, so it is not itself claimed to be immutable. Clicked disturbances are absent from every raw forecast.

| Controller | Prediction calibration |
| --- | --- |
| Adaptive | Full shared matrix G fitted from past observations |
| Scalar adaptation | One shared scalar alpha fitted from the same observations |
| Fixed prediction | Identity calibration throughout the run |
| Feedback only | Current information without future power forecasts |

The adaptive methods start at sample 30 and use the preceding 60 revealed samples. Before learning starts, all three predictive controllers coincide. The plot preserves this exact overlap. Line patterns, sample symbols and numerical cost rows identify every controller without altering its values.

The declared fitting objective is

```
(1 / (2 m)) sum ||G forecast[s] - observed_power[s]||²
    + (lambda / 2) ||G - I||_F²
lambda = 1.27e-5
```

Power vectors are normalized by 0.006 pu, equivalent to 6 kW, with the ridge coefficient scaled consistently. A positive definite solve gives the exact matrix optimum. Scalar adaptation restricts the same objective to alpha I on the 23 nonslack coordinates, with the unused slack coefficient fixed at one. If S and T are the regularized normalized covariance and cross covariance on those coordinates, `alpha = trace(T) / trace(S)`. Both traces include 23 times the ridge coefficient. The matrix learner has the same fixed slack coordinate.

This mean power forecast loss is a restricted experimental variant. It differs from the response weighted objective and completed FIR projection in the full manuscript algorithm. No claim of reproducing its theorem is made.

## Communication and convergence

The graph and matrix rank three remote prediction sources for each inverter receiver using mapped power preview gains. The physical feeder stays fixed. These recommendations do not restrict the deployed controller, which continues to use the full learned prediction map. Homes without inverters have no receiver row of control links.

Live gain changes need not shrink monotonically because observations keep changing. Freeze data holds the plant, samples and costs fixed, then performs gradient iterations toward the exact fixed ridge minimizer. The displayed convergence is a fitting diagnostic, not a guarantee that live costs or communication recommendations converge.

## Interaction

Run advances one physical sample per second by default. Playback speed changes animation pace, not physical time. Step advances one sample. Run 180 steps advances the current experiment without dropping its history or interventions. Forecast preset selection starts a fresh experiment.

A click queues a power change at the selected bus. Paused clicks wait for Run or Step. Repeated clicks at the same bus and time are accepted without a cooldown. The substation is fixed and cannot be attacked.

| Equipment | Event | Power effect |
| --- | --- | --- |
| Homes | Demand surge | Increased active and reactive demand at power factor 0.95 |
| Solar | Cloud cover | Reduced active generation, bounded by available solar power |
| Battery | Charging surge | Increased active charging demand, bounded by charging capacity |

Events decay over time. Requested power changes add before equipment limits are applied. The page shows applied power when a limit reduces the request. Solar loss cannot exceed available generation. Battery charging is limited to 90 kW, which leaves enough apparent power capacity for the 70 kvar reactive limit within a 120 kVA rating. These bounds also cover reactive lag because actual reactive injection remains within the same limit.

The default request is 100 kW, with 50 and 150 kW options. An intervention queued at t changes voltage at t+1. The corresponding voltage error enters stage cost at t+1. Instantaneous cost and voltage retain their true sample indices. No cost is amplified for display.

Equipment animations represent realized power events. Battery bars represent reactive injection, not state of charge. The model does not track battery energy.

Version 6 browser state stores physical interventions and starts older synthetic sessions fresh.

## Forecast conditions and paired results

All presets share the same latent power process and Gaussian draws for any given seed. Reliable forecasts use gain 1 and noise scale 0.05. Uniform corruption uses gain 0.65 and noise scale 0.65. Mixed reliability uses gain 0.15 and noise scale 1.6 at buses 3, 6, 9, 12, 15, 18, 21 and 24, with reliable forecasts elsewhere.

These conditions were declared before evaluating the physical feeder. Unexpected pulses test recovery and can dominate differences attributable to prediction quality. A method is not guaranteed to win.

The following means include every sample from 0 through 179 across seeds 1 through 20, with no clicked pulses. Each seed supplies identical realized powers and raw forecasts to all four controllers. Physical parameters and forecast conditions were fixed before evaluating these runs.

| Forecasts | Adaptive | Scalar adaptation | Fixed prediction | Feedback only |
| --- | --- | --- | --- | --- |
| Reliable forecasts | 0.01089482 | 0.01089626 | 0.01089644 | 0.01646539 |
| Uniform corruption | 0.01401949 | 0.01430522 | 0.01491790 | 0.01646539 |
| Mixed reliability | 0.01258245 | 0.01512762 | 0.01764981 | 0.01646539 |

Under mixed reliability, Adaptive reduced mean cost by 16.83 percent against Scalar, 28.71 percent against Fixed prediction and 23.58 percent against Feedback only. It had lower cost in all 20 paired mixed runs. Under uniform corruption the mean advantage against Scalar was 2.00 percent. With reliable forecasts, the three prediction methods were practically tied, with differences below 0.015 percent. These are measurements of this browser model, not guarantees or the paper's experimental percentages.

Actual voltages over these runs ranged from 0.98595 to 1.00000 pu. The nominal profile ranged from 0.98738 to 1.00000 pu. Independent balanced AC power flow checks of the nominal feeder and representative single 150 kW interventions found a maximum voltage magnitude discrepancy below 0.00026 pu. This validates the approximation in those tested conditions, not arbitrary stacked disturbances.

[Every paired run and its settings](benchmark-results.json) includes costs, actual voltage ranges and command saturation counts. Reproduce the report with `node src/benchmark.cjs --json`. The benchmark ends at 180 and truncates its final preview. The interactive session can continue beyond 180 with available preview, so its last few cost samples can differ.

All 17 numerical tests pass. They cover electrical sensitivities, the general input Riccati solve, conditional preview causality, physical voltage and inverter equations, capability limits, actual bounded command costs, repeated interventions, shared learning, AC power flow consistency, fixed data convergence and deterministic replay.

## Build and validate

The checked in `index.html` and bundled assets deploy directly to GitHub Pages. D3 includes its license. DM Sans loads from Google Fonts with a system fallback.

```sh
python3 build.py
node src/test-simulation.cjs
node src/benchmark.cjs --json
python3 -m http.server 8000
```

The source files are in `src`. Equipment artwork is native SVG. The page contains no private manuscript files or experimental datasets.

The physical equations follow the balanced linear approximation discussed in [Accelerated Voltage Regulation in Multi Phase Distribution Networks](https://arxiv.org/abs/1903.00072). Inverter real and reactive power capability is discussed in [Optimal Inverter VAR Control in Distribution Systems with High PV Penetration](https://arxiv.org/abs/1112.5594).
