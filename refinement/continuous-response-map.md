# Continuous predictive response implementation map

Audit of public main ad240dba37538d5ea0baf7d1354348fa32a9ad09 on 18 October 2026.

This is ordinary demo engineering documentation. No private manuscript was used. The live default is still the archived frozen communication protocol. This map and a candidate numerical foundation are preparation for a new protocol, not a completed algorithm fix.

## Executed public data path

| Concern | Public implementation | Executed meaning and change required |
| --- | --- | --- |
| Trial construction | src/interface.js optionsFromControls and src/interface.html experiment default | The UI chooses communication, forecasted demand, beta 4 and horizon 180. Simulation alone defaults to prediction and horizon 480. Do not infer the shipped default from the engine constructor alone. |
| Forecast issuance | Simulation.sealPreview in src/simulation.js | Target action s is issued once at max(0,s-4). Reset seals targets 0 through 4. Both entry and forecast vector are deeply frozen. Each action extends the sealed prefix before using its preview. |
| Reliability switch | Simulation.toggleFault and sealPreview | A switch changes future issuance only. A switch at t greater than zero first affects target t+4, revealed at state t+5. A switch at zero first affects the message issued at 1 for target 5 and revealed at 6. A new raw message may enter the preview before its target is observed. This immediate message effect is different from a learned weight change. |
| Physical input | Simulation.step and voltageFrom | One bounded power sequence drives all four policies. Each policy has its own state, inverter lag and clipped command. Forcing is recovered using the actual bounded command and shared physical model, then stored after execution. Current action truth cannot enter its own action correction. |
| Revealed training pair | Simulation.samples and updateCalibration | At action t only samples with action at most t-1 are available. A pair is raw issued forcing forecast and recovered forcing, not voltage minus its nominal profile. Unforecast power contributes to the error. |
| Shared experimental estimator | src/forecast-calibration.js fit and compatibleMask | Fit uses at most 60 revealed pairs and starts after 30. It minimizes mean squared forcing prediction error plus a Frobenius ridge around identity. The physical model scales lambda independently of seed, support and outcomes. Matrix and scalar restrictions are distinct. This is not literal manuscript Algorithm 1. |
| Calibration stop | Simulation.updateCalibration | The early return for deployment plus communication stops all correction updates. The alternate prediction experiment continues fitting with the carried discovery window and a support compatibility mask. |
| Actual prediction gain | Simulation.step | Before the freeze, online executes L times C and scalar executes scalar times L. Communication deployment instead supplies raw forecasts to each fixed L with C equal to identity. Removing a label or animating recommendations would not alter this branch. |
| Response synthesis | src/response-controller.js Synthesizer.factor and column | The solver uses a nullspace to satisfy forbidden actual prediction gains. It constructs correction maps X=Bz, U=z_next-a z and L=U-KX. Finite horizon endpoints and the terminal Riccati penalty affect the response. Larger feeder component assembly is checked against the full quadratic. |
| Candidate source scores | Simulation.refreshScores and calibratedScores | Discovery communication scores average squared executed L C row entries over actions 30 through the last discovery action. Recommendations select local plus the network remote budget. Discovery commands remain dense even when a candidate cell is absent. |
| Actual deployed support | Simulation.deployTopology and addSegment | Deployment selects learned and fixed sparse masks, resynthesizes under them, and freezes their score evidence. A permitted edge can have zero effective gain. Recommendations are not an online support deployment mechanism. |
| Reset boundary | Simulation.deployTopology | It archives discovery, changes the seed by xor, changes the phase and calls reset. Plant time, costs, states, samples and histories restart. Continuing calibration alone does not remove this reset. |
| UI boundary | startAutomaticComparison, enterComparison and advanceLiveSample in src/interface.js | At 180 discovery samples automatic deployment creates the fresh comparison. comparisonComplete then stops default playback after 180 comparison samples. These are two separate boundaries and both are superseded for new continuous trials. |
| Engine endpoint | Simulation.step and extend | The engine stops at options.horizon. extend appends a newly synthesized finite segment without resetting the current state or accumulated costs. A continuous protocol must handle planning automatically and expose any coefficient change due to planning separately from learning. |
| Diagnostic update | addCompletedRow, advanceRows, updateResponses and fitStep | The delayed completed row beta updates and frozen prefix convergence diagnostic are retained legacy diagnostics. Their beta values do not enter the executed command loop. They cannot be renamed Phi and presented as the fix. |
| Command inspector | commandContributions in src/interface.js | It reconstructs effective raw source gains from the last executed row, the actual correction and preaction costStates. It must use the exact parameter version used for that command, rather than a newly fitted parameter snapshot. Source and other prediction terms plus feedback sum before clipping. |
| Gain and support display | predictionDiagnostics, directGain, topologyFrame and TopologyTimeline | directGain is the square root of score energy, not a signed current response coefficient. Communication deployment replaces diagnostics with frozen discovery evidence. A new display must distinguish signed deployed gains, norms, permissions and candidate scores. |
| Replay | save, replayRecord and hydrate in src/interface.js | Version 13 saves initial options, discovery record, phase, event log, network and UI state. Replay reconstructs discovery and calls deployTopology before the second stream. New ongoing trials require an explicit new protocol identity and schema while preserving old replay. |
| Long history | samples, history, eventLog, rows and snapshot | Arrays and historical state copies grow. Legacy response rows are repeatedly visited and many UI readers scan full history. Evaluate long run cost and memory explicitly. Keep cumulative totals and full event evidence honest if plot or estimator windows are bounded. |

