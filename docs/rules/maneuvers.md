# Saving Throws, Skills, Prone, Stand, Trip, Shove, Grapple & Escape — PF2e Remastered

Phase 8.1 (saves/skill DCs), 8.2 (Prone/Stand), and 8.3 (Trip, Shove,
Grapple/Grabbed/Restrained/Immobilized, and Escape) are implemented. The core
remains presentation-free; View wiring only consumes the structured results.

## Saving throws and skills

`Combatant` stores two flat integer blocks:

```js
new Combatant({
  // ...
  saves: { fortitude: 9, reflex: 6, will: 5 },
  skills: { athletics: 10, acrobatics: 6, stealth: 2, perception: 7 },
});
```

Missing entries default to `0`. `getSaves()` and `getSkills()` return defensive
copies. Unknown future names are preserved by the constructor, but the four
listed skills are the ones authored by the demo and used by this slice.

### Modifier collection

```js
combatant.getSkillModifiers("athletics");                 // Frightened, checks
combatant.getSaveModifiers("reflex");                     // Frightened
combatant.getSaveModifiers("reflex", { cover });          // + standard/greater cover
combatant.getDCModifiers("reflex");                       // Frightened
combatant.getDCModifiers("reflex", { cover });            // + standard/greater cover
```

Attack-roll modifiers such as Prone do **not** flow into skill checks. Trip has
the `attack` trait for MAP, but its roll is an Athletics skill check, not an
attack roll.

The `cover` option accepts either a `determineCover()` result or a degree string
(`"standard"`, `"greater"`, ...). Standard cover is `+2 circumstance` and
greater cover is `+4 circumstance`; lesser cover is AC-only and contributes no
Reflex or Reflex DC modifier.

### Defended DC

```text
DC = 10 + save or skill modifier + resolved situational modifiers
```

`Checks.calculateDC(base, modifiers)` and `Checks.resolveDC(base, modifiers)`
apply this formula through the central modifier resolver. Frightened is a status
penalty, cover is a circumstance bonus, and same-type bonuses/penalties never
stack.

## Trip

`src/Core/Actions/trip.js`

| Property | Value |
|---|---|
| Cost | 1 action |
| Traits | `attack` |
| Roll | Athletics skill check (not an attack roll) |
| Defence | Reflex DC (`10 + Reflex + modifiers`) |
| Reach | Melee reach (5 ft, or 10 ft with `reach`) |
| MAP | Uses the current MAP and advances `attacksThisTurn` after the check |
| Visibility | Concealed = DC 5 flat check, Hidden = DC 11 before the check |

Degrees of success:

| Degree | Result |
|---|---|
| Critical Success | Target becomes `prone` and takes `1d6 bludgeoning` |
| Success | Target becomes `prone` |
| Failure | No effect |
| Critical Failure | Attacker becomes `prone` |

The critical damage runs through `Damage.rollDamage` and
`Combatant.takeDamage(amount, { type: "bludgeoning" })`, so the target's IWR is
applied exactly like a Strike. The check uses the same four-degree pipeline,
including natural 20/1 shifts.

Concealed and Hidden targets still impose their flat check before the Athletics
check. A failed flat check spends the action and advances MAP but produces no
Athletics roll, no Prone, and no damage. Prone's `-2` attack penalty does not
apply to the Athletics check because Trip is not an attack roll; the current MAP
does.

```js
Trip.performTrip({
  attacker,
  target,
  map,
  combatants: allCombatants,
  rollD20: () => 15,
  rollDamageDie: (sides) => 4,
});
```

`Trip.evaluateTrip()` performs the same validation and math without spending the
action, rolling a d20, or mutating state. The View uses it for target highlights
and hover text.

### Requirements

Trip's printed requirements are enforced before geometry or MAP:

- at least one free hand, unless the wielded weapon carries the `trip` trait
  (`Equipment.checkManeuverHands`); a violation returns `no-free-hand`;
- the target may be at most one size category larger. Size ranks are tiny 0,
  small 1, medium 1, large 2, huge 3, gargantuan 4
  (`Rules/size.js::canManeuverTarget`); a violation returns `target-too-large`.

Shove and Grapple share the same two gates through
`Actions/athletics-maneuver.js` with the `shove`/`grapple` trait.

