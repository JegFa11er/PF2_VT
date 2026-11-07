# Strike, MAP, Damage & HP — PF2e Remastered

## Implemented baseline

`src/Core/Actions/strike.js` implements a single melee Strike with attack
resolution, Multiple Attack Penalty, damage, and HP tracking.

Rules used:

1. Strike costs **1 action**.
2. Melee reach is **5 ft** by default (adjacent orthogonal or diagonal cell).
   A weapon with the `reach` trait uses **10 ft**. `reachFeet` can still be
   overridden per Strike for special effects.
3. The target must be a **living hostile**. Defeated targets and allies are rejected.
4. The target must be visible via **line of sight**. For multi-cell (Large/Huge/
   Gargantuan) creatures line of sight is traced edge-to-edge across every pair
   of occupied cells, so a clear edge counts even when the anchor (top-left)
   cell is blocked.
5. The attack check is `d20 + resolved attack modifier` against the target's
   resolved AC. Attack and defense values both flow through
   `src/Core/Rules/modifiers.js` (base attack bonus + Frightened [status] +
   MAP [untyped]; target AC + Off-Guard [circumstance] + Frightened [status] +
   Shield Raised / Greater Cover / geometric cover [circumstance]).
   Degrees of success follow `src/Core/Rules/checks.js` (±10 thresholds,
   natural 20/1 degree shifts).
6. Cover is evaluated by `src/Core/Grid/cover.js` before the roll. Standard
   cover adds +2 circumstance AC, greater cover +4, and lesser cover +1.
   Four blocked cover rays mean no line of sight. Circumstance bonuses do not
   stack, so cover is compared with Shield Raised and Take Cover by the
   resolver.
7. Visibility is resolved before the attack roll. A **Concealed** target needs
   a DC 5 flat check, a **Hidden** target DC 11, and an **Undetected** target
   cannot be selected at all (`target-undetected`). A failed flat check spends
   the action and advances MAP but produces no attack roll and no damage. See
   `docs/rules/visibility.md`.
8. The target's `targetACModifiers` contains the applied modifiers only.
   Losing same-type bonuses are reported in `suppressedACModifiers` so the
   combat log can display them.
9. A **success** deals the weapon's damage once. A **critical success** doubles the
   total damage `(dice + modifier)` and applies the weapon traits described below.
   Failure and critical failure deal no damage.
10. The weapon's damage is typed: `{ formula: "1d8+4", type: "slashing" }`
    (a plain formula string remains valid and is treated as `untyped`).
11. After the critical multiplier, damage is applied through
    `target.takeDamage(amount, { type })`, which runs the canonical
    **Immunity -> Weakness -> Resistance** pipeline. HP floors at 0 and the
    target's `isDefeated` flag becomes `true`. See `docs/rules/iwr.md`.
12. Every valid Strike increments `attacker.attacksThisTurn`, even on a miss or
    a failed visibility flat check. `resetTurn()` clears it.
13. The action, MAP increment, and dice are consumed only after validation passes.
    An invalid d20 callback throws before any state mutation.

## Multiple Attack Penalty

`src/Core/Rules/map.js` and `Combatant.getMultipleAttackPenalty()` implement:

| Attack this turn | Normal | Agile |
|---|---|---|
| 1st (`attacksThisTurn = 0`) | 0 | 0 |
| 2nd (`attacksThisTurn = 1`) | −5 | −4 |
| 3rd+ (`attacksThisTurn >= 2`) | −10 | −8 |

The penalty is applied to the attack check and reported in the Strike result.

## Reactive Strike (reaction)

`src/Core/Actions/reactive-strike.js` implements the PF2e Remastered Reactive
Strike (formerly Attack of Opportunity).

Rules used:

1. It costs **1 reaction**, never an action. The reactor must have
   `canSpendReaction() === true`; otherwise the result is
   `{ ok: false, reason: "no-reaction" }` and nothing is spent.
2. It is a melee Strike: the target must be a living hostile within reach with
   line of sight. Validation reuses `Strike.evaluateStrike()`.
3. It **does not use and does not increase MAP**. The attack is resolved at the
   full base attack bonus, and `attacker.attacksThisTurn` is left unchanged.
4. Attack and defense use the same modifier collection and
   `Modifiers.resolveModifiers()` pipeline as a normal Strike: attacker
   conditions on the attack side, target conditions plus flanking on the AC
   side. Concealment/Hidden flat checks also use the shared visibility helper.
   A failed flat check spends the reaction but never uses or advances MAP.
5. `Stride` scans the square being left before each step. The first eligible
   enemy with a reaction triggers automatically. An enemy with no reaction left
   is skipped, and the same enemy cannot trigger twice in one Stride.
