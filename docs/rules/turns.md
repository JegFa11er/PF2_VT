# Turns, Actions, Initiative & Stride — PF2e Remastered

## Action economy (implemented baseline)

- A combatant has **3 actions** per turn by default.
- `Combatant.actionsRemaining` starts at `maxActions` (3 in the prototype).
- `Combatant.canSpendActions(n)` checks availability without mutating state.
- `Combatant.spendActions(n)` deducts actions and throws if the pool is too small.
- `Combatant.resetTurn()` restores actions and reactions, clears the cumulative
  diagonal count, and resets `attacksThisTurn` (Multiple Attack Penalty). It also
  removes `shield-raised` and `greater-cover` because both last until the start of
  the creature's next turn, and performs the end-of-turn condition tick by default
  so Frightened decays; Encounter uses `resetTurn({ tickConditions: false })` for
  the incoming combatant.
- `Combatant.endTurn()` is the explicit end-of-turn hook. It ticks timed
  conditions (Frightened decays) **and** resolves every persistent damage
  instance: roll damage through IWR, then a DC 15 recovery flat check. The
  result reports `persistentTick` alongside `frightened`.
- `Encounter.nextTurn(options)` forwards optional die callbacks
  (`rollDie`, `rollDamageDie`, `rollD20`, `rollFlatCheck`) to the outgoing
  combatant's `endTurn()`, keeping the tick deterministic in tests.
- A combatant has **1 reaction per turn** by default (`maxReactions`). Reactions are
  a separate pool from actions:
  - `reactionsRemaining` starts at `maxReactions`;
  - `canSpendReaction(n)` checks availability without mutation;
  - `spendReaction(n)` deducts and throws when the pool is too small;
  - `resetTurn()` restores the pool at the start of the combatant's own turn.
- Free actions are not implemented.

## Encounter / initiative engine

`src/Core/Encounter/encounter.js` owns the turn cycle.

```js
const encounter = new Encounter({ combatants });
encounter.startEncounter();   // round 1, index 0, resets every combatant
encounter.nextTurn();         // advances, resets the incoming combatant
```

Rules implemented:

1. Combatants act in **descending initiative** order.
2. Equal initiatives keep declaration order (deterministic tie-break).
3. `startEncounter()` sets `round = 1` and resets every combatant's turn. It starts at
   the first **living** combatant in initiative order.
4. `nextTurn()` advances the index, calls `endTurn()` on the **outgoing** combatant
   (Frightened decay and persistent damage), and calls
   `resetTurn({ tickConditions: false })` on the **newly active** combatant so its
   conditions do not tick prematurely.
5. **Defeated combatants (`isDefeated === true`) remain in the roster but are skipped**
   by the turn cycle. Passing the end of the order still increments `round` exactly once.
6. If every combatant is defeated, `activeCombatant` becomes `null`, `isOver` is `true`,
   and `nextTurn()` returns `{ active: null, ... }`.
7. Advancing past the last living combatant wraps to the first living combatant and
   increments `round`.
8. `nextTurn()` on an unstarted encounter starts it first.
9. `isActive()`, `indexOf()`, `getOrder()`, `livingCombatants`, and `activeCombatant` are
   read-only helpers. `getOrder()` still includes defeated combatants for display.

Return value of `nextTurn()`:

```js
{ active, previous, round, wrapped, index, conditionTick, persistentTick }
```

`conditionTick` is `null` or the result of the outgoing combatant's
`endTurn()` call, e.g. `{ frightened: { from: 1, to: 0, removed: true }, changed: true }`.

`persistentTick` is `null` or the structured persistent-damage report from the
same `endTurn()` call. See `docs/rules/persistent-damage.md`.

## Stride

`src/Core/Actions/stride.js` implements the movement action.

Rules used:

1. Stride costs **1 action**.
2. The destination must be reachable along a valid path.
3. Total path cost must be **≤ Speed**.
4. The action is spent only after all validation succeeds.
5. On success, the combatant's position and cumulative diagonal steps are updated.
6. The 5-10-5 diagonal count persists across Strides within the same turn and resets on
   `resetTurn()`.
7. Difficult terrain adds 5 ft per entered square.
8. Allies may be crossed but not occupied; enemies block movement.
9. Before every square of the route, the mover leaves its current cell. If a
   living hostile with a reaction threatens that cell within **its own** reach
   (5 ft, or 10 ft with the `reach` weapon trait), the first such enemy
   automatically spends 1 reaction and makes a Reactive Strike.
10. Step never triggers reactions or threatened-square effects.
11. If the mover becomes defeated during a triggered Reactive Strike, movement
   stops on the square it was leaving and the rest of the route is discarded.
12. A successful Stride removes `greater-cover` from Take Cover, because the
    benefit ends when the creature moves.

Pass the full roster as `combatants` (and optionally `allies`) to enable the
reaction scan. Dice callbacks `rollD20` / `rollDamageDie` / `rollDie` are
forwarded to the Reactive Strike.