## Physical and scientific invariants

The physical state model and units, Q, R, terminal P, common K, inverter lag, actuator limit of 70 kvar, power bounds and current attack protocols remain shared. Forecasts remain immutable. Realized physical input and recovered forcing must match across policies within numerical tolerance. Local source permission is mandatory. Remote budgets are 6 and 18 sparse and dense for toy8, 24 and 176 for feeder24, and 48 and 720 for feeder47. These exclude local prediction and common state feedback.

The existing communication protocol compares frozen coefficients after a fresh test stream. Its published percentages and all archived seeds remain evidence for that protocol only. Existing prediction adaptation compares a shared matrix correction with a scalar correction and combines selection with correction. A new adaptive sparse versus fixed sparse experiment has a different question and must say so explicitly.

## Feasible response meaning

Let a denote the inverter lag, F=A+B K, and let X and U denote the predictive correction maps constructed by the public synthesizer. The nominal closed loop response supplies the identity disturbance term. The predictive correction has homogeneous dynamics.

```text
X_next = A X + B U
L = U - K X
X = B z
U = z_next - a z
L = z_next - (a I + K B) z
```

A common right correction D applied to every temporal X and U block preserves that homogeneous recursion and temporal endpoints. A diagonal D also preserves every forbidden raw source column of L. The total frozen candidate response is nominal feedback response plus X D and U D. Tests must verify the recursion, boundary rows, L relation and forbidden gains directly.

D changing between actions yields adaptive preview feedforward with the same feedback law. The executed trajectory is not one fixed lifted response. Frozen candidate feasibility does not by itself prove stability under arbitrary adaptation or saturation. Validate the actual switched execution and actuator behavior independently and do not claim a theorem.

## First implementation target

Use an explicitly versioned continuous protocol and keep the archived protocol implementation for old saved trials and references. Keep one physical clock and accumulate costs from its first action. Do not call deployTopology to enter ongoing operation. Do not route an ongoing trial through comparisonComplete. Explicit Restart may still start a new trial.

The first candidate will investigate continuous source local diagonal calibration as a transparent restriction of the public mean loss objective. This is a declared experimental protocol choice, not a claim that the existing matrix estimator or an unavailable manuscript has been implemented exactly. Each source fits only its own issued forecast and revealed forcing. Coefficients use the existing physical lambda, 30 observation warmup and 60 pair window. The source sends its coefficient with an admitted forecast message. A sparse receiver receives only its allowed source messages and coefficient metadata. Common full state feedback is already an explicit shared assumption and is distinct from remote prediction channels.

