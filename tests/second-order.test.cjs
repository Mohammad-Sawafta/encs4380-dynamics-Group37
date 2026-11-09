const assert = require('node:assert/strict');
const { create, eigenvalues, measure } = require('../js/models/second-order.js');

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${expected}, got ${actual}`);
}

// Independently integrate the physical state equations with RK4.
function advance([x, v], dt, mass, damping, stiffness) {
  const acceleration = (position, velocity) => (1 - damping * velocity - stiffness * position) / mass;
  const a1 = acceleration(x, v);
  const v2 = v + dt * a1 / 2;
  const a2 = acceleration(x + dt * v / 2, v2);
  const v3 = v + dt * a2 / 2;
  const a3 = acceleration(x + dt * v2 / 2, v3);
  const v4 = v + dt * a3;
  const a4 = acceleration(x + dt * v3, v4);
  return [
    x + dt * (v + 2 * v2 + 2 * v3 + v4) / 6,
    v + dt * (a1 + 2 * a2 + 2 * a3 + a4) / 6
  ];
}

const cases = [
  [1, 2, 4, 'Underdamped'],
  [1, 4, 4, 'Critical'],
  [1, 8, 4, 'Overdamped'],
  [1, 3.9999, 4, 'Underdamped'],
  [1, 4.0001, 4, 'Overdamped'],
  [3, 0.5, 10, 'Underdamped'],
  [0.5, 12, 1, 'Overdamped'],
  [3, 12, 1, 'Overdamped'],
  [0.5, 0.5, 10, 'Underdamped']
];

for (const [mass, damping, stiffness, regime] of cases) {
  const model = create(mass, damping, stiffness);
  assert.equal(model.regime, regime);
  assert.deepEqual(model.state(0), { position: 0, velocity: 0 });
  assert.deepEqual(model.A, [[0, 1], [-stiffness / mass, -damping / mass]]);
  assert.deepEqual(model.B, [0, 1 / mass]);
  eigenvalues(model.A).forEach((pole, i) => {
    near(pole.real, model.poles[i].real);
    near(pole.imag, model.poles[i].imag);
    assert.ok(pole.real < 0);
  });

  const { t10, t90, riseTime, peakTime, overshoot, settlingTime } = measure(model);
  const normalized = time => model.state(time).position / model.final;
  near(normalized(t10), 0.1);
  near(normalized(t90), 0.9);
  assert.ok(riseTime > 0 && settlingTime > t90);
  near(Math.abs(normalized(settlingTime) - 1), 0.02);
  assert.ok(Math.abs(normalized(settlingTime - 1e-5) - 1) > 0.02);
  const horizon = 2 * settlingTime;
  for (let i = 1; i <= 1000; i += 1) {
    assert.ok(Math.abs(normalized(settlingTime + i * settlingTime / 1000) - 1) <= 0.02 + 1e-12);
  }
  if (regime === 'Underdamped') {
    assert.ok(peakTime > t90);
    near(model.state(peakTime).velocity, 0);
    near(100 * (normalized(peakTime) - 1), overshoot);
  } else {
    assert.equal(peakTime, null);
    assert.equal(overshoot, 0);
  }

  let integrated = [0, 0];
  const dt = horizon / 20000;
  for (let i = 1; i <= 20000; i += 1) {
    integrated = advance(integrated, dt, mass, damping, stiffness);
    if (i % 200 === 0) {
      const { position, velocity } = model.state(i * dt);
      near(position, integrated[0], 1e-7);
      near(velocity, integrated[1], 1e-7);
    }
  }
}

const reference = create(1, 2, 4);
near(measure(reference).overshoot, 16.3, 0.05);
near(reference.poles[0].real, -1);
near(reference.poles[0].imag, 1.732, 0.0005);
assert.equal(measure(create(1, 4, 4)).overshoot, 0);
console.log('PASS: all three damping regimes, RK4 comparisons, timing metrics, and validations 4–6.');
