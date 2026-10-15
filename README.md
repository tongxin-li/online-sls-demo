# Keeping the Grid Steady

[Open the experiment](https://tongxin.me/online-sls-demo/) · [Experimental environment](environment.html)

The environment document describes the feeder, power disturbances, units and evaluation quantities. The website keeps the experiment itself central.

## Interaction

Continuous mode is selected by default. Click a bus to start an attack that adds one request per physical sample. Click the same bus again or press Stop attack to stop new requests. Pause stops both the attack and playback. In Pulse mode, a click adds one request and holding a bus or Attack adds one request per sample until release. Repeated clicks remain available without restarting the clock. Playback defaults to sixteen samples per second, with options of two, four, eight, sixteen and thirty two. Linear visual interpolation smooths the displayed motion between samples. Each physical sample still represents one second.

Orange lightning badges show the actual applied disturbance in kW after equipment limits. Pending means that a request is queued for the next physical sample. The badges do not count attacks or sum requested power. Attack on means new requests are being added. Fading means requests have stopped while the existing disturbance decays. Paused means plant time is stopped and the disturbance remains. A softer badge identifies this residual power, and pausing also stops equipment animation. Click the bus or its badge to toggle the continuous attack. Chart badges say Attack or Attacks, while shaded intervals locate the disturbances.

The prediction matrix shows eight inverter receivers and 23 source buses. Connectivity is the default view. Its history slider and recent event cards retain actual support changes over time, with added links in green and removed links in amber. Changed cells and links briefly flash when an update arrives. Returning to the starting topology does not erase earlier events. Connectivity can remain stable while coefficients change, and the display identifies these quantities separately. Learning weights displays the signed change in realizing gain energy relative to the offline energy of the same completed rows. Its color scale is shown explicitly and selected sources remain outlined. Coefficient change is the relative Frobenius norm of the actual learned gain correction. Learning weights can change without changing the strongest sources. During deployment both the selected support and retained discovery diagnostic stay fixed. Learn again starts new discovery.

Run collects 180 physical samples for learning, then automatically starts an independent four controller comparison. The right panel shows learning progress during preparation. The comparison clock and costs start at zero, while discovery topology history remains available. Ongoing attacks and unapplied requests continue across the transition. Decaying disturbances from the old plant do not transfer.

Saved trials restore paused in their original phase. Automatic transition resumes with live sampling. Step stays paused. Advance 180 executes exactly 180 samples across the phases and preserves ongoing attacks. Disable automatic comparison in Experiment settings to inspect a longer learning run or choose deployment manually. Forecast selection and Advance 180 are also in Experiment settings, keeping the main controls focused on playback and disturbances.

Curves use colors and line styles. Equal learned and fixed supports are identified explicitly. Gap to fixed sparse subtracts actual cumulative costs, while the table retains totals.

## Execution contract

Discovery follows the delayed update printed in Algorithm 1 of `manuscript.tex`. Predictions of the canonical disturbance are issued once and retained. After applying the bounded command, the observed next state reveals the actual disturbance. At round t, only completed rows through t − d are updated, with the gradient evaluated at the stored iterate from t − d. The projection preserves the printed temporal support set.

This has a consequence that the demo makes explicit. A completed row update never changes the current or future row used for control. Discovery therefore executes the offline predictive controller while fitting historical responses. Its three predictive cost curves coincide. Replacing this with shared parameters across time would change the algorithm.

The printed support projection also does not generally preserve response achievability. Historical learned coefficients are used for discovery only. They are never installed as a controller directly. The topology is selected from their realized prediction gain scores, then a new feasible controller is synthesized and deployed on a separate trial. This combines the manuscript update with a discovery and deployment workflow. It is not an online joint topology algorithm or a reproduction of the paper's reported cost percentages.

## Deployed prediction links

The selected support imposes hard zeros on the actual realizing gain `L = U − KX`. Sparse synthesis enforces these zeros together with predictive dynamics, temporal support and the initial boundary. The offline quadratic objective and fixed causal feedback are common to every predictive design.

The comparison uses four controllers

| Controller | Prediction messages |
| --- | --- |
| Learned sparse | Local source and three remote sources selected from completed learned responses |
| Fixed sparse | The same message budget selected from offline response scores |
| Dense prediction | Every source permitted |
| Feedback only | No prediction messages |

During deployment the selected support and controller coefficients remain fixed. Interventions still enter every compared physical plant identically. Starting another discovery experiment clears the deployed support.

These links carry predicted voltage forcing. They are not physical feeder lines. The fixed dense feedback still uses state measurements, so the plot does not represent total system communication or total communication savings.

## Reproduction

The checked in `index.html`, `environment.html` and bundled assets deploy directly to GitHub Pages. No external font is required. The interface uses the native system font and native SVG equipment artwork.

```sh
python3 build.py
node src/test-simulation.cjs
node src/test-interactions.cjs
node src/test-topology-timeline.cjs
node src/benchmark.cjs --json
python3 -m http.server 8000
```

## Numerical implementation

The preview depth is 5. The row regularizer is 10⁻⁶ in voltage forcing units. At each update the causal step is 0.05 divided by six times the sum of the regularizer and the largest completed row forecast energy. This declared varying step is not asserted to satisfy the manuscript's conservative constant step theorem.

Each completed response row starts at its offline design. Its exact delayed gradient iterates remain an offline row plus a rank one correction. The engine stores the correction coefficient and six delayed snapshots instead of duplicating large response matrices. The fixed data diagnostic copies the completed rows, continues the delayed update on its own optimization clock and compares it with the exact regularized row optimum. The live rows and topology stay unchanged. Resuming discards this diagnostic copy, and deployment always uses the actual discovery rows.

Finite horizon synthesis includes the terminal Riccati penalty and the initial and finite support endpoint conditions. A nullspace solve imposes forbidden entries of the realizing gain exactly. Continuing beyond a planning horizon starts a separately synthesized finite segment from the measured state. Existing segments, samples and cost history remain unchanged. Live plots show stage costs, while the benchmark adds the terminal penalty once at the end of its declared horizon.

## Paired deployment results

The checked in [benchmark results](benchmark-results.json) use seeds 1 through 20, 180 discovery samples and 180 deployment samples per seed. Deployment uses a separate deterministic random stream. All four controllers receive the same disturbances within each trial. The support budget and parameters were fixed before comparing costs. These runs contain no clicked interventions and no command saturation.

| Forecast setting | Learned sparse | Fixed sparse | Dense prediction | Feedback only |
| --- | --- | --- | --- | --- |
| Reliable | 0.01249219 | 0.01249074 | 0.01041358 | 0.01447046 |
| Uniform corruption | 0.01313935 | 0.01313797 | 0.01115768 | 0.01447046 |
| Mixed reliability | 0.01333664 | 0.01333637 | 0.01145050 | 0.01447046 |

Values are mean total costs including the terminal penalty. Learned sparse reduces mean cost relative to feedback only by 7.8 to 13.7 percent. It does not improve over fixed sparse on average and costs more than dense prediction. In mixed reliability, learned and fixed sparse tie on 14 of 20 seeds. This experiment therefore demonstrates an executed communication constraint, but does not establish a benefit from learned topology selection.

The manuscript is not included in the public repository. Plant and forecast assumptions are a declared interactive environment, not a measured utility dataset. Saturation is included in the executed plant. When it activates, the unconstrained linear response identities and guarantees do not describe that saturated trajectory exactly.