## Shove

`src/Core/Actions/shove.js` (shared check math in
`src/Core/Actions/athletics-maneuver.js`).

| Property | Value |
|---|---|
| Cost | 1 action |
| Traits | `attack` |
| Roll | Athletics skill check (not an attack roll) |
| Defence | Fortitude DC (`10 + Fortitude + modifiers`) |
| Reach | Melee reach (5 ft, or 10 ft with `reach`) |
| MAP | Uses the current MAP and advances `attacksThisTurn` after the check |
| Visibility | Concealed = DC 5 flat check, Hidden = DC 11 before the check |

Degrees of success:

| Degree | Result |
|---|---|
| Critical Success | Push the target 10 ft (2 squares) |
| Success | Push the target 5 ft (1 square) |
| Failure | No effect |
| Critical Failure | Attacker becomes `prone` |

The Remastered Shove critical success **does not** knock the target prone; it
only extends the push to 10 ft. Trip is the maneuver that knocks prone.

### Push vector and blocking

The direction is the attacker-centre -> target-centre line reduced to one of the
eight grid directions:

```js
dx = Math.sign(target.x - attacker.x);
dy = Math.sign(target.y - attacker.y);
```

The target is moved one square at a time. Each destination is checked in order:

1. out of grid bounds -> stop (`blockedReason: "bounds"`);
2. a wall/obstacle (`GridMap.isBlocked`) -> stop (`"wall"`);
3. another creature (including defeated creatures, which still occupy) -> stop
   (`"creature"`).

A blocked second square therefore collapses a 10-ft critical push into a 5-ft
push. A blocked first square produces a successful Shove with 0 ft of movement.
Shove is forced movement: it does not provoke Reactive Strike, and it does not
advance the target's 5-10-5 diagonal counter.

```js
Shove.performShove({
  attacker,
  target,
  map,
  combatants: allCombatants,
  rollD20: () => 5,
});
```

`Shove.computePushPath()` is pure and reusable; `getPushDirection()` exposes the
vector independently.

## Grapple

`src/Core/Actions/grapple.js` (shared check math in
`src/Core/Actions/athletics-maneuver.js`).

| Property | Value |
|---|---|
| Cost | 1 action |
| Traits | `attack` |
| Roll | Athletics skill check (not an attack roll) |
| Defence | Fortitude DC (`10 + Fortitude + modifiers`) |
| MAP | Uses the current MAP and advances `attacksThisTurn` after the check |
| Visibility | Concealed = DC 5 flat check, Hidden = DC 11 before the check |

Degrees of success:

| Degree | Result |
|---|---|
| Critical Success | Target becomes `restrained` |
| Success | Target becomes `grabbed` |
| Failure | No effect |
| Critical Failure | Attacker becomes `prone` (prototype simplification) |

The Remastered critical-failure clause additionally lets an already-grabbing
attacker's victim break free and choose whether to reverse the grab or knock the
attacker prone. This slice implements the product-approved simplification:
attacker `prone` **and** any existing hold from that attacker is released. It is
documented instead of silently extrapolated.

### Grabbed and Restrained

Both conditions are applied together with the companion `immobilized` record:

- `-2 circumstance` AC through source `off-guard` (so it never stacks with
  flanking, Prone, or an existing Off-Guard);
- Speed 0 and no move-trait actions (Stride, Step, Stand);
- `sourceId` stores the grappler's id;
- `expiresOnSourceTurn` stores `grappler.turnNumber + 1`.

Restrained supersedes Grabbed from the same grappler. A later ordinary success
does not downgrade an existing Restrained state.

### Duration state machine

