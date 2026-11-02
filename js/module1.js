(() => {
  'use strict';

  const STEP_AMPLITUDE = 1;
  const RAMP_SLOPE = 1;
  const END_TIME = 30;
  const ERROR_TIME = 24;
  const SAMPLE_COUNT = 1201;
  const VALIDATION_TOLERANCE = 0.0005;
  const timeSamples = Array.from({ length: SAMPLE_COUNT }, (_, i) => i * END_TIME / (SAMPLE_COUNT - 1));
  const colors = { output: '#146248', ideal: '#63756d', lag: '#74529c', error: '#a45d27' };
  const graphElements = {
    plot: { status: 'chart-status', message: 'chart-message', retry: 'retry-chart', reset: 'reset-view' },
    'error-plot': { status: 'error-chart-status', message: 'error-chart-message', retry: 'retry-error-chart', reset: 'reset-error-view' }
  };
  const resetLayouts = {};
  const renderVersions = { plot: 0, 'error-plot': 0 };
  let predictionBaseline = null;
  let predictionWasChecked = false;

  function element(id) {
    return document.getElementById(id);
  }

  function readSettings() {
    return { gain: Number(element('gain').value), tau: Number(element('tau').value), input: element('input-type').value };
  }

  function setResult(id, passed) {
    element(id).textContent = passed ? 'Pass' : 'Fail';
    element(id).className = passed ? 'pass' : 'fail';
  }

  function showChartError(target) {
    const ids = graphElements[target];
    element(ids.status).hidden = false;
    element(ids.status).classList.add('error');
    element(ids.message).textContent = 'This graph could not load. Plotly.js is downloaded from the internet. Check your connection and reload. Numerical values and checks still work.';
    element(ids.retry).hidden = false;
    element(ids.reset).disabled = true;
  }

  function renderGraph(target, traces, layout) {
    const version = ++renderVersions[target];
    resetLayouts[target] = {
      'xaxis.range': layout.xaxis.range.slice(),
      'yaxis.range': layout.yaxis.range.slice(),
      'yaxis.type': layout.yaxis.type || 'linear'
    };
    Plotting.render(target, traces, layout)
      .then(() => {
        if (version !== renderVersions[target]) return;
        const ids = graphElements[target];
        element(ids.status).hidden = true;
        element(ids.status).classList.remove('error');
        element(ids.retry).hidden = true;
        element(ids.reset).disabled = false;
      })
      .catch(() => {
        if (version === renderVersions[target]) showChartError(target);
      });
  }

  function resetGraphView(target) {
    Plotting.resetView(target, resetLayouts[target]).catch(() => showChartError(target));
  }

  function updateStepValidation(settings) {
    const finalValue = settings.gain * STEP_AMPLITUDE;
    element('validation-caption').textContent = 'Separate unit-step test: K = ' + settings.gain.toFixed(1) +
      ', A = 1, τ = ' + settings.tau.toFixed(1) + ' s';
    for (const row of [
      { suffix: 'one', multiple: 1, fraction: 0.632, label: 'τ' },
      { suffix: 'three', multiple: 3, fraction: 0.950, label: '3τ' }
    ]) {
      const time = row.multiple * settings.tau;
      const expected = row.fraction * finalValue;
      const actual = FirstOrderModel.stepResponse(time, settings.tau, settings.gain, STEP_AMPLITUDE);
      element('time-' + row.suffix).textContent = row.label + ' = ' + time.toFixed(1) + ' s';
      element('expected-' + row.suffix).textContent = expected.toFixed(6);
      element('value-' + row.suffix).textContent = actual.toFixed(6);
      setResult('result-' + row.suffix, Math.abs(actual - expected) / finalValue <= VALIDATION_TOLERANCE);
    }
    element('validation-tolerance').textContent = 'Pass when |calculated − expected| / KA ≤ 0.0005. ' +
      'At this gain, the absolute tolerance is ' + (VALIDATION_TOLERANCE * finalValue).toFixed(6) +
      '. This allows for the rounded expected values.';
  }

  function drawStep(settings) {
    const finalValue = settings.gain * STEP_AMPLITUDE;
    const atTau = FirstOrderModel.stepResponse(settings.tau, settings.tau, settings.gain, STEP_AMPLITUDE);
    const atThreeTau = FirstOrderModel.stepResponse(3 * settings.tau, settings.tau, settings.gain, STEP_AMPLITUDE);
    const traces = [
      { x: [0, END_TIME], y: [finalValue, finalValue], type: 'scatter', mode: 'lines', name: 'Final value KA',
        line: { color: colors.ideal, width: 1.5, dash: 'dash' }, hoverinfo: 'skip' },
      { x: timeSamples, y: timeSamples.map(time => FirstOrderModel.stepResponse(time, settings.tau, settings.gain, STEP_AMPLITUDE)),
        type: 'scatter', mode: 'lines', name: 'Sensor output', line: { color: colors.output, width: 3 },
        hovertemplate: 't = %{x:.2f} s<br>y(t) = %{y:.6f}<extra>Sensor output</extra>' },
      { x: [settings.tau], y: [atTau], type: 'scatter', mode: 'markers', name: 'At τ',
        marker: { color: colors.lag, size: 11, symbol: 'circle' },
        hovertemplate: 'τ = %{x:.2f} s<br>y(τ) = %{y:.6f}<extra>63.2% of KA</extra>' },
      { x: [3 * settings.tau], y: [atThreeTau], type: 'scatter', mode: 'markers', name: 'At 3τ',
        marker: { color: colors.error, size: 10, symbol: 'square' },
        hovertemplate: '3τ = %{x:.2f} s<br>y(3τ) = %{y:.6f}<extra>About 95% of KA</extra>' }
    ];
    renderGraph('plot', traces, {
      margin: { l: 62, r: 18, t: 20, b: 56 },
      xaxis: { title: { text: 'Time t (s)' }, range: [0, END_TIME] },
      yaxis: { title: { text: 'Output y(t)' }, type: 'linear', range: [0, 1.12 * finalValue] },
      shapes: [], annotations: []
    });
    element('plot-summary').textContent = 'Final value KA = ' + finalValue.toFixed(3) + '. At τ = ' +
      settings.tau.toFixed(1) + ' s, y = ' + atTau.toFixed(6) + '; at 3τ = ' +
      (3 * settings.tau).toFixed(1) + ' s, y = ' + atThreeTau.toFixed(6) +
      '. The time axis stays at 0–30 seconds.';
  }

  function drawRamp(settings) {
    const idealAtEnd = FirstOrderModel.idealRamp(END_TIME, settings.gain, RAMP_SLOPE);
    const asymptoteTimes = [settings.tau, ...timeSamples.filter(time => time > settings.tau)];
    const actualAtError = FirstOrderModel.rampResponse(ERROR_TIME, settings.tau, settings.gain, RAMP_SLOPE);
    const idealAtError = FirstOrderModel.idealRamp(ERROR_TIME, settings.gain, RAMP_SLOPE);
    const finiteError = FirstOrderModel.rampError(ERROR_TIME, settings.tau, settings.gain, RAMP_SLOPE);
    const steadyError = FirstOrderModel.rampSteadyStateError(settings.tau, settings.gain, RAMP_SLOPE);
    // These two times have equal output on the ideal line and the asymptote.
    const lagStart = 0.45 * END_TIME;
    const lagEnd = lagStart + settings.tau;
    const lagHeight = FirstOrderModel.idealRamp(lagStart, settings.gain, RAMP_SLOPE);
    const tickHeight = idealAtEnd * 0.012;
    const traces = [
      { x: timeSamples, y: timeSamples.map(time => FirstOrderModel.idealRamp(time, settings.gain, RAMP_SLOPE)),
        type: 'scatter', mode: 'lines', name: 'Ideal calibrated output Kx(t)',
        line: { color: colors.ideal, width: 1.5, dash: 'dash' },
        hovertemplate: 't = %{x:.2f} s<br>Kx(t) = %{y:.6f}<extra>Ideal output</extra>' },
      { x: asymptoteTimes, y: asymptoteTimes.map(time => FirstOrderModel.rampAsymptote(time, settings.tau, settings.gain, RAMP_SLOPE)),
        type: 'scatter', mode: 'lines', name: 'Ramp asymptote',
        line: { color: colors.lag, width: 2, dash: 'dot' },
        hovertemplate: 't = %{x:.2f} s<br>Kr(t − τ) = %{y:.6f}<extra>Asymptote</extra>' },
      { x: timeSamples, y: timeSamples.map(time => FirstOrderModel.rampResponse(time, settings.tau, settings.gain, RAMP_SLOPE)),
        type: 'scatter', mode: 'lines', name: 'Sensor output', line: { color: colors.output, width: 3 },
        hovertemplate: 't = %{x:.2f} s<br>y(t) = %{y:.6f}<extra>Sensor output</extra>' },
      { x: [lagStart, lagEnd], y: [lagHeight, lagHeight], type: 'scatter', mode: 'lines', name: 'Asymptotic lag τ',
        line: { color: colors.lag, width: 2 },
        hovertemplate: 'Asymptotic lag τ = ' + settings.tau.toFixed(1) + ' s<extra></extra>' },
      { x: [ERROR_TIME, ERROR_TIME], y: [actualAtError, idealAtError], type: 'scatter', mode: 'lines',
        name: 'Finite-time error', line: { color: colors.error, width: 2.5 },
        hovertemplate: 'e(' + ERROR_TIME + ' s) = ' + finiteError.toFixed(6) + '<extra>Finite-time error</extra>' }
    ];
    const shapes = [lagStart, lagEnd].map(time => ({
      type: 'line', x0: time, x1: time, y0: lagHeight - tickHeight, y1: lagHeight + tickHeight,
      line: { color: colors.lag, width: 2 }
    }));
    for (const height of [actualAtError, idealAtError]) {
      shapes.push({ type: 'line', x0: ERROR_TIME - 0.25, x1: ERROR_TIME + 0.25,
        y0: height, y1: height, line: { color: colors.error, width: 2 } });
    }
    renderGraph('plot', traces, {
      margin: { l: 62, r: 18, t: 20, b: 56 },
      xaxis: { title: { text: 'Time t (s)' }, range: [0, END_TIME] },
      yaxis: { title: { text: 'Calibrated output' }, type: 'linear', range: [0, idealAtEnd * 1.08] },
      shapes,
      annotations: [
        { x: (lagStart + lagEnd) / 2, y: lagHeight + 3 * tickHeight, text: 'τ = ' + settings.tau.toFixed(1) + ' s',
          showarrow: false, font: { color: colors.lag, size: 13 } },
        { x: ERROR_TIME + 0.5, y: (actualAtError + idealAtError) / 2, text: 'e(24 s)',
          showarrow: false, xanchor: 'left', font: { color: colors.error, size: 13 } }
      ]
    });
    element('ramp-lag').textContent = settings.tau.toFixed(1) + ' s';
    element('ramp-error').textContent = finiteError.toFixed(6);
    element('ramp-steady-error').textContent = steadyError.toFixed(6) + ' (limit)';
    element('plot-summary').textContent = 'Unit ramp x(t) = rt, r = 1. At t = 24 s, the ideal calibrated output is ' +
      idealAtError.toFixed(4) + ' and the sensor output is ' + actualAtError.toFixed(4) +
      '. Error is measured against Kx(t), so both curves use the same output scale.';
  }

  function drawErrorDiagnostic(settings) {
    const natural = element('error-view').value === 'natural';
    const times = Array.from({ length: 301 }, (_, i) => 6 * settings.tau * i / 300);
    const values = times.map(time => natural ?
      FirstOrderModel.logStepError(time, settings.tau) : FirstOrderModel.stepErrorFraction(time, settings.tau));
    const pointTimes = [settings.tau, 3 * settings.tau];
    const pointValues = pointTimes.map(time => natural ?
      FirstOrderModel.logStepError(time, settings.tau) : FirstOrderModel.stepErrorFraction(time, settings.tau));
    const tickPowers = [0, 1, 2, 3, 4, 5, 6];
    const ticks = natural ? tickPowers.map(n => -n) : tickPowers.map(n => Math.exp(-n));
    const labels = natural ? tickPowers.map(n => String(-n)) : ['1', 'e⁻¹', 'e⁻²', 'e⁻³', 'e⁻⁴', 'e⁻⁵', 'e⁻⁶'];
    // Plotly receives actual positive error fractions for a logarithmic axis.
    renderGraph('error-plot', [
      { x: times, y: values, type: 'scatter', mode: 'lines', name: natural ? 'ln ε' : 'Error fraction ε',
        line: { color: colors.output, width: 3 },
        hovertemplate: 't = %{x:.3f} s<br>' + (natural ? 'ln ε' : 'ε') + ' = %{y:.6f}<extra></extra>' },
      { x: pointTimes, y: pointValues, type: 'scatter', mode: 'markers', name: 'Slope measurement points',
        marker: { color: colors.lag, size: 9 },
        hovertemplate: 't = %{x:.3f} s<br>' + (natural ? 'ln ε' : 'ε') + ' = %{y:.6f}<extra>Slope measurement point</extra>' }
    ], {
      margin: { l: 68, r: 18, t: 20, b: 56 },
      xaxis: { title: { text: 'Time t (s)' }, range: [0, 6 * settings.tau] },
      // For type log, Plotly range boundaries are base-10 exponents.
      yaxis: { title: { text: natural ? 'Natural log ln ε' : 'Error fraction ε (log axis)' },
        type: natural ? 'linear' : 'log', range: natural ? [-6, 0] : [-6 / Math.LN10, 0],
        tickmode: 'array', tickvals: ticks, ticktext: labels }
    });
    const fractionOne = FirstOrderModel.stepErrorFraction(pointTimes[0], settings.tau);
    const fractionTwo = FirstOrderModel.stepErrorFraction(pointTimes[1], settings.tau);
    const slope = (Math.log(fractionTwo) - Math.log(fractionOne)) / (pointTimes[1] - pointTimes[0]);
    const expectedSlope = -1 / settings.tau;
    element('slope-expected').textContent = expectedSlope.toFixed(6);
    element('slope-value').textContent = slope.toFixed(6);
    setResult('slope-result', Math.abs(slope - expectedSlope) <= 1e-9);
    element('slope-caption').textContent = 'Natural-log slope from ε(' + pointTimes[0].toFixed(1) + ' s) = ' +
      fractionOne.toFixed(6) + ' and ε(' + pointTimes[1].toFixed(1) + ' s) = ' + fractionTwo.toFixed(6);
    element('error-context').textContent = (settings.input === 'ramp' ? 'The main graph shows a ramp. ' : '') +
      'This separate unit-step diagnostic uses K = ' + settings.gain.toFixed(1) + ', A = 1 and τ = ' +
      settings.tau.toFixed(1) + ' s. Normalizing by KA removes the gain from the error fraction.';
    element('error-summary').textContent = natural ?
      'Natural logarithm of the unit-step error, on a linear vertical axis. The highlighted points determine Δln ε / Δt. The graph spans 0–6τ.' :
      'Actual error fraction ε on a logarithmic vertical axis, from 1 to e⁻⁶. The highlighted points are at τ and 3τ. The graph spans 0–6τ.';
  }

  function predictionConditionsMet(settings) {
    return predictionBaseline !== null && settings.input === 'step' &&
      Math.abs(settings.gain - predictionBaseline.gain) <= 1e-9 &&
      settings.tau > predictionBaseline.tau + 1e-9;
  }

  function updatePredictionState() {
    const settings = readSettings();
    const ready = predictionConditionsMet(settings);
    element('check-prediction').disabled = predictionWasChecked || !ready;
    document.querySelectorAll('input[name="prediction"]').forEach(radio => {
      radio.disabled = predictionWasChecked;
    });
    if (predictionBaseline === null) {
      element('prediction-helper').textContent = 'Choose a prediction to unlock the experiment controls.';
    } else if (predictionWasChecked) {
      element('prediction-helper').textContent = 'Prediction checked. Continue exploring the inputs and controls, or reset for another prediction.';
    } else if (settings.input !== 'step') {
      element('prediction-helper').textContent = 'Select the Step input for this prediction. Keep K at ' +
        predictionBaseline.gain.toFixed(1) + ' and increase τ above ' + predictionBaseline.tau.toFixed(1) + ' s.';
    } else if (Math.abs(settings.gain - predictionBaseline.gain) > 1e-9) {
      element('prediction-helper').textContent = 'Restore K to ' + predictionBaseline.gain.toFixed(1) +
        ' for a fair comparison. Keep Step selected and increase τ above ' + predictionBaseline.tau.toFixed(1) + ' s.';
    } else if (!ready) {
      element('prediction-helper').textContent = 'Increase τ above ' + predictionBaseline.tau.toFixed(1) +
        ' s, then check. Keep K at ' + predictionBaseline.gain.toFixed(1) + ' and use the Step input.';
    } else {
      element('prediction-helper').textContent = 'τ has increased from ' + predictionBaseline.tau.toFixed(1) +
        ' s to ' + settings.tau.toFixed(1) + ' s with K fixed at ' + predictionBaseline.gain.toFixed(1) +
        ' and Step selected. Check your prediction when ready.';
    }
  }

  function updateResponse() {
    const settings = readSettings();
    element('tau-value').textContent = settings.tau.toFixed(1) + ' s';
    element('gain-value').textContent = settings.gain.toFixed(1);
    element('tau').setAttribute('aria-valuetext', settings.tau.toFixed(1) + ' seconds');
    element('gain').setAttribute('aria-valuetext', settings.gain.toFixed(1));
    const ramp = settings.input === 'ramp';
    element('response-heading').textContent = ramp ? 'Ramp response' : 'Step response';
    element('input-description').textContent = ramp ? 'Unit ramp: x(t) = rt, slope r = 1 input unit/s.' : 'Unit step: x(t) = A = 1 for t ≥ 0.';
    element('step-formula').hidden = ramp;
    element('ramp-formula').hidden = !ramp;
    element('step-legend').hidden = ramp;
    element('ramp-legend').hidden = !ramp;
    element('ramp-details').hidden = !ramp;
    element('plot').setAttribute('aria-label', ramp ? 'First-order ramp response graph' : 'First-order step response graph');
    updateStepValidation(settings);
    if (ramp) drawRamp(settings); else drawStep(settings);
    drawErrorDiagnostic(settings);
    updatePredictionState();
  }

  function choosePrediction() {
    if (predictionWasChecked) return;
    if (predictionBaseline === null) {
      const settings = readSettings();
      predictionBaseline = { gain: settings.gain, tau: settings.tau };
    }
    element('prediction-feedback').textContent = '';
    for (const id of ['gain', 'tau', 'input-type']) element(id).disabled = false;
    updatePredictionState();
  }

  function checkPrediction() {
    const selected = document.querySelector('input[name="prediction"]:checked');
    if (!selected || predictionWasChecked || !predictionConditionsMet(readSettings())) return;
    predictionWasChecked = true;
    element('prediction-feedback').textContent = (selected.value === 'slower' ? 'Correct. ' : 'Not quite. ') +
      'For a step input with K fixed, increasing τ makes the response slower. It takes longer to reach 63.2% and 95% of KA; the final value KA is unchanged.';
    updatePredictionState();
  }

  function resetExercise() {
    predictionBaseline = null;
    predictionWasChecked = false;
    element('gain').value = '1';
    element('tau').value = '2';
    element('input-type').value = 'step';
    element('error-view').value = 'fraction';
    document.querySelectorAll('input[name="prediction"]').forEach(radio => { radio.checked = false; });
    for (const id of ['gain', 'tau', 'input-type']) element(id).disabled = true;
    element('prediction-feedback').textContent = '';
    updateResponse();
  }

  document.addEventListener('DOMContentLoaded', () => {
    element('gain').addEventListener('input', updateResponse);
    element('tau').addEventListener('input', updateResponse);
    element('input-type').addEventListener('change', updateResponse);
    element('error-view').addEventListener('change', () => drawErrorDiagnostic(readSettings()));
    document.querySelectorAll('input[name="prediction"]').forEach(radio => radio.addEventListener('change', choosePrediction));
    element('check-prediction').addEventListener('click', checkPrediction);
    element('reset-exercise').addEventListener('click', resetExercise);
    element('reset-view').addEventListener('click', () => resetGraphView('plot'));
    element('reset-error-view').addEventListener('click', () => resetGraphView('error-plot'));
    for (const id of ['retry-chart', 'retry-error-chart']) {
      element(id).addEventListener('click', () => window.location.reload());
    }
    resetExercise();
  });
})();
