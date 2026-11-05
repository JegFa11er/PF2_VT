# PF2e Remastered — Tactical Battlefield

A headless Pathfinder 2E Remastered rules core with a vanilla JS canvas battlefield.
The rules engine has no DOM or canvas dependencies, so it can move into another host
project unchanged.

## Run the prototype

No build step, no dependencies.

- Open `index.html` directly in a browser (double-click works; scripts are classic ES6,
  not ES modules).
- The active combatant is selected automatically at the start of its turn.
- Choose **Stride**, **Step**, **Strike**, **Trip**, **Shove**, or **Grapple** in
  the Actions panel, or use **Raise Shield** / **Take Cover** / **Stand** /
  **Escape**.
- **Stride:** hover a square to preview the route and cost, then click to move.
- **Step:** click an adjacent square (5 ft, 1 action, no difficult terrain).
- **Strike:** click a hostile token within weapon reach (5 ft, or 10 ft with the
  `reach` trait) with line of sight. The button shows the current Multiple Attack
  Penalty; damage and HP resolve immediately, and a critical hit doubles damage.
- **Saves & skills:** the Selection panel shows `Fort/Ref/Will` and
  `Athletics/Acrobatics/Stealth/Perception`. Defended DCs are
  `10 + save modifier + modifiers`; Frightened lowers them and standard/greater
  cover adds +2/+4 circumstance to Reflex and Reflex DC.
- **Trip:** 1 action, attack trait, Athletics vs Reflex DC. The button shows the
  current MAP. Critical success = prone + 1d6 bludgeoning through IWR, success =
  prone, critical failure = the attacker falls prone. Concealed/Hidden targets
  still require their flat check before the Athletics roll.
- **Prone & Stand:** Prone gives Off-Guard (-2 circumstance AC) and a -2
  circumstance penalty to attack rolls; the canvas token rotates 90 degrees.
  Stand costs 1 action, removes Prone, and provokes Reactive Strike. The reaction
  resolves while the creature is still prone, and a defeating reaction leaves it
  prone. Immobilized (Grabbed/Restrained) blocks Stand.
- **Shove:** 1 action, attack trait, Athletics vs Fortitude DC. Success pushes
  the target 5 ft, critical success 10 ft, critical failure makes the shover
  Prone. The push follows the attacker -> target centre line and stops before a
  wall, another creature, or the map edge. Shove does not provoke.
- **Grapple:** 1 action, attack trait, Athletics vs Fortitude DC. Success applies
  Grabbed, critical success Restrained; both impose Off-Guard and Immobilized.
  The hold expires at the end of the grappler's next turn and breaks if the
  grappler Strides, Steps, or is defeated.
- **Escape:** 1 action, attack trait, available only while Grabbed/Restrained.
  Roll the best of Unarmed Attack, Athletics, or Acrobatics (MAP applies) against
  the grappler's Athletics DC. Success breaks free.
- **Weapon traits:** `reach` extends melee range to 10 ft (Strike, threatened
  cells, and flanking); `deadly dN` adds a non-doubled die on a critical hit;
  `fatal dN` replaces and doubles the base die and adds a non-doubled fatal die;
  `backstabber` adds +1 (+2 on a critical) against Off-Guard. The Selection panel
  lists the active weapon, traits, and reach.
- **Raise Shield:** spend 1 action for a +2 circumstance bonus to AC until the
  start of the combatant's next turn. The bonus does not stack with itself.
- **Cover:** Strike hover shows `LESSER COVER (+1 AC)`, `STANDARD COVER (+2 AC)`,
  or `GREATER COVER (+4 AC)` and draws the best-corner cover rays. Cover is a
  circumstance bonus and does not stack with Shield Raised.
- **Take Cover:** spend 1 action while behind standard cover or better for +4
  circumstance AC until the start of the next turn or the next Stride/Step.
- **Visibility:** Concealed targets require a DC 5 flat check before the attack
  roll, Hidden targets DC 11. A failed check still spends the action and MAP but
  produces no attack roll or damage. Undetected targets cannot be selected; a
  Hidden/Undetected attacker makes its target Off-Guard (-2 circumstance AC).
