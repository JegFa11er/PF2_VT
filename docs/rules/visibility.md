# Concealment, Hidden & Undetected — PF2e Remastered

## Implemented baseline

Session 6.2 adds three visibility conditions and resolves a **flat check**
before the attack roll. The flat check has no modifiers:

```text
d20 >= DC  -> passed
d20 <  DC  -> failed
```

| Condition | Flat check to target it | Effect |
|---|---|---|
| `Concealed` | DC 5 | A failed check makes the attack miss. |
| `Hidden` | DC 11 | A failed check makes the attack miss. |
| `Undetected` | none | The creature cannot be chosen as a direct target. |

`Hidden` is stricter than `Concealed`. If a creature has both, only one check
is rolled, at DC 11. `Undetected` supersedes both because targeting is refused
before any die is rolled.

## Important vector of the condition

The visibility condition belongs to the **defender**. It does not lower the
defender's own AC:

```js
target.addCondition("hidden");
target.getConditionModifiers("ac"); // []
```

Instead:

1. **Attacking a Hidden creature** requires a DC 11 flat check. A failure
   misses even if the attack roll would have hit.
2. **Attacking from Hidden or Undetected** makes the target Off-Guard against
   that specific attack: `-2 circumstance AC`, source `off-guard`, name
   `Hidden Attacker`. It does not stack with flanking or an existing Off-Guard
   condition because the resolver keeps one circumstance penalty.

Undetected has both properties: it cannot be targeted directly, and when an
Undetected creature attacks, the target is Off-Guard against it.

## Flat check timing

`Strike.performStrike()` (and `ReactiveStrike.performReactiveStrike()`)
resolves the visibility flat check **after validation but before the attack
roll**:

1. Invalid target, ally, out of reach, no line of sight, or Undetected target:
   reject immediately. Nothing is spent and no die is rolled.
2. Concealed/Hidden target: roll the flat check.
3. **Failure:** spend the action (or reaction), increment MAP for a normal
   Strike, roll no attack die, deal no damage, and return an automatic miss.
4. **Success:** continue with the normal attack and damage pipeline.

Reactive Strike keeps its existing contract: a failed flat check spends the
reaction but never uses or advances MAP.

## API

### `Checks.evaluateFlatCheck`

```js
Checks.evaluateFlatCheck({ d20: 11, dc: 11 });
// { passed: true, d20: 11, dc: 11 }

Checks.evaluateFlatCheck({ dc: 5, rollD20: () => 4 });
// { passed: false, d20: 4, dc: 5 }
```

The caller may supply `d20` directly, a `rollD20()` callback, a shared
`rollDie(sides)` callback, or nothing (the core falls back to `Math.random`).
Invalid dice or non-integer DCs throw.

### `Conditions` visibility helpers

```js
Conditions.VISIBILITY_CONDITIONS; // concealed / hidden / undetected
Conditions.isVisibilityCondition("hidden"); // true
Conditions.visibilityFlatCheckDC("hidden"); // 11
Conditions.getVisibility(target);
// { condition, label, flatCheckDC, targetable, undetected }
Conditions.isHiddenAttacker(attacker); // hidden || undetected
```

### Strike options and result

`performStrike` and `performReactiveStrike` accept:

- `rollFlatCheck()` — optional deterministic flat-check die. When omitted the
  action falls back to `rollD20`, then `rollDie(20)`, then `Math.random`.

The result exposes:

```js
{
  flatCheck: {
    passed: false,
    dc: 11,
    roll: 4,
    condition: "hidden"
  },
  visibility: { condition: "hidden", label: "Hidden", flatCheckDC: 11, ... },
  hiddenAttacker: true,
  automaticMiss: true, // failed flat check
  hit: false,
  damage: null,
  attacksThisTurn: 2,
  actionsLeft: 2
}
```

A normal successful attack that passed a flat check keeps the same
`flatCheck` object with `passed: true`. An attack with no visibility condition
reports `flatCheck: null`.

`Strike.STRIKE_REASONS.TARGET_UNDETECTED` (`"target-undetected"`) is returned
when the target is Undetected. The action and reaction pools are untouched.

## View behaviour

- Token cards and initiative rows show `Concealed`, `Hidden`, and `Undetected`
  badges.
- Tokens with `Hidden` or `Undetected` render at 50% opacity on the canvas.
- Strike hover appends `FLAT CHECK DC 5` or `FLAT CHECK DC 11`. A Hidden or
  Undetected attacker adds `TARGET OFF-GUARD (-2 AC)`. An Undetected target
  shows a red `CANNOT TARGET UNDETECTED` label and a `not-allowed` cursor.
- Combat log on failure:

```text
Valeros attacks Goblin (Concealed): Flat Check d20(4) vs DC 5 -> FAILED. Attack missed. Action spent, MAP increased.
```

- Combat log on success, followed by the standard attack line:

```text
Valeros attacks Goblin (Concealed): Flat Check d20(15) vs DC 5 -> PASSED. Strike proceeds.
Valeros strikes Goblin: d20(12) + 9 (base) = 21 vs AC 15 (16 - 1 Frightened 1 [status]) -> SUCCESS.
```

- A Hidden attacker is called out explicitly and the AC breakdown reads
  `- 2 Off-Guard (Hidden Attacker) [circumstance]`.

## Explicitly deferred

- `Seek`, `Hide`, `Sneak`, and `Point Out` actions.
- Automatically losing Hidden after an attack.
- Ranged attacks, thrown weapons, and reload.
- Creature size, elevation, and special senses such as tremorsense.
- Invisibility spells and counteracts.
