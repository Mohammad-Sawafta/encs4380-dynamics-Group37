# ENCS4380 Dynamic Characteristics Toolkit - Group 37

An interactive toolkit for exploring sensor dynamics. Module 1 covers first-order step and ramp responses.

**Live website:** [Open the Dynamic Characteristics Toolkit](https://mohammad-sawafta.github.io/encs4380-dynamics-Group37/).

The [source repository](https://github.com/Mohammad-Sawafta/encs4380-dynamics-Group37) publishes through GitHub Pages. Open the live website in a desktop or phone browser. An internet connection is needed to load Plotly.js; no account or installation is required.

## Use Module 1

1. Choose a prediction before moving the experiment controls.
2. Increase the time constant while keeping K fixed and Step selected, then check your prediction.
3. Explore gain K and switch between a step and a ramp input.
4. Inspect the response markers, ramp lag, and dynamic error.
5. Switch the step-error diagnostic between a logarithmic error axis and a natural-log plot.
6. Read the expected values, calculated values, and pass/fail results.

The step amplitude is A = 1 input unit. The ramp slope is r = 1 input unit per second. The initial output is zero. Time is measured in seconds, and the controls use positive gain and a positive time constant.

## Equations and interpretation

The homework's model is `tau * dy/dt + y = K * x(t)`.

| Quantity | Formula |
| --- | --- |
| Step input | `x(t) = A` for `t >= 0` |
| Step output | `y(t) = K*A*(1 - exp(-t/tau))` |
| Ramp input | `x(t) = r*t` |
| Ideal calibrated ramp output | `K*x(t) = K*r*t` |
| Actual ramp output | `y(t) = K*r*(t - tau*(1 - exp(-t/tau)))` |
| Ramp asymptote | `K*r*(t - tau)` |
| Ramp dynamic error | `e(t) = K*x(t) - y(t) = K*r*tau*(1 - exp(-t/tau))` |
| Steady-state ramp error | `e_ss = K*r*tau` |
| Asymptotic ramp time lag | `tau` |
| Step error fraction | `epsilon = (K*A - y_step)/(K*A) = exp(-t/tau)` |
| Natural log of step error | `ln(epsilon) = -t/tau` |

The ramp error compares the measured output with **K times the input**. Subtracting the raw input from the output would mix gain error with dynamic lag when K differs from 1. A ramp does not have a finite final output; its error approaches the steady-state value while both ideal and actual outputs keep increasing.

The logarithmic diagnostic uses a separate unit-step experiment at the current K and tau, even when the main graph shows a ramp. The slope `-1/tau` refers to **ln(epsilon)** versus physical time. A plot of `log10(epsilon)` would instead have slope `-1/(tau*ln(10))`.

## Validation

Homework validation check 1 is shown on the page:

- `y(tau) / (K*A) = 0.6321205588`, approximately 0.632.
- `y(3*tau) / (K*A) = 0.9502129316`, approximately 0.95.

The step checks allow an absolute difference of 0.0005 in the normalized fraction because the homework values are rounded. Expected output values scale with K*A. These remain explicitly labeled step checks when the main input is a ramp.

To run the independent numerical checks with Node.js:

```sh
node tests/first-order.test.cjs
```

The tests compare the closed-form step and ramp outputs against an independent RK4 integration of the governing differential equation. They also check non-unit gains and input sizes, the ramp-error identity and limit, the asymptotic lag, and the natural-log slope.

All 470 numerical assertions passed. Browser checks covered controls, predictions, both diagnostic scales, graph resets, and desktop and phone-width layouts. The published website was also checked on a physical phone.

## File responsibilities

| File | Responsibility |
| --- | --- |
| `index.html` | Content, controls, graph containers, and script loading |
| `css/styles.css` | Shared styling and responsive layout |
| `js/models/first-order.js` | Reusable equations, independent of the page and Plotly |
| `js/plotting.js` | Shared Plotly styling, rendering, and reset helpers |
| `js/module1.js` | Module 1 controls, graph data, prediction, and validation |
| `tests/first-order.test.cjs` | Independent numerical verification |

## Group members and module ownership

- [Mohammad-Sawafta](https://github.com/Mohammad-Sawafta)
- [Yanal Omar (yaniomar)](https://github.com/yaniomar)
- [Saifeddin Saleh (saifsaleh05)](https://github.com/saifsaleh05)

| Module | Owner | Status |
| --- | --- | --- |
| Module 1 - first-order time response | Mohammad | Published |
| Module 2 - first-order frequency response | Yanal | Planned for Checkpoint 2 |
| Module 3 - second-order response and state-space panel | Saif | Planned for Checkpoint 2 |
| Module 4 - Guess the Sensor challenge | Mohammad | Planned for the final release |

## Screenshots

![Step response and validation](docs/images/module1-step.jpg)

![Ramp response, lag, and error](docs/images/module1-ramp.jpg)

## AI assistance

AI assistance helped draft the interface and JavaScript, check equations, and prepare numerical tests.
