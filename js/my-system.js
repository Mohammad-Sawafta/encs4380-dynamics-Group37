(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  let identification = null;
  let simulation = null;

  function number(id) {
    const field = byId(id);
    const value = Number(field.value);
    field.setAttribute('aria-invalid', String(!field.validity.valid || !Number.isFinite(value)));
    if (!field.validity.valid || !Number.isFinite(value)) throw new RangeError('Correct the highlighted numeric fields.');
    return value;
  }

  function format(value, digits = 4) {
    return Number(value.toPrecision(digits)).toString();
  }

  function showMetric(id, value, unit, fallback = 'Not reached') {
    byId(id).textContent = value === null || !Number.isFinite(value) ? fallback : `${format(value)} ${unit}`;
  }

  async function drawIdentification() {
    if (!identification) return;
    try {
      await Plotting.render('id-plot', [
        { x: identification.samples.map(s => s.time), y: identification.samples.map(s => s.speed),
          name: 'Entered samples', type: 'scatter', mode: 'markers', marker: { color: '#b25722', size: 7 } },
        { x: identification.samples.map(s => s.time), y: identification.fitted,
          name: 'First-order fit', type: 'scatter', mode: 'lines', line: { color: '#28634e', width: 3 } },
        { x: [identification.crossingTime], y: [identification.targetSpeed], name: '63.2% point',
          type: 'scatter', mode: 'markers', marker: { color: '#7445a8', size: 10, symbol: 'diamond' } }
      ], { showlegend: true, xaxis: { title: { text: 'Time (s)' } }, yaxis: { title: { text: 'Speed (RPM)' } },
        legend: { orientation: 'h', y: 1.12 } });
      byId('id-chart-error').hidden = true;
    } catch (error) {
      byId('id-chart-error').hidden = false;
    }
  }

  function identify(event) {
    event?.preventDefault();
    byId('id-error').textContent = '';
    try {
      identification = MicromouseSystemModel.identify({ samplesText: byId('id-samples').value,
        baselinePwm: number('id-baseline-pwm'), stepPwm: number('id-step-pwm'),
        baselineSpeed: number('id-baseline-speed'), stepTime: number('id-step-time') });
      byId('id-steady').textContent = `${format(identification.steadyStateSpeed)} RPM`;
      byId('id-gain').textContent = `${format(identification.gain)} RPM/% PWM`;
      byId('id-tau').textContent = `${format(identification.tau)} s`;
      byId('id-rmse').textContent = `${format(identification.rmse)} RPM`;
      byId('id-use-fit').disabled = false;
      if (!byId('id-data-label').dataset.kind) byId('id-data-label').dataset.kind = 'entered';
      byId('id-data-label').textContent = byId('id-data-label').dataset.kind === 'demo' ?
        'Synthetic demonstration data — not a hardware measurement.' : 'User-entered dataset — verify its hardware source before reporting it.';
      drawIdentification();
    } catch (error) {
      identification = null;
      byId('id-use-fit').disabled = true;
      byId('id-error').textContent = error.message;
    }
  }

  function loadDemo() {
    const gain = 3, tau = 0.35, pwm = 40;
    const lines = ['# SYNTHETIC DEMONSTRATION DATA — NOT HARDWARE MEASUREMENTS'];
    for (let index = 0; index <= 25; index++) {
      const time = index * 0.1;
      const ideal = gain * pwm * (1 - Math.exp(-time / tau));
      const deterministicNoise = index === 0 ? 0 : 0.7 * Math.sin(index * 1.7);
      lines.push(`${time.toFixed(2)}, ${(ideal + deterministicNoise).toFixed(2)}`);
    }
    byId('id-baseline-pwm').value = 0; byId('id-step-pwm').value = 40;
    byId('id-baseline-speed').value = 0; byId('id-step-time').value = 0;
    byId('id-samples').value = lines.join('\n');
    byId('id-data-label').dataset.kind = 'demo';
    identify();
  }

  function motorParameters() {
    return { gain: number('motor-gain'), tau: number('motor-tau'), setpoint: number('motor-target'),
      kp: number('motor-kp'), ki: number('motor-ki'), kd: number('motor-kd'),
      sampleTime: number('motor-sample-time'), duration: number('motor-duration') };
  }

  function specificationRows(result, specs, approximation) {
    const checks = MicromouseSystemModel.evaluate(result, specs, approximation);
    const rows = [
      ['Rise time', `≤ ${format(checks.rise.limit)} s`, checks.rise.measured === null ? 'Not reached' : `${format(checks.rise.measured)} s`, checks.rise.passed],
      ['Overshoot', `≤ ${format(checks.overshoot.limit)}%`, checks.overshoot.measured === null ? 'Undefined' : `${format(checks.overshoot.measured)}%`, checks.overshoot.passed],
      ['Settling time', `≤ ${format(checks.settling.limit)} s`, checks.settling.measured === null ? 'Not observed' : `${format(checks.settling.measured)} s`, checks.settling.passed],
      ['Steady-state error', `≤ ${format(checks.error.limit)} RPM`, `${format(checks.error.measured)} RPM`, checks.error.passed],
      ['Continuous-model damping ratio', `${specs.desiredDampingMin} to ${specs.desiredDampingMax}`, checks.damping.measured === null ? 'Requires Ki > 0' : format(checks.damping.measured), checks.damping.passed],
      ['PWM constraint', `${checks.pwm.minimum} to ${checks.pwm.maximum}%`, checks.pwm.passed ? 'Respected' : 'Violated', checks.pwm.passed]
    ];
    byId('motor-spec-results').replaceChildren(...rows.map(([name, limit, measured, passed]) => {
      const row = document.createElement('tr');
      [name, limit, measured, passed ? 'PASS' : 'FAIL'].forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = value;
        if (index > 0) cell.dataset.label = ['Requirement', 'Limit', 'Measured', 'Result'][index];
        if (index === 3) cell.className = passed ? 'pass' : 'fail'; row.appendChild(cell);
      });
      return row;
    }));
    return checks;
  }

  async function drawMotor() {
    if (!simulation) return;
    const p = simulation.parameters;
    const target = simulation.time.map(() => p.setpoint);
    try {
      await Promise.all([
        Plotting.render('motor-speed-plot', [
          { x: simulation.time, y: simulation.output, name: 'Motor speed', type: 'scatter', mode: 'lines+markers',
            line: { color: '#28634e', width: 2 }, marker: { color: '#28634e', size: 4 } },
          { x: simulation.time, y: target, name: 'Target', type: 'scatter', mode: 'lines', line: { color: '#7445a8', dash: 'dash', width: 2 } }
        ], { showlegend: true, xaxis: { title: { text: 'Time (s)' }, range: [0, p.duration] },
          yaxis: { title: { text: 'Speed (RPM)' } }, legend: { orientation: 'h', y: 1.12 } }),
        Plotting.render('motor-pwm-plot', [{ x: simulation.time, y: simulation.control, name: 'PWM', type: 'scatter',
          mode: 'lines', line: { color: '#b25722', width: 2, shape: 'hv' } }],
        { xaxis: { title: { text: 'Time (s)' }, range: [0, p.duration] }, yaxis: { title: { text: 'PWM (%)' }, range: [-2, 102] } })
      ]);
      byId('motor-chart-error').hidden = true;
    } catch (error) { byId('motor-chart-error').hidden = false; }
  }

  function runMotor(event) {
    event?.preventDefault();
    byId('motor-error').textContent = '';
    try {
      const p = motorParameters();
      simulation = MicromouseSystemModel.simulate(p);
      const m = simulation.metrics;
      showMetric('motor-rise', m.riseTime, 's'); showMetric('motor-overshoot', m.overshootPercent, '%', 'Undefined');
      showMetric('motor-settling', m.settlingTime, 's');
      showMetric('motor-sse', m.steadyStateError === null ? Math.abs(m.endError) : Math.abs(m.steadyStateError), 'RPM');
      const approximation = MicromouseSystemModel.continuousApproximation(p);
      const specs = MicromouseSystemModel.specifications({ tau: p.tau, targetSpeed: p.setpoint });
      const checks = specificationRows(simulation, specs, approximation);
      const passed = Object.values(checks).filter(check => check.passed).length;
      byId('motor-status').textContent = `${passed} of ${Object.keys(checks).length} checks pass. ${simulation.saturated ? 'PWM saturation occurred; anti-windup was active.' : 'PWM stayed below saturation.'}`;
      byId('motor-damping-note').textContent = approximation ?
        `Continuous linear approximation: ωn = ${format(approximation.naturalFrequency)} rad/s and ζ = ${format(approximation.dampingRatio)}. Use the sampled simulation metrics for the implemented controller.` :
        'No damping ratio is reported because Ki must be positive for the stated second-order characteristic comparison.';
      byId('motor-code').textContent = MicromouseSystemModel.arduinoCode(p);
      drawMotor();
    } catch (error) {
      byId('motor-error').textContent = error.message;
      byId('motor-status').textContent = 'Simulation not run.';
    }
  }

  async function copyCode() {
    const code = byId('motor-code').textContent;
    try { await navigator.clipboard.writeText(code); byId('motor-copy-status').textContent = 'Code copied. Configure all hardware-specific functions before use.'; }
    catch (error) {
      const range = document.createRange(); range.selectNodeContents(byId('motor-code'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      byId('motor-copy-status').textContent = 'Clipboard permission was unavailable; the code is selected for manual copying.';
    }
  }

  const prediction = {
    kp: ['faster', 'Increasing Kp usually makes the loop respond faster and more aggressively, but excessive Kp can increase overshoot or oscillation.'],
    ki: ['faster', 'Increasing Ki accumulates error more strongly, helping remove steady-state error, but too much integral action can add overshoot and saturation.'],
    kd: ['damped', 'Increasing Kd reacts to rapid error change and can add damping, although noise and coarse sampling can make derivative action troublesome.'],
    ts: ['limited', 'A larger Ts creates coarser updates and extra effective delay; the response can oscillate or become unstable.'],
    saturation: ['limited', 'At 100% PWM the actuator cannot provide more command. An unreachable speed keeps a residual error; anti-windup stops the integral from growing farther into saturation.']
  };

  function checkPrediction() {
    const answer = document.querySelector('[name="system-prediction"]:checked');
    const [expected, explanation] = prediction[byId('system-prediction-topic').value];
    byId('system-prediction-feedback').textContent = `${answer.value === expected ? 'Correct.' : 'Not quite.'} ${explanation}`;
    byId('system-prediction-feedback').className = `small ${answer.value === expected ? 'pass' : 'fail'}`;
  }

  function resetPrediction() {
    document.querySelectorAll('[name="system-prediction"]').forEach(input => { input.checked = false; });
    byId('system-check-prediction').disabled = true; byId('system-prediction-feedback').textContent = '';
  }

  byId('identification-form').addEventListener('submit', identify);
  byId('id-load-demo').addEventListener('click', loadDemo);
  byId('id-use-fit').addEventListener('click', () => {
    if (!identification) return;
    byId('motor-gain').value = format(identification.gain, 6);
    byId('motor-tau').value = format(identification.tau, 6);
    runMotor();
    byId('controller-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  byId('motor-form').addEventListener('submit', runMotor);
  byId('motor-copy-code').addEventListener('click', copyCode);
  document.querySelectorAll('[name="system-prediction"]').forEach(input => input.addEventListener('change', () => { byId('system-check-prediction').disabled = false; }));
  byId('system-prediction-topic').addEventListener('change', resetPrediction);
  byId('system-check-prediction').addEventListener('click', checkPrediction);
  byId('system-reset-prediction').addEventListener('click', resetPrediction);
  byId('id-reset-view').addEventListener('click', () => identification && Plotting.resetView('id-plot', { 'xaxis.autorange': true, 'yaxis.autorange': true }).catch(() => {}));
  byId('motor-reset-view').addEventListener('click', () => simulation && Promise.all([
    Plotting.resetView('motor-speed-plot', { 'xaxis.range': [0, simulation.parameters.duration], 'yaxis.autorange': true }),
    Plotting.resetView('motor-pwm-plot', { 'xaxis.range': [0, simulation.parameters.duration], 'yaxis.range': [-2, 102] })
  ]).catch(() => {}));
  runMotor();
})();
