(() => {
  'use strict';
  const el = id => document.getElementById('sensor-' + id);
  const form = el('form');
  const numericKeys = ['gain', 'tau', 'mass', 'damping', 'stiffness', 'sensorTau', 'setpoint', 'duration', 'uMin', 'uMax', 'kp', 'ki', 'kd'];
  let current = null;
  let updateTimer;
  let drawing = false;
  let drawAgain = false;
  let libraryLoading = null;
  const format = value => Number(value.toPrecision(5)).toString();
  const baseExample = { plant: 'first', gain: 1, tau: 1, kp: 2, ki: 8, kd: 0,
    setpoint: 1, duration: 20, uMin: -100, uMax: 100 };
  const presets = {
    ideal: { ...baseExample, sensorTau: 0 },
    small: { ...baseExample, sensorTau: 0.1 },
    near: { ...baseExample, sensorTau: 0.55 },
    unstable: { ...baseExample, sensorTau: 0.7 }
  };
  const notes = {
    ideal: 'Ideal sensor: y_s equals y. This is exactly the P1 feedback loop.',
    small: 'Small lag: the sensor follows the plant, but late enough to increase overshoot.',
    near: 'Near oscillation: the delayed correction produces large, slowly decaying swings.',
    unstable: 'Growing oscillation: delay has removed the stability margin even though the PID gains did not change.'
  };

  for (const [key, title, max] of [['kp', 'Proportional Kp', 20], ['ki', 'Integral Ki', 10], ['kd', 'Derivative Kd', 5]]) {
    const group = document.createElement('div');
    group.className = 'pid-gain-control';
    group.innerHTML = `<div class="control-heading"><label for="sensor-${key}">${title}</label><input id="sensor-${key}" type="number" min="0" max="${max}" step="0.1" value="${PIDSensorModel.defaults[key]}" required></div><input id="sensor-${key}-slider" type="range" min="0" max="${max}" step="0.1" value="${PIDSensorModel.defaults[key]}" aria-label="${title} slider">`;
    el('gain-controls').append(group);
    el(key + '-slider').addEventListener('input', () => {
      el(key).value = el(key + '-slider').value;
      schedule();
    });
    el(key).addEventListener('input', () => { el(key + '-slider').value = el(key).value; });
  }

  el('sensorTau-slider').addEventListener('input', () => {
    el('sensorTau').value = el('sensorTau-slider').value;
    schedule();
  });
  el('sensorTau').addEventListener('input', () => {
    el('sensorTau-slider').value = Math.min(1, Math.max(0, el('sensorTau').valueAsNumber || 0));
  });

  function parameters() {
    const p = { plant: el('plant').value };
    const inactive = p.plant === 'first' ? ['mass', 'damping', 'stiffness'] : ['gain', 'tau'];
    let invalid = false;
    for (const key of numericKeys) {
      const field = el(key);
      const valid = inactive.includes(key) || field.validity.valid;
      field.setAttribute('aria-invalid', String(!valid));
      invalid ||= !valid;
      p[key] = inactive.includes(key) ? PIDSensorModel.defaults[key] : field.valueAsNumber;
    }
    if (invalid) throw new RangeError('Complete each highlighted field with a value in its allowed range.');
    return p;
  }

  function schedule() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 80);
  }

  function showMetrics(result) {
    const m = result.metrics;
    const maxGap = Math.max(...result.output.map((value, index) => Math.abs(value - result.measured[index])));
    el('rise').textContent = m.riseTime === null ? 'Not reached' : format(m.riseTime) + ' s';
    el('overshoot').textContent = m.overshootPercent === null ? 'N/A (zero step)' : format(m.overshootPercent) + '%';
    el('settling').textContent = m.settlingTime === null ? 'Not settled' : format(m.settlingTime) + ' s';
    el('gap').textContent = format(maxGap) + ' units';
    if (!result.parameters.setpoint) {
      el('rise').textContent = 'N/A (zero step)';
      el('settling').textContent = 'N/A (zero step)';
    }
    const finalMeasured = result.measured.at(-1);
    el('metric-note').textContent = `At ${format(result.time.at(-1))} s: true y = ${format(m.finalOutput)}, sensor y_s = ${format(finalMeasured)}, true error r - y = ${format(m.endError)}. Metrics describe the true output.`;
    const activity = result.output.slice(Math.floor(result.output.length * 0.75));
    const lateRange = Math.max(...activity) - Math.min(...activity);
    const scale = Math.max(1, Math.abs(result.parameters.setpoint));
    el('status').textContent = result.stopped ? 'Simulation stopped: states exceeded the numerical safety bound.' :
      lateRange > 0.2 * scale ? 'Large late oscillations remain: the delayed feedback is not settling in this window.' :
        result.saturated ? 'Actuator limit reached: clipping also affects this response.' :
          result.parameters.sensorTau === 0 ? 'Ideal sensor bypass: the result is identical to P1.' :
            'Simulation complete. Compare where the true and measured curves cross the target.';
    el('status').classList.toggle('fail', result.stopped || lateRange > 0.2 * scale);
  }

  function update() {
    const first = el('plant').value === 'first';
    el('first-fields').hidden = !first;
    el('second-fields').hidden = first;
    el('equation').textContent = first ? "tau y' + y = K u" : "m y'' + b y' + k y = u";
    try {
      const next = PIDSensorModel.simulate(parameters());
      current = next;
      el('input-error').textContent = '';
      showMetrics(next);
      void draw();
    } catch (error) {
      el('input-error').textContent = error.message + ' Plots retain the last valid experiment.';
      el('status').textContent = 'Invalid settings: displayed results are from the last valid experiment.';
    }
  }

  async function loadLibrary() {
    if (Plotting.isAvailable()) return;
    if (!libraryLoading) {
      libraryLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.plot.ly/plotly-4.1.1.min.js';
        const timer = setTimeout(() => { script.remove(); reject(new Error('Graph loading timed out.')); }, 12000);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Graph loading failed.')); };
        document.head.append(script);
      }).finally(() => { libraryLoading = null; });
    }
    return libraryLoading;
  }

  async function draw() {
    if (!current) return;
    if (drawing) { drawAgain = true; return; }
    drawing = true;
    try {
      do {
        drawAgain = false;
        const result = current;
        const p = result.parameters;
        const line = (y, name, color, dash = 'solid') => ({ x: result.time, y, name, type: 'scatter', mode: 'lines', line: { color, width: 2, dash } });
        const constant = value => result.time.map(() => value);
        const layout = { xaxis: { title: { text: 'Time (s)' }, range: [0, p.duration] },
          showlegend: true, legend: { orientation: 'h', y: 1.12 }, margin: { t: 54, b: 44 }, uirevision: null };
        const band = Math.abs(p.setpoint) * 0.02;
        await Promise.all([
          Plotting.render(el('output-plot'), [line(result.output, 'True output y', '#28634e'), line(result.measured, 'Sensor report y_s', '#d27b32'), line(constant(p.setpoint), 'Setpoint r', '#7443a4', 'dash')], {
            ...layout, yaxis: { title: { text: p.plant === 'first' ? 'Output (units)' : 'Position (m)' }, autorange: true },
            shapes: [{ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: p.setpoint - band, y1: p.setpoint + band, fillcolor: '#7443a4', opacity: 0.08, line: { width: 0 }, layer: 'below' }]
          }),
          Plotting.render(el('control-plot'), [line(result.control, 'Applied u from r - y_s', '#28634e'),
            line(constant(p.uMin), 'Lower limit', '#a43e3e', 'dash'), line(constant(p.uMax), 'Upper limit', '#a43e3e', 'dash')], {
            ...layout, yaxis: { title: { text: p.plant === 'first' ? 'Control (units)' : 'Force (N)' }, autorange: true }
          })
        ]);
        el('chart-error').hidden = true;
      } while (drawAgain);
    } catch {
      el('chart-error').hidden = false;
    } finally {
      drawing = false;
    }
  }

  function applyPreset(name) {
    const p = { ...PIDSensorModel.defaults, ...presets[name] };
    el('plant').value = p.plant;
    numericKeys.forEach(key => { el(key).value = p[key]; });
    ['kp', 'ki', 'kd'].forEach(key => { el(key + '-slider').value = p[key]; });
    el('sensorTau-slider').value = Math.min(1, p.sensorTau);
    el('example-note').textContent = notes[name];
    document.querySelectorAll('[data-sensor-preset]').forEach(button => {
      const active = button.dataset.sensorPreset === name;
      button.classList.toggle('secondary', !active);
      button.setAttribute('aria-pressed', String(active));
    });
    clearTimeout(updateTimer);
    update();
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => {
    el('example-note').textContent = 'Custom experiment. Change sensor tau_s while holding the gains fixed, then compare the two curves.';
    document.querySelectorAll('[data-sensor-preset]').forEach(button => { button.classList.add('secondary'); button.setAttribute('aria-pressed', 'false'); });
    schedule();
  });
  document.querySelectorAll('[data-sensor-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.sensorPreset)));
  document.querySelectorAll('[name="sensor-prediction"]').forEach(input => input.addEventListener('change', () => { el('check').disabled = false; el('feedback').textContent = ''; }));
  el('check').addEventListener('click', () => {
    const answer = document.querySelector('[name="sensor-prediction"]:checked');
    if (!answer) return;
    el('feedback').textContent = (answer.value === 'lag' ? 'Correct. ' : 'Watch the true output while the orange sensor curve is still below the target. ') +
      'The delayed measurement keeps the error positive too long, so overshoot grows. Enough lag turns the correction into a growing oscillation.';
    applyPreset('unstable');
  });
  el('reset-prediction').addEventListener('click', () => {
    document.querySelectorAll('[name="sensor-prediction"]').forEach(input => { input.checked = false; });
    el('check').disabled = true;
    el('feedback').textContent = '';
  });
  el('reset-view').addEventListener('click', () => { void draw(); });
  el('retry').addEventListener('click', async () => {
    el('retry').disabled = true;
    try { await loadLibrary(); await draw(); } catch { el('chart-error').hidden = false; }
    finally { el('retry').disabled = false; }
  });
  applyPreset('small');
})();
