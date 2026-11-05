# Handoff

## Current milestone — Phase 8.3 (complete): Saves, Skills, Trip, Shove, Grapple, Escape

Status: **implemented and verified**.

- 8.1 — `Combatant.saves` (`fortitude`, `reflex`, `will`) and `skills`
  (`athletics`, `acrobatics`, `stealth`, `perception`), all defaulting to 0.
  `getSkillModifiers(name)`, `getSaveModifiers(name, { cover? })`, and
  `getDCModifiers(name, { cover? })` collect condition modifiers by scope.
  Frightened lowers skills, saves, and DCs. Standard/greater cover adds
  `+2/+4 circumstance` to Reflex saves and Reflex DC. `Checks.calculateDC` is
  `10 + base + resolved modifiers`.
- 8.2 — `prone` condition (Off-Guard `-2 circumstance` AC and `-2 circumstance`
  attack rolls), `Stand.performStand` (1 action, removes Prone), and the
  reactive-strike interrupt on Stand. The reaction resolves while the creature
  is still prone; a defeating reaction leaves `prone` in place.
- 8.3 (Trip slice) — `Trip.performTrip` / `evaluateTrip`: 1 action, attack
  trait, Athletics vs Reflex DC, current MAP applied and then advanced,
  Concealed/Hidden flat check before the Athletics check, Critical Success =
  Prone + 1d6 bludgeoning through IWR, Success = Prone, Critical Failure =
  attacker Prone. Trip is a skill check rather than an attack roll, so Prone's
  -2 attack penalty does not apply to it; MAP does.
- 8.3 (Shove slice) — `Shove.performShove` / `evaluateShove` /
  `computePushPath`: 1 action, attack trait, shared Athletics-vs-Fortitude-DC
  pipeline (`Actions/athletics-maneuver.js`), current MAP applied and advanced,
  Concealed/Hidden flat check, Success = 5-ft push, Critical Success = 10-ft
  push, Critical Failure = attacker Prone. The push vector is the sign-reduced
  attacker -> target line and stops before walls, creatures, or grid bounds. A
  blocked second square collapses 10 ft to 5 ft; a blocked first square is a
  successful 0-ft push. Forced movement does not provoke or change diagonal
  parity.
- 8.3 (Grapple/Escape slice) — `Grapple.performGrapple` applies `grabbed`
  (Critical Success: `restrained`) plus companion `immobilized`, both tagged
  with `sourceId` and `expiresOnSourceTurn = grappler.turnNumber + 1`.
  Critical Failure is the approved simplification: attacker Prone and any
  existing hold released. `Escape.performEscape` is 1 action, attack trait,
  best of Unarmed Attack / Athletics / Acrobatics, MAP applied and advanced,
  against the grappler's Athletics DC; success or critical success removes the
  condition pair. Held conditions expire at the end of the **grappler's next
  turn**, and break immediately when the grappler Strides, Steps, or is
  defeated.
- View — `Saves` and `Skills` rows in Selection, `Trip (MAP)` / `Shove (MAP)` /
  `Grapple (MAP)` modes with target highlights and full Athletics-vs-DC logs,
  `Stand` only while prone, `Escape (best skill + modifier)` only while
  grabbed/restrained, `Grabbed`/`Restrained`/`Immobilized` badges, a 90-degree
  rotated prone token, a red dashed ring + chain marker for immobilized tokens,
  and `[REACTION] ... against standing <name>!` log lines.
- Earlier milestones (7.1–7.3, 6.x, 5.x, 3.2, 4.x) remain implemented:
  typed weapon damage (`{ formula, type }`), pure
  `IWR.applyIWR({ damageInstances, immunities, weaknesses, resistances })`
  with the fixed **Immunity -> Weakness -> Resistance** order, `Combatant`
  IWR arrays and `takeDamage(amount, { type })`, IWR integration in Strike and
  Reactive Strike, an explicit IWR combat-log chain, a Selection-panel IWR row,
  and the three-column Combat Log / Battlefield / Controls layout.
- 6.2 — `concealed` / `hidden` / `undetected` conditions, pure
  `evaluateFlatCheck`, visibility flat checks before Strike and Reactive Strike,
  Undetected targeting rejection, Hidden/Undetected attacker Off-Guard,
  condition badges, 50% token opacity, hover badges, and flat-check logs.
- 6.1 — canonical cover geometry (`src/Core/Grid/cover.js`), lesser/standard/
  greater cover through the circumstance modifier pipeline, 4-ray no-LoS,
  `Take Cover` action and `greater-cover` condition, hover badges/rays,
  Take Cover button, suppressed-bonus logs, and movement/turn expiry.
- 5.5 — reaction budget on `Combatant`, automatic Reactive Strike when a Stride
  leaves a threatened square, Step immunity, reaction diamonds, and reaction
  combat-log entries.
- 5.4 — Raise a Shield action, `shield-raised` condition (+2 circumstance AC),
  start-of-turn shield reset, action button, badges, and log breakdown.
- 5.1/5.2 — flanking geometry, Off-Guard, Frightened, and condition badges.
- 3.2/4.x — typed modifier resolver; Strike attack and defense values flow
  through it and the combat log expands both sides of the equation.

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
  - `evaluateFlatCheck({ d20?, dc, rollD20?, rollDie? })` →
    `{ passed, d20, dc }` with no modifiers. `d20 >= dc` passes. Concealed uses
    DC 5 and Hidden DC 11. A deterministic callback may replace the explicit
    d20; otherwise `Math.random` is used.
  - `calculateDC(baseValue, modifiers)` → `10 + baseValue + resolved modifiers`;
    `resolveDC` returns the full resolver audit. Both use the central typed
    modifier resolver, so Frightened and cover do not stack incorrectly.
  - `checks.js` now loads after `modifiers.js` in both HTML entry points.
- `Rules/map.js`
  - `multipleAttackPenalty(attacksMade, agile)` → `0 / −5 / −10` or `0 / −4 / −8`.
- `Rules/damage.js`
  - Damage formula parsing, dice rolling, clamping, critical doubling helper.
  - `parseDamageSpec(input, fallbackType)` accepts `"1d8+4"` or
    `{ formula: "1d8+4", type: "slashing" }` and returns frozen
    `{ formula, type }`. `formatDamageSpec()` and `normalizeDamageType()` are
    exported. A plain string is `untyped`, preserving pre-7.1 behaviour.
