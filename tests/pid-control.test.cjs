const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['pid-control', 'second-order']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/models/' + file + '.js'), 'utf8'), context);
}
const model = vm.runInContext('PIDControlModel', context);
const second = vm.runInContext('SecondOrderModel', context);
function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${expected}, got ${actual}, tolerance ${tolerance}`);
}

test('first-order P matches the analytical closed loop across gains and signed steps', () => {
  for (const gain of [0.3, 1, 3]) for (const tau of [0.2, 1, 4]) {
    for (const kp of [0, 1, 9, 20]) for (const setpoint of [-2, 0, 1]) {
      const result = model.simulate({ gain, tau, kp, ki: 0, setpoint, duration: 4, samples: 200, uMin: -100, uMax: 100 });
      const final = setpoint * gain * kp / (1 + gain * kp);
      for (let i = 0; i < result.time.length; i += 10) {
        close(result.output[i], final * (1 - Math.exp(-(1 + gain * kp) * result.time[i] / tau)), 3e-6);
      }
    }
  }
});

test('PI reference curve and target-relative metrics match known values', () => {
  const result = model.simulate({ duration: 16 });
  result.output.forEach((y, i) => close(y, 1 - Math.exp(-result.time[i]), 1e-8));
  close(result.metrics.riseTime, Math.log(9), 1e-4);
  close(result.metrics.settlingTime, -Math.log(0.02), 0.011);
  close(result.metrics.overshootPercent, 0);
  close(result.metrics.steadyStateError, 0, 1e-6);
  assert.ok(model.validationChecks().every(check => check.passed));
});

test('second-order P agrees with Homework 1 mechanical response', () => {
  for (const damping of [0.5, 6, 12]) {
    const kp = 5;
    const result = model.simulate({ plant: 'second', mass: 1, damping, stiffness: 4, kp, ki: 0, duration: 12 });
    const analytic = second.create(1, damping, 4 + kp);
    for (let i = 0; i < result.time.length; i += 20) {
      close(result.output[i], kp * analytic.state(result.time[i]).position, 2e-7);
    }
  }
});

test('fast-response metrics stay accurate across display durations and sample counts', () => {
  const gain = 5, tau = 0.1, kp = 20;
  const final = gain * kp / (1 + gain * kp);
  const rate = (1 + gain * kp) / tau;
  const exactRise = Math.log((final - 0.1) / (final - 0.9)) / rate;
  const exactSettling = -Math.log(1 - 0.98 / final) / rate;
  for (const duration of [1, 12, 60]) for (const samples of [100, 1600]) {
    const result = model.simulate({ gain, tau, kp, ki: 0, duration, samples, uMin: -100, uMax: 100 });
    close(result.metrics.riseTime, exactRise, 5e-6);
    close(result.metrics.settlingTime, exactSettling, 5e-6);
    assert.equal(result.time.length, samples + 1, 'plot data stays bounded independently of metric resolution');
  }
});

test('overshoot is measured between plot samples using the integration trajectory', () => {
  const mass = 0.1, damping = 0.1, stiffness = 0.1, kp = 20;
  const zeta = damping / (2 * Math.sqrt(mass * (stiffness + kp)));
  const final = kp / (stiffness + kp);
  const expected = 100 * (final * (1 + Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta))) - 1);
  for (const setpoint of [-1, 1]) {
    const result = model.simulate({ plant: 'second', mass, damping, stiffness, kp, ki: 0,
      setpoint, duration: 60, samples: 100, uMin: -100, uMax: 100 });
    close(result.metrics.overshootPercent, expected, 0.003);
  }
});

test('settling uses the final band entry and requires observation afterward', () => {
  const result = model.metrics([0, 1, 2, 3, 4, 5], [0, 1, 1.1, 1, 1, 1], 1);
  close(result.settlingTime, 2.8);
  assert.equal(model.metrics([0, 1], [0, 1], 1).settlingTime, null);
});

test('saturation drives the plant and unreachable targets do not falsely settle', () => {
  const result = model.simulate({ kp: 2, ki: 1, uMin: 0, uMax: 0.6, duration: 20 });
  assert.ok(result.saturated);
  result.control.forEach(u => assert.ok(u >= 0 && u <= 0.6));
  result.output.forEach((y, i) => close(y, 0.6 * (1 - Math.exp(-result.time[i])), 1e-8));
  assert.ok(result.requested.at(-1) > result.control.at(-1) + 5, 'P1 intentionally exposes integral windup');
  close(result.metrics.steadyStateError, 0.4, 1e-6);
  assert.equal(result.metrics.settlingTime, null);
  assert.equal(result.metrics.riseTime, null);
  const p = model.simulate({ kp: 9, ki: 0, duration: 3 });
  close(p.metrics.steadyStateError, 0.1);
  assert.equal(p.metrics.settlingTime, null);
});

test('filtered D has no setpoint kick, reduces overshoot, and converges as dt shrinks', () => {
  const parameters = { plant: 'second', damping: 0.5, kp: 8, ki: 4, kd: 2, duration: 20, uMin: -20, uMax: 20 };
  const pid = model.simulate(parameters);
  const pi = model.simulate({ ...parameters, kd: 0 });
  close(pid.requested[0], 8);
  assert.ok(pid.metrics.overshootPercent < pi.metrics.overshootPercent);
  const finer = model.simulate({ ...parameters, maxStep: pid.step / 2 });
  for (let i = 0; i < pid.time.length; i += 10) close(pid.output[i], finer.output[i], 1e-6);
  const first = model.simulate({ kp: 9, ki: 2, kd: 0.5, tau: 0.2, gain: 3, duration: 8 });
  const firstFine = model.simulate({ ...first.parameters, maxStep: first.step / 2 });
  for (let i = 0; i < first.time.length; i += 10) close(first.output[i], firstFine.output[i], 2e-6);
});

test('negative and zero steps, too-short windows, and zero controller are honest', () => {
  const pos = model.simulate({ duration: 16 });
  const neg = model.simulate({ duration: 16, setpoint: -1 });
  pos.output.forEach((y, i) => close(neg.output[i], -y, 1e-12));
  close(pos.metrics.riseTime, neg.metrics.riseTime, 1e-12);
  close(pos.metrics.settlingTime, neg.metrics.settlingTime, 1e-12);
  const zero = model.simulate({ setpoint: 0 });
  assert.equal(zero.metrics.overshootPercent, null);
  assert.equal(zero.metrics.riseTime, null);
  assert.equal(zero.metrics.settlingTime, null);
  assert.ok(zero.output.every(y => y === 0));
  const short = model.simulate({ duration: 1 });
  assert.equal(short.metrics.steadyStateError, null);
  assert.equal(short.metrics.settlingTime, null);
  const off = model.simulate({ kp: 0, ki: 0, kd: 0 });
  assert.ok(off.output.every(y => y === 0));
  close(off.metrics.steadyStateError, 1);
});

test('bad inputs and impractical integration costs are rejected', () => {
  for (const options of [{ tau: 0 }, { mass: -1 }, { kp: NaN }, { kd: -1 },
    { ki: Infinity }, { setpoint: NaN }, { uMin: 1, uMax: 1 }, { plant: 'unknown' },
    { samples: 99 }, { samples: 20000 }, { duration: -1 }, { filterTime: 0 }, { maxStep: 0 }]) {
    assert.throws(() => model.simulate(options));
  }
  assert.throws(() => model.simulate({ tau: 1e-10 }), /too many integration steps/);
});
