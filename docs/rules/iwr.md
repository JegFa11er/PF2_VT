# Damage Types & IWR — PF2e Remastered

## Typed damage contract

`src/Core/Rules/damage.js` accepts two authoring forms:

```js
// Backwards compatible: plain formula = untyped
"1d8+4"

// Typed weapon/attack damage
{ formula: "1d8+4", type: "slashing" }
```

`Damage.parseDamageSpec(input, fallbackType)` returns a frozen
`{ formula, type }`. `Combatant` keeps the friendly `damage` formula string and
also exposes `damageType` and the normalized `damageSpec`. An explicit
`damageType` option is valid too:

```js
new Combatant({ damage: "1d8+4", damageType: "slashing" });
```

Damage types are lower-case slugs (`slashing`, `piercing`, `bludgeoning`,
`fire`, `cold`, `acid`, `electricity`, `sonic`, `poison`, `bleed`, `mental`,
`force`, `vitality`, `void`, `spirit`, `precision`, `untyped`, and future
single-word types). A plain string defaults to `untyped`; this preserves all
Phase 3-6 tests and makes the lack of a type explicit in the audit.

Per-Strike overrides accept the same shapes:

```js
Strike.performStrike({
  attacker,
  target,
  map,
  damage: { formula: "2d6+3", type: "fire" },
  // or damage: "2d6+3", damageType: "fire"
  rollD20: () => 15,
  rollDamageDie: () => 4,
});
```

## Canonical IWR order

`src/Core/Rules/iwr.js` implements the fixed PF2e Remastered order for each
damage instance:

```text
base damage (after the critical multiplier)
  -> Immunity    (instance becomes 0; Weakness and Resistance are skipped)
  -> Weakness    (+value once per attack for an applicable type)
  -> Resistance  (-value, floored at 0)
```

The core entry point is pure:

```js
IWR.applyIWR({
  damageInstances: [{ amount: 8, type: "slashing" }],
  immunities: ["fire"],
  weaknesses: [{ type: "slashing", value: 5 }],
  resistances: [{ type: "piercing", value: 3 }],
});
```

Accepted IWR data:

- `immunities`: `["fire"]`, `[{ type: "fire" }]`, or `{ fire: true }`.
- `weaknesses` / `resistances`: `[{ type: "slashing", value: 5 }]` or
  `{ slashing: 5 }`.
- `"all"` matches every damage type.
- Duplicate entries for one type keep the highest value.

The returned audit is:

```js
{
  totalDamage: 13,
  baseTotal: 8,
  breakdown: [
    {
      index: 0,
      type: "slashing",
      amount: 8,
      immune: false,
      weakness: 5,
      resistance: 0,
      resistanceApplied: 0,
      afterImmunity: 8,
      afterWeakness: 13,
      finalAmount: 13,
      steps: [{ kind: "weakness", type: "slashing", value: 5 }]
    }
  ],
  appliedIWR: [
    { kind: "weakness", type: "slashing", value: 5, amount: 5, instanceIndex: 0 }
  ]
}
```

`appliedIWR.kind` is `immunity`, `weakness`, or `resistance`. A resistance
entry records both the authored `value` and the `amount` actually removed, so
an over-large resistance reports only the damage available to resist.

## Application to HP

`Combatant.takeDamage(amount, options)` runs the pipeline against the
combatant's own arrays:

```js
goblin.takeDamage(18, { type: "slashing" });
```

Options:

- `type`: one damage type (default `untyped`).
- `damageInstances`: pre-split `{ amount, type }[]` for a multi-type attack.
- `applyIWR: false`: bypass IWR (reserved for future healing rules).

The result extends the Phase 4 contract:

```js
{
  damageTaken,      // actual HP lost, clamped at 0
  damageApplied,    // post-IWR damage
  baseDamage,       // pre-IWR amount
  currentHP, maxHP, isDefeated,
  iwr               // full applyIWR() audit
}
```

`damageTaken` stays the actual HP lost (so overkill remains visible), while
`damageApplied` is the number the IWR audit produced. Strike reports both:
`damageDealt` is post-IWR, `hpDamage` is the actual HP lost.

## Strike and Reactive Strike

After the d20, degree of success, and critical doubling, the attack calls:

```js
target.takeDamage(damage.total, { type: damage.type });
```

The attack result gains:

- `damage.type` — the resolved damage type;
- `iwr` — the target's `applyIWR` audit, or `null` when the target does not
  implement IWR;
- `damageDealt` — post-IWR damage, not raw damage.

Reactive Strike uses the exact same contract and therefore applies IWR too.
Persistent damage also calls `takeDamage(amount, { type })` on each end-of-turn
tick, so its IWR chain is identical. See `docs/rules/persistent-damage.md`.

## Combat-log format

The View expands the IWR audit in the damage line:

```text
Damage: 8 slashing -> Weakness +5 (slashing) -> Resistance -3 (slashing) -> 10 damage dealt. Goblin HP: 16 -> 6.
Damage: 8 fire -> IMMUNE -> 0 damage dealt. Goblin HP: 20 -> 20.
```

With a critical multiplier the base shows after the chain:

```text
Damage: 16 [6 + 2] piercing -> Resistance -2 (piercing) -> 14 damage dealt (base 8 × 2). Goblin HP: 6 -> 0 (Defeated).
```

When a resistance is larger than the available damage, the log shows the
actual amount removed, for example `Resistance -4 of 10 (piercing)`.

The Selection panel adds a concise IWR row:

```text
Immune: fire | Weak: slashing 2 | Resist: piercing 2
```

## Tests

`tests/Rules/iwr.test.js` covers:

- immunity zeroing the instance before Weakness/Resistance;
- `"all"` immunity and unrelated immunity;
- Weakness addition and its once-per-type-per-attack rule;
- Resistance subtraction and the 0 floor;
- Weakness before Resistance on the same type;
- multi-type attacks with mixed IWR;
- duplicate IWR values and object-form authoring;
- validation of amounts, types, and values.

`tests/Actions/strike.test.js` adds end-to-end cases for Weakness,
Resistance, immunity, critical-before-IWR, and the legacy `untyped` string.

## Deliberately deferred

- Persistent damage's recovery check is implemented separately; see
  `docs/rules/persistent-damage.md`.
- Precision damage as a component of another type; the engine currently
  processes each typed instance independently.
- Damage-type conversion and splash damage.
- Other weapon traits are covered by `docs/rules/weapon-traits.md`
  (reach/deadly/fatal/backstabber are implemented).
- Full condition/damage immunity lists from bestiary stat blocks.
