# Handoff

## Current milestone — Phase 28 (complete): Encounter victory + edge-to-edge LOS

Status: **implemented and verified**; full suite **558/558 tests pass, 38 suites**.

```text
Feature Readiness:
- goal: close the two defects left by the stress test — (1) Encounter.isOver only
  returned true when every combatant was defeated, so a decisive AI-vs-AI wipe
  still ran out the 15-round cap; (2) Strike LOS and Cover rays for multi-cell
  creatures were cast from the anchor (top-left) cell only.
- pf2e_remaster_rule:
  * Combat ends when no side can still fight another: every living combatant on
    one alliance, or nobody left.
  * Line of effect and cover are judged from a creature's space, edge-to-edge,
    matching the already-fixed geometric distance and flanking (Foundry measures
    cover rays between the corners of each token's full mechanical bounds).
- behavior_and_boundaries:
  * Encounter.isOver (getter) is alliance-aware. The raw `over` latch is still
    only set by the turn cycle when all combatants are defeated; serialization
    and the View keep using the latch, while the getter derives victory from
    living alliances.
  * Strike.evaluateStrike now traces line of sight across every pair of occupied
    cells (Grid.occupiedCellsOf) and accepts the first visible pair.
  * Cover.determineCover casts from the four outer corners of the attacker's
    whole footprint to the four outer corners of the target's whole footprint;
    same-cell overlap is now footprint overlap.
- data_contracts: no new public result fields. cover.js gains a grid-math
  dependency (Grid.occupiedCellsOf); strike.js adds the internal
  traceCombatantLineOfSight helper.
- acceptance_tests:
  * tests/Encounter/encounter.test.js — "combat ends when only one alliance
    remains"; the defeated-first-combatant fixture now uses mixed alliances.
  * tests/Grid/cover.test.js — Large footprint targetCorners + edge-to-edge
    cover around a wall.
  * tests/Actions/step-strike.test.js — "multi-cell creatures use edge-to-edge
    line of sight" (Medium anchor blocked vs Large edge clear).
  * Stress: 25/25 battles resolved decisively (11 player / 14 enemy), 0 timeouts,
    0 stalls, 0 anomalies. Full suite 558 passed, 0 failed.
- delegated_assumptions: alliance identity is the authored `alliance` string
  (Combatant defaults un-authored alliance to "player" with
  `allianceExplicit === false`; encounter fixtures always author it).
- confidence: 97%.
```

- `src/Core/Encounter/encounter.js` — `isOver` returns true when all living
  combatants share one `alliance`, or when none remain.
- `src/Core/Actions/strike.js` — `traceCombatantLineOfSight` replaces the
  single anchor-cell `LosMath.traceLineOfSight` in `evaluateStrike`.
- `src/Core/Grid/cover.js` — requires `grid-math.js`; `footprintCorners` and
  `footprintsOverlap` replace the single-cell `cellCorners`/`sameCell`.
- `docs/STRESS_TEST_REPORT.md` — rewritten with the resolved 25/25 result.
- `docs/rules/cover.md` / `docs/rules/strikes.md` — documented edge-to-edge
  footprint LOS/cover.

## Previous milestone — Phase 27 (complete): LOS-aware AI repositioning

Status: **implemented and verified**; full suite **554/554 tests pass, 38 suites**.

```text
Feature Readiness:
- goal: fix the tactical stall where a target geometrically in melee reach but
  blocked by a wall was never repositioned around; the AI instead issued Strikes
  that Strike.evaluateStrike rejected with "no-line-of-sight".
- pf2e_remaster_rule: a Strike requires line of effect (centre-to-centre LoS plus
  cover's noLineOfSight gate). Reuses Strike.evaluateStrike as the authoritative
  dry-run; no new rule is invented.
- behavior_and_boundaries: before treating an in-reach target as strikeable, the AI
  runs a dry-run Strike.evaluateStrike. On "no-line-of-sight" it treats the target
  as out of reach and routes around the wall via Pathfinding.findPath. Candidate
  attack cells are pruned by LoS so the AI walks to a square with a clear shot
  instead of another blocked one. Multi-cell (Large/Huge) footprint-aware LoS is
  explicitly deferred (Core scope).
- data_contracts: no new public contracts. tactical-ai.js gains a require of
  ../Grid/los-math.js (already loaded before it in index.html/test_runner.html).
- acceptance_tests: tests/AI/tactical-ai.test.js adds "AI navigates around wall
  when adjacent but blocked" (diagonally-adjacent pair + wall corner must Stride
  around, then Strike). Full suite 554 passed, 0 failed.
- delegated_assumptions: the dry-run uses Strike.evaluateStrike's anchor-cell
  (top-left) LoS trace, matching the actual Strike; footprint-aware LoS for
  multi-cell creatures is a separate Core limitation.
- confidence: 97%.
```

- `src/Core/AI/tactical-ai.js` — three call sites now gate "in reach" on line of
  effect, driven by two helpers:
  - `isStrikeBlockedByWall(actor, cell, target, map, combatants)` — a dry-run
    `Strike.evaluateStrike` against a prototype-linked projection of the attacker
    (so a projected anchor cell is read without mutating the live combatant);
    returns true only for the `no-line-of-sight` refusal.
  - `hasLineOfSight(from, target, map)` — cheap `LosMath.hasLineOfSight` used to
    prune candidate attack cells.
  - `chooseNextAction` treats an in-reach-but-blocked target as out of reach and
    calls `chooseMovement`; `computeApproach` no longer returns `inReach` when the
    wall blocks line of effect; `attackCellsAround` drops LOS-blocked candidates.
- `tests/AI/tactical-ai.test.js` — the regression test asserts the AI does **not**
  Strike through the wall first, repositions (Stride/Step), and only then resolves
  a successful Strike.
- `docs/STRESS_TEST_REPORT.md` — added the Resolution note and corrected the
  root-cause analysis: the remaining 25/25 timeouts are post-wipe idling (24) and a
  Huge-vs-Huge anchor-cell-LoS standoff (1), not the AI targeting gap.

## Previous milestone — Phase 26 (complete): Headless AI Stress-Test

Status: **implemented and verified**; full suite **553/553 tests pass, 38 suites**.

```text
Feature Readiness:
- goal: drive the headless Core (Encounter + TacticalAI + GridMap + Combatant)
  through thousands of randomized AI-vs-AI turns and re-validate the core combat
  invariants every turn, so a rules regression surfaces as a loud failure.
- pf2e_remaster_rule: exercises existing rules; the invariants encode the
  Remastered contracts the Core already implements (HP clamp [0, maxHP]; 3-action
  pool; living footprints never overlap walls or other living creatures;
  Restrained blocks attack/manipulate except Escape; Grabbed rolls a DC 5 flat
  check for manipulate actions).
- behavior_and_boundaries: seeded (mulberry32) generation of 15x15/20x20 arenas
  (5-15 connected walls, difficult/greater-difficult/hazardous fire cells, 1-2
  traps) and two teams of 2-4 combatants spanning Tiny..Huge and six equipment
  profiles. Combat loop: rollInitiative -> executeAITurn -> nextTurn, capped at
  15 rounds (timeout is a valid outcome). No View layer was touched.
- data_contracts: consumes GridMap, Combatant, Encounter, TacticalAI, Strike,
  Stride. Emits a per-battle audit and a stdout summary; overridable via
  PF2E_STRESS_SEED / PF2E_STRESS_BATTLES.
- acceptance_tests: tests/AI/stress-simulation.test.js (generator sanity, the
  Restrained gate, the Grabbed DC-5 flat check, and the >= 25-battle simulation
  with per-turn invariant validation). Full suite 553 passed, 0 failed.
- delegated_assumptions: synthetic stress stat blocks (not bestiary data); traps
  modelled as concentrated hazardous terrain; every combatant effectively
  threatens Reactive Strike (engine has no per-creature reaction feature flag).
- confidence: 95%.
```

- `tests/AI/stress-simulation.test.js` — new suite registered in
  `tests/run-node.js`: seeded PRNG, arena/combatant generators, the AI-vs-AI
  combat loop, per-turn invariant validation (HP/action/occupancy/condition/
  deadlock), and stall detection (no HP/position change for >= 8 consecutive
  turns). Report: **25/25 battles ran, 0 crashes, 0 invariant violations, 51,628
  invariant checks**.
- **Finding (not a defect in the test):** all 25 battles stalled to the 15-round
  timeout. Root cause: the AI decides a target is "in reach" by geometric distance
  and never repositions when a wall blocks line of sight, so it idles issuing
  `no-line-of-sight` Strikes. Documented in `docs/STRESS_TEST_REPORT.md`.
  Recommended next slice: make `TacticalAI` line-of-effect-aware (fall back to
  movement when the chosen target is in reach but not strikeable). **Resolved in
  Phase 27** — see `docs/STRESS_TEST_REPORT.md` for the corrected root-cause
  analysis (the residual timeouts are post-wipe idling plus one Huge-vs-Huge
  anchor-cell-LoS standoff).
- `docs/STRESS_TEST_REPORT.md` — full run report with the metric table, root-cause
  analysis, invariant coverage, and the recommended next slice.

## Previous milestone — Phase 25.1 (complete): Final mechanical-debt cleanup

Status: **implemented and verified**; full suite **549/549 tests pass, 37 suites**.

```text
Feature Readiness:
- goal: remove the last documented mechanical assumptions from the Core: hostile
  actions breaking stealth, maneuver free-hand/size requirements,
  whole-footprint flanking for multi-cell creatures, and multiple simultaneous
  grapples. Re-verify the Phase 25 Reach-10 and Restrained/Grabbed gates.
- pf2e_remaster_rule:
  * Using a hostile action (a Strike or a damaging/save spell) ends Hidden and
    Undetected; the creature becomes observed.
  * Trip, Shove, and Grapple require a free hand unless the wielded weapon has
    the matching `trip`/`shove`/`grapple` trait, and may target a creature at
    most one size category larger. Size ranks: tiny 0, small 1, medium 1,
    large 2, huge 3, gargantuan 4.
  * Flanking is decided by the line between the flankers' footprint centres
    crossing opposite sides of the target's whole footprint, matching Foundry
    `TokenPF2e#onOppositeSides`.
  * Grabbed/Restrained/Immobilized are source-linked instances. Two grapplers
    coexist; Escape releases only the selected source, and the victim is free
    only once every instance is gone.
