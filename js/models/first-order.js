// Pure first-order model: no page elements or plotting library are needed.
const FirstOrderModel = (() => {
  'use strict';

  function requirePositiveTau(tau) {
    if (!Number.isFinite(tau) || tau <= 0) {
      throw new RangeError('The time constant must be a positive finite number.');
    }
  }

  function elapsedTime(time) {
    if (!Number.isFinite(time)) {
      throw new RangeError('Time must be a finite number.');
    }
    return Math.max(0, time);
  }

  // x(t) = A for t >= 0; y(0) = 0. expm1(z) computes exp(z) - 1 accurately.
  function stepResponse(time, tau, gain = 1, stepAmplitude = 1) {
    requirePositiveTau(tau);
    return gain * stepAmplitude * -Math.expm1(-elapsedTime(time) / tau);
  }

  // x(t) = r*t; solving tau*y' + y = K*r*t gives K*r*[t - tau*(1-exp(-t/tau))].
  function rampResponse(time, tau, gain = 1, rampSlope = 1) {
    requirePositiveTau(tau);
    const t = elapsedTime(time);
    return gain * rampSlope * (t + tau * Math.expm1(-t / tau));
  }

  // Compare output to K*x(t), so gain is included on both sides of the error.
  function idealRamp(time, gain = 1, rampSlope = 1) {
    return gain * rampSlope * elapsedTime(time);
  }

  // The late-time straight-line approximation. It is not the exact transient.
  function rampAsymptote(time, tau, gain = 1, rampSlope = 1) {
    requirePositiveTau(tau);
    return gain * rampSlope * (elapsedTime(time) - tau);
  }

  function rampError(time, tau, gain = 1, rampSlope = 1) {
    return tau * stepResponse(time, tau, gain, rampSlope);
  }

  function rampSteadyStateError(tau, gain = 1, rampSlope = 1) {
    requirePositiveTau(tau);
    return gain * rampSlope * tau;
  }

  // Unit-step diagnostic: epsilon = (K*A - y)/(K*A), for nonzero K*A.
  // Compute directly to avoid cancellation when the output is close to K*A.
  function stepErrorFraction(time, tau) {
    requirePositiveTau(tau);
    return Math.exp(-elapsedTime(time) / tau);
  }

  // Natural logarithm, not log10: its slope against physical time is -1/tau.
  function logStepError(time, tau) {
    requirePositiveTau(tau);
    return -elapsedTime(time) / tau;
  }

  return Object.freeze({
    stepResponse,
    rampResponse,
    idealRamp,
    rampAsymptote,
    rampError,
    rampSteadyStateError,
    stepErrorFraction,
    logStepError
  });
})();
