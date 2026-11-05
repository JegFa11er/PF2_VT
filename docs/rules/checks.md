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

## Flat checks

A flat check is a d20 with **no modifiers** against a fixed DC. It is used by
Concealment/Hidden and by the persistent-damage recovery check:

```js
Checks.evaluateFlatCheck({ d20: 10, dc: 11 });
// { passed: false, d20: 10, dc: 11 }
```

The boundary is inclusive: `d20 >= dc` passes. Concealed uses DC 5, Hidden
uses DC 11, and the persistent-damage recovery check uses **DC 15**. The caller
may instead inject a deterministic `rollD20()` (or the shared `rollDie(sides)`);
otherwise the core falls back to `Math.random`. `evaluateFlatCheck` does not
implement natural-20/1 degree shifts. The persistent-damage recovery check has no
critical-failure penalty: it is a strict binary pass/fail.

## Defended DCs

A defending creature's DC is:

```text
DC = 10 + base saving throw or skill modifier + situational modifiers
```

`calculateDC(baseValue, modifiers)` applies that formula. The modifiers flow
through `Modifiers.resolveModifiers`, so Frightened (status) and cover
(circumstance) keep the same non-stacking rules as attack rolls:

```js
Checks.calculateDC(8, []); // 18
Checks.calculateDC(8, [
  { name: "Frightened 1", type: "status", value: -1 },
]); // 17
Checks.calculateDC(8, [
  { name: "Frightened 1", type: "status", value: -1 },
  { name: "Standard Cover", type: "circumstance", value: 2 },
]); // 19
```

`resolveDC(baseValue, modifiers)` returns the full resolver audit
(`total`, `effectiveModifiers`, `suppressedModifiers`, `breakdown`) for logs.

The matching modifiers come from `Combatant`:

- `getSkillModifiers(skillName)` — Frightened and skill-scope modifiers.
  Attack-roll modifiers such as Prone deliberately do not apply to skill checks,
  including Attack-trait actions such as Trip;
- `getSaveModifiers(saveName, { cover? })` — Frightened plus cover for Reflex;
- `getDCModifiers(dcName, { cover? })` — Frightened plus cover for Reflex DC.

Standard cover gives +2 circumstance and greater cover +4 to Reflex saves and
Reflex DC. Lesser cover is AC-only. See `docs/rules/maneuvers.md`.

## API

- `evaluateCheck({ d20, modifier, dc })` — validated, deterministic result.
- `evaluateFlatCheck({ d20?, dc, rollD20?, rollDie? })` — pure flat check with
  no modifiers; supports deterministic callbacks.
- `calculateDC(baseValue, modifiers)` — `10 + base + resolved modifiers`.
- `resolveDC(baseValue, modifiers)` — full DC audit.
- `classifyTotal(total, dc)` — base degree before natural adjustment.
- `shiftDegree(degree, steps)` — clamped degree movement.
- `DEGREES` — frozen enum with the four Remastered strings.
- `DEGREE_ORDER` — `CRITICAL_FAILURE → FAILURE → SUCCESS → CRITICAL_SUCCESS`.

`checks.js` loads after `modifiers.js` in both the app and the test runner
because `calculateDC` reuses the central resolver.

Invalid input throws:

- `d20` must be an integer from 1 to 20;
- `modifier` and `dc` must be integers;
- flat-check `d20` must also be an integer from 1 to 20 and `dc` an integer.

## Used by

- `src/Core/Actions/strike.js` — attack rolls against resolved AC, plus the
  visibility flat check before the attack roll.
- `src/Core/Actions/reactive-strike.js` - the same visibility flat check.
- `src/Core/Actions/trip.js` — Athletics check against a resolved Reflex DC.
- `src/Core/Entities/persistent-damage.js` - the DC 15 recovery check after the
  end-of-turn damage roll.
- `src/Core/Rules/modifiers.js` — produces the modifier passed to `evaluateCheck`.
- `src/main.js` — combat log formatting, including modifier breakdowns and
  natural 20/1 shift notes.

## Explicitly deferred

- Fortune/misfortune, rerolls, and degree adjustments from feats or spells.
- Secret checks and GM-facing roll visibility.
- Skill actions and non-combat DC tables.
