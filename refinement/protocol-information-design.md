# PV advance information protocol audit

This is an audit adapter, not a live demo scenario or a claim of paper fidelity. Production engine, controller synthesis, default beta, objective, common feedback and limits stay unchanged.

Prespecified before outcomes are read

- All original beta levels 0, 0.25, 0.5, 1 and 2 and every seed 1 through 20.
- Four existing PV sites 5, 7, 14 and 21 lose up to 40 kW each. Eight second ramps, sixteen second plateau and eight second restoration, bounded by existing generation limits. Independent deterministic phase seed jitter shifts the cloud timing.
- An idealized existing four second irradiance nowcast provides the physical profile component, with the original absolute source noise scales and reliability map. This stronger relative accuracy assumption is explicit and is not validated field forecasting.
- Identical discovery for paired arms. Fresh held out physical trajectories, Gaussian errors, selected supports and coefficients match. Only the profile component of newly issued held out forecasts differs between advance and withheld arms. No future clicks enter messages.
- All four full costs, terminal costs, physical bounds, command limiting, actual predictive command use, wins, ties, losses and feedback wins remain in the report. A zero-profile adapter regression checks the original engine.
- The public repository documents discovery, offline selection, synthesis and held out comparison, but does not include the manuscript. This added PV prior is a feeder diagnostic, not established paper fidelity.

No performance result is assumed. No live control is added or changed by this audit. If useful prediction information fails to establish a defensible selected-source advantage, report that limitation rather than adjust this protocol after seeing results.
