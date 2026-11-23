const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['pid-control', 'digital-pid', 'micromouse-system']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/models/' + file + '.js'), 'utf8'), context);
}
const model = vm.runInContext('MicromouseSystemModel', context);
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Expected ${expected}, got ${actual}, tolerance ${tolerance}`);

test('sample parser accepts comma or whitespace pairs and comments', () => {
  const samples = model.parseSamples('# test only\n0, 10\n0.5 12\n1;15\n1.5,18\n2 19');
  assert.equal(samples.length, 5);
  assert.equal(samples[2].speed, 15);
  assert.throws(() => model.parseSamples('0,0\n1,1\n1,2\n2,3\n3,4'), /strictly increasing/);
});

test('identification handles nonzero PWM and speed baselines', () => {
  const baselineSpeed = 20, baselinePwm = 10, stepPwm = 50, gain = 2, tau = 1.5;
  const times = Array.from({ length: 31 }, (_, index) => index * 0.5);
  const samples = times.map(time => ({ time, speed: time === 0 ? baselineSpeed :
    baselineSpeed + gain * (stepPwm - baselinePwm) * (1 - Math.exp(-time / tau)) }));
  const result = model.identify({ samples, baselineSpeed, baselinePwm, stepPwm, stepTime: 0 });
  close(result.gain, gain, 0.01);
  close(result.tau, tau, 0.03);
  close(result.crossingTime, tau, 0.03);
  assert.ok(result.rmse < 0.5);
});

test('identification rejects invalid or unsupported data', () => {
  const base = { samplesText: '0,0\n1,1\n2,2\n3,3\n4,4', baselineSpeed: 0,
    baselinePwm: 20, stepPwm: 20, stepTime: 0 };
  assert.throws(() => model.identify(base), /nonzero/);
  assert.throws(() => model.identify({ ...base, stepPwm: 120 }), /between 0% and 100%/);
  assert.throws(() => model.identify({ ...base, stepPwm: 40, baselineSpeed: 10 }), /same direction/);
});

test('motor simulation enforces 0 to 100 percent PWM and anti-windup', () => {
  const result = model.simulate({ gain: 3, tau: 0.4, setpoint: 500, kp: 2, ki: 4,
    kd: 0, sampleTime: 0.02, duration: 3 });
  assert.equal(result.parameters.uMin, 0);
  assert.equal(result.parameters.uMax, 100);
  assert.equal(result.parameters.antiWindup, true);
  assert.ok(result.control.every(command => command >= 0 && command <= 100));
  assert.equal(result.integralBlocked, true);
});

test('continuous PID approximation uses the closed-loop characteristic equation', () => {
  const result = model.continuousApproximation({ gain: 1, tau: 1, kp: 1, ki: 1, kd: 0 });
  close(result.naturalFrequency, 1);
  close(result.dampingRatio, 1);
  assert.equal(model.continuousApproximation({ gain: 1, tau: 1, kp: 1, ki: 0, kd: 0 }), null);
});

test('specifications scale with identified tau and target speed', () => {
  const specs = model.specifications({ tau: 0.5, targetSpeed: 300 });
  close(specs.maximumRiseTime, 0.75);
  close(specs.maximumSettlingTime, 2);
  close(specs.maximumSteadyStateError, 6);
  assert.deepEqual([specs.desiredDampingMin, specs.desiredDampingMax], [0.6, 0.8]);
});

test('design evaluation includes the physical PWM constraint', () => {
  const result = model.simulate({ gain: 3, tau: 0.35, setpoint: 180, kp: 0.7, ki: 2,
    kd: 0, sampleTime: 0.02, duration: 4 });
  const specs = model.specifications({ tau: 0.35, targetSpeed: 180 });
  const approximation = model.continuousApproximation(result.parameters);
  const checks = model.evaluate(result, specs, approximation);
  assert.equal(Object.keys(checks).length, 6);
  assert.equal(checks.pwm.passed, true);
  assert.ok(checks.pwm.measured <= 100);
});

test('generated code matches sampled controller settings and exposes hardware hooks', () => {
  const code = model.arduinoCode({ gain: 2, tau: 0.5, kp: 1.2, ki: 0.8, kd: 0.1,
    sampleTime: 0.02, setpoint: 250, duration: 5 });
  for (const fragment of ['KP = 1.2f', 'KI = 0.8f', 'KD = 0.1f', 'TS = 0.02f',
    'SAMPLE_MS = 20UL', 'U_MIN = 0f', 'U_MAX = 100f', 'readEncoderSpeedRPM',
    'writeMotorPWMPercent', 'pushesFurther']) assert.match(code, new RegExp(fragment));
  assert.doesNotMatch(code, /pinMode|digitalWrite|attachInterrupt/);
});