- `Rules/iwr.js`
  - Pure `applyIWR({ damageInstances, immunities, weaknesses, resistances })`.
  - Fixed order per instance: Immunity -> Weakness -> Resistance. Immunity
    zeroes the instance and skips the later steps. Weakness adds once per attack
    for an applicable type. Resistance subtracts and floors at 0.
  - Supports `"all"`, string/object immunity authoring, array/object
    weakness/resistance authoring, and highest-value duplicate resolution.
  - Returns `{ totalDamage, baseTotal, breakdown, appliedIWR }`; each breakdown
    entry records amount, immune, weakness, resistance, resistanceApplied,
    afterImmunity, afterWeakness, finalAmount, and ordered steps.
- `Rules/weapon-traits.js`
  - `normalizeTraits` accepts `["reach", "deadly-d8", "fatal-d10"]`,
    spaced labels, object form `{ name: "deadly", dieSize: 8 }`, and a
    `Combatant.weapon` object.
  - `getReachFeet()` is 5 ft, or 10 ft with `reach`.
  - `calculateWeaponDamage({ weapon, degree, isOffGuard, rollDie })` returns
    `null` on failure; otherwise `baseTotal`, `doubledBase`, `backstabber`,
    `fatal`, `deadly`, `extras`, `extrasTotal`, `multiplier`, and `total`.
  - Fatal replaces the base die before doubling and adds a non-doubled fatal
    die. Deadly adds a non-doubled die. Backstabber is +1 and is doubled with
    the base on a critical success.
- `Entities/persistent-damage.js`
  - Pure helpers for creating, adding, removing, querying, and ticking
    persistent damage instances.
  - Same-type instances never stack; `formulaWeight` compares average damage
    and keeps the stronger formula.
  - `tickPersistentDamage` rolls damage, calls `takeDamage(amount, { type })`,
    then `evaluateFlatCheck({ dc: 15 })` per instance and returns a structured
    audit.
- `Grid/flanking.js`
  - `isFlanked(target, attacker, allies, gridMap)` → boolean.
  - `getFlankingAllies(...)` → opposing able creatures.
  - Requires both creatures to be hostile, not defeated, within their own melee
    reach of the target, and on exactly opposite sides or corners of the target.
    A `reach` weapon (10 ft) can flank from two squares away when the geometry
    holds. Each flanker is measured by its own reach; an explicit `reachFeet`
    option still overrides both.
  - `gridMap` optional; when supplied, all cells must be in bounds.
- `Grid/cover.js`
  - `determineCover(attacker, target, gridMap, combatants)` evaluates the four
    attacker corners, casts four corner-to-corner rays each, and keeps the corner
    with the fewest wall-blocked rays.
  - A ray is wall-blocked only when it crosses the **interior** of an obstacle;
    edge/corner touches do not block.
  - 1–2 blocked rays → standard (+2 circumstance AC); 3 → greater (+4);
    4 → `lineOfSight: false`; 0 blocked + a ray through another able creature →
    lesser (+1).
  - Returns `{ degree, acBonus, label, bestCorner, rays, blockedRaysCount,
    creatureCover, creatureCoverCells, lineOfSight, noLineOfSight }`.
  - `getBestCover(defender, combatants, gridMap)` helps the Take Cover button;
    `coverModifier(cover)` returns the resolver contract; defeated creatures are
    ignored as cover sources.
  - `coverReflexModifier(cover)` returns `+2/+4 circumstance` for standard/
    greater cover and `null` for lesser/none. Used by Reflex saves and Reflex DC.
- `Entities/conditions.js`
  - `off-guard`: `-2 circumstance` AC.
  - `prone`: Off-Guard (`-2 circumstance` AC with source `off-guard`) plus a
    `-2 circumstance` penalty to attack rolls with source `prone`. No Reflex/
    Fortitude/Will DC penalty.
  - `grabbed`: Off-Guard (`-2 circumstance` AC with source `off-guard`, name
    `Off-Guard (Grabbed)`) plus Immobilized. The record carries `sourceId` and
    `expiresOnSourceTurn`.
  - `restrained`: the same tactical effects as `grabbed` (name
    `Off-Guard (Restrained)`); Restrained supersedes Grabbed from the same
    grappler.
  - `immobilized`: no modifiers of its own; Stride, Step, and Stand refuse to
    run while it is present. Grabbed/Restrained are treated as Immobilized by
    `Conditions.isImmobilized()` even without the companion record.
  - Scope tags support `"attack"`, `"ac"`, `"check"`, `"skill:<name>"`,
    `"save:<name>"`, `"dc:<name>"`, `"all"`, and arrays of scopes. Frightened
    contributes once per condition even when several scopes are requested.
  - `frightened N`: `-N status` to checks and DCs (attacks, skills, saves, AC,
    and defence DCs in this engine).
  - `shield-raised`: `+2 circumstance` AC until the start of the raiser's next
    turn. It contributes no attack-roll modifier.
  - `greater-cover`: `+4 circumstance` AC from Take Cover until the start of the
    creature's next turn or its next Stride/Step.
  - `concealed`, `hidden`, `undetected`: visibility states with **no AC
    modifiers**. Concealed requires a DC 5 flat check to target; Hidden DC 11;
    Undetected cannot be targeted directly. Hidden supersedes Concealed and
    Undetected supersedes both.
  - `getVisibility(combatant)` → `{ condition, label, flatCheckDC, targetable,
    undetected }`; `isHiddenAttacker(combatant)` is true for Hidden/Undetected;
    `visibilityFlatCheckDC(name)` exposes the DC table.
  - `createCondition`, `conditionModifiers(condition, scope)`, definitions, and
    defensive copies.
