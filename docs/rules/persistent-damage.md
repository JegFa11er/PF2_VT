# Persistent Damage — PF2e Remastered

## Rule

Persistent damage is a condition-like effect that resolves at the **end of the
affected creature's turn**, after the creature has acted.

Resolution order for each distinct damage type:

1. Roll the persistent damage formula (for example `1d6` fire).
2. Apply that damage through the normal IWR pipeline:
   `Combatant.takeDamage(amount, { type })`, i.e. **Immunity -> Weakness ->
   Resistance**.
3. Roll a **recovery flat check, DC 15**, with no modifiers.
   - `d20 >= 15` -> that persistent damage instance ends and is removed.
   - `d20 < 15` -> it persists into the next round.
4. A critical failure on the recovery check has **no extra penalty** in this
   implementation. The check is a strict binary DC 15 flat check.

Damage is dealt **before** the recovery check. A successful check therefore does
not prevent the damage rolled on that same turn.

## Stacking

- Different damage types are independent instances. Each one rolls damage and
  makes its own DC 15 recovery check.
- The same damage type never stacks. If a creature already has `1d4` persistent
  fire and receives `1d6` persistent fire, the stronger formula (`1d6`) is kept.
  Strength is compared by average damage (`formulaWeight`), so `1d6` (3.5)
  replaces `1d4` (2.5), while a weaker re-application leaves the existing
  instance unchanged.
- Instance ids are stable: `persistent-<type>` by default, or an explicitly
  authored `id`.

## Core API

`src/Core/Entities/persistent-damage.js` provides the pure helpers; `Combatant`
owns the mutable store.

```js
const goblin = new Combatant({
  // ...
  persistentDamage: [
    { formula: "1d6", type: "fire" },
    { formula: "1d4", type: "bleed" },
  ],
});

goblin.addPersistentDamage({ formula: "1d6", type: "fire" });
goblin.hasPersistentDamage("fire"); // true
goblin.getPersistentDamage();       // defensive copies
goblin.removePersistentDamage("fire");
goblin.removePersistentDamage("persistent-bleed");
```

`Combatant.endTurn(options)` resolves the tick:

```js
const end = goblin.endTurn({
  rollDie: () => 4,          // persistent damage dice
  rollD20: () => 16,         // recovery flat check
  // rollDamageDie and rollFlatCheck are also accepted
});
```

The result keeps the existing Frightened contract and adds:

```js
{
  frightened,
  changed,
  persistentTick: {
    combatantId,
    combatantName,
    events: [{
      instanceId, formula, type, amount,
      damage: { formula, type, diceCount, dieSize, modifier, rolls,
                diceTotal, baseTotal, doubled: false, multiplier: 1, total },
      iwr,                 // applyIWR audit
      damageDealt,         // post-IWR
      hpDamage, hpBefore, hpAfter, defeated,
      recovery: { passed, d20, dc },
      removed
    }],
    changed,
    anyRemoved,
    defeated
  },
  persistentChanged
}
```

`Encounter.nextTurn(options)` forwards the die callbacks to the outgoing
combatant's `endTurn()` and returns the same report as `persistentTick`.

## View

- Token cards and initiative rows show badges such as
  `Persistent Fire 1d6` and `Persistent Bleed 1d4`.
- End Turn logs each type separately:

```text
[PERSISTENT DAMAGE] Goblin takes 5 [5] fire -> IMMUNE -> 0 damage dealt. Goblin HP: 6 -> 6.
Recovery Check: Flat Check d20(4) vs DC 15 -> FAILED (Fire persists).
[PERSISTENT DAMAGE] Goblin takes 1 [1] bleed -> 1 damage dealt. Goblin HP: 6 -> 5.
Recovery Check: Flat Check d20(2) vs DC 15 -> FAILED (Bleed persists).
```

## Tests

`tests/Entities/persistent-damage.test.js` covers:

- creation, stable ids, same-type replacement, and independent types;
- defensive copies and formula weighting;
- end-of-turn damage through the target's IWR;
- recovery at `d20 >= 15` vs `d20 < 15`;
- separate damage rolls and recovery checks for different types;
- immunity still allowing the recovery check;
- defeated creatures taking no end-of-turn tick;
- constructor authoring and the Encounter result contract.

## Deliberately deferred

- Dying, Wounded, Unconscious, and death from persistent damage.
- Persistent damage from afflictions (poisons/diseases) and their stage rules.
- A UI action that applies persistent damage during play; the demo authors it on
  the Goblin.
