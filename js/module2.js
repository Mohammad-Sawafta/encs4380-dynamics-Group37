(() => {
  'use strict';

  const colors = { input: '#63756d', output: '#146248', current: '#a45d27', cutoff: '#74529c' };
  const graphIds = ['frequency-wave-plot', 'bode-magnitude-plot', 'bode-phase-plot'];
  const resetLayouts = {};
  const renderVersions = Object.fromEntries(graphIds.map(id => [id, 0]));
  let predictionBaseline = null;
  let predictionWasChecked = false;

  function element(id) {
    return document.getElementById(id);
  }

  function settings() {
    return {
      tau: Number(element('frequency-tau').value),
      omega: Number(element('frequency-omega').value)
    };
  }

  function setResult(id, passed) {
    element(id).textContent = passed ? 'PASS' : 'FAIL';
    element(id).className = passed ? 'pass' : 'fail';
  }

  function showGraphError() {
    element('frequency-chart-status').hidden = false;
    element('frequency-chart-status').classList.add('error');
    element('frequency-chart-message').textContent = 'The graphs could not load. Plotly.js comes from the internet; check the connection and reload. All numerical calculations still work.';
    element('frequency-retry-charts').hidden = false;
    for (const id of ['frequency-reset-wave', 'frequency-reset-bode']) element(id).disabled = true;
  }

  function renderGraph(target, traces, layout) {
    const version = ++renderVersions[target];
    const reset = {};
    if (layout.xaxis && layout.xaxis.range) reset['xaxis.range'] = layout.xaxis.range.slice();
    if (layout.yaxis && layout.yaxis.range) reset['yaxis.range'] = layout.yaxis.range.slice();
    if (layout.xaxis && layout.xaxis.type) reset['xaxis.type'] = layout.xaxis.type;
    resetLayouts[target] = reset;
    Plotting.render(target, traces, layout)
      .then(() => {
        if (version !== renderVersions[target]) return;
        element('frequency-chart-status').hidden = true;
        element('frequency-chart-status').classList.remove('error');
        element('frequency-retry-charts').hidden = true;
        element('frequency-reset-wave').disabled = false;
        element('frequency-reset-bode').disabled = false;
      })
      .catch(() => {
        if (version === renderVersions[target]) showGraphError();
      });
  }

  function resetGraph(id) {
    Plotting.resetView(id, resetLayouts[id]).catch(showGraphError);
  }

  function drawWaveGraph(current) {
    const ratio = FrequencyResponseModel.amplitudeRatio(current.tau, current.omega);
    const phase = FrequencyResponseModel.phaseRadians(current.tau, current.omega);
    const period = 2 * Math.PI / current.omega;
    const endTime = 3 * period;
    const times = Array.from({ length: 721 }, (_, i) => i * endTime / 720);
    const inputPeak = Math.PI / (2 * current.omega);
    const outputPeak = (Math.PI / 2 - phase) / current.omega;
    const yLimit = 1.16;
    renderGraph('frequency-wave-plot', [
      {
        x: times, y: times.map(time => Math.sin(current.omega * time)), type: 'scatter', mode: 'lines',
        name: 'Input x(t)', line: { color: colors.input, width: 2, dash: 'dash' },
        hovertemplate: 't = %{x:.4f} s<br>x(t) = %{y:.4f}<extra>Unit-amplitude input</extra>'
      },
      {
        x: times, y: times.map(time => FrequencyResponseModel.steadyStateOutput(time, current.tau, current.omega)),
        type: 'scatter', mode: 'lines', name: 'Output y(t)', line: { color: colors.output, width: 3 },
        hovertemplate: 't = %{x:.4f} s<br>y(t) = %{y:.4f}<extra>Steady-state output, K = 1</extra>'
      }
    ], {
      showlegend: true,
      legend: { orientation: 'h', x: 0, y: 1.12 },
      margin: { l: 62, r: 18, t: 48, b: 56 },
      xaxis: { title: { text: 'Time t (s)' }, range: [0, endTime] },
      yaxis: { title: { text: 'Amplitude' }, range: [-yLimit, yLimit] },
      shapes: [
        { type: 'line', x0: inputPeak, x1: inputPeak, y0: 0, y1: 1, line: { color: colors.input, width: 1, dash: 'dot' } },
        { type: 'line', x0: outputPeak, x1: outputPeak, y0: 0, y1: ratio, line: { color: colors.output, width: 1, dash: 'dot' } }
      ],
      annotations: [{
        x: (inputPeak + outputPeak) / 2, y: 1.06, showarrow: false,
        text: 'phase lag = ' + Math.abs(phase * 180 / Math.PI).toFixed(1) + '°',
        font: { color: colors.cutoff, size: 12 }
      }]
    });
    element('frequency-wave-summary').textContent = 'Three periods are shown. The output amplitude is ' +
      ratio.toFixed(4) + ' of the input and its peak occurs ' + ((outputPeak - inputPeak) * 1000).toFixed(2) +
      ' ms later. This is the steady-state sinusoidal response; the startup transient is not included.';
  }

  function logarithmicSamples(minimum, maximum, count) {
    const start = Math.log10(minimum);
    const span = Math.log10(maximum) - start;
    return Array.from({ length: count }, (_, i) => 10 ** (start + span * i / (count - 1)));
  }

  function drawBodePlots(current) {
    const cutoff = FrequencyResponseModel.cutoffFrequency(current.tau);
    const minimum = Math.max(1e-4, Math.min(current.omega, cutoff) / 100);
    const maximum = Math.min(1e6, Math.max(current.omega, cutoff) * 100);
    const frequencies = logarithmicSamples(minimum, maximum, 401);
    const magnitude = frequencies.map(omega => FrequencyResponseModel.bodeMagnitudeDb(current.tau, omega));
    const phase = frequencies.map(omega => FrequencyResponseModel.phaseDegrees(current.tau, omega));
    const currentMagnitude = FrequencyResponseModel.bodeMagnitudeDb(current.tau, current.omega);
    const currentPhase = FrequencyResponseModel.phaseDegrees(current.tau, current.omega);
    const xRange = [Math.log10(minimum), Math.log10(maximum)];
    const sharedShapes = [
      { type: 'line', x0: current.omega, x1: current.omega, yref: 'paper', y0: 0, y1: 1, line: { color: colors.current, width: 1.5, dash: 'dash' } },
      { type: 'line', x0: cutoff, x1: cutoff, yref: 'paper', y0: 0, y1: 1, line: { color: colors.cutoff, width: 1.5, dash: 'dot' } }
    ];
    renderGraph('bode-magnitude-plot', [
      { x: frequencies, y: magnitude, type: 'scatter', mode: 'lines', name: 'Magnitude',
        line: { color: colors.output, width: 3 },
        hovertemplate: 'ω = %{x:.4g} rad/s<br>Magnitude = %{y:.3f} dB<extra></extra>' },
      { x: [current.omega], y: [currentMagnitude], type: 'scatter', mode: 'markers', name: 'Current frequency',
        marker: { color: colors.current, size: 10 }, hovertemplate: 'Current ω = %{x:.4g} rad/s<br>%{y:.3f} dB<extra></extra>' },
      { x: [cutoff], y: [-10 * Math.log10(2)], type: 'scatter', mode: 'markers', name: 'Cutoff',
        marker: { color: colors.cutoff, size: 10, symbol: 'diamond' }, hovertemplate: 'Cutoff ωc = %{x:.4g} rad/s<br>%{y:.3f} dB<extra></extra>' }
    ], {
      showlegend: true, legend: { orientation: 'h', x: 0, y: 1.18 },
      margin: { l: 64, r: 18, t: 56, b: 54 },
      xaxis: { title: { text: 'Angular frequency ω (rad/s)' }, type: 'log', range: xRange },
      yaxis: { title: { text: 'Magnitude (dB)' }, range: [Math.min(-3.5, magnitude[magnitude.length - 1] * 1.08), 1] },
      shapes: sharedShapes
    });
    renderGraph('bode-phase-plot', [
      { x: frequencies, y: phase, type: 'scatter', mode: 'lines', name: 'Phase',
        line: { color: colors.output, width: 3 },
        hovertemplate: 'ω = %{x:.4g} rad/s<br>Phase = %{y:.3f}°<extra></extra>' },
      { x: [current.omega], y: [currentPhase], type: 'scatter', mode: 'markers', name: 'Current frequency',
        marker: { color: colors.current, size: 10 }, hovertemplate: 'Current ω = %{x:.4g} rad/s<br>%{y:.3f}°<extra></extra>' },
      { x: [cutoff], y: [-45], type: 'scatter', mode: 'markers', name: 'Cutoff',
        marker: { color: colors.cutoff, size: 10, symbol: 'diamond' }, hovertemplate: 'Cutoff ωc = %{x:.4g} rad/s<br>−45°<extra></extra>' }
    ], {
      showlegend: false,
      margin: { l: 64, r: 18, t: 22, b: 54 },
      xaxis: { title: { text: 'Angular frequency ω (rad/s)' }, type: 'log', range: xRange },
      yaxis: { title: { text: 'Phase (degrees)' }, range: [-95, 5], tickvals: [-90, -75, -60, -45, -30, -15, 0] },
      shapes: sharedShapes
    });
    element('frequency-cutoff-summary').textContent = 'Cutoff ωc = 1/τ = ' + cutoff.toFixed(4) +
      ' rad/s (' + FrequencyResponseModel.radiansPerSecondToHz(cutoff).toFixed(4) +
      ' Hz). At cutoff, M = 0.7071, magnitude = −3.0103 dB, and phase = −45°.';
  }

  function updateMetrics(current) {
    const ratio = FrequencyResponseModel.amplitudeRatio(current.tau, current.omega);
    const phaseRadians = FrequencyResponseModel.phaseRadians(current.tau, current.omega);
    const signedError = ratio - 1;
    element('frequency-tau-value').textContent = current.tau.toFixed(2) + ' s';
    element('frequency-omega-value').textContent = current.omega.toFixed(1) + ' rad/s';
    element('frequency-tau').setAttribute('aria-valuetext', current.tau.toFixed(2) + ' seconds');
    element('frequency-omega').setAttribute('aria-valuetext', current.omega.toFixed(1) + ' radians per second');
    element('frequency-metric-tau').textContent = current.tau.toFixed(3) + ' s';
    element('frequency-metric-omega').textContent = current.omega.toFixed(3) + ' rad/s';
    element('frequency-metric-hz').textContent = FrequencyResponseModel.radiansPerSecondToHz(current.omega).toFixed(4) + ' Hz';
    element('frequency-metric-ratio').textContent = ratio.toFixed(6);
    element('frequency-metric-degrees').textContent = (phaseRadians * 180 / Math.PI).toFixed(3) + '°';
    element('frequency-metric-radians').textContent = phaseRadians.toFixed(6) + ' rad';
    element('frequency-error-signed').textContent = signedError.toFixed(6);
    element('frequency-error-percent').textContent = (signedError * 100).toFixed(3) + '%';
    element('frequency-error-ratio').textContent = ratio.toFixed(6);
    element('frequency-error-explanation').textContent = 'δ is negative because the output is attenuated. Its magnitude e = 1 − M is ' +
      Math.abs(signedError).toFixed(6) + ' (' + Math.abs(signedError * 100).toFixed(3) + '%).';
  }

  function updateDesignCalculator() {
    const frequency = Number(element('maximum-frequency').value);
    const percent = Number(element('allowed-error').value);
    const output = element('maximum-tau-result');
    if (!(frequency > 0) || !(percent > 0 && percent < 100)) {
      output.textContent = 'Enter a positive frequency and an error between 0% and 100%.';
      output.className = 'calculator-result fail';
      return;
    }
    const error = percent / 100;
    const tau = FrequencyResponseModel.maximumPermissibleTau(frequency, error);
    const omega = FrequencyResponseModel.hzToRadiansPerSecond(frequency);
    const achievedRatio = FrequencyResponseModel.amplitudeRatio(tau, omega);
    output.textContent = 'τmax = ' + (tau * 1000).toFixed(4) + ' ms. At ' + frequency.toFixed(2) +
      ' Hz, M = ' + achievedRatio.toFixed(6) + ' and e = 1 − M = ' + ((1 - achievedRatio) * 100).toFixed(3) + '%.';
    output.className = 'calculator-result';
  }

  function updateValidations() {
    const ratio2 = FrequencyResponseModel.amplitudeRatio(0.2, 2);
    const phase2 = Math.abs(FrequencyResponseModel.phaseDegrees(0.2, 2));
    const tau3 = FrequencyResponseModel.maximumPermissibleTau(100, 0.05);
    const phase3 = Math.abs(FrequencyResponseModel.phaseDegrees(tau3, FrequencyResponseModel.hzToRadiansPerSecond(50)));
    const rows = [
      ['validation2-ratio', ratio2, '0.93', Math.abs(ratio2 - 0.93) <= 0.005, ratio2.toFixed(6)],
      ['validation2-phase', phase2, '21.8°', Math.abs(phase2 - 21.8) <= 0.05, phase2.toFixed(4) + '°'],
      ['validation3-tau', tau3 * 1000, '0.52 ms', Math.abs(tau3 * 1000 - 0.52) <= 0.01, (tau3 * 1000).toFixed(6) + ' ms'],
      ['validation3-phase', phase3, '9.3°', Math.abs(phase3 - 9.3) <= 0.1, phase3.toFixed(4) + '°']
    ];
    for (const [id, , expected, passed, calculated] of rows) {
      element(id + '-expected').textContent = expected;
      element(id + '-calculated').textContent = calculated;
      setResult(id + '-result', passed);
    }
  }

  function updatePredictionState() {
    const omega = settings().omega;
    const changed = predictionBaseline !== null && Math.abs(omega - predictionBaseline) > 1e-9;
    element('frequency-check-prediction').disabled = !changed;
    if (predictionBaseline === null) {
      element('frequency-prediction-helper').textContent = 'Choose a prediction to unlock the frequency-response controls.';
    } else if (predictionWasChecked) {
      element('frequency-prediction-helper').textContent = 'Prediction checked. Continue exploring, or reset for another prediction.';
    } else {
      element('frequency-prediction-helper').textContent = changed ?
        'Frequency changed from ' + predictionBaseline.toFixed(1) + ' rad/s. Check your prediction when ready.' :
        'Prediction saved. Increase ω while keeping τ fixed, then check your answer.';
    }
  }

  function updateAll() {
    const current = settings();
    updateMetrics(current);
    drawWaveGraph(current);
    drawBodePlots(current);
    updatePredictionState();
  }

  function choosePrediction() {
    predictionBaseline = settings().omega;
    predictionWasChecked = false;
    element('frequency-prediction-feedback').textContent = '';
    for (const id of ['frequency-tau', 'frequency-omega']) element(id).disabled = false;
    updatePredictionState();
  }

  function checkPrediction() {
    const selected = document.querySelector('input[name="frequency-prediction"]:checked');
    const omega = settings().omega;
    if (!selected || predictionBaseline === null || Math.abs(omega - predictionBaseline) <= 1e-9) return;
    predictionWasChecked = true;
    element('frequency-prediction-feedback').textContent = (selected.value === 'attenuate-lag' ? 'Correct. ' : 'Not quite. ') +
      'Increasing ω increases ωτ. Therefore M = 1/√(1 + (ωτ)²) decreases, while the magnitude of φ = −tan⁻¹(ωτ) increases: more attenuation and more phase lag.';
    updatePredictionState();
  }

  function resetExercise() {
    predictionBaseline = null;
    predictionWasChecked = false;
    element('frequency-tau').value = '0.20';
    element('frequency-omega').value = '2.0';
    document.querySelectorAll('input[name="frequency-prediction"]').forEach(radio => { radio.checked = false; });
    for (const id of ['frequency-tau', 'frequency-omega']) element(id).disabled = true;
    element('frequency-prediction-feedback').textContent = '';
    updateAll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    element('frequency-tau').addEventListener('input', updateAll);
    element('frequency-omega').addEventListener('input', updateAll);
    document.querySelectorAll('input[name="frequency-prediction"]').forEach(radio => radio.addEventListener('change', choosePrediction));
    element('frequency-check-prediction').addEventListener('click', checkPrediction);
    element('frequency-reset-exercise').addEventListener('click', resetExercise);
    element('frequency-reset-wave').addEventListener('click', () => resetGraph('frequency-wave-plot'));
    element('frequency-reset-bode').addEventListener('click', () => {
      resetGraph('bode-magnitude-plot');
      resetGraph('bode-phase-plot');
    });
    element('frequency-retry-charts').addEventListener('click', () => window.location.reload());
    element('maximum-frequency').addEventListener('input', updateDesignCalculator);
    element('allowed-error').addEventListener('input', updateDesignCalculator);
    updateDesignCalculator();
    updateValidations();
    resetExercise();
  });
})();
