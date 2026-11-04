# Conditions, Modifiers & Flanking — PF2e Remastered

## Modifier pipeline

`src/Core/Rules/modifiers.js` is the single arithmetic entry point for attack
rolls, AC, and future checks.

```js
const result = Modifiers.resolveModifiers(10, [
  { name: "Off-Guard", type: "circumstance", value: -2, source: "off-guard" },
  { name: "Frightened 1", type: "status", value: -1, source: "frightened" },
  { name: "MAP", type: "untyped", value: -5, source: "multiple-attack-penalty" },
]);
// result.total === 2
```

### Modifier types

| Type | Enum | Stacks with itself? |
|---|---|---|
| Circumstance | `Modifiers.MODIFIER_TYPES.CIRCUMSTANCE` | No |
| Status | `Modifiers.MODIFIER_TYPES.STATUS` | No |
| Item | `Modifiers.MODIFIER_TYPES.ITEM` | No |
| Untyped | `Modifiers.MODIFIER_TYPES.UNTYPED` | Yes, unless from the same source |

### Stacking math

1. Typed bonuses of the same type: keep the **highest** bonus.
2. Typed penalties of the same type: keep the **worst** (most negative) penalty.
3. A same-type bonus and penalty are evaluated separately, so a `+2 status`
   bonus and a `-1 status` penalty produce a net `+1`.
4. Untyped bonuses and penalties stack across **different sources**. Within one
   source, keep the highest bonus and the worst penalty only once.
5. The total is `baseValue + sum(effectiveModifiers)`.

`resolveModifiers(baseValue, modifiers)` returns:

```js
{
  total,               // baseValue + modifierTotal
  baseValue,
  modifierTotal,
  bonusTotal,
  penaltyTotal,
  breakdown: [         // one entry per type, in circumstance/status/item/untyped order
    {
      type, bonus, penalty, subtotal,
      applied: [...],    // modifiers that affected the total
      suppressed: [...]  // non-stacking modifiers
    }
  ],
  effectiveModifiers: [...],
  suppressedModifiers: [...]
}
```

Every modifier is `{ name, type, value, source }`. `source` is only needed for
untyped same-source deduplication; when omitted, `name` is used.

## Conditions

`src/Core/Entities/conditions.js` defines the condition records and their
modifier contributions. `Combatant` owns the mutable condition store.

### API

```js
combatant.addCondition("off-guard");
combatant.addCondition("frightened", 2);
combatant.addCondition("shield-raised");

combatant.hasCondition("frightened");      // true
combatant.getCondition("frightened");      // { name, slug, label, value: 2 }
combatant.getConditions();                 // defensive copies
combatant.getConditionModifiers("attack"); // attack-roll modifiers only
combatant.getConditionModifiers("ac");     // AC modifiers
combatant.removeCondition("off-guard");
combatant.endTurn();                       // tick Frightened at end of turn
```

Re-applying `frightened` keeps the higher value. Adding `frightened 0` removes
the condition. Unknown condition slugs are stored but contribute no modifiers
until a definition is added.

### Off-Guard

- **Effect:** `-2 circumstance penalty to AC`.
- **Scope:** AC only; it is not an attack-roll penalty.
- **Sources:** the condition itself, or flanking detected by the Strike action.
- **Non-stacking:** an Off-Guard condition and flanking never apply two separate
  `-2` circumstance penalties; the modifier resolver keeps one.

### Frightened N

- **Effect:** `-N status penalty to all checks and DCs`.
- **In this engine:** attack rolls are checks and AC is a DC, so Frightened
  reduces both.
- **Decay:** at the end of the frightened creature's turn, `N` decreases by 1.
  At 0 the condition is removed.

`Combatant.endTurn()` is the canonical decay point. The Encounter calls it for
the outgoing combatant before activating the next one.

`Combatant.resetTurn()` also performs the tick by default so standalone hosts
can use it as a turn boundary. Encounter calls
`resetTurn({ tickConditions: false })` for the incoming combatant because the
outgoing combatant's tick has already happened.

### Shield Raised