- behavior_and_boundaries:
  * `Conditions.revealAfterHostileAction` removes only Hidden/Undetected.
    Light-based Concealed is a separate sensory state and survives.
  * Strike, Reactive Strike, and Cast a Spell call the helper only after the
    action actually resolved. Rejected/out-of-reach attempts and grabbed flat
    check failures never reveal. A non-damaging attack spell without a save is
    not treated as stealth-breaking.
  * The size gate runs before geometry/MAP and spends nothing; the free-hand
    gate remains first.
  * Flanking uses `Grid.occupiedCellsOf`, which now derives a plain object's
    footprint from its authored `size` as well as from a Combatant.
  * The canonical condition Map still holds one primary record per slug (the
    earliest source keeps `sourceId`); `getGrappleInstances()` /
    `getGrappleSources()` expose every simultaneous instance.
  * Phase 25's Reach-10 second-diagonal exception and the Restrained/Grabbed
    action gates are unchanged and still covered by their original suite.
- data_contracts:
  * `Rules/size.js`: `SIZE_RANKS`, `SIZE_FOOTPRINTS`, `normalizeSize`,
    `sizeRankOfName`, `getFootprintForSize`, `sizeRankOf`, `canManeuverTarget`.
  * `Combatant`: normalized `size`, `getSizeRank()`, 4x4 gargantuan
    `getFootprint()`, `getConditionInstances`, `getConditionFrom`,
    `getGrappleInstances`, `getGrappleSources`, `removeConditionFrom`.
  * `Conditions`: `HOSTILE_VISIBILITY_CONDITIONS`, `revealAfterHostileAction`.
  * `Flanking`: `footprintBounds`, `footprintCenter`, `segmentsIntersect`,
    `onOppositeSides`.
  * Maneuver result reason: `"target-too-large"`. Reload, Disable a Hazard, and
    Point Out now also honour `"restrained-action-blocked"` and
    `"grabbed-manipulate-failed"`.
- acceptance_tests:
  * `tests/Rules/canonical-compliance.test.js` adds 17 cases: Hidden/Undetected
    removal on Strike and attack/save spells, no reveal on a rejected attempt or
    non-damaging attack spell, the size-rank ladder and size gate, the
    trip-trait free-hand bypass, Large/Huge footprint flanking, two-grappler
    coexistence, Escape releasing one source at a time, same-source refresh,
    and a Restrained hold from a second source.
- delegated_assumptions:
  * Per the requested rule, both Hidden and Undetected become observed after a
    hostile action (Undetected is not merely downgraded to Hidden).
  * A stealth-breaking spell is a save spell or an attack spell with a damage
    formula, mirroring the requested scope.
  * Grapple critical failure keeps the approved attacker-prone-plus-release
    simplification.
- confidence: 98%
```

- `src/Core/Rules/size.js` — new pure size module: the canonical 0–4 rank
  ladder, size normalization, footprint sizes, and `canManeuverTarget`.
- `src/Core/Grid/grid-math.js` — `footprintOf`/`occupiedCellsOf` honour a plain
  object's authored `size`, so multi-cell geometry works with lightweight
  fixtures as well as `Combatant` instances.
- `src/Core/Grid/flanking.js` — whole-footprint flanking: the segment between
  the two flankers' footprint centres must cross both left/right edges or both
  top/bottom edges of the target's footprint (inclusive corner touches).
- `src/Core/Entities/combatant.js` — size normalization and `getSizeRank()`;
  gargantuan footprints (4x4); per-source Grabbed/Restrained/Immobilized
  instances with `getGrappleInstances`/`getGrappleSources`/`getConditionFrom`/
  `removeConditionFrom`.
- `src/Core/Entities/conditions.js` — `revealAfterHostileAction` and
  `HOSTILE_VISIBILITY_CONDITIONS`.
- `src/Core/Actions/strike.js` / `reactive-strike.js` — a resolved attack clears
  Hidden/Undetected after the roll and damage, while still using the hidden
  attacker Off-Guard benefit for that attack.
- `src/Core/Actions/cast-spell.js` — a save spell or damaging attack spell
  clears the caster's Hidden/Undetected after resolution.
- `src/Core/Actions/athletics-maneuver.js` / `trip.js` / `shove.js` /
  `grapple.js` — shared free-hand + `target-too-large` gates; Grapple applies
  per-source instances.
- `src/Core/Actions/escape.js` — unchanged call path now removes only the chosen
  source from the instance registry, so another grappler keeps its hold.
- `src/Core/Actions/disable-hazard.js` / `reload.js` / `stealth.js` — the
  manipulate gates now cover Disable a Hazard, Reload, and Point Out.
- Tests: **549 passed, 0 failed, 37 suites**. `docs/rules/` and
  `docs/RULES_COMPLIANCE.md` were updated to remove the corresponding
  limitation notes.

## Previous milestone — Phase 25 (complete): Rules-compliance hardening (Reach-10 & Grabbed/Restrained)

Status: **implemented and verified**; full suite **532/532 tests pass, 37 suites**.

```text
Feature Readiness:
- goal: remove the two mechanical simplifications left by the compliance audit:
  the Reach-10 "two diagonals" exception and the Grabbed/Restrained action
  restrictions.
- pf2e_remaster_rule:
  * CRB p.455 — "Unlike with measuring most distances, 10-foot reach can reach
    2 squares diagonally." The reference
    canvas/helpers.ts::measureDistanceOnGrid subtracts one square when
    reach === 10 and diagonal + doubleDiagonal > 1.
  * Restrained — "you can't use actions with the attack or manipulate traits,
    except to Escape."
  * Grabbed — "If you attempt a manipulate action while grabbed, you must
    succeed at a DC 5 flat check or it is lost."
- behavior_and_boundaries:
  * distance.js keeps reporting the raw 15-ft second diagonal; the new
    reach-aware helpers (reachDistance3DSquares / getCombatantReachDistance3D /
    canReach3D / getCombatantReachDistance / canReach) apply the reduction only
    to reach validation. Strike (and therefore Trip/Shove/Grapple and Reactive
    Strike) uses the 3D helper; Reactive Strike threat scanning and flanking
    use the flat helper.
  * Combatant.canAct({ traits, action }) blocks attack/manipulate while
    Restrained with reason "restrained-action-blocked"; Escape is exempt.
    Strike also checks the predicate directly because it never called canAct.
    Cast a Spell and Interact call the gate and return the same reason.
  * Combatant.resolveGrabbedManipulate({ traits, ...dice }) performs the DC 5
    flat check for manipulate actions. Cast a Spell and Interact spend the
    action on failure and return "grabbed-manipulate-failed".
  * Grabbed-only (not Restrained) triggers the flat check; Restrained already
    hard-blocks the action.
- data_contracts:
  * Distance3D: REACH_TWO_DIAGONAL_FEET, reachDistance3DSquares,
    getCombatantReachDistance3D, getCombatantReachDistance, canReach3D, canReach.
  * Strike result: reachDistanceFeet; STRIKE_REASONS.RESTRAINED_ACTION_BLOCKED.
  * Conditions: ACTION_TRAITS, normalizeActionTraits, isEscapeAction,
    isRestrainedActionBlocked, isGrabbedManipulate.
  * Combatant: canAct(options), resolveGrabbedManipulate(options).
  * CastSpell/Interact reasons: "restrained-action-blocked",
    "grabbed-manipulate-failed".
- acceptance_tests:
  * reach-10 Strike on (dx=2, dy=2) is valid with distanceFeet 15,
    reachDistanceFeet 10; reach-5 is out-of-reach.
  * reach-10 Reactive Strike threatens the (2,2) cell; reach-5 does not.
  * reach-10 flanking works across the two-diagonal opposite corners.
  * Restrained blocks Strike/Trip/CastSpell/Interact before spending; Escape
    still succeeds; canAct exempts Escape.
  * Grabbed + manipulate CastSpell with a failed DC 5 flat check spends the
    action and returns "grabbed-manipulate-failed"; a passed check resolves the
    spell; a non-manipulate spell is not gated.
  * Grabbed + manipulate Interact fails/passes the same way.
- delegated_assumptions:
  * Only Escape is excepted from Restrained (Force Open is not modelled).
  * A failed Grabbed check spends the action but does not consume the spell
    slot/Focus Point (the cast never begins); a disrupted manipulate cast keeps
    the existing behaviour of consuming the resource.
