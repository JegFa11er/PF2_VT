# Handoff

## Current milestone — Phase 5.5: Reactions & Reactive Strike

Status: **implemented and verified**.

- 3.2 — typed modifier resolver for circumstance, status, item, and untyped
  modifiers with PF2e non-stacking rules.
- 5.1 — flanking geometry for opposite sides and opposite corners.
- 5.2 — Off-Guard and Frightened conditions, condition badges, and end-of-turn
  Frightened decay.
- 5.4 — Raise a Shield action, `shield-raised` condition (+2 circumstance AC),
  start-of-turn shield reset, action button, badges, and log breakdown.
- 5.5 — reaction budget on `Combatant`, automatic Reactive Strike when a Stride
  leaves a threatened square, Step immunity, reaction diamonds, and reaction
  combat-log entries.
- 4.x — Strike attack and defense values now flow through the central modifier
  resolver; the combat log expands both sides of the equation.

## Implemented

### Headless core (`src/Core/`)

- `Rules/modifiers.js`
  - `MODIFIER_TYPES`: `circumstance`, `status`, `item`, `untyped`.
  - `resolveModifiers(baseValue, modifiers)` → `{ total, breakdown,
    effectiveModifiers, suppressedModifiers, bonusTotal, penaltyTotal }`.
  - Typed bonuses keep the highest; typed penalties keep the worst. A same-type
    bonus and penalty are evaluated separately.
  - Untyped modifiers stack across different sources, but a single source keeps
    only its highest bonus / worst penalty.
  - Invalid types and non-integer values throw.
- `Rules/checks.js`
  - `evaluateCheck({ d20, modifier, dc })` → `{ d20, modifier, total, dc, degree,
    isNatural20, isNatural1 }`.
  - `total >= dc + 10` → `CRITICAL_SUCCESS`; `total >= dc` → `SUCCESS`;
    `total <= dc - 10` → `CRITICAL_FAILURE`; otherwise `FAILURE`.
  - Natural 20 shifts one degree up; natural 1 shifts one degree down; both capped.
- `Rules/map.js`
  - `multipleAttackPenalty(attacksMade, agile)` → `0 / −5 / −10` or `0 / −4 / −8`.
- `Rules/damage.js`
  - Damage formula parsing, dice rolling, clamping, critical doubling helper.
- `Grid/flanking.js`
  - `isFlanked(target, attacker, allies, gridMap)` → boolean.
  - `getFlankingAllies(...)` → opposing able creatures.
  - Requires both creatures to be hostile, not defeated, adjacent, within 5-ft
    reach, and on exactly opposite sides or corners of the target.
  - `gridMap` optional; when supplied, all cells must be in bounds.
- `Entities/conditions.js`
  - `off-guard`: `-2 circumstance` AC.
  - `frightened N`: `-N status` to checks and DCs (attacks and AC in this engine).
  - `shield-raised`: `+2 circumstance` AC until the start of the raiser's next
    turn. It contributes no attack-roll modifier.
  - `createCondition`, `conditionModifiers(condition, scope)`, definitions, and
    defensive copies.
- `Entities/combatant.js`
  - New `conditions` Map plus `addCondition`, `removeCondition`,
    `getCondition`, `hasCondition`, `getConditions`, `getConditionModifiers`.
  - `tickConditions()` / `endTurn()` decrease Frightened by 1 and remove it at 0.
  - `resetTurn(options)` ticks conditions by default; `{ tickConditions: false }`
    is used by Encounter for the incoming combatant.
  - `resetTurn()` unconditionally removes `shield-raised`, including when the
    Frightened tick is suppressed. This models "until the start of your next
    turn" without expiring the shield at the end of the turn it was raised.
  - HP, AC, attack, MAP, and defeat fields retained from Phase 3.
  - `maxReactions` (default 1) and `reactionsRemaining`, with
    `canSpendReaction()` and `spendReaction()` mirroring the action API.
  - `resetTurn()` restores `reactionsRemaining` to `maxReactions` at the start
    of the combatant's own turn.
- `Actions/raise-shield.js`
  - `performRaiseShield({ combatant })` spends 1 action and applies or refreshes
    the `shield-raised` condition.
  - Returns `{ ok: true, actionsLeft, condition }` or
    `{ ok: false, reason: "no-actions" }`.
  - Raising a shield that is already raised still spends an action but does not
    stack the AC bonus.
- `Actions/strike.js`
  - Attack side: `attackBonus` base + attacker conditions with attack scope
    (Frightened) + MAP [untyped].
  - Defense side: base AC + target conditions with AC scope (Off-Guard,
    Frightened, Shield Raised) + Off-Guard from flanking (never doubled).
  - A circumstance bonus and a circumstance penalty of the same type resolve
    independently, so Shield Raised (+2) and Off-Guard (-2) both apply and net
    to 0 while still appearing in the breakdown.
  - `evaluateStrike` reports `flanked`, `flankers`, and `offGuard` without
    spending an action.
  - `performStrike` returns `attackModifiers`, `attackBreakdown`,
    `targetACBase`, final `targetAC`/`dc`, `targetACModifiers`,
    `targetACBreakdown`, `flanked`, `flankers`, and `offGuard`.
  - Damage, critical doubling, HP reduction, and defeat behavior unchanged.
  - Exports `collectAttackModifiers`, `collectDefenseModifiers`, `rollAttack`,
    and `resolveDamageDie` so Reactive Strike shares the exact same pipeline.
