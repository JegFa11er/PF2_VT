# Project Structure & Implementation Roadmap

> Status: Phase 1 (Sessions 1.1–1.4), Phase 2 (encounter cycle, terrain,
> occupancy, LoS, Step, Strike), Phase 3 (d20 checks, MAP, damage, HP), Phase 4
> (modifier resolver, Off-Guard/Frightened, flanking), Phase 5 (including
> reactions and Reactive Strike), Phase 6.1 (cover system and Take Cover),
> Phase 6.2 (concealment, Hidden/Undetected, and flat checks), Phase 7.1
> (typed damage and the IWR engine), Phase 7.2/7.3 (persistent damage and
> advanced weapon traits), and Phase 8.1/8.2/8.3
> (saves, skills, Prone, Stand, Trip, Shove, Grapple/Grabbed/Restrained/
> Immobilized, and Escape) are implemented. See `docs/HANDOFF.md` for
> the current contracts and the next slice.

## 1. Directory Structure

```text
project-root/
│
├── docs/
│   ├── HANDOFF.md
│   └── rules/
│       ├── grid.md
│       ├── turns.md
│       ├── checks.md
│       ├── strikes.md
│       ├── conditions.md
│       ├── cover.md
│       ├── visibility.md
│       ├── iwr.md
│       ├── persistent-damage.md
│       ├── weapon-traits.md
│       └── maneuvers.md
│
├── src/
│   ├── Core/
│   │   ├── Grid/          # Distance, map, terrain, occupancy, A*, LoS
│   │   ├── Entities/      # Combatant, stats, inventory, active conditions
│   │   ├── Encounter/     # Initiative queue, active combatant, round cycle
│   │   ├── Rules/         # Checks, DCs, modifier stacking, degree of success
│   │   ├── Actions/       # Stride, Step, Strike, Reactive Strike, Raise a Shield, Take Cover, Trip, Shove, Grapple, Escape, Stand
│   │   └── State/         # Reserved for persistent combat state
│   │
│   └── View/
│       ├── Grid/          # Visual board rendering, cell highlights, LoS ray
│       ├── Tokens/        # Token display, drag-and-drop, selection
│       └── UI/            # Action bar, turn tracker, combat log
│
└── tests/
    ├── Grid/
    ├── Rules/
    ├── Actions/
    ├── Encounter/
    └── State/
```

---

## 2. Granular Session Roadmap

Each item represents a single, focused development session. Take any item, paste it into the prompt, and ask to execute that specific session.

### Phase 1: Spatial Grid & Movement
* **Session 1.1: Coordinate System & Distance Math**
  - Grid cell representations $(x, y)$.
  - PF2e diagonal calculation: first diagonal costs 5 ft, second costs 10 ft, alternating ($5 \to 15 \to 20 \to 30$).
* **Session 1.2: Pathfinding & Obstacles**
  - Walkable vs blocked cells.
  - Pathfinding calculation returning total movement cost in feet.
* **Session 1.3: Token Placement & Stride Action**
  - Base combatant with a `Speed` stat (e.g., 25 ft).
  - Validation of target destination against available speed.

### Phase 2: Action Economy & Round Cycle
* **Session 2.1: Turn Pool & Action Tracking**
  - Combatant action tracker: 3 actions + 1 reaction per turn.
  - Deducting 1, 2, or 3 actions when an action is executed.
* **Session 2.2: Initiative & Turn Queue**
  - Rolling initiative (Perception / Stealth).
  - Turn queue sorting, Active Combatant indicator, and End Turn triggering round progression.

### Phase 3: Checks, DCs & Modifier Engine
* **Session 3.1: D20 Roll & 4 Degrees of Success**
  - Target DC check:
    - Critical Success: $\text{Total} \ge \text{DC} + 10$
    - Success: $\text{Total} \ge \text{DC}$
    - Failure: $\text{Total} < \text{DC}$
    - Critical Failure: $\text{Total} \le \text{DC} - 10$
  - Natural 20 shifts degree one step up; Natural 1 shifts degree one step down.
* **Session 3.2: Modifier Stacking Engine** — ✅ implemented
  - Modifier resolver for `Circumstance`, `Status`, `Item`, and `Untyped`.
  - Non-stacking rule enforcement (highest bonus applies, worst penalty applies).
  - Untyped penalties stack across different sources only.

### Phase 4: Basic Combat & Attacks
* **Session 4.1: Strike Action & Multiple Attack Penalty (MAP)**
  - Basic melee Strike action against adjacent targets.
  - MAP tracking: 0 on 1st attack, -5 on 2nd attack, -10 on 3rd attack.
  - Agile weapon trait variation: 0 / -4 / -8.
  - Reset of MAP at the end of the combatant's turn.
