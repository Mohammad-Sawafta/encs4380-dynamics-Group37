// Guess the Sensor: one immutable observation set and one scored guess per round.
(() => {
  'use strict';

  const element = name => document.getElementById('challenge-' + name);
  const fields = [element('estimate-1'), element('estimate-2')];
  const plot = element('plot');
  const session = SensorChallenge.createSession();
  const names = {
    gain: { label: 'Gain K', unit: 'output/input', help: 'Final step level, or gain before sinusoidal attenuation.' },
    tau: { label: 'Time constant τ', unit: 's', help: 'A positive time in seconds.' },
    zeta: { label: 'Damping ratio ζ', unit: '', help: 'A dimensionless value greater than 0 and less than 1.' },
    omegaN: { label: 'Natural frequency ωₙ', unit: 'rad/s', help: 'A positive angular frequency in radians per second.' }
  };
  const titles = {
    'first-step': 'First-order sensor · Step response',
    'first-sine': 'First-order sensor · Sine response',
    'second-step': 'Second-order sensor · Step response'
  };
  let graphReady = false;
  let drawing = false;
  let renderVersion = 0;
  let loadingLibrary = null;

  function keys() {
    return session.round.kind === 'second-step' ? ['zeta', 'omegaN'] : ['gain', 'tau'];
  }

  function number(value) {
    return Number(value.toPrecision(6)).toString();
  }

  function errorText(parameter) {
    const error = parameter.errorPercent;
    // A failing value just outside the boundary must not display as a passing 10%.
    if (!parameter.passed && error > 10 && error < 10.001) return '>10%';
    return number(error) + '%';
  }

  function updateControls() {
    const revealed = session.result !== null;
    fields.forEach(field => { field.readOnly = revealed; });
    element('check').disabled = revealed || !graphReady || drawing;
    element('next').disabled = !revealed || drawing;
    element('reset-view').disabled = !graphReady || drawing;
    element('retry').disabled = drawing;
  }

  function updateScore() {
    const { points, possible, rounds } = session.totals;
    element('score').textContent = possible ? `${points} / ${possible}` : '0 points';
    element('completed').textContent = String(rounds);
  }

  function clearErrors() {
    fields.forEach((field, index) => {
      field.setAttribute('aria-invalid', 'false');
      element('error-' + (index + 1)).textContent = '';
    });
    element('form-status').textContent = '';
  }

  function hint(round) {
    if (round.kind === 'first-step') {
      return 'For a unit step, K is the final level. Read the time to reach 63.2% of that level to estimate τ. Another method: plot ln(1 − y/K) against time; its slope is −1/τ. Use the smooth trend because the measurements contain noise.';
    }
    if (round.kind === 'first-sine') {
      return 'Read the output amplitude B and the delay Δt between matching input and output peaks or rising zero crossings. The lag φ = ωΔt is in radians. Then τ = tan(φ)/ω and K = B√(1 + (ωτ)²). Average across the four periods to reduce noise.';
    }
    return 'Overshoot depends only on ζ. With final level 1, estimate the first peak and set P = peak − 1 (a fraction, not a percentage). Then ζ = −ln(P)/√(π² + ln(P)²). Read its time tₚ and use ωₙ = π/[tₚ√(1 − ζ²)]. Follow the smooth trend through the noise.';
  }

  function showRound(focus = false) {
    const round = session.round;
    graphReady = false;
    element('round-number').textContent = 'Round ' + (session.totals.rounds + 1);
    element('round-label').textContent = titles[round.kind];
    element('round-label').tabIndex = -1;
    element('conditions').textContent = round.kind === 'first-sine'
      ? `Unit-amplitude input x(t) = sin(ωt). ω = ${number(round.omega)} rad/s (${number(round.omega / (2 * Math.PI))} Hz). Four steady-state periods; no startup transient.`
      : round.kind === 'second-step'
        ? 'Unit step, known DC gain K = 1. Underdamped sensor, initially at rest. Estimate ζ and ωₙ from the overshoot and first peak time.'
        : 'Unit step A = 1, zero initial output. Estimate the final level and response speed.';
    keys().forEach((key, index) => {
      const descriptor = names[key];
      element('label-' + (index + 1)).textContent = descriptor.label + (descriptor.unit ? ` (${descriptor.unit})` : '');
      element('help-' + (index + 1)).textContent = descriptor.help;
      fields[index].value = '';
    });
    clearErrors();
    element('results').hidden = true;
    element('result-rows').replaceChildren();
    element('round-score').textContent = '';
    element('explanation').textContent = '';
    element('hint').hidden = true;
    element('hint').textContent = hint(round);
    element('hint-button').setAttribute('aria-expanded', 'false');
    element('hint-button').textContent = 'Show hint';
    element('caption').textContent = 'Hover to read time and output, drag to zoom, then use Reset view. Follow the trend through the noise; the true curve appears after submission.';
    plot.setAttribute('aria-label', titles[round.kind] + '. Noisy observations with time in seconds and output in output units.');
    updateScore();
    updateControls();
    void draw();
    if (focus) element('round-label').focus();
  }

  function trace(round, values, name, color, dash, width) {
    // Plotly may mutate arrays, so never pass the model's frozen arrays directly.
    return {
      x: round.times.slice(), y: values.slice(), type: 'scatter', mode: 'lines', name,
      line: { color, dash, width },
      hovertemplate: 'Time: %{x:.6g} s<br>Output: %{y:.6g}<extra>%{fullData.name}</extra>'
    };
  }

  function graphData() {
    const round = session.round;
    const traces = [trace(round, round.observed, 'Noisy observations', '#657970', 'solid', 1.2)];
    if (round.input) traces.push(trace(round, round.input, 'Known input', '#8a7460', 'dashdot', 1.7));
    if (session.result) {
      traces.push(trace(round, round.clean, 'True sensor', '#146248', 'solid', 3));
      traces.push(trace(round, session.result.curve, 'Your estimate', '#7952a5', 'dash', 2.4));
    }
    element('legend').replaceChildren(...traces.map(series => {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.className = 'swatch';
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.background = 'none';
      swatch.style.height = '0';
      swatch.style.borderTop = `3px ${series.line.dash === 'solid' ? 'solid' : series.line.dash === 'dash' ? 'dashed' : 'dotted'} ${series.line.color}`;
      item.append(swatch, document.createTextNode(series.name));
      return item;
    }));
    return traces;
  }

  function ensurePlotly() {
    if (Plotting.isAvailable()) return Promise.resolve();
    if (loadingLibrary) return loadingLibrary;
    loadingLibrary = new Promise((resolve, reject) => {
      const source = document.querySelector('script[src*="cdn.plot.ly/"]');
      if (!source) { reject(new Error('Plotly source is missing.')); return; }
      const script = document.createElement('script');
      let timer;
      const finish = error => {
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        script.remove();
        error ? reject(error) : resolve();
      };
      script.src = source.src;
      script.async = true;
      script.onload = () => finish(Plotting.isAvailable() ? null : new Error('Plotly is unavailable.'));
      script.onerror = () => finish(new Error('Plotly could not load.'));
      timer = setTimeout(() => finish(new Error('Plotly loading timed out.')), 15000);
      document.head.append(script);
    }).finally(() => { loadingLibrary = null; });
    return loadingLibrary;
  }

  async function draw(retry = false) {
    const version = ++renderVersion;
    drawing = true;
    graphReady = false;
    element('graph-status').hidden = false;
    element('graph-status').classList.remove('error');
    element('graph-message').textContent = 'Drawing your response graph…';
    element('retry').hidden = true;
    updateControls();
    try {
      if (retry) await ensurePlotly();
      await Plotting.render(plot, graphData(), {
        uirevision: version,
        margin: { l: 55, r: 12, t: 16, b: 54 },
        xaxis: { title: { text: 'Time (s)', standoff: 10 }, range: [0, session.round.end], automargin: true },
        yaxis: { title: { text: 'Output (units)', standoff: 8 }, autorange: true, rangemode: 'tozero', automargin: true }
      });
      if (version !== renderVersion) return;
      graphReady = true;
      element('graph-status').hidden = true;
      element('form-status').textContent = session.result
        ? 'Round completed. Compare the curves, then choose New sensor.'
        : 'Read the curve and enter both estimates when you are ready.';
    } catch (error) {
      if (version !== renderVersion) return;
      element('graph-status').classList.add('error');
      element('graph-message').textContent = 'The graph could not load. Check your connection, then retry. Your sensor and session score are saved on this page.';
      element('retry').hidden = false;
      element('form-status').textContent = session.result
        ? 'Your score is saved. Retry the graph to view the comparison.'
        : 'Load the graph before checking a guess.';
    } finally {
      if (version === renderVersion) {
        drawing = false;
        updateControls();
      }
    }
  }

  function explanation() {
    const round = session.round;
    const p = round.parameters;
    if (round.kind === 'first-step') {
      return `The true final level is K = ${number(p.gain)}. At t = τ = ${number(p.tau)} s the clean output reaches 63.2% of that level. A larger τ makes the response slower; K changes its final level.`;
    }
    if (round.kind === 'first-sine') {
      const amplitude = p.gain * FrequencyResponseModel.amplitudeRatio(p.tau, round.omega);
      const lag = -FrequencyResponseModel.phaseRadians(p.tau, round.omega);
      return `The true output amplitude is ${number(amplitude)} and its lag is ${number(lag * 180 / Math.PI)}° (${number(lag / round.omega)} s). Phase identifies τ; combining that attenuation with output amplitude identifies K.`;
    }
    const root = Math.sqrt(1 - p.zeta * p.zeta);
    const overshoot = 100 * Math.exp(-Math.PI * p.zeta / root);
    const peak = Math.PI / (p.omegaN * root);
    return `The true overshoot is ${number(overshoot)}% and the first peak occurs at ${number(peak)} s. Overshoot identifies ζ; peak time then identifies ωₙ. Both true and guessed curves approach the known final level of 1.`;
  }

  function reveal() {
    const result = session.result;
    element('results').hidden = false;
    element('round-score').textContent = `${result.points} / ${result.maxPoints} points this round`;
    element('result-rows').replaceChildren(...result.parameters.map(parameter => {
      const row = document.createElement('tr');
      const descriptor = names[parameter.key];
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = descriptor.label + (descriptor.unit ? ` (${descriptor.unit})` : '');
      row.append(heading);
      [number(parameter.estimate), number(parameter.trueValue), errorText(parameter),
        parameter.passed ? 'Within 10% · 50 points' : 'Outside 10% · 0 points'].forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (index === 3) cell.className = parameter.passed ? 'pass' : 'fail';
        row.append(cell);
      });
      return row;
    }));
    element('explanation').textContent = explanation();
    element('caption').textContent = 'Compare your dashed estimate with the solid true response and the noisy observations. Values are rounded for display; scoring uses the full-precision hidden parameters.';
    plot.setAttribute('aria-label', titles[session.round.kind] + '. Noisy observations, the true response, and your estimated response. Parameter comparison follows the graph.');
    updateScore();
    updateControls();
    void draw();
    element('results-heading').focus();
  }

  element('form').addEventListener('submit', event => {
    event.preventDefault();
    if (session.result || !graphReady || drawing) return;
    clearErrors();
    const raw = Object.fromEntries(keys().map((key, index) => [key, fields[index].value]));
    const outcome = session.submit(raw);
    if (!outcome.ok) {
      keys().forEach((key, index) => {
        const message = outcome.errors[key] || '';
        element('error-' + (index + 1)).textContent = message;
        fields[index].setAttribute('aria-invalid', String(Boolean(message)));
      });
      element('form-status').textContent = outcome.errors.round || 'Please correct the highlighted estimates. This round has not been scored.';
      const firstInvalid = fields.find(field => field.getAttribute('aria-invalid') === 'true');
      if (firstInvalid) firstInvalid.focus();
      return;
    }
    reveal();
  });
  fields.forEach((field, index) => field.addEventListener('input', () => {
    if (session.result) return;
    field.setAttribute('aria-invalid', 'false');
    element('error-' + (index + 1)).textContent = '';
  }));
  element('next').addEventListener('click', () => {
    if (!session.result || drawing) return;
    session.next();
    showRound(true);
  });
  element('hint-button').addEventListener('click', () => {
    const show = element('hint').hidden;
    element('hint').hidden = !show;
    element('hint-button').setAttribute('aria-expanded', String(show));
    element('hint-button').textContent = show ? 'Hide hint' : 'Show hint';
  });
  element('retry').addEventListener('click', () => { if (!drawing) void draw(true); });
  element('reset-view').addEventListener('click', () => { if (!drawing) void draw(); });
  showRound();
})();
