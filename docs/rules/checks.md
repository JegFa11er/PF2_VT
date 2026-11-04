# d20 Checks & Degrees of Success — PF2e Remastered

## Implemented baseline

`src/Core/Rules/checks.js` implements the Remastered check pipeline as pure,
deterministic business logic. The caller supplies the d20 result; the module owns
only the arithmetic and degree classification.

```js
const result = Checks.evaluateCheck({ d20: 12, modifier: 9, dc: 16 });
// {
//   d20: 12,
//   modifier: 9,
//   total: 21,
//   dc: 16,
//   degree: "SUCCESS",
//   isNatural20: false,
//   isNatural1: false
// }
```

## Degree thresholds

| Condition | Degree |
|---|---|
| `total >= dc + 10` | `CRITICAL_SUCCESS` |
| `total >= dc` | `SUCCESS` |
| `total <= dc - 10` | `CRITICAL_FAILURE` |
| otherwise | `FAILURE` |

`total = d20 + modifier`. The ±10 comparison uses the total, never the raw d20.

## Natural 20 / natural 1

- A natural 20 increases the degree by one step, capped at `CRITICAL_SUCCESS`.
- A natural 1 decreases the degree by one step, capped at `CRITICAL_FAILURE`.
- The adjustment happens **after** the total-based classification.
- A natural 20 can turn a failure into a success and a success into a critical
  success. A natural 1 can turn a success into a failure and a failure into a
  critical failure.

The returned report exposes `isNatural20` and `isNatural1` so the View can log the
shift explicitly.

## API

- `evaluateCheck({ d20, modifier, dc })` — validated, deterministic result.
- `classifyTotal(total, dc)` — base degree before natural adjustment.
- `shiftDegree(degree, steps)` — clamped degree movement.
- `DEGREES` — frozen enum with the four Remastered strings.
- `DEGREE_ORDER` — `CRITICAL_FAILURE → FAILURE → SUCCESS → CRITICAL_SUCCESS`.

Invalid input throws:

- `d20` must be an integer from 1 to 20;
- `modifier` and `dc` must be integers.

## Used by

- `src/Core/Actions/strike.js` — attack rolls against resolved AC.
- `src/Core/Rules/modifiers.js` — produces the modifier passed to `evaluateCheck`.
- `src/main.js` — combat log formatting, including modifier breakdowns and
  natural 20/1 shift notes.

## Explicitly deferred

- Fortune/misfortune, rerolls, and degree adjustments from feats or spells.
- Secret checks and GM-facing roll visibility.
- Skill actions and non-combat DC tables.
