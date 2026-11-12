'use strict';

// Run with: node --test tests/sensor-challenge.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const context = vm.createContext({});
for (const file of ['first-order', 'frequency-response', 'second-order', 'sensor-challenge']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/models/${file}.js`), 'utf8'), context);
}
const challenge = vm.runInContext('SensorChallenge', context);

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Number.isFinite(actual), `Expected a finite result, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `Expected ${expected}, received ${actual}`);
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function prefixed(values, seed = 17) {
  let index = 0;
  const random = seeded(seed);
  return () => index < values.length ? values[index++] : random();
}

function round(kind, low = 0, high = 0.9999999999999999, frequency = 0.5) {
  const choice = { 'first-step': 0.1, 'first-sine': 0.5, 'second-step': 0.8 }[kind];
  return challenge.createRound({ random: prefixed([choice, low, high, frequency]) });
}

// Independent RK4 integrations use the differential equations, not the models.
function integrateStep(time, zeta, omega) {
  if (time === 0) return 0;
  const count = Math.max(2000, Math.ceil(time / 0.001));
  const dt = time / count;
  const acceleration = (position, velocity) => omega * omega * (1 - position) - 2 * zeta * omega * velocity;
  let position = 0;
  let velocity = 0;
  for (let i = 0; i < count; i += 1) {
    const a1 = acceleration(position, velocity);
    const v2 = velocity + dt * a1 / 2;
    const a2 = acceleration(position + dt * velocity / 2, v2);
    const v3 = velocity + dt * a2 / 2;
    const a3 = acceleration(position + dt * v2 / 2, v3);
    const v4 = velocity + dt * a3;
    const a4 = acceleration(position + dt * v3, v4);
    position += dt * (velocity + 2 * v2 + 2 * v3 + v4) / 6;
    velocity += dt * (a1 + 2 * a2 + 2 * a3 + a4) / 6;
  }
  return position;
}

function integrateSine(time, gain, tau, omega) {
  const start = -35 * tau;
  const count = Math.ceil((time - start) / 0.001);
  const dt = (time - start) / count;
  const derivative = (t, y) => (gain * Math.sin(omega * t) - y) / tau;
  let output = 0;
  for (let i = 0; i < count; i += 1) {
    const t = start + i * dt;
    const k1 = derivative(t, output);
    const k2 = derivative(t + dt / 2, output + dt * k1 / 2);
    const k3 = derivative(t + dt / 2, output + dt * k2 / 2);
    const k4 = derivative(t + dt, output + dt * k3);
    output += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
  }
  return output;
}

test('generation covers all variants, boundaries, known input, and bounded fixed noise', () => {
  for (const kind of ['first-step', 'first-sine', 'second-step']) {
    const current = round(kind);
    assert.equal(current.kind, kind);
    assert.equal(current.times.length, current.clean.length);
    assert.equal(current.times.length, current.observed.length);
    close(current.times[0], 0);
    close(current.times.at(-1), current.end);
    if (kind === 'second-step') {
      close(current.parameters.zeta, 0.2);
      close(current.parameters.omegaN, 5);
      assert.equal(current.end, 30);
      close(current.noiseBound, 0.01);
    } else {
      close(current.parameters.gain, 0.5);
      close(current.parameters.tau, 3);
      if (kind === 'first-step') {
        assert.equal(current.end, 24);
        close(current.noiseBound, 0.005);
      } else {
        assert.ok([0.5, 1, 2].includes(current.omega));
        close(current.end * current.omega / (2 * Math.PI), 4);
        assert.ok(current.times.length >= 801);
        close(current.noiseBound, 0.005 / Math.sqrt(1 + (current.omega * 3) ** 2));
        current.input.forEach((value, i) => close(value, Math.sin(current.omega * current.times[i])));
      }
    }
    for (let i = 0; i < current.times.length; i += 1) {
      assert.ok(Number.isFinite(current.clean[i]) && Number.isFinite(current.observed[i]));
      assert.ok(Math.abs(current.observed[i] - current.clean[i]) <= current.noiseBound + 1e-14);
      if (i > 0 && kind !== 'first-sine') assert.ok(current.times[i] - current.times[i - 1] <= 0.010000000001);
    }
    assert.ok(current.observed.some((value, i) => value !== current.clean[i]));
    const snapshot = JSON.stringify(current);
    challenge.validateGuess(current, {});
    challenge.response(current, current.parameters);
    assert.equal(JSON.stringify(current), snapshot);
    assert.ok(Object.isFrozen(current) && Object.isFrozen(current.observed) && Object.isFrozen(current.parameters));
    assert.throws(() => { current.observed[0] = 100; }, TypeError);
  }
});

