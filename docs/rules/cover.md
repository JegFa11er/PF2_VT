# Cover & Take Cover — PF2e Remastered

## Canonical cover algorithm

`src/Core/Grid/cover.js` implements cover as pure geometry. It does not mutate
combatants and does not apply AC itself; Strike injects the result through the
central modifier resolver.

1. Take the four grid-vertex corners of the attacker's square.
2. For each attacker corner, draw four rays to the four corners of the target's
   square.
3. A ray is **wall-blocked** when it crosses the interior of a solid obstacle.
   Rays that only run along a wall edge or touch a wall corner are not blocked.
4. The attacker uses the corner with the fewest wall-blocked rays.
5. Count the blocked rays:

| Wall-blocked rays | Degree | AC bonus |
|---|---|---|
| 0 | none, or lesser from a creature | 0 / +1 |
| 1–2 | standard | +2 circumstance |
| 3 | greater | +4 circumstance |
| 4 | no line of sight | — |

6. If no ray is wall-blocked but at least one ray crosses the cell of another
   able creature (ally or enemy, excluding the attacker and target), the target
   has **lesser cover**: +1 circumstance AC.
7. Defeated creatures do not provide creature cover.

## API

```js
const Cover = PF2e.Core.Cover;

const result = Cover.determineCover(attacker, target, gridMap, combatants);
```

`combatants` is optional and is only used for creature-provided lesser cover.

Result contract:

```js
{
  degree: "none" | "lesser" | "standard" | "greater",
  acBonus: 0 | 1 | 2 | 4,
  label: "No Cover" | "Lesser Cover" | "Standard Cover" | "Greater Cover",
  bestCorner: { x, y },
  attackerCorner: { x, y },
  targetCorners: [{ x, y }, ...],
  rays: [{
    from: { x, y },
    to: { x, y },
    blocked: boolean,
    blockedBy: { x, y } | null,
    creatureBlocked: boolean,
    creatureBlockedBy: { id, name, cell } | null
  }],
  blockedRaysCount: number,
  creatureCover: boolean,
  creatureCoverCells: [{ x, y }],
  lineOfSight: boolean,       // false only for 4 blocked rays
  noLineOfSight: boolean
}
```

Helpers:

- `Cover.coverModifier(cover)` → `{ name, type: "circumstance", value,
  source: "cover" }` or `null`.
- `Cover.coverReflexModifier(cover)` → `+2/+4 circumstance` for standard/greater
  cover, `null` for lesser/none. Used by Reflex saves and Reflex DC.
- `Cover.getBestCover(defender, combatants, gridMap)` → best result against a
  living hostile, used by the Take Cover button.
- `Cover.isStandardOrGreater(cover)` → requirement test for Take Cover.
- `Cover.segmentIntersectsCellInterior(from, to, cell)` → strict interior test.

## Reflex saves and Reflex DC

Standard cover grants `+2 circumstance` and greater cover `+4 circumstance` to
Reflex saves and to the corresponding Reflex DC. Lesser cover is AC-only. The
bonus is collected by `Combatant.getSaveModifiers("reflex", { cover })` and
`Combatant.getDCModifiers("reflex", { cover })`, so cover never stacks with
another circumstance bonus of the same type.

## Strike integration

Strike and Reactive Strike call `determineCover(attacker, target, map, allies)`
during validation.

- `evaluateStrike()` rejects a target when `cover.noLineOfSight === true`
  (`no-line-of-sight`) and reports `cover`, `coverDegree`, `coverBonus`, and
  `coverRays`.
- `performStrike()` / `performReactiveStrike()` append a single
  `{ name: "Standard Cover", type: "circumstance", value: 2, source: "cover" }`
  (or lesser/greater) to the target's AC modifiers.
- The result adds `cover`, `coverDegree`, `coverBonus`, `coverRays`,
  `blockedRaysCount`, and `suppressedACModifiers`.

Because cover is a **circumstance** bonus, it participates in normal PF2e
non-stacking:

| Target state | Effective AC bonus |
|---|---|
| Shield Raised (+2) only | +2 |
| Standard Cover (+2) only | +2 |
| Shield Raised + Standard Cover | **+2** (one suppressed) |
| Shield Raised + Greater Cover | **+4** (shield suppressed) |
| Shield Raised + Take Cover greater cover | **+4** (shield suppressed) |

`targetACModifiers` contains only the applied modifiers; the losing same-type
modifiers appear in `suppressedACModifiers` and in the per-type breakdown, so
the View can show them explicitly.

## Take Cover action

`src/Core/Actions/take-cover.js` implements the 1-action Take Cover.

Requirements and effect:

- costs **1 action**;
- the creature must already have **standard cover or better** from a living
  hostile (or pass an explicit `attacker`);
- applies the `greater-cover` condition: **+4 circumstance AC**;
- lasts until the start of the creature's next turn or its next Stride/Step.

```js
const result = TakeCover.performTakeCover({
  combatant,
  map,
  combatants,
  // optional explicit attacker:
  // attacker: goblin,
});
```

Result:

```js
{
  ok: true,
  actionsLeft,
  condition,          // { name: "greater-cover", label: "Greater Cover", value: null }
  cover,              // the standard/greater geometry result
  coverDegree: "greater",
  acBonus: 4,
  requiredCover: "standard" | "greater"
}
{ ok: false, reason: "no-actions" | "insufficient-cover", cover? }
```

`Combatant.resetTurn()` removes `greater-cover` together with `shield-raised`.
A successful `Stride` or `Step` also removes it immediately, even if the Stride
was interrupted by a Reactive Strike.

## View behaviour

- Strike hover shows the target's cover badge:
  `LESSER COVER (+1 AC)`, `STANDARD COVER (+2 AC)`, or
  `GREATER COVER (+4 AC)`.
- The canonical cover rays are drawn from the best attacker corner to the four
  target corners (teal = clear, amber = creature-blocked, red = wall-blocked).
- The Actions panel has a **Take Cover** button. It is enabled only when the
  active combatant has standard cover or better and still has an action.
- The combat log expands cover and marks suppressed circumstance bonuses:

```text
Valeros strikes Goblin: d20(12) + 9 (base) = 21 vs AC 20 (16 + 2 Shield Raised [circumstance] + 2 Standard Cover [circumstance · suppressed]) -> SUCCESS.
```

## Acceptance tests

`tests/Grid/cover.test.js`:

- open battlefield → none, 0 blocked rays;
- wall between two combatants → standard, 2 blocked rays;
- three corner rays blocked → greater, +4;
- intervening able creature → lesser, +1;
- defeated creature → no cover;
- full wall → 4 blocked rays, `lineOfSight === false`;
- edge-only rays do not count as wall blocking;
- modifier contract and invalid input.

`tests/Actions/take-cover.test.js`:

- success behind standard cover, +4 circumstance AC, 1 action;
- refusal on open ground and for lesser-only cover;
- no action without an action pool;
- `resetTurn()` expiry;
- Step expiry;
- action-pool validation.

`tests/Actions/strike.test.js` adds:

- lesser cover from a creature applies +1 AC;
- Shield Raised + Standard Cover = +2 net, not +4;
- Shield Raised + Greater Cover = +4 net, with shield and geometric cover
  suppressed.

## Explicitly deferred

- Ranged-specific cover interactions and ranged Strikes in the UI.
- Cover from held items or tower shields.
- Reflex bonuses from Take Cover's `greater-cover` condition (geometric cover
  does feed Reflex saves and Reflex DC; the condition currently remains AC-only).
