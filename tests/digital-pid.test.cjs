const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['pid-control', 'digital-pid']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/models/' + file + '.js'), 'utf8'), context);
}
const continuous = vm.runInContext('PIDControlModel', context);
const digital = vm.runInContext('DigitalPIDModel', context);
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `Expected ${expected}, got ${actual}, tolerance ${tolerance}`);

test('controller update follows the assignment equation', () => {
  const p = digital.configure({ kp: 2, ki: 3, kd: 4, sampleTime: 0.2, setpoint: 1, uMin: -100, uMax: 100 });
  const result = digital.controllerUpdate(p, 0.25, 0.4, 0.5);
  close(result.error, 0.75);
  close(result.integral, 0.55);
  close(result.derivative, 5);
  close(result.requested, 2 * 0.75 + 3 * 0.55 + 5);
  assert.equal(result.integralBlocked, false);
});

test('sample times are uniform and the command is held through each interval', () => {
  const result = digital.simulate({ kp: 2, ki: 1, sampleTime: 0.2, duration: 2, uMin: -100, uMax: 100 });
  for (let index = 1; index < result.time.length; index++) close(result.time[index] - result.time[index - 1], 0.2, 1e-12);
  result.control.forEach(Number.isFinite);
  assert.equal(result.time.length, 11);
  assert.equal(result.output.length, result.control.length);
});

test('fast sampled PI approaches the continuous PI response', () => {
  const options = { kp: 1, ki: 1, kd: 0, duration: 8, uMin: -100, uMax: 100 };
  const sampled = digital.simulate({ ...options, sampleTime: 0.001 });
  const exact = continuous.simulate({ ...options, samples: 8000 });
  for (let index = 0; index < sampled.output.length; index += 200) {
    const exactIndex = Math.round(sampled.time[index] / options.duration * (exact.time.length - 1));
    close(sampled.output[index], exact.output[exactIndex], 0.001);
  }
});

test('large sampling time visibly degrades and destabilizes fixed gains', () => {
  const base = { kp: 2, ki: 4, kd: 0, duration: 12, uMin: -100, uMax: 100 };
  const fast = digital.simulate({ ...base, sampleTime: 0.02 });
  const coarse = digital.simulate({ ...base, sampleTime: 0.4 });
  const unstable = digital.simulate({ ...base, sampleTime: 0.8 });
  assert.ok(coarse.metrics.overshootPercent > fast.metrics.overshootPercent + 5);
  assert.ok(unstable.metrics.overshootPercent > 100);
  assert.equal(unstable.metrics.settlingTime, null);
});

test('conditional anti-windup blocks accumulation and reduces overshoot', () => {
  const options = { kp: 4, ki: 8, kd: 0, sampleTime: 0.1, setpoint: 1,
    uMin: 0, uMax: 1.2, duration: 10 };
  const off = digital.simulate({ ...options, antiWindup: false });
  const on = digital.simulate({ ...options, antiWindup: true });
  assert.equal(off.integralBlocked, false);
  assert.equal(on.integralBlocked, true);
  assert.ok(Math.max(...on.integral) < Math.max(...off.integral));
  assert.ok(on.metrics.overshootPercent < off.metrics.overshootPercent);
  assert.ok(on.metrics.settlingTime < off.metrics.settlingTime);
});

test('second-order sampled PID remains finite and respects limits', () => {
  const result = digital.simulate({ plant: 'second', mass: 1, damping: 0.8, stiffness: 4,
    kp: 6, ki: 2, kd: 1, sampleTime: 0.05, duration: 12, uMin: -3, uMax: 3 });
  assert.ok(result.saturated);
  assert.ok(result.output.every(Number.isFinite));
  result.control.forEach(value => assert.ok(value >= -3 && value <= 3));
});

test('generated Arduino code contains current gains, Ts, limits, and anti-windup choice', () => {
  const on = digital.arduinoCode({ kp: 2.5, ki: 1.2, kd: 0.3, sampleTime: 0.05,
    setpoint: 1.4, uMin: 0, uMax: 100, antiWindup: true });
  for (const fragment of ['KP = 2.5f', 'KI = 1.2f', 'KD = 0.3f', 'TS = 0.05f',
    'SAMPLE_MS = 50UL', 'U_MIN = 0f', 'U_MAX = 100f', 'pushesFurther', 'constrain']) assert.match(on, new RegExp(fragment));
  const off = digital.arduinoCode({ sampleTime: 0.1, antiWindup: false });
  assert.doesNotMatch(off, /pushesFurther/);
  assert.match(off, /integral = nextIntegral/);
});

test('invalid sampling and anti-windup settings are rejected', () => {
  for (const options of [{ sampleTime: 0 }, { sampleTime: -1 }, { sampleTime: Infinity },
    { sampleTime: 13, duration: 12 }, { antiWindup: 'yes' }]) assert.throws(() => digital.simulate(options));
  assert.throws(() => digital.simulate({ tau: 1e-10 }), /too many integration steps/);
});