- `Entities/combatant.js`
  - New `conditions` Map plus `addCondition`, `removeCondition`,
    `getCondition`, `hasCondition`, `getConditions`, `getConditionModifiers`.
  - `saves` (`fortitude`, `reflex`, `will`) and `skills` (`athletics`,
    `acrobatics`, `stealth`, `perception`) default to 0. `getSaves()` /
    `getSkills()` copy them; `getSaveModifier()` / `getSkillModifier()` return a
    single value.
  - `getSkillModifiers(skill, { extraModifiers? })`,
    `getSaveModifiers(save, { cover?, extraModifiers? })`, and
    `getDCModifiers(dc, { cover?, extraModifiers? })` collect scoped condition
    modifiers and append cover for Reflex. `getDCModifiers("ac")` also includes
    AC-scope conditions. Attack-roll modifiers such as Prone do not apply to
    skill checks; an Attack-trait skill action uses MAP but is still a skill
    check.
  - `turnNumber` starts at 0 (or an authored value) and increments at the start
    of every `resetTurn()`. Grapple expiry is expressed against it.
  - `addCondition(name, value?, { sourceId?, expiresOnSourceTurn? })` preserves
    the source metadata on the stored record; `getCondition()` copies it.
  - `releaseGrappleFrom(sourceId)` immediately removes Grabbed/Restrained (and
    the companion Immobilized when no grapple remains) applied by that source.
    `expireGrapplesFrom(sourceId, sourceTurnNumber)` removes them only when
    `sourceTurnNumber >= expiresOnSourceTurn`.
  - `isImmobilized()` and `getGrappleCondition()` expose the movement lock and
    the active Restrained-before-Grabbed condition.
  - `tickConditions()` / `endTurn()` decrease Frightened by 1 and remove it at 0.
  - `endTurn(options)` also ticks every persistent damage instance: damage
    through IWR, then a DC 15 recovery flat check. It accepts
    `{ combatants }` and expires/breaks the grapples this combatant maintains.
    Returns `{ frightened, changed, persistentTick, persistentChanged,
    releasedGrapples }`.
  - Persistent store methods: `addPersistentDamage`, `removePersistentDamage`,
    `hasPersistentDamage`, `getPersistentDamage`, `clearPersistentDamage`.
  - Weapon traits: `traits` (canonical slugs), `traitDefinitions`,
    `hasTrait(name)`, `getTrait(name)`, `getTraitLabels()`, `getTraits()`,
    `getWeapon()`, and `getReachFeet()` (5 or 10 with `reach`).
  - `resetTurn(options)` ticks conditions by default; `{ tickConditions: false }`
    is used by Encounter for the incoming combatant.
  - `resetTurn()` unconditionally removes `shield-raised` and `greater-cover`,
    including when the Frightened tick is suppressed. This models "until the
    start of your next turn" without expiring the shield/cover at the end of the
    turn it was raised.
  - HP, AC, attack, MAP, and defeat fields retained from Phase 3.
  - Typed damage: `damage` remains the formula string, with `damageType` and
    `damageSpec` alongside it. The constructor accepts
    `{ formula, type }`, a plain string + `damageType`, or the legacy string.
  - `immunities` (`["fire"]`), `weaknesses` (`[{ type, value }]`), and
    `resistances` (`[{ type, value }]`), normalized by `Rules/iwr.js` and
    exposed through `getIWR()`.
  - `takeDamage(amount, { type, damageInstances, applyIWR })` runs IWR against
    the combatant's own arrays. The result keeps `damageTaken` as actual HP lost
    and adds `damageApplied` (post-IWR), `baseDamage`, and the `iwr` audit.
  - `maxReactions` (default 1) and `reactionsRemaining`, with
    `canSpendReaction()` and `spendReaction()` mirroring the action API.
  - `resetTurn()` restores `reactionsRemaining` to `maxReactions` at the start
    of the combatant's own turn.
- `Actions/take-cover.js`
  - `performTakeCover({ combatant, map, combatants, attacker? })` spends 1 action,
    requires standard cover or better (from the supplied attacker or the best
    living hostile), and applies/refreshes `greater-cover` (+4 circumstance AC).
  - Refuses with `no-actions` or `insufficient-cover` and spends nothing.
  - `canTakeCover()` exposes the geometry check for the View button.
- `Actions/raise-shield.js`
  - `performRaiseShield({ combatant })` spends 1 action and applies or refreshes
    the `shield-raised` condition.
  - Returns `{ ok: true, actionsLeft, condition }` or
    `{ ok: false, reason: "no-actions" }`.
  - Raising a shield that is already raised still spends an action but does not
    stack the AC bonus.
- `Actions/trip.js`
  - `performTrip({ attacker, target, map, combatants, allies, reachFeet,
    agile, cover, damage, rollD20, rollDamageDie })` spends 1 action, resolves
    the Concealed/Hidden flat check, rolls Athletics with Frightened and the
    current MAP against the target's Reflex DC, advances `attacksThisTurn`
    after the check, and applies `prone` / 1d6 bludgeoning / attacker `prone` by
    degree. A failed flat check still spends the action and advances MAP.
  - `evaluateTrip()` returns validation, the Athletics modifier, Reflex DC, cover,
    and reach without spending an action or rolling. It reuses
    `Strike.evaluateStrike` for reach/LoS/visibility and `Checks.resolveDC` for
    the defence.
  - Critical damage uses `Damage.rollDamage` and `takeDamage(..., { type:
    "bludgeoning" })`, so IWR is applied once through the canonical pipeline.
  - Requirements needing hands/size are not enforced (documented limitation).
- `Actions/athletics-maneuver.js`
  - Shared 1-action Athletics-vs-Fortitude-DC pipeline for Shove and Grapple:
    reach/LoS/visibility validation through `Strike.evaluateStrike`, skill
    modifiers, MAP, `Checks.resolveDC`, the Concealed/Hidden flat check, and the
    action/MAP spend.
  - `evaluate()` returns the full check audit without mutating state;
    `resolveCheck()` rolls the flat check and d20; `advanceMap()` spends the
    action and increments `attacksThisTurn`.
- `Actions/shove.js`
  - `performShove` / `evaluateShove`: 1 action, attack trait, Athletics vs
    Fortitude DC. Success pushes 5 ft, Critical Success 10 ft, Critical Failure
    makes the attacker Prone.
  - `getPushDirection(attacker, target)` reduces the centre-to-centre line to one
    of the eight grid directions; `computePushPath({ target, map, direction,
    squares, combatants })` walks it and stops before bounds, walls, or another
    creature. It returns `path`, `destination`, `pushedSquares`, `pushedFeet`,
    `blockedAt`, and `blockedReason`.
  - The result exposes `pushPath`, `pushedFeet`, `blockedReason`,
    `stoppedEarly`, `targetPositionBefore/After`, plus the full Athletics/
    Fortitude audit. Forced movement does not provoke or touch diagonal parity.
- `Actions/grapple.js`
  - `performGrapple` / `evaluateGrapple`: 1 action, attack trait, Athletics vs
    Fortitude DC. Success applies `grabbed`; Critical Success applies
    `restrained`; Critical Failure makes the attacker Prone and releases any
    existing hold.
  - `applyGrappleCondition(target, name, source)` stamps both the parent
    condition and `immobilized` with `{ sourceId, expiresOnSourceTurn:
    source.turnNumber + 1 }`. Restrained removes a same-source Grabbed and an
    ordinary success never downgrades Restrained.
  - `releaseGrapplesFromSource(source, combatants)` adapts the roster to
    `Combatant.releaseGrappleFrom`.
- `Actions/escape.js`
  - `performEscape` / `evaluateEscape`: 1 action, attack trait, only while
    Grabbed/Restrained. Rolls the best of Unarmed Attack / Athletics /
    Acrobatics against the grappler's Athletics DC; MAP applies and advances.
    Success/Critical Success removes the condition pair.
  - `getEscapeOptions(actor, mapPenalty)` resolves all three candidates through
    the modifier pipeline and picks the highest total (ties: higher base, then
    Unarmed -> Athletics -> Acrobatics).
  - A defeated grappler releases the hold without spending an action
    (`reason: "source-defeated"`). Concealed/Hidden grapplers impose their flat
    check before the Escape roll.
