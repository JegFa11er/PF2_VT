# UI Handoff — Phase 25: Compendium Drag & Drop and Inventory Management

Status: **implemented and verified in the browser** (Core untouched; 492/492
tests still pass, 35 suites).

```text
Feature Readiness:
- goal: drag catalog cards out of the Library, drop bestiary entries onto an
  exact battlefield cell, drop spells/weapons/shields onto a friendly token or
  the floating character sheet, and delete inventory items with ✖.
- pf2e_remaster_rule: presentation/data-plumbing only. Spawning still creates a
  real Combatant and rebuilds the Encounter; spells append the normalized spell
  definition to Combatant.spells; items use Combatant.addInventoryItem /
  equipItem / unequipItem / removeInventoryItem. No Core rules module changed.
- behavior_and_boundaries: every compendium card is an HTML5 drag source that
  writes {type:"compendium-item", category, entry} to dataTransfer. The
  recipient select is hidden for the Bestiary only; cards remain draggable for
  all four categories. A monster drop targets the exact cursor cell, validates
  the whole footprint through Occupancy.canOccupySpace, and falls back to the
  nearest free footprint. Spells/items dropped on a cell only apply to a living
  friendly token; monsters cannot be dropped into the character sheet. Item
  drops add a stowed inventory record (they do not auto-equip). Duplicate
  weapon/shield drops are allowed and receive a unique id suffix because Core
  addInventoryItem deduplicates by id. Duplicate spells are blocked by stable
  id or case-insensitive name.
- data_contracts: CompendiumBrowser dragstart/dragend; BattlefieldView
  onDropCompendium(payload, cell, token) plus canvas dragover/drop and
  .drag-over; CharacterSheet onDropCompendium(combatant, payload) and
  onRemoveItem(combatant, item) plus window dragover/drop; main.js
  handleBattlefieldDrop, handleCharacterSheetDrop, addCompendiumItemToInventory,
  removeSheetItem, spawnCompendiumMonster(entry, {position}) and
  findFreeSpawnCell(size, anchor). App exposes dropCompendium,
  spawnCompendiumMonster, and removeSheetItem for debugging.
- acceptance_tests: npm test = 492 passed, 0 failed (35 suites). Browser checks:
  Bestiary hides the recipient row (computed display none); dragging a Skeleton
  Guard card on A1 spawns it exactly at A1 with alliance enemy; dropping the
  same card on occupied D7 spawns at D6 and logs "ближайшая свободная клетка";
  two Longsword drops on Valeros create two inventory records with distinct ids;
  a second Fireball drop is blocked with "Заклинание Fireball уже известно
  персонажу."; dagger dropped on the open sheet adds an Inventory row; ✖ on a
  stowed Longsword removes it, and ✖ on the Main Hand Longsword frees the hand
  before deleting it; console has no errors or warnings.
- delegated_assumptions: inventory drops are intentionally stowed rather than
  auto-equipped; only friendly tokens accept item/spell drops; the canvas drop
  highlight is the whole board, while the exact cell is computed on drop;
  duplicate gear uses a view-assigned "-2"/"-3" id suffix without changing Core
  deduplication semantics.
- confidence: 98%
```

## 1. Compendium drag sources

- Every `.compendium-card` is `draggable="true"` and carries
  `data-compendium-category`.
- `dragstart` writes the same JSON payload to `application/json` and
  `text/plain`: `{ type: "compendium-item", category, entry }`.
- The dragged card receives `.is-dragging` (semi-transparent, accent outline);
  `dragend` clears it.
- The **Получатель** row is hidden with both the `hidden` attribute and a
  `[hidden] { display: none !important; }` rule while the 👾 Bestiary tab is
  active. Weapon, shield, and spell tabs keep the recipient select as a
  click-action alternative.

## 2. Battlefield drop target

- `BattlefieldView` listens for `dragover` (preventDefault + copy effect),
  `dragleave`, and `drop` on the canvas.
- `.drag-over` adds an inset gold ring and glow around the canvas.
- On drop, `cellFromEvent()` maps the pointer through the canvas bounding box to
  the exact grid cell. The host callback receives the cell and the token under
  the pointer.
- Bestiary drops call `spawnCompendiumMonster(entry, { position })`:
  `findFreeSpawnCell(size, anchor)` scores every footprint-valid anchor by
  squared distance to the drop cell and uses `Occupancy.canOccupySpace`, so
  walls and all combatants are respected. If the target is occupied, the
  nearest legal footprint wins.