* **Session 4.2: Damage Resolution & Hit Point Tracking**
  - Damage calculation on Success vs Critical Success (double damage).
  - Application to Target HP; reaching 0 HP triggers the `Unconscious` / `Dying` state baseline.

### Phase 5: Tactical Positioning & Basic Conditions
* **Session 5.1: Flanking Detection** — ✅ implemented
  - Geometric check: line connecting the centers of two allies passes through opposite sides or corners of the target's square.
  - Both creatures must be alive, hostile to the target, and within 5-ft reach.
* **Session 5.2: Off-Guard Condition** — ✅ implemented
  - Imposing the `Off-Guard` condition when flanked or flat-footed.
  - Modifier engine automatically injects a -2 circumstance penalty to AC against relevant attacks.
  - Frightened N applies a -N status penalty to checks/DCs and decays at end of turn.
* **Session 5.3: Step Action vs Stride** — ✅ implemented
  - Implementation of the `Step` action (5-foot movement, costs 1 action, ignores reactions/threatened squares).
* **Session 5.4: Raise a Shield** — ✅ implemented
  - 1-action +2 circumstance AC bonus through the central modifier resolver.
  - `shield-raised` condition badge in token cards and initiative rows.
  - Clears at the start of the combatant's next turn via `resetTurn()`.
  - Circumstance bonus and penalty resolve independently: +2 Shield Raised and
    -2 Off-Guard net to 0 while both appear in the log breakdown.
* **Session 5.5: Reactions & Reactive Strike** — ✅ implemented
  - 1 reaction per turn on `Combatant`, restored by `resetTurn()`.
  - `Reactive Strike` spends a reaction, never an action, and ignores MAP.
  - Stride leaving a threatened square auto-triggers the first eligible enemy;
    Step never provokes.
  - Defeat during the reaction stops movement immediately.
  - Reaction diamonds in the initiative tracker and token cards, plus
    `[REACTION]` combat-log entries.

# Project Structure & Implementation Roadmap (Part 2)

> Status: Phases 1-5, Sessions 6.1, 6.2, 7.1, 7.2, 7.3, 8.1, 8.2, and 8.3 are
> implemented (Trip, Shove, Grapple, Grabbed/Restrained/Immobilized, Escape).
> The following roadmap defines Phases 6 through 10, expanding the engine
> into advanced tactical rules, geometry, damage types, and combat maneuvers.

## Phase 6: Advanced Defense, Cover & Visibility
* **Session 6.1: Cover System (Укрытия)** — ✅ implemented
  - Lesser (+1 AC), Standard (+2 AC), and Greater Cover (+4 AC).
  - Canonical 4-ray corner evaluation: the attacker picks the best corner, rays run to the four target corners, and wall interiors block. Creatures provide Lesser Cover when no wall blocks.
  - Cover modifiers flow through the central resolver; Shield Raised and cover do not stack.
  - Take Cover action grants the `greater-cover` condition (+4 circumstance AC) until the next turn or next Stride/Step.
* **Session 6.2: Concealment & Visibility (Маскировка и Видимость)** — ✅ implemented
  - Conditions: `Concealed`, `Hidden`, `Undetected`; no AC modifiers on the
    defender's own AC.
  - `evaluateFlatCheck` (DC 5 Concealed, DC 11 Hidden) resolves before the
    attack roll; failure spends the action/reaction and advances Strike MAP
    without rolling attack or damage.
  - Undetected cannot be selected as a direct target (`target-undetected`).
  - Hidden/Undetected attacker makes the target Off-Guard (-2 circumstance AC)
    through the shared modifier resolver.
  - Badges, 50% token opacity, hover badges, and flat-check logs.

## Phase 7: Damage Types, IWR & Persistent Damage
* **Session 7.1: Damage Types & IWR Engine** — ✅ implemented
  - Typed weapon damage: `"1d8+4"` (legacy untyped) or
    `{ formula: "1d8+4", type: "slashing" }`.
  - Pure `IWR.applyIWR` with Immunities (zero the instance), Weaknesses (add
    once per attack per applicable type), and Resistances (subtract, floor 0).
  - Fixed order: Immunity -> Weakness -> Resistance, after critical doubling.
  - `Combatant` IWR arrays + `takeDamage(amount, { type })`; Strike/Reactive
    Strike audits and an explicit combat-log chain.
  - Three-column layout: Combat Log left, battlefield centre, controls right.
