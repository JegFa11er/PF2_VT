# PF2e Remastered — Tactical Battlefield

A headless Pathfinder 2E Remastered rules core with a vanilla JS canvas battlefield.
The rules engine has no DOM or canvas dependencies, so it can move into another host
project unchanged.

## Run the prototype

No build step, no dependencies.

- Open `index.html` directly in a browser (double-click works; scripts are classic ES6,
  not ES modules).
- The active combatant is selected automatically at the start of its turn.
- Choose **Stride**, **Step**, or **Strike** in the Actions panel, or use
  **Raise Shield**.
- **Stride:** hover a square to preview the route and cost, then click to move.
- **Step:** click an adjacent square (5 ft, 1 action, no difficult terrain).
- **Strike:** click an adjacent hostile token (5 ft reach, line of sight required).
  The button shows the current Multiple Attack Penalty; damage and HP resolve
  immediately, and a critical hit doubles damage.
- **Raise Shield:** spend 1 action for a +2 circumstance bonus to AC until the
  start of the combatant's next turn. The bonus does not stack with itself.
- **Reactions:** each combatant has 1 reaction per turn, shown as a diamond next
  to the action circles. Striding out of a square threatened by an enemy with a
  reaction automatically provokes a Reactive Strike (full attack bonus, no MAP).
  Step never provokes. The log starts with `[REACTION] ...`.
- Condition badges show Off-Guard, Frightened, and Shield Raised on combatant
  cards. Hovering a flanked target in Strike mode highlights `FLANKED (-2 AC)`.
- **End Turn** advances the initiative queue, resets the incoming combatant, and
  skips defeated combatants.
- `Esc` or clicking the selected token clears the selection.

## Run the tests

Node:

```bash
npm test
# or
node tests/run-node.js
```

Browser:

- Open `test_runner.html`.

Current suites: **199 tests** across 13 suites:

- distance math and 5-10-5 diagonals;
- obstacles, A* pathfinding, corner policies, reachable cells;
- difficult terrain costs and faction occupancy;
- line-of-sight raycasting;
- d20 checks, four degrees of success, natural 20/1 shifts;
- typed modifier stacking (circumstance/status/item/untyped);
- flanking geometry and opposite-side/corner detection;
- Off-Guard and Frightened conditions, including end-of-turn decay;
- Shield Raised (+2 circumstance AC) and start-of-turn removal;
- Step and Strike action validation;
- Strike MAP, agile weapons, damage, critical doubling, HP and defeat;
- reaction budget, Reactive Strike triggers, MAP independence, and Step immunity;
- initiative order, turn advancement, round wrapping, and defeated skipping.

## Layout