- Spell/weapon/shield drops apply only to a living player token on that cell.
  Empty cells and enemy tokens produce a warning in the combat log.

## 3. Character sheet drop target

- The floating `.character-sheet` window is a drop zone with the same payload
  parser and `.drag-over` highlight.
- Spells: duplicate check by stable id or case-insensitive name; duplicates log
  *«Заклинание [Название] уже известно персонажу»* and are not appended.
- Weapons/shields: always append an inventory record, including duplicates.
- Monsters: rejected with a log hint to drop them on the battlefield instead.

## 4. Inventory deletion

- Stowed rows, both hand cards, and the shield card expose a red `✖` button.
- The host releases a held item with `unequipItem()` first, then calls
  `removeInventoryItem()`. This covers one-handed and two-handed items, shields,
  and stowed gear.
- `handleSheetMutation()` refreshes the open sheet, token cards, and map; the
  Inventory tab is redrawn immediately.

## 5. Files

- `src/View/UI/compendium-browser.js` — draggable cards, payload serialization,
  `.is-dragging`.
- `src/View/battlefield-view.js` — canvas dragover/drop, exact cell mapping,
  `onDropCompendium`, `.drag-over`.
- `src/View/UI/character-sheet.js` — sheet drop zone, payload parsing, ✖ buttons
  in hands/stowed/shield sections.
- `src/main.js` — drop routing, duplicate spell policy, duplicate gear ids,
  anchored monster spawning, item removal.
- `css/main.css` — recipient `[hidden]`, card drag state, canvas/sheet
  `.drag-over`, danger button, item action row.
- `index.html` — Phase 25 label and cache-busted view scripts.

## 6. Verification

```bash
npm test   # 492 passed, 0 failed (35 suites)
```

Browser run against `http://127.0.0.1:8765/index.html` used real catalog cards
and synthetic HTML5 DragEvent payloads from the rendered DOM:

1. Bestiary tab: recipient row `hidden`, computed `display: none`.
2. Drag Skeleton Guard card onto A1 → new enemy token at exactly A1, log entry
   on A1, initiative/Actors rows updated.
3. Drag the same card onto Valeros's occupied D7 → spawns at D6, log says
   "ближайшая свободная клетка".
4. Drag Longsword twice onto Valeros → two `Longsword` records with distinct ids
   (`longsword`, `...-2`); both appear in the Inventory tab.
5. Drag Fireball twice → one spell; second drop logs
   "Заклинание Fireball уже известно персонажу."
6. Drag Dagger into the open sheet → Inventory row appears immediately; sheet
   shows `.drag-over` during dragover and clears it on drop.
7. Click ✖ on a stowed Longsword → row disappears; click ✖ on Main Hand
   Longsword → `hands.mainHand === null`, inventory shrinks.
8. Console: no errors or warnings.

## 7. Known limitations / deferred

- Dropping gear/spells into the sheet always adds to inventory/spells; it does
  not auto-equip or auto-prepare.
- The canvas highlight covers the whole board; there is no per-cell green/red
  ghost preview while dragging.
- Duplicate gear copies use a suffixed view-side id; they are not linked as
  quantity stacks.
- Inventory deletion is immediate and has no undo confirmation; only the Clear
  Board flow uses the confirmation modal.
- Popped-out/detached sheet windows and touch drag gestures are outside this
  slice.

---

# Phase 24 archive — Battlefield Editor, Scene Presets & Token Management

Status: **implemented and verified in the browser** (Core untouched; 492/492
tests still pass, 35 suites).