- **Typed damage & IWR:** weapon damage carries a type (`slashing`, `piercing`,
  `fire`, ...). After the critical multiplier the target applies
  **Immunity -> Weakness -> Resistance**. The combat log shows the full chain,
  e.g. `8 slashing -> Weakness +5 -> Resistance -3 -> 10 damage dealt`, and the
  Selection panel lists the target's `Immune / Weak / Resist` profile.
- **Persistent damage:** badges such as `Persistent Fire 1d6` and
  `Persistent Bleed 1d4`. At the end of the affected creature's turn each type
  rolls damage through IWR and then makes a separate **DC 15 flat check**;
  success removes it. Different types resolve independently, and the same type
  never stacks. The log prints `[PERSISTENT DAMAGE] ...` and a separate recovery
  line.
- **Reactions:** each combatant has 1 reaction per turn, shown as a diamond next
  to the action circles. Striding out of a square threatened by an enemy with a
  reaction automatically provokes a Reactive Strike (full attack bonus, no MAP).
  Step never provokes. The log starts with `[REACTION] ...`.
- Condition badges show Off-Guard, Frightened, Shield Raised, Greater Cover,
  Concealed, Hidden, and Undetected on combatant cards. Hidden/Undetected tokens
  render at 50% opacity. Hovering a flanked target in Strike mode highlights
  `FLANKED (-2 AC)`; visibility states add `FLAT CHECK DC 5/11`,
  `TARGET OFF-GUARD (-2 AC)`, or `CANNOT TARGET UNDETECTED`.
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

Current suites: **358 tests** across 24 suites:

- distance math and 5-10-5 diagonals;
- obstacles, A* pathfinding, corner policies, reachable cells;
- difficult terrain costs and faction occupancy;
- line-of-sight raycasting;
- cover geometry: best corner, 1-3 blocked rays, creature lesser cover, full LoS block;
- d20 checks, four degrees of success, natural 20/1 shifts;
- saving throws, skills, Frightened/cover scopes, and `calculateDC`;
- Prone scopes, Trip success/MAP/critical damage/critical failure/reach;
- Shove 5/10-ft pushes, wall/creature/bounds stops, partial collapse, MAP;
- Grapple Grabbed/Restrained/sourceId, grappler-turn expiry, move/death breaks;
- Escape best-of skill selection, Athletics DC, MAP, and condition removal;
- Immobilized blocking Stride and Step without spending an action;
- Stand action cost, Prone removal, and Reactive Strike timing;
- flat checks at the Concealed DC 5 and Hidden DC 11 boundaries;
- typed modifier stacking (circumstance/status/item/untyped);
- typed damage and the canonical Immunity -> Weakness -> Resistance pipeline;
- immunity short-circuiting, once-per-attack weakness, resistance floor, and multi-type audits;
- persistent damage stacking, end-of-turn IWR damage, and DC 15 recovery passes/failures;
- deadly/fatal/backstabber damage math and 10-ft reach in Strike, Reactive Strike, and flanking;
- flanking geometry and opposite-side/corner detection;
- Off-Guard and Frightened conditions, including end-of-turn decay;
- Concealed/Hidden/Undetected storage, no own-AC penalty, and visibility;
- failed flat checks spending the action/reaction without an attack roll or damage;
- Hidden/Undetected attacker Off-Guard and Undetected targeting rejection;
- Shield Raised (+2 circumstance AC) and start-of-turn removal;
- Take Cover requirement, greater cover, turn/movement expiry;
- Step and Strike action validation;
- Strike MAP, agile weapons, damage, critical doubling, HP and defeat;
- cover non-stacking with Shield Raised in Strike;
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
  Core/Grid/cover.js          Best-corner 4-ray cover geometry + creature cover
  Core/Rules/checks.js        d20 checks, degrees of success, flat checks
  Core/Rules/modifiers.js     Typed modifier stacking resolver
  Core/Rules/map.js           Multiple Attack Penalty (normal / agile)
  Core/Rules/damage.js        Typed damage formula parsing and rolling
  Core/Rules/iwr.js           Immunity -> Weakness -> Resistance pipeline
  Core/Rules/weapon-traits.js Reach, deadly, fatal, and backstabber calculator
  Core/Entities/conditions.js Off-Guard, Prone, Frightened, Shield Raised, Cover, Visibility
  Core/Entities/persistent-damage.js Persistent damage store + end-of-turn tick
  Core/Entities/combatant.js  Speed, actions, HP/AC, saves, skills, attack, MAP, conditions, traits
  Core/Encounter/encounter.js Initiative order, active combatant, defeated skipping
  Core/Actions/stride.js      Speed-based movement + Reactive Strike windows
  Core/Actions/step.js        5-ft tactical move, no difficult terrain, no triggers
  Core/Actions/strike.js      Attack check, MAP, damage, HP, defeat
  Core/Actions/reactive-strike.js  1-reaction attack, no MAP, shared resolver
  Core/Actions/raise-shield.js 1-action +2 circumstance AC condition
  Core/Actions/take-cover.js  1-action +4 greater cover with cover requirement
  Core/Actions/trip.js        Athletics vs Reflex DC, MAP, Prone, 1d6 bludgeoning
  Core/Actions/athletics-maneuver.js Shared Athletics vs Fortitude DC pipeline + flat check + MAP
  Core/Actions/shove.js       Push vector/blocking, 5/10 ft, critical-failure Prone
  Core/Actions/grapple.js     Grabbed/Restrained + Immobilized, sourceId duration
  Core/Actions/escape.js      Best of Unarmed/Athletics/Acrobatics vs Athletics DC
  Core/Actions/stand.js       1-action Prone removal + Reactive Strike interrupt
  View/Grid/                  Grid, terrain, obstacles, highlights, LoS/cover rays
  View/Tokens/                Round tokens, HP bar, selection ring, defeated state
  View/UI/                    Combat log
  View/battlefield-view.js    Canvas composition + input + action modes
  main.js                     App wiring (map, encounter, actions, log)

