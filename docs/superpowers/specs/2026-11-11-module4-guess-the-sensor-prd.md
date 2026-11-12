# Module 4 Guess the Sensor PRD

**Status:** Approved by Mohammad for local implementation on 11 November 2026 and for commit and push on 12 November 2026. Module 2 is to remain unchanged.

**Owner:** Mohammad Sawafta, Group 37

**Course:** ENCS4380 Homework 1, Dynamic Characteristics

**Date:** 11 November 2026

Module 4 will let a student estimate a hidden sensor's parameters from a noisy response, submit a prediction, and compare it with the actual sensor. It completes the toolkit's learning sequence: Modules 1 to 3 explain the responses; Module 4 checks whether the student can interpret them independently.

This PRD defines the proposed behavior, scoring, integration, and acceptance criteria. Implementation begins only after Mohammad approves it.

## Goals and boundaries

The student should be able to estimate first-order gain K and time constant tau, or second-order damping ratio zeta and natural frequency omega_n; understand their errors from a curve comparison; and practice multiple rounds with a fair running score.

Module 4 is worth 15 of the assignment's 100 points. Its rubric emphasizes random sensors, fair scoring, and a reveal overlay. The final homework deadline is 12 November 2026. [S1, pp. 3-4]

The module will run in the existing static GitHub Pages site, without an account or server. It will reuse the existing design and equations. Accounts, leaderboards, saved scores across visits, difficulty levels, extra-credit experiments, and changes to the learning behavior of Modules 1 to 3 are outside this scope.

## Assignment requirements

These requirements come from the homework. The later sections specify proposed choices where the homework leaves details open.

| ID | Required behavior | Source |
| --- | --- | --- |
| R1 | Generate a hidden first-order sensor with random K and tau, or a second-order sensor with random zeta and omega_n, and add a little noise. | S1, p. 3, Module 4 step 1 |
| R2 | Show one response: a step response, with a stated-frequency sine response also described for first-order rounds. | S1, p. 3, Module 4 step 2 |
| R3 | Let the student estimate parameters by reading the curve, using first-order time-response methods or second-order overshoot and peak time. | S1, pp. 2-3 |
| R4 | After the guess, reveal the true parameters, overlay the true curve on the guessed curve, and award full marks within 10%. | S1, p. 3, Module 4 step 4 |
| R5 | Provide a New sensor action, a running session score, and a short hint on request. | S1, p. 3, Module 4 step 5 and following sentence |
| R6 | Keep hidden sensor controls unavailable before the guess; provide the required Predict, then check learning interaction. | S1, p. 2 |
| R7 | Use closed-form responses, work on phones, and integrate into the static site with working controls and documentation. | S1, p. 3 |

The homework randomizes K but its summary table mentions only tau for first-order estimation. This proposal asks for **both K and tau**, making gain estimation explicit. It also interprets full marks as **every requested parameter being within 10%** of its true value.

## Recommended approach

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| **First-order step and sine rounds, plus second-order step rounds** | Practices the material from all three preceding modules and covers the response variants described in the assignment. | Sine rounds need clear phase and amplitude hints. |
| Step rounds for both sensor families | Simpler interaction and a smaller implementation. | Omits the described sine variant and direct practice of Module 2. |
| First-order step rounds only | Smallest initial version. | Leaves second-order identification out of the challenge. |

The first approach is recommended. Second-order challenges will use clearly underdamped systems, because the specified overshoot and peak-time method needs an observable peak. Module 3 will continue to demonstrate critical and overdamping.

## Student experience

1. Open **Module 4 · Guess the Sensor** from the existing module navigation. The first round loads automatically with a noisy graph, a short instruction, two empty estimate fields, and a session score showing no completed rounds.
2. Read the stated sensor family and input conditions. The challenge is to estimate parameters, not to identify the model order. A first-order round asks for K and tau; a second-order round asks for zeta and omega_n.
3. Inspect the graph with hover, zoom, and Reset view. There are no sliders for the hidden parameters and no live guessed curve before submission.
4. Optionally select **Show hint**. The hint teaches a method without giving the hidden values and has no score penalty.
5. Enter estimates and select **Check my guess**. Invalid input receives a specific message beside the field; it does not reveal the answer or change the score.
6. A valid submission reveals a comparison table and three labeled traces: noisy observations, the student's predicted response, and the clean true response. The table shows estimate, true value, relative error, and whether each estimate is within 10%.
7. The result explains the relevant feature: final level and response speed, sinusoidal amplitude and lag, or overshoot and peak time. Estimate fields and submission become read-only for that round, so the result and score cannot change afterward.
8. **New sensor** starts the next round, clearing the inputs, hint, reveal, and previous graph zoom while preserving session totals. It becomes available after a valid submission. Repeated rounds must not immediately repeat the same response type and exact parameter pair.

Before submission, labels, graph legends, hover text, accessibility descriptions, and status messages must not disclose true parameters or show the clean true curve. Parameters exist in browser memory because this is a local learning exercise; preventing developer-tool inspection is not a requirement.