```text
Feature Readiness:
- goal: switch between the authored Default Encounter and a clean Empty Arena,
  clear the battlefield through a confirmed Foundry-style modal, paint walls,
  difficult/greater-difficult terrain, hazardous fire and light levels directly
  on the canvas, and delete tokens from the right-click HUD or with
  Delete/Backspace.
- pf2e_remaster_rule: presentation/editor only. The painter writes the existing
  GridMap primitives (`setBlocked`, `setTerrain`, `setHazardous`,
  `setIllumination`); pathfinding, 5-10-5 movement, Step restrictions, cover
  rays, line of sight, and hazardous-entry damage read those same primitives at
  their next query. No Core rules module was modified.
- behavior_and_boundaries: Clear Board removes every combatant, wall, difficult
  zone, hazardous cell, light override, hazard, and token, and resets the
  encounter to an empty view-side NullEncounter. Default Encounter restores the
  authored five-combatant roster, walls, terrain, lava vents, light pockets and
  Spike Trap. Painting is a cursor mode layered over the normal action mode;
  selecting an action button returns the cursor to Select/Move.
- data_contracts: new View modules
  `src/View/UI/confirm-dialog.js` (PF2e.View.ConfirmDialog) and
  `src/View/UI/scene-editor.js` (PF2e.View.SceneEditor,
  PF2e.View.SCENE_PRESETS). BattlefieldView exports PF2e.View.PAINT_TOOLS and
  accepts `onPaintRequest`; TokenHud accepts `onDelete`. main.js adds the
  default-scene factories, NullEncounter adapter, `applyScenePreset`,
  `clearBoard`, `deleteCombatant`, `paintTerrainCell`, and exposes them through
  `window.PF2e.App`.
- acceptance_tests: `npm test` = 492 passed, 0 failed (35 suites). Browser
  checks: Escape and backdrop click cancel the clear dialog and leave the board
  untouched; Да clears combatants/walls/terrain/hazards/illumination and empties
  Actors + Initiative; Default Encounter restores 5 combatants, 18 walls, 8
  difficult, 3 greater-difficult, 2 hazardous cells, 9 dim + 9 darkness cells,
  and the Spike Trap; Wall/Difficult/Greater/Hazardous/Illumination clicks mutate
  the live map immediately; spawning an Animated Broom into an empty painted
  arena adds a combatant, starts its turn, and computes movement around the
  painted walls; the HUD 🗑️ and Delete both remove the token from the canvas,
  Actors tab, and initiative queue. Console has no errors or warnings.
- delegated_assumptions: Clear Board is intentionally equivalent to Empty
  Arena (bright 15 × 15 grid, no tokens). Painting allows a wall under a token;
  the editor does not validate tactical legality of authored terrain. The
  editor is local only and does not serialize painted terrain beyond the
  existing Save Combat path.
- confidence: 98%
```

## 1. Scene presets and clear-board modal

- `index.html` adds a `#scene-toolbar` above the canvas with a
  `#scene-preset` select: **Default Encounter** and **Empty Arena**.
- `src/View/UI/scene-editor.js` wires the select, brush buttons, and
  `#clear-board`. It forwards intents to `main.js` and owns no map state.
- `src/View/UI/confirm-dialog.js` appends a modal layer to `<body>` with the
  exact text *«Вы уверены, что хотите очистить поле боя? Все бойцы, стены и зоны
  ландшафта будут удалены.»* and **Да / Нет** buttons. Escape, the backdrop, and
  `Нет` cancel; `Да` invokes `clearBoard()`.
- `applyScenePreset("default")` rebuilds the authored map, roster, and Spike Trap
  from `createDefaultMap()`, `createDefaultCombatants()`, and
  `createDefaultHazards()`, starts round 1, and reselects the first active
  combatant. `applyScenePreset("empty")` installs a clean `GridMap` and a
  view-side `NullEncounter` because the headless Encounter requires at least one
  combatant.

## 2. Terrain and wall painter

`BattlefieldView` adds `paintTool` / `setPaintTool()` / `isPainting()`. While a
brush other than `select` is active, canvas clicks call `onPaintRequest` instead
of resolving Stride/Step/Strike/Cast. Hover status shows the active brush and
the cell label.

| Brush | Map mutation |
|---|---|
| 🖱️ Select / Move | no painting; normal token, Stride/Step and targeting input |
| 🧱 Wall | `setBlocked(x, y, !hasObstacle(x, y))` |
| 🌿 Difficult | toggles `setTerrain(x, y, "difficult")` ↔ `"normal"` (+5 ft) |
| ⛰️ Greater Difficult | toggles `"greater-difficult"` ↔ `"normal"` (+10 ft) |
| 🔥 Hazardous | toggles `setHazardous(x, y, { damage: "1d6", type: "fire" })` |
| 🌑 Illumination | cycles `bright → dim → darkness → bright` |

Each click calls `battlefield.refreshReachable()` and re-renders after the
mutation, so walls and terrain affect A*, movement cost, cover, line of sight,
and hazardous-entry damage without a reload.

## 3. Token deletion

- `TokenHud` adds a 🗑️ button titled **«Удалить токен»**. It closes the HUD and
  calls the host `onDelete` callback.
- `deleteCombatant()` removes the combatant from `COMBATANTS`, releases any
  grapple it maintained, rebuilds the Encounter while preserving round and
  active turn, rebuilds the token cards and initiative rows, clears the canvas
  token view, and logs `<name> удален со сцены`.
