# Conditions, Modifiers & Flanking — PF2e Remastered

## Modifier pipeline

`src/Core/Rules/modifiers.js` is the single arithmetic entry point for attack
rolls, AC, saving throws, skill checks, and defended DCs.

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
combatant.addCondition("grabbed", undefined, {
  sourceId: "valeros",
  expiresOnSourceTurn: 3,
});

combatant.hasCondition("frightened");      // true
combatant.getCondition("frightened");      // { name, slug, label, value: 2 }
combatant.getCondition("grabbed");         // includes sourceId/expiresOnSourceTurn
combatant.getConditions();                 // defensive copies
combatant.getConditionModifiers("attack"); // attack-roll modifiers only
combatant.getConditionModifiers("ac");     // AC modifiers
combatant.getConditionModifiers("skill:athletics"); // Athletics-scope modifiers
combatant.getConditionModifiers("save:reflex");     // Reflex-scope modifiers
combatant.getConditionModifiers("dc:reflex");       // Reflex DC modifiers
combatant.removeCondition("off-guard");
combatant.endTurn();                       // tick Frightened at end of turn
```

Re-applying `frightened` keeps the higher value. Adding `frightened 0` removes
the condition. Unknown condition slugs are stored but contribute no modifiers
until a definition is added.

Persistent damage is intentionally not stored as a condition record. It has its
own `Combatant.persistentDamage` instances and resolves at end of turn; see
`docs/rules/persistent-damage.md`.

### Off-Guard

- **Effect:** `-2 circumstance penalty to AC`.
- **Scope:** AC only; it is not an attack-roll penalty.
- **Sources:** the condition itself, or flanking detected by the Strike action.
- **Non-stacking:** an Off-Guard condition and flanking never apply two separate
  `-2` circumstance penalties; the modifier resolver keeps one.

### Prone

- **Effect:** Off-Guard (`-2 circumstance AC`) and `-2 circumstance penalty to
  attack rolls`.
- **AC scope:** contributes one `-2 circumstance` modifier with source
  `off-guard`, so an existing Off-Guard condition does not add a second penalty.
- **Attack scope:** contributes one `-2 circumstance` modifier with source
  `prone`. It applies to attack rolls (Strike and Reactive Strike). An
  Attack-trait skill action such as Trip is still a skill check, so Prone does
  not penalize its Athletics roll; Trip does use MAP.
- **Off-Guard queries:** effects that ask whether the target is Off-Guard
  (for example the backstabber damage bonus) treat Prone as a source.
- **No Reflex/Will/Fortitude DC penalty:** Prone does not lower a defence DC.
- **Movement:** the only movement actions in this engine while prone are Stand
  (`Actions/stand.js`). Crawl is deferred. Standing ends the condition.
- **Removal:** `Stand.performStand({ combatant })` spends 1 action and removes
  `prone`. If a Reactive Strike defeats the creature first, the condition stays.
- **Token rendering:** the canvas token body is rotated 90 degrees and the
  `Prone` condition badge is shown on the token card and initiative row.

### Grabbed / Restrained / Immobilized

These three records are applied together by `Grapple.performGrapple`:

```js
target.addCondition("grabbed", undefined, {
  sourceId: grappler.id,
  expiresOnSourceTurn: grappler.turnNumber + 1,
});
target.addCondition("immobilized", undefined, {
  sourceId: grappler.id,
  expiresOnSourceTurn: grappler.turnNumber + 1,
});
```

- **Grabbed:** Off-Guard (`-2 circumstance AC`, source `off-guard`, name
  `Off-Guard (Grabbed)`) and Immobilized.
- **Restrained:** the same tactical effects in this prototype, with the badge
  name `Off-Guard (Restrained)`. Restrained supersedes Grabbed from the same
  grappler.
- **Immobilized:** Speed 0; Stride, Step, and Stand return
  `{ ok: false, reason: "immobilized" }` without spending an action. The
  companion record exists for the badge, and `Conditions.isImmobilized` also
  treats Grabbed/Restrained as Immobilized so authored saves cannot bypass the
  lock.
- **Metadata:** `sourceId` and `expiresOnSourceTurn` are part of the condition
  record and survive `getCondition()` copies. `getConditions()` exposes them.
- **Duration:** the Encounter expires the record at the end of the grappler's
  next turn, not the victim's. Moving (Stride/Step) or being defeated releases it
  immediately. See `docs/rules/maneuvers.md` for the full state machine.
- **Off-Guard queries:** `Strike` treats Grabbed/Restrained as Off-Guard for
  backstabber and similar effects.
- **Token rendering:** a red dashed ring and a chain marker identify immobilized
  tokens on the canvas; the badges appear on token cards and initiative rows.

### Frightened N

- **Effect:** `-N status penalty to all checks and DCs`.
- **In this engine:** attack rolls, skills, and saving throws are checks, and AC,
  Reflex DC, Fortitude DC, and Will DC are DCs, so Frightened reduces all of
  them.
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

### Concealed / Hidden / Undetected

These are visibility states owned by the defender. They deliberately contribute
**no AC modifiers**:

```js
target.addCondition("hidden");
target.getConditionModifiers("ac"); // []
```

- **Concealed:** attacks against the creature require a DC 5 flat check; a
  failure misses. AC is unchanged.
- **Hidden:** attacks against the creature require a DC 11 flat check; a
  failure misses. AC is unchanged. When a Hidden creature attacks, the target
  is Off-Guard against that attack (`-2 circumstance AC`, source `off-guard`,
  name `Hidden Attacker`).
- **Undetected:** cannot be selected as a direct target
  (`reason: "target-undetected"`). When an Undetected creature attacks, the
  target is Off-Guard against it.
- Hidden supersedes Concealed, and Undetected supersedes both. Only one flat
  check is rolled.

`Conditions.getVisibility(combatant)` resolves the strictest state and returns
`{ condition, label, flatCheckDC, targetable, undetected }`.
`Conditions.isHiddenAttacker(combatant)` is true for Hidden or Undetected.
See `docs/rules/visibility.md` for the full flow.

### Greater Cover (Take Cover)

- **Effect:** `+4 circumstance bonus to AC`.
- **Scope:** AC only.
- **Source:** `TakeCover.performTakeCover({ combatant, map, combatants })`,
  which costs 1 action and requires standard cover or better from a living
  hostile (or an explicitly supplied attacker).
- **Duration:** until the start of the creature's next turn or its next
  Stride/Step.
- **Expiry:** `Combatant.resetTurn()` removes `greater-cover` together with
  `shield-raised`; a successful Stride or Step removes it immediately.
- **Non-stacking:** Shield Raised (+2), geometric cover (+1/+2/+4), and Take
  Cover (+4) are all circumstance bonuses. The resolver keeps the highest, so
  Shield Raised + Greater Cover is +4, not +6.

## Flanking

`src/Core/Grid/flanking.js` implements pure geometry.

```js
Flanking.isFlanked(target, attacker, allies, gridMap);
Flanking.getFlankingAllies(target, attacker, allies, gridMap);
```

A target is flanked by an attacker when:

1. both the attacker and at least one other creature are hostile to the target;
2. neither is defeated;
3. both are within their **own** melee reach of the target (5 ft normally,
   10 ft with the `reach` weapon trait);
4. the direction from the target to the attacker is exactly opposite the
   direction to the other creature.

An explicit `reachFeet` option can override the reach for a specific call (used
by tests and special effects). Otherwise each flanker is measured by
`getReachFeet()` / its authored traits. This lets a reach weapon flank from two
squares away when the opposite-side or opposite-corner geometry holds.

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
    (Off-Guard [circumstance], Frightened [status], Shield Raised [circumstance],
     Greater Cover [circumstance])
  + Off-Guard from flanking OR from a Hidden/Undetected attacker,
    if the target is not already Off-Guard
  + geometric cover (Lesser/Standard/Greater) [circumstance]
```

