// PID feedback through a first-order sensor. No DOM or plotting dependency.
// Requires PIDControlModel to be loaded first.
const PIDSensorModel = (() => {
  'use strict';

  const defaults = Object.freeze({ ...PIDControlModel.defaults, sensorTau: 0.2 });

  function configure(options = {}) {
    const p = { ...defaults, ...options };
    if (!Number.isFinite(p.sensorTau) || p.sensorTau < 0) {
      throw new RangeError('sensorTau must be nonnegative and finite.');
    }
    return { ...PIDControlModel.configure(p), sensorTau: p.sensorTau };
  }

  function simulate(options = {}) {
    const p = configure(options);

    // An ideal sensor is an algebraic bypass. Reusing P1 here guarantees that
    // tau_s = 0 introduces no extra state, lag, or numerical approximation.
    if (p.sensorTau === 0) {
      const ideal = PIDControlModel.simulate(p);
      return { ...ideal, parameters: p };
    }

    const plant = PIDControlModel.createPlant(p);
    const plantStateCount = plant.initial.length;
    const sensorIndex = plantStateCount;
    const integralIndex = plantStateCount + 1;
    const filterIndex = plantStateCount + 2;
    // State = plant state, sensor output, integral of measured error,
    // low-pass-filtered sensor output used by the D term.
    let state = [...plant.initial, 0, 0, 0];
    const sensorRate = 1 / p.sensorTau;
    const filterRate = p.kd > 0 ? 1 / p.filterTime : 0;
    const feedbackRate = p.kp + p.ki + 2 * p.kd * filterRate;
    const plantRate = p.plant === 'first'
      ? (1 + p.gain * feedbackRate) / p.tau
      : (1 + p.damping + p.stiffness + feedbackRate) / p.mass;
    const rateBound = Math.max(1, 2 * sensorRate, 2 * filterRate, plantRate);
    const maxStep = Math.min(p.maxStep, 0.2 / rateBound);
    const sampleStep = p.duration / p.samples;
    const substeps = Math.max(1, Math.ceil(sampleStep / maxStep));
    if (!Number.isFinite(substeps) || substeps * p.samples > 600000) {
      throw new RangeError('These settings need too many integration steps. Reduce gains or duration, or increase a time constant.');
    }
    const dt = sampleStep / substeps;
    const tracker = PIDControlModel.createMetricTracker(p.setpoint, p.duration);
    tracker.add(0, plant.output(state));
    const result = { parameters: p, time: [], output: [], measured: [], control: [], requested: [],
      step: dt, integrationSteps: 0, saturated: false, stopped: false };
    const derivative = s => {
      const trueOutput = plant.output(s);
      const measured = s[sensorIndex];
      const terms = PIDControlModel.controllerTerms(p, measured, s[integralIndex], s[filterIndex]);
      result.saturated ||= terms.applied !== terms.requested;
      return [...plant.derivative(s, terms.applied),
        (trueOutput - measured) / p.sensorTau,
        p.ki > 0 ? terms.error : 0,
        p.kd > 0 ? (measured - s[filterIndex]) / p.filterTime : 0];
    };

    for (let i = 0; i <= p.samples; i++) {
      const trueOutput = plant.output(state);
      const measured = state[sensorIndex];
      const terms = PIDControlModel.controllerTerms(p, measured, state[integralIndex], state[filterIndex]);
      result.time.push(i * sampleStep);
      result.output.push(trueOutput);
      result.measured.push(measured);
      result.control.push(terms.applied);
      result.requested.push(terms.requested);
      if (i === p.samples) break;
      for (let j = 0; j < substeps; j++) {
        const next = PIDControlModel.rk4(state, dt, derivative);
        result.integrationSteps++;
        if (next.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
          result.stopped = true;
          break;
        }
        state = next;
        tracker.add(i * sampleStep + (j + 1) * dt, plant.output(state));
      }
      if (result.stopped) break;
    }

    result.metrics = tracker.finish();
    if (result.stopped) {
      result.metrics.finalOutput = result.output.at(-1);
      result.metrics.endError = p.setpoint - result.metrics.finalOutput;
      result.metrics.steady = false;
      result.metrics.steadyStateError = null;
      result.metrics.settlingTime = null;
    }
    return result;
  }

  return Object.freeze({ defaults, configure, simulate });
})();