6. `Step` never triggers a Reactive Strike.
7. If the mover is defeated by the reaction, its Stride stops immediately on the
   square it was leaving.

Direct use:

```js
ReactiveStrike.performReactiveStrike({
  attacker: goblin,
  target: valeros,
  map,
  combatants,
  rollD20: () => 14,
  rollDamageDie: (sides) => 3,
});
```

`findThreatenedEnemies({ mover, cell, combatants, reachFeet })` returns the
ordered list of living hostile creatures that threaten `cell` and still have a
reaction. Stride uses it for the automatic trigger.

The Reactive Strike result reuses the Strike result shape and adds
`reaction: true`, `reactionTrigger: "leave-threatened-square"`,
`reactionSpent`, `attackerName`, `targetName`, and `reactionsLeft`.
`mapPenalty` and `multipleAttackPenalty` are always `0`.

## Modifiers, conditions, and flanking

The Strike collects typed modifiers before rolling:

| Side | Base | Modifiers |
|---|---|---|
| Attack | `attacker.attackBonus` | Frightened [status], MAP [untyped] |
| Defense | `target.ac` / `options.targetAC` | Off-Guard [circumstance], Frightened [status], Shield Raised [circumstance], Greater Cover [circumstance], geometric cover [circumstance], flanking Off-Guard, Hidden/Undetected Attacker Off-Guard |

Pass `allies` (or `combatants`) to detect flanking and creature-provided lesser
cover. When the target is flanked, it is treated as Off-Guard (`-2 circumstance
AC`) against this attack. If the target already has the Off-Guard condition, the
penalty is not applied twice.

Same-type modifiers follow the PF2e non-stacking rules; untyped modifiers stack
unless they share a source. See `docs/rules/conditions.md` for the full model.

## Damage formulas and types

`src/Core/Rules/damage.js` supports one dice term plus an optional flat modifier:

- `1d8+4`
- `2d6`
- `1d6-1`
- a flat integer such as `3`

The typed contract adds a damage type:

```js
damage: { formula: "1d8+4", type: "slashing" }
```

A plain string is still accepted and resolves as `untyped`. Per-Strike
`damage`/`damageType` overrides use the same parser.

Critical damage doubles the total after adding the modifier. Damage is clamped at
0, never negative. IWR is applied **after** this multiplier:
`(dice + modifier) × 2 -> Immunity -> Weakness -> Resistance`. See
`docs/rules/iwr.md`.

## Weapon traits

`src/Core/Rules/weapon-traits.js` resolves `reach`, `backstabber`, `deadly dN`,
and `fatal dN`. Both Strike and Reactive Strike use the same calculator.

- **Reach**: `Combatant.getReachFeet()` returns 10 ft; Strike validation,
  threatened squares, and flanking all use the creature's own reach.
- **Backstabber**: `+1` against an Off-Guard target, included in the doubled
  base on a critical hit (`+2` before the multiplier).
- **Deadly**: on a critical success add one non-doubled die of the listed size.
- **Fatal**: on a critical success replace the base die, double the replaced
  base damage, then add one non-doubled fatal die.

The damage result exposes `fatal`, `deadly`, `backstabber`, `doubledBase`,
`extras`, and the final `total`. See `docs/rules/weapon-traits.md`.

## Result contract

```js
{
  ok: true,
  attackerId,
  targetId,
  distanceFeet,
  reachFeet,
  flatCheck: { passed, dc, roll, condition } | null,
  visibility,          // { condition, label, flatCheckDC, targetable, undetected }
  hiddenAttacker,      // true when the attacker is Hidden or Undetected
  automaticMiss,       // true on a failed visibility flat check
  attackRoll,          // d20, or null after a failed flat check
  attackBonus,         // base attack bonus
  baseAttackBonus,
  attackModifier,      // base + effective attack modifiers
  attackModifiers,     // [{ name, type, value, source }]
  attackBreakdown,     // per-type applied/suppressed audit
  mapPenalty,
  total,
  dc,                  // final resolved AC
  targetAC,            // final resolved AC
  targetACBase,        // AC before conditions/flanking
  baseTargetAC,
  targetACModifiers,
  targetACSuppressedModifiers,
  suppressedACModifiers,
  targetACBreakdown,
  cover,               // determineCover() result or null
  coverDegree,         // none | lesser | standard | greater
  coverBonus,          // 0 | 1 | 2 | 4
  coverRays,
  blockedRaysCount,
  flanked,
  flankers,            // [{ id, name }]
  offGuard,
  degree,              // CRITICAL_SUCCESS | SUCCESS | FAILURE | CRITICAL_FAILURE
  isNatural20,
  isNatural1,
  hit,
  critical,
  attack: {
    d20, attackBonus, baseAttackBonus, mapPenalty,
    attackModifier, modifiers, breakdown, modifier, total, dc,
    degree, isNatural20, isNatural1
  },
  damage: {
    formula, type, diceCount, dieSize, modifier, rolls,
    diceTotal, baseTotal, doubled, multiplier, total,
    // weapon traits (Phase 7.3)
    effectiveFormula, traits, traitSlugs, backstabber, doubledBase,
    fatal: { dieSize, originalDieSize, replaced, extraRoll, extraTotal } | null,
    deadly: { dieSize, roll, total } | null,
    extras: [{ kind, dieSize, roll, total, doubled: false }]
  } | null,
  iwr,                 // applyIWR() audit, or null without typed damage support
  damageDealt,         // post-IWR damage before HP clamping
  hpDamage,            // actual HP lost (clamped)
  hpBefore,
  hpAfter,
  targetMaxHP,
  targetDefeated,
  attacksThisTurn,
  actionsLeft
}
{ ok: false, reason, distanceFeet?, blockedBy? }
```

