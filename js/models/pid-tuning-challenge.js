// Hidden first-order plant and PID specification scoring for Homework 2 P4.
// Requires PIDControlModel to be loaded first. No DOM or plotting dependency.
const PIDTuningChallenge = (() => {
  'use strict';

  const specification = Object.freeze({ overshootPercent: 10, settlingTime: 6,
    steadyStateError: 0.02, duration: 18 });

  function draw(random) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Random values must be finite numbers from zero up to, but not including, one.');
    }
    return value;
  }

  function createChallenge(random = Math.random) {
    const gain = 0.7 + 0.8 * draw(random);
    const tau = 0.6 + 1.4 * draw(random);
    return Object.freeze({ plant: 'first', gain, tau, setpoint: 1,
      uMin: -10, uMax: 10, ...specification });
  }

  function validateGains(raw = {}) {
    const gains = {};
    const errors = {};
    for (const [key, maximum] of [['kp', 20], ['ki', 10], ['kd', 5]]) {
      const source = raw[key];
      const value = typeof source === 'number' ? source :
        typeof source === 'string' && source.trim() !== '' ? Number(source) : NaN;
      if (!Number.isFinite(value)) errors[key] = `Enter a finite value for ${key}.`;
      else if (value < 0 || value > maximum) errors[key] = `${key} must be between 0 and ${maximum}.`;
      else gains[key] = value;
    }
    return Object.keys(errors).length ? { valid: false, errors, gains: null } :
      { valid: true, errors, gains };
  }

  function evaluate(challenge, rawGains) {
    const validation = validateGains(rawGains);
    if (!validation.valid) return { ok: false, errors: validation.errors, result: null };
    const p = challenge;
    const simulation = PIDControlModel.simulate({ plant: 'first', gain: p.gain, tau: p.tau,
      kp: validation.gains.kp, ki: validation.gains.ki, kd: validation.gains.kd,
      setpoint: p.setpoint, uMin: p.uMin, uMax: p.uMax, duration: p.duration, samples: 1800 });
    const metrics = simulation.metrics;
    const checks = Object.freeze([
      Object.freeze({ key: 'overshoot', label: 'Overshoot', limit: `at most ${p.overshootPercent}%`,
        value: metrics.overshootPercent, passed: metrics.overshootPercent !== null && metrics.overshootPercent <= p.overshootPercent }),
      Object.freeze({ key: 'settling', label: 'Settling time', limit: `at most ${p.settlingTime} s`,
        value: metrics.settlingTime, passed: metrics.settlingTime !== null && metrics.settlingTime <= p.settlingTime }),
      Object.freeze({ key: 'error', label: 'Absolute steady-state error', limit: `at most ${p.steadyStateError}`,
        value: metrics.steadyStateError === null ? null : Math.abs(metrics.steadyStateError),
        passed: metrics.steadyStateError !== null && Math.abs(metrics.steadyStateError) <= p.steadyStateError })
    ]);
    return { ok: true, errors: {}, result: Object.freeze({ gains: Object.freeze(validation.gains),
      simulation, checks, points: checks.filter(check => check.passed).length, possible: checks.length,
      passed: checks.every(check => check.passed) }) };
  }

  // A feasible PI design used by numerical tests. It gives zeta = 0.8 and
  // wn = 2/tau for every plant in the challenge range.
  function referenceGains(challenge) {
    return Object.freeze({ kp: 2.2 / challenge.gain,
      ki: 4 / (challenge.tau * challenge.gain), kd: 0 });
  }

  return Object.freeze({ specification, createChallenge, validateGains, evaluate, referenceGains });
})();
