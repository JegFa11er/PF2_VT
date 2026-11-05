# Weapon Traits — Reach, Deadly, Fatal, Backstabber (PF2e Remastered)

`src/Core/Rules/weapon-traits.js` implements the weapon traits that change
damage or melee reach. `Combatant` stores the authored traits and exposes
`getReachFeet()`, `hasTrait()`, `getTrait()`, `getTraitLabels()` and
`getWeapon()`.

## Authoring

All of these forms are accepted:

```js
new Combatant({
  damage: { formula: "1d8+4", type: "slashing" },
  traits: ["reach", "backstabber", "deadly-d8", "fatal-d10"],
});

new Combatant({
  damage: { formula: "1d8+4", type: "slashing" },
  traits: ["deadly d8", "fatal d10"],
});

new Combatant({
  weapon: {
    formula: "1d8+4",
    type: "slashing",
    traits: [{ name: "deadly", dieSize: 8 }, { name: "fatal", die: "d10" }],
  },
});
```

Canonical slugs are `reach`, `backstabber`, `deadly-dN`, and `fatal-dN`.
`hasTrait("deadly")` and `hasTrait("deadly-d8")` both work.

## Reach

- A weapon with the `reach` trait has a melee reach of **10 ft** instead of 5 ft.
- `Combatant.getReachFeet()` returns 5 or 10.
- `Strike.evaluateStrike()` / `performStrike()` use the attacker's reach unless
  an explicit `reachFeet` option overrides it.
- `ReactiveStrike.findThreatenedEnemies()` checks every enemy with **its own**
  reach, so a reach weapon threatens a cell two squares away.
- `Stride` forwards no default 5-ft override, so each reactor contributes its own
  reach to the trigger scan.
- `Flanking.isFlanked()` measures each flanker with its own reach. A reach weapon
  can flank from 10 ft when the opposite-side/opposite-corner geometry holds.

## Damage calculation

```js
WeaponTraits.calculateWeaponDamage({
  weapon: { formula: "1d8+4", type: "slashing", traits: ["fatal-d10"] },
  degree: "CRITICAL_SUCCESS",
  isOffGuard: true,
  rollDie: (sides) => 7,
});
```

The function returns `null` for `FAILURE` / `CRITICAL_FAILURE`. On a hit it
returns a breakdown with `baseTotal`, `doubledBase`, `backstabber`, `fatal`,
`deadly`, `extras`, `extrasTotal`, `multiplier`, and the final `total`.

### Deadly

On a **critical success**, after the ordinary `(base) × 2`, add one extra die of
the listed size. The extra die is **not doubled**.

```text
1d8+4 deadly d8, critical: (1d8(5) + 4) × 2 = 18, + 1d8(5) = 23
```

### Fatal

On a **critical success**:

1. Replace every base weapon die with the fatal die.
2. Roll the replaced base damage and double it.
3. Add one extra fatal die that is **not doubled**.

```text
1d8+4 fatal d10, critical: 1d10(7) + 4 = 11 -> 11 × 2 = 22, + 1d10(7) = 29
```

The original `formula` remains available in the result; `effectiveFormula`
shows the fatal replacement (`1d10+4`).

### Backstabber

Against an **Off-Guard** target:

- normal hit: `+1` damage;
- critical hit: the `+1` is part of the doubled base damage, so it becomes `+2`
  before the multiplier;
- not Off-Guard: `+0`.

The damage type follows the weapon type. In the engine it is one typed instance,
so the target's IWR applies to the combined total.

```text
1d6+2 backstabber vs Off-Guard, hit:  5 + 1 = 6
1d6+2 backstabber vs Off-Guard, crit: (5 + 1) × 2 = 12
1d6+2 backstabber vs normal,     crit: 5 × 2 = 10
```

### Combined traits

Fatal and deadly can both add their non-doubled dice; backstabber is included in
the doubled base:

```text
1d8+4 fatal d10 + deadly d8 + backstabber, crit vs Off-Guard:
  (11 + 1) × 2 = 24
  + 1d10 fatal extra (7)
  + 1d8 deadly (5)
  = 36
```

## Strike integration

- `Strike.normalizeWeaponSpec()` resolves `{ formula, type, traits }` from the
  per-Strike `weapon`, the attacker's authored weapon, or explicit overrides.
- `performStrike()` and `performReactiveStrike()` both call
  `WeaponTraits.calculateWeaponDamage()` with the resolved degree and the
  Off-Guard flag (flanking, Off-Guard condition, or Hidden/Undetected attacker).
- The resulting total still flows through the target's single IWR pipeline.
- Strike results expose `damage.fatal`, `damage.deadly`, `damage.backstabber`,
  `damage.doubledBase`, and `damage.extras`.

## View

- The Selection panel shows `Attack`, `Weapon`, `Traits`, and `Reach` rows, e.g.
  `Weapon: 1d8+4 slashing [reach, backstabber, deadly d8]` and `Reach: 10 ft`.
- Strike mode highlights targets at the attacker's actual reach, including 10 ft.
- The combat log adds a separate trait audit line:

```text
TRAITS — Valeros: Fatal d10 replaces the base die (1d10+4): (11 + 1 Backstabber) × 2 = 24
+ Fatal extra 1d10 (7) = 31 slashing.
TRAITS — Valeros: Base (9 + 1 Backstabber) × 2 = 20 + Deadly 1d8 (5) = 25 slashing.
```

## Tests

`tests/Rules/weapon-traits.test.js` covers:

- trait parsing from slugs, spaced labels, and objects;
- deadly's non-doubled extra die and its absence on a normal hit;
- fatal die replacement, doubling, and the non-doubled fatal extra;
- backstabber's `+1` / doubled `+2` / `0` behavior;
- fatal + deadly + backstabber stacking;
- Strike at 10 ft, Reactive Strike at 10 ft, and flanking from 10 ft;
- end-to-end Strike damage with authored traits.

## Deliberately deferred

- Reach on multi-cell (Large/Huge) creature footprints.
- Deadly dice scaling from striking runes (greater/major striking).
- Other traits (agile is already handled separately for MAP; thrown, finesse,
  forceful, twin, etc.).
- Damage-type conversion, splash damage, and precision as a separate IWR
  instance.
