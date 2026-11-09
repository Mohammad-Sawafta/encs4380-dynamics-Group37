// Run with: node tests/frequency-response.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/models/frequency-response.js'), 'utf8'), context);
const model = vm.runInContext('FrequencyResponseModel', context);
let assertions = 0;

function close(actual, expected, absoluteTolerance = 1e-12) {
  assert.ok(Number.isFinite(actual), `Expected a finite result, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= absoluteTolerance,
    `Expected ${expected} ± ${absoluteTolerance}, received ${actual}`);
  assertions++;
}

// Core equations and conversions.
for (const tau of [1e-6, 0.2, 1, 1e3]) {
  for (const omega of [0, 1e-6, 2, 1e3]) {
    const product = omega * tau;
    const expectedRatio = 1 / Math.sqrt(1 + product * product);
    close(model.amplitudeRatio(tau, omega), expectedRatio);
    close(model.phaseRadians(tau, omega), -Math.atan(product));
    close(model.phaseDegrees(tau, omega), -Math.atan(product) * 180 / Math.PI);
    close(model.bodeMagnitudeDb(tau, omega), 20 * Math.log10(expectedRatio), 1e-10);
    close(model.dynamicError(tau, omega), expectedRatio - 1);
  }
}

for (const frequency of [0, 0.001, 1, 50, 100, 1e6]) {
  close(model.radiansPerSecondToHz(model.hzToRadiansPerSecond(frequency)), frequency, 1e-10);
}

// At cutoff: M = 1/sqrt(2), phase = -45 degrees, magnitude = -3.0103 dB.
for (const tau of [0.001, 0.2, 5]) {
  const cutoff = model.cutoffFrequency(tau);
  close(cutoff, 1 / tau);
  close(model.amplitudeRatio(tau, cutoff), 1 / Math.sqrt(2));
  close(model.phaseDegrees(tau, cutoff), -45);
  close(model.bodeMagnitudeDb(tau, cutoff), -3.010299956639812);
}

// Validation 2: tau = 0.2 s, omega = 2 rad/s.
const validation2Ratio = model.amplitudeRatio(0.2, 2);
const validation2Phase = Math.abs(model.phaseDegrees(0.2, 2));
close(validation2Ratio, 0.9284766908852592);
close(validation2Phase, 21.80140948635181);
assert.ok(Math.abs(validation2Ratio - 0.93) <= 0.005);
assert.ok(Math.abs(validation2Phase - 21.8) <= 0.05);
assertions += 2;

// Validation 3: 100 Hz with 5% maximum attenuation error.
const tauMax = model.maximumPermissibleTau(100, 0.05);
const phaseAt50 = Math.abs(model.phaseDegrees(tauMax, model.hzToRadiansPerSecond(50)));
close(tauMax, 0.0005231170005495252, 1e-15);
close(phaseAt50, 9.332682729364036, 1e-12);
assert.ok(Math.abs(tauMax * 1000 - 0.52) <= 0.01);
assert.ok(Math.abs(phaseAt50 - 9.3) <= 0.1);
assertions += 2;

// The output formula includes both gain attenuation and phase shift.
close(model.steadyStateOutput(0, 0.2, 2, 3),
  3 * validation2Ratio * Math.sin(model.phaseRadians(0.2, 2)));

// Low/high-frequency behavior and numerical stability.
close(model.amplitudeRatio(1, 0), 1);
close(model.phaseDegrees(1, 0), 0);
assert.ok(model.amplitudeRatio(1, 1e150) > 0);
assert.ok(model.amplitudeRatio(1, 1e150) < 1e-149);
assert.ok(model.phaseDegrees(1, 1e150) < -89.999999);
assert.ok(model.bodeMagnitudeDb(1, 1e-150) <= 0);
assertions += 4;

for (const badTau of [0, -1, Infinity, NaN]) {
  assert.throws(() => model.amplitudeRatio(badTau, 1), /time constant/);
  assertions++;
}
for (const badOmega of [-1, Infinity, NaN]) {
  assert.throws(() => model.phaseRadians(1, badOmega), /Angular frequency/);
  assertions++;
}
for (const badError of [0, 1, -0.1, NaN]) {
  assert.throws(() => model.maximumPermissibleTau(100, badError), /Allowed error/);
  assertions++;
}

console.log(`PASS: ${assertions} frequency-response assertions, including homework validations 2 and 3.`);