```text
c_j(t) = (mean revealed forecast_j * forcing_j + lambda)
       / (mean revealed forecast_j^2 + lambda)
D_t = diag(c_j(t))
effective_prediction_gain[t,k] = L[t,k] D_t
```

Do not centrally expose excluded forecasts or their learned metadata to an adaptive selector. Start with a deterministic offline support that uses no future outcomes, keep that support fixed for the first release, and display changing weights honestly. Online adaptive sparse, fixed sparse, dense prediction and feedback must share the physical input. The frozen predictive baselines retain identity correction. Any stationary planning kernel needed to avoid finite episode end effects must be synthesized and checked under the same model, weights and support for all predictive methods, and its difference from the archived finite episode baseline must be explicit.

A stationary kernel is a candidate planning choice rather than an already verified result. Extract an interior response only after checking temporal support, both ends of each full predictive column and the full quadratic reference. Document initialization with unavailable negative target messages and the maximum admitted preview. Otherwise retain explicitly labeled finite planning resynthesis with no physical reset and distinguish its coefficient changes from observed learning.

This first target does not promise support reselection. A later reselection proposal must state its probing traffic, actual source information available, update schedule, fixed budget, resynthesis and feasible handoff. No offline score or a hidden all source calibration can be presented as free online topology learning.

## Display and execution acceptance

Store the exact action parameter version before control. Source error, coefficient, actual effective gain, allowed support, prediction contribution, bounded command and subsequent voltage or cost must refer to compatible action times. Show candidate scores only when they are explicitly candidates. A zero gain is different from a removed permission. Add a measured update count and history of actual deployed weights to the existing panels rather than another dashboard.

New trials must run through actions 180, 360, 480 and beyond without automatic stopping or resetting. Old replay retains its original clocks and reset semantics. The first integrated candidate remains unpublished until numerical and browser evidence demonstrate actual ongoing commands, source access, replay, all three sizes and the single live workflow. A standalone estimator or a documentation publication is not a completed continuous adaptation fix.

The predefined protocol and test streams are recorded in continuous-response-plan.json before implementation. A full performance study is deferred until the causal and feasibility contracts pass. Report every declared result when such a study runs. No numerical superiority claim follows from this map.

## Candidate ongoing engine protocol

The unpublished candidate implements an explicit continuous-phi-v1 engine option. The shipped UI default remains the archived protocol until the ongoing interface, replay integration and browser acceptance are complete. Node tests select the option explicitly. New engine records use version 14 and an explicit protocol identity. Legacy construction and the existing version 13 UI replay remain unchanged.

The first ongoing support is selected once from the dense stationary response energy before observing any trial data. Adaptive sparse and fixed sparse have that same mandatory local support and per network remote budget. Adaptive sparse applies source local diagonal coefficients. Fixed sparse and dense prediction retain identity correction. Feedback retains the same K without prediction. This isolates actual weight adaptation on a fixed support rather than presenting recommendations as topology changes. No online selector or probing traffic exists in this version.

Each source fits its own issued forecast and revealed forcing with the public physical ridge, 30 pair warmup and last 60 pairs. Revealed forcing is available under the existing full state feedback and known bounded actuation assumption. That shared feedback assumption is stated separately from remote prediction communication. No receiver obtains an excluded source forecast or its learned coefficient through cross source calibration.

A source coefficient is sent with each admitted newly issued raw forecast. The receiver caches immutable raw messages and applies its latest admitted coefficient to the finite predictive row. At startup there are five target messages per permitted channel. Each later action adds one new target message per channel. The reported counts distinguish local and remote forecast messages, correction scalars and zero probing messages. A permitted channel with zero effective gain still sends and counts. The mailbox retains at most ten target packets, while physical samples, executed history, forecast issuance and cumulative costs remain complete.