- A document-level Delete/Backspace handler removes the currently selected
  token. It ignores repeats, form controls, and open modal dialogs.
- Deleting the active combatant advances the active turn to the next living
  creature in the old initiative order.

## 4. Files

- `src/View/UI/confirm-dialog.js` — reusable Foundry-style confirmation modal.
- `src/View/UI/scene-editor.js` — preset/brush/clear toolbar controller.
- `src/View/battlefield-view.js` — `PAINT_TOOLS`, paint cursor mode, canvas
  paint dispatch, paint hover status, and cursor rendering.
- `src/View/Tokens/token-hud.js` — 🗑️ delete button and `onDelete` callback.
- `src/main.js` — default-scene factories, NullEncounter, preset/clear
  orchestration, terrain painting, token deletion, Delete/Backspace binding,
  and `window.PF2e.App` debug surface.
- `index.html` — scene toolbar markup, confirm/scene scripts, Phase 24 badges.
- `css/main.css` — scene toolbar, brush buttons, clear-board button, modal
  backdrop/panel, and red HUD delete hover state.

## 5. Verification

```bash
npm test   # 492 passed, 0 failed (35 suites)
```

Browser run against `http://127.0.0.1:8765/index.html`:

1. Click **Очистить поле боя** → modal appears. Escape leaves 5 combatants, 18
   walls, and 1 hazard intact. Reopen and click **Да** → 0 combatants, 0 walls,
   0 difficult/greater/hazardous cells, 0 light overrides, 0 hazards,
   0 Actors rows, 0 initiative rows, preset shows **Empty Arena**.
2. Switch the preset to **Default Encounter** → 5 combatants, 18 walls, 8
   difficult, 3 greater-difficult, 2 hazardous cells, 9 dim + 9 darkness cells,
   Spike Trap, Round 1, Valeros active.
3. In Empty Arena, paint walls at A1/B1, difficult at C1, greater-difficult at
   D1, fire at E1, and cycle F1 through dim → darkness → bright. Every map
   query reflects the click immediately.
4. Spawn **Animated Broom** from the Library into the painted arena: it appears
   at H7, becomes active, and its reachable squares avoid the painted walls.
5. Right-click Valeros → 🗑️ closes the HUD and removes Valeros from the canvas,
   Actors tab, and initiative queue; Goblin becomes active. Press Delete on the
   selected Goblin → it is removed and the log reports
   `Goblin удален со сцены (Delete).`
6. Backdrop click on the clear modal also cancels and leaves the board
   unchanged. Console is free of errors and warnings.

## 6. Known limitations / deferred

- The editor does not have undo/redo, rectangle fill, drag-paint, or an eraser
  tool beyond click-to-toggle.
- Terrain is local session state; painted walls/terrain are only persisted when
  the existing Save Combat serialization path is used.
- Clear Board always creates a fresh bright grid; the previous terrain is not
  recoverable after confirming.
- Deleting a combatant does not produce an undo entry and does not rewrite any
  external compendium source.
- Placement validation is intentionally permissive: a wall may be painted
  beneath a token, and a token already standing on hazardous terrain takes
  damage only on its next entry/movement query.

---

# Phase 23 archive — Data Ingestion & Compendium Browser

Status: **implemented and verified in the browser** (Core untouched; 492/492
tests still pass, 35 suites).

