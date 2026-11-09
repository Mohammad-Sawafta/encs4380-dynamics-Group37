// Pure first-order frequency-response mathematics. No DOM or Plotly dependency.
const FrequencyResponseModel = (() => {
  'use strict';

  function requirePositive(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(name + ' must be a positive finite number.');
    }
  }

  function requireNonNegative(value, name) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(name + ' must be a non-negative finite number.');
    }
  }

  function amplitudeRatio(tau, omega) {
    requirePositive(tau, 'The time constant');
    requireNonNegative(omega, 'Angular frequency');
    return 1 / Math.hypot(1, omega * tau);
  }

  function phaseRadians(tau, omega) {
    requirePositive(tau, 'The time constant');
    requireNonNegative(omega, 'Angular frequency');
    return -Math.atan(omega * tau);
  }

  function phaseDegrees(tau, omega) {
    return phaseRadians(tau, omega) * 180 / Math.PI;
  }

  function radiansPerSecondToHz(omega) {
    requireNonNegative(omega, 'Angular frequency');
    return omega / (2 * Math.PI);
  }

  function hzToRadiansPerSecond(frequencyHz) {
    requireNonNegative(frequencyHz, 'Frequency');
    return 2 * Math.PI * frequencyHz;
  }

  function bodeMagnitudeDb(tau, omega) {
    requirePositive(tau, 'The time constant');
    requireNonNegative(omega, 'Angular frequency');
    const product = omega * tau;
    // log1p remains accurate for very small products and avoids forming M first.
    return -10 * Math.log1p(product * product) / Math.LN10;
  }

  function cutoffFrequency(tau) {
    requirePositive(tau, 'The time constant');
    return 1 / tau;
  }

  // Signed normalized error: negative means the measured amplitude is attenuated.
  function dynamicError(tau, omega) {
    return amplitudeRatio(tau, omega) - 1;
  }

  function maximumPermissibleTau(maxFrequencyHz, allowedErrorFraction) {
    requirePositive(maxFrequencyHz, 'Maximum frequency');
    if (!Number.isFinite(allowedErrorFraction) || allowedErrorFraction <= 0 || allowedErrorFraction >= 1) {
      throw new RangeError('Allowed error fraction must be greater than 0 and less than 1.');
    }
    const omegaMax = hzToRadiansPerSecond(maxFrequencyHz);
    const minimumRatio = 1 - allowedErrorFraction;
    return Math.sqrt(1 / (minimumRatio * minimumRatio) - 1) / omegaMax;
  }

  function steadyStateOutput(time, tau, omega, gain = 1) {
    if (!Number.isFinite(time)) throw new RangeError('Time must be a finite number.');
    if (!Number.isFinite(gain)) throw new RangeError('Gain must be a finite number.');
    return gain * amplitudeRatio(tau, omega) * Math.sin(omega * time + phaseRadians(tau, omega));
  }

  return Object.freeze({
    amplitudeRatio,
    phaseRadians,
    phaseDegrees,
    radiansPerSecondToHz,
    hzToRadiansPerSecond,
    bodeMagnitudeDb,
    cutoffFrequency,
    dynamicError,
    maximumPermissibleTau,
    steadyStateOutput
  });
})();
