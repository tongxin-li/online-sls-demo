# Continuous response and support implementation

The ongoing `adaptive-phi-v2` experiment learns finite memory predictive state and input response matrices on the existing LinDistFlow model. It is an experimental shared stationary response specialization. Live support reselection extends the earlier frozen topology experiment. No new convergence theorem, guarantee of beating feedback or reproduction of manuscript numerical results is claimed.

## Feasible response coordinates

The existing model has A = aI. Free lag matrices Z have zero values at both finite memory boundaries. The implementation constructs X = BZ, U = Znext − aZ and L = U − KX. All predictive dynamics and both temporal boundaries then hold. Missing receiver and source links impose linear constraints on L. Exact orthonormal nullspaces project onto these constraints. Every source column and every free lag matrix can adapt. No scalar source correction substitutes for this update.

## Revealed data and updates

At action t, only outcomes through t − 1 are available. The newest completed response row is t − d, with d = 5. Startup rows without a complete stationary window are excluded. The first complete row arrives at action 10. Thirty completed rows produce the first update at action 39. Thereafter each action uses at most 60 completed rows. Forecasts are the original issued values and cannot be rewritten after a corruption or repair click.

The loss is the mean squared mismatch between predictive state and input responses to forecasts and the offline response to revealed forcing, with a Frobenius response ridge of 0.000001. The gradient jointly updates all free Z entries. Its step is obtained from an upper bound on curvature and checked for descent on the same frozen observation window. The learner minimizes response mismatch rather than directly minimizing the displayed saturated stage cost. A worse stage cost remains a valid outcome.

A dense full response learner supplies gain energy scores. The supported full response learner supplies executed matrices. Every 30 updates, the former ranks incoming sources under the original per receiver remote budget with deterministic ties. A changed support is synthesized under the exact constraints and the learned correction is projected into that feasible space. A topology change is recorded only when actual source permissions change.

## Causal deployment

Every newly issued forecast column receives an immutable response and admitted source packets. It retains those matrices and packets until its finite memory expires. Updates do not alter columns already in use. Current commands sum those actual retained column contributions plus unchanged shared feedback. The same inverter clipping follows.

A removed link stops receiving new forecast values. Previously received values can still have a nonzero effect until expiration. Current incoming links and retiring cached influence are distinct reported quantities. The union of cached command dependencies can temporarily exceed the current incoming link budget without new messages on a removed link.

The response matrix view shows the supported learned kernel for newly issued forecasts. The signed gain history, temporal norm and command breakdown use immutable executed receipts, which include all retained columns. A view change never modifies control, source reliability or costs.

## Communication accounting

Sparse incoming source budgets exclude mandatory local forecasts. Each source and receiver sends one initial bundle of five forecast values, then one new value per action. Both bundle and scalar value counts are retained. The full learner additionally collects each revealed source forecast and forcing pair centrally and broadcasts permitted response coefficients. These learning values and broadcasts are counted separately. Sparse actuator channels alone do not establish a saving in total communication. Common full state feedback remains a separate existing assumption.

## Baselines and scope

Fixed sparse preserves the initial support and response. Dense prediction uses its full support and response. Feedback only uses the identical common K without forecasts. All policies share issued forecasts, realized power, stage objective and limits. Every stage cost accumulates from the first action with no 180 or 360 sample reset.

Version 15 records replay full response adaptation. Earlier version 14 source correction and version 13 finite records restore their own algorithms. An explicit new trial adopts the current protocol. There is no second public URL or visible version menu.

Nominal response feasibility does not establish stability or optimality of the changing saturated physical trajectory. The all noisy and unforecast stress cases can favor feedback. Extra learning telemetry and finite sample performance remain limitations. The hourly program will refine the same implementation under the predefined checks, without altering the physics or weakening baselines to create an advantage.
