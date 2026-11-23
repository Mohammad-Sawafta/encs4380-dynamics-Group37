// Micromouse motor identification and controller helpers. No DOM dependency.
// Requires DigitalPIDModel (and therefore PIDControlModel) to be loaded first.
const MicromouseSystemModel = (() => {
  'use strict';

  function finite(value, name) {
    if (!Number.isFinite(value)) throw new RangeError(name + ' must be finite.');
    return value;
  }

  function parseSamples(text) {
    if (typeof text !== 'string') throw new TypeError('Samples must be entered as text.');
    const samples = [];
    text.split(/\r?\n/).forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const parts = line.split(/[\s,;]+/).filter(Boolean);
      if (parts.length !== 2) throw new RangeError(`Line ${index + 1} must contain time and speed.`);
      const time = Number(parts[0]);
      const speed = Number(parts[1]);
      if (!Number.isFinite(time) || !Number.isFinite(speed)) {
        throw new RangeError(`Line ${index + 1} contains a non-numeric value.`);
      }
      samples.push({ time, speed });
    });
    if (samples.length < 5) throw new RangeError('Enter at least five time-speed samples.');
    for (let index = 1; index < samples.length; index++) {
      if (samples[index].time <= samples[index - 1].time) {
        throw new RangeError('Sample times must be strictly increasing.');
      }
    }
    return samples;
  }

  function fittedResponse(samples, options) {
    const { baselineSpeed, stepTime, steadyStateSpeed, tau } = options;
    return samples.map(({ time }) => time <= stepTime ? baselineSpeed :
      baselineSpeed + (steadyStateSpeed - baselineSpeed) * (1 - Math.exp(-(time - stepTime) / tau)));
  }

  function identify(options) {
    const samples = Array.isArray(options.samples) ? options.samples.map(sample => ({
      time: finite(Number(sample.time), 'Sample time'), speed: finite(Number(sample.speed), 'Sample speed')
    })) : parseSamples(options.samplesText);
    if (samples.length < 5) throw new RangeError('Enter at least five time-speed samples.');
    for (let index = 1; index < samples.length; index++) {
      if (samples[index].time <= samples[index - 1].time) throw new RangeError('Sample times must be strictly increasing.');
    }
    const baselinePwm = finite(Number(options.baselinePwm), 'Baseline PWM');
    const stepPwm = finite(Number(options.stepPwm), 'Step PWM');
    const baselineSpeed = finite(Number(options.baselineSpeed), 'Baseline speed');
    const stepTime = finite(Number(options.stepTime), 'Step time');
    if (baselinePwm < 0 || baselinePwm > 100 || stepPwm < 0 || stepPwm > 100) {
      throw new RangeError('PWM values must be between 0% and 100%.');
    }
    const inputStep = stepPwm - baselinePwm;
    if (Math.abs(inputStep) < 1e-12) throw new RangeError('The applied PWM step must be nonzero.');
    const after = samples.filter(sample => sample.time >= stepTime);
    if (after.length < 4) throw new RangeError('Enter at least four samples at or after the PWM step.');
    if (after.at(-1).time <= stepTime) throw new RangeError('Post-step samples must extend beyond the step time.');
    const tailCount = Math.max(3, Math.ceil(after.length * 0.2));
    const tail = after.slice(-tailCount);
    const steadyStateSpeed = tail.reduce((sum, sample) => sum + sample.speed, 0) / tail.length;
    const outputStep = steadyStateSpeed - baselineSpeed;
    if (Math.abs(outputStep) < 1e-9) throw new RangeError('The speed data has no measurable steady-state change.');
    const gain = outputStep / inputStep;
    if (!(gain > 0)) throw new RangeError('Speed and PWM changes must have the same direction for this positive-gain model.');
    const targetSpeed = baselineSpeed + 0.6321205588 * outputStep;
    const rising = outputStep > 0;
    let crossingTime = null;
    for (let index = 1; index < after.length; index++) {
      const a = after[index - 1];
      const b = after[index];
      const crossed = rising ? a.speed <= targetSpeed && b.speed >= targetSpeed :
        a.speed >= targetSpeed && b.speed <= targetSpeed;
      if (crossed && b.speed !== a.speed) {
        crossingTime = a.time + (b.time - a.time) * (targetSpeed - a.speed) / (b.speed - a.speed);
        break;
      }
    }
    if (crossingTime === null || crossingTime <= stepTime) {
      throw new RangeError('The samples do not show a usable 63.2% response crossing after the step.');
    }
    const tau = crossingTime - stepTime;
    const fitted = fittedResponse(samples, { baselineSpeed, stepTime, steadyStateSpeed, tau });
    const rmse = Math.sqrt(samples.reduce((sum, sample, index) =>
      sum + (sample.speed - fitted[index]) ** 2, 0) / samples.length);
    return { samples, baselinePwm, stepPwm, inputStep, baselineSpeed, stepTime,
      steadyStateSpeed, outputStep, gain, targetSpeed, crossingTime, tau, fitted, rmse };
  }

  function simulate(options = {}) {
    return DigitalPIDModel.simulate({ ...options, plant: 'first', uMin: 0, uMax: 100, antiWindup: true });
  }

  // Ideal continuous PID approximation. Digital sampling, derivative implementation,
  // saturation and motor nonlinearities can make the measured response differ.
  function continuousApproximation(options) {
    const gain = finite(Number(options.gain), 'Motor gain');
    const tau = finite(Number(options.tau), 'Motor time constant');
    const kp = finite(Number(options.kp), 'Kp');
    const ki = finite(Number(options.ki), 'Ki');
    const kd = finite(Number(options.kd), 'Kd');
    if (gain <= 0 || tau <= 0 || kp < 0 || ki <= 0 || kd < 0) return null;
    const quadratic = tau + gain * kd;
    const naturalFrequency = Math.sqrt(gain * ki / quadratic);
    const dampingRatio = (1 + gain * kp) / (2 * Math.sqrt(quadratic * gain * ki));
    return { naturalFrequency, dampingRatio, quadratic };
  }

  function specifications(options) {
    const tau = finite(Number(options.tau), 'Motor time constant');
    const targetSpeed = finite(Number(options.targetSpeed), 'Target speed');
    if (tau <= 0 || targetSpeed <= 0) throw new RangeError('Tau and target speed must be positive.');
    return {
      desiredDampingMin: 0.6,
      desiredDampingMax: 0.8,
      maximumRiseTime: Math.max(0.15, 1.5 * tau),
      maximumOvershoot: 10,
      maximumSettlingTime: Math.max(0.5, 4 * tau),
      maximumSteadyStateError: Math.max(1, 0.02 * targetSpeed),
      pwmMin: 0,
      pwmMax: 100
    };
  }

  function evaluate(result, specs, approximation) {
    const metrics = result.metrics;
    const error = metrics.steadyStateError === null ? Math.abs(metrics.endError) : Math.abs(metrics.steadyStateError);
    return {
      rise: { measured: metrics.riseTime, limit: specs.maximumRiseTime,
        passed: metrics.riseTime !== null && metrics.riseTime <= specs.maximumRiseTime },
      overshoot: { measured: metrics.overshootPercent, limit: specs.maximumOvershoot,
        passed: metrics.overshootPercent !== null && metrics.overshootPercent <= specs.maximumOvershoot },
      settling: { measured: metrics.settlingTime, limit: specs.maximumSettlingTime,
        passed: metrics.settlingTime !== null && metrics.settlingTime <= specs.maximumSettlingTime },
      error: { measured: error, limit: specs.maximumSteadyStateError,
        passed: metrics.steadyStateError !== null && error <= specs.maximumSteadyStateError },
      damping: { measured: approximation ? approximation.dampingRatio : null,
        minimum: specs.desiredDampingMin, maximum: specs.desiredDampingMax,
        passed: approximation !== null && approximation.dampingRatio >= specs.desiredDampingMin &&
          approximation.dampingRatio <= specs.desiredDampingMax },
      pwm: { measured: result.control.length ? Math.max(...result.control) : null,
        minimum: specs.pwmMin, maximum: specs.pwmMax,
        passed: result.control.length > 0 && result.control.every(command =>
          command >= specs.pwmMin && command <= specs.pwmMax) }
    };
  }

  function arduinoCode(options = {}) {
    return DigitalPIDModel.arduinoCode({ ...options, plant: 'first', uMin: 0, uMax: 100, antiWindup: true })
      .replace('// Generated sampled PID: replace the two hardware functions below.',
        `// Micromouse motor-speed PID generated from the browser simulation.
// TODO: implement encoder conversion and motor-driver output for your hardware.
// Speed units here are RPM; PWM command units are percent (0 to 100).`)
      .replaceAll('readPlantOutput', 'readEncoderSpeedRPM')
      .replaceAll('writeActuator', 'writeMotorPWMPercent');
  }

  return Object.freeze({ parseSamples, fittedResponse, identify, simulate,
    continuousApproximation, specifications, evaluate, arduinoCode });
})();