* **Session 7.2: Persistent Damage** — ✅ implemented
  - Persistent damage instances `{ id, formula, type }` on `Combatant`.
  - Same-type non-stacking keeps the stronger formula; different types roll and
    recover independently.
  - End-of-turn damage through the IWR pipeline, then a DC 15 recovery flat
    check; success removes the instance. No critical-failure penalty.
  - Structured `persistentTick` from `Combatant.endTurn()` and
    `Encounter.nextTurn()`, plus `[PERSISTENT DAMAGE]` and recovery log lines.
* **Session 7.3: Advanced Weapon Traits** — ✅ implemented
  - `reach`: 10-ft Strike range, threatened cells, and flanking geometry.
  - `deadly dN`: one non-doubled extra die on a critical success.
  - `fatal dN`: replace the base die, double the replaced base, add a
    non-doubled fatal die.
  - `backstabber`: +1 vs Off-Guard, doubled to +2 on a critical hit.
  - Shared `WeaponTraits.calculateWeaponDamage()` used by Strike and Reactive
    Strike, with Selection-panel weapon/trait/reach rows and a trait log line.

## Phase 8: Athletics & Combat Maneuvers
* **Session 8.1: Skill Checks & Saving Throw DCs** — ✅ implemented
  - `Combatant.saves` (Fortitude/Reflex/Will) and `skills` (Athletics/Acrobatics/Stealth/Perception), all defaulting to 0.
  - `getSkillModifiers`, `getSaveModifiers`, and `getDCModifiers` with Frightened and cover scopes.
  - `Checks.calculateDC` = `10 + base + resolved modifiers`; standard/greater cover is +2/+4 to Reflex and Reflex DC.
* **Session 8.2: Prone Condition & Stand Action** — ✅ implemented
  - Condition `prone`: Off-Guard (-2 circumstance AC), -2 circumstance penalty to attack rolls.
  - Action `Stand`: costs 1 action, removes `prone`, and provokes Reactive Strikes before the condition is removed.
* **Session 8.3: Trip, Shove & Grapple Actions** — ✅ implemented
  - `Trip` — ✅ implemented: 1 action, attack trait, Athletics vs Reflex DC; critical success = prone + 1d6 bludgeoning, success = prone, critical failure = attacker prone; uses and advances MAP.
  - `Shove` — ✅ implemented: 1 action, attack trait, Athletics vs Fortitude DC; success = 5-ft push, critical success = 10-ft push, critical failure = attacker prone. The sign-reduced centre-line push stops before walls, creatures, and grid bounds; a blocked second square collapses 10 ft to 5 ft. No provoke, no diagonal-parity change.
  - `Grapple` — ✅ implemented: 1 action, attack trait, Athletics vs Fortitude DC; success = `Grabbed`, critical success = `Restrained`, critical failure = attacker prone (approved simplification). Both conditions impose Off-Guard + Immobilized and store `sourceId`/`expiresOnSourceTurn`.
  - `Escape` — ✅ implemented: 1 action, attack trait, best of Unarmed/Athletics/Acrobatics vs the grappler's Athletics DC, MAP applies; success removes Grabbed/Restrained.
  - Duration — `Grabbed`/`Restrained` expire at the end of the grappler's next turn, and break on the grappler's Stride/Step or death.
  - View — Shove/Grapple target modes, an `Escape (best skill + modifier)` button, and Grabbed/Restrained/Immobilized badges + red chain ring.

## Phase 9: Advanced Geometry & Creature Sizes
* **Session 9.1: Large & Huge Creatures Occupancy**
  - `Large` (2x2 cells), `Huge` (3x3 cells).
  - Pathfinding updates: checking collision for the entire footprint during A* and Dijkstra.
* **Session 9.2: Multi-cell Reach & Flanking**
  - Calculating Reach (5 ft, 10 ft) from the edge of a multi-cell footprint.
  - Flanking large creatures: lines must pass through opposite sides/corners of the *entire* footprint.

## Phase 10: Survival, Healing & Dying Rules
* **Session 10.1: Unconscious, Dying & Wounded Conditions**
  - Reaching 0 HP sets `Unconscious` (drops initiative) and applies `Dying 1` (or `Dying 2` on critical hit).
  - `Wounded` condition increases starting `Dying` value.
* **Session 10.2: Recovery Checks**
  - Flat check (d20, no modifiers) at the start of the dying creature's turn.
  - DC 10 + current Dying value. Success reduces Dying, Failure increases Dying.
  - Reaching Dying 4 = death. Reaching Dying 0 = stable but unconscious.
* **Session 10.3: Healing & Stabilize**
  - Actions/Effects that restore HP (ignoring IWR).
  - Healing removes `Dying`, wakes the creature up (if > 0 HP), and increases `Wounded` by 1.