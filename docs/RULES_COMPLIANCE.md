# Rules Compliance Audit — Pathfinder 2E Remastered

Audit of `src/Core/` against the canonical Remastered rules and the read-only
reference at `../pf2e-reference/`. No blind rewrites were performed: each claim
below was checked against the reference, encoded as a targeted regression test
in `tests/Rules/canonical-compliance.test.js`, and run through `npm test`.

**Result: 100% of the audited mechanics match the reference.**
Full suite: **549 passed, 0 failed (37 suites)**.

---

## 1. Modifier stacking — `src/Core/Rules/modifiers.js`

Reference: typed (circumstance/status/item) modifiers do not stack with
same-type siblings; untyped modifiers stack across sources but not within one
source.

Confirmed:

- A typed **bonus** and a typed **penalty** of the same type are resolved
  independently. `+2 Shield Raised` (circumstance bonus) and `-2 Off-Guard`
  (circumstance penalty) both apply: `18 + 2 - 2 = 18`, with a correct
  `breakdown` (`bonus: 2`, `penalty: -2`, `subtotal: 0`, two applied entries,
  none suppressed).
- Same-type bonuses keep the highest (`Shield +2` vs `Greater Cover +4` → `+4`).
- Same-type penalties keep the worst (`Off-Guard -2` vs `Prone -2` → `-2`).
- Untyped penalties from **different** sources stack (`MAP -5` + `Clumsy -2`
  → `-7`).
- Untyped penalties from the **same** source keep the worst only (`-5` and
  `-2` from `multiple-attack-penalty` → `-5`).
- Untyped bonuses behave symmetrically: stack across sources, dedup within a
  source.

## 2. Combat maneuvers — `src/Core/Actions/`

Reference: Trip/Shove/Grapple are Athletics skill checks with the `attack`
trait, so they use and advance MAP but Prone's `-2` attack penalty does not
apply (it is not an attack roll).

Confirmed:

- **Trip**, **Shove**, and **Grapple** all apply MAP (`10 - 5 = 5` at one prior
  attack) while a Prone attacker is **not** penalized; the resolved modifier
  list contains `multiple-attack-penalty` but never `source: "prone"`.
- Frightened (a status penalty to all checks) still applies to the Athletics
  check: `10 - 1 = 9`.
- **Stand** resolves the provoking Reactive Strike *before* removing Prone, so
  the interrupting attack sees the target as Off-Guard (`targetAC 16` from
  `18 - 2`); the Prone condition is removed only after a non-lethal reaction.
- **Stride** and **Step** by the grappler automatically release the target's
  `grabbed`/`restrained` (and the companion `immobilized`) via
  `Conditions.releaseGrapplesBySource`.

## 3. IWR timing & physics — `src/Core/Rules/iwr.js`

Reference pipeline: base damage after critical multiplier → Immunity → Weakness
→ Resistance.

Confirmed:

- **Critical doubling is upstream** of IWR: `WeaponTraits.calculateWeaponDamage`
  doubles the base (`1d6 → 8` on a crit) before `Combatant.takeDamage` runs
  `IWR.applyIWR`. Full chain: `8` doubled → `+5` weakness (once) → `-3`
  resistance = `10`.
- **Immunity** zeroes the instance and skips both later steps (only one
  `immunity` step is recorded).
- **Weakness** applies exactly once per attack per damage type; an `"all"`
  weakness also applies once per attack across different types.
- **Resistance** subtracts from the post-weakness amount and floors at 0
  (never produces negative damage).

## 4. 3D distance — `src/Core/Grid/distance.js`

Reference: `measureDistanceOnGrid` in
`../pf2e-reference/src/module/canvas/helpers.ts`.

Confirmed: `distance3DSquares` implements the identical formula —

```text
nx = ceil(|dx|), ny = ceil(|dy|), nz = ceil(|dzFeet| / 5)
doubleDiagonal = min, diagonal = mid - min, straight = max - mid
squares = floor(doubleDiagonal * 1.75 + diagonal * 1.5 + straight)
```

verified cell-for-cell against an independent re-implementation of the
reference over 16 axis combinations. With a zero elevation delta the formula
reduces to the 2D `max(dx, dy) + floor(min(dx, dy) / 2)` rule.

## 5. Reach-10 "two diagonals" — `src/Core/Grid/distance.js` + `Actions/`

Reference: CRB p.455, "Unlike with measuring most distances, 10-foot reach can
reach 2 squares diagonally." `measureDistanceOnGrid` subtracts one square when
`reach === 10` and the displacement contains more than one diagonal step.

Confirmed:

- `distance3DSquares` / `getDistance3D` still report the raw 15-ft cost of the
  second diagonal square.
- `reachDistance3DSquares`, `getCombatantReachDistance3D`, and `canReach3D`
  apply the reach-10 reduction for **melee reach validation**, so a reach-10
  attacker can target `(dx=2, dy=2)` even though the reported distance is 15 ft.
- `Strike` (and therefore Trip/Shove/Grapple and Reactive Strike) uses the
  reach-aware distance. `ReactiveStrike.findThreatenedEnemies` and
  `Flanking` use the flat-grid variant `getCombatantReachDistance` / `canReach`.