The Hidden/Undetected attacker penalty uses
`{ name: "Hidden Attacker", type: "circumstance", value: -2, source: "off-guard" }`,
so the resolver never stacks it with flanking or a pre-existing Off-Guard.

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
  `Off-Guard`, `Frightened 1`, `Shield Raised`, `Greater Cover`, `Grabbed`,
  `Restrained`, and `Immobilized`.
- The selection panel lists active conditions and the best current cover.
- The action bar includes `Raise Shield` and `Take Cover` buttons. They become
  `Shield Raised ✓` / `Greater Cover ✓` while the corresponding condition is
  active.
- In Strike mode, hovering a flanked target draws orange corner brackets and a
  `FLANKED (-2 AC)` label. A covered target adds the cover badge and draws the
  best-corner cover rays.
- The combat log expands both sides and marks suppressed same-type bonuses:

```text
Valeros strikes Goblin: d20(13) + 9 (base) - 5 (MAP) = 17 vs AC 13 (16 - 2 Off-Guard [circumstance] - 1 Frightened 1 [status]) -> SUCCESS.
Merisiel strikes Goblin: d20(10) + 8 (base) = 18 vs AC 18 (16 + 2 Shield Raised [circumstance]) -> SUCCESS.
Valeros strikes Goblin: d20(12) + 9 (base) = 21 vs AC 20 (16 + 2 Shield Raised [circumstance] + 2 Standard Cover [circumstance · suppressed]) -> SUCCESS.
```

## Explicitly deferred

- Seek/Hide/Sneak/Point Out, automatic loss of Hidden after an attack, creature
  size, elevation, and Large-target flank arcs.
- Shield Block, shield Hardness/HP, shield items, and multiple shield types.
- Dying, Wounded, Unconscious, and recovery checks.
- Damage types and IWR are covered by `docs/rules/iwr.md`; persistent damage by
  `docs/rules/persistent-damage.md`; weapon traits by
  `docs/rules/weapon-traits.md`; Trip, Stand, and save/skill DCs by
  `docs/rules/maneuvers.md`.
- Crawl and other skill actions. Shove, Grapple, Grabbed, Restrained,
  Immobilized, and Escape are covered by `docs/rules/maneuvers.md`.
- Other reaction types and ranged attacks of opportunity.
- Fortune/misfortune and rerolls.
