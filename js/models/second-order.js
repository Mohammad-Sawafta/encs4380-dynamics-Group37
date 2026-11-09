// Closed-form response of a mass-spring-damper at rest to a 1 N step.
const SecondOrderModel = (() => {
  'use strict';

  function create(mass, damping, stiffness) {
    if (![mass, damping, stiffness].every(value => Number.isFinite(value) && value > 0)) {
      throw new RangeError('Mass, damping, and stiffness must be positive finite numbers.');
    }
    const omega = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(mass * stiffness));
    const decay = damping / (2 * mass);
    const regime = Math.abs(zeta - 1) <= 8 * Number.EPSILON
      ? 'Critical'
      : zeta < 1 ? 'Underdamped' : 'Overdamped';
    const final = 1 / stiffness;
    const root = Math.sqrt(Math.abs((zeta - 1) * (zeta + 1)));
    const dampedOmega = omega * root;
    // Compute the slow real pole without subtracting nearly equal numbers.
    const slowPole = -omega / (zeta + root);
    const fastPole = -omega * (zeta + root);
    let poles;
    let normalizedState;

    if (regime === 'Underdamped') {
      poles = [{ real: -decay, imag: dampedOmega }, { real: -decay, imag: -dampedOmega }];
      normalizedState = time => {
        const envelope = Math.exp(-decay * time);
        const sine = Math.sin(dampedOmega * time) / dampedOmega;
        return {
          position: 1 - envelope * (Math.cos(dampedOmega * time) + decay * sine),
          velocity: omega ** 2 * envelope * sine
        };
      };
    } else if (regime === 'Critical') {
      poles = [{ real: -omega, imag: 0 }, { real: -omega, imag: 0 }];
      normalizedState = time => {
        const envelope = Math.exp(-omega * time);
        return {
          position: -Math.expm1(-omega * time) - omega * time * envelope,
          velocity: omega ** 2 * time * envelope
        };
      };
    } else {
      poles = [{ real: slowPole, imag: 0 }, { real: fastPole, imag: 0 }];
      normalizedState = time => {
        const gap = slowPole - fastPole;
        const difference = -Math.exp(slowPole * time) * Math.expm1(-gap * time);
        return {
          position: -Math.expm1(slowPole * time) + slowPole * difference / gap,
          velocity: omega ** 2 * difference / gap
        };
      };
    }

    function state(time) {
      const { position, velocity } = normalizedState(time);
      return { position: final * position, velocity: final * velocity };
    }

    return {
      omega, zeta, decay, regime, final, poles, state,
      A: [[0, 1], [-stiffness / mass, -damping / mass]],
      B: [0, 1 / mass]
    };
  }

  function eigenvalues(A) {
    const halfTrace = (A[0][0] + A[1][1]) / 2;
    const determinant = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    const discriminant = halfTrace ** 2 - determinant;
    if (Math.abs(discriminant) <= 8 * Number.EPSILON * determinant) {
      return [{ real: halfTrace, imag: 0 }, { real: halfTrace, imag: 0 }];
    }
    if (discriminant < 0) {
      const imag = Math.sqrt(-discriminant);
      return [{ real: halfTrace, imag }, { real: halfTrace, imag: -imag }];
    }
    const fast = halfTrace - Math.sqrt(discriminant);
    return [{ real: determinant / fast, imag: 0 }, { real: fast, imag: 0 }];
  }

  function crossing(position, level, start, end) {
    const startsBelow = position(start) < level;
    for (let i = 0; i < 50; i += 1) {
      const middle = (start + end) / 2;
      if ((position(middle) < level) === startsBelow) start = middle;
      else end = middle;
    }
    return (start + end) / 2;
  }

  function measure(model) {
    const { poles, regime, final, decay } = model;
    const position = time => model.state(time).position / final;
    const peakTime = regime === 'Underdamped' ? Math.PI / poles[0].imag : null;
    const overshoot = peakTime === null ? 0 : 100 * Math.exp(-decay * peakTime);
    const firstRiseEnd = Math.min(peakTime ?? Infinity, -8 / poles[0].real);
    const t10 = crossing(position, 0.1, 0, firstRiseEnd);
    const t90 = crossing(position, 0.9, 0, firstRiseEnd);
    const band = 0.02;
    let settlingTime;
    if (peakTime === null) {
      settlingTime = crossing(position, 1 - band, 0, firstRiseEnd);
    } else {
      // Each half-period ends at an extremum. Find the last extremum outside
      // the band and bracket the final entry between it and the next extremum.
      const logBand = Math.log(band);
      let last = Math.floor(-logBand / (decay * peakTime));
      if (last > 0 && -decay * last * peakTime <= logBand) last -= 1;
      const level = last % 2 === 0 ? 1 - band : 1 + band;
      const nextExtremum = (last + 1) * peakTime;
      // By eight decay time constants the underdamped error is bounded
      // by 9 * exp(-8), even if the first peak is still far away.
      settlingTime = crossing(position, level, last * peakTime, Math.min(nextExtremum, 8 / decay));
    }

    return { t10, t90, riseTime: t90 - t10, peakTime, overshoot, settlingTime };
  }

  return Object.freeze({ create, eigenvalues, measure });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SecondOrderModel;
}
