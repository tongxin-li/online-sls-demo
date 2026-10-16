# Keeping the Grid Steady

[Open the experiment](https://tongxin.me/online-sls-demo/) · [Experimental environment](environment.html)

The environment document describes the feeder, power disturbances, units and evaluation quantities. The website keeps the experiment itself central.

## Interaction

Continuous mode is selected by default. Click a bus to start an attack that adds one request per physical sample. Click the same bus again or press Stop attack to stop new requests. Pause stops both the attack and playback. In Pulse mode, a click adds one request and holding a bus or Attack adds one request per sample until release. Repeated clicks remain available without restarting the clock. Playback defaults to sixteen samples per second, with options of two, four, eight, sixteen and thirty two. Linear visual interpolation smooths the displayed motion between samples. Each physical sample still represents one second.

Orange lightning badges show the actual applied disturbance in kW after equipment limits. Pending means that a request is queued for the next physical sample. The badges do not count attacks or sum requested power. Attack on means new requests are being added. Fading means requests have stopped while the existing disturbance decays. Paused means plant time is stopped and the disturbance remains. A softer badge identifies this residual power, and pausing also stops equipment animation. Click the bus or its badge to toggle the continuous attack. Chart badges say Attack or Attacks, while shaded intervals locate the disturbances.

The prediction matrix shows eight inverter receivers and 23 source buses. Connectivity is the default view. Its history slider and recent event cards retain actual support changes over time, with added links in green and removed links in amber. Changed cells and links briefly flash when an update arrives. Returning to the starting topology does not erase earlier events. Connectivity can remain stable while coefficients change, and the display identifies these quantities separately. Learning weights displays the signed change in realizing gain energy relative to the offline energy over the same finite planning segment. Its color scale is shown explicitly and selected sources remain outlined. Coefficient change is the relative Frobenius norm of the actual learned gain correction. Learning weights can change without changing the strongest sources. During deployment the selected support stays fixed and the executed prediction coefficients continue adapting. Learn again starts new discovery.

Run collects 180 physical samples for learning, then automatically starts an independent four controller comparison. All four executed cost curves are visible during preparation and comparison. The Learning view shows prediction errors evaluated on newly revealed observations, before those observations enter the fit. The comparison clock and costs start at zero, while discovery topology history remains available. Ongoing attacks and unapplied requests continue across the transition. Decaying disturbances from the old plant do not transfer.

Saved trials restore paused in their original phase. Automatic transition resumes with live sampling. Step stays paused. Advance 180 executes exactly 180 samples across the phases and preserves ongoing attacks. Disable automatic comparison in Experiment settings to inspect a longer learning run or choose deployment manually. Forecast selection and Advance 180 are also in Experiment settings, keeping the main controls focused on playback and disturbances.

Curves use colors and line styles. Identical support does not imply identical controllers because matrix and scalar corrections can differ. Gap to scalar subtracts actual cumulative costs, while the table retains totals.

## Execution contract

This version implements a shared forecast calibration specialization inspired by the manuscript experiments. Earlier versions updated completed response rows and discarded their coefficients when deploying selected links. That could not transfer forecast learning into future control and frequently produced identical sparse controllers.

Before action t, the matrix and scalar estimators use only revealed forecast and disturbance pairs with indices less than t. Both begin with identity correction, first update at action 30, and retain the most recent 60 observations. Predictions are issued once and remain immutable. The same fitted correction acts on every temporal predictive block in the current row

```text
u_t = K x_t + sum_k L_off[t,k] C_t forecast[k-1]
L_off = U_off - K X_off
```

Both fits minimize the same explicitly specified ridge objective in physical voltage forcing units

```text
0.5 mean_s ||C forecast_s - disturbance_s||^2 + 0.5 lambda ||C - I||_F^2
normalizedRidge = 1.27e-5 / 0.006^2
forcingScale = sqrt(mean_j forecastForcingScale[j]^2)
lambda = normalizedRidge * forcingScale^2 = 3.589027526e-8
```

Scalar adaptation restricts C to cI and therefore uses 23 lambda in its scalar regularizer. The numerical solve accumulates sums and adds m lambda for m observations, preserving this mean loss convention. Matrix adaptation fits source dependent corrections. This is the manuscript experimental shared parameter mechanism with a declared ridge implementation and a communication restriction for this feeder. This unweighted mean loss correction follows the explicit archived experimental moment equations. The physical scale transfer and sparse matrix restriction are declared adaptations for this feeder. This website is not an exact reproduction of Algorithm 1 or of the manuscript numerical results.

A fixed common C multiplying both X and U preserves homogeneous response recursion and temporal support. Changing C between actions gives adaptive feedforward with common stabilizing feedback. It does not make the executed switched trajectory one fixed lifted response, and no prefix convergence theorem is claimed for this implementation.

## Deployed prediction links

All predictive controllers use dense messages during the 180 sample discovery trial. The displayed sparse links are candidates during this phase. They are selected from actual calibrated gain energies of L C, summed over the finite planning segment. The Learning weights view shows these measured coefficient changes, not artificial adaptation animation.

Deployment selects the learned support before starting an independent disturbance stream. Sparse synthesis imposes hard zeros on L together with predictive dynamics, temporal support and initial boundary conditions. The most recent discovery observations are carried into the new trial, so learned correction is available at its first action. Costs and physical states restart. New revealed observations replace the carried window as the trial runs.

A full unconstrained C would reopen forbidden message links. The deployed matrix fit permits C[a,b] only if every receiver allowed source a also permits source b. This restriction contains diagonal corrections and cI. It ensures that L C is zero on every forbidden raw forecast channel. The restriction is part of the fitting objective, not an output mask applied after fitting.

| Controller | Discovery | Comparison |
| --- | --- | --- |
| Matrix adaptation | Dense shared matrix correction | Learned local plus three remote sources with a compatible matrix correction |
| Scalar adaptation | Dense shared scalar correction | Offline selected local plus three remote sources with a scalar correction |
| Fixed prediction | Dense fixed coefficients | Dense fixed coefficients |
| Feedback only | No prediction input | No prediction input |

Matrix and scalar have the same sparse message budget in comparison but can select different sources. Their cost difference combines correction and selection effects. Fixed prediction has more prediction messages. These comparisons do not isolate a pure topology advantage. All controllers receive the same disturbances, issued forecasts, initial conditions, feedback gain, objective and actuator limits.

Unexpected clicked power pulses are absent from forecasts and primarily test the common feedback. They need not produce a large performance gap. The forecast presets test adaptation to prediction quality. No controller is guaranteed to win under every preset or intervention.

Prediction links carry voltage forcing forecasts, not physical power. The common dense state feedback still uses state measurements. The matrix does not represent total communication savings.

## Reproduction

The checked in `index.html`, `environment.html` and bundled assets deploy directly to GitHub Pages. No external font is required. The interface uses the native system font and native SVG equipment artwork.

```sh
python3 build.py
node src/test-forecast-calibration.cjs
node src/test-simulation.cjs
node src/test-interactions.cjs
node src/test-topology-timeline.cjs
node src/benchmark.cjs --json
python3 -m http.server 8000
```

## Numerical implementation

Preview depth is 5. Shared calibration uses a Cholesky solve with the fixed ridge above. Score evaluation uses cached receiver Gram matrices to compute the exact energy of L C without rebuilding all temporal response blocks at each sample.

The previous completed response gradient code remains available as an independent diagnostic in the source and tests. It does not drive controller coefficients, topology selection or the displayed learning curves. It is hidden from the interactive experiment to avoid confusing two different learning algorithms.

Finite horizon synthesis includes the terminal Riccati penalty and the initial and finite support endpoint conditions. A nullspace solve imposes forbidden entries of the realizing gain. Continuing beyond a planning horizon starts a separately synthesized finite segment from the measured state. Existing samples and costs remain unchanged. Live plots show stage costs, while the benchmark adds the terminal penalty once at the end of its declared horizon.

Saved trials from earlier algorithm versions are not replayed as this experiment. Current trials restore deterministically from the initial seed and event journal.

## Calibration scale audit

The preceding release copied a sum loss ridge of 1.27e−5 from a different voltage forcing scale. The explicit archived experimental correction instead uses mean moments. This release preserves that mean convention and transfers its dimensionless ridge to the feeder using the fixed physical forcing scale above. Both corrections apply equally to matrix and scalar adaptation. Scale and sample duplication invariance are regression tested. No physical model, forecast corruption level or test seed was changed to enlarge a gap.

The previous mixed reliability savings were 8.35 percent without attacks and 2.31 percent with attacks. The corrected comparison gives 10.75 and 2.95 percent. This does not reproduce the manuscript numerical results. Its heterogeneous voltage comparison reports 14.8 percent against Scalar, while its much larger communication gains compare sparse versus dense prediction under a different high noise scenario and communication budget.

## Paired deployment results

The checked in [benchmark results](benchmark-results.json) use seeds 1 through 20, 180 discovery samples and 180 deployment samples per seed. Deployment uses a separate deterministic random stream. Every controller receives identical disturbances within each trial. Physical parameters, forecast presets, seed list and message budget were retained from the previous benchmark. The dimensionless ridge and physics based scale rule were fixed before evaluation. The forcing scale uses only the declared feeder and forecast generator, with RMS 0.0003189611 pu. It does not depend on realized data, corruption preset, selected links, test seed or measured cost. These trials contain no clicked interventions.

| Forecast setting | Matrix adaptation | Scalar adaptation | Fixed prediction | Feedback only |
| --- | --- | --- | --- | --- |
| Reliable forecasts | 0.01249545 | 0.01249457 | 0.01041358 | 0.01447046 |
| Uniform corruption | 0.01315855 | 0.01342402 | 0.01115768 | 0.01447046 |
| Mixed reliability | 0.01230440 | 0.01378628 | 0.01145050 | 0.01447046 |

Values are mean total costs including the terminal penalty. Under mixed reliability, matrix adaptation reduces mean cost by 10.75 percent versus scalar adaptation and wins on all 20 seeds. The gain is 1.98 percent under uniform corruption. Under reliable forecasts matrix adaptation is 0.007 percent worse on average. Dense fixed prediction remains cheaper in all three settings and receives more messages. These results do not establish a universal or isolated topology advantage.

The [fixed attack stress protocol](benchmark-attacks.json) repeats the same 20 seeds and all three presets with identical discovery data. It applies two 100 kW requests at bus 23 at samples 20 and 21, then 50 kW each sample during 60 through 69 at solar bus 7, 100 through 109 at battery bus 12, and 140 through 149 at homes bus 23. This schedule was declared before evaluating attack results. In mixed reliability matrix cost is 2.95 percent below scalar adaptation, with 20 wins. Under uniform corruption the difference is 0.66 percent, and under reliable forecasts matrix cost is 0.027 percent higher. Absolute matrix savings versus scalar remain about 0.00148 without attacks and 0.00153 with attacks. Attacks add about 0.0382 to both costs, diluting the percentage. The physical attack cost dominates much of the comparison. Neither benchmark activates reactive command saturation.

```sh
node src/benchmark.cjs --attacks --json
```


The manuscript is not included in the public repository. Plant and forecast assumptions are a declared interactive environment, not a measured utility dataset. Saturation is included in the executed plant. The unconstrained linear response identities do not describe saturated trajectories exactly.