- confidence: 97%
```

- `src/Core/Grid/distance.js` — new reach-aware helpers (see contracts above).
  `distance3DSquares` / `getDistance3D` are unchanged, so the raw 5-10-5 cost
  of the second diagonal remains 15 ft.
- `src/Core/Actions/strike.js` — `evaluateStrike` refuses a Restrained attacker
  with `restrained-action-blocked`; the melee reach check now uses
  `getCombatantReachDistance3D`, and the evaluation/result expose
  `reachDistanceFeet`.
- `src/Core/Actions/reactive-strike.js` / `src/Core/Grid/flanking.js` — threat
  scanning and flanking reach now use `Distance3D.canReach` (flat variant) so a
  reach-10 creature covers the second diagonal.
- `src/Core/Entities/conditions.js` — `ACTION_TRAITS`,
  `isRestrainedActionBlocked`, `isGrabbedManipulate`, plus trait normalization.
- `src/Core/Entities/combatant.js` — `canAct(options)` gains the Restrained gate;
  `resolveGrabbedManipulate(options)` resolves the DC 5 flat check.
- `src/Core/Actions/cast-spell.js` / `src/Core/Actions/interact.js` — apply the
  Restrained gate and the Grabbed flat check to manipulate actions.
- Tests: `tests/Rules/reach-and-restrictions.test.js` (19 cases) registered in
  both runners. Full suite: **532 passed, 0 failed, 37 suites**.
- `docs/RULES_COMPLIANCE.md` — removed the Reach-10 and Restrained limitation
  notes, added Sections 5–6, updated the compliance table.

## Previous milestone — Phase 24 (complete): Battlefield Editor, Scene Presets & Token Management

Status: **implemented and verified in the browser**; Core business logic is
unchanged (492/492 tests pass, 35 suites).

- `index.html` adds a scene toolbar above the canvas: the **Default Encounter /
  Empty Arena** preset select, six terrain brushes (Select, Wall, Difficult,
  Greater Difficult, Hazardous, Illumination), and **Очистить поле боя**.
- `src/View/UI/confirm-dialog.js` is a reusable Foundry-style confirmation modal.
  Escape, the backdrop, and **Нет** cancel; **Да** clears the board.
- `src/View/UI/scene-editor.js` owns preset/brush/clear presentation and forwards
  intents to the host.
- `src/View/battlefield-view.js` adds `PF2e.View.PAINT_TOOLS` and a paint cursor
  mode. While a brush is active, canvas clicks call `onPaintRequest` instead of
  resolving an action; the component refreshes reachability and re-renders after
  every edit.
- `src/main.js` extracts `createDefaultMap()` / `createDefaultCombatants()` /
  `createDefaultHazards()`, adds the empty-roster `NullEncounter` adapter,
  applies presets, paints `GridMap` primitives, and rebuilds the Encounter after
  token deletion. `window.PF2e.App` exposes `sceneEditor`, `applyScenePreset`,
  `clearBoard`, `deleteCombatant`, and `paintTerrainCell`.
- `src/View/Tokens/token-hud.js` adds a 🗑️ **Удалить токен** button. Delete and
  Backspace remove the selected token with a `<name> удален со сцены` log line.
- `docs/HANDOFF_UI.md` documents the Phase 24 readiness block, accepted browser
  checks, and deferred editor limitations.

## Previous milestone — Phase 23 (complete): Data Ingestion & Compendium Browser

Status: **implemented and verified in the browser**; Core business logic is
unchanged (492/492 tests pass, 35 suites).

- `scripts/build-compendiums.js` reads `../pf2e-reference/packs/pf2e` and emits
  four combat-focused catalogs in `data/compendiums/`: 200 spells, 200 weapons,
  125 shields, and 200 monsters. `npm run build:data` regenerates them.
- `src/View/UI/compendium-browser.js` replaces the Library placeholder with
  category tabs, name search, rank/level and spell-save filters, recipient
  selection, expandable stat cards, and equip/add-spell/spawn actions.
- `src/main.js` maps catalogs into Combatant inventory/spells, equips items
  through `combatant.equipItem`, and spawns bestiary monsters as real Combatants
  registered in a rebuilt Encounter while preserving round and active turn.
- `index.html`, `css/main.css`, and `package.json` carry the panel markup, Phase
  23 styling, script include, and build command.
- Full UI notes, accepted browser checks, and deferred limitations live in
  `docs/HANDOFF_UI.md`.

## Previous milestone — Phase 21 (complete): Token HUD & Condition Palette

Status: **implemented and verified in the browser**; Core business logic is
unchanged (492/492 tests pass, 35 suites).

- `src/View/Tokens/token-hud.js` adds a Foundry-style right-click HUD anchored
  above the token. It exposes a settings-gear placeholder, direct HP editing
  (`takeDamage` / `applyHealing`, clamped to max HP and sent through the
  CombatEventBus), and a 5-column palette for all 16 core conditions.
- Valued conditions step by one: left click adds/increments, right click
  decrements/removes. Unvalued conditions toggle on left click.
- Canvas left click still only selects; left/right click on empty space or a
  different token closes the HUD. Escape also closes it.
- `css/main.css` carries the dark translucent HUD/palette theme, active-cell
  glow, invalid-input shake, and CSS tooltips. `index.html` loads the module
  and describes Phase 21. `src/main.js` wires the HUD and exposes
  `window.PF2e.App.tokenHud`.
- Full UI notes and acceptance checks live in `docs/HANDOFF_UI.md`.

## Previous milestone — Phase 20 (complete): View & Presentation Integration

Status: **implemented and verified in Node and the browser**.

```text
Feature Readiness:
- goal: expose every Phase 9–19 core subsystem through index.html and
  test_runner.html, drive the combat log and round header from one
  CombatEventBus, render Large/Huge footprints, elevation, AoE templates,
  illumination and hazardous terrain, and add magic/stealth/AI/save-load HUD
  controls.
- pf2e_remaster_rule: presentation only for existing rules. New geometry uses
  the canonical Phase 16 AoE functions (burst, 90-degree cone, line, emanation)
  and the Phase 18 illumination/terrain classes. Large/Huge footprints use
  Combatant.getFootprint(); elevation uses Combatant.getElevation() and the
  Phase 18 3D distance. No new combat math was invented for the view.
- behavior_and_boundaries: single CombatEventBus shared by Encounter,
  Combatants, Hazards and the View; log bridge for combatant:damaged (IWR +
  Shield Block), combatant:moved (feet/actions), condition:added/removed
  (including Stunned/Slowed/Paralyzed), reaction:triggered (Reactive Strike and
  Shield Block), hazard:triggered/disabled, turn:changed and round:started.
  Canvas renders footprint-sized tokens, elevation chips, AoE cell overlays and
  red outlines on caught tokens, dim/darkness washes, greater-difficult and
  hazardous textures. HUD adds Roll Initiative, spell selection + Cast Spell,
  Sustain, Seek, Hide, Sneak, Disable Hazard, AI Step, AI Turn, Save Combat and
  Load Combat. Hazard ownership remains explicit in the host (HAZARDS array);
  event replay/undo is still out of scope.
- data_contracts: index.html / test_runner.html load the full Core order
  (geometry → rules → entities → encounter/state → actions → AI → view).
  window.PF2e now exposes Grid.AoE, Grid.Illumination, Distance3D, Hazard,
  Shield, Equipment, Afflictions, Spells, CastSpell, SustainSpell, Interact,
  ShieldBlock, Stealth, DisableHazard, TacticalAI, Initiative, State.CombatEventBus
  and State.Serializer. New View contracts: EventLogBridge; BattlefieldView
  modes CAST/SNEAK, setSpell/setWorld/getAoeCells, onCastRequest/onSneakRequest;
  TokenView footprint or elevation accessors; GridView.drawIllumination,
  drawGreaterDifficultTerrain, drawHazardousTerrain, drawAoeCells and
  drawAoeTargets. CastSpell save areas now accept burst/cone/line/emanation.
  TacticalAI.executeAITurn accepts maxActions for one-step execution.
  DisableHazard now uses Hazard.disarm() so hazard:disabled is emitted.
- acceptance_tests: Node `npm test` = 492 passed, 0 failed, 35 suites;
  browser `test_runner.html` = 492 passed, 0 failed, 35 suites with an empty
  console. Manual browser checks: Roll Initiative rebuilds the queue; Fireball
  shows a burst template and logs [SPELL]/[SAVE]/[DAMAGE]; Burning Hands,
  Lightning Bolt and Bless produce cone/line/emanation templates; AI Turn and
  AI Step spend actions and log each step; Save Combat writes localStorage and
  Load Combat rebuilds the board; Shield Block logs [REACTION] plus the IWR /
  Shield Block damage audit; Disable Hazard logs hazard:disabled.
- delegated_assumptions: the Merisiel spellbook, Ogre/Hill Giant stat blocks,
  map illumination pockets, greater-difficult rubble, fire vents and Spike Trap
  are demo fixtures, not canonical bestiary data. Save uses localStorage only
  (no file download). Cone/line origins are caster cell centres, matching the
  Phase 16 template engine.