```text
Feature Readiness:
- goal: generate four lightweight combat catalogs from the official Foundry
  packs, browse them in the sidebar Library tab, add/equip catalog items and
  spells to a character, and spawn a bestiary monster into the live encounter.
- pf2e_remaster_rule: presentation and data ingestion only. Equipping delegates
  to Combatant.addInventoryItem / equipItem and the existing Shield normalizer;
  adding a spell stores a spell definition on Combatant.spells; spawning creates
  a real Combatant and rebuilds the Encounter through its public constructor.
  No Core rules module was modified.
- behavior_and_boundaries: generated JSON contains only the fields needed by the
  combat core. Catalogs are capped at 200 entries per category (125 shields are
  available, so all are kept). Spells whose Foundry cast time is not a combat
  action (1-3, reaction, or free) are excluded from the catalog. Unsupported
  Foundry area shapes are converted host-side: sphere/cylinder/square become a
  2D burst; burst/cone/line/emanation keep their canonical engine geometry.
- data_contracts: data/compendiums/{spells,weapons,shields,monsters}.json;
  scripts/build-compendiums.js; npm run build:data; new View module
  src/View/UI/compendium-browser.js exporting PF2e.View.CompendiumBrowser and
  PF2e.View.COMPENDIUM_CATEGORIES. main.js exposes
  window.PF2e.App.compendiumBrowser and wires all catalog actions.
- acceptance_tests: npm test = 492 passed, 0 failed (35 suites). Browser checks:
  Library opens with 200 spells; search "fireball" returns one card; rank 3 +
  Reflex filters return 12 cards; add Fireball to Merisiel and the open sheet's
  Magic tab immediately shows 8 spell rows including the new rank-3 Fireball;
  equip Steel Shield to Valeros and the sheet's Inventory tab shows it in Off
  Hand while Combatant.hands.offHand points at it; spawn Goblin Warrior adds a
  6th initiative row, a 6th Actors row, and a 6th canvas token; spawn
  Empyreal Dragon (Young, Spellcaster) creates a Large 2x2 token with 20
  converted spells and a 33 initiative entry. Console is free of errors and
  warnings.
- delegated_assumptions: catalogs are intentionally capped and popularity
  scored (iconic names first, then common/remastered, then low rank/level).
  Monster attacks use the first damage roll as their primary strike; a
  `reach-10`/`reach-15` monster trait is represented as the engine's single
  10-ft `reach` trait. Gargantuan monsters use the engine's Huge footprint.
  Monster spell descriptions are truncated to keep monsters.json near 1 MiB.
  Monster spell attack bonuses are derived as `max(0, level + 5)` because the
  bestiary does not author a per-monster spell attack modifier.
- confidence: 97%
```

## 1. Data builder

`scripts/build-compendiums.js` is a dependency-free Node script. It reads only
the targeted reference folders:

- `packs/pf2e/spells/**` — all spell documents;
- `packs/pf2e/equipment/**` — weapon and shield documents (including magic
  weapons/shields);
- `packs/pf2e/pathfinder-monster-core/*.json` — remastered bestiary (falls back
  to `pathfinder-bestiary` if Monster Core is absent).

It walks JSON deterministically, skips `_folders.json` / `_meta.json`, strips
Foundry HTML into plain text, and keeps only the combat fields.

Selection strategy:

- **Spells** — 200 cap. Seeds at least 12 entries per rank 0–10, then fills by a
  popularity score (iconic names, remastered Player Core/Core Rulebook sources,
  low-rank combat spells, damage/save/area presence, common rarity).
- **Weapons** — 200 cap. Iconic base weapons and level-0 common weapons score
  highest; output is alphabetical.
- **Shields** — all available (125 at build time), alphabetical.
- **Monsters** — 200 cap. Seeds up to 10 entries per level so the UI level filter
  is meaningful, then fills by popularity; iconic creatures score highest.

Generated catalogs (current run):

| File | Entries | Size |
|---|---:|---:|
| `data/compendiums/spells.json` | 200 | ~177 KiB |
| `data/compendiums/weapons.json` | 200 | ~106 KiB |
| `data/compendiums/shields.json` | 125 | ~81 KiB |
| `data/compendiums/monsters.json` | 200 | ~989 KiB |

Run it with:

```bash
npm run build:data
```

## 2. Compendium browser

`src/View/UI/compendium-browser.js` builds the Library UI inside
`[data-compendium-root]`:

- **Categories** — 🔮 Заклинания, ⚔️ Оружие, 🛡️ Щиты, 👾 Бестиарий.
- **Filters** — name search (`input[type=text]`); rank select 1–10 plus a
  Cantrip (rank 0) option for spells; level select 1–10 for monsters; a
  Reflex/Fortitude/Will save filter shown only for spells. Weapon/shield
  catalogs keep the rank/level select disabled because the required data
  contract does not include an item level.
- **Recipient** — a select of eligible living player combatants. It defaults to
  the battlefield selection, then the active combatant, then the first eligible
  recipient. Spell recipients are limited to casters.
- **Cards** — compact name, category subtitle, badges (rank/level, traits,
  damage, save, area, HP/AC, hardness), click-to-expand description and a
  two-column stat grid.
- **Actions** — `Экипировать`, `Добавить магу`, `Заспавнить`.
- **Lazy loading** — `activate()` is called on the first Library tab activation
  and fetches all four catalogs in parallel with `cache: "no-cache"`. Errors show
  an inline retry panel. The ⟳ button force-reloads.

## 3. Host integration

`src/main.js` adds:

- `compendiumRecipients(categoryId)` / `compendiumPreferredRecipient()` for the
  recipient picker.
