# O PredSLS interactive demo

[Open the hosted experiment](https://tongxin.me/online-sls-demo/)

Explore shared prediction adaptation on a synthetic 24 bus voltage regulation model. Compare cumulative control cost and inspect how recommended prediction sources change over time.

Set the pulse strength and click a bus in the network to add a load pulse. The **Attack bus** button or `D` shortcut applies the same pulse to the selected bus. The default strength is 0.02 pu with 0.01 and 0.03 pu alternatives. Each bus has a twelve sample recovery interval before it can be attacked again. A click advances two actual control steps to reveal the first cost response, then continues at one step per second. Playback can be set from 0.5 to 4 steps per second. Graph, matrix, and plot transitions smooth the presentation without interpolating the numerical model. Press `E` to change forecast reliability. Press `Space` to run or pause. Freeze data and fit holds the plant and costs fixed while the learned response approaches the exact ridge solution.

## Model scope

This is a reduced numerical illustration of shared online adaptation. It does not reproduce the full FIR algorithm or its regret theorem. A fixed linear feedback controller uses a learned forecast calibration matrix based on the latest 60 revealed samples.

The instantaneous cost plot shows the most recent 60 quadratic stage costs, making pulse spikes and recovery visible. The cumulative plot sums the same stage costs rather than reporting formal regret. Under the existing cost convention, the first step realizes the pulse and the following step charges the affected state cost. These are the two real steps performed immediately on a pulse click. The first learning update after a pulse only uses the revealed observation. Connectivity is never changed just for an animation. All controllers receive identical disturbances. The graph and 24 by 24 communication matrix show recommended sources. Matrix rows are receivers and columns are sources. Connected entries are green, added links are teal, removed links have amber outlines, and local information is gray. Changes are measured against the reference captured before the latest disturbance or forecast change. Set reference starts a new comparison. Select a matrix row to highlight the same receiver in the graph. Physical and deployed communication links remain fixed.

The dynamics use per unit voltage coordinates and abstract control intervals. The model does not calculate AC power flow, actuator saturation, or hard voltage limits. Frozen fitting demonstrates numerical convergence of a fixed objective. Online response and source rankings can continue to change.

## Run and rebuild

The checked in `index.html` and `assets` directory are deployable directly to GitHub Pages. The page runs in the browser and loads the bundled D3 7.9.0 library and DM Sans from Google Fonts. Experiment state is saved in local browser storage. Reset returns to the same 60 sample warm start, clears interventions, and leaves the learner ready to respond.

To rebuild the page with Python 3

```sh
python3 build.py
```

To check the numerical model with Node.js

```sh
node src/test-simulation.cjs
```

To serve the repository locally

```sh
python3 -m http.server 8000
```

Then open [the local demo](http://localhost:8000/).

## Source

`src/simulation.js` defines the deterministic system, controllers, disturbances, shared calibration, and source scores.

`src/interface.html` and `src/interface.js` define the controls and interactive figures. `src/site-shell.css`, `src/site-header.html`, and `src/site-footer.html` define the academic presentation and model notes.

`src/page-template.html` defines the standalone document and build placeholders. `build.py` combines these sources into the standalone page. No private manuscript files or experimental datasets are included.