- `Actions/stand.js`
  - `performStand({ combatant, map, combatants, reachFeet, rollD20,
    rollDamageDie })` spends 1 action, scans threatened enemies with reactions,
    resolves the first Reactive Strike while the creature is still prone, then
    removes `prone` if the creature survives.
  - Returns `{ ok, actionsLeft, wasProne, proneRemoved, reactions, reaction,
    defeated, reactionTrigger }`. Refuses with `not-prone`, `no-actions`,
    `immobilized`, or `defeated` without spending.
  - `isProne()` / `canStand()` expose the View button state.
- `Actions/strike.js`
  - Attack side: `attackBonus` base + attacker conditions with attack scope
    (Frightened) + MAP [untyped].
  - Defense side: base AC + target conditions with AC scope (Off-Guard,
    Frightened, Shield Raised, Greater Cover) + geometric cover + Off-Guard from
    flanking or from a Hidden/Undetected attacker (never doubled).
  - A visibility flat check is resolved after validation and before the attack
    roll. Concealed = DC 5, Hidden = DC 11; the stricter Hidden check wins when
    both are present. A failed check spends 1 action, increments
    `attacksThisTurn`, rolls no attack die, deals no damage, and returns
    `{ ok: true, hit: false, automaticMiss: true, flatCheck }`.
  - An Undetected target is rejected as `target-undetected` before any dice or
    resource spend. A Hidden/Undetected attacker injects
    `{ name: "Hidden Attacker", type: "circumstance", value: -2,
    source: "off-guard" }` through `collectDefenseModifiers`.
  - `rollFlatCheck()` may be injected for deterministic tests; otherwise the
    flat check falls back to `rollD20`, then `rollDie(20)`, then `Math.random`.
  - A circumstance bonus and a circumstance penalty of the same type resolve
    independently, so Shield Raised (+2) and Off-Guard (-2) both apply and net
    to 0 while still appearing in the breakdown.
  - Cover is evaluated before the roll. `evaluateStrike` rejects 4 blocked rays
    as `no-line-of-sight`; otherwise it reports `cover`, `coverDegree`,
    `coverBonus`, `coverRays`, `flanked`, `flankers`, and `offGuard` without
    spending an action.
  - `performStrike` returns `attackModifiers`, `attackBreakdown`,
    `targetACBase`, final `targetAC`/`dc`, `targetACModifiers`,
    `suppressedACModifiers`, `targetACBreakdown`, `cover`, `coverDegree`,
    `coverBonus`, `coverRays`, `blockedRaysCount`, `flanked`, `flankers`,
    `offGuard`, `flatCheck`, `visibility`, and `hiddenAttacker`.
  - Shield Raised + Standard Cover = +2 net (one circumstance bonus suppressed);
    Shield Raised + Greater Cover = +4 net.
  - Damage uses `Strike.normalizeWeaponSpec()` (formula, type, traits) and
    `WeaponTraits.calculateWeaponDamage()`. Per-Strike `damage` may be a string
    or an object; `damageType` overrides the type; `weapon`/`traits` override
    the authored weapon. The plain-string path stays `untyped`.
  - Critical doubling and fatal/deadly/backstabber extras happen before IWR. The
    target receives `takeDamage(damage.total, { type: damage.type })`.
  - Result fields: `damage.type`, `damage.fatal`, `damage.deadly`,
    `damage.backstabber`, `damage.doubledBase`, `damage.extras`, `iwr` (the
    target audit), `damageDealt` (post-IWR), and `hpDamage` (actual HP lost).
  - Reach comes from `Strike.resolveReachFeet()`: an explicit `reachFeet`
    override, else `attacker.getReachFeet()` / authored traits, else 5 ft.
  - Exports `collectAttackModifiers`, `collectDefenseModifiers`, `rollAttack`,
    `resolveDamageDie`, `resolveReachFeet`, `normalizeDamageSpec`, and
    `normalizeWeaponSpec` so Reactive Strike shares the exact same pipeline.
- `Actions/reactive-strike.js`
  - `performReactiveStrike({ attacker, target, map, combatants, rollD20,
    rollDamageDie })` spends 1 reaction and resolves a full melee Strike.
  - Uses `Strike.evaluateStrike()` for target/alliance/reach/LoS validation and
    `Modifiers.resolveModifiers()` for both attack and AC.
  - Never applies MAP and never increments `attacksThisTurn`.
  - Uses the shared typed damage and weapon-trait calculator and therefore
    applies the target's IWR through `takeDamage(amount, { type })`; the result
    includes `damage.type`, trait breakdown fields, and `iwr`.
  - Uses the shared visibility flat check. A failed check spends the reaction
    but still does not touch MAP.
  - Fails with `{ ok: false, reason: "no-reaction" }` without spending or
    rolling when the reaction pool is empty.
  - Returns the normal Strike result plus `reaction`, `reactionTrigger`,
    `reactionSpent`, `attackerName`, `targetName`, and `reactionsLeft`.
  - `findThreatenedEnemies({ mover, cell, combatants, reachFeet })` returns the
    ordered living hostiles with a reaction that threaten a cell. Each candidate
    uses its own `getReachFeet()` when no explicit override is supplied.
- `Actions/stride.js`
  - Rejects immobilized/grabbed/restrained creatures with `reason:
    "immobilized"` before spending an action.
  - Scans the square being left before each route step; the first eligible enemy
    automatically triggers.
  - A failed reaction attempt (for example no line of sight) spends nothing and
    the scan continues with the next enemy.
  - A defeated mover stops on the square it was leaving; `movementInterrupted`,
    `stoppedAt`, `movedPath`, `movedCostFeet`, and `movedDiagonalSteps` report
    the partial movement.
  - `reactions` / `reaction` expose the successful Reactive Strike results for
    logging.
  - A successful Stride removes `greater-cover` because Take Cover ends when the
    creature moves, and releases every grapple the mover maintains
    (`releasedGrapples`).
- `Actions/step.js`
  - Rejects immobilized/grabbed/restrained creatures with `reason:
    "immobilized"`.
  - Still a flat 5-ft move and deliberately never enters the reaction scan. Step
    therefore never provokes Reactive Strike.
  - A successful Step also removes `greater-cover` and releases every grapple
    the mover maintains.