`Combatant.turnNumber` increments in `resetTurn()` (the start of each of that
combatant's turns). In `performGrapple`, the condition is stamped with
`source.turnNumber + 1`.

| Moment | Turn number | `expiresOnSourceTurn` | Held? |
|---|---|---|---|
| Grapple applied on grappler's turn 1 | 1 | 2 | yes |
| End of grappler's turn 1 | 1 | 2 | yes (`1 >= 2` is false) |
| Victim's turn | — | 2 | yes |
| End of grappler's turn 2 | 2 | 2 | no (`2 >= 2` is true) |

`Encounter.nextTurn()` passes the roster into the outgoing combatant's
`endTurn({ combatants })`. `Combatant.endTurn()` then calls
`expireGrapplesFrom(sourceId, turnNumber)` on every other combatant. This is why
the condition expires on the grappler's turn rather than the victim's.

Immediate breaks:

- **Grappler moves:** a successful Stride or Step calls
  `Conditions.releaseGrapplesBySource(roster, mover.id)`, and the result includes
  `releasedGrapples` for the combat log.
- **Grappler defeated:** `Encounter.nextTurn()` calls
  `releaseGrapplesFromDefeated()` before the next creature acts; a manual
  `endTurn()` on a defeated grappler also releases.
- **Escape succeeds:** the escaper calls `releaseGrappleFrom(sourceId)`.
- **Grapple critical failure:** the attacker's own hold on the target is
  released.

### Multiple simultaneous grapplers

Grabbed/Restrained/Immobilized are tracked as source-linked instances.
`Combatant.getGrappleInstances()` and `getGrappleSources()` expose every
simultaneous hold; the canonical `getCondition()` record keeps the earliest
source's `sourceId`. Escape releases only the chosen source, so the victim stays
Grabbed until the last instance is removed. A second grappler no longer
overwrites the first grappler's source metadata.

## Escape

`src/Core/Actions/escape.js`

| Property | Value |
|---|---|
| Cost | 1 action |
| Traits | `attack` (MAP applies and advances) |
| Requires | `grabbed` or `restrained` |
| Roll | Highest of Unarmed Attack, Athletics, or Acrobatics |
| Defence | The grappler's Athletics DC (`10 + Athletics + modifiers`) |
| Visibility | Concealed = DC 5, Hidden = DC 11 before the roll |

The three options are resolved through the normal modifier pipeline after MAP is
applied. Prone's `-2` penalty affects only the Unarmed Attack option (an attack
roll); Athletics and Acrobatics are skill checks. The highest total wins; ties
fall back to the higher base value and then the fixed order Unarmed -> Athletics
-> Acrobatics.

The engine has no separate unarmed attack profile, so the Unarmed Attack option
uses `Combatant.attackBonus`. This is an explicit prototype assumption, not an
attempt to model a full unarmed stat block.

Success or Critical Success removes the grapple condition and the companion
`immobilized` record from that source. Failure and Critical Failure keep the
condition, but the action and MAP increment are still spent. If the grappler is
already defeated, the attempt releases the condition without spending an action
(`reason: "source-defeated"`).

```js
Escape.performEscape({
  actor: grabbedCreature,
  combatants: allCombatants,
  rollD20: () => 18,
});
```

`Escape.evaluateEscape()` returns the three `options`, the chosen `bestOption`,
the `athleticsDC`, and the flat-check data without mutating state; the View uses
it for the button label and hover text.

## Stand

`src/Core/Actions/stand.js`

- Costs 1 action.
- Has the `move` trait.
- Requires the `prone` condition.
- Removes `prone` when the action completes.

### Reactive Strike timing

Stand provokes Reactive Strike from enemies that threaten the creature's square.
The reaction resolves **before** the condition is removed, matching PF2e
interrupt timing:

1. Spend the action.
2. Scan living hostile combatants with a reaction in reach of the current cell.
3. The first eligible enemy resolves a Reactive Strike against the still-prone
   target (so the target is Off-Guard and takes the `-2` AC penalty).
4. If the target is defeated, Stand is interrupted and `prone` remains.
5. Otherwise remove `prone`.

A failed reaction attempt (for example no line of sight) spends nothing and the
scan continues. Only the first successful reactor reacts, mirroring Stride's
prototype auto-trigger.

## Combat log shapes

