const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['pid-control', 'pid-tuning-challenge']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/models/' + file + '.js'), 'utf8'), context);
}
const challengeModel = vm.runInContext('PIDTuningChallenge', context);
const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Expected ${expected}, got ${actual}`);

test('challenge generation covers documented parameter boundaries', () => {
  const low = challengeModel.createChallenge(() => 0);
  close(low.gain, 0.7); close(low.tau, 0.6);
  let index = 0; const values = [1 - Number.EPSILON, 1 - Number.EPSILON];
  const high = challengeModel.createChallenge(() => values[index++]);
  assert.ok(high.gain < 1.5 && high.gain > 1.49);
  assert.ok(high.tau < 2 && high.tau > 1.99);
  assert.equal(low.overshootPercent, 10);
  assert.equal(low.settlingTime, 6);
  assert.equal(low.steadyStateError, 0.02);
});

test('invalid random sources and gain inputs are rejected honestly', () => {
  for (const value of [-1, 1, NaN, Infinity]) assert.throws(() => challengeModel.createChallenge(() => value));
  for (const gains of [{ kp: -1, ki: 1, kd: 0 }, { kp: 21, ki: 1, kd: 0 },
    { kp: 1, ki: 11, kd: 0 }, { kp: 1, ki: 1, kd: 6 }, { kp: '', ki: 1, kd: 0 }]) {
    assert.equal(challengeModel.validateGains(gains).valid, false);
  }
});

test('a feasible reference design passes every specification across the full plant range', () => {
  for (const pair of [[0, 0], [0, 1 - Number.EPSILON], [1 - Number.EPSILON, 0],
    [1 - Number.EPSILON, 1 - Number.EPSILON], [0.5, 0.5]]) {
    let index = 0; const challenge = challengeModel.createChallenge(() => pair[index++]);
    const gains = challengeModel.referenceGains(challenge);
    const evaluation = challengeModel.evaluate(challenge, gains);
    assert.equal(evaluation.ok, true);
    assert.equal(evaluation.result.points, 3);
    assert.equal(evaluation.result.passed, true);
    assert.ok(evaluation.result.checks.every(check => check.passed));
  }
});

test('zero and proportional-only controllers fail the appropriate requirements', () => {
  let index = 0; const challenge = challengeModel.createChallenge(() => [0.5, 0.5][index++]);
  const off = challengeModel.evaluate(challenge, { kp: 0, ki: 0, kd: 0 }).result;
  assert.equal(off.points, 1, 'zero output has no overshoot but fails settling and error');
  assert.equal(off.checks.find(check => check.key === 'settling').passed, false);
  assert.equal(off.checks.find(check => check.key === 'error').passed, false);
  const proportional = challengeModel.evaluate(challenge, { kp: 10, ki: 0, kd: 0 }).result;
  assert.equal(proportional.checks.find(check => check.key === 'error').passed, false);
});

test('score equals the number of independently passing checks', () => {
  let index = 0; const challenge = challengeModel.createChallenge(() => [0.25, 0.75][index++]);
  for (const gains of [{ kp: 1, ki: 0, kd: 0 }, { kp: 2, ki: 1, kd: 0 },
    challengeModel.referenceGains(challenge), { kp: 20, ki: 10, kd: 0 }]) {
    const result = challengeModel.evaluate(challenge, gains).result;
    assert.equal(result.points, result.checks.filter(check => check.passed).length);
    assert.equal(result.possible, 3);
    assert.equal(result.passed, result.points === 3);
  }
});