Failure reasons:

- `no-actions`
- `invalid-target`
- `ally`
- `out-of-reach`
- `no-line-of-sight`
- `attacker-defeated`
- `target-defeated`
- `target-undetected`

`evaluateStrike()` performs the same validation without spending an action,
rolling dice, or incrementing MAP, so the View can highlight valid targets.

## Deterministic dice

The host may inject:

- `rollD20()` — returns 1..20;
- `rollDamageDie(sides)` — returns 1..sides;
- or a shared `rollDie(sides)` used for both.

Tests use fixed callbacks. The browser host uses `Math.random`. If no callback is
supplied, the core falls back to `Math.random` so the prototype remains playable.

## View behaviour

- Select **Strike** mode in the Actions panel. The button shows the current MAP,
  e.g. `Strike (-0)` then `Strike (-5)` after the first attack.
- Hostile living tokens within reach and LoS are outlined in red.
- Clicking the target resolves the attack and logs the expanded expression:
  `Valeros strikes Goblin: d20(12) + 9 (base) - 5 (MAP) = 16 vs AC 13 (16 - 2 Off-Guard [circumstance] - 1 Frightened 1 [status]) -> SUCCESS.`
- A flanked target is called out explicitly and the hover badge reads
  `FLANKED (-2 AC)`.
- A covered target adds `LESSER COVER (+1 AC)`, `STANDARD COVER (+2 AC)`, or
  `GREATER COVER (+4 AC)` to the hover label and draws the corner-to-corner
  cover rays.
- A Concealed target adds `FLAT CHECK DC 5`; a Hidden target adds
  `FLAT CHECK DC 11`. A Hidden/Undetected attacker adds
  `TARGET OFF-GUARD (-2 AC)`. An Undetected target shows a red
  `CANNOT TARGET UNDETECTED` label and a `not-allowed` cursor.
- A failed flat check logs
  `Valeros attacks Goblin (Concealed): Flat Check d20(4) vs DC 5 -> FAILED. Attack missed. Action spent, MAP increased.`
  and no attack/damage line follows. A passed check logs `... -> PASSED. Strike
  proceeds.` before the normal attack line.
- A Hidden/Undetected attacker adds
  `- 2 Off-Guard (Hidden Attacker) [circumstance]` to the AC breakdown.
- Suppressed circumstance bonuses appear in the log, e.g.
  `+2 Standard Cover [circumstance · suppressed]`.
- A critical hit appends `CRITICAL SUCCESS (Double Damage)!`.
- Natural 20/1 logs the degree shift, e.g. `(Natural 20: FAILURE -> SUCCESS)`.
- Damage logs the typed IWR chain, for example:
  `Damage: 8 slashing -> Weakness +5 (slashing) -> Resistance -3 (slashing) -> 10 damage dealt. Goblin HP: 16 -> 6.`
  or `Damage: 8 fire -> IMMUNE -> 0 damage dealt.`
- The Selection panel adds
  `Immune: fire | Weak: slashing 2 | Resist: piercing 2` (or `None`).
- HP is shown in the sidebar and as a mini-bar above each token. Defeated tokens
  are greyed, semi-transparent, and marked with a skull.

## Explicitly deferred

- Dying, Wounded, Unconscious, and recovery checks.
- Persistent damage is covered by `docs/rules/persistent-damage.md`; precision
  damage as a separate IWR component is still deferred.
- Ranged Strikes, thrown weapons, and reload.
- Other reactions (Detect/Disrupt, Shield Block), ranged Reactive Strikes, and
  reactive triggers other than leaving a threatened square.