test('seeded generation varies sensors and retains the documented distribution and ranges', () => {
  const random = seeded(719);
  const counts = { 'first-step': 0, 'first-sine': 0, 'second-step': 0 };
  const signatures = new Set();
  for (let i = 0; i < 120; i += 1) {
    const current = challenge.createRound({ random });
    counts[current.kind] += 1;
    signatures.add(JSON.stringify(current.parameters));
    if (current.kind === 'second-step') {
      assert.ok(current.parameters.zeta >= 0.2 && current.parameters.zeta <= 0.7);
      assert.ok(current.parameters.omegaN >= 1 && current.parameters.omegaN <= 5);
    } else {
      assert.ok(current.parameters.gain >= 0.5 && current.parameters.gain <= 3);
      assert.ok(current.parameters.tau >= 0.5 && current.parameters.tau <= 3);
    }
  }
  assert.equal(signatures.size, 120);
  assert.ok(counts['first-step'] > 30 && counts['first-step'] < 70);
  assert.ok(counts['first-sine'] > 10 && counts['first-sine'] < 40);
  assert.ok(counts['second-step'] > 30 && counts['second-step'] < 70);
  for (const [selector, expected] of [[0, 'first-step'], [0.399999, 'first-step'], [0.4, 'first-sine'], [0.599999, 'first-sine'], [0.6, 'second-step']]) {
    assert.equal(challenge.createRound({ random: prefixed([selector, 0.5, 0.5]) }).kind, expected);
  }
  for (const [selector, expected] of [[0, 0.5], [0.4, 1], [0.9, 2]]) {
    assert.equal(round('first-sine', 0.5, 0.5, selector).omega, expected);
  }
});

test('first-order steps reproduce independent lecture values and retain the round time axis', () => {
  const current = round('first-step');
  for (const gain of [0.5, 3, 7]) {
    for (const tau of [0.5, 3, 8]) {
      const values = challenge.response({ ...current, times: [0, tau, 3 * tau, 8 * tau] }, { gain, tau });
      close(values[0], 0);
      close(values[1] / gain, 0.6321205588285577);
      close(values[2] / gain, 0.950212931632136);
      close(values[3] / gain, 0.9996645373720975);
    }
  }
  const checked = challenge.validateGuess(current, { gain: '7', tau: '8' });
  assert.equal(checked.valid, true);
  assert.equal(checked.curve.length, current.times.length);
});

test('sine responses agree with independently integrated forced dynamics at range extremes', () => {
  for (const tau of [0.5, 3]) {
    for (const omega of [0.5, 2]) {
      const current = round('first-sine');
      const times = [0, Math.PI / (2 * omega), Math.PI / omega, 3 * Math.PI / (2 * omega)];
      const values = challenge.response({ ...current, omega, times }, { gain: 3, tau });
      values.forEach((value, i) => close(value, integrateSine(times[i], 3, tau, omega), 1e-8));
      assert.ok(values[0] < 0, 'Output must lag the known sine input at t = 0.');
    }
  }
});

test('normalized second-order curves agree with independent RK4 and settle within the promised tolerance', () => {
  const current = round('second-step');
  for (const zeta of [0.2, 0.5, 0.7]) {
    for (const omegaN of [1, 2, 5]) {
      const times = [0, 0.5, 1, 3, 30];
      const values = challenge.response({ ...current, times }, { zeta, omegaN });
      values.forEach((value, i) => close(value, integrateStep(times[i], zeta, omegaN), 1e-8));
      assert.ok(Math.abs(values.at(-1) - 1) < 0.003);
    }
  }
  const peakTime = 2 * Math.PI / Math.sqrt(3);
  const peak = challenge.response({ ...current, times: [peakTime] }, { zeta: 0.5, omegaN: 1 })[0];
  close(100 * (peak - 1), 16.30335348215805);
  assert.equal(challenge.validateGuess(current, { zeta: '0.8', omegaN: '8' }).valid, true);
});