tests/
  Grid/distance.test.js       Session 1.1 distance tests
  Grid/pathfinding.test.js    Obstacles, A*, corner policies, Stride
  Grid/terrain-occupancy.test.js  Terrain cost + faction occupancy
  Grid/los.test.js            Line-of-sight raycasting
  Grid/cover.test.js          Cover degrees, best corner, creature lesser cover, 4-ray LoS
  Rules/checks.test.js        Degrees of success, natural 20/1, flat checks
  Rules/modifiers.test.js     Typed non-stacking + untyped same-source rules
  Rules/saves-skills.test.js  Saves, skills, Frightened/cover, calculateDC, Prone scopes
  Rules/iwr.test.js           Damage types, immunity/weakness/resistance order
  Rules/weapon-traits.test.js Deadly, fatal, backstabber, 10-ft reach
  Grid/flanking.test.js       Direct, diagonal, L-shape, defeated/out-of-reach, reach
  Entities/conditions.test.js Conditions incl. visibility with no AC penalty
  Entities/persistent-damage.test.js Persistent ticks, stacking, DC 15 recovery
  Actions/step-strike.test.js Step and Strike validation
  Actions/strike.test.js      MAP, damage, flanking, visibility, HP/defeat
  Actions/raise-shield.test.js Raise a Shield action cost + condition
  Actions/take-cover.test.js   Take Cover requirement, +4 AC, turn/move expiry
  Actions/trip.test.js        Trip check, MAP, Prone, critical damage/IWR, reach
  Actions/shove.test.js       Push distance/geometry, blockers, MAP, critical failure
  Actions/grapple.test.js     Grabbed/Restrained, sourceId, expiry, move/death breaks
  Actions/escape.test.js      Best skill, Athletics DC, MAP, condition removal
  Actions/stand.test.js       Stand cost/removal and Reactive Strike timing
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
- Stride (Speed-based), Step (flat 5 ft, no difficult terrain), Strike (weapon
  reach — 5 ft or 10 ft with `reach` — plus LoS).
- Line of sight uses a conservative centre-to-centre supercover ray.
- d20 checks with four degrees of success; natural 20/1 shift the degree.
- MAP `0 / −5 / −10` and agile `0 / −4 / −8`, reset each turn.
- Typed modifiers: same-type bonuses/penalties do not stack; untyped penalties
  stack across different sources.
- Off-Guard (`-2 circumstance AC`) and Frightened N (`-N status` to checks/DCs,
  decaying by 1 at end of turn).