```text
index.html                    Prototype entry point (double-click)
test_runner.html              Browser test runner
css/main.css                  Dark Foundry-inspired theme

src/
  Core/Grid/grid-math.js      5 ft squares, 5-10-5 distance, terrain constant
  Core/Grid/grid-map.js       Bounds, walls, difficult terrain
  Core/Grid/pathfinding.js    A* / Dijkstra with parity, terrain, occupancy
  Core/Grid/occupancy.js      Alliance → blocked / pass-through cell sets
  Core/Grid/los-math.js       Centre-to-centre LoS raycasting
  Core/Grid/flanking.js       Opposite-side/corner flanking geometry
  Core/Rules/checks.js        d20 checks + four degrees of success
  Core/Rules/modifiers.js     Typed modifier stacking resolver
  Core/Rules/map.js           Multiple Attack Penalty (normal / agile)
  Core/Rules/damage.js        Damage formula parsing and rolling
  Core/Entities/conditions.js Off-Guard, Frightened, Shield Raised, modifiers
  Core/Entities/combatant.js  Speed, actions, HP/AC, attack, MAP, conditions
  Core/Encounter/encounter.js Initiative order, active combatant, defeated skipping
  Core/Actions/stride.js      Speed-based movement + Reactive Strike windows
  Core/Actions/step.js        5-ft tactical move, no difficult terrain, no triggers
  Core/Actions/strike.js      Attack check, MAP, damage, HP, defeat
  Core/Actions/reactive-strike.js  1-reaction attack, no MAP, shared resolver
  Core/Actions/raise-shield.js 1-action +2 circumstance AC condition
  View/Grid/                  Grid, terrain, obstacles, highlights, LoS ray
  View/Tokens/                Round tokens, HP bar, selection ring, defeated state
  View/UI/                    Combat log
  View/battlefield-view.js    Canvas composition + input + action modes
  main.js                     App wiring (map, encounter, actions, log)

tests/
  Grid/distance.test.js       Session 1.1 distance tests
  Grid/pathfinding.test.js    Obstacles, A*, corner policies, Stride
  Grid/terrain-occupancy.test.js  Terrain cost + faction occupancy
  Grid/los.test.js            Line-of-sight raycasting
  Rules/checks.test.js        Degrees of success + natural 20/1
  Rules/modifiers.test.js     Typed non-stacking + untyped same-source rules
  Grid/flanking.test.js       Direct, diagonal, L-shape, defeated/out-of-reach
  Entities/conditions.test.js Off-Guard, Frightened decay, Shield Raised, AC/attack
  Actions/step-strike.test.js Step and Strike validation
  Actions/strike.test.js      MAP, damage, flanking, conditions, HP/defeat
  Actions/raise-shield.test.js Raise a Shield action cost + condition
  Actions/reactive-strike.test.js Reaction budget, triggers, MAP, defeat
  Encounter/encounter.test.js Initiative, round cycle, defeated skipping
  harness.js                  Tiny assertion harness (browser + Node)
  run-node.js                 Node CLI runner
  run-browser.js              Browser result renderer
```

## Rules implemented

- 1 square = 5 ft; cells are integer `(x, y)` coordinates.
- Diagonal movement alternates 5/10/5/10 ft and persists across all movement in a turn.
- Closed form: `5 * (max(dx, dy) + floor(min(dx, dy) / 2))`.
- Static obstacle map with A* pathfinding around walls.
- Canonical `block-any` diagonal corner policy.
- Difficult terrain adds 5 ft when entered, including on diagonals.
- Allies may be crossed but not occupied; enemies block movement.
- Initiative order (descending), round counter, End Turn, per-turn reset, defeated skipping.
- Stride (Speed-based), Step (flat 5 ft, no difficult terrain), Strike (5 ft + LoS).
- Line of sight uses a conservative centre-to-centre supercover ray.
- d20 checks with four degrees of success; natural 20/1 shift the degree.
- MAP `0 / −5 / −10` and agile `0 / −4 / −8`, reset each turn.
- Typed modifiers: same-type bonuses/penalties do not stack; untyped penalties
  stack across different sources.
- Off-Guard (`-2 circumstance AC`) and Frightened N (`-N status` to checks/DCs,
  decaying by 1 at end of turn).
- Raise a Shield (`+2 circumstance AC` until the start of the raiser's next turn);
  a same-type bonus and penalty both apply, so Shield Raised and Off-Guard net
  to 0 while remaining visible in the breakdown.
- Reactions: 1 per turn, restored at the start of the combatant's own turn.
  Reactive Strike costs a reaction, uses the shared modifier pipeline, ignores
  MAP, and triggers automatically when a Stride leaves a threatened square.
  Step never triggers it; defeat during the reaction stops movement.
- Flanking on opposite sides/corners; the target is treated as Off-Guard against
  the flanking attackers' melee Strikes.
- Damage formulas, critical doubling, HP reduction, and defeat at 0 HP.

## Deliberately out of scope

Dying/Wounded/Unconscious, persistent damage, cover degrees, creature size,
elevation, reach weapons, Shield Block, other reaction types, free actions,
enemy AI, and initiative rolls. See `docs/HANDOFF.md` and `docs/rules/` for the
current contracts and next slice.