The ongoing response uses the same finite memory depth of five and unchanged physical quadratic. It synthesizes a horizon of 4 times depth plus 1 only to obtain startup columns and an interior translation invariant column. The first five targets use their actual initial boundary columns with X at time zero equal to zero. Later targets translate the interior column, whose correction is zero at both temporal ends and whose terminal is outside the correction window. The current row uses targets from max of zero and action minus five through action plus four. Thus no negative target forecast or future issuance is required. There is no finite experiment endpoint or periodic planning switch.

This stationary finite memory planning convention is a declared change from the archived finite episode response and its terminal penalty. All ongoing predictive policies use the same convention, physical Q and R, support constraints and shared feedback. Live costs accumulate the same physical stage costs from action zero. Current terminal cost remains a diagnostic and is not added to those accumulated live costs. Archived finite episode evidence retains its original terminal penalty and cannot supply performance percentages for this protocol.

Before each action the engine reveals exactly the preceding physical prefix, updates local sources, admits new source messages and seals the parameter version used for control. The execution receipt records feedback, prediction, raw and bounded commands for every method. Adaptive sparse also records source contributions, signed current target gains and received coefficients with null for excluded sources. Source local fit reports, deployed permissions and effective nonzero gains have separate meanings. A source report in a diagnostic is not proof its metadata reached every receiver.

The engine continues automatically beyond 180, 360 and 480 without changing seed, plant state, source history or accumulated costs. Explicit Restart remains a new trial. Old freeze and deployment entry points refuse to reset an ongoing trial. The new engine record replays forecast switches, additive pulses and bounded held target requests causally on the same network. The UI still needs to adopt this record without a version selector.

Independent checks reconstruct the full nominal plus scaled predictive affine dynamics, both temporal ends and startup, compare the larger feeder interior synthesis with the full quadratic, reconstruct executed commands and clipping, audit traffic, test the actual reveal delay and replay all predefined corruption and power streams. The predefined 18 conditions cover every original acceptance network, quality case and seed for 901 actions and report every stage cost. A separate 1801 action check retains history and costs. These are correctness tests rather than a tuned performance study.

An action varying diagonal correction yields adaptive feedforward with shared feedback. Each frozen candidate is feasible under the documented response equations. This does not identify the entire switched trajectory as one fixed lifted response or establish a stability theorem under arbitrary adaptation or clipping. Full ongoing UI interactions, long playback performance and pixel review remain publication gates.

Equal sparse link budgets do not imply equal scalar payload. Adaptive sparse sends an additional correction scalar with each raw forecast message. The explicit traffic counters retain that overhead and shared state feedback remains separate. No byte price or numerical communication penalty is invented.


## Ongoing interface integration candidate

The version 14 restore route now renders one physical clock with continuous corrections and the existing four controller comparison. The default remains the archived protocol until ongoing browser and pixel acceptance. This temporary candidate gate is not a protocol selector exposed to users. Version 13 restoration retains its exact legacy execution. New ongoing trials created by restart or network switching retain protocol 14.

Command inspection reads the immutable last execution receipt. It separates received source correction from source local diagnostics, signed current target gain from temporal gain norm, additive source contribution from bounded command, and fixed support from effective weights. An excluded source has no received coefficient. Fixed sparse and dense retain identity correction. Adaptive sparse sends an additional correction scalar per admitted forecast. The same link count therefore does not imply the same payload. There is no online probing or topology reselection.

The cloud browser suite predeclares all three network sizes at desktop and phone widths with actual visible playback, corruption and repair across old boundaries, arbitrary multi bus held attacks, cost switching, five 180 action advances beyond 900 actions, exact saved UI replay and fresh paused network changes. Screenshots are evidence capture only until their actual pixels have been inspected. This integration remains unpublished.

The matrix uses the last executed stationary row and its admitted source correction, with the receipt action recorded in diagnostics. Before the first action there is only an initial feasible response and no executed action. The topology observer accepts the ongoing phase but records a link event only for a real support change. Weight changes alone never create topology events. All observed samples and executed receipts remain retained; growing history performance remains an explicit ongoing browser acceptance condition.

## Ongoing UI acceptance checkpoint