- Saving throws (Fortitude/Reflex/Will) and skills (Athletics/Acrobatics/Stealth/
  Perception), with defended DCs `10 + base + modifiers`. Standard/greater cover
  is +2/+4 circumstance to Reflex and Reflex DC.
- Prone: Off-Guard plus `-2 circumstance` to attack rolls. Stand costs 1 action,
  removes Prone, and provokes Reactive Strike before the condition is removed.
- Trip: 1 action, attack trait, Athletics skill check vs Reflex DC;
  uses/advances MAP, applies Prone, and deals 1d6 bludgeoning through IWR on a
  critical success. Prone's attack-roll penalty does not apply to the skill
  check; Concealed/Hidden still impose their flat check first.
- Shove: 1 action, attack trait, Athletics vs Fortitude DC. The sign-reduced
  centre-line push is 5 ft on success and 10 ft on a critical success, stopping
  before bounds/walls/creatures; a critical failure makes the attacker Prone.
- Grapple: 1 action, attack trait, Athletics vs Fortitude DC. Grabbed/Restrained
  impose Off-Guard + Immobilized, store `sourceId`, and expire at the end of the
  grappler's next turn. The hold breaks when the grappler Strides, Steps, or dies.
- Escape: 1 action, attack trait, best of Unarmed/Athletics/Acrobatics against
  the grappler's Athletics DC (MAP applies). Success removes the grapple pair.
- Raise a Shield (`+2 circumstance AC` until the start of the raiser's next turn);
  a same-type bonus and penalty both apply, so Shield Raised and Off-Guard net
  to 0 while remaining visible in the breakdown.
- Cover: best-corner 4-ray geometry against wall interiors; 1-2 blocked rays =
  standard (+2 circumstance AC), 3 = greater (+4), 4 = no line of sight. An
  intervening able creature gives lesser cover (+1). Cover does not stack with
  Shield Raised or Take Cover.
- Take Cover: 1 action, requires standard cover or better. Grants `greater-cover`
  (+4 circumstance AC) until the start of the next turn or the next Stride/Step.
- Concealed/Hidden/Undetected: flat checks (DC 5 / DC 11) before the attack roll;
  Undetected cannot be targeted; a failed check spends the action/reaction and
  advances Strike MAP without an attack roll or damage. Hidden/Undetected
  attackers make the target Off-Guard through the shared modifier resolver.
- Reactions: 1 per turn, restored at the start of the combatant's own turn.
  Reactive Strike costs a reaction, uses the shared modifier pipeline, ignores
  MAP, and triggers automatically when a Stride leaves a threatened square.
  Step never triggers it; defeat during the reaction stops movement.
- Flanking on opposite sides/corners; the target is treated as Off-Guard against
  the flanking attackers' melee Strikes.
- Typed damage: a plain formula string is `untyped`; object/`damageType`
  authoring resolves `{ formula, type }`.
- IWR in the fixed order Immunity -> Weakness -> Resistance. Immunity zeroes the
  instance, Weakness adds once per attack for an applicable type, and Resistance
  subtracts with a 0 floor. Multi-type attacks are audited instance by instance.
- Persistent damage: end-of-turn damage through IWR, then a separate DC 15 flat
  check; different types resolve independently and the same type keeps the
  stronger formula.
- Weapon traits: `reach` (10 ft in Strike, threatened cells, and flanking),
  `deadly dN` (non-doubled extra die on a critical), `fatal dN` (replace the base
  die, double it, add a non-doubled fatal die), and `backstabber` (+1 vs
  Off-Guard, doubled to +2 on a critical).
- Damage formulas, critical doubling (before IWR), HP reduction, and defeat at 0 HP.

## Deliberately out of scope

Dying/Wounded/Unconscious, affliction persistent damage, Seek/Hide/Sneak actions,
creature size, multi-cell reach, elevation, Shield Block, Crawl, multiple
simultaneous grapplers, Restrained's extra attack/manipulate restrictions,
Trip's free-hand/size requirements, other reaction types, free actions, enemy AI,
and initiative rolls. See `docs/HANDOFF.md`, `docs/rules/`, and
`docs/rules/maneuvers.md` for the current contracts and next slice.