test('scoring uses unrounded parameters and an inclusive ten-percent boundary', () => {
  const current = { kind: 'first-step', parameters: { gain: 2, tau: 1 } };
  for (const multiplier of [0.9, 1, 1.1, 1.099999999]) {
    const result = challenge.score(current, { gain: 2 * multiplier, tau: multiplier });
    assert.equal(result.points, 100);
    assert.equal(result.maxPoints, 100);
    assert.ok(result.parameters.every(parameter => parameter.passed));
  }
  for (const multiplier of [0.899999999, 1.100000001]) {
    assert.equal(challenge.score(current, { gain: 2 * multiplier, tau: multiplier }).points, 0);
  }
  const partial = challenge.score(current, { gain: 2.1, tau: 1.2 });
  assert.equal(partial.points, 50);
  close(partial.parameters[0].errorPercent, 5);
  close(partial.parameters[1].errorPercent, 20);
  const precise = { kind: 'first-step', parameters: { gain: 1.23456789, tau: 2.34567891 } };
  assert.equal(challenge.score(precise, precise.parameters).points, 100);
});

test('invalid raw and numerically unrepresentable guesses never produce a curve or result', () => {
  const first = round('first-step');
  for (const bad of ['', ' ', undefined, null, true, [], {}, 'hello', 'Infinity', Infinity, NaN, 0, -1]) {
    const result = challenge.validateGuess(first, { gain: bad, tau: 1 });
    assert.equal(result.valid, false, `Unexpected valid gain: ${String(bad)}`);
    assert.ok(result.errors.gain);
  }
  const second = round('second-step');
  for (const bad of [0, 1, 1.1, -0.2, NaN]) {
    const result = challenge.validateGuess(second, { zeta: bad, omegaN: 2 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.zeta);
  }
  for (const [current, values] of [
    [first, { gain: 1e308, tau: 1 }],
    [first, { gain: 1, tau: 1e-320 }],
    [round('first-sine'), { gain: 1, tau: 1e308 }],
    [second, { zeta: 0.5, omegaN: 1e200 }],
    [second, { zeta: 0.5, omegaN: 1e-200 }]
  ]) {
    const result = challenge.validateGuess(current, values);
    assert.equal(result.valid, false);
    assert.ok(Object.keys(result.errors).length > 0);
  }
});

test('a session scores once, cannot skip, preserves totals, and resets only with a new session', () => {
  const session = challenge.createSession(seeded(72));
  const original = session.round;
  assert.equal(session.result, null);
  assert.equal(session.totals.points, 0);
  assert.equal(session.totals.possible, 0);
  assert.equal(session.totals.rounds, 0);
  assert.equal(session.next(), original);
  assert.equal(session.submit({}).ok, false);
  assert.equal(session.result, null);
  assert.equal(session.totals.rounds, 0);
  const submission = session.submit(original.parameters);
  assert.equal(submission.ok, true);
  assert.equal(submission.result.points, 100);
  assert.equal(submission.result.curve.length, original.times.length);
  assert.equal(session.result, submission.result);
  assert.equal(session.totals.points, 100);
  assert.equal(session.totals.possible, 100);
  assert.equal(session.totals.rounds, 1);
  assert.equal(session.submit({}).ok, false);
  assert.equal(session.result, submission.result);
  assert.equal(session.totals.rounds, 1);
  const next = session.next();
  assert.notEqual(next, original);
  assert.equal(session.result, null);
  assert.equal(session.totals.points, 100);
  assert.equal(session.submit(next.parameters).ok, true);
  assert.equal(session.totals.points, 200);
  assert.equal(session.totals.possible, 200);
  assert.equal(session.totals.rounds, 2);
  assert.ok(Object.isFrozen(session.result) && Object.isFrozen(session.totals));
  assert.equal(challenge.createSession(seeded(72)).totals.rounds, 0);
});

test('repeated random values cannot hang generation or immediately repeat the same sensor', () => {
  const previous = challenge.createRound({ random: () => 0.25 });
  let draws = 0;
  const next = challenge.createRound({ random: () => { draws += 1; return 0.25; }, previous });
  assert.notEqual(`${next.kind}:${JSON.stringify(next.parameters)}`, `${previous.kind}:${JSON.stringify(previous.parameters)}`);
  assert.ok(draws < 10000, 'Retry count must be bounded.');
});