Result contract:

```js
{
  ok: true, path, costFeet, actionsLeft, diagonalSteps, diagonalParity,
  reactions, reaction, movementInterrupted, stoppedAt,
  movedPath, movedCostFeet, movedDiagonalSteps, destinationReached
}
{ ok: false, reason, costFeet?, path? }
```

`reactions` contains the successful Reactive Strike results, `reaction` is the
first of them (or `null`), and `movedCostFeet` reflects the distance actually
travelled before any interruption.

Failure reasons:

- `no-actions`
- `already-there`
- `out-of-bounds`
- `blocked-start`
- `blocked-destination`
- `destination-occupied`
- `unreachable`
- `exceeds-speed`

No action is spent for any failure.

## Step

`src/Core/Actions/step.js` implements the 5-foot tactical move.

Rules used:

1. Step costs **1 action**.
2. The destination must be exactly one adjacent square (orthogonal or diagonal).
3. Step cannot enter **difficult terrain**.
4. Step cannot enter a wall, an enemy, or an ally's square.
5. Diagonal Steps obey the canonical `block-any` corner rule.
6. Step always costs a flat **5 ft** and does not advance the 5-10-5 diagonal
   alternation. It is a fixed tactical move, not Speed-based movement.
7. `evaluateStep()` validates without spending; `getStepDestinations()` powers the UI
   highlight.
8. Step deliberately ignores reactions: leaving a threatened square with Step does
   not provoke a Reactive Strike.
9. A successful Step removes `greater-cover`, because the benefit ends when the
   creature moves.

Failure reasons: `no-actions`, `already-there`, `not-adjacent`, `out-of-bounds`,
`blocked-start`, `blocked-destination`, `destination-occupied`, `difficult-terrain`,
`corner-blocked`, `no-route`.

## View behaviour

- The **active combatant** is selected automatically at the start of its turn.
- Only the active combatant may take actions; clicking another token logs a warning.
  This is a GM-console model because no enemy AI exists yet.
- The **Initiative** panel shows round, order, active combatant, remaining actions
  (circles), and remaining reactions (diamonds). Token cards use the same pools.
- **End Turn** calls `encounter.nextTurn()`, resets the incoming combatant, logs the turn,
  and advances the round when the queue wraps.
- Action mode buttons switch between **Stride**, **Step**, and **Strike**.
- Stride hover shows the shortest route, its cost, difficult-terrain surcharge, and invalid
  reasons. Routes may cross allies; enemy squares block.
- Step mode highlights only legally enterable adjacent squares.
- Strike mode highlights hostile targets in reach with line of sight and draws the LoS ray.
- The action bar includes **Raise Shield** and **Take Cover**. Take Cover is enabled
  only when the active combatant has standard cover or better and an action left.
- Covered targets show `LESSER/STANDARD/GREATER COVER (+1/+2/+4 AC)` on hover and
  draw the cover rays; the log marks suppressed circumstance bonuses.
- Successful action log lines:
  - `Valeros uses Stride. Moves 15 ft. Actions left: 1`
  - `Valeros uses Step. Moves 5 ft to E8. Actions left: 2`
  - `Valeros strikes Goblin: d20(12) + 9 (base) - 5 (MAP) = 16 vs AC 13 (16 - 2 Off-Guard [circumstance] - 1 Frightened 1 [status]) -> SUCCESS.`
  - `Damage: 7. Goblin HP: 6 -> 0 (Defeated).`
  - `Goblin's Frightened decreases 1 -> 0 (removed).`
  - `[PERSISTENT DAMAGE] Goblin takes 1 [1] bleed -> 1 damage dealt. Goblin HP: 6 -> 5.`
  - `Recovery Check: Flat Check d20(2) vs DC 15 -> FAILED (Bleed persists).`
- The Strike button shows the current MAP, e.g. `Strike (-0)` → `Strike (-5)`.
- The sidebar token list and initiative roster show current/max HP.
- Defeated combatants are greyed, semi-transparent, and skipped by End Turn.
- Failed attempts are logged as `... canceled — <reason>` and spend no action.
- A Stride that leaves a threatened square logs
  `[REACTION] Goblin uses Reactive Strike against Valeros!`, then the normal
  attack/damage breakdown and the reactor's remaining reactions. Defeat during
  the reaction logs `Valeros is defeated and stops moving.`
- Press `Esc` or click the selected token again to clear the selection.

## Not implemented yet

- Dying, Wounded, Unconscious, and recovery checks.
- Free actions, Detect/Disrupt, and other reaction types.
- Seek/Hide/Sneak actions, creature size, multi-cell reach, elevation,
  and Large-target flank arcs.
- Enemy AI; the active combatant is controlled by the user.
- Creature occupancy in line-of-sight (creatures provide lesser cover instead of
  blocking sight).