- `Encounter/encounter.js`
  - Calls `previous.endTurn({ combatants })` before advancing, so Frightened
    decays, persistent damage resolves, and source-linked grapples expire at the
    end of the correct creature's turn.
  - `releaseGrapplesFromDefeated()` runs before each advance, so a slain
    grappler cannot keep a victim immobilized.
  - `nextTurn()` exposes `releasedGrapples` from both death cleanup and
    end-turn expiry; optional die callbacks are forwarded to `endTurn()`.
  - Exposes `persistentTick` in the `nextTurn()` result alongside
    `conditionTick`.
  - Incoming combatants reset with `{ tickConditions: false }` to avoid a
    premature tick at the start of an encounter or turn.
  - Defeated skipping and round wrapping unchanged.

### View (`src/View/`, `src/main.js`)

- Three-column workspace: the Combat Log owns the fixed left column and scrolls
  independently, the canvas battlefield is centred, and the initiative,
  combatant, action, and Selection panels occupy the right column. The page
  itself does not scroll on desktop; the responsive breakpoint at 1040px stacks
  the columns.
- The Selection panel shows `Saves`, `Skills`, `Attack`, `Weapon`, `Traits`,
  `Reach`, and `IWR` rows. Examples:
  `Saves: Fort +9 | Ref +6 | Will +5`,
  `Skills: Athletics +10 | Acrobatics +6 | Stealth +2 | Perception +7`,
  `Weapon: 1d8+4 slashing [reach, backstabber, deadly d8]`, `Reach: 10 ft`,
  `Immune: fire | Weak: slashing 2 | Resist: piercing 2`.
- The action bar has `Trip (MAP)`, `Shove (MAP)`, and `Grapple (MAP)` modes,
  plus `Stand` and `Escape (best skill)` buttons. Shove/Grapple highlight
  hostile tokens in reach and the hover shows the Athletics-vs-Fortitude-DC
  line. Stand is enabled only while the active combatant is prone, has an
  action, and is not immobilized. Escape is shown only while the active
  combatant is grabbed/restrained and shows the chosen best option, e.g.
  `Escape (Unarmed Attack +8)`, with MAP, Athletics DC, and any flat-check DC in
  the tooltip.
- Trip logs the full check, e.g.
  `Merisiel attempts to Trip Goblin: Athletics d20(15) + 4 (base) = 19 vs Reflex DC 18 (10 + 8) -> SUCCESS. Goblin is now Prone.`
  plus `MAP now -5 · Actions left: 2.` A critical success appends the IWR
  damage chain and HP change; a critical failure applies `Prone` to the
  attacker.
- Shove logs e.g.
  `Valeros shoves Goblin: Athletics d20(5) + 10 (base) = 15 vs Fortitude DC 14 (10 + 4) -> SUCCESS. Goblin is pushed 5 ft to E3.`
  A critical success pushes 10 ft; a partially blocked push appends
  `The push stops early at a wall.`
- Grapple logs e.g.
  `Merisiel attempts to Grapple Goblin: Athletics d20(20) + 4 (base) = 24 vs Fortitude DC 14 (10 + 4) -> CRITICAL SUCCESS. CRITICAL SUCCESS! Goblin is Restrained (Off-Guard, Immobilized) until the end of Merisiel's next turn.`
- Escape logs e.g.
  `Goblin attempts to Escape (Unarmed Attack +8) from Merisiel: Unarmed Attack d20(20) + 8 (base) = 28 vs Athletics DC 14 (10 + 4) -> CRITICAL SUCCESS. CRITICAL SUCCESS! Goblin breaks free.`
- End Turn reports grapple expiry and death cleanup, e.g.
  `Grapple ends for Goblin — Grabbed, Immobilized.`
- Stand logs `Merisiel uses Stand. Actions left: 0.` and, when provoked,
  `[REACTION] Goblin uses Reactive Strike against standing Merisiel!` followed
  by the normal attack/damage breakdown and reaction spend. A surviving stander
  logs `Merisiel is no longer Prone.`.
- `Prone` appears as a condition badge on token cards and initiative rows. A
  prone canvas token is rotated 90 degrees while its HP bar and name plate stay
  upright. Grabbed/Restrained/Immobilized tokens additionally get a red dashed
  outer ring and a chain marker (the token is not rotated for those states).
- Strike/Reactive Strike damage lines expand the IWR chain:
  `Damage: 8 slashing -> Weakness +5 (slashing) -> Resistance -3 (slashing) -> 10 damage dealt. Goblin HP: 16 -> 6.`
  or `Damage: 8 fire -> IMMUNE -> 0 damage dealt.` A critical adds
  `(base 9 × 2)` after the post-IWR amount. Backstabber is included in the
  pre-doubled base.
- A separate `TRAITS` log line explains fatal replacement, deadly/fatal extra
  dice, and backstabber, e.g.
  `TRAITS — Valeros: Base (9 + 1 Backstabber) × 2 = 20 + Deadly 1d8 (5) = 25 slashing.`
- Token cards and initiative rows show condition badges:
  `Off-Guard`, `Frightened 1`, `Shield Raised`, `Greater Cover`,
  `Concealed`, `Hidden`, `Undetected`, `Grabbed`, `Restrained`,
  `Immobilized`, plus persistent badges such as `Persistent Fire 1d6` and
  `Persistent Bleed 1d4`.
- End Turn logs persistent damage in separate blocks:
  `[PERSISTENT DAMAGE] Goblin takes 1 [1] bleed -> 1 damage dealt. Goblin HP: 6 -> 5.`
  `Recovery Check: Flat Check d20(2) vs DC 15 -> FAILED (Bleed persists).`
- Tokens with `Hidden` or `Undetected` render at 50% opacity on the canvas.
- Initiative rows show action circles and reaction diamonds. Token cards use the
  same action/reaction pools; spent reactions render as grey diamonds.
- The selection panel includes `Conditions`, `Cover`, and `Reactions` rows.
- The action bar has `Raise Shield` and `Take Cover` buttons. Raise Shield spends
  1 action and becomes `Shield Raised ✓`; Take Cover is enabled only with
  standard cover or better and an action left, spends 1 action, and becomes
  `Greater Cover ✓`.
- The combat log reports `Valeros uses Raise a Shield. Actions left: 2.` and
  `Valeros uses Take Cover (standard cover detected). Actions left: 2.`, plus a
  non-stacking note for a repeat raise.
- Strike hover shows the attacker's actual reach. A 10-ft reach attacker
  highlights and can Strike targets two squares away; out-of-reach feedback
  reports the actual reach rather than a hard-coded 5 ft.
- Strike hover on a flanked target draws orange corner brackets and a
  `FLANKED (-2 AC)` badge. A covered target adds
  `LESSER/STANDARD/GREATER COVER (+1/+2/+4 AC)` and draws the cover rays from the
  best attacker corner.
