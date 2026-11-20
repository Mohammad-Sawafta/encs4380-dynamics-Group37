# Homework 2: P1 implementation and P2 handoff

Owner of P1: Mohammad. Owner of P2: Saif. P3, P4 and My system still need owners.
Source: ENCS4380 Homework 2 PID Control Toolkit, released 16 November 2026.
Final release v2.0 and Pages link due 23 November 2026. P1/P2 checkpoint was 19 November.

## P1 files

- `control.html`: separate Control page, linked from Homework 1's landing page.
- `css/control.css`: scoped additions to the existing shared styles.
- `js/models/pid-control.js`: DOM-free plant, PID, RK4, metrics and reference checks.
- `js/control-p1.js`: controls, presets, prediction interaction and Plotly graphs.
- `tests/pid-control.test.cjs`: independent analytical comparisons and numerical convergence checks.

Both plants preserve Homework 1's equations: `tau*y' + y = K*u` and
`m*y'' + b*y' + k*y = u`. These are integrated, rather than using Homework 1's
closed-form response to simulate feedback. The second-order DC gain is `1/k`.

The controller uses `e = r - measured`, `I' = e`,
`z' = (measured - z)/Tf`, `u_requested = Kp*e + Ki*I - Kd*(measured-z)/Tf`.
`Tf = 0.02 s`. The derivative acts on the filtered measurement to avoid a
setpoint kick. `u_applied = clamp(u_requested, uMin, uMax)` drives the plant.
P1 intentionally has no anti-windup; P3 must implement and explain it.
P3's assignment equation differentiates error, so its implementation and
generated Arduino code must explicitly handle that convention.

## Shared contract for Saif

Load `js/models/pid-control.js` before P2's page controller.

- `PIDControlModel.configure(options)` merges defaults and checks parameters.
- `createPlant(options)` returns `initial`, `output(state)` and `derivative(state, u)`.
- `controllerTerms(config, measured, integral, filtered)` returns error,
  proportional/integral/derivative terms, requested command and applied command.
- `rk4(state, dt, derivative)` integrates the whole augmented state, reevaluating
  the feedback and saturation at each RK4 stage.
- `metrics(time, trueOutput, setpoint)` calculates tracking metrics.
- `createMetricTracker(setpoint, duration)` returns `add(time, trueOutput)` and
  `finish()`. Feed it the initial output and every accepted integration step,
  then call `finish()` for metrics independent of plot sampling. P2 should use
  this tracker as P1 does; the array-based helper is only as accurate as the
  samples supplied to it.
- P1 `simulate(options)` returns `parameters`, `time`, `output`, `measured`,
  `control`, `requested`, `metrics`, `step`, `integrationSteps`, `saturated`, `stopped`.
  `measured === output` element by element in P1.

For P2, add a sensor state `ys` with `ys' = (y - ys)/tau_s`. Feed `ys` into
`controllerTerms`, including the derivative filter, while driving the original
plant with `applied`. Integrate plant, sensor, integral and derivative-filter
states together. Include the sensor rate `1/tau_s` in the time-step bound.
At `tau_s = 0`, bypass the sensor algebraically; do not divide by zero.
Plot both the true output and sensor output with the setpoint, and label the
signal that the controller actually sees. Check that bypassing the sensor
reproduces P1 exactly before trying growing sensor lag.

Keep P2's view/controller separate so parallel work avoids editing the same
page script. Do not silently change the P1 metric definitions or derivative
convention. Commit your own work so individual contribution remains visible.

## Acceptance and remaining work

- P1: both plants, gains and setpoint; block diagram; response and control plots;
  actuator limits applied in the solver; live metrics; prediction interaction.
- Reference checks: P Kp=9 gives tau_cl=0.1 s and 10% error; PI Kp=Ki=1 gives
  wn=zeta=1; stable reachable PI step cases approach zero error.
- Measurements: rise 10-90% of target; overshoot relative to target; settling
  within 2% of target. Steady-state error is a tail-window estimate and is
  withheld when the output is still moving. Finite-horizon limits are displayed.
- Review on 21 November fixed fast-response metrics by observing every solver
  step and interpolating threshold crossings. Numerical regression checks cover
  long display windows, sparse plot samples, signed overshoot and final band
  entry. Browser interaction and phone-layout verification are still pending
  because the review environment could not reach the local preview server.
- Shared project work still needs measured motor K and tau, a justified speed
  specification, PWM 0-100%, and the final Arduino code from P3. Do not invent
  motor measurements. Generic P1 parameters are teaching examples.
- Create/track one GitHub issue per module assigned to its actual owner.
- Publish reviewed changes through the existing GitHub Pages repository.
- Complete P2-P4 and My system before making the final v2.0 release.

## Demo preparation for Mohammad

Explain the signal path, the error sign, each state derivative, RK4's four
stages, where clipping occurs, why integral action needs a reachable target,
why derivative-on-measurement avoids a step impulse, and why a P-only response
can become flat without reaching the target. Explain the difference between
the integration step and P3's controller sampling interval.
