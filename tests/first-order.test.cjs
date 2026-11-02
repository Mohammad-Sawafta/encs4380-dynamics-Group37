// Run with: node tests/first-order.test.cjs
// This test uses an independent ODE integration to check both response formulas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/models/first-order.js'), 'utf8'), context);
const model = vm.runInContext('FirstOrderModel', context);
let assertions = 0;

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Number.isFinite(actual), 'The result must be finite.');
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `Expected ${expected}, received ${actual}`);
  assertions++;
}

// Integrate tau*y' + y = K*x(t) with RK4, without using the closed-form model.
function integrate(inputType, endTime, tau, gain, inputSize) {
  const count = 6000;
  const dt = endTime / count;
  const derivative = (time, output) =>
    (gain * (inputType === 'step' ? inputSize : inputSize * time) - output) / tau;
  let output = 0;
  for (let i = 0; i < count; i++) {
    const t = i * dt;
    const k1 = derivative(t, output);
    const k2 = derivative(t + dt / 2, output + dt * k1 / 2);
    const k3 = derivative(t + dt / 2, output + dt * k2 / 2);
    const k4 = derivative(t + dt, output + dt * k3);
    output += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
  }
  return output;
}

for (const tau of [0.5, 2, 5]) {
  for (const gain of [0.2, 1, 5]) {
    for (const inputSize of [0.5, 1, 3]) {
      const finalValue = gain * inputSize;
      close(model.stepResponse(0, tau, gain, inputSize), 0);
      close(model.rampResponse(0, tau, gain, inputSize), 0);
      close(model.stepResponse(tau, tau, gain, inputSize) / finalValue, 0.6321205588285577);
      close(model.stepResponse(3 * tau, tau, gain, inputSize) / finalValue, 0.950212931632136);
      for (const factor of [1, 3, 6]) {
        const t = factor * tau;
        close(model.stepResponse(t, tau, gain, inputSize), integrate('step', t, tau, gain, inputSize));
        close(model.rampResponse(t, tau, gain, inputSize), integrate('ramp', t, tau, gain, inputSize));
        close(model.rampError(t, tau, gain, inputSize),
          model.idealRamp(t, gain, inputSize) - model.rampResponse(t, tau, gain, inputSize));
      }
      const steadyError = gain * inputSize * tau;
      close(model.rampSteadyStateError(tau, gain, inputSize), steadyError);
      close(model.rampError(25 * tau, tau, gain, inputSize), steadyError);
      // Moving the asymptote tau seconds to the left aligns it with K*x(t).
      close(model.rampAsymptote(5 * tau, tau, gain, inputSize), model.idealRamp(4 * tau, gain, inputSize));
    }
  }
  for (const factor of [0, 1, 3, 6]) {
    const t = factor * tau;
    const epsilon = model.stepErrorFraction(t, tau);
    close(Math.log(epsilon), model.logStepError(t, tau));
    close(epsilon, (3 - model.stepResponse(t, tau, 3, 1)) / 3);
  }
  const lnSlope = (Math.log(model.stepErrorFraction(3 * tau, tau)) -
    Math.log(model.stepErrorFraction(tau, tau))) / (2 * tau);
  close(lnSlope, -1 / tau);
}

// Check a non-unit-gain case that catches accidentally using x(t) - y(t).
close(model.rampSteadyStateError(2, 3, 4), 24);
close(model.rampError(6, 2, 3, 4), 22.805110359171264);
close(model.stepResponse(0.00000001, 5), 1.999999998e-9, 1e-15);
for (const tau of [0, -1, Infinity, NaN]) {
  assert.throws(() => model.stepResponse(1, tau), /time constant/);
  assert.throws(() => model.rampResponse(1, tau), /time constant/);
  assertions += 2;
}
console.log(`PASS: ${assertions} numerical assertions, including independent step/ramp ODE integration.`);
