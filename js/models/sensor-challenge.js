// Pure challenge mathematics and session state; no DOM or plotting dependency.
const SensorChallenge = (() => {
  'use strict';

  const FIRST_KEYS = ['gain', 'tau'];
  const SECOND_KEYS = ['zeta', 'omegaN'];
  const LABELS = { gain: 'K', tau: 'Tau', zeta: 'Zeta', omegaN: 'Natural frequency' };
  const SINE_FREQUENCIES = [0.5, 1, 2];

  function parameterKeys(round) {
    if (round.kind === 'second-step') return SECOND_KEYS;
    if (round.kind === 'first-step' || round.kind === 'first-sine') return FIRST_KEYS;
    throw new RangeError('Unknown sensor response type.');
  }

  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }

  function draw(random) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Random values must be finite numbers from zero up to, but not including, one.');
    }
    return value;
  }

  function candidate(random) {
    const choice = draw(random);
    if (choice >= 0.6) {
      return {
        kind: 'second-step',
        parameters: { zeta: 0.2 + 0.5 * draw(random), omegaN: 1 + 4 * draw(random) }
      };
    }
    const sensor = {
      kind: choice < 0.4 ? 'first-step' : 'first-sine',
      parameters: { gain: 0.5 + 2.5 * draw(random), tau: 0.5 + 2.5 * draw(random) }
    };
    if (sensor.kind === 'first-sine') {
      sensor.omega = SINE_FREQUENCIES[Math.floor(draw(random) * SINE_FREQUENCIES.length)];
    }
    return sensor;
  }

  function sameSensor(first, second) {
    return second && first.kind === second.kind &&
      parameterKeys(first).every(key => first.parameters[key] === second.parameters[key]);
  }

  function requirePhysicalValues(round, values) {
    for (const key of parameterKeys(round)) {
      if (!Number.isFinite(values[key]) || values[key] <= 0 || (key === 'zeta' && values[key] >= 1)) {
        throw new RangeError('Sensor parameters must be positive finite numbers, with zeta below one.');
      }
    }
  }

  function requireFinite(values) {
    if (!values.every(Number.isFinite)) {
      throw new RangeError('These estimates are outside the representable numerical range.');
    }
  }

  function response(round, values) {
    requirePhysicalValues(round, values);
    let curve;
    if (round.kind === 'first-step') {
      // Reject an unrepresentable time ratio rather than quietly turning it into infinity.
      requireFinite(round.times.map(time => time / values.tau));
      curve = round.times.map(time => FirstOrderModel.stepResponse(time, values.tau, values.gain, 1));
    } else if (round.kind === 'first-sine') {
      if (!Number.isFinite(round.omega) || round.omega <= 0) {
        throw new RangeError('Sine angular frequency must be positive and finite.');
      }
      requireFinite([round.omega * values.tau, ...round.times.map(time => round.omega * time)]);
      curve = round.times.map(time =>
        FrequencyResponseModel.steadyStateOutput(time, values.tau, round.omega, values.gain));
    } else {
      const stiffness = values.omegaN ** 2;
      const damping = 2 * values.zeta * values.omegaN;
      requireFinite([stiffness, damping, 1 / stiffness, ...round.times.map(time => values.omegaN * time)]);
      const model = SecondOrderModel.create(1, damping, stiffness);
      curve = round.times.map(time => {
        const state = model.state(time);
        requireFinite([state.position, state.velocity]);
        // The mechanical model's final displacement is 1/k. Normalize to DC gain one.
        return state.position / model.final;
      });
    }
    requireFinite(curve);
    return curve;
  }

  function createRound({ random = Math.random, previous = null } = {}) {
    let sensor = candidate(random);
    for (let attempt = 0; sameSensor(sensor, previous) && attempt < 8; attempt += 1) {
      sensor = candidate(random);
    }
    if (sameSensor(sensor, previous)) {
      // A deterministic fallback also terminates when tests supply a constant random source.
      if (sensor.kind === 'second-step') {
        sensor.parameters.zeta = 0.2 + (sensor.parameters.zeta - 0.2 + 0.25) % 0.5;
      } else {
        sensor.parameters.gain = 0.5 + (sensor.parameters.gain - 0.5 + 1.25) % 2.5;
      }
    }
    const end = sensor.kind === 'first-sine' ? 8 * Math.PI / sensor.omega :
      sensor.kind === 'first-step' ? 24 : 30;
    const intervals = sensor.kind === 'first-sine' ? 800 : Math.ceil(end / 0.01);
    const times = Array.from({ length: intervals + 1 }, (_, index) => end * index / intervals);
    const clean = response({ ...sensor, times }, sensor.parameters);
    const amplitude = sensor.kind === 'second-step' ? 1 : sensor.kind === 'first-step' ? sensor.parameters.gain :
      sensor.parameters.gain * FrequencyResponseModel.amplitudeRatio(sensor.parameters.tau, sensor.omega);
    const noiseBound = 0.01 * amplitude;
    const observed = clean.map(value => value + (2 * draw(random) - 1) * noiseBound);
    const input = sensor.kind === 'first-sine' ? times.map(time => Math.sin(sensor.omega * time)) : null;
    return freeze({ ...sensor, times, observed, clean, input, end, noiseBound });
  }

  function score(round, values) {
    requirePhysicalValues(round, values);
    const parameters = parameterKeys(round).map(key => {
      const trueValue = round.parameters[key];
      const estimate = values[key];
      const errorPercent = 100 * (Math.abs(estimate - trueValue) / Math.abs(trueValue));
      requireFinite([errorPercent]);
      // Decimal inputs such as 1.1 can land a few floating-point units above 10%.
      const roundoff = 32 * Number.EPSILON * Math.max(10, errorPercent);
      const passed = errorPercent <= 10 + roundoff;
      return { key, trueValue, estimate, errorPercent, passed };
    });
    return freeze({ points: parameters.filter(parameter => parameter.passed).length * 50, maxPoints: 100, parameters });
  }

  function parseNumber(raw) {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string' || raw.trim() === '') return NaN;
    // Accept ordinary decimal and scientific notation, not coercions such as [] or booleans.
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) return NaN;
    return Number(raw);
  }

  function validateGuess(round, raw) {
    const values = {};
    const errors = {};
    for (const key of parameterKeys(round)) {
      const value = parseNumber(raw && raw[key]);
      if (!Number.isFinite(value)) errors[key] = `Enter a finite number for ${LABELS[key]}.`;
      else if (value <= 0) errors[key] = `${LABELS[key]} must be greater than zero.`;
      else if (key === 'zeta' && value >= 1) errors[key] = 'Zeta must be less than one for this underdamped sensor.';
      else values[key] = value;
    }
    if (Object.keys(errors).length) return { valid: false, errors, values: null, curve: null };
    try {
      const curve = response(round, values);
      // A finite curve alone is insufficient if the error calculation would overflow.
      score(round, values);
      return { valid: true, errors, values, curve };
    } catch (error) {
      for (const key of parameterKeys(round)) {
        errors[key] = 'These estimates are too large or too small to calculate. Enter representable values.';
      }
      return { valid: false, errors, values: null, curve: null };
    }
  }

  function createSession(random = Math.random) {
    let round = createRound({ random });
    let result = null;
    let totals = freeze({ points: 0, possible: 0, rounds: 0 });
    return Object.freeze({
      get round() { return round; },
      get result() { return result; },
      get totals() { return totals; },
      submit(raw) {
        if (result) return { ok: false, errors: { round: 'This round has already been scored.' }, result };
        const validation = validateGuess(round, raw);
        if (!validation.valid) return { ok: false, errors: validation.errors, result: null };
        result = freeze({ ...score(round, validation.values), values: validation.values, curve: validation.curve });
        totals = freeze({ points: totals.points + result.points, possible: totals.possible + 100, rounds: totals.rounds + 1 });
        return { ok: true, errors: {}, result };
      },
      next() {
        if (!result) return round;
        const nextRound = createRound({ random, previous: round });
        round = nextRound;
        result = null;
        return round;
      }
    });
  }

  return Object.freeze({ createRound, response, validateGuess, score, createSession });
})();
