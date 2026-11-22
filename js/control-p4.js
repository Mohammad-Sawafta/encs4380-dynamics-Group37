(() => {
  'use strict';
  const el = id => document.getElementById('tuning-' + id);
  let challenge = PIDTuningChallenge.createChallenge();
  let current = null;
  let attempts = 0;
  let best = 0;
  let drawing = false;
  let libraryLoading = null;
  const format = value => Number(value.toPrecision(5)).toString();

  for (const [key, title, max, value] of [['kp', 'Proportional Kp', 20, 2], ['ki', 'Integral Ki', 10, 1], ['kd', 'Derivative Kd', 5, 0]]) {
    const group = document.createElement('div'); group.className = 'pid-gain-control';
    group.innerHTML = `<div class="control-heading"><label for="tuning-${key}">${title}</label><input id="tuning-${key}" type="number" min="0" max="${max}" step="0.1" value="${value}" required></div><input id="tuning-${key}-slider" type="range" min="0" max="${max}" step="0.1" value="${value}" aria-label="${title} slider">`;
    el('gain-controls').append(group);
    el(key + '-slider').addEventListener('input', () => { el(key).value = el(key + '-slider').value; });
    el(key).addEventListener('input', () => { el(key + '-slider').value = el(key).value; });
  }

  function gains() { return { kp: el('kp').value, ki: el('ki').value, kd: el('kd').value }; }

  function measured(check) {
    if (check.value === null) return 'Not reached';
    if (check.key === 'overshoot') return format(check.value) + '%';
    if (check.key === 'settling') return format(check.value) + ' s';
    return format(check.value);
  }

  function showResult(result) {
    el('results').textContent = '';
    for (const check of result.checks) {
      const row = document.createElement('tr');
      [check.label, check.limit, measured(check), check.passed ? 'PASS' : 'FAIL'].forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td'); if (index === 0) cell.scope = 'row';
        if (index > 0) cell.dataset.label = ['Requirement', 'Limit', 'Measured', 'Result'][index];
        if (index === 3) cell.className = check.passed ? 'pass' : 'fail'; cell.textContent = value; row.append(cell);
      });
      el('results').append(row);
    }
    el('score').textContent = `${result.points} / ${result.possible}`; best = Math.max(best, result.points);
    el('best').textContent = `${best} / ${result.possible}`; el('attempts').textContent = String(attempts);
    el('status').textContent = result.passed ? 'All specifications pass. You tuned this hidden plant.' :
      `${result.points} of ${result.possible} specifications pass. Change one gain and try again.`;
    el('status').classList.toggle('pass', result.passed); el('status').classList.toggle('fail', !result.passed);
  }

  async function loadLibrary() {
    if (Plotting.isAvailable()) return;
    if (!libraryLoading) libraryLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://cdn.plot.ly/plotly-4.1.1.min.js';
      const timer = setTimeout(() => { script.remove(); reject(new Error('Graph loading timed out.')); }, 12000);
      script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = reject; document.head.append(script);
    }).finally(() => { libraryLoading = null; });
    return libraryLoading;
  }

  async function draw() {
    if (drawing) return; drawing = true;
    try {
      const time = current ? current.simulation.time : [0, challenge.duration];
      const traces = [{ x: time, y: time.map(() => challenge.setpoint), name: 'Setpoint r', type: 'scatter', mode: 'lines', line: { color: '#7443a4', width: 2, dash: 'dash' } }];
      if (current) traces.unshift({ x: current.simulation.time, y: current.simulation.output, name: 'Hidden plant output', type: 'scatter', mode: 'lines', line: { color: '#28634e', width: 2 } });
      await Plotting.render(el('output-plot'), traces, { xaxis: { title: { text: 'Time (s)' }, range: [0, challenge.duration] },
        yaxis: { title: { text: 'Output' }, autorange: true }, showlegend: true, legend: { orientation: 'h', y: 1.12 }, margin: { t: 54, b: 44 }, uirevision: null });
      el('chart-error').hidden = true;
    } catch { el('chart-error').hidden = false; }
    finally { drawing = false; }
  }

  function runAttempt(event) {
    event.preventDefault();
    try {
      const evaluation = PIDTuningChallenge.evaluate(challenge, gains());
      if (!evaluation.ok) throw new RangeError(Object.values(evaluation.errors)[0]);
      current = evaluation.result; attempts++;
      el('input-error').textContent = ''; el('reveal').disabled = false; showResult(current); void draw();
    } catch (error) { el('input-error').textContent = error.message; }
  }

  function newChallenge() {
    challenge = PIDTuningChallenge.createChallenge(); current = null; attempts = 0; best = 0;
    el('score').textContent = '0 / 3'; el('best').textContent = '0 / 3'; el('attempts').textContent = '0';
    el('results').innerHTML = '<tr><td colspan="4">No attempt yet.</td></tr>';
    el('plant').textContent = 'Plant parameters are hidden.'; el('plant').classList.remove('plant-visible'); el('reveal').disabled = true;
    el('status').textContent = 'New hidden plant loaded. Choose gains and test your first design.'; el('status').classList.remove('pass', 'fail');
    el('input-error').textContent = ''; void draw();
  }

  el('form').addEventListener('submit', runAttempt); el('new').addEventListener('click', newChallenge);
  el('reveal').addEventListener('click', () => { el('plant').textContent = `Revealed plant: K = ${format(challenge.gain)}, tau = ${format(challenge.tau)} s.`; el('plant').classList.add('plant-visible'); });
  document.querySelectorAll('[name="tuning-prediction"]').forEach(input => input.addEventListener('change', () => { el('check-prediction').disabled = false; el('prediction-feedback').textContent = ''; }));
  el('check-prediction').addEventListener('click', () => {
    const answer = document.querySelector('[name="tuning-prediction"]:checked'); if (!answer) return;
    el('prediction-feedback').textContent = (answer.value === 'i' ? 'Correct. ' : 'Proportional and derivative action do not accumulate a persistent error. ') + 'Integral action keeps changing the command while step error remains, driving the error toward zero in a stable, reachable loop.';
  });
  el('reset-prediction').addEventListener('click', () => { document.querySelectorAll('[name="tuning-prediction"]').forEach(input => { input.checked = false; }); el('check-prediction').disabled = true; el('prediction-feedback').textContent = ''; });
  el('reset-view').addEventListener('click', () => { void draw(); });
  el('retry').addEventListener('click', async () => { try { await loadLibrary(); await draw(); } catch { el('chart-error').hidden = false; } });
  void draw();
})();