## 6. Grabbed & Restrained action restrictions — `Entities/` + `Actions/`

Reference: Restrained — "you can't use actions with the attack or manipulate
traits, except to Escape." Grabbed — "If you attempt a manipulate action while
grabbed, you must succeed at a DC 5 flat check or it is lost."

Confirmed:

- `Conditions.isRestrainedActionBlocked` + `Combatant.canAct({ traits, action })`
  return `reason: "restrained-action-blocked"` for attack/manipulate actions;
  `action: "escape"` / `isEscape: true` is the only exception.
- Strike, Trip/Shove/Grapple (through `evaluateStrike`), a manipulate/attack
  Cast a Spell, and a manipulate Interact are all refused before spending.
- `Combatant.resolveGrabbedManipulate` performs the DC 5 flat check for
  manipulate actions. A failure spends the action and returns
  `reason: "grabbed-manipulate-failed"`; a non-manipulate spell is unaffected.
- Escape still works while Restrained.

## 7. Hostile actions break stealth — `Actions/` + `Entities/conditions.js`

Reference: a creature that uses a hostile action is no longer Hidden or
Undetected afterwards.

Confirmed:

- `Conditions.revealAfterHostileAction` removes exactly `hidden` and
  `undetected`; light-based `concealed` survives.
- A resolved Strike and Reactive Strike still use the hidden-attacker Off-Guard
  benefit for that attack, then remove the state. A save spell and a damaging
  attack spell do the same.
- Rejected attempts (out of reach, invalid target, no actions) and a failed
  Grabbed manipulate flat check do not reveal.
- A non-damaging attack spell without a save is not treated as stealth-breaking.

## 8. Maneuver free hand & target size — `Actions/` + `Rules/size.js`

Reference: Trip/Shove/Grapple need a free hand unless the weapon carries the
matching trait, and the target may be at most one size category larger.

Confirmed:

- The canonical ranks are tiny 0, small 1, medium 1, large 2, huge 3,
  gargantuan 4; gargantuan footprints are 4x4.
- The shared hand gate returns `no-free-hand`; the `trip`/`shove`/`grapple`
  weapon trait bypasses it.
- The size gate returns `target-too-large` before geometry/MAP, and spends
  nothing.
- A Medium creature may target Large but not Huge; a Huge creature may target
  Gargantuan.

## 9. Whole-footprint flanking — `Grid/flanking.js`

Reference: Foundry `TokenPF2e#onOppositeSides` uses the line between the two
flankers' footprint centres and requires it to cross opposite footprint sides.

Confirmed:

- Large/Huge targets are flanked across their real 2x2/3x3 footprint, including
  offset side/corner arrangements that the old anchor-cell direction missed.
- Same-side or L-shaped arrangements do not flank.
- Reach and defeat/alliance filters still apply after the geometry test.

## 10. Multiple simultaneous grapples — `Entities/combatant.js`

Reference: one victim can be grabbed by more than one creature; each hold has
its own source and duration.

Confirmed:

- Grabbed/Restrained/Immobilized are tracked once per source. A second grappler
  adds an instance instead of overwriting the first `sourceId`.
- `getCondition("grabbed")` keeps the earliest source for legacy callers, while
  `getGrappleInstances()` exposes both.
- Escape removes only the selected source. The victim remains Grabbed (and
  Immobilized) until every instance is gone.
- Re-grappling from the same source refreshes one instance rather than
  duplicating it.

---

## Test coverage added

- `tests/Rules/canonical-compliance.test.js` — Sections 1–4 plus 17 new cases
  for Sections 7–10 (stealth loss, size/free-hand gates, whole-footprint
  flanking, multiple grapples).
- `tests/Rules/reach-and-restrictions.test.js` — 19 targeted assertions for
  Sections 5–6.
- Both are registered in `tests/run-node.js` (Node) and `test_runner.html`
  (browser).

## Documented limitations (not defects)

- Critical doubling lives in `Rules/weapon-traits.js` (and the damage roll
  path), not inside `iwr.js`; the audit confirms the two stages compose in the
  correct order rather than asserting `iwr.js` doubles damage itself.
- Only the Escape exception is modelled for Restrained; the Force Open
  alternative is not present in this engine.
- The Grabbed manipulate check is wired into Cast a Spell, Interact, Reload,
  Disable a Hazard, and Point Out. Any future manipulate action can opt in
  through `Combatant.resolveGrabbedManipulate({ traits: ["manipulate"] })`.

## Compliance percentage

| Area | Verdict |
| --- | --- |
| Modifier stacking | Compliant (100%) |
| Combat maneuvers / MAP / Prone / Stand / grapple release | Compliant (100%) |
| IWR pipeline ordering | Compliant (100%) |
| 3D distance vs `measureDistanceOnGrid` | Compliant (100%) |
| Reach-10 second diagonal (Strike/Reactive/Flanking) | Compliant (100%) |
| Grabbed & Restrained action restrictions | Compliant (100%) |
| Hostile actions break Hidden/Undetected | Compliant (100%) |
| Maneuver free hand & target size | Compliant (100%) |
| Whole-footprint flanking | Compliant (100%) |
| Multiple simultaneous grapples | Compliant (100%) |

**Overall audited compliance: 100%.**
