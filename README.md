# Keeping the Grid Steady

[Open the hosted experiment](https://tongxin.me/online-sls-demo/)

Explore abstract state recovery, control cost, prediction gains and online learning on a synthetic 24 node network. The equipment artwork is illustrative. The displayed state is not a physical voltage computed from power flow. The browser experiment uses the shared matrix adaptation idea from the manuscript experiments. It is not a reproduction of the full delayed FIR projected update in Algorithm 1.

## Dynamics

The plant uses the manuscript communication scenario

```
x[t+1] = A x[t] + u[t] + w[t]
y[t] = 1 + x[t]
A = 0.4 I + 0.58 D^(-1/2) W D^(-1/2)
W[i,j] = exp(-distance(i,j)/2) for i != j
W[i,i] = 0
D = diag(W 1)
B = I, Q = 35 I, R = 0.08 I
```

Distances come from the 24 node tree, not electrical line impedances. Every node has an unconstrained direct control input. There is no power balance, fixed slack bus, active or reactive power injection model, or inverter capability constraint. The fixed feedback gain comes from the discrete Riccati equation. Five forecast samples enter the LQR preview correction. Forecasts are immutable once they enter that preview. All compared controllers receive identical disturbances and forecasts.

The cost at time t is `35 ||x[t]||² + 0.08 ||u[t]||²`. A pulse applied during step t first changes the state at t+1. Its state cost is charged at t+1. Both charts use those discrete sample indices. This delay belongs to the abstract recurrence and does not establish physical voltage recovery timing. The cumulative plot sums actual stage costs without a terminal cost. No state or cost is clipped or artificially amplified.

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

The graph and matrix rank three remote sources per receiver using prediction gain magnitude. They are recommendations. They do not change the illustrated tree or the deployed dense controller. The paper's offline discovery and resynthesis experiment is not reproduced here.

## Controller comparison

The demo now compares Adaptive with three baselines

| Controller | Prediction calibration |
| --- | --- |
| Adaptive | Full shared matrix G fitted from past observations |
| Scalar adaptation | One shared scalar alpha fitted from the same observations |
| Fixed prediction | Identity calibration throughout the run |
| Feedback only | No prediction input |

Scalar uses the same mean ridge objective restricted to G = alpha I. If S and T are the regularized normalized covariance and cross covariance, alpha = trace(T) / trace(S). Equivalently, both the numerator and denominator include N times the ridge coefficient. Both adaptive methods start at t = 30 and use the same preceding 60 samples.

Adaptive, Scalar adaptation and Fixed prediction are identical before learning begins. The plot preserves exact overlap. Distinct colors, dash patterns, sample symbols and numerical cost rows identify the controllers without changing their values.

The forecast presets use a common latent disturbance process and identical Gaussian draws for any given seed. Reliable forecasts use gain 1 and noise scale 0.05 at all sources. Uniform corruption uses gain 0.65 and noise scale 0.65 at all sources. Mixed reliability retains the previous demo setup, with gain 0.15 and noise scale 1.6 at buses 3, 6, 9, 12, 15, 18, 21 and 24, and reliable forecasts elsewhere. These parameters follow the types of conditions in the manuscript. This browser experiment is not a reproduction of the paper's reported cost ratios.

The preset selector starts a fresh experiment. Run 180 steps advances the current experiment without dropping its history or interventions. Cost comparison is the default view. Every cost row includes all samples from t = 0, and differences are signed so higher adaptive cost remains visible. The Learning view retains the fixed data convergence diagnostic.

Unexpected clicked pulses are absent from all forecasts. They test recovery and can dominate prediction related cost differences. The shared matrix method is intended to retain useful sources while suppressing unreliable ones. Its advantage is conditional and must be evaluated against Scalar as well as Feedback only.

## Interaction

Run advances one control sample per second by default. Step advances a single sample. Clicking a bus queues an abstract additive state disturbance at the current time. Paused attacks wait for Run or Step. Several attacks at the same bus and time add exactly. There is no cooldown and a completed horizon can extend without discarding history.

Equipment roles change the injected disturbance profile

| Equipment | Event | Decay constant | Duration |
| --- | --- | --- | --- |
| Homes | Demand surge | 3 samples | 12 samples |
| Solar | Cloud cover | 6 samples | 24 samples |
| Battery | Inverter outage | 2 samples | 8 samples |
| Substation | Feeder disturbance | 4 samples | 16 samples |

Each event contributes `-strength * exp(-age / decay)` at its bus. Role icons do not imply separate inverter or battery state equations. Battery bars show current control effort, not state of charge. Queued events have count badges. Realized events trigger lightning, clouds or equipment effects based on the actual event state.

The default pulse is 0.02 normalized units with 0.01 and 0.03 alternatives. Single pulses in the seeded validation stay close to the displayed 0.95 to 1.05 illustrative state band. Repeated disturbances may leave that range. The model has no AC power flow, actuator saturation or hard voltage constraint.

The experiment starts at zero so initial learning is visible. Version 5 browser state preserves repeated interventions at the same time. Older versions start fresh because their preview and learning definitions differ.

## Reproducible paired comparison

The table reports mean cumulative cost across seeds 1 through 20, with 180 samples per run and no clicked pulses. Warmup is included. Every controller receives exactly the same disturbances and forecasts for a given seed. Parameters were not changed to produce these results.

| Forecasts | Adaptive | Scalar adaptation | Fixed prediction | Feedback only |
| --- | --- | --- | --- | --- |
| Reliable | 0.021498 | 0.020294 | 0.020335 | 2.968790 |
| Uniform corruption | 2.181798 | 2.113740 | 2.656043 | 2.968790 |
| Mixed reliability | 1.662154 | 2.891628 | 5.323677 | 2.968790 |

For mixed reliability, the adaptive mean is 42.52 percent below Scalar, 68.78 percent below Fixed prediction and 44.01 percent below Feedback only. It wins all 20 paired mixed runs against each baseline. Scalar has the lower mean under both reliable and uniform forecasts. These are measurements of this browser benchmark, not the paper's experimental percentages or a guarantee about other systems.

[All paired runs and settings](benchmark-results.json) are included. Reproduce them with `node src/benchmark.cjs --json`. The benchmark ends at 180 and truncates the final preview. The interactive run continues beyond 180 and retains its available preview. Its cost readouts are always computed from that live run.

## Build and validate

The checked in `index.html` and `assets` directory deploy directly to GitHub Pages. D3 is bundled with its license. DM Sans loads from Google Fonts with a system fallback.

```sh
python3 build.py
node src/test-simulation.cjs
python3 -m http.server 8000
```

Numerical tests cover the plant and Riccati equation, preview coefficients, immutable forecasts, causal exact fitting, distinct equipment profiles, repeated pulse superposition, timing, state ranges, horizon extension, fixed objective convergence and deterministic replay.

The source files are in `src`. Equipment artwork is native SVG in `equipment.js` and `equipment.css`. The page contains no private manuscript files or experimental datasets.
