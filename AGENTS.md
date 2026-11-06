# Shared Agent Rules - Pathfinder 2E Tactical Battlefield

This is the canonical guidance for agents developing the headless tactical battle system and interactive grid based on the Pathfinder 2E Remastered ruleset. 

The primary architectural mandate is the strict decoupling of the core rules engine from visual presentation. The rules engine must run as pure, self-contained business logic without dependencies on game engine display nodes or rendering components, enabling direct portability into future narrative-driven projects.

---

## Technical Context & Architectural Index

1. **Headless Engine First**: The core combat model (`Core/`) handles state, dice rolls, geometry math, rules validation, and event dispatches. The display layer (`View/`) only listens to combat events and handles input/rendering.
2. **Deterministic Rules**: All combat calculations must be deterministic when fed seeded dice rolls.
3. **Module Index**: Consult relevant design documentation before implementing slices:

| Area | Documentation Path | Contents |
|---|---|---|
| Grid & Geometry | `docs/modules/grid_and_geometry.md` | 5-ft square grid, PF2e diagonal costs (5-10-5 ft), reach, line-of-sight. |
| Turn & Economy | `docs/modules/turn_and_actions.md` | Initiative order, 3-action economy, reactions, round reset. |
| Checks & DCs | `docs/modules/checks_and_dcs.md` | d20 rolls, 4 degrees of success (+/- 10 threshold, natural 1/20 adjustment). |
| Modifiers & Conditions | `docs/modules/modifiers_and_conditions.md` | Status, Circumstance, Item modifiers (non-stacking logic), core conditions. |
| Battlefield View | `docs/modules/battlefield_view.md` | Grid rendering, token input, action highlights, combat log events. |

---

## Feature Readiness Gate

Do not write code until the slice requirements and mechanics meet at least 95% confidence. Do not extrapolate rules or borrow legacy 3.5e/D&D 5e/Pf2eLegacy mechanics.

Before any non-trivial implementation, record the readiness block:

```text
Feature Readiness:
- goal: <observable combat outcome>
- pf2e_remaster_rule: <exact rule, formula, DC, or degree of success definition>
- behavior_and_boundaries: <what is implemented now vs strictly excluded>
- data_contracts: <affected entities, models, events, or state changes>
- acceptance_tests: <discrete pass/fail test cases with exact inputs and outputs>
- delegated_assumptions: <none or explicitly approved simplifications>
- confidence: <0-100%>
```

If confidence is below 95%, pause and ask targeted clarifying questions about rules or architecture before coding.

---

## Authored Data & Modifiers Synchronization

1. **Strict Typing**: Use strict enumerations and strongly-typed models for all actions, conditions, bonus types, and outcomes:
   - `ActionType`: `SingleAction`, `TwoActions`, `ThreeActions`, `Reaction`, `FreeAction`.
   - `DegreeOfSuccess`: `CriticalFailure`, `Failure`, `Success`, `CriticalSuccess`.
   - `ModifierType`: `Circumstance`, `Status`, `Item`, `Untyped`.
2. **Modifier Pipeline**: Implement calculations through a centralized modifier resolver:
   $$\text{Total} = \text{Base} + \max(\text{Circumstance}^+) - \max(\text{Circumstance}^-) + \max(\text{Status}^+) - \max(\text{Status}^-) + \dots$$
   Bonuses of the same type do not stack; take the highest. Penalties of the same type do not stack; take the worst (unless untyped).
3. **Stable Identifiers**: Tokens, actions, and active conditions must possess immutable string or numeric IDs for event logging and serialization.

---

## Session Lifecycle & Context Management

1. **One Scope Per Session**: Each session must cover only one discrete slice of mechanics (e.g., "Only Strike action with MAP", not "All combat actions").
2. **Context Handoff**: When a milestone is reached or when session context grows large, update `docs/HANDOFF.md` before concluding:
   - Implemented models and passing test suites.
   - Known current limitations and deliberately deferred edge cases.
   - Exact next logical slice to pick up.
3. **Verification**: Verify implementation using automated test suites. If automated runners are unavailable, verify state directly through the command line or manual headless runners. Review changed files via local file checks before closing the task.

---

## Hybrid Development Protocol: Adaptive Models + Gemini Architect Escalation

The local agent operates autonomously to implement assigned slices, write Core logic, and run tests. Model tiering is assigned per session prompt. Gemini Pro acts as the external Senior Rules Architect and Escalation Gatekeeper via the local bridge script (`gemini "<query>"`).