- A Concealed target adds `FLAT CHECK DC 5`, a Hidden target `FLAT CHECK DC 11`.
  A Hidden/Undetected attacker adds `TARGET OFF-GUARD (-2 AC)`. An Undetected
  target uses a red `CANNOT TARGET UNDETECTED` label and a `not-allowed` cursor.
- A failed flat check logs
  `Valeros attacks Goblin (Concealed): Flat Check d20(4) vs DC 5 -> FAILED. Attack missed. Action spent, MAP increased.`
  A passed check logs `... -> PASSED. Strike proceeds.` before the normal attack
  line. A Hidden attacker appears in the AC breakdown as
  `- 2 Off-Guard (Hidden Attacker) [circumstance]`.
- The combat log expands attack and defense modifiers and marks suppressed
  circumstance bonuses:

```text
Valeros strikes Goblin: d20(13) + 9 (base) - 5 (MAP) = 17 vs AC 13 (16 - 2 Off-Guard [circumstance] - 1 Frightened 1 [status]) -> SUCCESS.
Merisiel strikes Goblin: d20(10) + 8 (base) = 18 vs AC 18 (16 + 2 Shield Raised [circumstance]) -> SUCCESS.
Valeros strikes Goblin: d20(12) + 9 (base) = 21 vs AC 20 (16 + 2 Shield Raised [circumstance] + 2 Standard Cover [circumstance · suppressed]) -> SUCCESS.
```

- A separate info line reports flanking and the flanking ally.
- A Stride or Step after Take Cover logs `<name> loses Greater Cover after
  moving.`
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
- Valeros starts behind the central wall relative to the Goblin, so the Take
  Cover button is enabled immediately and grants the Greater Cover badge. The
  wall blocks centre LoS, so this also demonstrates why cover is evaluated with
  corner rays rather than only the centre ray.

### Authored demo stats (`src/main.js`)

| Combatant | HP | AC | Attack | Damage | Agile | Saves (F/R/W) | Skills (Ath/Acr/Ste/Per) | Traits / Persistent | IWR |
|---|---|---|---|---|---|---|---|---|---|
| Valeros | 20 | 18 | +9 | 1d8+4 slashing | no | +9/+6/+5 | +10/+6/+2/+7 | reach, backstabber, deadly d8 | — |
| Merisiel | 16 | 17 | +8 | 1d6+2 piercing | yes | +5/+9/+6 | +4/+9/+10/+8 | — | — |
| Goblin | 6 | 16 | +8 | 1d6+1 slashing | yes | +4/+8/+3 | +3/+7/+8/+5 | Persistent Fire 1d6, Persistent Bleed 1d4 | Immune: fire · Weak: slashing 2 · Resist: piercing 2 |

The demo is positioned so Trip and Stand can be demonstrated quickly: Merisiel
starts adjacent to the Goblin, so on her turn Trip resolves against Reflex DC 18
(10 + 8) and a critical failure makes her prone. The `Stand` button then enables,
and standing provokes the Goblin's Reactive Strike while she is still prone. The
same adjacency lets Merisiel demonstrate Shove and Grapple: Grapple applies
Grabbed/Restrained to the Goblin, and on the Goblin's next turn the `Escape`
button appears with its best option and Athletics DC. The Goblin's `Reflex +8`
and `Acrobatics +7` and Valeros' `Athletics +10`/`Fortitude +9` are authored
specifically for these checks.

The Goblin additionally starts with `Frightened 1` and `Concealed`; its base AC
remains 16. Merisiel starts `Hidden`: attacks against her need a DC 11 flat
check, her token renders at 50% opacity, and her own attacks make the target
Off-Guard in the AC breakdown. The Goblin's authored IWR demonstrates all three
branches: Valeros' slashing damage gains +2, Merisiel's piercing damage loses 2,
and fire damage is negated. Valeros has a 10-ft reach weapon, so the Strike
highlight reaches two squares; his backstabber/deadly traits add damage on
Off-Guard and critical hits. The Goblin's persistent fire demonstrates immunity
(`0 damage dealt`) while persistent bleed shows a real end-of-turn tick.

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
20. **Cover is not AC subtraction.** `determineCover` produces a typed
    circumstance modifier that flows through `resolveModifiers`, so it never
    stacks with Shield Raised or Take Cover.
21. **Wall rays block only through a cell interior.** An edge/corner touch does
    not count. This keeps the corner-to-corner rule deterministic and matches the
    Remastered "draw lines to the target's corners" procedure.
22. **The attacker picks the best corner.** The corner with the fewest blocked
    rays wins; ties keep the NW/NE/SW/SE iteration order.
23. **Creature cover is lesser and only when no wall blocks a ray.** Defeated
    creatures, the attacker, and the target are excluded.
24. **Take Cover requires standard cover or better.** Lesser creature cover is
    insufficient. The action grants +4 until the start of the next turn or the
    next Stride/Step; `resetTurn()` and successful movement clear it.
25. **Visibility conditions do not modify AC.** `concealed`, `hidden`, and
    `undetected` contribute no modifiers. Their effect is a pre-attack flat
    check (DC 5 / DC 11) or a targeting rejection (Undetected).
26. **The flat check precedes the attack roll.** A failure still spends the
    action and advances MAP for a normal Strike, but produces no attack d20 and
    no damage. A success continues through the ordinary attack pipeline.
27. **Hidden/Undetected attacker = Off-Guard on the target.** The penalty is a
    single `-2 circumstance` modifier with source `off-guard` and name
    `Hidden Attacker`, so it never stacks with flanking or a pre-existing
    Off-Guard condition.
28. **Reactive Strike keeps its no-MAP contract.** A failed visibility flat
    check spends the reaction; it never uses or increments MAP.
29. **Undetected is a targeting rule, not a miss.** The attempt returns
    `target-undetected` before spending an action, reaction, or MAP.
30. **IWR is one pure pipeline.** `applyIWR` is the only place that applies
    Immunity, Weakness, and Resistance. `Combatant.takeDamage` calls it; Strike
    and Reactive Strike do not duplicate the math.
31. **The order is fixed.** Base and critical damage resolve first, then
    Immunity (short-circuits to 0), then Weakness (+value), then Resistance
    (-value, floored at 0). An immune instance never benefits from weakness or
    resistance to the same type.
32. **Weakness applies once per attack per type.** Repeated instances of the
    same type in one attack receive the weakness bonus only on the first
    instance. Different types each get their own weakness.
33. **Resistance is per instance and cannot heal.** Each instance is floored at
    0 independently, so a large resistance never turns damage into healing.
