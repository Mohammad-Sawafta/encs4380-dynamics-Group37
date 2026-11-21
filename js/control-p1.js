(() => {
  'use strict';
  const el = id => document.getElementById('pid-' + id);
  const form = el('form');
  const numericKeys = ['gain', 'tau', 'mass', 'damping', 'stiffness', 'setpoint', 'duration', 'uMin', 'uMax', 'kp', 'ki', 'kd'];
  let current = null;
  let updateTimer;
  let drawing = false;
  let drawAgain = false;
  let libraryLoading = null;
  const format = value => Number(value.toPrecision(5)).toString();
  const presets = {
    p: { kp: 9, ki: 0, duration: 3 },
    pi: { kp: 1, ki: 1 },
    pid: { plant: 'second', damping: 0.5, kp: 8, ki: 4, kd: 2, duration: 20, uMin: -20, uMax: 20 },
    limit: { kp: 2, ki: 1, uMin: 0, uMax: 0.6, duration: 20 }
  };
  const notes = {
    p: 'P-only: the output approaches 0.9, leaving 10% error. It cannot settle inside the 2% target band.',
    pi: 'PI: integral action removes the error for this stable, reachable step. Try Ki = 0 to compare.',
    pid: 'Second-order PID: try Kd = 0, then restore Kd = 2. Compare overshoot and control effort.',
    limit: 'The target needs u = 1, but the actuator can supply only 0.6. Integral action cannot overcome this limit.'
  };

  for (const [key, title, max] of [['kp', 'Proportional Kp', 20], ['ki', 'Integral Ki', 10], ['kd', 'Derivative Kd', 5]]) {
    const group = document.createElement('div');
    group.className = 'pid-gain-control';
    group.innerHTML = `<div class="control-heading"><label for="pid-${key}">${title}</label><input id="pid-${key}" type="number" min="0" max="${max}" step="0.1" value="${PIDControlModel.defaults[key]}" required></div><input id="pid-${key}-slider" type="range" min="0" max="${max}" step="0.1" value="${PIDControlModel.defaults[key]}" aria-label="${title} slider">`;
    el('gain-controls').append(group);
    el(key + '-slider').addEventListener('input', () => {
      el(key).value = el(key + '-slider').value;
      schedule();
    });
    el(key).addEventListener('input', () => { el(key + '-slider').value = el(key).value; });
  }

  function parameters() {
    const p = { plant: el('plant').value };
    const inactive = p.plant === 'first' ? ['mass', 'damping', 'stiffness'] : ['gain', 'tau'];
    let invalid = false;
    for (const key of numericKeys) {
      const field = el(key);
      const valid = inactive.includes(key) || field.validity.valid;
      field.setAttribute('aria-invalid', String(!valid));
      invalid ||= !valid;
      p[key] = inactive.includes(key) ? PIDControlModel.defaults[key] : field.valueAsNumber;
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
    el('rise').textContent = m.riseTime === null ? 'Not reached' : format(m.riseTime) + ' s';
    el('overshoot').textContent = m.overshootPercent === null ? 'N/A (zero step)' : format(m.overshootPercent) + '%';
    el('settling').textContent = m.settlingTime === null ? 'Not settled' : format(m.settlingTime) + ' s';
    el('error').textContent = m.steadyStateError === null ? 'Not steady yet' : format(m.steadyStateError) + ' units';
    if (!result.parameters.setpoint) {
      el('rise').textContent = 'N/A (zero step)';
      el('settling').textContent = 'N/A (zero step)';
    }
    el('metric-note').textContent = `Output at ${format(result.time.at(-1))} s: ${format(m.finalOutput)}. End error r - y: ${format(m.endError)}. ` +
      'Timing is relative to the target, not to a biased final output. Settling is observed only over this simulation window.';
    el('status').textContent = result.stopped ? 'Simulation stopped: states exceeded the numerical safety bound.' :
      result.saturated ? 'Actuator limit reached. Requested effort is clipped before it enters the plant.' : 'Simulation complete. The actuator did not clip the requested command.';
    el('status').classList.toggle('fail', result.stopped);
  }

  function update() {
    const first = el('plant').value === 'first';
    el('first-fields').hidden = !first;
    el('second-fields').hidden = first;
    el('equation').textContent = first ? "tau y' + y = K u" : "m y'' + b y' + k y = u";
    try {
      const next = PIDControlModel.simulate(parameters());
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
          showlegend: false, margin: { t: 12, b: 44 }, uirevision: null };
        const band = Math.abs(p.setpoint) * 0.02;
        await Promise.all([
          Plotting.render(el('output-plot'), [line(result.output, 'Output y', '#28634e'), line(constant(p.setpoint), 'Setpoint r', '#7443a4', 'dash')], {
            ...layout, yaxis: { title: { text: p.plant === 'first' ? 'Output (units)' : 'Position (m)' }, autorange: true },
            shapes: [{ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: p.setpoint - band, y1: p.setpoint + band, fillcolor: '#7443a4', opacity: 0.1, line: { width: 0 }, layer: 'below' }]
          }),
          Plotting.render(el('control-plot'), [line(result.requested, 'Requested command', '#a86427', 'dot'), line(result.control, 'Applied u', '#28634e'),
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
    const p = { ...PIDControlModel.defaults, ...presets[name] };
    el('plant').value = p.plant;
    numericKeys.forEach(key => { el(key).value = p[key]; });
    ['kp', 'ki', 'kd'].forEach(key => { el(key + '-slider').value = p[key]; });
    el('example-note').textContent = notes[name];
    document.querySelectorAll('[data-preset]').forEach(button => {
      const active = button.dataset.preset === name;
      button.classList.toggle('secondary', !active);
      button.setAttribute('aria-pressed', String(active));
    });
    clearTimeout(updateTimer);
    update();
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => {
    el('example-note').textContent = 'Custom experiment. Compare the response, tracking error, and control effort as you change the settings.';
    document.querySelectorAll('[data-preset]').forEach(button => { button.classList.add('secondary'); button.setAttribute('aria-pressed', 'false'); });
    schedule();
  });
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  document.querySelectorAll('[name="pid-prediction"]').forEach(input => input.addEventListener('change', () => { el('check').disabled = false; el('feedback').textContent = ''; }));
  el('check').addEventListener('click', () => {
    const answer = document.querySelector('[name="pid-prediction"]:checked');
    if (!answer) return;
    el('feedback').textContent = (answer.value === 'faster' ? 'Correct. ' : 'Compare the P example. ') +
      'With Kp = 1, tau_cl = 0.5 s and error = 50%. With Kp = 9, tau_cl = 0.1 s and error = 10%. Proportional control reduces the error but does not eliminate it.';
    applyPreset('p');
  });
  el('reset-prediction').addEventListener('click', () => {
    document.querySelectorAll('[name="pid-prediction"]').forEach(input => { input.checked = false; });
    el('check').disabled = true;
    el('feedback').textContent = '';
  });
  el('reset-view').addEventListener('click', () => { void draw(); });
  el('retry').addEventListener('click', async () => {
    el('retry').disabled = true;
    try { await loadLibrary(); await draw(); } catch { el('chart-error').hidden = false; }
    finally { el('retry').disabled = false; }
  });

  for (const check of PIDControlModel.validationChecks()) {
    const row = document.createElement('tr');
    [check.name, check.expected, check.actual, check.passed ? 'PASS' : 'FAIL'].forEach((value, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) cell.scope = 'row';
      if (index === 3) cell.className = check.passed ? 'pass' : 'fail';
      cell.textContent = value;
      row.append(cell);
    });
    el('validation-rows').append(row);
  }
  applyPreset('pi');
})();
