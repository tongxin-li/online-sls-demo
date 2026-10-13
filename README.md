# O PredSLS interactive demo

[Open the hosted experiment](https://tongxin-li.github.io/online-sls-demo/)

Explore shared prediction adaptation on a synthetic 24 bus voltage regulation model. Compare cumulative control cost and inspect how recommended prediction sources change over time.

Choose a bus and click **Add disturbance** or press `D` to add a load pulse. This starts playback immediately. Press `E` to change forecast reliability. Press `Space` to run or pause. Freeze data and fit holds the plant and costs fixed while the learned response approaches the exact ridge solution.

## Model scope

This is a reduced numerical illustration of shared online adaptation. It does not reproduce the full FIR algorithm or its regret theorem. A fixed linear feedback controller uses a learned forecast calibration matrix based on the latest 60 revealed samples.

The curves accumulate quadratic stage cost rather than formal regret. All controllers receive identical disturbances. The graph and 24 by 24 communication matrix show recommended sources. Matrix rows are receivers and columns are sources. Connected entries are burgundy, added links are teal, removed links have amber outlines, and local information is gray. Changes are measured against the reference captured before the latest disturbance or forecast change. Set reference starts a new comparison. Select a matrix row to highlight the same receiver in the graph. Physical and deployed communication links remain fixed.

The dynamics use per unit voltage coordinates and abstract control intervals. The model does not calculate AC power flow, actuator saturation, or hard voltage limits. Frozen fitting demonstrates numerical convergence of a fixed objective. Online response and source rankings can continue to change.

## Run and rebuild

The checked in `index.html` is deployable directly to GitHub Pages. The page runs in the browser and loads D3 from jsDelivr and Inter from Google Fonts. Experiment state is saved in local browser storage. Start again resets the deterministic experiment.

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
