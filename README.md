# Keeping the Grid Steady

[Open the experiment](https://tongxin.me/online-sls-demo/) · [Experimental environment](environment.html)

The default experience is a forecasted demand and solar cycle on the LinDistFlow feeder. It tests whether learned prediction links retain useful advance information while avoiding corrupted sources. All four controllers share the plant, physical power, raw forecasts, feedback, objective and limits. Earlier reference scenarios remain available in Experiment settings for reproducibility.

Unless another size is named, numerical values and archived studies below describe the original 24 bus reference. The Network menu selects 8, 24 or 47 buses.

## Interaction

On desktop the four panels use two independent content-height columns. The cost comparison follows Prediction links directly instead of waiting below the taller network card. Source inspection and disclosures reflow the same column. Phones retain the original network, links, voltage and cost reading order. Panel placement changes no sample, selection, controller or cost.

The main controls contain playback, Restart demo and the bus intervention. Learning advances to comparison automatically. Experiment settings holds playback speed, individual steps, power request strength and mode, alternative scenarios and manual comparison controls. Link history and Voltage details open on demand. All four controller curves and their measured costs remain available. Their shared curve key appears before the panels, so phone readers can identify methods before reaching the plots. The existing buttons still toggle only curve visibility, retain at least one curve and do not change any physical sample or cost. A crossed label marks a hidden curve without fading its text below readable contrast.

Press Run to collect 180 physical samples, then enter an independent comparison automatically. Comparison states and costs start afresh. The default scenario pauses after 180 comparison samples and offers Continue. Discovery topology history remains available. Ongoing attacks and unapplied requests continue across the transition, while decaying disturbances from the old plant do not transfer. At any completed planning segment, the inspected source action can corrupt or repair future messages while keeping the reviewed results paused. It does not extend the horizon or replace the default comparison’s Continue action. Existing issued messages and completed costs stay unchanged; Continue, Step or a bus action that explicitly starts playback applies the pending setting when new forecasts are issued. Existing saved trials are restored exactly. Restart demo clears the whole trial and returns to learning under the selected experiment settings. Rebuild prediction links in Experiment settings instead preserves the current source reliability map. Restore default scenario in those settings replaces an old or mixed trial with the default environment and starts playback.

The trial heading shows the current forecast configuration, including β and quiet/noisy source counts, without adding controls. These synthetic labels describe newly issued messages, not measured accuracy or actual voltage deviation, and are never supplied to the learner. At β 0 it says noise disabled rather than promising perfect forecasts of unannounced power attacks. Already issued messages remain sealed. Automatic learning guidance remains in the heading description for assistive technology and hover; comparison instead identifies fixed deployment. Restored reference trials keep their restored label and all previous costs. The phase badge distinguishes dense discovery from comparison. On comparison it reports the actual discovery sample count and confirms offline link selection and sparse controller synthesis. Automatic discovery uses 180 samples; manual comparison reports its actual episode length, which can differ from 180. Communication comparison fixes links and prediction coefficients. Prediction adaptation fixes links but continues correcting predictions. No joint online topology adaptation is implied. Reviewing topology history changes only the link view, not playback, the live plant, costs or deployed support. The header explicitly labels saved discovery links, and current source quality labels are suppressed there rather than attributed to the past. Latest or a matrix view change restores current links and source controls immediately, without stepping the plant.

Communication topology starts with the Forecast interaction. Click a bus to corrupt or repair its forecast source. The marked sources stay noisy until repaired. Only newly issued forecasts change. The learner receives observations, not these source labels. The final source reliability map carries into the independent comparison. Changing it during comparison leaves the deployed links fixed. Rebuild prediction links starts discovery under the current source map.

Choose Power disturbance to test physical recovery. Continuous mode maintains the selected additional requested kW per active bus. Each sample refreshes that bus’s continuous component instead of adding another overlapping request. Equipment bounds can reduce actual applied power. After stopping, the final continuous request follows the existing equipment decay; independently requested pulses retain their own tails. Click several buses to attack them together. Clicking an active bus again stops only that bus. The main Attack button acts on the selected bus. Stop all ends requests at every bus and shows the active bus count. Pause stops plant time and all repeated requests. In Pulse mode, click once for one request or hold a bus or Attack to repeat. Explicit pulses still accumulate. Old version 13 event logs without a continuous target marker replay their original stacked requests exactly; newly recorded target events replay the bounded protocol. Orange lightning badges show actual applied power in kW after equipment limits. Pending means the request will enter the next sample. Fading identifies residual power after requests stop. The final applied sample remains visible after a request expires, until a later physical sample reports no attack power. Switching the interaction stops new requests while existing disturbances decay.

On phones the feeder uses a taller 360 px drawing area with 12 px bus numbers and higher contrast. This separates equipment and labels rather than shrinking them to fit the desktop height. Desktop geometry remains 220 px high. Responsive resizing changes no feeder connection, power, forecast, controller or cost. The same bus actions and inspection marks remain available.

The matrix follows the selected plant with 3 by 7, 8 by 23 or 16 by 46 receiver and source entries. Every source column remains available. The larger matrix keeps readable entries through horizontal scrolling, with a visible cue when more sources lie outside the view. That existing cue names the fully visible source bus numbers and indicates the available scroll directions. Inverter row numbers and their axis title stay at the left edge while the larger matrix scrolls, and the source title stays over the visible columns. The range cue excludes columns covered by that label area. When an edge column is partly visible, its whole source number stays inside the viewport, with its existing guide pointing back to the actual column. Only the label and guide start move. The cells, support and source order do not move or disappear. Keyboard inspection keeps its focused source cell clear of the fixed labels. Every source and cell remains reachable. It follows native keyboard and touch scrolling, resizing, network changes and saved replay, without advancing the plant or changing source selection. Source numbers use staggered rows where needed. Keyboard and touch inspection use the same actual cells. Its heading names the controller represented by its links, Matrix adaptation during discovery and in saved discovery history, Learned sparse during communication comparison, or Matrix adaptation during prediction comparison. The existing budget line distinguishes candidates, fixed deployment and the actual saved discovery time. Inspection captions repeat the same controller name. Other policies retain their own sources; these marks do not describe a common topology for all four controllers. Inspecting a cell marks its physical source and receiving inverter on the feeder and emphasizes that exact remote link when present. A contextual caption beneath the network identifies the inspected source and inverter using the same dashed source and solid receiver rings. Their bus numbers appear in larger type inside their own inspected marks rather than below a neighbouring icon; the normal equipment icons return when inspection changes. Forecast and power badges remain visible. Selected matrix axis labels also use larger type. The caption names candidate, deployed or saved discovery context; its arrow appears only for an actual remote link. Local channels identify one bus. It is absent before inspection and adds no control. An absent link is never drawn for inspection. Local sources mark one bus. Inspection changes only the view, leaving faults, playback and controllers unchanged. The separate Corrupt or Repair source button changes the inspected source rather than the receiving inverter. It preserves pause state and affects newly issued forecasts only. Saved history is read only and zero noise disables this action. Source changes persist through comparison and Rebuild prediction links, while deployed links remain fixed. Connectivity shows actual selected links. Its history slider and event cards retain changes, with added links green and removed links amber. Learning weights shows measured changes in forecast gain energy. Coefficients may change without changing the strongest sources. Discovery links are candidates. Comparison links are deployed constraints on the controller. In the communication comparison, green and amber show differences from fixed sparse. The history controls still show actual discovery changes.

Inspecting a source also shows its latest raw voltage forcing forecast, revealed forcing and signed forecast minus forcing error in mpu. Issue, target action and reveal times identify the exact observed pair in chronological order. The existing observation readout uses 12 px labels and notes with 16 px values. Its unit note explicitly distinguishes voltage forcing error from bus voltage, and the signed error is emphasized without treating its sign as a good or bad control outcome. Current reliability is not retroactive and already issued messages stay unchanged. Error can include unforecast physical changes, not just source noise. Discovery uses dense messages even when a displayed candidate link is absent. Comparison labels whether the source is permitted by the inspected receiver’s fixed deployed support. Saved topology history hides current observations.

The inspected source also reports raw forecast RMSE and signed mean error over at most the last 60 revealed pairs in the current phase. The window can contain multiple reliability settings and unforecast physical changes, so it does not identify pure source noise or prove improvement. The latest setting readout separates first issue time, forecast target and first revealed pair, with the number of window pairs issued under that setting. Reset seals the initial five messages, so a toggle at time 0 first affects the message issued at time 1 for target action 5, observed at time 6. At later time t, the first new target is t + 4. A new message may affect the current preview command immediately at issue, before its target is observed. Repeated paused toggles use the latest setting for future issuance, without rewriting messages or errors. The display resets its window for fresh comparison, hides current statistics in saved history and preserves version 13 replay. It never changes learning, feedback or the physical stream.

The command disclosure reconstructs the latest receiver action for all four controllers in kvar. It separates the inspected raw source, all other prediction messages, shared feedback, the unbounded request and the bounded command. Prediction terms sum every temporal block of the preview actually issued for that action. For matrix adaptation, raw source attribution uses the actual gain L C, not an intermediate corrected channel. The source gain norm is a visible table column in pu command per pu forcing, available when the disclosure is opened by keyboard or touch without hovering. It is the Euclidean norm of that raw source's actual temporal gains across the issued preview, independent of forecast amplitude. A zero source command does not by itself imply a zero gain or an absent link. Keyboard cell inspection uses arrow keys, Home and End, with one cell in the tab sequence. The command table is a labeled keyboard focus target; arrow keys scroll narrow tables and Space retains native scrolling rather than starting playback. Its method column stays visible while panning across the existing command terms, with 12 px table text and readable unit notes. All four methods, every term and the gain norm remain available; scrolling and opening the disclosure change no trial data. Inspection and disclosure activation do not advance the plant or change source reliability. Highlighted links and the support label refer to Learned sparse or Matrix adaptation, while other policies may use different sources. A permitted link can have zero gain in a particular row. These are additive terms before limiting, not causal shares of the limited command. No future realized forcing is used and this read only view changes no controller or cost.

During fixed communication comparison, the inspected link also shows fixed and learned sparse selection side by side at their actual remote budgets. Discovery score is mean squared temporal gain energy over the recorded scored discovery actions. It is distinct from the gain norm of the actual resynthesized row. The receipt reports each policy's inspected raw source term and bounded receiver command for the latest executed action; command includes every prediction source and that policy's feedback state. These are measured policy outputs rather than a counterfactual causal attribution to one link. Local channels are mandatory and excluded from the remote counts. Pending execution has no fabricated gain or command; saved discovery history hides current execution. Source changes during comparison do not rewrite frozen scores or past commands. The existing four-controller breakdown remains available.

The communication comparison labels the four curves Learned sparse, Fixed sparse, Dense prediction and Feedback only. The link count shows the common sparse budget and replacements relative to fixed sparse. The Total cost and Difference buttons switch the chart directly while playback continues. Difference subtracts the actual fixed sparse cumulative cost in communication comparison, or scalar adaptation in prediction adaptation. The caption names the reference and the table always retains totals. Saved runs preserve the chosen view.

Voltage diagnostics retain all four controllers. Now is the largest absolute bus departure from its own nominal voltage, and Peak is the largest executed departure in the current discovery or comparison phase, including the initial state. Values use mpu, where 1 mpu is 0.001 pu. Limited counts inverters whose last reactive command was clipped. Peak is not an attack-only recovery time or a guarantee of settling under continuing background power. Comparison and reset start new peak histories.

Physical attacks do not automatically separate these curves. The controller has the form `u = Kx + prediction`, and every policy uses the same K. For fixed deployed controllers without saturation, adding an unforecast power disturbance produces the same additional state and input response in every policy. Their total quadratic costs include this common response and cross terms with their different background trajectories. Large sustained attacks can therefore make percentage differences very small even when the learned links and predictive commands differ. No attack costs are removed from the displayed totals.

Saved trials restore paused. Step stays paused. Advance 180 preserves attacks across automatic comparison. Experiment settings can disable the automatic transition. Playback speed changes only viewing pace, with interpolation between physical samples. Each sample still represents one second.

Voltage and stage cost captions retain their full units and actual power timing text. On phones the power timing annotation uses its own line rather than competing with the cost label; an empty forecast-mode annotation adds no line. Queued, first affected state and next-action cost remain distinct. This is layout only, not a change to when physical costs are charged.

Chart markers use the immutable simulation event log. A forecast setting marker appears immediately at the actual toggle time, including while paused, and distinguishes marked noisy from marked quiet. Its first eligible issue, target and reveal times do not promise that a message changed, since later toggles before issuance can replace the setting. Issued forecasts stay fixed. Power markers identify bounded requests after execution, at the first affected state time, rather than claiming every requested kW was applied. Solar events, power requests and forecast changes have separate counts in mixed groups. These annotations change no controller, sample, cost or saved replay.

## Bounded solar outage

Experiment settings retains Reference and adds a 20 second solar outage in held out comparison only. In the 24 bus reference, solar active output at four existing sites goes to zero at actions 30 through 49 and restores at action 50. Inverters remain grid connected with unchanged reactive support. Lost generation is bounded by existing site limits, at most 360 kW total and nominally 320 kW. The outage is absent from forecasts, leaves discovery and deployed supports unchanged, and may add a largely common recovery cost. Requested and applied power and actual event markers remain visible. Changing scenario starts a fresh trial. No gains, costs or baselines are retuned.

See [environment](environment.html) and the [paired audit](benchmark-stress.json) for physical bounds, all predefined seeds, reference/outage outcomes and matched-reference recovery. This preset does not claim a universal prediction advantage.

## Forecasted demand and solar

The default scenario is `forecasted-demand` at β 4 with the unchanged demonstration seed 20261013. It adds known 60 second operating envelopes to the original stochastic background with a 6 kW scale. Household demand varies by ±35 kW, solar generation loss varies from 0 to 30 kW, and battery power varies by ±15 kW. Household and battery phase is `2π (bus mod 6) / 6`. Solar loss is `15 (1 − cos(2π t / 60))` kW. Existing equipment bounds remain in force. These constructed profiles represent aggregate load schedules, a passing cloud and charging schedules rather than measured utility traces.

The physical schedule enters the base power before voltage forcing and forecast noise are formed. Its five sample preview includes the current action. A target action t is issued at max(0, t − 4) and observed at state t + 1. The same sealed forecast and physical base drive every controller. Manual power attacks remain unforecast additions, and their costs are never removed from a trial.

The scenario declares low error for the eight inverter forecast sources and high error for the fifteen household estimates. Source messages estimate feeder voltage forcing, not simply the source bus's own power. Quality classes are synthetic assumptions and are not supplied to the learner. Quiet and noisy errors retain the original multipliers 0.05β and 4β on the fixed background forcing scale. At the default β 4, this is a substantial corruption test. Mandatory local inverter sources initially remain useful, while remote household forecasts can be rejected through learned communication. Corrupting every source removes that useful information and need not help any predictive controller.

Controller synthesis, objective, feedback, actuator bounds, learning rules and link budgets are unchanged. Learned and fixed sparse controllers are resynthesized under their respective supports before comparison, and then use fixed coefficients. No favorable seed is selected. The original topology protocol is transferred to a different physical environment and information model, so its paper percentages are not reproduction targets.

The [complete forecasted scenario audit](benchmark-forecasted-scenario.json) distinguishes exploratory seeds 1 through 5 from held aside seeds 21 through 40. It retains every outcome at β 0, 1, 2 and 4, the unchanged demonstration seed, all four full costs, selected links, voltage ranges, saturation, paired uncertainty intervals and the case with every source corrupted. Low noise can favor dense prediction. Full physical costs remain included in every case.

## Forecasted scenario results

The table reports mean total cost over the twenty held aside seeds 21 through 40, including the terminal penalty once. Live curves display accumulated stage costs and do not add that terminal penalty. The physical profile and default corruption setting were chosen from the exploratory grid before examining the held aside results. The archived exploratory grid contains all 45 cases over seeds 1 through 5, physical scales 0, 1 and 2, and β 1, 2 and 4. The final engine independently reproduces every selected scale 1 pilot case and unchanged reference checks. The published generator evaluates the final engine directly, without source substitution.

| Forecast error β | Learned sparse | Fixed sparse | Dense prediction | Feedback only |
| --- | --- | --- | --- | --- |
| 0 | 0.082269 | 0.082269 | 0.067451 | 0.088166 |
| 1 | 0.075081 | 0.084760 | 0.073087 | 0.088166 |
| 2 | 0.075084 | 0.092241 | 0.089919 | 0.088166 |
| 4 | 0.075095 | 0.121627 | 0.150164 | 0.088166 |

At the default β 4, learned sparse reduces mean cost by 38.26 percent against fixed sparse, 49.99 percent against dense prediction and 14.83 percent against feedback only. The corresponding paired bootstrap 95 percent intervals are 37.50 to 39.05, 48.42 to 51.79 and 14.71 to 14.93 percent. It wins all twenty paired comparisons against each baseline and replaces nineteen of the twenty four remote links. Its commands never saturate in these trials. Its lowest absolute bus voltage is 0.98507 pu. The control objective tracks the declared nominal feeder profile rather than a flat 1 pu target.

The advantage is conditional. Dense prediction wins every seed at β 0 and nineteen of twenty at β 1. When all sources are corrupted, feedback only wins all five declared ablation seeds and learned sparse costs 29.86 percent more on average. Adding unexpected physical overload can still dominate accumulated cost. Every outcome remains in the audit.

The unchanged demonstration seed also benefits beyond startup. Over comparison actions 30 through 179 and the terminal penalty, learned cost remains 14.76 percent below feedback. The audit verifies that changing or removing reliability labels and schedule metadata from completed samples does not change the calibration result. The learner uses only forecast and revealed forcing pairs.

## Reference communication experiment

The background only reference retains β in 0, 0.25, 0.5, 1 and 2 and its original β 1 benchmark. Its feeder, background power generator and source map are unchanged. These settings describe the reference rather than the new default operating cycle.

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

## Extended forecast stress

The same selector also offers β 4, 8 and 16 as additional feeder stress tests. The reference grid and its β 1 benchmark remain unchanged. The new default operating cycle is documented separately above. Only the synthetic Gaussian forecast error amplitude changes. Noisy sources retain 80 times the standard deviation of quiet sources, with the same standardized draws and the same physical disturbance stream. These additional levels are outside the manuscript reference grid and are not a reproduction of its reported percentages.

The caption gives the selected source's configured noise standard deviation in mpu of voltage forcing. It is not an actual bus voltage deviation. For example, corrupting bus 7 at β 8 changes its noise SD from 0.106 to 8.52 mpu. The forecasts are still immutable once issued. Changing β starts a fresh discovery and comparison, clearing previous physical attacks and accumulated costs. Within a trial all physical costs remain included.

The [complete forecast stress audit](benchmark-forecast-stress.json) reports every seed from 1 through 20 at β 1, 2, 4, 8 and 16. Every forecast trial has a paired physical stress trial with identical issued forecasts and selected supports. The physical diagnostic requests 100 kW at all 23 controllable buses on each of actions 30 through 49. Overlapping requests can accumulate several MW of extra demand. This archived diagnostic uses additive pulse requests rather than the bounded Continuous mode. This extreme diagnostic measures cost dilution and is not a realistic feeder operating recommendation. The report retains actual power, forecast and feedback command contributions, voltage ranges, saturation and every controller's full cost.

| Forecast stress β | Learned sparse | Fixed sparse | Dense prediction | Feedback only |
| --- | --- | --- | --- | --- |
| 4 | 0.032484 | 0.042487 | 0.075518 | 0.014470 |
| 8 | 0.078853 | 0.108675 | 0.195165 | 0.014470 |
| 16 | 0.154798 | 0.227436 | 0.374975 | 0.014470 |

These means use forecast stress alone and include the terminal penalty. At β 4, learned sparse saves 23.54 percent against fixed sparse and 56.99 percent against dense prediction. At β 8, the savings are 27.44 and 59.60 percent. At β 16, they are 31.94 and 58.72 percent. Learned sparse beats both predictive baselines on all 20 seeds at every additional level, while feedback only beats learned sparse on all 20. Stronger errors therefore expose prediction selection differences without establishing an advantage over ignoring predictions. In the paired severe physical stress at β 8, the savings fall to 0.13 and 0.55 percent because common physical recovery dominates the total costs.

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

## Learning and comparison

A persistent two stage strip shows learning and comparison before the run starts. Learning uses observations to select prediction links. At the automatic boundary the controller is synthesized under the selected support and an independent comparison begins from a fresh state and zero accumulated cost. The strip explains this reset before and after it occurs. Both stage labels and the Experiment results heading stay in place, while the plot subtitle identifies learning progress or controller comparison. Actual recorded discovery and comparison sample counts remain visible after replay, manual deployment and continuation. Looking at saved topology does not change the current experiment stage.

The existing cumulative cost table now includes each controller's actual remote prediction link count beneath its name during communication comparison. Local prediction channels and shared state feedback are excluded. This replaces the duplicate cost and communication scatter, second cost table and four stage receipt. The exact costs, baseline differences and all four methods remain in the primary comparison. Discovery does not present candidate sparse budgets as deployed communication. The automatic transition and ongoing attack behavior are unchanged.

Across forecast quality contains the recorded twenty seed sweep at every published error level and a separate five seed case with every source corrupted. All four methods and all recorded settings remain visible. These study costs include the terminal penalty, unlike live cumulative stage costs. The generated fragment can be checked with `node src/build-reference-study.cjs --check` and `node src/test-reference-study.cjs`. It does not reset, alter or substitute for the current live experiment.

Its compact overview contrasts reliable forecasts, mixed source reliability and the separate all corrupted case. Every case retains all four mean cost ratios on one common bar scale and names the actual lowest mean. Available paired savings intervals stay attached to their recorded comparison; the five trial counterexample explicitly has no reported interval. All four error levels, coincident results and complete uncertainty tables remain in the nested detail. This presentation changes no numerical result or live experiment.

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
node src/test-forecasted-scenario.cjs
node src/test-interactions.cjs
node src/test-topology-timeline.cjs
node src/benchmark-communication.cjs --json
node src/benchmark-forecasted-scenario.cjs --json
node src/benchmark-forecast-stress.cjs --json
node src/benchmark.cjs --json
node src/benchmark.cjs --attacks --json
python3 -m http.server 8000
```

## Cloud validation

Every branch push and pull request runs the six numerical and interaction test suites, builds the page and checks the real browser interactions. Browser checks cover ordinary playback, repeated forecast clicks, continuous power attacks through automatic comparison, thirty live cost view switches and a narrow touch layout. The workflow saves desktop and mobile screenshots as evidence. These smoke checks do not replace visual review or scientific benchmarks.

Cloud changes use a new branch beginning with `cloud/refine/`. Push source edits to that branch without editing the generated page by hand. After validation succeeds, a separate job with write access commits only the tested `index.html` to the same candidate branch. It checks that the remote branch still equals the tested source commit and uses a lease when pushing. It never updates `main`. Main and pull request runs require the checked in page to match the build.

Before promotion, read both successful jobs and the final candidate commit, confirm that the source changes are intended and that the branch still descends from the expected main commit. Update `main` to that candidate with an expected head check. Verify the subsequent main validation and GitHub Pages deployment before calling the update live. A failed or cancelled candidate stays unpublished. The build commit uses the repository Actions token and does not trigger another workflow run.

The cloud browser dependency is pinned to Playwright 1.56.1 and installed only in the runner temporary directory. It does not add a production dependency.

Browser evidence also includes `timings.json`, updated at interaction milestones even before the smoke suite finishes. Numerical and browser assertions are unchanged when test transport is reduced to the fields each assertion uses. Full saved-state invariance checks remain full comparisons. Timings describe cloud test execution, not browser interaction latency or a scientific benchmark.


## Network scenarios

The main Network menu selects an 8 bus toy, the original 24 bus feeder or a 47 bus feeder. Selection starts a fresh paused discovery and clears old attacks. Restart retains the selected network. Saved trials retain their network ID and replay on the corresponding model. Legacy saved trials without a network ID remain 24 bus trials.

The toy is the reference subtree on buses 1 through 8, with inverters 5, 7, 8 and two remote sources per inverter. Its sparse and dense remote budgets are 6 and 18. The larger feeder duplicates the 23 nonslack reference buses at a shared slack, mapping the second copy by j→j+23. It repeats line impedances, equipment roles and scheduled phases, with a shared background component and independent local innovations and forecast errors. Its 16 inverters retain three remote sources each, giving 48 sparse and 720 dense remote links. Per device ratings, cost weights, timing and learning rules stay unchanged. Each network gets its own state dimension, constrained synthesis, observed learning and measured comparison. Total costs sum over the current network and cannot be compared across sizes without accounting for that size.

All buses and source columns remain available. The larger network and matrix have keyboard accessible horizontal scrolling on narrow screens. Recorded forecast quality results remain scoped to 24 buses and are hidden for other sizes. Conditional prediction benefits are evaluated separately for each size rather than assumed or copied from the reference study.

Run `node src/test-network-scenarios.cjs` for physical and controller checks and `node src/test-network-browser.cjs` for switching, attacks, automatic comparison, saved replay and responsive layout. The numerical audit uses the same declared seeds and conditions across all sizes and retains unfavorable outcomes.


The [network size audit](benchmark-network-scenarios.json) reports all 60 trials over seeds 21 through 25, using 180 learning and 180 fresh comparison samples. Each size runs reliable forecasts at β 0, mixed reliability at β 2 and 4, and all sources noisy at β 4. Dense wins every reliable case, learned sparse wins every mixed case, and feedback wins every all noisy case. These are observed outcomes for the declared constructed feeders, not a universal size scaling guarantee. No seeds or losing cases are omitted.

At mixed β 4, mean learned savings against feedback are 10.72%, 14.83% and 14.79% for 8, 24 and 47 buses. With all sources corrupted, learned costs exceed feedback by 55.99%, 29.86% and 30.17%. Audit totals include the terminal penalty; live charts retain accumulated stage costs.

For the larger feeder, synthesis separates the physically independent radial components at the fixed slack and assembles their full state and input responses. This solves the same constrained quadratic. A direct comparison checks every response coefficient against the full model, including permitted cross component channels whose optimal response is zero. Learning remains joint across all forecast coordinates, including their shared background component.