34. **A plain damage string is `untyped`.** This keeps all pre-7.1 tests and
    callers valid without silently granting a physical damage type. Typed demo
    combatants opt in with `{ formula, type }` or `damageType`.
35. **`damageTaken` stays actual HP loss.** Strike's `damageDealt` is the
    post-IWR amount before HP clamping; `hpDamage` is the actual HP lost. This
    preserves overkill reporting from Phase 4.
36. **The log is the audit, not a paraphrase.** The View prints the same
    `applyIWR` breakdown used by the core, including the actual resisted amount
    when resistance exceeds the available damage.
37. **Persistent damage ticks once per type at end of turn.** Damage resolves
    before the DC 15 recovery flat check. There is no critical-failure penalty.
38. **Same-type persistent damage never stacks.** The stronger average formula
    replaces the weaker one; different types are independent instances with
    separate damage rolls and recovery checks.
39. **Persistent damage reuses the IWR pipeline.** `tickPersistentDamage` calls
    `Combatant.takeDamage(amount, { type })`; it never duplicates the
    Immunity -> Weakness -> Resistance math.
40. **Reach is per creature.** Strike, threatened cells in Reactive Strike, and
    flanking each read `getReachFeet()`/authored traits. An explicit `reachFeet`
    option remains the single override point for tests and special effects.
41. **Fatal and deadly extras are not doubled.** Fatal replaces the base die
    before `× 2`; its extra die and the deadly die are added after the
    multiplier. Backstabber is part of the base and is therefore doubled.
42. **Weapon traits share one calculator.** Strike and Reactive Strike both call
    `WeaponTraits.calculateWeaponDamage()`; neither duplicates fatal/deadly/
    backstabber arithmetic.
43. **A defended DC is `10 + base + resolved modifiers`.** `calculateDC` uses
    the same typed resolver as attacks. Frightened is status; cover is
    circumstance; same-type bonuses do not stack.
44. **Frightened applies to every check and DC.** That now includes skills,
    saving throws, Reflex/Fortitude/Will DCs, attack rolls, and AC. It is
    contributed once per condition even when a caller requests several scopes.
45. **Prone is Off-Guard plus an attack penalty.** Its AC contribution uses
    source `off-guard` so it never doubles with an existing Off-Guard; its
    attack contribution uses source `prone`. It does not lower defence DCs.
    Effects that query "is the target Off-Guard?" (for example backstabber)
    treat Prone as an Off-Guard source.
46. **Trip is an attack-trait skill check, not an attack roll.** It uses the
    current MAP and advances `attacksThisTurn` after the check (including a
    miss), but Prone's -2 attack-roll penalty does not apply to its Athletics
    check. Concealed/Hidden still require their pre-check flat check. Critical
    damage flows through `takeDamage(..., { type: "bludgeoning" })`.
47. **Stand provokes before it finishes.** Reactive Strike resolves while the
    creature is still prone, so the reaction sees the Off-Guard AC penalty. A
    defeating reaction leaves `prone` in place; otherwise the condition is
    removed at the end of the action.
48. **Hands and target size are not modelled.** Trip's free-hand and size
    requirements are deliberately deferred rather than approximated.
49. **Shove and Grapple share one Athletics pipeline.** Both use
    `athletics-maneuver.js`: 1 action, attack trait, Athletics vs Fortitude DC,
    current MAP then advance, and the Concealed/Hidden flat check. They are
    skill checks, so Prone's attack penalty does not apply.
50. **Shove's critical success does not knock prone.** Verified against
    Remastered: it extends the push to 10 ft. Only Trip knocks prone.
51. **Push direction is the sign-reduced centre line.** `Math.sign` on both axes
    gives one of eight directions. The push is walked one square at a time and
    stops before bounds, a wall, or another creature. A blocked second square
    collapses 10 ft to 5 ft; a blocked first square is a 0-ft success.
52. **Forced movement is not a move action.** Shove does not provoke Reactive
    Strike and does not change the target's diagonal parity.
53. **Grabbed and Restrained are one condition family.** Success applies
    Grabbed, Critical Success applies Restrained, and Restrained supersedes
    Grabbed from the same grappler. Both contribute Off-Guard through the
    condition resolver and apply the companion Immobilized record.
54. **Grapple critical failure uses the approved simplification.** The attacker
    falls Prone and loses any hold it had on the target. Remastered's full
    reverse-grab/prone choice is documented as deferred rather than guessed.
55. **Grapple duration belongs to the grappler.** The condition stores
    `sourceId` and `expiresOnSourceTurn = grappler.turnNumber + 1`. It expires at
    the end of the grappler's next turn, not the victim's, and `turnNumber`
    increments in `resetTurn()`.
56. **Moving or dying breaks the hold.** Stride/Step release the mover's holds;
    Encounter releases a defeated grappler's holds before the next creature acts.
    Escape success also removes the pair.
57. **Escape chooses the best legal modifier.** Unarmed Attack, Athletics, and
    Acrobatics are each resolved with MAP; the highest total wins. The DC is the
    grappler's Athletics DC. MAP is spent even on a failure.
58. **Immobilized is enforced in the core.** Stride, Step, and Stand return
    `reason: "immobilized"` without spending. The View suppression of highlights
    is a presentation mirror, not the rule.
59. **One grapple record per slug.** The condition store cannot represent two
    simultaneous grapplers on one target with separate durations; a second
    grappler replaces `sourceId`. This is a documented prototype limitation.

## Verification

- `npm test` / `node tests/run-node.js`: **358 passed, 0 failed** across 24
  suites.