- confidence: 97%
```

- `index.html` / `test_runner.html` — full script order and HUD markup:
  - every Core module from Phases 9–19 is loaded before its dependants;
  - `test_runner.html` now registers all 35 suites, including the three
    previously Node-only suites (Dying, Afflictions/Durations, Initiative/
    Serialization), converted to the shared UMD pattern;
  - new panels: Magic & Stealth, Hazards, Tactical AI & State; Roll Initiative
    sits beside End Turn.
- `src/View/UI/event-log.js` — `EventLogBridge`:
  - subscribes to all nine standard event types through one bus;
  - formats the full IWR chain, Shield Block Hardness/shield HP, movement cost
    in feet and squares, condition labels/values, `[REACTION]`, `[HAZARD]`,
    `[TURN]` and `[ROUND]` lines;
  - queues damage/turn lines so the synchronous action roll line is printed
    first; `flush()` is called at the end of every host action; a macrotask
    fallback prevents stranded lines;
  - updates the round badge and the active initiative row directly from
    `turn:changed` / `round:started`.
- `src/View/Tokens/token-view.js`:
  - token centre, radius, HP bar and name plate are measured over the whole
    `getFootprint() * cellSize` area, so Large (2x2) and Huge (3x3) creatures
    fill their footprint and are hit-tested across it;
  - non-zero `getElevation()` renders a contrasting `▲ 15 ft` / `▼ 5 ft` chip.
- `src/View/Grid/grid-view.js`:
  - `drawIllumination` (dim wash, deep darkness), `drawGreaterDifficultTerrain`
    (+10 ft rubble), `drawHazardousTerrain` (warning hatch + damage chip);
  - `drawAoeCells` palettes per area type and `drawAoeTargets` red outlines for
    tokens inside the template.
- `src/View/battlefield-view.js`:
  - new `CAST` and `SNEAK` modes; `setSpell` computes burst/cone/line/emanation
    cells from the hovered origin; `setWorld` swaps in deserialized state;
  - `findCombatantAtCell` is footprint-aware; `onCastRequest`/`onSneakRequest`
    callbacks keep rules resolution in `main.js`.
- `src/main.js`:
  - constructs one `CombatEventBus`, passes it to `Encounter`, wires
    `EventLogBridge`, and exposes `window.PF2e.App` for integration checks;
  - demo content adds Merisiel's spellbook, Ogre (Large), Hill Giant (Huge),
    Goblin elevation 5 ft, dim/darkness pockets, greater-difficult rubble, fire
    vents and an armed Spike Trap;
  - new host actions: Roll Initiative, Cast Spell, Sustain, Seek, Hide, Sneak,
    Disable Hazard, AI Step, AI Turn, Save Combat, Load Combat; Save/Load uses
    `serializeCombatState` / `deserializeCombatState` + localStorage and rebuilds
    token cards, initiative, round badge and hazard state.
- `src/Core/Actions/cast-spell.js` — save-spell area regression extension:
  `buildTargetPlan` now supports burst, cone, line and emanation using the
  canonical Phase 16 AoE functions; burst behavior is unchanged.
- `src/Core/AI/tactical-ai.js` — `executeAITurn({ maxActions })` caps the number
  of executed actions (used by the AI Step button) without changing full-turn
  behaviour.
- `src/Core/Actions/disable-hazard.js` — successful disables now call
  `Hazard.disarm()` so `hazard:disabled` reaches listeners.
- `src/Core/Grid/grid-math.js` — the Grid namespace is deliberately extensible
  so `Grid.AoE` and `Grid.Illumination` can attach in classic-script builds.
- `src/Core/State/event-bus.js` — browser registration now exposes the
  `CombatEventBus` class directly (plus EVENT_TYPES/defaultBus helpers).
- Tests: `tests/Actions/advanced-spells.test.js` adds cone/line/emanation
  cast-time target-selection cases; `tests/AI/tactical-ai.test.js` adds the
  `maxActions: 1` AI-step case. Full Node suite: **492 passed, 0 failed,
  35 suites**.
- Deliberately deferred: event replay/undo, drag-and-drop token movement,
  multiple simultaneous selected spells, spell heightening/upcasting in the
  picker, ranged AI kiting, hazard re-arm cadence, and full line-of-effect
  rendering for every lighting source.

## Previous milestone — Phase 19 (complete): Initiative Engine, Global Event Bus & Combat State Serialization

Status: **implemented and verified**.

```text
Feature Readiness:
- goal: roll PF2e initiative, expose core events, and save/restore a complete
  encounter so combat can continue after a JSON round-trip.
- pf2e_remaster_rule: initiative = d20 + Perception (or Stealth when starting
  from cover/concealment). Ties: enemies before allies; within one alliance the
  higher base statistic modifier; absolute ties keep stable registration order.
- behavior_and_boundaries: deterministic initiative rolling, canonical
  tie-breaks, full JSON state export/import, and an optional pub/sub bus. View/
  HTML was not modified. Hazards are serialized but remain caller-owned (the
  Encounter does not own a hazard roster).
- data_contracts: Encounter.rollInitiative({ combatants, rolls }); Combatant
  initiative fields (initiativeRoll, initiativeStatistic, initiativeModifier);
  serializeCombatState/deserializeCombatState; CombatEventBus on/off/emit/clear
  and the nine standard event types.
- acceptance_tests: tests/State/initiative-serialization.test.js (16 cases) —
  enemy tie-break, same-alliance modifier tie-break, registration fallback,
  authored-order tie-break, Stealth detection, array/object rolls,
  damage/condition/reaction/turn/round/hazard/movement events, and a JSON
  round-trip that still performs a Strike.
