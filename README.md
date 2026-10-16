# Keeping the Grid Steady

[Open the experiment](https://tongxin.me/online-sls-demo/) · [Experimental environment](environment.html)

Communication topology is the default experiment. It measures whether learned prediction links improve control at a fixed message budget. Prediction adaptation remains available as a separate experiment. Both use the same LinDistFlow feeder, physical units, feedback controller, objective and equipment limits.

## Interaction

Press Run to collect 180 physical samples, then enter an independent comparison automatically. Comparison states and costs start afresh. Discovery topology history remains available. Ongoing attacks and unapplied requests continue across the transition, while decaying disturbances from the old plant do not transfer.

Communication topology starts with the Forecast interaction. Click a bus to corrupt or repair its forecast source. The marked sources stay noisy until repaired. Only newly issued forecasts change. The learner receives observations, not these source labels. The final source reliability map carries into the independent comparison. Changing it during comparison leaves the deployed links fixed. Learn again starts discovery under the current source map.

Choose Power disturbance to test physical recovery. Continuous mode adds one attack request per physical sample. Click the bus again or press Stop attack to stop requests. Pause stops plant time. In Pulse mode, click once for one request or hold a bus or Attack to repeat. Orange lightning badges show actual applied power in kW after equipment limits. Pending means the request will enter the next sample. Fading identifies residual power after requests stop. Switching the interaction stops new requests while existing disturbances decay.

The matrix has eight inverter receivers and 23 forecast sources. Inspecting a cell marks its physical source and receiving inverter on the feeder and emphasizes that exact remote link when present. An absent link is never drawn for inspection. Local sources mark one bus. Inspection changes only the view, leaving faults, playback and controllers unchanged. The separate Corrupt or Repair source button changes the inspected source rather than the receiving inverter. It preserves pause state and affects newly issued forecasts only. Saved history is read only and zero noise disables this action. Source changes persist through comparison and Learn again, while deployed links remain fixed. Connectivity shows actual selected links. Its history slider and event cards retain changes, with added links green and removed links amber. Learning weights shows measured changes in forecast gain energy. Coefficients may change without changing the strongest sources. Discovery links are candidates. Comparison links are deployed constraints on the controller. In the communication comparison, green and amber show differences from fixed sparse. The history controls still show actual discovery changes.

The communication comparison labels the four curves Learned sparse, Fixed sparse, Dense prediction and Feedback only. The link count shows the common sparse budget and replacements relative to fixed sparse. Difference vs fixed sparse subtracts actual cumulative costs, while the table retains totals. Prediction adaptation uses its own controller labels and Difference vs scalar.

Voltage diagnostics retain all four controllers. Now is the largest absolute bus departure from its own nominal voltage, and Peak is the largest executed departure in the current discovery or comparison phase, including the initial state. Values use mpu, where 1 mpu is 0.001 pu. Limited counts inverters whose last reactive command was clipped. Peak is not an attack-only recovery time or a guarantee of settling under continuing background power. Comparison and reset start new peak histories.\n\nPhysical attacks do not automatically separate these curves. The controller has the form `u = Kx + prediction`, and every policy uses the same K. For fixed deployed controllers without saturation, adding an unforecast power disturbance produces the same additional state and input response in every policy. Their total quadratic costs include this common response and cross terms with their different background trajectories. Large sustained attacks can therefore make percentage differences very small even when the learned links and predictive commands differ. No attack costs are removed from the displayed totals.

Saved trials restore paused. Step stays paused. Advance 180 preserves attacks across automatic comparison. Experiment settings can disable the automatic transition. Playback speed changes only viewing pace, with interpolation between physical samples. Each sample still represents one second.

## Communication experiment

Forecast noise follows the manuscript communication experiment's prescribed levels β in 0, 0.25, 0.5, 1 and 2. The default is β = 1. The feeder and background power generator are unchanged.

```text
forecast[t,j] = trueForcing[t,j] + beta * forcingScale[j] * a[j] * epsilon[t,j]
a[j] = 4 for buses 3, 6, 9, 12, 15, 18, 21, 24
a[j] = 0.05 for the other nonslack buses
epsilon[t,j] ~ independent standard Gaussian
```

The forcing scales are fixed by the physical feeder and background generator. They do not depend on β, observed outcomes or selected links. Each seed uses the same physical disturbances and standardized forecast errors across noise levels. Predictions are fixed when issued. The learner receives revealed forecast and disturbance pairs without source quality labels. Those labels describe the experimental environment only.

Discovery uses one 180 sample episode. Starting at action 30, scores accumulate squared direct forecast gains from the actual executed row, with its correction fitted only to earlier observations. The fixed sparse baseline uses identical action rows with identity correction. Scores are averaged over actions 30 through 179. Both selectors retain the local source and three remote sources per receiver. Rank keys use a tolerance of 1e−12 times the receiver's maximum score and break numerical ties by source index. Original score values remain unchanged.

```text
learnedScore[i,j] = mean_t sum_k (L_off[t,k] C_t)[i,j]^2
fixedScore[i,j]   = mean_t sum_k L_off[t,k][i,j]^2
L_off = U_off - K X_off
```

Deployment synthesizes both sparse controllers under their selected supports. All predictive controllers then use their fixed coefficients and raw forecasts, with C = I. New observations do not update corrections or selected links. The learned sparse versus fixed sparse comparison therefore isolates the effect of communication selection.

| Controller | Deployed forecast sources | Prediction correction |
| --- | --- | --- |
| Learned sparse | Learned local plus three remote sources per inverter | Identity |
| Fixed sparse | Offline selected local plus three remote sources per inverter | Identity |
| Dense prediction | All 23 sources per inverter | Identity |
| Feedback only | None | No prediction input |

Each sparse controller uses 24 remote prediction links. Dense prediction uses 176. Both retain eight local prediction channels. Common state feedback is unchanged and excluded from these counts, so these are prediction message savings rather than total communication savings.

This is a declared transfer of the paper's communication protocol to the physical feeder. The paper uses six discovery episodes, a different coupled model and twelve remote sources per receiver. This interactive experiment uses one discovery episode and three remote sources. It does not reproduce the paper's numerical results or claim the largest reported paper gains.

## Communication results

The [complete communication benchmark](benchmark-communication.json) reports all five noise levels and seeds 1 through 20. Each trial uses 180 discovery samples and a separate 180 sample test stream. The table gives mean executed total cost including the terminal Riccati penalty. The report also includes paired bootstrap intervals, every trial, selected sources and physical ranges. No clicked attacks enter this benchmark.

| Forecast noise β | Learned sparse | Fixed sparse | Dense prediction | Feedback only |
| --- | --- | --- | --- | --- |
| 0 | 0.01249087 | 0.01249087 | 0.01041215 | 0.01447046 |
| 0.25 | 0.01234817 | 0.01260299 | 0.01067499 | 0.01447046 |
| 0.5 | 0.01258439 | 0.01295228 | 0.01146783 | 0.01447046 |
| 1 | 0.01353031 | 0.01436238 | 0.01464351 | 0.01447046 |
| 2 | 0.01734539 | 0.02002861 | 0.02734672 | 0.01447046 |

At β = 1, learned sparse costs 5.79 percent less than fixed sparse and 7.60 percent less than dense prediction. At β = 2, the reductions are 13.40 and 36.57 percent. Learned sparse beats fixed sparse on all 20 seeds at each nonzero noise level. At zero noise, their supports and costs coincide. Dense prediction is cheaper at β = 0, 0.25 and 0.5. Feedback only is cheapest at β = 2, where learned sparse costs 19.87 percent more. The selected links improve prediction use in the stated regimes without guaranteeing that prediction is preferable to feedback alone.

## Prediction adaptation experiment

This option retains the previous shared matrix versus scalar comparison and its existing benchmarks. Both fits use only observations revealed before the current action, start at action 30 and retain the latest 60 pairs. The same fitted correction acts on every available temporal block in the current response row.

```text
u_t = K x_t + sum_k L_off[t,k] C_t forecast[k-1]
objective = 0.5 mean_s ||C forecast_s - disturbance_s||^2
          + 0.5 lambda ||C - I||_F^2
normalizedRidge = 1.27e-5 / 0.006^2
forcingScale = sqrt(mean_j forecastForcingScale[j]^2)
lambda = normalizedRidge * forcingScale^2 = 3.589027526e-8
```

Scalar adaptation restricts C to cI, giving 23 lambda in its scalar regularizer. A solve using sums adds m lambda for m observations. The global physical forcing scale is 0.0003189611 pu. It is independent of the selected preset, seed, links and measured costs. Both estimators use the same mean loss and regularization rule.

All predictive controllers use dense messages during discovery. Prediction adaptation selects candidate links using the calibrated gain energy over the finite planning segment. At deployment, matrix adaptation receives its learned sparse support and scalar adaptation receives the offline sparse support. Dense fixed prediction retains all sources. The latest discovery observations carry into the fresh comparison, and the two adaptive corrections continue updating.

The deployed matrix correction permits C[a,b] only when every receiver allowed source a also permits source b. This constraint preserves hard zeros in the actual message gain L C. It includes diagonal corrections and the scalar restriction. Matrix versus scalar costs therefore combine correction and selection effects in this option. They do not isolate topology alone.

The [prediction benchmark](benchmark-results.json) remains unchanged. It uses the same twenty seeds with 180 discovery and 180 test samples for each preset.

| Forecast setting | Matrix adaptation | Scalar adaptation | Fixed prediction | Feedback only |
| --- | --- | --- | --- | --- |
| Reliable forecasts | 0.01249545 | 0.01249457 | 0.01041358 | 0.01447046 |
| Uniform corruption | 0.01315855 | 0.01342402 | 0.01115768 | 0.01447046 |
| Mixed reliability | 0.01230440 | 0.01378628 | 0.01145050 | 0.01447046 |

Under mixed reliability, matrix adaptation costs 10.75 percent less than scalar adaptation. The [prespecified attack benchmark](benchmark-attacks.json) gives 2.95 percent. Unexpected physical attacks are absent from forecasts and primarily test the shared feedback. Their additional cost can dilute the relative benefit of forecast learning. Dense fixed prediction remains cheaper in these three presets and receives more messages.

## Implementation scope

The shared correction follows the explicit archived experimental mean moment equations, with a declared physical scale transfer and sparse restriction. It is not a literal implementation of Algorithm 1. No completed prefix convergence theorem is claimed for the executed adaptive controller.

A fixed common correction multiplying both predictive state and input maps preserves their homogeneous recursion and temporal support. Changing the correction between actions produces adaptive feedforward with common stabilizing feedback. The resulting trajectory is not one fixed lifted response. The separate completed response gradient diagnostic remains in source and tests but does not drive the displayed experiment.

Finite horizon synthesis includes the terminal Riccati penalty, initial conditions and finite support endpoints. A nullspace solve enforces forbidden actual forecast gains. Continuing past a planning horizon starts a separately synthesized segment from the measured state under the same deployed support. Existing costs stay unchanged. Live curves sum stage costs, while each finite benchmark adds the terminal penalty once.

The physical model, units, limits and objective are shared across both experiments. Voltage and cost are never clipped. Saturation is included in the plant, so unconstrained linear identities do not describe saturated trajectories exactly. The manuscript is not included in the public repository. This is a constructed feeder rather than a measured utility dataset.

## Reproduction

The checked in page and assets deploy directly to GitHub Pages. No external font is required. Saved trials from earlier algorithm versions are not replayed as the current experiment.

```sh
python3 build.py
node src/test-forecast-calibration.cjs
node src/test-simulation.cjs
node src/test-communication.cjs
node src/test-interactions.cjs
node src/test-topology-timeline.cjs
node src/benchmark-communication.cjs --json
node src/benchmark.cjs --json
node src/benchmark.cjs --attacks --json
python3 -m http.server 8000
```

## Cloud validation

Every branch push and pull request runs the five existing numerical and interaction test suites, builds the page and checks the real browser interactions. Browser checks cover ordinary playback, repeated forecast clicks, continuous power attacks through automatic comparison, thirty live cost view switches and a narrow touch layout. The workflow saves desktop and mobile screenshots as evidence. These smoke checks do not replace visual review or scientific benchmarks.

Cloud changes use a new branch beginning with `cloud/refine/`. Push source edits to that branch without editing the generated page by hand. After validation succeeds, a separate job with write access commits only the tested `index.html` to the same candidate branch. It checks that the remote branch still equals the tested source commit and uses a lease when pushing. It never updates `main`. Main and pull request runs require the checked in page to match the build.

Before promotion, read both successful jobs and the final candidate commit, confirm that the source changes are intended and that the branch still descends from the expected main commit. Update `main` to that candidate with an expected head check. Verify the subsequent main validation and GitHub Pages deployment before calling the update live. A failed or cancelled candidate stays unpublished. The build commit uses the repository Actions token and does not trigger another workflow run.

The cloud browser dependency is pinned to Playwright 1.56.1 and installed only in the runner temporary directory. It does not add a production dependency.