- `Actions/reactive-strike.js`
  - `performReactiveStrike({ attacker, target, map, combatants, rollD20,
    rollDamageDie })` spends 1 reaction and resolves a full melee Strike.
  - Uses `Strike.evaluateStrike()` for target/alliance/reach/LoS validation and
    `Modifiers.resolveModifiers()` for both attack and AC.
  - Never applies MAP and never increments `attacksThisTurn`.
  - Fails with `{ ok: false, reason: "no-reaction" }` without spending or
    rolling when the reaction pool is empty.
  - Returns the normal Strike result plus `reaction`, `reactionTrigger`,
    `reactionSpent`, `attackerName`, `targetName`, and `reactionsLeft`.
  - `findThreatenedEnemies({ mover, cell, combatants, reachFeet })` returns the
    ordered living hostiles with a reaction that threaten a cell.
- `Actions/stride.js`
  - Scans the square being left before each route step; the first eligible enemy
    automatically triggers.
  - A failed reaction attempt (for example no line of sight) spends nothing and
    the scan continues with the next enemy.
  - A defeated mover stops on the square it was leaving; `movementInterrupted`,
    `stoppedAt`, `movedPath`, `movedCostFeet`, and `movedDiagonalSteps` report
    the partial movement.
  - `reactions` / `reaction` expose the successful Reactive Strike results for
    logging.
- `Actions/step.js`
  - Still a flat 5-ft move and deliberately never enters the reaction scan. Step
    therefore never provokes Reactive Strike.
- `Encounter/encounter.js`
  - Calls `previous.endTurn()` before advancing, so Frightened decays at the end
    of the correct creature's turn.
  - Incoming combatants reset with `{ tickConditions: false }` to avoid a
    premature tick at the start of an encounter or turn.
  - Defeated skipping and round wrapping unchanged.

### View (`src/View/`, `src/main.js`)

- Token cards and initiative rows show condition badges:
  `Off-Guard`, `Frightened 1`, `Shield Raised`, etc.
- Initiative rows show action circles and reaction diamonds. Token cards use the
  same action/reaction pools; spent reactions render as grey diamonds.
- The selection panel includes `Conditions` and `Reactions` rows.
- The action bar has a `Raise Shield` button that spends 1 action, updates the
  badge immediately, and becomes `Shield Raised ✓` while the condition is
  active. It is disabled only when the active combatant has no actions left, so
  a second raise still spends an action without stacking.
- The combat log reports `Valeros uses Raise a Shield. Actions left: 2.` and adds
  a non-stacking note for a repeat raise.
- Strike hover on a flanked target draws orange corner brackets and a
  `FLANKED (-2 AC)` badge.
- The combat log expands attack and defense modifiers:

```text
Valeros strikes Goblin: d20(13) + 9 (base) - 5 (MAP) = 17 vs AC 13 (16 - 2 Off-Guard [circumstance] - 1 Frightened 1 [status]) -> SUCCESS.
Merisiel strikes Goblin: d20(10) + 8 (base) = 18 vs AC 18 (16 + 2 Shield Raised [circumstance]) -> SUCCESS.
```

- A separate info line reports flanking and the flanking ally.
- End Turn logs Frightened decay, e.g. `Goblin's Frightened decreases 1 -> 0
  (removed).`
- A Stride that leaves a threatened square logs
  `[REACTION] Goblin uses Reactive Strike against Valeros!`, then the standard
  attack/damage breakdown and `Goblin reaction spent · Reactions left: 0/1.`
- A defeat during the reaction logs `Valeros is defeated and stops moving.`
- The authored demo Goblin starts at `Frightened 1` so the badge and log
  breakdown are visible immediately. Raising its shield adds the Shield Raised
  badge and +2 circumstance AC until the start of its next turn. The Goblin is
  adjacent to Merisiel at the start, so striding away immediately demonstrates a
  reactive strike.

### Authored demo stats (`src/main.js`)

| Combatant | HP | AC | Attack | Damage | Agile |
|---|---|---|---|---|---|
| Valeros | 20 | 18 | +9 | 1d8+4 | no |
| Merisiel | 16 | 17 | +8 | 1d6+2 | yes |
| Goblin | 6 | 16 | +8 | 1d6+1 | yes |

The Goblin additionally starts with `Frightened 1`; its base AC remains 16.

## Rules decisions

1. **One resolver for all typed math.** Attack bonuses, AC, and future checks use
   `resolveModifiers`; no localized `if (flanked) ac -= 2` patches.