- **Effect:** `+2 circumstance bonus to AC`.
- **Scope:** AC only; it does not modify attack rolls or other checks.
- **Duration:** until the start of the raiser's next turn.
- **Source:** `RaiseShield.performRaiseShield({ combatant })`, which costs
  1 action.
- **Expiry:** `Combatant.resetTurn()` removes `shield-raised` unconditionally.
  It deliberately does not expire in `endTurn()`, so it protects the raiser
  during other creatures' turns.
- **Non-stacking:** raising the shield again spends another action but keeps a
  single `+2 circumstance` modifier.
- **Interaction with Off-Guard:** a circumstance bonus and a circumstance
  penalty are evaluated independently, so `+2 Shield Raised` and
  `-2 Off-Guard` both apply and net to 0.

## Flanking

`src/Core/Grid/flanking.js` implements pure geometry.

```js
Flanking.isFlanked(target, attacker, allies, gridMap);
Flanking.getFlankingAllies(target, attacker, allies, gridMap);
```

A target is flanked by an attacker when:

1. both the attacker and at least one other creature are hostile to the target;
2. neither is defeated;
3. both are adjacent to the target (orthogonal or diagonal);
4. both are within 5-ft melee reach;
5. the direction from the target to the attacker is exactly opposite the
   direction to the other creature.

Opposite directions cover opposite sides and opposite corners:

| Attacker direction | Required ally direction | Result |
|---|---|---|
| east | west | flank |
| north | south | flank |
| north-west | south-east | flank |
| north | east | no flank (L-shape) |
| north | south-east | no flank |

When `gridMap` is supplied, all involved cells must be inside its bounds.

Flanking is **situational**: the target is treated as Off-Guard against the
flanking attackers' melee attacks, but the condition itself is not permanently
added to the target.

## Strike integration

`src/Core/Actions/strike.js` resolves both sides through `resolveModifiers`.

**Attack side**

```text
base = attacker.attackBonus
modifiers =
  attacker conditions with attack scope (Frightened [status])
  + current MAP [untyped]
```

**Defense side**

```text
base = target.ac (or options.targetAC)
modifiers =
  target conditions with AC scope
    (Off-Guard [circumstance], Frightened [status], Shield Raised [circumstance])
  + Off-Guard from flanking, if the target is not already Off-Guard
```

The final total is checked with `evaluateCheck({ d20, modifier, dc })`, where
`modifier` is the resolved attack value and `dc` is the resolved AC.

Pass `allies` (or `combatants`) to `performStrike` / `evaluateStrike` so the
action can detect flanking:

```js
Strike.performStrike({
  attacker, target, map,
  allies: allCombatants,
  rollD20: () => 13,
  rollDamageDie: (sides) => 1,
});
```

The result exposes `flanked`, `flankers`, `offGuard`, `attackModifiers`,
`targetACBase`, `targetAC` (final), `targetACModifiers`, and the per-type
breakdowns.

## View behaviour

- Token cards and initiative rows show condition badges such as
  `Off-Guard`, `Frightened 1`, and `Shield Raised`.
- The selection panel lists active conditions.
- The action bar includes a `Raise Shield` button; it becomes
  `Shield Raised ✓` while the condition is active.
- In Strike mode, hovering a flanked target draws orange corner brackets and a
  `FLANKED (-2 AC)` label.
- The combat log expands both sides:

```text
Valeros strikes Goblin: d20(13) + 9 (base) - 5 (MAP) = 17 vs AC 13 (16 - 2 Off-Guard [circumstance] - 1 Frightened 1 [status]) -> SUCCESS.
Merisiel strikes Goblin: d20(10) + 8 (base) = 18 vs AC 18 (16 + 2 Shield Raised [circumstance]) -> SUCCESS.
```

## Explicitly deferred

- Cover, concealment, creature size, reach weapons, and Large-target flank arcs.
- Shield Block, shield Hardness/HP, shield items, and multiple shield types.
- Dying, Wounded, Unconscious, and recovery checks.
- Persistent damage, damage types, resistance, and weakness.
- Reactions and attacks of opportunity.
- Fortune/misfortune and rerolls.
