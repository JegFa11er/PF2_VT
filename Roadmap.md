# UI & Compendium Roadmap (Post-Core)

> Status: Core engine (Phases 1-20) is 100% complete and verified.

## Phase 21: Token HUD & Canvas Interactivity
* **Session 21.1: Token HUD (Right-Click Menu)**
  - Floating Token HUD appearing on right-click over a token.
  - Interactive HP bar: direct input (e.g., `15`), relative input (`+10`, `-5`) with `maxHP` clamping and `takeDamage`/`applyHealing` core integration.
  - Token settings button (gear icon).
* **Session 21.2: Condition Palette (Effects Grid)**
  - A grid/list of toggleable condition icons within the HUD.
  - Tooltips explaining each condition on hover.
  - Clicking a condition toggles it via `addCondition`/`removeCondition`.

## Phase 22: The Foundry Sidebar & Floating Sheets
* **Session 22.1: Sidebar Architecture**
  - Collapsible right sidebar with tabs: Chat (Combat Log), Combat Tracker (Initiative), Actors, Compendium.
  - Moving existing combat log and initiative tracker into their respective tabs.
* **Session 22.2: Floating Character Sheets**
  - Double-clicking a token opens a draggable floating sheet.
  - Tabs: Actions (Strikes, Maneuvers), Inventory (Hands, Shield Block), Spells, Effects.

## Phase 23: Data Ingestion & Compendium Browser
* **Session 23.1: Reference Data Parser**
  - Node script to parse `pf2e-reference/packs/` (spells, weapons) into lightweight JSON catalogs.
* **Session 23.2: Compendium Browser UI**
  - Searchable, filterable modal for spells and items.
  - Drag-and-drop or "Add to Actor" buttons to equip items or learn spells.