2. **Same-type modifiers do not stack.** The resolver keeps the highest bonus
   and the worst penalty per type.
3. **Untyped penalties stack across sources.** MAP uses source
   `multiple-attack-penalty`; repeating the same source does not stack.
4. **Off-Guard is the single source of the flanking AC penalty.** Flanking
   injects one `-2 circumstance` modifier; an existing Off-Guard condition is
   detected and not duplicated.
5. **Frightened is a status penalty to checks and DCs.** It therefore applies to
   attack rolls and AC. It decays only at the end of the frightened creature's
   turn.
6. **Flanking is situational.** The target is treated as Off-Guard against the
   flanking attackers' melee attacks; the condition is not permanently added.
7. **Flanking requires ability and reach.** A defeated creature or one more than
   5 ft away cannot complete a flank.
8. **Map is tracked per combatant, per turn.** `attacksThisTurn` counts every
   valid Strike, including misses, and is cleared by `resetTurn()`.
9. **Critical damage doubles the total after modifiers.** `(dice + modifier) × 2`,
   clamped at 0. Dice are rolled once, not twice.
10. **Defeated combatants stay on the board and occupy their square.** They are
    skipped by initiative and cannot be targeted by a new Strike.
11. **The core falls back to `Math.random` when no die callback is supplied.**
    Tests always inject deterministic callbacks.
12. **Shield Raised is a condition, not a shield item.** It injects one
    `+2 circumstance` AC modifier through the condition pipeline, so the
    resolver handles non-stacking and same-type bonus/penalty independence.
13. **A raised shield expires at the start of the raiser's next turn.**
    `Combatant.resetTurn()` removes it unconditionally, even when
    `tickConditions: false`. It is deliberately not cleared by `endTurn()`,
    because it must protect the raiser during other creatures' turns.
14. **Raising an already-raised shield still costs an action.** The condition is
    refreshed, not duplicated; the +2 bonus does not stack.
15. **Reactions are a separate pool.** Reactive Strike spends a reaction, never
    an action. A pool of 0 suppresses the trigger entirely.
16. **Reactive Strike ignores MAP.** No MAP modifier is added and
    `attacksThisTurn` is not incremented, so the attack always uses the full
    base bonus. Frightened and other conditions still apply through the resolver.
17. **Step is reaction-free by design.** Only Stride scans threatened squares;
    Step is the tactical escape from a Reactive Strike.
18. **Auto-trigger is a deliberate prototype simplification.** There is no
    interrupt modal; the first eligible enemy in roster order reacts. A failed
    reaction attempt spends nothing and the remaining enemies are considered.
19. **Defeat interrupts a Stride.** The mover remains on the square it was
    leaving, the action stays spent, and the remainder of the route is discarded.

## Verification

- `npm test` / `node tests/run-node.js`: **199 passed, 0 failed** across 13
  suites.
- `test_runner.html`: **199 passed, 0 failed**, 13 suites, no console errors.
- Browser smoke tests through DOM state:
  - initiative rows and token cards show action circles plus a reaction diamond;
  - the selection panel includes `Actions` and `Reactions` rows;
  - a Stride out of a threatened square logs
    `[REACTION] Goblin uses Reactive Strike against ...!`, then the attack/damage
    breakdown and the spent reaction;
  - a defeating reaction logs `<name> is defeated and stops moving.`;
  - a Step out of the same square leaves the reaction diamond available;
  - the initial combat log explains the reaction rule and Reactive Strike;
  - `test_runner.html` reports 199 passed / 0 failed / 13 suites.

## Known limitations / deliberately deferred

- Dying, Wounded, Unconscious, and recovery checks.
- Persistent damage, precision damage, damage types, resistance, and weakness.
- Cover degrees, concealment, creature size, elevation, and Large-target flank
  arcs.
- Ranged Strikes, thrown weapons, reload, and reach weapons in the UI.
- Other reactions: Detect/Disrupt, Shield Block, ranged Reactive Strikes, and
  non-movement triggers. Free actions are also not implemented.
- Shield Block, shield Hardness/HP, shield items, and multiple shield types.
- Other conditions beyond Off-Guard, Frightened, and Shield Raised.
- Enemy AI; the user controls whichever combatant is active.
- No initiative rolling (values are authored).
- LoS ignores creatures; only solid obstacles block sight.
- Difficult terrain is uniform +5 ft; greater difficult terrain is not modelled.
- Tokens move instantly; no path animation.
- One token selected at a time; no drag-and-drop.

## Next logical slice

**Session 6.1 — Cover System**:

1. Define lesser/standard/greater cover and the AC/Reflex bonuses.
2. Raycast from the attacker's centre to the target's corners against walls.
3. Add `cover` modifiers through the central resolver rather than local AC
   subtraction.
4. Add regression tests for each cover degree, corners, and creatures providing
   lesser cover.

After that: concealment and visibility, then persistent damage.