- `test_runner.html`: **358 passed, 0 failed**, 24 suites, no console errors.
- Browser smoke tests through DOM state:
  - the workspace renders the Combat Log in a fixed left column, the battlefield
    in the centre, and the control sidebar on the right at desktop widths; the
    log container scrolls independently (`scrollHeight > clientHeight`) while
    the page layout stays fixed outside the 1040px stacking breakpoint;
  - the Selection panel shows `Immune: fire | Weak: slashing 2 | Resist: piercing 2`
    for the Goblin and `None` for the party;
  - Valeros' Selection panel shows
    `Weapon: 1d8+4 slashing [reach, backstabber, deadly d8]` and `Reach: 10 ft`;
  - token cards and initiative rows show `Persistent Fire 1d6` and
    `Persistent Bleed 1d4` badges on the Goblin;
  - ending the Goblin's turn logs fire as `IMMUNE -> 0 damage dealt`, bleed as a
    real HP loss, and two separate `Recovery Check: Flat Check d20(...) vs DC 15`
    lines;
  - a Merisiel critical hit against the Goblin logs
    `Damage: 16 [6 + 2] piercing -> Resistance -2 (piercing) -> 14 damage dealt (base 8 × 2). Goblin HP: 6 -> 0 (Defeated).`;
  - initiative rows and token cards show action circles plus a reaction diamond;
  - the selection panel includes `Actions`, `Cover`, `Reactions`, and `IWR` rows;
  - Take Cover is enabled at the start because Valeros has standard cover from
    the Goblin behind the central wall;
  - clicking Take Cover logs `Valeros uses Take Cover (standard cover detected)`
    and adds the `Greater Cover` badge;
  - a Stride out of a threatened square logs
    `[REACTION] Goblin uses Reactive Strike against ...!`, then the attack/damage
    breakdown and the spent reaction;
  - a defeating reaction logs `<name> is defeated and stops moving.`;
  - a Step out of the same square leaves the reaction diamond available;
  - the initial combat log explains cover, Take Cover, Reactive Strike, and
    visibility/flat checks;
  - token cards and initiative rows show `Concealed` and `Hidden` badges;
  - hovering the Concealed Goblin in Strike mode shows `FLAT CHECK DC 5` even
    when the target is out of reach;
  - on Merisiel's Hidden turn, hovering the Goblin shows
    `TARGET OFF-GUARD (-2 AC) · FLAT CHECK DC 5`; a strike logs the passed flat
    check, `HIDDEN ATTACKER`, and the AC breakdown
    `16 - 2 Off-Guard (Hidden Attacker) [circumstance]`;
  - the Selection panel shows `Saves: Fort +9 | Ref +6 | Will +5` and
    `Skills: Athletics +10 | Acrobatics +6 | Stealth +2 | Perception +7` for
    Valeros;
  - the action bar shows `Trip (-0)`, `Shove (-0)`, `Grapple (-0)`, a disabled
    `Stand`, and a disabled `Escape` for a non-prone, non-grabbed combatant;
  - on Merisiel's turn, Trip hover reports
    `TRIP · Athletics +4 vs Reflex DC 18 · 1 action · FLAT CHECK DC 5`;
  - a passed Concealed flat check logs
    `Merisiel attempts to Trip Goblin (Concealed): Flat Check d20(15) vs DC 5 -> PASSED. Trip proceeds.`;
    a success then logs
    `Merisiel attempts to Trip Goblin: Athletics d20(15) + 4 (base) = 19 vs Reflex DC 18 (10 + 8) -> SUCCESS. Goblin is now Prone.`
    and adds the `Prone` badge;
  - a critical-failure Trip logs `Merisiel loses balance and is now Prone.`,
    enables `Stand ✓`, and clicking Stand logs
    `[REACTION] Goblin uses Reactive Strike against standing Merisiel!`, with the
    reaction resolved against `AC 15 (17 - 2 Off-Guard (Prone) [circumstance])`,
    then `Merisiel is no longer Prone.`;
  - hovering the Goblin in Grapple mode from 40 ft reports
    `Cannot Grapple Goblin — out of reach (40 ft, reach 5 ft).`;
  - a forced critical Grapple from Merisiel logs the passed Concealed flat check,
    `Fortitude DC 14 (10 + 4)`, `CRITICAL SUCCESS! Goblin is Restrained
    (Off-Guard, Immobilized) until the end of Merisiel's next turn.`, and adds
    `Restrained` + `Immobilized` badges to the Goblin;
  - after two End Turns, the Goblin's turn shows
    `Escape (Unarmed Attack +8)` enabled, with tooltip
    `Best option: Unarmed Attack +8 (MAP -0) vs Athletics DC 14 · 1 action · FLAT CHECK DC 11`;
  - clicking Escape logs the passed Hidden flat check and
    `CRITICAL SUCCESS! Goblin breaks free.`, removes `Restrained`/`Immobilized`,
    and disables the Escape button again;
  - a forced critical Shove logs
    `Goblin shoves Merisiel: Athletics d20(20) + 3 (base) - 5 (MAP) = 18 vs Fortitude DC 15 (10 + 5) -> CRITICAL SUCCESS. ... Merisiel is pushed 10 ft to I11.`
    and the token moves to `I11`;
  - `test_runner.html` reports 358 passed / 0 failed / 24 suites.

## Known limitations / deliberately deferred

- Dying, Wounded, Unconscious, and recovery checks.
- Persistent damage from afflictions/stages and death caused by a persistent
  tick; precision damage as a separate IWR instance; damage-type conversion and
  splash damage.
- Seek/Hide/Sneak/Point Out actions, automatic loss of Hidden after an attack,
  creature size, elevation, multi-cell reach, and Large-target flank arcs.
- Crawl, and multiple simultaneous grapplers on one target (the store keeps
  one record per slug, so a second grappler replaces `sourceId`).
- Remastered's full Grapple critical-failure choice (the victim reverses the grab
  or knocks the attacker prone); the prototype uses attacker prone + release.
- Restrained's additional attack/manipulate restrictions and Grabbed's DC 5
  manipulate flat check beyond Off-Guard and Immobilized.
- Trip's free-hand and target-size requirements (no hands/inventory/size model),
  and the same printed requirements for Shove/Grapple. Shove's optional move
  with the target is also deferred.
- Escape's Unarmed Attack option uses `Combatant.attackBonus` because the engine
  has no separate unarmed profile.
- Prone-specific ranged-cover hunker-down and the ability to Take Cover while
  prone without an object.
- Ranged Strikes, thrown weapons, and reload.
- Other reactions: Detect/Disrupt, Shield Block, ranged Reactive Strikes, and
  non-movement triggers. Free actions are also not implemented.
- Shield Block, shield Hardness/HP, shield items, and multiple shield types.
- Other conditions beyond Off-Guard, Prone, Frightened, Shield Raised, Greater
  Cover, Concealed, Hidden, Undetected, Grabbed, Restrained, and Immobilized.
- Enemy AI; the user controls whichever combatant is active.
- No initiative rolling (values are authored).
- LoS ignores creatures; creatures provide lesser cover instead of blocking
  sight.
- Difficult terrain is uniform +5 ft; greater difficult terrain is not modelled.
- Tokens move instantly; no path animation.
- One token selected at a time; no drag-and-drop.
- Other weapon traits and deadly-die scaling from striking runes.

## Next logical slice

**Phase 8.4 (optional polish) — Crawl and Prone movement**:

1. Add `Crawl.performCrawl`: 1 action, move trait, 5 ft while prone, never
   provokes; it should remain blocked by Immobilized.
2. Confirm the prone-specific Take Cover hunker-down rule and whether Crawl can
   be combined with it.
3. Add deterministic Crawl tests and the prone movement button.

After that: **Phase 9** creature sizes and multi-cell reach/occupancy, then
**Phase 10** Dying, Wounded, Unconscious, and recovery checks.
