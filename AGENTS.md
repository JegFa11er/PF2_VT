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

## Hybrid Development Protocol: DeepSeek (Worker) + Gemini Pro (Architect)

The local execution agent operates strictly as the **Hands / Implementer**, while Gemini Pro (via `gemini "<prompt>"`) acts as the **Head / Rules Architect**. 
Invoking Gemini is completely free and saves tokens/context. DeepSeek MUST delegate rules design, test matrices, and edge-case resolution to Gemini before writing non-boilerplate code.

### 1. Mandatory Pre-Implementation Query (Zero-Token-Waste Rule)
Before writing or modifying any Core logic (`src/Core/`), the local agent **MUST** make at least one call to Gemini to fetch the exact algorithmic spec and test cases:
```bash
gemini "[Context: Pathfinder 2E Remastered] Plan implementation for <Feature Name>. Requirements: <brief bullets>. Provide exact function signatures, PF2e Remastered math/logic, and 3-5 critical TDD Given-When-Then test cases."
```
- **Why:** Prevents blind rule extrapolation and legacy 5e/3.5e assumptions before code is touched.
- **Rule:** Do not invent formulas or degree-of-success logic autonomously. Implement the architecture provided by Gemini.

### 2. Mandatory Rules Verification Query
Whenever an implementation touches:
- Interaction of conditions/modifiers (e.g. Off-Guard, Frightened, Prone).
- Geometric checks (Cover rays, Flanking angles, LoS, Reach).
- Reactive triggers or Action Economy edge cases.
The agent MUST query Gemini for rule confirmation if there is even 1% doubt:
```bash
gemini "[Context: Pathfinder 2E Remastered] Rule check: How does <Action/Condition> interact with <Rule/Target> in Remastered? Provide the exact rule resolution and edge cases."
```

### 3. Circuit Breaker (Escalation Guardrail)
1. **First Failure:** If a test or build fails, inspect the error and make **ONE** autonomous fix attempt.
2. **Second Failure:** If the error persists, **STOP immediately**. Do NOT try a third time.
3. **Escalate to Gemini:** Execute:
```bash
gemini "[Context: Pathfinder 2E Remastered] Build/test failure: <last 5-10 lines of error>. File: <path>. Provide ONLY the minimal, exact corrected code snippet."
```
4. Apply the provided fix directly and rerun verification.

### 4. Local Agent Responsibilities (Fast Execution Only)
- Applying Gemini's architecture to the codebase.
- Creating and wiring files, running `npm test` or browser test suites.
- DOM / Canvas layout, rendering, CSS, and UI event binding.
- Updating `docs/HANDOFF.md` and roadmap status.

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
  - Distance & Grid: `../pf2e-reference/src/module/canvas/ruler.ts`
  - Check rolls & Degrees of Success: `../pf2e-reference/src/module/system/rolls.ts` or `src/module/check/`
  - Modifier stacking math: `../pf2e-reference/src/module/rules/rule-element/`
  - Conditions data: `../pf2e-reference/src/module/system/conditions/`