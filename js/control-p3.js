(() => {
  'use strict';
  const el = id => document.getElementById('digital-' + id);
  const form = el('form');
  const numericKeys = ['gain', 'tau', 'mass', 'damping', 'stiffness', 'sampleTime', 'setpoint', 'duration', 'uMin', 'uMax', 'kp', 'ki', 'kd'];
  let current = null;
  let updateTimer;
  let drawing = false;
  let drawAgain = false;
  let libraryLoading = null;
  const format = value => Number(value.toPrecision(5)).toString();
  const base = { plant: 'first', gain: 1, tau: 1, kp: 2, ki: 4, kd: 0,
    setpoint: 1, duration: 12, uMin: -100, uMax: 100, antiWindup: true };
  const presets = {
    fast: { ...base, sampleTime: 0.02 },
    coarse: { ...base, sampleTime: 0.4 },
    unstable: { ...base, sampleTime: 0.8 },
    windup: { ...base, kp: 4, ki: 8, sampleTime: 0.1, uMin: 0, uMax: 1.2, duration: 10, antiWindup: true }
  };
  const notes = {
    fast: 'Fast sampling closely follows the intended continuous-controller behavior.',
    coarse: 'Coarse sampling makes the command staircase visible and increases overshoot.',
    unstable: 'The gains did not change, but Ts is now large enough for the sampled loop to diverge.',
    windup: 'Toggle anti-windup off. The integral grows during saturation and produces extra overshoot.'
  };

  for (const [key, title, max] of [['kp', 'Proportional Kp', 20], ['ki', 'Integral Ki', 10], ['kd', 'Derivative Kd', 5]]) {
    const group = document.createElement('div');
    group.className = 'pid-gain-control';
    group.innerHTML = `<div class="control-heading"><label for="digital-${key}">${title}</label><input id="digital-${key}" type="number" min="0" max="${max}" step="0.1" value="${DigitalPIDModel.defaults[key]}" required></div><input id="digital-${key}-slider" type="range" min="0" max="${max}" step="0.1" value="${DigitalPIDModel.defaults[key]}" aria-label="${title} slider">`;
    el('gain-controls').append(group);
    el(key + '-slider').addEventListener('input', () => { el(key).value = el(key + '-slider').value; schedule(); });
    el(key).addEventListener('input', () => { el(key + '-slider').value = el(key).value; });
  }
  el('sampleTime-slider').addEventListener('input', () => { el('sampleTime').value = el('sampleTime-slider').value; schedule(); });
  el('sampleTime').addEventListener('input', () => { el('sampleTime-slider').value = el('sampleTime').value; });

  function parameters() {
    const p = { plant: el('plant').value, antiWindup: el('antiWindup').checked };
    const inactive = p.plant === 'first' ? ['mass', 'damping', 'stiffness'] : ['gain', 'tau'];
    let invalid = false;
    for (const key of numericKeys) {
      const field = el(key);
      const valid = inactive.includes(key) || field.validity.valid;
      field.setAttribute('aria-invalid', String(!valid));
      invalid ||= !valid;
      p[key] = inactive.includes(key) ? DigitalPIDModel.defaults[key] : field.valueAsNumber;
    }
    if (invalid) throw new RangeError('Complete each highlighted field with a value in its allowed range.');
    return p;
  }

  function schedule() { clearTimeout(updateTimer); updateTimer = setTimeout(update, 80); }

  function showMetrics(result) {
    const m = result.metrics;
    el('rise').textContent = m.riseTime === null ? 'Not reached' : format(m.riseTime) + ' s';
    el('overshoot').textContent = m.overshootPercent === null ? 'N/A' : format(m.overshootPercent) + '%';
    el('settling').textContent = m.settlingTime === null ? 'Not settled' : format(m.settlingTime) + ' s';
    el('error').textContent = m.steadyStateError === null ? 'Not steady yet' : format(m.steadyStateError);
    el('metric-note').textContent = `${result.time.length} controller updates over ${format(result.time.at(-1))} s. Final output: ${format(m.finalOutput)}. ` +
      (result.integralBlocked ? 'Anti-windup blocked at least one integral update.' : 'No integral update was blocked.');
    const late = result.output.slice(Math.floor(result.output.length * 0.7));
    const lateRange = Math.max(...late) - Math.min(...late);
    el('status').textContent = result.stopped ? 'Simulation stopped at the numerical safety bound.' :
      lateRange > 0.5 * Math.max(1, Math.abs(result.parameters.setpoint)) ? 'Large sampled oscillations remain: reduce Ts or retune the gains.' :
        result.saturated ? 'The actuator clipped. Compare anti-windup on and off.' : 'Simulation complete. The actuator did not clip.';
    el('status').classList.toggle('fail', result.stopped || lateRange > 0.5 * Math.max(1, Math.abs(result.parameters.setpoint)));
  }

  function update() {
    const first = el('plant').value === 'first';
    el('first-fields').hidden = !first; el('second-fields').hidden = first;
    el('equation').textContent = first ? "tau y' + y = K u[k]" : "m y'' + b y' + k y = u[k]";
    try {
      const p = parameters();
      current = DigitalPIDModel.simulate(p);
      el('code').textContent = DigitalPIDModel.arduinoCode(p);
      el('input-error').textContent = '';
      showMetrics(current); void draw();
    } catch (error) {
      el('input-error').textContent = error.message + ' Plots and code retain the last valid settings.';
      el('status').textContent = 'Invalid settings: showing the last valid experiment.';
    }
  }

  async function loadLibrary() {
    if (Plotting.isAvailable()) return;
    if (!libraryLoading) libraryLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://cdn.plot.ly/plotly-4.1.1.min.js';
      const timer = setTimeout(() => { script.remove(); reject(new Error('Graph loading timed out.')); }, 12000);
      script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); reject(new Error('Graph loading failed.')); };
      document.head.append(script);
    }).finally(() => { libraryLoading = null; });
    return libraryLoading;
  }

  async function draw() {
    if (!current) return;
    if (drawing) { drawAgain = true; return; }
    drawing = true;
    try {
      do {
        drawAgain = false;
        const r = current; const p = r.parameters; const constant = value => r.time.map(() => value);
        const layout = { xaxis: { title: { text: 'Time (s)' }, range: [0, p.duration] }, showlegend: true,
          legend: { orientation: 'h', y: 1.12 }, margin: { t: 54, b: 44 }, uirevision: null };
        await Promise.all([
          Plotting.render(el('output-plot'), [
            { x: r.time, y: r.output, name: 'Output y[k]', type: 'scatter', mode: 'lines+markers', line: { color: '#28634e', width: 2 }, marker: { size: 4 } },
            { x: r.time, y: constant(p.setpoint), name: 'Setpoint r', type: 'scatter', mode: 'lines', line: { color: '#7443a4', width: 2, dash: 'dash' } }
          ], { ...layout, yaxis: { title: { text: 'Output' }, autorange: true } }),
          Plotting.render(el('control-plot'), [
            { x: r.time, y: r.control, name: 'Held u[k]', type: 'scatter', mode: 'lines', line: { color: '#28634e', width: 2, shape: 'hv' } },
            { x: r.time, y: constant(p.uMin), name: 'Lower limit', type: 'scatter', mode: 'lines', line: { color: '#a43e3e', dash: 'dash' } },
            { x: r.time, y: constant(p.uMax), name: 'Upper limit', type: 'scatter', mode: 'lines', line: { color: '#a43e3e', dash: 'dash' } }
          ], { ...layout, yaxis: { title: { text: 'Control' }, autorange: true } })
        ]);
        el('chart-error').hidden = true;
      } while (drawAgain);
    } catch { el('chart-error').hidden = false; }
    finally { drawing = false; }
  }

  function applyPreset(name) {
    const p = { ...DigitalPIDModel.defaults, ...presets[name] };
    el('plant').value = p.plant; numericKeys.forEach(key => { el(key).value = p[key]; });
    ['kp', 'ki', 'kd'].forEach(key => { el(key + '-slider').value = p[key]; });
    el('sampleTime-slider').value = p.sampleTime; el('antiWindup').checked = p.antiWindup;
    el('example-note').textContent = notes[name];
    document.querySelectorAll('[data-digital-preset]').forEach(button => {
      const active = button.dataset.digitalPreset === name; button.classList.toggle('secondary', !active); button.setAttribute('aria-pressed', String(active));
    });
    clearTimeout(updateTimer); update();
  }

  async function copyCode() {
    const code = el('code').textContent;
    try {
      await navigator.clipboard.writeText(code);
      el('copy-status').textContent = 'Arduino code copied to the clipboard.';
    } catch {
      const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(el('code'));
      selection.removeAllRanges(); selection.addRange(range); el('copy-status').textContent = 'Clipboard access was unavailable. The code is selected for manual copying.';
    }
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => {
    el('example-note').textContent = 'Custom experiment. Hold the gains fixed while changing Ts, or compare anti-windup on and off.';
    document.querySelectorAll('[data-digital-preset]').forEach(button => { button.classList.add('secondary'); button.setAttribute('aria-pressed', 'false'); }); schedule();
  });
  document.querySelectorAll('[data-digital-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.digitalPreset)));
  document.querySelectorAll('[name="digital-prediction"]').forEach(input => input.addEventListener('change', () => { el('check').disabled = false; el('feedback').textContent = ''; }));
  el('check').addEventListener('click', () => {
    const answer = document.querySelector('[name="digital-prediction"]:checked'); if (!answer) return;
    el('feedback').textContent = (answer.value === 'worse' ? 'Correct. ' : 'A digital controller cannot react between samples. ') +
      'A large Ts adds delay and makes the held command coarse; this example becomes unstable without changing the gains.';
    applyPreset('unstable');
  });
  el('reset-prediction').addEventListener('click', () => { document.querySelectorAll('[name="digital-prediction"]').forEach(input => { input.checked = false; }); el('check').disabled = true; el('feedback').textContent = ''; });
  el('reset-view').addEventListener('click', () => { void draw(); });
  el('retry').addEventListener('click', async () => { try { await loadLibrary(); await draw(); } catch { el('chart-error').hidden = false; } });
  el('copy-code').addEventListener('click', copyCode);
  applyPreset('fast');
})();
