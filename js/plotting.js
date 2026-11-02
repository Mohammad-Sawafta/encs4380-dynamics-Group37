// Shared graph styling and rendering. Sensor equations belong in model files.
const Plotting = (() => {
  'use strict';

  function isAvailable() {
    return typeof Plotly !== 'undefined';
  }

  function render(target, traces, layout = {}, config = {}) {
    if (!isAvailable()) {
      return Promise.reject(new Error('Plotly.js is unavailable.'));
    }

    // Create fresh defaults for each graph so different modules stay independent.
    const graphLayout = {
      autosize: true,
      showlegend: false,
      paper_bgcolor: '#fcfdfc',
      plot_bgcolor: '#fcfdfc',
      hovermode: 'closest',
      dragmode: 'zoom',
      ...layout,
      margin: { l: 52, r: 12, t: 22, b: 54, ...layout.margin },
      font: {
        family: 'Segoe UI, system-ui, sans-serif',
        size: 13,
        color: '#34483f',
        ...layout.font
      },
      xaxis: { gridcolor: '#e4eae6', zeroline: false, ...layout.xaxis },
      yaxis: { gridcolor: '#e4eae6', zeroline: false, ...layout.yaxis }
    };
    const graphConfig = {
      responsive: true,
      displayModeBar: false,
      scrollZoom: false,
      ...config
    };

    // react redraws an existing graph when its caller supplies new data.
    try {
      return Promise.resolve(Plotly.react(target, traces, graphLayout, graphConfig));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function resetView(target, layoutUpdates) {
    if (!isAvailable()) {
      return Promise.reject(new Error('Plotly.js is unavailable.'));
    }
    try {
      // Plotly can retain range arrays and mutate them during a later zoom.
      // Give each reset fresh arrays so the caller's saved limits stay intact.
      const updates = {};
      for (const [key, value] of Object.entries(layoutUpdates)) {
        updates[key] = Array.isArray(value) ? value.slice() : value;
      }
      return Promise.resolve(Plotly.relayout(target, updates));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return Object.freeze({ isAvailable, render, resetView });
})();
