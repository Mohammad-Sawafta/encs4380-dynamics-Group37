const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['pid-control', 'pid-sensor']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/models/' + file + '.js'), 'utf8'), context);
}
const pid = vm.runInContext('PIDControlModel', context);
const sensor = vm.runInContext('PIDSensorModel', context);

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${expected}, got ${actual}, tolerance ${tolerance}`);
}

test('zero sensor time constant is an exact P1 bypass', () => {
  for (const options of [
    { kp: 9, ki: 0, duration: 3 },
    { kp: 1, ki: 1, duration: 16 },
    { plant: 'second', damping: 0.5, kp: 8, ki: 4, kd: 2, duration: 20, uMin: -20, uMax: 20 }
  ]) {
    const expected = pid.simulate(options);
    const actual = sensor.simulate({ ...options, sensorTau: 0 });
    for (const key of ['time', 'output', 'measured', 'control', 'requested']) {
      assert.deepEqual(actual[key], expected[key], key + ' differs from P1');
    }
    assert.deepEqual(actual.metrics, expected.metrics);
    assert.equal(actual.step, expected.step);
    assert.equal(actual.integrationSteps, expected.integrationSteps);
  }
});

test('first-order sensor state matches an independent fine-step RK4 reference', () => {
  const options = { gain: 1.3, tau: 0.7, kp: 2.4, ki: 1.1, kd: 0,
    sensorTau: 0.35, setpoint: 1.2, duration: 5, samples: 500, uMin: -100, uMax: 100 };
  const result = sensor.simulate(options);
  let y = 0, measured = 0, integral = 0;
  const dt = 0.0001;
  const derivative = state => {
    const [plantOutput, sensorOutput, accumulatedError] = state;
    const error = options.setpoint - sensorOutput;
    const u = options.kp * error + options.ki * accumulatedError;
    return [(options.gain * u - plantOutput) / options.tau,
      (plantOutput - sensorOutput) / options.sensorTau, error];
  };
  const rk4 = (state, step) => {
    const k1 = derivative(state);
    const k2 = derivative(state.map((value, index) => value + step * k1[index] / 2));
    const k3 = derivative(state.map((value, index) => value + step * k2[index] / 2));
    const k4 = derivative(state.map((value, index) => value + step * k3[index]));
    return state.map((value, index) => value + step * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]) / 6);
  };
  for (let sample = 1; sample < result.time.length; sample++) {
    for (let step = 0; step < 100; step++) [y, measured, integral] = rk4([y, measured, integral], dt);
    close(result.output[sample], y, 3e-8);
    close(result.measured[sample], measured, 3e-8);
  }
});

test('larger sensor lag increases overshoot and can create growing oscillation', () => {
  const base = { kp: 2, ki: 8, kd: 0, duration: 20, samples: 1600, uMin: -100, uMax: 100 };
  const ideal = sensor.simulate({ ...base, sensorTau: 0 });
  const small = sensor.simulate({ ...base, sensorTau: 0.1 });
  const near = sensor.simulate({ ...base, sensorTau: 0.55 });
  const unstable = sensor.simulate({ ...base, sensorTau: 0.7 });
  assert.ok(ideal.metrics.overshootPercent < small.metrics.overshootPercent);
  assert.ok(small.metrics.overshootPercent < near.metrics.overshootPercent);
  assert.ok(near.metrics.overshootPercent < unstable.metrics.overshootPercent);
  const quarterRange = (values, start, end) => {
    const part = values.slice(Math.floor(values.length * start), Math.floor(values.length * end));
    return Math.max(...part) - Math.min(...part);
  };
  assert.ok(quarterRange(unstable.output, 0.75, 1) > quarterRange(unstable.output, 0.5, 0.75),
    'the unstable preset should have growing late oscillations');
  assert.equal(unstable.metrics.settlingTime, null);
});

test('the controller follows the sensor report, not the true output', () => {
  const options = { kp: 3, ki: 0, kd: 0, sensorTau: 0.4, duration: 3, samples: 300, uMin: -100, uMax: 100 };
  const result = sensor.simulate(options);
  for (let index = 0; index < result.time.length; index += 10) {
    close(result.requested[index], options.kp * (1 - result.measured[index]), 1e-12);
  }
  const firstDifferent = result.output.findIndex((value, index) => Math.abs(value - result.measured[index]) > 1e-4);
  assert.ok(firstDifferent > 0);
  assert.notEqual(result.requested[firstDifferent], options.kp * (1 - result.output[firstDifferent]));
});

test('second-order plants, derivative filtering, saturation, and smaller steps remain finite', () => {
  const options = { plant: 'second', mass: 1, damping: 0.8, stiffness: 4,
    kp: 7, ki: 2, kd: 1.5, sensorTau: 0.15, duration: 12, uMin: -3, uMax: 3 };
  const result = sensor.simulate(options);
  assert.ok(result.saturated);
  assert.ok(result.output.every(Number.isFinite));
  assert.ok(result.measured.every(Number.isFinite));
  result.control.forEach(value => assert.ok(value >= options.uMin && value <= options.uMax));
  const finer = sensor.simulate({ ...options, maxStep: result.step / 2 });
  for (let index = 0; index < result.output.length; index += 20) {
    close(result.output[index], finer.output[index], 2e-5);
    close(result.measured[index], finer.measured[index], 2e-5);
  }
});

test('invalid sensor time constants and excessive integration costs are rejected', () => {
  for (const sensorTau of [-1, NaN, Infinity]) {
    assert.throws(() => sensor.simulate({ sensorTau }));
  }
  assert.throws(() => sensor.simulate({ sensorTau: 1e-10 }), /too many integration steps/);
});