### Inputs and hints

| Round | Required estimates | Visible conditions | Hint content |
| --- | --- | --- | --- |
| First-order step | K in output units per input unit; tau in seconds | Unit step A = 1; output starts at zero | Estimate K from the final level. Tau is the time to reach 63.2% of that level. Alternatively, the slope of ln(error fraction) is -1/tau. |
| First-order sine | K; tau in seconds | Unit-amplitude input reference and output; angular frequency in rad/s and equivalent Hz; steady-state response | Read output amplitude B and output lag delta_t. Use phi = omega times delta_t, tau = tan(phi)/omega, then K = B sqrt(1 + (omega tau)^2). Phi is in radians. |
| Second-order step | zeta, dimensionless; omega_n in rad/s | Unit step; known DC gain K = 1; zero initial position and velocity | Overshoot determines zeta. With fractional overshoot P, zeta = -ln(P)/sqrt(pi^2 + ln(P)^2). Then omega_n = pi/(t_peak sqrt(1-zeta^2)). |

All inputs must be finite numbers. K, tau, and omega_n must be positive; zeta must be strictly between zero and one. Estimates are not restricted to the narrower random-generation ranges below. Keyboard entry, decimal values, labels, and units must work on phones.

## Sensor generation and numerical behavior

The following are proposed defaults, not prescribed homework values.

| Setting | Proposed value |
| --- | --- |
| Round distribution | 40% first-order step, 20% first-order sine, 40% second-order step |
| First-order K | Uniform over 0.5 to 3.0 |
| First-order tau | Uniform over 0.5 to 3.0 seconds |
| Second-order zeta | Uniform over 0.20 to 0.70 |
| Second-order omega_n | Uniform over 1.0 to 5.0 rad/s |
| Sine angular frequency | Equally likely 0.5, 1.0, or 2.0 rad/s |
| Measurement noise | Independent uniform noise bounded by plus or minus 1% of the clean steady-state output amplitude; final level for steps, sinusoidal amplitude for sine rounds |
| First-order step time axis | Fixed 0 to 24 seconds |
| Second-order step time axis | Fixed 0 to 30 seconds |
| Sine time axis | Four periods, determined only by the stated frequency |
| Sampling | Step spacing at most 0.01 seconds; at least 200 samples per sine period |

Generate the sensor and its noise once per round. Hint, resize, zoom, reset, and validation errors must preserve the same samples. Randomness must be controllable in tests. Score against the true unrounded parameters; display sufficient precision without implying that rounded display values are the scoring reference.

For first-order steps, use y(t) = K(1 - exp(-t/tau)). For first-order sine rounds, use the steady-state output K/sqrt(1 + (omega tau)^2) times sin(omega t - atan(omega tau)). Label this as steady-state so it is not confused with a sinusoid switched on from rest.

For second-order steps, use the normalized model G(s) = omega_n^2 / (s^2 + 2 zeta omega_n s + omega_n^2). Its final output is one. Reuse the existing mechanical model with m = 1, b = 2 zeta omega_n, and k = omega_n^2, then divide its displacement by its own final displacement. This normalization is necessary because Module 3's raw final displacement is 1/k.

The same equations generate the hidden response and the submitted guess. Noise affects only the displayed measurements, never the true curve, guessed curve, or scoring. Render all three curves over the round's original time interval, including guesses outside the generation range. Detect any non-finite derived values before accepting a guess and ask for a representable estimate without scoring that submission.

## Scoring and session rules

For each parameter, relative error is 100 times abs(estimate - true value) / abs(true value). The threshold is inclusive: an error of exactly 10% passes.

Each round has two parameters worth 50 points each. Award 50 points for a parameter within 10%, and zero otherwise. Therefore a round earns 100, 50, or 0 points; full marks require both parameters to pass. This simple partial-credit rule is a proposal, since the assignment defines only the full-marks threshold.

For example, true K = 2.0 and tau = 1.0 with guesses K = 2.1 and tau = 1.2 produce errors of 5% and 20%, earning 50/100. A tau estimate of 1.1 is exactly at the passing boundary.

Show both **this round's score** and **session points out of possible points**, alongside the number of completed rounds. Count each valid submission exactly once, including rapid clicks. Hints, invalid entries, resize, and graph resets never change scores. After reveal, repeat submission is disabled. Reloading the page starts a new session; normal navigation between module anchors preserves it. State this behavior beside the score.

## Integration with the existing toolkit

The reviewed GitHub main revision is `e73ab65a5777c5f049210beda8c3dd9bded83dd6`, which includes Yanal's Module 2 and Saif's Module 3. The local checkout at drafting time is still at `76941a9`. Before implementation, refresh from current main while preserving this PRD and any user changes. [S2-S3]

