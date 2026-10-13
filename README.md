# Keeping the Grid Steady

[Open the hosted experiment](https://tongxin.me/online-sls-demo/)

Explore voltage, control cost, prediction gains and online learning on a synthetic 24 bus feeder. The browser experiment uses the shared matrix adaptation idea from the manuscript experiments. It is not a reproduction of the full delayed FIR projected update in Algorithm 1.

## Dynamics

The plant uses the manuscript communication scenario

```
x[t+1] = A x[t] + u[t] + w[t]
v[t] = 1 + x[t]
A = 0.4 I + 0.58 D^(-1/2) W D^(-1/2)
W[i,j] = exp(-distance(i,j)/2) for i != j
W[i,i] = 0
D = diag(W 1)
B = I, Q = 35 I, R = 0.08 I
```

Distances come from the 24 bus tree. Every bus has an equivalent control input. The fixed feedback gain comes from the discrete Riccati equation. Five forecast samples enter the LQR preview correction. Forecasts are immutable once they enter that preview. All compared controllers receive identical disturbances and forecasts.

The cost at time t is `35 ||x[t]||² + 0.08 ||u[t]||²`. A pulse applied during step t first changes voltage at t+1. Its state cost is charged at t+1. Both charts use those physical indices. The cumulative plot sums actual stage costs without a terminal cost. No state or cost is clipped or artificially amplified.

## Shared learning

The adaptive controller uses one matrix G to calibrate all five preview samples. Before action t, it fits only revealed observations through t−1. Learning starts at t=30 and uses the preceding 60 samples.

The declared browser objective is

```
(1 / (2 m)) sum ||G forecast[s] - disturbance[s]||²
    + (lambda / 2) ||G - I||_F²
lambda = 1.27e-5
```

The implementation normalizes forecast and disturbance vectors by 0.006 and scales the ridge coefficient accordingly. A positive definite linear solve obtains the exact shared optimum at each update. This explicitly defined mean forecast loss is a reduced approximation to the manuscript response weighted objective. It does not enforce or reproduce the full FIR response projection.

The visible cycle shows a forecast, the applied control, the recovered disturbance and the gain update. Live gain change need not decrease monotonically because the sample window changes. Freeze and converge holds the plant, observations and cost fixed, then takes one gradient iteration per display tick toward the exact fixed ridge minimizer. This is a numerical diagnostic, not a demonstration of the paper's full convergence theorem.

The graph and matrix rank three remote sources per receiver using prediction gain magnitude. They are recommendations. They do not change the electrical feeder or the deployed dense controller. The paper's offline discovery and resynthesis experiment is not reproduced here.

## Interaction

Run advances one control sample per second by default. Step advances a single sample. Clicking a bus queues an unexpected net power loss at the current time. Paused attacks wait for Run or Step. Several attacks at the same bus and time add exactly. There is no cooldown and a completed horizon can extend without discarding history.

Equipment roles change the injected disturbance profile

| Equipment | Event | Decay constant | Duration |
| --- | --- | --- | --- |
| Homes | Demand surge | 3 samples | 12 samples |
| Solar | Cloud cover | 6 samples | 24 samples |
| Battery | Inverter outage | 2 samples | 8 samples |
| Substation | Feeder disturbance | 4 samples | 16 samples |

Each event contributes `-strength * exp(-age / decay)` at its bus. Role icons do not imply separate inverter or battery state equations. Battery bars show current control effort, not state of charge. Queued events have count badges. Realized events trigger lightning, clouds or equipment effects based on the actual event state.

The default pulse is 0.02 pu with 0.01 and 0.03 alternatives. Single pulses in the seeded validation stay close to the displayed 0.95 to 1.05 pu target. Repeated disturbances may leave that range. The model has no AC power flow, actuator saturation or hard voltage constraint.

The experiment starts at zero so initial learning is visible. Version 4 browser state preserves repeated interventions at the same time. Older versions start fresh because their preview and learning definitions differ.

## Build and validate

The checked in `index.html` and `assets` directory deploy directly to GitHub Pages. D3 is bundled with its license. DM Sans loads from Google Fonts with a system fallback.

```sh
python3 build.py
node src/test-simulation.cjs
python3 -m http.server 8000
```

Sixteen numerical tests cover the plant and Riccati equation, preview coefficients, immutable forecasts, causal exact fitting, distinct equipment profiles, repeated pulse superposition, timing, voltage ranges, horizon extension, fixed objective convergence and deterministic replay.

The source files are in `src`. Equipment artwork is native SVG in `equipment.js` and `equipment.css`. The page contains no private manuscript files or experimental datasets.