### 1. Model Tiering Strategy
- **DeepSeek V4.1 Flash** (Primary Workhorse): Standard feature implementations, routine Core actions, large context ingestion, and test authoring. Used when token budget preservation and high context throughput are prioritized.
- **DeepSeek V4 Pro**: Intricate mechanical interactions, modifier stacking edge-cases, complex duration/affliction trees, and tricky save pipelines.
- **GPT-6 Luna**: High-complexity geometry (AoE cones/lines, multi-cell raycasting) and tactical AI decision trees.
- *Rule:* The operator prompt specifies which active model to use for the current session.

### 2. Autonomous Implementation Workflow
1. **Execute from Prompt & Reference**: Implement the feature directly using the session prompt and targeted files in `../pf2e-reference/src/module/`. The agent does not need pre-approval for standard logic or boilerplate.
2. **Write & Run TDD Suites**: Author accompanying tests in `tests/` and run `npm test`.
3. **Bridge Query (Complex Rules Only)**: If an intricate PF2e Remastered rule interaction is ambiguous or absent in `../pf2e-reference`, the agent MAY query Gemini via CLI:
   ```bash
   gemini "[Context: Pathfinder 2E Remastered] Rule check: How does <Action/Condition> interact with <Rule/Target>? Provide exact resolution."
   ```

### 3. Circuit Breaker (Escalation Guardrail)
To prevent infinite retry loops and quota depletion:
1. **Attempt 1 (Autonomous Fix):** If `npm test` fails, inspect the error stack, check logic against `pf2e-reference`, and make one targeted fix.
2. **Attempt 2 (Root Cause):** If tests still fail, attempt a second targeted correction.
3. **Escalation Gate (STOP):** If tests fail a third time, **STOP immediately**. Do NOT attempt further modifications. Escalate to Gemini Pro via:
   ```bash
   gemini "[Context: Pathfinder 2E Remastered] Build/test failure: <last 5-10 lines of error>. File: <path>. Explain the Remastered rule defect and provide the minimal fix."
   ```
4. Apply the returned fix and verify with `npm test`.

### 4. Session Handoff
Before ending the session:
- Ensure `npm test` passes 100% with no broken suites.
- Update `docs/HANDOFF.md` with newly implemented contracts, test counts, and deferred limitations.

---

## Defect Resolution: Fix the Class of Defect

When a mechanical or architectural bug is identified:
1. Do not patch isolated edge cases with localized conditionals (e.g., avoid `if (is_flanked) ac -= 2`).
2. Fix the underlying root system: apply the condition (`Off-Guard`) to the combatant, and let the centralized modifier resolver adjust the Armor Class.
3. Write an isolated regression test replicating the exact PF2e rules interaction before completing the fix.

### Reference: PF2e Remaster Source of Truth
- Local canonical path: `../pf2e-reference` (Read-only reference, do not modify).
- When implementing rules, math, modifiers, or degree-of-success logic, use `../pf2e-reference/src/module/` as the algorithmic source of truth.
- STRICT LIMITATION: Never search globally across `../pf2e-reference` (it contains thousands of files). Read ONLY the targeted module file required for the current task:
  - **Distance, Grid & AoE Templates:** `../pf2e-reference/src/module/canvas/` (e.g., `ruler.ts`, `measured-template.ts`)
  - **Check Rolls & Degrees of Success:** `../pf2e-reference/src/module/system/check/` and `src/module/system/statistic/`
  - **Damage Math & IWR Engine:** `../pf2e-reference/src/module/system/damage/`
  - **Modifier Stacking & Rule Elements:** `../pf2e-reference/src/module/rules/rule-element/`
  - **Conditions (Dying, Prone, Off-Guard, etc.):** `../pf2e-reference/src/module/system/conditions/`
  - **Combat Maneuvers & Base Actions:** `../pf2e-reference/src/module/system/action-macros/`
  - **Weapons, Ranged Combat, Reload & Traits:** `../pf2e-reference/src/module/item/weapon/`
  - **Spells, Casting & Magic System:** `../pf2e-reference/src/module/item/spell/`
  - **Afflictions (Poisons, Diseases, Stages):** `../pf2e-reference/src/module/item/affliction/`
  - **Shields (Hardness, HP, Shield Block):** `../pf2e-reference/src/module/item/shield/`
  - **Actor Base, Creature Sizes & Hands/Inventory:** `../pf2e-reference/src/module/actor/`