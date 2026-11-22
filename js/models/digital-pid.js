// Sampled PID with zero-order hold and optional conditional anti-windup.
// Requires PIDControlModel to be loaded first. No DOM or plotting dependency.
const DigitalPIDModel = (() => {
  'use strict';

  const defaults = Object.freeze({ ...PIDControlModel.defaults, sampleTime: 0.05,
    antiWindup: true, duration: 12 });

  function configure(options = {}) {
    const raw = { ...defaults, ...options };
    if (!Number.isFinite(raw.sampleTime) || raw.sampleTime <= 0 || raw.sampleTime > raw.duration) {
      throw new RangeError('sampleTime must be positive, finite, and no longer than the experiment.');
    }
    if (typeof raw.antiWindup !== 'boolean') throw new RangeError('antiWindup must be on or off.');
    return { ...PIDControlModel.configure(raw), sampleTime: raw.sampleTime, antiWindup: raw.antiWindup };
  }

  function clamp(value, lower, upper) {
    return Math.max(lower, Math.min(upper, value));
  }

  function controllerUpdate(p, measured, integral, previousError) {
    const error = p.setpoint - measured;
    const derivative = p.kd * (error - previousError) / p.sampleTime;
    const candidateIntegral = integral + error * p.sampleTime;
    const candidateRequested = p.kp * error + p.ki * candidateIntegral + derivative;
    const candidateApplied = clamp(candidateRequested, p.uMin, p.uMax);
    const pushesFurther = (candidateRequested > p.uMax && error > 0) ||
      (candidateRequested < p.uMin && error < 0);
    const blocked = p.antiWindup && candidateApplied !== candidateRequested && pushesFurther;
    const acceptedIntegral = blocked ? integral : candidateIntegral;
    const requested = p.kp * error + p.ki * acceptedIntegral + derivative;
    return { error, integral: acceptedIntegral, derivative, requested,
      applied: clamp(requested, p.uMin, p.uMax), integralBlocked: blocked };
  }

  function simulate(options = {}) {
    const p = configure(options);
    const plant = PIDControlModel.createPlant(p);
    let state = [...plant.initial];
    let integral = 0;
    let previousError = 0;
    let time = 0;
    const plantRate = p.plant === 'first' ? 1 / p.tau :
      (1 + p.damping + p.stiffness) / p.mass;
    const maxStep = Math.min(p.maxStep, 0.2 / Math.max(1, plantRate));
    const estimatedSteps = Math.ceil(p.duration / maxStep);
    if (!Number.isFinite(estimatedSteps) || estimatedSteps > 600000) {
      throw new RangeError('These settings need too many integration steps. Increase a plant time constant or sampling time.');
    }
    const tracker = PIDControlModel.createMetricTracker(p.setpoint, p.duration);
    tracker.add(0, plant.output(state));
    const result = { parameters: p, time: [], output: [], control: [], requested: [],
      integral: [], error: [], step: maxStep, integrationSteps: 0, saturated: false,
      integralBlocked: false, stopped: false };

    while (time <= p.duration + 1e-12) {
      const measured = plant.output(state);
      const terms = controllerUpdate(p, measured, integral, previousError);
      integral = terms.integral;
      previousError = terms.error;
      result.saturated ||= terms.applied !== terms.requested;
      result.integralBlocked ||= terms.integralBlocked;
      result.time.push(Math.min(time, p.duration));
      result.output.push(measured);
      result.control.push(terms.applied);
      result.requested.push(terms.requested);
      result.integral.push(integral);
      result.error.push(terms.error);
      if (time >= p.duration - 1e-12) break;

      const interval = Math.min(p.sampleTime, p.duration - time);
      const substeps = Math.max(1, Math.ceil(interval / maxStep));
      const dt = interval / substeps;
      for (let index = 0; index < substeps; index++) {
        const next = PIDControlModel.rk4(state, dt, current => plant.derivative(current, terms.applied));
        result.integrationSteps++;
        if (next.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
          result.stopped = true;
          break;
        }
        state = next;
        tracker.add(time + (index + 1) * dt, plant.output(state));
      }
      time += interval;
      if (result.stopped) break;
    }

    result.metrics = tracker.finish();
    if (result.stopped) {
      result.metrics.finalOutput = result.output.at(-1);
      result.metrics.endError = p.setpoint - result.metrics.finalOutput;
      result.metrics.steady = false;
      result.metrics.steadyStateError = null;
      result.metrics.settlingTime = null;
    }
    return result;
  }

  function arduinoCode(options = {}) {
    const p = configure(options);
    const number = value => Number(value.toPrecision(8)).toString();
    const sampleMs = Math.round(p.sampleTime * 1000);
    const antiWindup = p.antiWindup ? `
  bool pushesFurther = (candidate > U_MAX && error > 0.0f) ||
                       (candidate < U_MIN && error < 0.0f);
  if (!pushesFurther) integral = nextIntegral;` : `
  integral = nextIntegral;`;
    return `// Generated sampled PID: replace the two hardware functions below.
const float KP = ${number(p.kp)}f;
const float KI = ${number(p.ki)}f;
const float KD = ${number(p.kd)}f;
const float SETPOINT = ${number(p.setpoint)}f;
const float TS = ${number(p.sampleTime)}f;
const float U_MIN = ${number(p.uMin)}f;
const float U_MAX = ${number(p.uMax)}f;
const unsigned long SAMPLE_MS = ${sampleMs}UL;

float integral = 0.0f;
float previousError = 0.0f;
unsigned long previousSample = 0;

float readPlantOutput();
void writeActuator(float command);

void setup() {
  previousSample = millis();
}

void loop() {
  unsigned long now = millis();
  if (now - previousSample < SAMPLE_MS) return;
  previousSample += SAMPLE_MS;

  float measured = readPlantOutput();
  float error = SETPOINT - measured;
  float nextIntegral = integral + error * TS;
  float derivative = (error - previousError) / TS;
  float candidate = KP * error + KI * nextIntegral + KD * derivative;${antiWindup}

  float command = KP * error + KI * integral + KD * derivative;
  command = constrain(command, U_MIN, U_MAX);
  writeActuator(command);
  previousError = error;
}`;
  }

  return Object.freeze({ defaults, configure, controllerUpdate, simulate, arduinoCode });
})();