- `compendiumSpellToEngine(entry)` — maps the catalog spell contract into
  `{ id, name, cost, type, traits, rank, saveType, basic, area, damage }`.
- `compendiumItemToInventory(entry)` + `equipCompendiumItem()` — adds the item to
  the Combatant inventory and calls `combatant.equipItem()`; a shield prefers
  Off Hand, a one-handed weapon falls back to the other free hand, and a
  two-handed item fills both hands. If no hand is free the item remains stowed
  and the log explains why.
- `addCompendiumSpell()` — appends the normalized spell once (stable Foundry id)
  and refreshes the spell picker.
- `createMonsterCombatant()` / `spawnCompendiumMonster()` — converts the bestiary
  entry into a real Combatant (HP, AC, saves, skills, senses, attacks, traits,
  converted spells), finds the nearest free footprint to the map centre with
  `Occupancy.canOccupySpace`, rolls initiative, rebuilds the Encounter around the
  same roster while preserving round/active turn, restores the battlefield
  selection, rebuilds token cards, and logs the spawn.
- `index.html` loads `compendium-browser.js` and exposes the new panel markup.

## 4. Files

- `scripts/build-compendiums.js` — data builder.
- `data/compendiums/spells.json`, `weapons.json`, `shields.json`,
  `monsters.json` — generated catalogs.
- `src/View/UI/compendium-browser.js` — catalog UI.
- `src/main.js` — host callbacks, spell/item conversion, monster spawning,
  `window.PF2e.App.compendiumBrowser`.
- `index.html` — Library panel root, script include, Phase 23 badges.
- `css/main.css` — Phase 23 compendium header, category tabs, filters, recipient
  picker, cards, badges, stat grid, actions, error/empty states; responsive
  catalog scrolling uses `max-height: 58vh` in the single-column layout so 200
  cards never stretch the page.
- `package.json` — `"build:data"` script.

## 5. Verification

```bash
npm run build:data   # 725 catalog entries
npm test             # 492 passed, 0 failed, 35 suites
```

Browser run against `http://127.0.0.1:8765/index.html`:

1. Library tab loads all catalogs; status reports `200 из 200 · Заклинания`.
2. Search `fireball` filters to one card; expanding shows rank 3, 2 actions,
   Reflex (basic), 20-ft burst, 6d6 fire, and the description.
3. Rank 3 + Reflex filter returns 12 cards, all rank 3 with Reflex saves.
4. `Добавить магу` on Fireball adds the Foundry spell to Merisiel
   (`Combatant.spells` 7 → 8); the open sheet's Magic tab shows the new row
   immediately.
5. `Экипировать` Steel Shield adds the compendium shield to Valeros inventory and
   puts it in Off Hand (`Combatant.hands.offHand`), while Main Hand stays the
   Longsword; the open sheet Inventory tab updates immediately.
6. `Заспавнить` Goblin Warrior changes the roster 5 → 6: a new initiative row,
   a new Actors row, and a new canvas token appear, with the monster's AC 16,
   HP 6, initiative 14, and 1d6 slashing attack.
7. `Заспавнить` Empyreal Dragon (Young, Spellcaster) creates a Large 2×2 token
   with 20 converted spells, HP 170, AC 30, senses darkvision/lifesense/scent,
   and a 33 initiative entry. The active turn (Valeros), round 1, and console
   state remain intact.

## 6. Known limitations / deferred

- Catalog caps are deliberate. Re-running the builder with higher caps is a
  one-line change, but the default keeps browser payloads small.
- Only combat-shaped spell cast times are ingested. Rituals and long-duration
  utility spells are outside this combat compendium. A small number of iconic
  buff/utility spells (Shield, Light, Haste, …) remain browsable and can be
  added to a caster, but the combat Cast flow only resolves attack/save spells;
  pure utility casting is a future slice.
- Foundry `sphere`/`cylinder`/`square` areas are approximated as 2D bursts; the
  engine has no volumetric/cylinder template yet.
- Monster reach is binary (5/10 ft). Authored `reach-15` is displayed as reach
  and resolved at 10 ft.
- Monster spell attack bonuses are derived from level; the bestiary data does
  not carry a standalone spell attack modifier.
- Spawning rebuilds the Encounter object so the queue stays canonical. This
  preserves round/active turn but replaces the Encounter instance identity.
- Deduplication is by stable Foundry id. A compendium Fireball and the authored
  demo Fireball intentionally coexist because they are different definitions.
- The Library tab supports mouse/click interaction; the category buttons declare
  `role=tab` but do not yet implement arrow-key roving focus.