```text
Valeros attempts to Trip Goblin: Athletics d20(15) + 10 (base) - 5 (MAP) = 20 vs Reflex DC 18 (10 + 8) -> SUCCESS. Goblin is now Prone.
Valeros attempts to Trip Goblin: Athletics d20(18) + 10 (base) = 28 vs Reflex DC 18 (10 + 8) -> CRITICAL SUCCESS. CRITICAL SUCCESS! Goblin is now Prone and takes 5 [5] bludgeoning -> 5 damage dealt. Goblin HP: 6 -> 1.
Valeros shoves Goblin: Athletics d20(5) + 10 (base) = 15 vs Fortitude DC 14 (10 + 4) -> SUCCESS. Goblin is pushed 5 ft to E3.
Goblin shoves Merisiel (Hidden): Flat Check d20(20) vs DC 11 -> PASSED. Shove proceeds.
Goblin shoves Merisiel: Athletics d20(20) + 3 (base) - 5 (MAP) = 18 vs Fortitude DC 15 (10 + 5) -> CRITICAL SUCCESS. (Natural 20: SUCCESS -> CRITICAL SUCCESS) CRITICAL SUCCESS! Merisiel is pushed 10 ft to I11.
Merisiel attempts to Grapple Goblin (Concealed): Flat Check d20(20) vs DC 5 -> PASSED. Grapple proceeds.
Merisiel attempts to Grapple Goblin: Athletics d20(20) + 4 (base) = 24 vs Fortitude DC 14 (10 + 4) -> CRITICAL SUCCESS. CRITICAL SUCCESS! Goblin is Restrained (Off-Guard, Immobilized) until the end of Merisiel's next turn.
Goblin attempts to Escape Merisiel (Hidden): Flat Check d20(20) vs DC 11 -> PASSED. Escape proceeds.
Goblin attempts to Escape (Unarmed Attack +8) from Merisiel: Unarmed Attack d20(20) + 8 (base) = 28 vs Athletics DC 14 (10 + 4) -> CRITICAL SUCCESS. CRITICAL SUCCESS! Goblin breaks free.
Valeros uses Stand. Actions left: 2.
[REACTION] Goblin uses Reactive Strike against standing Valeros!
Valeros is no longer Prone.
```

## Tests

- `tests/Rules/saves-skills.test.js` — defaults, authored values, Frightened to
  skills/saves/DCs, standard/greater/lesser cover to Reflex, `calculateDC`
  stacking, and Prone scopes.
- `tests/Actions/trip.test.js` — success, MAP use/advance, critical damage with
  IWR, critical failure, cover on Reflex DC, Frightened, Prone does not penalize
  the skill check, Concealed flat-check pass/fail, reach, action pool, ally and
  Undetected rejection.
- `tests/Actions/shove.test.js` — 5-ft success, 10-ft critical, Fortitude DC,
  MAP use/advance, wall stop, partial critical collapse, creature blocker,
  diagonal vector, critical-failure Prone, Concealed flat check, reach rejection,
  and pure `computePushPath` bounds/creature cases.
- `tests/Actions/grapple.test.js` — Grabbed + Immobilized + `sourceId`, Off-Guard
  AC modifier, Restrained superseding Grabbed, critical-failure Prone/release,
  grappler-next-turn expiry through the Encounter, break on Step, break on death,
  Concealed flat check, and reach rejection.
- `tests/Actions/escape.test.js` — best-of skill choice, success/removal,
  critical success, MAP use/advance, failure retaining the condition, Prone
  penalizing only Unarmed, Restrained, Frightened lowering the Athletics DC,
  not-grabbed rejection, defeated grappler auto-release, and Concealed flat
  check.
- `tests/Actions/stand.test.js` — action cost, condition removal, non-prone/no-
  action refusals, reaction trigger, reaction timing against prone AC, no
  reaction out of reach or with a spent reaction, first-reactor selection, and a
  defeating reaction leaving `prone`.
- `tests/Entities/conditions.test.js` — Immobilized blocks Stride and Step
  without spending an action; Grabbed/Restrained imply Immobilized; Grabbed/
  Restrained provide the Off-Guard AC penalty; condition source metadata
  survives `getCondition()` copies.
- `tests/Rules/weapon-traits.test.js` — Prone counts as Off-Guard for
  backstabber, and the prone AC penalty feeds the shared defence pipeline.

## Deferred

- Crawl.
- Shove's optional "move with the target" clause.
- Remastered's full Grapple critical-failure choice (reverse the grab or knock
  the attacker prone); the prototype uses attacker prone plus release.
- Area-effect spells that would consume the Reflex save path; the cover bonus is
  wired to both Reflex saves and Reflex DC, but no spell/area targeting exists
  yet.
- Non-movement reaction triggers and ranged Reactive Strikes.
