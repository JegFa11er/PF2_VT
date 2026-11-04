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

## Hybrid Development Protocol: DeepSeek + Gemini Pro CLI

The local execution agent operates in tandem with Gemini Pro, invoked via the terminal wrapper `gemini "<prompt>"`. This keeps the local session context lean, avoids hallucinations of legacy D&D 5e/pre-Remaster rules, and accelerates development.

### 1. Local Agent Scope (Execute Fast & Direct)
* **File & Project Operations:** Creating directories, boilerplate files, moving assets, verifying dependencies, and running local builds.
* **Minor Code Edits:** Local adjustments, renames, and targeted bug fixes up to 20 lines of code.
* **Test Execution:** Running tests locally (e.g., `dotnet test` or Godot GUT), parsing pass/fail exit codes and stdout.
* **Direct File Reads:** Inspect target files directly with read tools; avoid running unstructured exploratory subagents.

### 2. Delegate to Gemini Pro via `gemini "<prompt>"`
Always prepend system context to your prompt: `[Context: Pathfinder 2E Remastered (ORC-license ruleset), no D&D 5e / legacy rules]`. Delegate the following:
* **Core Rule System Architecture:** Designing core data structures (`Modifier`, `Condition`, `CombatAction`), degree-of-success pipelines, and modifier stacking math before writing files.
* **Rule Ambiguities & Edge Cases:** Verifying geometric rules (flanking across grid vertices, line-of-sight vs cover, 5-10-5 diagonal costs) against Remaster specifications.
* **TDD Scenario Generation:** Requesting dense Given-When-Then test cases with precise math (dice roll, DC, modifier breakdown, expected outcome).
* **Deep Error & Build Analysis:** Diagnosing complex stack traces, compiler errors, or structural test regressions.

### 3. Integration & Consumption Pipeline
When receiving output from the `gemini` CLI:
1. Do not repeat or echo the raw CLI response into the human chat interface.
2. Verify strict syntax and naming alignment with existing project contracts.
3. Apply the solution directly into the target files and run the test suite.

### 4. Circuit Breaker (Error Escalation Guardrail)
1. **First Failure:** If a build, linter, or unit test fails after an edit, make **one** autonomous attempt to correct the issue.
2. **Second Failure:** If the failure persists after the second attempt, **stop editing immediately**. Do NOT attempt a third blind fix.
3. **Escalate to Gemini:** Execute:
   ```bash
   gemini "[Context: Pathfinder 2E Remastered] Build/test failure: <last 5-10 lines of compiler/test error>. Current file: <path>. Provide ONLY the minimal, exact corrected code snippet to resolve this defect."
```
4. **Apply & Verify:** Insert the provided fix, rerun the verification command, and report the outcome to the human.

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