All 251 numerical and interaction cases pass, as do the original browser checks and both archived network suites. Independent ongoing desktop trials pass at more than 950 actions on all three networks, with exact version 14 restoration and no reset or automatic stop. Phone header touch activation currently sends one held target request and starts playback but immediately loses the active latch. It is a real unresolved interaction failure and blocks release. The next cloud diagnostic records pointer down, up, cancel, lost capture and synthesized click properties. Keep all existing touch cancellation and zero detail protections.

Cloud screenshots were captured but their pixels were not inspected. The connector only accepts UTF-8 content and cannot decode PNG blobs. The archive checkpoint therefore additionally stores the identical PNG bytes as an ASCII base64 Git blob. Its base64_text_sha can be read through the UTF-8 connector and emitted as an image without local files. This wrapper still requires a successful cloud run and actual pixel review. No direct live browser fallback is authorized by this diagnostic. The default remains archived and the candidate remains unpublished.

## Executed response inspection and phone acceptance

The candidate records and displays a signed current target gain at every executed action in the existing source inspector. It uses immutable receipts and admitted receiver coefficients, never source local fit reports or future actions. Excluded channels show zero effective gain and no received correction. The full issued preview still determines the additive source contribution and bounded command in the same table. The trace is not a new cost comparison or topology activity diagram.

The existing comparison now reports cumulative remote forecast values and extra correction values separately from allowed link counts. Startup preview traffic is included. Timing and version metadata are disclosed; this is a logical numeric payload count, not measured wire bytes or a communication price. No probing occurs. Source local fitting and operator diagnostics are separate from admitted controller messages and common feedback.

Actual prior screenshots show a malformed ongoing strip because hidden stage numbers leave the text in their grid column. Ongoing observation and execution now use full width parallel status columns without finite progress tracks. On phones the Stop all control receives a separate row so its appearance cannot shrink the tapped attack target or occupy the release position. Existing cancellation and assistive activation behavior remains unchanged. Real touch activation geometry and persistent multi bus attacks must pass before release. The default stays archived while acceptance is incomplete.

Actual phone pixel review also found horizontal axis captions touching numeric tick labels. The shared chart frame now reserves 38 pixels below the marks, and the signed response chart is 125 pixels tall. A real rendered glyph box assertion checks separation for every visible horizontal chart axis on desktop and phone. No plotted sample or scale domain changes.

The phone layout correction and actual signed gain trace passed all six ongoing browser conditions at 955 through 1004 actions. Actual cloud PNG pixels were reviewed for all three network sizes, including phone and desktop layouts. Full validation passed all 252 numerical and interaction cases and the build, then found a legacy smoke test path that tapped Step inside a closed settings disclosure when native pause landed at the exact comparison boundary. The candidate corrects that test to open settings and tap its visible Step control while preserving every command, clock and paused state assertion. This followup still requires a complete new validation. No ongoing default or publication is claimed.

## Fresh ongoing default migration plan

Before changing the default, the prior source 38f18d182041127c55af2fb9320905fd4fcef172 passed all 252 numerical and interaction cases, the original 44 browser checks, both network browser suites and six ongoing browser conditions. Its generated child 46b2d12363941b546b58cd9a84893bc95de58ed1 changes only index.html.

Fresh sessions will construct continuous-phi-v1 directly, with cost view and measured weight view. Existing version 13 records still replay the archived protocol exactly. The old browser suites will declare actual version 13 saved fixtures through the production restore interface, rather than relying on the new default to reproduce a superseded freeze. The ongoing browser suite must remove its version 14 boot injection and exercise fresh production defaults on all three sizes and both surfaces. Existing archived scenario and support assertions remain archived assertions. The existing Restore default scenario action will explicitly start the ongoing protocol for an archived trial without silently converting its physical history. New trial migration from every legacy control still needs explicit acceptance before publication. No version selector is introduced.

The initial ongoing inspection will use the existing selected inverter and its mandatory local source, so the main forecast action and the measured weight trace address the same bus. This choice is deterministic before outcomes. It does not choose a favorable remote source. Matrix weight view and inspection changes must remain read only. Actual remote support and every source remain inspectable.
