(() => {
  'use strict';

  const element = name => document.getElementById('second-order-' + name);
  const fields = ['mass', 'damping', 'stiffness'];
  const units = ['kg', 'N·s/m', 'N/m'];
  const sliders = fields.map(element);
  const preset = element('preset');
  const check = element('check');
  const predictionStatus = element('prediction-status');
  const chartStatus = element('chart-status');
  const resetPlots = element('reset-plots');
  const [stepPlot, polesPlot, phasePlot] = ['step-plot', 'poles-plot', 'phase-plot'].map(element);
  const predictions = [...element('predictions').querySelectorAll('input')];
  const [defaultMass, defaultDamping, defaultStiffness] = sliders.map(slider => Number(slider.defaultValue));
  const presets = [2, 4, 8];
  const colors = { response: '#146248', marker: '#74529c', peak: '#a45d27' };
  let renderPending = false;
  let plotsDirty = false;

  function formatPolePair([first, second]) {
    if (first.imag !== 0) return `${first.real.toFixed(3)} ± j${first.imag.toFixed(3)}`;
    if (first.real === second.real) return `${first.real.toFixed(3)} (double)`;
    return `${first.real.toFixed(3)}, ${second.real.toFixed(3)}`;
  }

  function axis(title) {
    return { title: { text: title, standoff: 8 }, automargin: true };
  }

  function line(x, y, hovertemplate) {
    return { x, y, type: 'scatter', mode: 'lines', line: { color: colors.response, width: 2.5 }, hovertemplate };
  }

  function point(x, y, name, symbol, color, size = 10) {
    return {
      x, y, type: 'scatter', mode: 'markers', name,
      marker: { symbol, color, size },
      hovertemplate: '%{x:.4g}, %{y:.4g}<extra>%{fullData.name}</extra>'
    };
  }

  function renderPlots(model, metrics, eigenvalues) {
    const { t10, t90, peakTime, settlingTime } = metrics;
    const end = Math.max(8 / model.omega, 1.25 * settlingTime, 1.1 * (peakTime ?? 0));
    const times = Array.from({ length: 1001 }, (_, i) => i * end / 1000);
    times.push(t10, t90, settlingTime);
    if (peakTime !== null) times.push(peakTime);
    times.sort((a, b) => a - b);
    const states = times.map(model.state);
    const displacement = states.map(state => state.position);
    const velocity = states.map(state => state.velocity);
    const final = model.final;
    const stepTraces = [
      line(times, displacement, '%{x:.4g} s, %{y:.4g} m<extra>Displacement</extra>'),
      point([t10], [0.1 * final], 'First 10% crossing', 'circle', colors.marker),
      point([t90], [0.9 * final], 'First 90% crossing', 'circle', colors.marker),
      point([settlingTime], [model.state(settlingTime).position], 'Settling time', 'square', colors.marker)
    ];
    if (peakTime !== null) {
      stepTraces.push(point([peakTime], [model.state(peakTime).position], 'First peak', 'diamond', colors.peak));
    }

    const step = Plotting.render(stepPlot, stepTraces, {
      xaxis: { ...axis('Time (s)'), range: [0, end] },
      yaxis: { ...axis('Displacement (m)'), rangemode: 'tozero' },
      shapes: [
        { type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: 0.98 * final, y1: 1.02 * final,
          fillcolor: 'rgba(20, 98, 72, 0.13)', line: { width: 0 }, layer: 'below' },
        { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: final, y1: final,
          line: { color: '#63756d', width: 1, dash: 'dash' }, layer: 'below' }
      ]
    });

    const extent = Math.max(1, ...model.poles.map(pole => Math.abs(pole.real)));
    const height = Math.max(0.25 * extent, ...model.poles.map(pole => 1.3 * Math.abs(pole.imag)));
    const poles = Plotting.render(polesPlot, [
      point(model.poles.map(pole => pole.real), model.poles.map(pole => pole.imag),
        'Transfer-function pole', 'x', colors.response),
      point(eigenvalues.map(pole => pole.real), eigenvalues.map(pole => pole.imag),
        'Eigenvalue of A', 'circle-open', colors.marker, 17)
    ], {
      xaxis: { ...axis('Real part (s⁻¹)'), zeroline: true, range: [-1.18 * extent, 0.18 * extent] },
      yaxis: { ...axis('Imaginary part (s⁻¹)'), zeroline: true, range: [-height, height] }
    });

    const phase = Plotting.render(phasePlot, [
      line(displacement, velocity, '%{x:.4g} m, %{y:.4g} m/s<extra>State</extra>'),
      point([0], [0], 'Initial state', 'circle-open', colors.marker),
      point([final], [0], 'Equilibrium', 'diamond', colors.peak)
    ], {
      xaxis: axis('Displacement x₁ (m)'),
      yaxis: { ...axis('Velocity x₂ (m/s)'), zeroline: true }
    });

    return Promise.allSettled([step, poles, phase]);
  }

  async function draw() {
    plotsDirty = false;
    const values = sliders.map(slider => Number(slider.value));
    const model = SecondOrderModel.create(...values);
    const metrics = SecondOrderModel.measure(model);
    const eigenvalues = SecondOrderModel.eigenvalues(model.A);
    values.forEach((value, i) => {
      const display = `${value.toFixed(2)} ${units[i]}`;
      element(fields[i] + '-value').textContent = display;
      sliders[i].setAttribute('aria-valuetext', display);
    });
    element('regime').textContent = `${model.regime === 'Critical' ? 'Critically damped' : model.regime} · ζ = ${model.zeta.toFixed(4)} · ωₙ = ${model.omega.toFixed(3)} rad/s · Final displacement = ${model.final.toFixed(3)} m`;
    element('rise').textContent = metrics.riseTime.toFixed(3) + ' s';
    element('peak').textContent = metrics.peakTime === null ? 'No peak' : metrics.peakTime.toFixed(3) + ' s';
    element('overshoot').textContent = metrics.overshoot.toFixed(2) + '%';
    element('settle').textContent = metrics.settlingTime.toFixed(3) + ' s';

    const fixed = value => value.toFixed(3).padStart(7);
    const [top, bottom] = model.A.map(row => row.map(fixed).join('  '));
    element('matrix-a').textContent = `    [ ${top} ]\nA = [ ${bottom} ]`;
    element('matrix-b').textContent = `    [ ${fixed(model.B[0])} ]\nB = [ ${fixed(model.B[1])} ]`;
    element('poles').textContent = formatPolePair(model.poles);
    element('eigenvalues').textContent = formatPolePair(eigenvalues);

    const results = await renderPlots(model, metrics, eigenvalues);
    const plotsReady = results.every(result => result.status === 'fulfilled');
    chartStatus.hidden = plotsReady;
    chartStatus.classList.toggle('error', !plotsReady);
    chartStatus.textContent = plotsReady ? '' : 'The graphs could not load. Check your connection and reload the page.';
    resetPlots.disabled = !plotsReady;
    renderPending = false;
    if (plotsDirty) scheduleDraw();
  }

  function scheduleDraw() {
    plotsDirty = true;
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(draw);
  }

  function updateExperiment() {
    const [mass, damping, stiffness] = sliders.map(slider => Number(slider.value));
    const defaultsForMassAndStiffness = mass === defaultMass && stiffness === defaultStiffness;
    const selected = predictions.some(radio => radio.checked);
    preset.value = defaultsForMassAndStiffness && presets.includes(damping) ? damping : '';
    check.disabled = !selected || !defaultsForMassAndStiffness || damping <= defaultDamping;
    predictionStatus.classList.remove('pass', 'fail');
    predictionStatus.textContent = !selected ? 'Choose a prediction to unlock the controls.'
      : check.disabled ? 'Increase b above 2 N·s/m with m = 1 kg and k = 4 N/m to check your prediction.'
        : 'Check your prediction against the current overshoot.';
    scheduleDraw();
  }

  function renderValidations() {
    const reference = SecondOrderModel.create(1, 2, 4);
    const under = SecondOrderModel.measure(reference).overshoot;
    const critical = SecondOrderModel.measure(SecondOrderModel.create(1, 4, 4)).overshoot;
    const eigenvalues = SecondOrderModel.eigenvalues(reference.A);
    const pairPasses = eigenvalues.every(({ real, imag }, i) => (
      Math.abs(real + 1) <= 0.0005 && Math.abs(imag - (i === 0 ? 1.732 : -1.732)) <= 0.0005
      && Math.hypot(real - reference.poles[i].real, imag - reference.poles[i].imag) <= 1e-10
    ));
    const checks = [
      ['4 · Overshoot at ζ = 0.5', '16.3%', under.toFixed(2) + '%', Math.abs(under - 16.3) <= 0.05],
      ['5 · Overshoot at ζ = 1', '0%', critical.toFixed(2) + '%', critical === 0],
      ['6 · Eigenvalues and poles at m = 1, b = 2, k = 4', '−1 ± j1.732 s⁻¹',
        formatPolePair(eigenvalues) + ' s⁻¹', pairPasses]
    ];

    for (const [name, expected, calculated, passed] of checks) {
      const row = element('validation-rows').insertRow();
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = name;
      row.appendChild(heading);
      row.insertCell().textContent = expected;
      row.insertCell().textContent = calculated;
      const result = row.insertCell();
      result.textContent = passed ? 'PASS' : 'FAIL';
      result.className = passed ? 'pass' : 'fail';
    }
  }

  predictions.forEach(radio => radio.addEventListener('change', () => {
    sliders.forEach(slider => { slider.disabled = false; });
    preset.disabled = false;
    updateExperiment();
  }));
  sliders.forEach(slider => slider.addEventListener('input', updateExperiment));
  preset.addEventListener('change', () => {
    if (!preset.value) return;
    const damping = preset.value;
    [sliders[0].value, sliders[1].value, sliders[2].value] = [defaultMass, damping, defaultStiffness];
    updateExperiment();
  });
  check.addEventListener('click', () => {
    const model = SecondOrderModel.create(...sliders.map(slider => Number(slider.value)));
    const before = SecondOrderModel.measure(SecondOrderModel.create(defaultMass, defaultDamping, defaultStiffness));
    const after = SecondOrderModel.measure(model);
    const correct = predictions.find(radio => radio.checked).value === 'decreases';
    predictionStatus.classList.add(correct ? 'pass' : 'fail');
    predictionStatus.textContent = `${correct ? 'Correct.' : 'Overshoot decreases.'} It fell from ${before.overshoot.toFixed(2)}% to ${after.overshoot.toFixed(2)}%. Increasing b raises ζ and reduces the first peak.`;
  });
  element('reset').addEventListener('click', () => {
    predictions.forEach(radio => { radio.checked = false; });
    sliders.forEach(slider => {
      slider.value = slider.defaultValue;
      slider.disabled = true;
    });
    preset.disabled = true;
    updateExperiment();
  });
  resetPlots.addEventListener('click', scheduleDraw);
  renderValidations();
  updateExperiment();
})();