- delegated_assumptions: none beyond the explicitly requested tie-break order.
- confidence: 98%
```

- `src/Core/Encounter/initiative.js` — pure initiative engine:
  - `resolveInitiativeStatistic(combatant, options)`: explicit
    `options.statistics[id]` / `options.statistic`, then an authored
    `combatant.initiativeStatistic`, then Stealth when the creature starts
    concealed/hidden/undetected or carries a cover/stealth flag, else
    Perception.
  - `getInitiativeModifier(combatant, statistic)` reads
    `getSkillModifier()`/`skills`; `rollInitiative(combatants, options)`
    computes `d20 + modifier` and writes `initiative`, `initiativeRoll`,
    `initiativeStatistic`, and `initiativeModifier`.
  - `compareInitiative(a, b, { registration })` implements the canonical
    tie-break chain: higher total → enemy before ally → higher base statistic
    modifier → stable registration index → stable id. `sortInitiative()` is
    non-mutating.
  - Deterministic rolls accept `rolls[id] = 12`, `rolls[id] = { d20: 12 }`,
    an array in roster order, a roll callback, `rollD20`, or `rollDie(20)`.
- `src/Core/Encounter/encounter.js` — integration:
  - Captures a stable `registration` Map once; every sort and re-sort uses it.
  - `rollInitiative({ combatants, rolls, statistic, statistics, stealth })`
    rolls the roster, re-sorts, starts round 1, resets every combatant, and
    activates the first living creature. Returns `{ active, round, order,
    entries, rolls }`.
  - Optional `eventBus`/`bus` in the constructor or `setEventBus(bus)`.
    Emits `round:started` and `turn:changed` (including the `previousId`,
    `activeId`, `wrapped`, and `index`). The bus is propagated to every
    combatant.
  - Browser compatibility: because the legacy HTML entry points do not load
    `initiative.js`, `Encounter` contains a small fallback comparator/roller
    with the same tie-break order. Node always uses the canonical module.
- `src/Core/State/event-bus.js` — `CombatEventBus`:
  - `on(eventType, callback)` returns an unsubscribe function; `off(type,
    callback?)`, `emit(type, payload)`, `clear(type?)`, `listenerCount()`,
    `hasListeners()`. `"*"` subscribes to every event.
  - `EVENT_TYPES`: `combatant:damaged`, `combatant:moved`, `condition:added`,
    `condition:removed`, `hazard:triggered`, `hazard:disabled`,
    `turn:changed`, `round:started`, `reaction:triggered`.
  - Listener exceptions are captured in `errors` and do not interrupt combat.
    Optional `recordHistory` keeps an ordered event log.
- `src/Core/Entities/combatant.js` — bus integration:
  - Optional `eventBus`/`bus` in the constructor, `setEventBus()`, and
    `emitEvent()`; payloads always include `combatantId`/`combatantName`.
  - `takeDamage()` emits `combatant:damaged` with amount, type,
    `damageTaken`, post-IWR `damageApplied`, `actorDamageApplied`,
    `shieldBlock`, `iwr`, HP, and defeat state.
  - `addCondition()`/`removeCondition()` emit `condition:added` (with
    `refreshed`) and `condition:removed` with the condition record.
  - `spendReaction(count, metadata)` emits `reaction:triggered`; Reactive
    Strike and Shield Block pass `type: "reactive-strike"` /
    `type: "shield-block"` metadata.
- `src/Core/Actions/stride.js`, `step.js` — emit `combatant:moved` with the
  traversed path, cost in feet, `actionsSpent`, remaining actions, origin,
  destination, and interruption state.
- `src/Core/Entities/hazard.js` — optional bus; `trigger()` emits
  `hazard:triggered`, while breaking/destroying/disarming emits
  `hazard:disabled` with a reason.
- `src/Core/State/serializer.js` — deterministic save/restore:
  - `serializeCombatState({ encounter, map, combatants, hazards })` exports a
    pure JSON object with `version`, encounter clock/order/active id,
    registration order, map geometry, combatants, and hazards.
  - Map export includes bounds, blocked cells, difficult and
    greater-difficult terrain, hazardous cells (`damage`/`type`), and
    non-bright illumination (`dim`/`darkness`; bright is the default).
  - Combatant export includes HP/maxHP, `x`/`y`/`elevation`, hands (by item id),
    inventory, shield (HP/broken state), conditions with values, sources,
    durations, origin, and application round, afflictions, spell slots, focus
    points, sustained spells with target ids, actions/reactions, IWR, senses,
    traits, weapon range profile, and initiative audit fields.
  - `deserializeCombatState(jsonState, { eventBus })` accepts an object or a
    JSON string and rebuilds live `Encounter`, `GridMap`, `Combatant`, and
    `Hazard` instances. Sustained-spell targets are relinked by id. The
    restored state is ready to continue with Stride, Strike, CastSpell, etc.
  - Round-trip invariant: serializing the deserialized state is deep-equal to
    the original snapshot.
- Tests: `tests/State/initiative-serialization.test.js` (16 cases) is
  registered in `tests/run-node.js`. Full Node suite: **488 passed, 0 failed,
  35 suites**.
- Deliberately deferred: hazard roster ownership on `Encounter`, event
  replay/undo, and browser loading of the new `State/` scripts at the time.
  **Superseded by Phase 20**, which loads every State/AI/action module in both
  HTML entry points and wires the bus to the View.

## Previous milestone — Phase 18 (complete): Advanced Terrain, Verticality & Battlefield Hazards

Status: **implemented and verified**.

- `src/Core/Grid/grid-map.js` — expanded terrain + hazardous cells:
  - `GridMap.TERRAIN_TYPES` = `normal` / `difficult` / `greater-difficult`,
    with `TERRAIN_EXTRA_FEET` = 0 / 5 / 10 ft. `setTerrain(x, y, type)`,
    `getTerrain(x, y)`, `getTerrainExtraFeet(x, y)`,
    `hasGreaterDifficultTerrain(x, y)`, `isDifficultTerrain(x, y)`, and
    `getGreaterDifficultTerrainCells()`. The legacy `setDifficultTerrain` /
    `hasDifficultTerrain` / `difficult` set are preserved; "greater-difficult"
    lives in a sibling `greaterDifficult` set so existing behaviour is intact.
  - Hazardous terrain: `setHazardous(x, y, { damage, type } | { damageSpec })`,
    `getHazardous(x, y)` (→ `{ damage, type }` or null), `hasHazardous(x, y)`,
    and `getHazardousCells()`. The constructor accepts `terrain` and
    `hazardous` arrays; `clone()` and `toAscii()` copy/render them.
- `src/Core/Grid/pathfinding.js` — `terrainExtraFeet` now reads
  `GridMap.getTerrainExtraFeet`, so greater-difficult terrain adds +10 ft on
  top of the straight/diagonal base cost (first square into it costs 15 ft).
- `src/Core/Actions/stride.js` — on entering a hazardous cell the mover takes
  damage immediately through `takeDamage(amount, { type })`; results carry a
  `hazardousDamageTaken` array. Armed traps whose `triggerArea` contains an
  entered cell fire their reaction, stop the mover on that square
  (`movementInterrupted`, `stoppedAt`), and discharge (`isArmed = false`);
  results carry a `triggeredHazards` array. `performStride` accepts `hazards`.
- `src/Core/Actions/step.js` — Step now refuses any difficult terrain
  (`isDifficultTerrain`), including greater-difficult, and applies/reports
  `hazardousDamageTaken` when stepping onto hazardous terrain.
- `src/Core/Grid/distance.js` — canonical 3D distance:
  - `distance3DSquares(dx, dy, dzFeet)` converts each axis to 5-ft squares,
    sorts, and applies `floor(doubleDiagonal * 1.75 + diagonal * 1.5 +
    straight)` — the exact Foundry PF2e `measureDistanceOnGrid` formula, which
    reduces to the 2D 5-10-5 rule when the elevation delta is zero.
  - `getDistance3D(a, b)` and `getCombatantDistance3D(a, b)` (edge-to-edge via
    `Grid.occupiedCellsOf`, so Large creatures keep nearest-edge reach).
- `src/Core/Entities/combatant.js` — `elevation` (default 0 ft, any finite
  number), `getElevation()`, and `setElevation(feet)`.
- `src/Core/Actions/strike.js` — melee reach and ranged range-increment
  distance now use `getCombatantDistance3D`, so a target 15 ft up is out of a
  5-ft reach but still targetable by a bow. Because Trips/Shoves/Grapples reuse
  `Strike.evaluateStrike`, their reach inherits 3D distance too.
- `src/Core/Entities/hazard.js` — `Hazard` class with `{ id, name, stealthDC,
  disableDC, disableSkill, hp, maxHP, hardness, brokenThreshold, isBroken,
  isArmed, reset, triggerArea, reaction }`. `takeDamage` disarms on broken or
  destroyed. `Hazard.resolveReaction(hazard, target, options)` rolls the
  reaction's damage (and optional Basic Save via `Rules/spells.js`) without
  mutating the armed state; `hazard.trigger(...)` discharges. The reaction
  profile accepts an optional `saveType` / `saveDC`.
- `src/Core/Actions/disable-hazard.js` — `performDisableHazard({ combatant,
  hazard, rollD20, rollDie, rollDamageDie })`: 2 actions, `manipulate` trait.
  Rolls the listed `disableSkill` (default `thievery`) against `disableDC`
  through the central modifier resolver. Success/Critical Success disarms;
  Critical Failure fires the trap at the disabler.
- Tests: `tests/Grid/hazards-verticality.test.js` (12 cases: greater-difficult
  straight/diagonal cost, terrain-class separation, hazardous Stride/Step
  damage, elevation defaults, 3D distance values, out-of-reach flying target vs
  in-range archer, trap firing + discharge, disarmed trap no-op, Thievery
  disable, and critical-failure backfire). Registered in `tests/run-node.js`.
  Full Node suite: **472 passed, 0 failed, 34 suites**.
- Deliberately deferred: View/HTML integration (not modified), 3D distance in
  Reactive Strike threat scanning, flanking geometry, and AoE templates (those
  remain 2D), trap triggering on Step (spec scopes trap triggers to Stride,
  mirroring the existing "Step never scans reactions" rule), the 10-ft reach
  "two diagonals" exception, hazard re-arm/reset round cadence, and Secrecy/
  Perception contests for hidden hazards.

## Previous milestone — Phase 17 (complete): Stealth Actions, Senses & Illumination

Status: **implemented and verified**.

- `src/Core/Entities/combatant.js` — senses model:
  - `senses` is normalized from strings or objects into canonical slugs. The
    list always includes `"vision"`; supported authoring includes
    `"low-light-vision"`, `"darkvision"`, `"tremorsense-<N>"`, `"scent-<N>"`,
    `{ type: "tremorsense", range: 30 }`, and spaced labels such as
    `"Low-Light Vision"`.
  - Methods: `getSenses()`, `hasSense(name)` (a base query matches ranged
    variants), `hasLowLightVision()`, `hasDarkvision()`, `getSenseRange(name)`,
    `addSense(sense)`, and `removeSense(name)`.
- `src/Core/Grid/grid-map.js` — per-cell illumination:
  - `GridMap.ILLUMINATION_LEVELS` = `bright` (default) / `dim` / `darkness`.
  - Constructor accepts `illumination: [{ x, y, level }]`, `dim: [cells]`, and
    `darkness: [cells]`.
  - `setIllumination(x, y, level)` (setting `bright` clears the override),
    `getIllumination(x, y)`, and `getIlluminationCells(level)`.
  - `clone()` copies the sparse illumination map.
- `src/Core/Grid/illumination.js` — pure perception engine:
  - `getPerceivedVisibility(observer, target, gridMap, options)` returns
    `{ level, lightLevel, cell, visibility, condition, flatCheckDC, targetable,
    observed, senses }`.
  - Bright light → `observed`; dim light → `concealed` (DC 5) unless the
    observer has low-light vision or darkvision; darkness → `hidden` (DC 11)
    unless the observer has darkvision, or `undetected` when
    `{ silent: true }` / `targetNoisy: false` is supplied.
  - Existing `concealed`/`hidden`/`undetected` conditions and an explicit
    `invisible` flag are preserved. `{ ignoreConditions: true }` returns the
    raw light/sense result, which the stealth actions use for concealment.
  - Large targets use the brightest cell of their footprint.
- `src/Core/Actions/stealth.js` — four actions, all with injectable `d20` /
  `rollD20` and shared `Checks` / modifier-resolver pipelines:
  - `performSeek({ seeker, areaType, origin, direction, radiusFeet, combatants,
    map, d20, rollD20 })`: 1 action, `concentrate` + `secret`; 30-ft cone
    (direction required) or 15-ft burst. One Perception check is compared with
    every hidden/undetected target's Stealth DC. Critical success → `observed`
    (all visibility conditions cleared); success → `undetected` becomes
    `hidden` (a hidden target stays hidden); failure/critical failure → no
    change. Returns the area cells, check audit, per-target degrees, `revealed`,
    and `downgraded` ids.
  - `performHide({ combatant, observers, map, d20, rollD20 })`: 1 action,
    `secret`. Requires standard/greater cover from an observer or concealment
    (dim/darkness relative to an observer, or an explicit `concealed`
    condition); otherwise `{ ok: false, reason:
    "no-cover-or-concealment" }` without spending. Rolls Stealth against the
    highest Perception DC among observers with line of sight. Success or
    critical success applies `hidden`; failure clears visibility to observed.
  - `performSneak({ combatant, destination, observers, map, d20, rollD20 })`:
    1 action, `move` + `secret`. Requires an existing `hidden`/`undetected`
    state. Uses `Pathfinding.findPath` (footprint and occupancy aware); the
    path cost may not exceed `Math.floor(speed / 10) * 5` (Speed 30 → 15 ft),
    otherwise `exceeds-sneak-speed` without spending. Success moves the token
    and keeps `hidden` only when the destination still offers cover or
    concealment; failure moves and becomes observed; critical failure stops at
    the starting square and becomes observed.
  - `performPointOut({ combatant, target, allies })`: 1 action, `auditory`,
    `visual`, `manipulate`. Refuses with `target-not-undetected` otherwise.
    Replaces the target's `undetected` with `hidden` and reports per-ally
    awareness.
- Tests: `tests/Actions/stealth-senses.test.js` (10 cases: sense authoring and
  ranged senses, dim-light concealed vs low-light vision, darkness hidden /
  darkvision / silent undetected, Hide behind standard cover, Hide refusal in
  the open, Sneak half-Speed cap and Hidden retention, Seek burst critical
  success, Seek success downgrade, 30-ft cone Seek, and Point Out). Registered
  in `tests/run-node.js`. Full Node suite: **460 passed, 0 failed, 33 suites**.
- Deliberately deferred: View/HTML integration (not modified), visibility
  memory per observer, invisibility/see-invisibility effects, tremorsense and
  scent range substitution for sight, Reactive Strike interruption during
  Sneak, Seek against merely concealed targets, group Stealth rolls, and
  Point Out's 30-ft ally range/visual-auditory eligibility filtering.

## Previous milestone — Phase 16 (complete): Advanced Spellcasting & Geometry

Status: **implemented and verified**.

- `src/Core/Grid/aoe.js` — three additional headless area templates, all using
  the canonical PF2e 5-10-5 distance:
  - `getLineCells(origin, direction, lengthFeet, widthFeet = 5, gridMap)`:
    straight line beginning at the edge of the origin cell. Directions accept
    compass names (`"ne"`, `"south-west"`, ...) or vectors (`{x,y}` /
    `{dx,dy}`), snapped to the eight grid directions. Orthogonal steps cost
    5 ft; diagonal steps alternate 5/10 ft. A blocked centreline cell stops the
    line, so walls block everything behind them. Widths above 5 ft add
    perpendicular lanes.
  - `getConeCells(origin, direction, lengthFeet, gridMap)`: 90-degree wedge
    (45 degrees either side of the axis). A cell is affected when its centre is
    inside the wedge, its 5-10-5 distance from the apex is within range, it is
    not an obstacle, and a Bresenham line of effect from the apex is not cut by
    a wall. The apex cell is excluded.
  - `getEmanationCells(combatant, radiusFeet, gridMap)`: measured from every
    cell of `combatant.getOccupiedCells()`. The footprint itself (the caster)
    is always excluded; blocked cells are skipped and the area is clipped to
    the map bounds. A Large 2x2 creature with a 10-ft emanation therefore has
    20 affected cells on an open grid.
  - `normalizeDirection` is exported for hosts that need the same snapping.
- `src/Core/Entities/combatant.js` — spellcasting resources:
  - `spellSlots` normalised from `spellSlots` or `data.spellSlots`; accepted
    forms are `{ 1: 3 }` and `{ 1: { max: 3, current: 2 } }`. Methods:
    `getSpellSlots()`, `getSpellSlot(rank)`, `hasSpellSlot(rank)`,
    `spendSpellSlot(rank)`.
  - `focusPoints` normalised from `focusPoints` or `data.focusPoints`, default
    `{ max: 0, current: 0 }`. Methods: `getFocusPoints()`, `hasFocusPoint()`,
    `spendFocusPoint(count)`, `restoreFocusPoints(amount)`.
  - `activeSustainedSpells` records `{ id, spellId, spell, target,
    expiresAtRound }`. Methods: `getActiveSustainedSpells()`,
    `getActiveSustainedSpell(id)`, `addSustainedSpell(...)`,
    `extendSustainedSpell(id, round)`, `removeSustainedSpell(id)`, and
    `expireSustainedSpells(round)`.
  - `endTurn()` now expires sustained spells at the end of the caster's turn
    and returns `expiredSustainedSpells`.
- `src/Core/Actions/cast-spell.js` — resource validation before targeting,
  reactions, or dice:
  - a spell with the `cantrip` trait spends nothing (even if a rank is authored);
  - `focus` spends 1 Focus Point and **not** a spell slot;
  - any other spell with `rank`/`level` spends one slot of that rank.
  - Refusals are `{ ok: false, reason: "no-spell-slots" }` and
    `{ ok: false, reason: "no-focus-points" }`, and spend no action, slot, or
    Focus Point.
  - Successful results expose `resourceCost: { type, spent, rank?, remaining }`.
  - A spell with the `sustained` trait is registered with
    `expiresAtRound = encounter.round + 1` and returned as `sustainedSpell`.
  - A disrupted manipulate cast still consumes the slot/Focus Point (the
    spell is lost), matching the disruption outcome.
- `src/Core/Actions/sustain-spell.js` — `performSustainSpell({ caster,
  activeSpellId, encounter })`: 1 action, `concentrate` trait, extends the
  active spell's expiry to `max(expiry, currentRound) + 1`. Refuses with
  `not-sustained`, `invalid-active-spell`, `no-actions`, `unconscious`, or
  `defeated` without mutating state. Returns `actionCost`, `traits`,
  `previousExpiresAtRound`, `expiresAtRound`, `actionsLeft`, and the updated
  `sustainedSpell`.
- Tests: `tests/Actions/advanced-spells.test.js` (14 cases: 15-ft cone +
  wall occlusion, 30-ft line + wall stop, diagonal 5-10-5 line, 10-ft-wide
  lane, 2x2 Large 10-ft emanation, slot spend, empty-slot refusal, cantrip,
  focus spend, empty focus pool, sustained registration/sustain/expiry,
  unsustained expiry, and sustain refusal paths). Registered in
  `tests/run-node.js`. Full Node suite: **450 passed, 0 failed, 32 suites**.
- Deliberately deferred: View/HTML integration (not modified), counteract
  checks, spell heightening/scaling, spontaneous/prepared casting variants,
  focus-point daily refocus, line-of-effect for emanations, cone templates
  placed at grid vertices rather than cell centres, and multi-target
  sustained-spell tracking beyond the first target recorded on the entry.

## Previous milestone — Phase 15 (complete): Tactical AI Engine

Status: **implemented and verified**.

- `src/Core/AI/tactical-ai.js` — headless, deterministic AI controller with no
  DOM/Canvas dependency and no encounter-clock ownership.
  - `planTurn({ combatant, map, combatants, encounter })` returns
    `{ ok, combatantId, plan, actionsRemaining, actionsSpent, reason? }` without
    mutating any combatant. The plan is an ordered list of serialisable steps
    (`stand`, `stride`, `step`, `strike`, `raise-shield`, `take-cover`) with
    `actionCost`, destination, target id/name, and the planning reason.
  - `executeAITurn({ combatant, map, combatants, encounter, rollD20,
    rollDamageDie })` drives the live action pool one action at a time and
    returns `{ ok, combatantId, executedActions, actionsSpent,
    actionsRemaining, finalState, reason? }`. Every executed entry carries
    `type`, `actionCost`, `ok`, `reason`, a summary (`targetId`, `mapPenalty`,
    hit/critical, damage, HP before/after, destination, reactions), and the raw
    core-action `result`.
  - `finalState` exposes `{ id, name, position, currentHP, maxHP,
    actionsRemaining, reactionsRemaining, attacksThisTurn, isDefeated, prone,
    shieldRaised, conditions }`.
  - The execution loop re-snapshots the combatant after every action, so a
    target that dies mid-rotation is dropped immediately and the remaining
    action pool is spent on the next living hostile.
- Decision tree (PF2e Remastered):
  1. **Recovery** — `dying`, `unconscious`, `paralyzed`, `stunned`, or
     `isDefeated` ends the turn with no actions. A prone creature that can act
     uses `Stand` (1 action) first; an immobilized prone creature skips Stand
     and may still attack.
  2. **Target acquisition** — only living combatants whose `alliance` differs
     from the actor. Ranking uses the A* approach cost to the cheapest square
     from which the actor can Strike the target; ties go to the lowest current
     HP, then a stable id order. `selectTarget()` exposes the same query.
  3. **Positioning** — if the target is already inside melee reach no movement
     action is spent. When an ally already engages the target and the opposite
     square is free and adjacent, the AI takes a single `Step` to complete the
     flank (Off-Guard). Out of reach it uses `Pathfinding.findPath` to the
     cheapest attack cell (footprint-aware, ally/enemy occupancy aware). Routes
     longer than Speed are split into one-Stride waypoints. A square threatened
     by an enemy reaction prefers a reaction-free `Step` when a safe advancing
     square exists, otherwise it Strides.
  4. **Rotation** — Strike at MAP 0, Strike at MAP -5, then `Raise a Shield`
     when the authored shield is unbroken/undestroyed and not already raised.
     Without a usable shield the last action is `Take Cover` when standard
     cover exists, otherwise a third Strike. A broken/destroyed shield is never
     raised. Dead targets are never struck again.
  - Shield state is read through `Entities/shield.js`; `getShieldStatus()` is
    exported and reports `{ held, usable, shield }`.
  - Flanking uses the canonical `Grid/flanking.js` whole-footprint
    opposite-side geometry, so Large/Huge/Gargantuan targets are handled from
    their entire footprint rather than only the anchor cell.
- Tests: `tests/AI/tactical-ai.test.js` (9 cases: Stand priority, Aggro +
  Stride + Strike, Strike → Strike → Raise a Shield with MAP 0/-5 and
  `shield-raised`, target switching after a kill, action-pool exhaustion at 0,
  the flanking Step, unconscious no-op, and the lowest-HP tie-breaker). Full
  Node suite: **436 passed, 0 failed, 31 suites**.
- Deliberately deferred: View/HTML integration (not modified), ranged kiting,
  spell/consumable selection, reload handling, class-feat reactions, "recall
  knowledge"/Intimidation-style support actions, difficult-terrain path
  preference beyond normal cost, and any encounter-clock advancement (the
  host/Encounter still owns initiative).

## Previous milestone — Phase 14 (complete): Hands, Inventory/Interact & Shield Block

Status: **implemented and verified**.

- Hands model (`src/Core/Entities/equipment.js`):
  - every `Combatant` owns `hands: { mainHand: null, offHand: null }`,
    defaulting to two free hands;
  - `getFreeHandsCount()` returns 0/1/2; `getHands()`, `getHeldItems()`,
    `isItemHeld()`, `findInventoryItem()`, `addInventoryItem()`,
    `removeInventoryItem()`, and `getInventory()` expose the equipment store;
  - `equipItem()` / `unequipItem()` / `canEquipItem()` validate slot occupancy;
    a 2H item fills both slots with the same item reference and appears once in
    `getHeldItems()`;
  - `getItemHands()` accepts explicit `hands: 1|2`, `handsRequired`,
    `twoHanded`, `handUse`, and the `two-hand-dN` trait. Per this slice's rule,
    `two-hand-dN` occupies both hands.
- Inventory:
  - `Combatant({ inventory: [...] })` normalizes plain item objects; shields are
    normalized through `Entities/shield.js`;
  - `Combatant({ shield })` adds and wields the shield in `offHand` by default;
  - `Combatant({ hands: { mainHand, offHand } })` resolves item ids/objects and
    enforces 2H exclusivity.
- Maneuver hand requirement:
  - `Trip`, `Shove`, and `Grapple` return
    `{ ok: false, reason: "no-free-hand" }` before spending an action, applying
    MAP, or rolling when no hand is free and the wielded weapon lacks the
    matching `trip` / `shove` / `grapple` trait;
  - `Equipment.checkManeuverHands()` is the single shared gate; successful
    evaluations expose `handRequirement: { freeHands, viaTrait }`.
- `Actions/interact.js` — `performInteract({ combatant, actionType, item, slot })`:
  - `draw` (1 action), `stow` (1 action), `swap` (1 action), and `drop`
    (0 actions / free);
  - draw/stow/swap carry the `manipulate` trait and run the shared Reactive
    Strike window when a combatant roster is supplied; a disrupting reaction
    spends the action and aborts the equipment change;
  - returns `{ ok, actionType, actionCost, actionsLeft, item, hands,
    previousItems, manipulate, traits, freeHands }`; drop is deliberately not
    manipulate.
- `Entities/shield.js`:
  - record `{ id, name, type: "shield", hands: 1, hardness: 5, hp: 20,
    maxHP: 20, brokenThreshold: 10, acBonus: 2, speedPenalty: 0, broken,
    destroyed }`;
  - `brokenThreshold` defaults to `floor(maxHP / 2)`; `broken` is
    `hp > 0 && hp <= brokenThreshold`; `destroyed` is `hp <= 0`;
  - broken/destroyed shields contribute no AC (`getACBonus()` returns 0) and
    cannot be raised or used for Shield Block;
  - `applyShieldDamage()` updates HP and flags, and reports `justBroken` /
    `justDestroyed`.
- `Actions/shield-block.js`:
  - trigger requires a non-broken shield, active `shield-raised`, at least one
    unspent reaction, and physical damage (bludgeoning/piercing/slashing);
  - Hardness reduces the post-IWR damage; the remainder damages the shield
    (capped at current shield HP) and the wielder simultaneously;
  - one reaction is spent; reaching the Broken Threshold removes
    `shield-raised` immediately;
  - returns `{ ok, absorbedByHardness, damageToShield, damageToActor,
    shieldBroken, shieldDestroyed, shieldRaisedRemoved, reactionSpent,
    reactionsLeft, shieldState, currentHP, ... }`.
- Damage-chain integration:
  - `Combatant.takeDamage(amount, { type })` applies IWR first, then resolves
    Shield Block automatically when the defender has a raised, unbroken shield,
    an unspent reaction, and physical damage. `{ shieldBlock: false }` opts out;
    `{ shieldBlock: true }` also returns a structured failure report when the
    trigger is illegal;
  - the result adds `actorDamageApplied` (post-shield damage) and `shieldBlock`
    (the full report, including ineligible reasons);
  - `Combatant.canShieldBlock(options)` exposes validation for callers that want
    to prompt the player before spending the reaction.
- Raise a Shield now refuses a broken/destroyed authored shield with
  `shield-broken` / `shield-destroyed` without spending an action. Combatants
  with no authored shield retain the legacy condition-only fixture behavior.
  A raised shield's AC modifier uses the shield's authored `acBonus` (default 2)
  and is suppressed if a stale `shield-raised` record exists on a broken shield.
- Tests: `tests/Entities/equipment-shields.test.js` (14 cases covering 2H hand
  occupancy, the `two-hand-dN` trait, shield draw rejection, no-free-hand
  Grapple, the `grapple` trait bypass, Interact draw/swap/drop/stow, 2H draw,
  the 12-damage / Hardness 5 split, `takeDamage` integration, non-physical
  rejection, Broken Threshold removal, destroyed shields, and stale raised
  records). Full Node suite: **428 passed, 0 failed, 30 suites**.
- Deliberately deferred: View/HTML integration (not modified in this slice),
  Bulk/encumbrance, container nesting, armour, ammunition counts, two-hand grip
  damage bonuses for `two-hand-dN`, shield bash/integrated weapons, shield
  runes/materials/specific shields, mixed physical+non-physical Shield Block
  splitting, a player-facing prompt/confirmation for Shield Block, and
  re-pointing the active Strike profile when Interact draws a different weapon.

## Previous milestone — Phase 13 (complete): Advanced Conditions & Durations

Status: **implemented and verified**.

- `Conditions` now registers three additional states:
  - `paralyzed` — contributes Off-Guard (`-2 circumstance` AC with source
    `off-guard`, name `Off-Guard (Paralyzed)`). `Combatant.canAct()` returns
    `{ ok: false, reason: "paralyzed" }`, so every caller that gates actions
    through `canAct()` refuses them. Purely mental actions are not modelled.
  - `stunned N` — `canAct()` returns `{ ok: false, reason: "stunned" }` while
    the condition is present. At the start of the creature's turn it loses up
    to N actions from the refreshed pool. The value is paid down by the
    actions actually lost; when the pool is smaller than N the remaining debt
    carries into the next turn, and the condition is removed once the value
    reaches 0. Condition duration metadata survives partial pay-down.
  - `slowed N` — at the start of the turn the creature regains N fewer
    actions. It does not block `canAct()` and does not stack with Stunned.
  - When Stunned and Slowed are both present, only the larger value removes
    actions (`max(stunned, slowed)`), so Stunned overrides Slowed for the
    same action loss. Slowed remains until its own duration/removal.
- Round-duration engine:
  - `Conditions.createCondition(name, value, { duration, durationOrigin,
    round })` stores `duration`, `durationOrigin` (`"start"` | `"end"`) and
    `appliedRound` on the record; `copyCondition` preserves them.
  - `Combatant.addCondition()` stamps `appliedRound` from its synced
    `encounterRound` when the caller omits `round`; re-application refreshes
    the timer when a duration is supplied.
  - `Combatant.tickDurations({ phase, round })` removes expired records.
    Semantics: a `start` duration N applied in round R expires at the start
    phase of round R + N; an `end` duration N expires at the end phase of
    round R + N - 1 (so a 1-round end effect ends in its application round).
  - `resetTurn()` runs the start-phase tick before the Stunned/Slowed action
    loss; `endTurn()` runs the end-phase tick. `Encounter` synchronises every
    `combatant.encounterRound` with `encounter.round` and passes `round` into
    both calls. `nextTurn()` exposes `durationExpiry`.
- Afflictions (`src/Core/Rules/afflictions.js`):
  - Record contract: `{ type: "affliction", id, name, saveType, saveDC,
    maxStage, stage, sourceId }`; `stage` starts at 1. `createAffliction`,
    `copyAffliction`, and `applyStageChange` validate/normalise the record.
  - End-of-turn save uses `Checks.evaluateCheck` with the creature's save
    modifier (including condition modifiers such as Frightened) against
    `saveDC`: critical success `-2`, success `-1`, failure `+1`, critical
    failure `+2`. Stage is clamped to `[0, maxStage]`; reaching 0 cures the
    affliction and removes it.
  - `Combatant` owns `afflictions` with `addAffliction`, `removeAffliction`,
    `hasAffliction`, `getAffliction`, `getAfflictions`, and constructor
    authoring. `endTurn()` runs every save and returns `afflictionTick`,
    `afflictionsChanged`, and `curedAfflictions`. Deterministic callers can
    inject `afflictionD20` or `rollAfflictionSave`; otherwise `rollD20`,
    `rollDie(20)`, then `Math.random` are used.
  - Deliberately no concrete poisons/diseases are authored in this slice.
- Tests: `tests/Entities/afflictions-durations.test.js` (15 cases covering
  Paralyzed/Off-Guard/`canAct`, Slowed 1, Stunned 1 removal, Stunned-over-
  Slowed, Stunned debt carry-over, start/end duration expiry, the Encounter
  round clock, duration round-trip, Failure/Success stage changes, cure,
  critical-failure cap, save modifiers, and validation). Full Node suite:
  **414 passed, 0 failed, 29 suites**.
- Deliberately deferred: concrete poison/disease stat blocks, affliction
  onset and maximum duration, virulent/incapacitation traits, stage-specific
  damage or conditions, multiple simultaneous exposures beyond metadata
  refresh, mental-only actions under Paralyzed, Slowed's reaction restriction,
  and View/HTML integration.

## Previous milestone — Phase 12 (partial): Spellcasting Foundation & AoE Burst

Status: **implemented and verified**.

- `Combatant` spellcasting profile — `spellAttackBonus` (default 0),
  `spellDC` (default `10 + spellAttackBonus`), and `spells` (authored array).
  A friendly `hp` alias for authored `maxHP` is also accepted.
- `Rules/spells.js` — `evaluateBasicSave({ saveRoll, saveDC, rawDamage,
  isNatural20, isNatural1 })` resolves the save through
  `Checks.evaluateCheck` and applies the Basic Saving Throw table: critical
  success 0, success `floor(damage / 2)`, failure full, critical failure
  `damage * 2`. `saveRoll` may be a final total, or a raw d20 when
  `saveModifier` is supplied (then natural 20/1 adjust automatically).
  `hasTrait` normalizes string and object spell traits.
- `Grid/aoe.js` — `getBurstCells(centerOrigin, radiusFeet, gridMap)` measures
  centre-to-centre with the PF2e 5-10-5 distance and excludes blocked cells;
  `getTargetsInArea(cells, combatants)` intersects living footprints, including
  Large/Huge `getOccupiedCells()`.
- `Actions/cast-spell.js` — `performCastSpell({ caster, spell, target, origin,
  combatants, map, rollD20, rollDamageDie })`. Validates un/consciousness,
  actions, and spell type before spending anything. Attack spells use and
  advance MAP, require the Concealed/Hidden flat check, roll
  `d20 + spellAttackBonus` vs AC, double damage on a critical success, then run
  the target's IWR. Save spells never touch MAP; one damage roll feeds an
  independent save per target (single target or every living target in a
  burst), with IWR applied after the basic-save multiplier. A `manipulate`
  spell resolves threatened Reactive Strikes first; a critical or lethal
  reaction sets `{ ok: false, disrupted: true }` and spends the action cost.
- Tests: `tests/Actions/cast-spell.test.js` (4 cases: attack MAP/IWR weakness,
  basic-save half damage, multi-target burst, and burst geometry/walls).
  Full Node suite: **399 passed, 0 failed, 28 suites**.
- Deliberately deferred: Cone/Line/Emanation templates, spell slots/heights,
  counteract checks, non-basic save spell text, spell scaling, line-of-sight
  for spell targeting, and View/HTML integration. Only Burst is implemented.

## Previous milestone — Phase 11 (complete): Ranged Combat & Thrown Weapons

Status: **implemented and verified**.

- Weapon profile — `WeaponTraits.getWeaponProfile(weapon)` parses
  `weapon.range` / `weapon.rangeIncrement`, `weapon.reload`, `weapon.volley`,
  and the `ranged-N`, `thrown-N`, `volley-N`, `reload-N` traits. Melee weapons
  have `rangeIncrement: null`, `reload: 0`, `volley: null`. `isRanged()` is true
  for a range increment or the ranged/thrown/volley traits. `Combatant` exposes
  `weapon`, `getRangeIncrement()`, `getReload()`, `getVolley()`,
  `requiresReload()`, `isRangedWeapon()`, and `isLoaded` (default true).
- Range penalties — the first increment is 0; each additional full/partial
  increment is `-2 untyped` through the central modifier resolver. Six
  increments are allowed (`0..-10`); beyond `rangeIncrement * 6` the result is
  `{ ok: false, reason: "out-of-range" }`. Volley adds `-2 untyped` ("Volley
  Penalty") when the target is at or inside the listed volley range.
- Reload — a ranged Strike with `reload > 0` sets `combatant.isLoaded = false`;
  an empty weapon returns `{ ok: false, reason: "not-loaded" }` before spending
  an action. `Actions/reload.js` exports
  `performReload({ combatant })`, which spends `weapon.reload` actions (1/2),
  sets `isLoaded = true`, and returns `{ ok: true, actionsLeft }`. Reload-0
  weapons (bows, thrown) never discharge.
- Reactive Strike disruption — before a ranged attack roll, every living
  hostile with an available reaction that threatens the shooter's square makes
  a Reactive Strike. A critical or lethal reaction sets `disrupted: true` on
  the Strike result: the Strike action is spent, no attack roll occurs, no
  ammunition is consumed, and the target is untouched.
- Map and alliance notes — `evaluateStrike` accepts an omitted `GridMap` for
  isolated headless math (LoS/cover are skipped); a supplied map must be a real
  `GridMap`. An un-authored alliance no longer makes two isolated fixtures
  allies. `Combatant` also defaults a missing name to its id and a missing
  speed to 25 ft.
- Tests: `tests/Actions/ranged-strike.test.js` (13 cases covering profile
  parsing, increment boundaries, six-increment cap, volley, reload 0/1/2,
  not-loaded priority, and reaction disruption).
- Deliberately deferred: ammunition quantities/consumption, weapon drawing and
  handedness, thrown-weapon recovery, and range-increment cover corners for
  non-medium shooters. View/HTML was not modified in this slice.

## Previous milestone — Phase 10 (complete): Dying, Wounded, Unconscious & Healing

Status: **implemented and verified**.

- `unconscious` condition — embeds Off-Guard (`-2 circumstance` AC) and Prone
  (`-2 circumstance` attack), plus a `-4 status` penalty to AC, Reflex saves,
  and Reflex DC. `Combatant.canAct()` returns `{ ok: false, reason:
  "unconscious" }` while it is present.
- `dying N` / `wounded N` — valued conditions. `takeDamage()` now floors HP at
  0, applies `unconscious` + `prone`, and starts Dying at `1 + Wounded`
  (`2 + Wounded` on a critical hit, via `isCrit`). Further damage while dying
  advances the track by 1 (2 on a crit). Dying is capped at 4; reaching 4 sets
  `isDefeated = true`.
- `Combatant.applyHealing(amount)` — heals up to max HP, removes Dying, adds
  Wounded 1 (or increments it), removes Unconscious, and refuses to heal a
  creature that died at Dying 4 (`{ ok: false, reason: "dead" }`).
- `Combatant.resolveRecoveryCheck()` runs at the start of `resetTurn()` for a
  dying creature: flat check against DC `10 + Dying`, with critical success
  `-2`, success `-1`, failure `+1`, critical failure `+2` (natural 20/1
  adjusted through `Checks.evaluateCheck`). Reaching 0 removes Dying and
  leaves the creature stable at 0 HP and unconscious; reaching 4 kills it.
  The result is exposed as `lastRecoveryCheck`.
- Tests: `tests/Entities/dying.test.js` (18 cases covering the dying track,
  wounded stacking, critical hits, healing, death, `canAct`, unconscious
  modifiers, and all four recovery degrees).
- Known limitation: 0 HP still sets the legacy `isDefeated` flag for backwards
  compatibility with Strike/Encounter/grapple cleanup; a stable creature at
  0 HP therefore remains out of the turn cycle until healed above 0.
- Earlier milestones (9.x, 8.x, 7.x, 6.x, 5.x, 3.2, 4.x) remain implemented.

## Previous milestone — Phase 9.1 / 9.2 (complete): Large creatures, occupancy & reach

Status: **implemented and verified**.

- 9.1 — `Combatant.size` (`medium` default) with `getFootprint()` (1/2/3 for
  medium/large/huge) and `getOccupiedCells()` anchored at the top-left cell.
  `Grid.getCombatantDistance(attacker, target)` measures the closest pair of
  occupied cells using the canonical 5-10-5 distance. Strike, Reactive Strike,
  flank reach, and the shared Athletics maneuver pipeline (Trip/Shove/Grapple)
  use this edge-to-edge measurement.
- 9.2 — `Occupancy.buildOccupancy` expands every combatant to all occupied
  cells. `Occupancy.canOccupySpace(x, y, combatant, gridMap, allCombatants)`
  validates the full footprint. `Pathfinding.findPath` /
  `reachableCells` accept a `footprint` option; Stride and Step forward the
  mover's footprint so a 2x2/3x3 creature cannot cross walls or enemies with
  only its anchor cell.
- Tests: `tests/Entities/combatant-size.test.js` (4-cell Large footprint,
  edge-to-edge reach, occupancy rejection, footprint pathfinding, Large Strike).
- Flanking direction is derived from whole-footprint centres and opposite
  footprint sides/corners (Phase 25.1), so 2x2/3x3/4x4 targets no longer use the
  anchor-cell shortcut.
- Earlier milestones (8.3, 7.x, 6.x, 5.x, 3.2, 4.x) remain implemented.

## Previous milestone — Phase 8.3 (complete): Saves, Skills, Trip, Shove, Grapple, Escape

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
  - Free-hand and target-size requirements are enforced by the shared maneuver
    gate (Phase 25.1).
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
48. **Maneuvers enforce a free hand and target size.** Trip, Shove, and Grapple
    need one free hand unless the wielded weapon carries the matching trait, and
    the target may be at most one size category larger (tiny 0, small/medium 1,
    large 2, huge 3, gargantuan 4). Violations return `no-free-hand` or
    `target-too-large` before spending anything.
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
59. **Multiple grapplers are tracked per source.** Grabbed/Restrained/
    Immobilized keep one source-linked instance each. The canonical Map entry
    remains the earliest source (for legacy accessors and modifiers), while
    `getGrappleInstances()` exposes every simultaneous hold. Escape removes only
    the selected source; the victim stays grabbed until all instances are gone.

## Verification

- `npm test` / `node tests/run-node.js`: **488 passed, 0 failed** across 35
  suites (Phase 19 included).
- `test_runner.html`: the browser runner still loads its earlier subset; it was
  not extended or re-run in this slice because View/HTML was intentionally left
  untouched. The new `Encounter/initiative.js` and `State/` modules are loaded
  by the Node entry point only; `Encounter` contains a fallback comparator and
  roller so the existing browser entry points keep working.
- Earlier browser smoke tests through DOM state (Phases 5–12) remain valid and
  are unchanged by this headless slice.
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

- Concrete poison/disease stat blocks, affliction onset and maximum duration,
  virulent/incapacitation traits, stage-specific damage/conditions, and
  multiple simultaneous exposures (re-adding the same affliction id refreshes
  its profile and keeps the higher stage rather than incrementing it).
- Paralyzed has no mental-only action channel, so every engine action is
  refused. Slowed does not restrict reactions in this slice.
- Dying, Wounded, Unconscious, and recovery checks.
- Persistent damage from afflictions/stages and death caused by a persistent
  tick; precision damage as a separate IWR instance; damage-type conversion and
  splash damage.
- Crawl.
- Remastered's full Grapple critical-failure choice (the victim reverses the grab
  or knocks the attacker prone); the prototype uses attacker prone + release.
- Shove's optional move with the target is deferred.
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
- Initiative can be rolled or authored; surprise rounds and GM adjudication of
  ambiguous ties are not modelled beyond the deterministic tie-break chain.
- LoS ignores creatures; creatures provide lesser cover instead of blocking
  sight.
- Terrain is data-only; difficult and greater-difficult movement costs are
  modelled, but other terrain effects are not.
- Tokens move instantly; no path animation.
- One token selected at a time; no drag-and-drop.
- Other weapon traits and deadly-die scaling from striking runes.

## Next logical slice

**Phase 20 (suggested) — View/HTML Integration for Phase 19**:

1. Load `Core/Encounter/initiative.js` and the `Core/State/` scripts in the
   browser entry points, then replace authored initiative with
   `Encounter.rollInitiative()` and an initiative-roll log line.
2. Subscribe the combat log and token layer to `CombatEventBus` instead of
   polling combat state (`combatant:damaged`, `combatant:moved`,
   `condition:*`, `hazard:*`, `turn:*`, `reaction:*`).
3. Add Save/Load buttons wired to `serializeCombatState` /
   `deserializeCombatState`, plus a JSON download/upload path for deterministic
   session resume.

After that: surprise rounds, full hazard roster ownership on `Encounter`, and
event-driven animation/undo hooks.

Earlier deferred slice (still open): Affliction content and onset — author a
small poison/disease catalog, add onset delays and maximum duration, and wire
stage-specific damage/conditions through the existing pipelines.
