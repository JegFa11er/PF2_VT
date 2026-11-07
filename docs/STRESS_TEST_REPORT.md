# Headless AI Stress-Test — Run Report

- **Date:** 2026-11-08
- **Suite:** `tests/AI/stress-simulation.test.js` (registered in `tests/run-node.js`)
- **Command:** `npm test`
- **Scope:** headless Core only (`Encounter` + `TacticalAI` + `GridMap` + `Combatant`).
  No View layer was touched.

## Resolution — victory conditions and edge-to-edge LOS fixed ✅

The two deferred limitations from the previous report are now closed:

1. **Encounter termination on a one-sided wipe.** `Encounter.isOver` is now true
   when every *living* combatant belongs to one and the same `alliance` (or when
   all combatants are defeated). A decisive AI-vs-AI wipe therefore ends the loop
   at the moment one side is eliminated instead of idling out the 15-round cap.
2. **Footprint-aware line of sight and cover.** `Strike.evaluateStrike` traces
   line of sight edge-to-edge across every pair of occupied cells (instead of the
   anchor/top-left cell only), and `Cover.determineCover` casts rays from the
   four outer corners of each creature's whole footprint. Multi-cell
   (Large/Huge/Gargantuan) creatures can now see and be seen from their nearest
   edge, matching the already-fixed geometric distance and flanking.

Re-running the seeded simulation now shows **25/25 battles reach a decisive,
one-sided victory before the timeout** (see §2).

## 1. What was built

A deterministic, seeded AI-vs-AI stress harness:

1. **Arena generator** — a 15×15 or 20×20 `GridMap` with:
   - 5–15 impassable walls (connectivity is verified by flood-fill so walls never
     split the map into isolated islands);
   - random `difficult` (+5 ft) and `greater-difficult` (+10 ft) clusters;
   - scattered `hazardous` fire cells (1d6);
   - 1–2 traps (concentrated fire-1d6 hazardous patches, so the AI's Stride
     actually triggers them).
2. **Combatant generator** — two teams (`player` vs `enemy`) of 2–4 fighters each,
   sizes Tiny/Small/Medium/Large/Huge, across six equipment profiles: plain melee,
   reach, trip/grapple weapons, shield-bearer, caster (spell slots + focus), and
   ranged (range increment + reload).
3. **Combat loop** — `Encounter.rollInitiative()` → `TacticalAI.executeAITurn()` →
   `Encounter.nextTurn()`, capped at 15 rounds per battle. A timeout is a valid
   outcome, never an error.
4. **Invariant validation after every turn** (see §4).

The suite also carries three focused deterministic tests for the arena generator
and the Restrained/Grabbed condition gates.

## 2. Results

| Metric | Value |
|---|---|
| Battles requested | 25 |
| Battles ran | 25 |
| Battles skipped (unplaceable spawn) | 0 |
| Decisive outcomes (win) | **25** |
| Draws | 0 |
| Timeouts (15-round cap) | **0** |
| Strategic stalls detected | **0** |
| Player / enemy victories | 11 / 14 |
| Average turns per battle | 11.2 |
| Invariant checks performed | 16,044 |
| Anomalies (crashes / invariant violations) | **0** |
| Full suite | **558 passed, 0 failed, 38 suites** |

## 3. Conclusion

The stress test **passes**: across 25 randomized battles and >16k invariant checks
there were **zero crashes, zero invariant violations, and zero deadlocks**. The
HP / action / occupancy / condition / deadlock invariants all held.

Every battle now resolves decisively: the combat loop ends as soon as one
alliance is wiped (`Encounter.isOver` is alliance-aware) and multi-cell creatures
fight with edge-to-edge line of sight, so neither post-wipe idling nor the
previous Huge-vs-Huge anchor-cell standoff is possible.

## 4. Invariant coverage (asserted every turn)

| Invariant | Check | Result |
|---|---|---|
| HP | `0 <= currentHP <= maxHP` for every combatant | held |
| Action | `0 <= actionsRemaining <= maxActions` (3) | held |
| Occupancy | no living footprint overlaps a wall or another living creature | held |
| Condition — Restrained | no successful attack/manipulate action (only Escape exempt) | held |
| Condition — Grabbed | manipulate actions resolve a DC 5 flat check | held (focused test) |
| Deadlock | each turn resolves in ≤ 16 actions; loop always terminates | held |

## 5. Fixed in this slice

- `src/Core/Encounter/encounter.js` — `isOver` now returns true when every living
  combatant shares one `alliance` (or all are defeated).
- `src/Core/Actions/strike.js` — `traceCombatantLineOfSight` tests every pair of
  occupied cells (edge-to-edge) instead of the attacker/target anchor cells.
- `src/Core/Grid/cover.js` — `determineCover` uses the four outer corners of each
  creature's whole footprint (via `Grid.occupiedCellsOf`) for both the attacker
  and the target, and detects overlap by footprint rather than anchor cell.
- Regression tests in `tests/Encounter/encounter.test.js`,
  `tests/Grid/cover.test.js`, and `tests/Actions/step-strike.test.js`.

## 6. Reproducibility

- The simulation is fully seeded (mulberry32). Seed and battle count are
  overridable via `PF2E_STRESS_SEED` / `PF2E_STRESS_BATTLES`.
- Default: `PF2E_STRESS_SEED=0xc0ffee`, `PF2E_STRESS_BATTLES=25`.
