// Continuous PID experiments. No DOM or plotting dependency.
const PIDControlModel = (() => {
  'use strict';

  const defaults = Object.freeze({ plant: 'first', gain: 1, tau: 1,
    mass: 1, damping: 2, stiffness: 4, kp: 1, ki: 1, kd: 0,
    setpoint: 1, uMin: -10, uMax: 10, duration: 12, filterTime: 0.02,
    maxStep: 0.01, samples: 1600 });

  function configure(options = {}) {
    const p = { ...defaults, ...options };
    if (!['first', 'second'].includes(p.plant)) throw new RangeError('Choose a supported plant.');
    for (const key of ['gain', 'tau', 'mass', 'damping', 'stiffness', 'duration', 'filterTime', 'maxStep']) {
      if (!Number.isFinite(p[key]) || p[key] <= 0) throw new RangeError(key + ' must be positive and finite.');
    }
    for (const key of ['kp', 'ki', 'kd']) {
      if (!Number.isFinite(p[key]) || p[key] < 0) throw new RangeError(key + ' must be nonnegative and finite.');
    }
    if (![p.setpoint, p.uMin, p.uMax].every(Number.isFinite) || p.uMin >= p.uMax) {
      throw new RangeError('Setpoint and limits must be finite, with lower limit below upper limit.');
    }
    if (!Number.isInteger(p.samples) || p.samples < 100 || p.samples > 10000) {
      throw new RangeError('Use between 100 and 10000 output intervals.');
    }
    return p;
  }

  // Same differential equations as Homework 1, driven by the controller output.
  function createPlant(options) {
    const p = configure(options);
    return p.plant === 'first' ? {
      initial: [0],
      output: state => state[0],
      derivative: (state, u) => [(p.gain * u - state[0]) / p.tau]
    } : {
      initial: [0, 0],
      output: state => state[0],
      derivative: (state, u) => [state[1], (u - p.damping * state[1] - p.stiffness * state[0]) / p.mass]
    };
  }

  // A filtered derivative of the measured output avoids an impulse at a step.
  // P3 may use derivative-of-error instead; it must label that different choice.
  function controllerTerms(p, measured, integral, filtered) {
    const error = p.setpoint - measured;
    const proportional = p.kp * error;
    const integralTerm = p.ki * integral;
    const derivative = p.kd === 0 ? 0 : -p.kd * (measured - filtered) / p.filterTime;
    const requested = proportional + integralTerm + derivative;
    return { error, proportional, integral: integralTerm, derivative, requested,
      applied: Math.max(p.uMin, Math.min(p.uMax, requested)) };
  }

  function rk4(state, dt, derivative) {
    const k1 = derivative(state);
    const k2 = derivative(state.map((x, i) => x + dt * k1[i] / 2));
    const k3 = derivative(state.map((x, i) => x + dt * k2[i] / 2));
    const k4 = derivative(state.map((x, i) => x + dt * k3[i]));
    return state.map((x, i) => x + dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6);
  }

  // Observe integration steps, not the decimated plot: fast transients must not
  // acquire different metrics just because the display window is longer.
  function createMetricTracker(reference, duration) {
    const scale = Math.abs(reference) || 1;
    const sign = Math.sign(reference);
    let previousTime = null, previousOutput = 0, finalTime = 0, finalOutput = 0;
    let t10 = null, t90 = null, bandEntry = null, overshoot = 0;
    let tailMin = Infinity, tailMax = -Infinity, tailSum = 0, tailCount = 0;
    function add(time, output) {
      const inBand = Math.abs(output - reference) <= 0.02 * scale;
      if (previousTime !== null) {
        const before = sign * previousOutput / scale;
        const after = sign * output / scale;
        const crossing = fraction => previousTime + (time - previousTime) * (fraction - before) / (after - before);
        if (sign && t10 === null && before < 0.1 && after >= 0.1) t10 = crossing(0.1);
        if (sign && t90 === null && before < 0.9 && after >= 0.9) t90 = crossing(0.9);
        if (inBand && bandEntry === null) {
          const boundary = reference + Math.sign(previousOutput - reference) * 0.02 * scale;
          bandEntry = previousTime + (time - previousTime) * (boundary - previousOutput) / (output - previousOutput);
        }
      } else if (inBand) {
        bandEntry = time;
      }
      if (!inBand) bandEntry = null;
      if (sign) overshoot = Math.max(overshoot, 100 * (sign * output / scale - 1));
      if (time >= 0.85 * duration) {
        tailMin = Math.min(tailMin, output);
        tailMax = Math.max(tailMax, output);
        tailSum += output;
        tailCount++;
      }
      previousTime = finalTime = time;
      previousOutput = finalOutput = output;
    }
    function finish() {
      const steady = tailCount > 0 && tailMax - tailMin <= 0.0001 * Math.max(1, Math.abs(reference));
      const settlingTime = sign && bandEntry !== null &&
        finalTime - bandEntry >= Math.max(0.1, 0.05 * finalTime) ? bandEntry : null;
      return { riseTime: t10 !== null && t90 !== null ? t90 - t10 : null,
        overshootPercent: sign ? overshoot : null, settlingTime, steady, finalOutput,
        steadyStateError: steady ? reference - tailSum / tailCount : null,
        endError: reference - finalOutput };
    }
    return { add, finish };
  }

  function metrics(time, output, reference) {
    const tracker = createMetricTracker(reference, time.at(-1));
    output.forEach((y, i) => tracker.add(time[i], y));
    return tracker.finish();
  }

  function simulate(options = {}) {
    const p = configure(options);
    const plant = createPlant(p);
    const count = plant.initial.length;
    // State = plant state, integral of error, low-pass-filtered measurement.
    let state = [...plant.initial, 0, 0];
    const filterRate = p.kd > 0 ? 1 / p.filterTime : 0;
    const feedbackRate = p.kp + p.ki + 2 * p.kd * filterRate;
    const rateBound = Math.max(1, filterRate * 2,
      p.plant === 'first' ? (1 + p.gain * feedbackRate) / p.tau
        : (1 + p.damping + p.stiffness + feedbackRate) / p.mass);
    const maxStep = Math.min(p.maxStep, 0.2 / rateBound);
    const sampleStep = p.duration / p.samples;
    const substeps = Math.max(1, Math.ceil(sampleStep / maxStep));
    if (!Number.isFinite(substeps) || substeps * p.samples > 600000) {
      throw new RangeError('These settings need too many integration steps. Reduce gains or duration, or increase the plant time constant.');
    }
    const dt = sampleStep / substeps;
    const tracker = createMetricTracker(p.setpoint, p.duration);
    tracker.add(0, plant.output(state));
    const derivative = s => {
      const measured = plant.output(s);
      const terms = controllerTerms(p, measured, s[count], s[count + 1]);
      result.saturated ||= terms.applied !== terms.requested;
      return [...plant.derivative(s, terms.applied), p.ki > 0 ? terms.error : 0,
        p.kd > 0 ? (measured - s[count + 1]) / p.filterTime : 0];
    };
    const result = { parameters: p, time: [], output: [], measured: [], control: [], requested: [],
      step: dt, integrationSteps: 0, saturated: false, stopped: false };
    for (let i = 0; i <= p.samples; i++) {
      const y = plant.output(state);
      const terms = controllerTerms(p, y, state[count], state[count + 1]);
      result.time.push(i * sampleStep);
      result.output.push(y);
      result.measured.push(y); // P1 has ideal, unity feedback.
      result.control.push(terms.applied);
      result.requested.push(terms.requested);
      if (i === p.samples) break;
      for (let j = 0; j < substeps; j++) {
        const next = rk4(state, dt, derivative);
        result.integrationSteps++;
        if (next.some(x => !Number.isFinite(x) || Math.abs(x) > 1e9)) {
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
      // The plotted experiment ends at the last saved output sample.
      result.metrics.finalOutput = result.output.at(-1);
      result.metrics.endError = p.setpoint - result.metrics.finalOutput;
      result.metrics.steady = false;
      result.metrics.steadyStateError = null;
      result.metrics.settlingTime = null;
    }
    return result;
  }

  function validationChecks() {
    const proportional = simulate({ kp: 9, ki: 0, duration: 3, samples: 1500 });
    const atTau = proportional.output[50]; // t = 0.1 s.
    const error = 1 - proportional.output.at(-1);
    const pi = simulate({ kp: 1, ki: 1, duration: 16 });
    const piMaxError = Math.max(...pi.output.map((y, i) => Math.abs(y - (1 - Math.exp(-pi.time[i])))));
    const piCases = [[1, 0.5], [1, 1], [2, 4]].map(([kp, ki]) =>
      Math.abs(simulate({ kp, ki, duration: 60 }).metrics.endError));
    return [
      { name: 'P only: K = 1, tau = 1, Kp = 9', expected: 'tau_cl = 0.1 s; error = 10%',
        actual: `y(0.1) = ${atTau.toFixed(6)}; error = ${(100 * error).toFixed(4)}%`,
        passed: Math.abs(atTau - 0.9 * (1 - Math.exp(-1))) < 1e-6 && Math.abs(error - 0.1) < 1e-6 },
      { name: 'PI: Kp = 1, Ki = 1', expected: 'wn = 1 rad/s; zeta = 1; y = 1 - exp(-t)',
        actual: `wn = 1; zeta = 1; max curve error = ${piMaxError.toExponential(2)}`,
        passed: piMaxError < 1e-6 },
      { name: 'Stable PI, reachable step: three gain pairs', expected: 'Steady-state error approaches zero',
        actual: `Largest absolute error at 60 s = ${Math.max(...piCases).toExponential(2)}`,
        passed: piCases.every(value => value < 1e-6) }
    ];
  }

  return Object.freeze({ defaults, configure, createPlant, controllerTerms, rk4, createMetricTracker, metrics, simulate, validationChecks });
})();
