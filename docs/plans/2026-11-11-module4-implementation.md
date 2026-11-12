# Module 4 Implementation Plan

**Goal:** Implement the approved Guess the Sensor challenge locally and prepare it for Mohammad's review.

**Architecture:** Add a pure challenge model around the three existing numerical models, a self-contained controller, and a fourth section of the existing static page. The session owns one frozen noisy round and accepts at most one scored submission per round. The controller gates submission on graph readiness and reveals answers only after valid submission.

**Tech Stack:** Plain HTML, CSS, browser JavaScript, existing Plotly 4.1.1, Node numerical tests, and browser interaction checks.

**Authorization:** Local implementation was approved on 11 November 2026. Mohammad approved committing and pushing the completed work on 12 November 2026, with Module 2 unchanged. Creating Issues, tagging a release, and changing the original Drive checkout are separate tasks.

## Task 1 Establish the local baseline

1. Clone the repository under `Interface/local/encs4380-dynamics-Group37`.
2. Create `feature/module4-guess-the-sensor` and fast-forward against `origin/main`.
3. Copy the approved PRD into this clone and record its approval status.
4. Run `node --test tests/*.test.cjs` to establish the existing numerical baseline.

## Task 2 Challenge mathematics and session state

**Files:** Create `js/models/sensor-challenge.js` and `tests/sensor-challenge.test.cjs`.

1. Write deterministic tests for all three response variants, noise bounds, reference equations, and parameter extremes; run the test file and confirm it fails before the model exists.
2. Implement `SensorChallenge.createRound({random, previous})`, `response(round, values)`, `validateGuess(round, raw)`, and `score(round, values)` using the existing numerical models.
3. Implement `createSession(random)` with `round`, `result`, and `totals` getters plus `submit(raw)` and `next()`. A duplicate valid submission returns the existing result without adding points. A failed submission leaves the round unrevealed.
4. Check exact 10% boundaries in both directions and 0/50/100 round scores, including the PRD's K=2, tau=1 example.
5. Run `node --test tests/sensor-challenge.test.cjs`. Correct numerical or state failures before integration.

## Task 3 Markup and responsive interface

**Files:** Edit `index.html` and `css/styles.css`.

1. Add `#module4` navigation and load the challenge model and controller after their dependencies.
2. Add a two-field estimate form, noisy graph, hint, session score, per-field errors, graph recovery, result table, and new-round action. Prefix all new control IDs with `challenge-`.
3. Reuse existing typography, colors, controls, and workspace layout. Scope new styles to the challenge and provide one-column phone layout with visible focus and readable results.
4. Preserve existing Modules 1 to 3 content and controls.

## Task 4 Controller and graph lifecycle

**File:** Create `js/module4.js`.

1. Initialize one session and map its current kind to visible field labels, input conditions, and teaching hints.
2. Render only observations and the known sine input before submission. Use separate line styles and labels for the true and guessed curves after submission.
3. On submit, reject while the graph is unavailable or rendering; pass raw field text into model validation, show specific accessible errors, and update totals once.
4. Lock submitted fields, announce the result, and make New sensor available. Next round clears reveal state and restores the original view while retaining totals.
5. Retry failed graph loading/rendering without generating another sensor or clearing scores. Protect asynchronous renders against stale results.

## Task 5 Verification and independent review

1. Run `node --test tests/*.test.cjs` and syntax-check the new scripts.
2. Exercise the actual page in a browser for all three kinds: initial hidden state, hints, invalid entry, scoring, reveal, duplicate submission, new round, anchor navigation, reload, zoom/reset, and graph recovery.
3. Check 360-pixel and desktop widths, keyboard input/focus, labels/status announcements, and the existing module controls and six validation displays.
4. Have an independent reviewer inspect the final diff and correct actionable defects.

## Task 6 Documentation and local handoff

**Files:** Update `README.md`; add `docs/images/module4-challenge.png`.

1. Document the three round types, ranges, noise, equations, scoring, session behavior, and verified checks. Update Module 4 ownership status without adding assistant authorship.
2. Capture an actual completed-round screenshot for the README.
3. Inspect `git diff --check` and `git status --short`. Confirm the original Drive checkout is unchanged and the publication contains only the reviewed Module 4 work.
4. Provide the local preview, verification results, and any remaining limitations for review. This review was completed, and Mohammad approved committing and pushing on 12 November 2026 with Module 2 unchanged.