| File | Planned responsibility |
| --- | --- |
| `index.html` | Add the Module 4 navigation link, section, instructions, fields, graph, hint, results, score, and script loading; update relevant page description and footer text. |
| `js/models/sensor-challenge.js` | New pure challenge generation, noise, response adaptation, input validation, and scoring functions, with controllable randomness for tests. |
| `js/module4.js` | New controller for round state, input handling, rendering, hints, reveal, and session totals. |
| `css/styles.css` | Small scoped additions that reuse the existing responsive cards, controls, and status patterns. |
| `tests/sensor-challenge.test.cjs` | Meaningful tests of generation, equations, noise stability, scoring boundaries, and state transitions. |
| `README.md` | Module 4 instructions, equations, scoring, session behavior, ownership status, validation command, screenshot, and the assignment's required AI-use disclosure. |
| `docs/images/module4-challenge.png` | Screenshot of the completed challenge and reveal for the README. |

Reuse `FirstOrderModel`, `FrequencyResponseModel`, `SecondOrderModel`, and the shared `Plotting` helper. Keep new DOM IDs, radio names, and styles scoped to Module 4. Do not couple challenge state to the sliders or prediction state of Modules 1 to 3. No new framework or plotting dependency is needed.

## Acceptance criteria

| ID | Pass condition |
| --- | --- |
| A1 | Module 4 is reachable from the site navigation and begins with a usable unrevealed round. All three proposed response types are covered with deterministic test cases. |
| A2 | Generated parameters stay within the stated ranges, vary across rounds, and produce finite, correctly scaled responses. Noise stays within its bound and remains unchanged during inspection. |
| A3 | The graph exposes time and output units; sine rounds expose the known reference input and frequency. Hidden parameters and the clean true curve remain absent from the initial user interface. |
| A4 | Step curves agree with independent analytical reference values or an independent differential-equation calculation at representative times, including the slowest and fastest proposed sensors. Second-order asymptotic final output is one; its clean output at 30 seconds is within 0.3% of one across the proposed range. Sine amplitude and phase agree with the stated transfer function. |
| A5 | Estimates at zero error, just below 10%, exactly 10%, and just above 10% receive the correct parameter and total scores. Both incorrect and partially correct submissions show useful feedback. |
| A6 | Blank, nonnumeric, non-finite, nonpositive, invalid-zeta, or numerically unrepresentable estimates neither reveal answers nor change totals. Valid estimates outside generation ranges can still be evaluated. |
| A7 | A valid submission reveals the true values, each error, the score, and visibly distinct noisy, guessed, and true curves. Legends and text identify the curves without relying on color alone. |
| A8 | Each round contributes to the session once. New sensor clears the previous result and inputs, retains totals, and produces a fresh round. Reload resets the session as documented. |
| A9 | Hints match the current response type and do not reveal the answer or alter samples or scores. The estimating method is practical at the parameter-range extremes. |
| A10 | Keyboard users can reach and operate all controls. Validation and results have readable status announcements. At 360-pixel phone width, controls remain usable and graphs fit without page-wide horizontal scrolling. |
| A11 | If Plotly fails to load or render, show a clear graph error and recovery action. Do not accept a scored guess until the current challenge graph is available; recovery preserves its sensor, noise, and score. |
| A12 | Existing numerical suites pass with `node --test tests/*.test.cjs`; a browser check confirms that Modules 1 to 3 controls, plots, and six homework validation displays still work. |

These are requirements for the implementation review, not claims that implementation checks have already passed.

## Deliverables after approval

1. Integrate the challenge into the latest toolkit, including all three response types, hints, scoring, and reveal behavior.
2. Verify the mathematics, scoring boundaries, session transitions, graph recovery, keyboard interaction, and phone layout against the acceptance criteria.
3. Update the README and add the Module 4 screenshot. Verify the assignment's Module 4 GitHub Issue is assigned to Mohammad and that his contribution is represented in the commit history.

The team's final-release checklist also requires a `v1.0` tagged release and the Pages link submitted on the course page. Those are team submission actions, distinct from approving this module's implementation. [S1, p. 3]

Approval of this PRD selects the recommended three response types, two estimates per round, underdamped second-order range, 1% bounded noise, 50 points per passing parameter, no hint penalty, and session reset on reload.

## Sources

- **S1:** ENCS4380 Homework 1, Dynamic Characteristics Interactive Toolkit, released 29 October 2026 by Dr. Wasel Ghanem. Course assignment PDF, pp. 2-4 for Module 4, technical requirements, and rubric; p. 1 for repository organization.
- **S2:** [Toolkit README at the reviewed revision](https://github.com/Mohammad-Sawafta/encs4380-dynamics-Group37/blob/e73ab65a5777c5f049210beda8c3dd9bded83dd6/README.md), for current modules, ownership, equations, and verification commands.
- **S3:** [Toolkit page at the reviewed revision](https://github.com/Mohammad-Sawafta/encs4380-dynamics-Group37/blob/e73ab65a5777c5f049210beda8c3dd9bded83dd6/index.html), for navigation, integration, and script structure.
- **S4:** [Second-order model at the reviewed revision](https://github.com/Mohammad-Sawafta/encs4380-dynamics-Group37/blob/e73ab65a5777c5f049210beda8c3dd9bded83dd6/js/models/second-order.js), for reuse and final-displacement normalization.
