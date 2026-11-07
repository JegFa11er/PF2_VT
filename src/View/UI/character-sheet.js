/**
 * PF2E REMASTERED — FLOATING CHARACTER SHEET (VIEW)
 *
 * A draggable, Foundry-style character window opened from a token double-click
 * or from the sidebar Actors tab. The sheet is presentation only:
 *
 *   - Overview reads HP, AC, Speed, Elevation, saves, skills, and conditions
 *     through the Combatant API; save/skill totals use the same central
 *     modifier resolver as the rules core, so Frightened and other active
 *     penalties are visible.
 *   - Actions and Inventory call host callbacks. The host (src/main.js) maps
 *     them to the existing Core actions (Strike, Trip, Shove, Grapple, Stand,
 *     Raise a Shield, Take Cover, Interact, Shield Block, Cast a Spell,
 *     Sustain a Spell). No rules math is duplicated here.
 *   - Spells reads spell slots, Focus Points, and active sustained spells.
 *   - The sheet subscribes to the shared CombatEventBus and refreshes whenever
 *     damage, healing, conditions, reactions, turns, or rounds change.
 *
 * Direct HP editing mirrors the token HUD: it is GM bookkeeping that bypasses
 * IWR and the automatic Shield Block reaction while still emitting the normal
 * combatant:damaged / combatant:healed events.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  function make(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function signed(value) {
    const number = Number(value) || 0;
    return number >= 0 ? "+" + number : String(number);
  }

  function capitalize(value) {
    const text = String(value === undefined || value === null ? "" : value);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function parseHpInput(raw) {
    const text = String(raw === undefined || raw === null ? "" : raw).trim();
    const match = /^([+-]?)(\d+)$/.exec(text);
    if (!match) {
      return null;
    }
    const amount = Number.parseInt(match[2], 10);
    if (!Number.isInteger(amount)) {
      return null;
    }
    return { sign: match[1], amount: amount };
  }

  function traitSlugs(spell) {
    if (!Array.isArray(spell && spell.traits)) {
      return [];
    }
    return spell.traits.map(function (trait) {
      if (trait === null || trait === undefined) {
        return "";
      }
      if (typeof trait === "object") {
        return String(trait.slug || trait.name || trait.label || "").toLowerCase();
      }
      return String(trait).toLowerCase();
    });
  }

  function hasTrait(spell, name) {
    return traitSlugs(spell).indexOf(String(name).toLowerCase()) !== -1;
  }

  function hasCompendiumDrag(dataTransfer) {
    if (!dataTransfer || !dataTransfer.types) {
      return false;
    }
    const types = Array.from(dataTransfer.types);
    return (
      types.indexOf("application/json") !== -1 ||
      types.indexOf("text/plain") !== -1
    );
  }

  function readCompendiumDrag(dataTransfer) {
    if (!dataTransfer) {
      return null;
    }
    let raw = "";
    try {
      raw =
        dataTransfer.getData("application/json") ||
        dataTransfer.getData("text/plain");
    } catch (error) {
      return null;
    }
    if (!raw) {
      return null;
    }
    try {
      const payload = JSON.parse(raw);
      if (!payload || payload.type !== "compendium-item" || !payload.entry) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  }

  function writeHotbarDrag(dataTransfer, kind, combatant, entry) {
    if (!dataTransfer || !combatant || !entry) {
      return false;
    }
    const payload = {
      type: "hotbar-binding",
      kind: kind,
      combatantId: combatant.id,
      entry: entry,
    };
    const raw = JSON.stringify(payload);
    try {
      dataTransfer.effectAllowed = "copy";
      dataTransfer.setData("application/json", raw);
      dataTransfer.setData("text/plain", raw);
      return true;
    } catch (error) {
      return false;
    }
  }

  class CharacterSheet {
    constructor(options) {
      const opts = options || {};
      if (!opts.container) {
        throw new Error("CharacterSheet requires a container element.");
      }

      this.container = opts.container;
      this.document = opts.document || root.document || this.container.ownerDocument;
      this.eventBus = opts.eventBus || null;

      this.getCombatant =
        typeof opts.getCombatant === "function"
          ? opts.getCombatant
          : function () {
              return null;
            };
      this.getRound =
        typeof opts.getRound === "function"
          ? opts.getRound
          : function (combatant) {
              return combatant && Number.isInteger(combatant.encounterRound)
                ? combatant.encounterRound
                : 0;
            };
      this.isActiveCombatant =
        typeof opts.isActiveCombatant === "function"
          ? opts.isActiveCombatant
          : function () {
              return true;
            };

      this.onStrike =
        typeof opts.onStrike === "function" ? opts.onStrike : function () {};
      this.onQuickAction =
        typeof opts.onQuickAction === "function"
          ? opts.onQuickAction
          : function () {};
      this.onInteract =
        typeof opts.onInteract === "function" ? opts.onInteract : function () {};
      this.onShieldBlock =
        typeof opts.onShieldBlock === "function"
          ? opts.onShieldBlock
          : function () {};
      this.onCast =
        typeof opts.onCast === "function" ? opts.onCast : function () {};
      this.onSustain =
        typeof opts.onSustain === "function" ? opts.onSustain : function () {};
      this.onHpChange =
        typeof opts.onHpChange === "function" ? opts.onHpChange : function () {};
      this.onLog =
        typeof opts.onLog === "function" ? opts.onLog : function () {};
      this.onClose =
        typeof opts.onClose === "function" ? opts.onClose : function () {};
      this.onDropCompendium =
        typeof opts.onDropCompendium === "function"
          ? opts.onDropCompendium
          : function () {};
      this.onRemoveItem =
        typeof opts.onRemoveItem === "function"
          ? opts.onRemoveItem
          : function () {};

      this.combatantId = null;
      this.activeTabId = "overview";
      this.drag = null;
      this.destroyed = false;
      this.unsubscribers = [];
      this.refreshScheduled = false;
      this.lastPosition = null;
      this.HP_SOURCE = "character-sheet";

      this.build();
      this.bindBus();
    }

    // ------------------------------------------------------------- structure

    build() {
      const doc = this.document;

      this.window = make(doc, "div", "character-sheet");
      this.window.hidden = true;
      this.window.setAttribute("role", "dialog");
      this.window.setAttribute("aria-label", "Character Sheet");
      this.window.setAttribute("aria-modal", "false");
      this.window.dataset.characterSheet = "true";

      this.header = make(doc, "header", "sheet-header");
      this.header.title = "Drag to move the character sheet";

      const grip = make(doc, "span", "sheet-grip", "⠿");
      grip.setAttribute("aria-hidden", "true");

      const title = make(doc, "div", "sheet-title");
      this.nameEl = make(doc, "span", "sheet-name", "Character");
      this.subtitleEl = make(doc, "span", "sheet-subtitle", "");
      title.append(this.nameEl, this.subtitleEl);

      this.closeButton = make(doc, "button", "sheet-close", "✖");
      this.closeButton.type = "button";
      this.closeButton.title = "Закрыть лист персонажа";
      this.closeButton.setAttribute("aria-label", "Закрыть лист персонажа");
      this.closeButton.addEventListener(
        "click",
        function (event) {
          event.preventDefault();
          this.close();
        }.bind(this),
      );

      this.header.append(grip, title, this.closeButton);

      this.tabNav = make(doc, "nav", "sheet-tabs");
      this.tabNav.setAttribute("role", "tablist");
      this.tabNav.setAttribute("aria-label", "Character sheet sections");

      this.tabButtons = new Map();
      this.panels = new Map();
      const tabs = [
        { id: "overview", label: "Главное", icon: "📜" },
        { id: "actions", label: "Действия", icon: "⚔️" },
        { id: "inventory", label: "Инвентарь", icon: "🎒" },
        { id: "spells", label: "Магия", icon: "✨" },
      ];

      for (const tab of tabs) {
        const button = make(doc, "button", "sheet-tab");
        button.type = "button";
        button.dataset.sheetTab = tab.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", tab.id === this.activeTabId ? "true" : "false");
        button.setAttribute(
          "aria-controls",
          "sheet-panel-" + tab.id,
        );
        const icon = make(doc, "span", "sheet-tab-icon", tab.icon);
        icon.setAttribute("aria-hidden", "true");
        const label = make(doc, "span", "sheet-tab-label", tab.label);
        button.append(icon, label);
        button.addEventListener(
          "click",
          function () {
            this.setTab(tab.id);
          }.bind(this),
        );
        this.tabNav.append(button);
        this.tabButtons.set(tab.id, button);
      }

      this.body = make(doc, "div", "sheet-body");

      this.buildOverviewPanel();
      this.buildActionsPanel();
      this.buildInventoryPanel();
      this.buildSpellsPanel();

      this.window.append(this.header, this.tabNav, this.body);
      this.container.append(this.window);

      this.window.addEventListener("keydown", this.handleKeyDown.bind(this));
      this.bindDrag();
      this.bindDrop();
      this.setTab(this.activeTabId);
    }

    buildPanel(id, title) {
      const doc = this.document;
      const panel = make(doc, "section", "sheet-panel");
      panel.dataset.sheetPanel = id;
      panel.id = "sheet-panel-" + id;
      panel.setAttribute("role", "tabpanel");
      panel.hidden = id !== this.activeTabId;

      const heading = make(doc, "h3", "sheet-panel-title", title);
      panel.append(heading);
      this.body.append(panel);
      this.panels.set(id, panel);
      return panel;
    }

    buildOverviewPanel() {
      const doc = this.document;
      const panel = this.buildPanel("overview", "Главное");

      const hpCard = make(doc, "div", "sheet-hp-card");
      const hpHead = make(doc, "div", "sheet-hp-head");
      const hpLabel = make(doc, "span", "sheet-hp-label", "Hit Points");
      this.hpValueEl = make(doc, "span", "sheet-hp-value", "0 / 0");
      hpHead.append(hpLabel, this.hpValueEl);

      const bar = make(doc, "div", "sheet-hp-bar");
      this.hpFillEl = make(doc, "span", "sheet-hp-fill");
      bar.append(this.hpFillEl);

      const controls = make(doc, "div", "sheet-hp-controls");
      this.hpInput = make(doc, "input", "sheet-hp-input");
      this.hpInput.type = "text";
      this.hpInput.inputMode = "numeric";
      this.hpInput.autocomplete = "off";
      this.hpInput.spellcheck = false;
      this.hpInput.title = "Set HP, +N to heal, or -N to damage. Press Enter to apply.";
      this.hpInput.setAttribute(
        "aria-label",
        "Hit points. Enter a value to set HP, +N to heal, or -N to damage.",
      );
      this.hpInput.addEventListener("keydown", this.handleHpKeyDown.bind(this));
      this.hpInput.addEventListener(
        "focus",
        function () {
          this.hpInput.select();
        }.bind(this),
      );

      this.hpMaxEl = make(doc, "span", "sheet-hp-max", "/ 0");
      this.hpApplyButton = make(doc, "button", "sheet-button sheet-hp-apply", "Apply");
      this.hpApplyButton.type = "button";
      this.hpApplyButton.addEventListener(
        "click",
        function () {
          this.applyHpInput();
        }.bind(this),
      );
      controls.append(this.hpInput, this.hpMaxEl, this.hpApplyButton);
      hpCard.append(hpHead, bar, controls);
      panel.append(hpCard);

      this.overviewStats = make(doc, "div", "sheet-stat-grid");
      panel.append(this.overviewStats);

      this.overviewSaves = make(doc, "div", "sheet-list");
      this.overviewSkills = make(doc, "div", "sheet-list");
      this.overviewConditions = make(doc, "div", "sheet-condition-list");

      panel.append(
        this.listSection("Спасброски", this.overviewSaves),
        this.listSection("Навыки", this.overviewSkills),
        this.listSection("Состояния", this.overviewConditions),
      );
    }

    buildActionsPanel() {
      const doc = this.document;
      const panel = this.buildPanel("actions", "Действия");

      this.weaponCard = make(doc, "div", "sheet-weapon-card");
      this.weaponHotbarEntry = null;
      this.weaponCard.draggable = false;
      this.weaponCard.addEventListener(
        "dragstart",
        function (event) {
          const combatant = this.combatantId
            ? this.getCombatant(this.combatantId)
            : null;
          const entry = this.weaponHotbarEntry;
          if (!combatant || !entry) {
            event.preventDefault();
            return;
          }
          if (!writeHotbarDrag(event.dataTransfer, "weapon", combatant, entry)) {
            event.preventDefault();
            return;
          }
          this.weaponCard.classList.add("is-dragging");
        }.bind(this),
      );
      this.weaponCard.addEventListener(
        "dragend",
        function () {
          this.weaponCard.classList.remove("is-dragging");
        }.bind(this),
      );
      panel.append(this.weaponCard);

      this.mapControls = make(doc, "div", "sheet-map-controls");
      panel.append(this.mapControls);

      const quickTitle = make(doc, "h4", "sheet-section-title", "Быстрые боевые действия");
      this.quickGrid = make(doc, "div", "sheet-quick-grid");
      panel.append(quickTitle, this.quickGrid);

      this.actionsNote = make(doc, "p", "sheet-note");
      panel.append(this.actionsNote);
    }

    buildInventoryPanel() {
      const doc = this.document;
      const panel = this.buildPanel("inventory", "Инвентарь");

      this.handsGrid = make(doc, "div", "sheet-hands-grid");
      panel.append(this.handsGrid);

      this.shieldCard = make(doc, "div", "sheet-shield-card");
      panel.append(this.shieldCard);

      this.drawList = make(doc, "div", "sheet-list sheet-draw-list");
      panel.append(this.listSection("Инвентарь · Interact", this.drawList));

      this.inventoryNote = make(doc, "p", "sheet-note");
      panel.append(this.inventoryNote);
    }

    buildSpellsPanel() {
      const doc = this.document;
      const panel = this.buildPanel("spells", "Магия");

      this.resourceList = make(doc, "div", "sheet-resource-grid");
      panel.append(this.listSection("Ресурсы", this.resourceList));

      this.sustainedList = make(doc, "div", "sheet-list sheet-sustained-list");
      this.sustainedSection = this.listSection(
        "Активные поддерживаемые",
        this.sustainedList,
      );
      panel.append(this.sustainedSection);

      this.spellList = make(doc, "div", "sheet-spell-list");
      panel.append(this.listSection("Заклинания", this.spellList));

      this.spellsNote = make(doc, "p", "sheet-note");
      panel.append(this.spellsNote);
    }

    listSection(title, body) {
      const section = make(this.document, "section", "sheet-section");
      const heading = make(this.document, "h4", "sheet-section-title", title);
      section.append(heading, body);
      return section;
    }

    // ------------------------------------------------------------ open/close

    get isOpen() {
      return this.combatantId !== null && this.window.hidden !== true;
    }

    getCombatantId() {
      return this.combatantId;
    }

    open(combatantId) {
      const combatant = this.getCombatant(combatantId);
      if (!combatant) {
        return false;
      }

      this.combatantId = combatant.id;
      this.window.hidden = false;
      this.window.classList.add("is-open");
      this.highlightCard(combatant.id);

      this.setTab(this.activeTabId, { force: true });
      this.render();

      const reveal = function () {
        if (this.lastPosition) {
          this.applyPosition(this.lastPosition.left, this.lastPosition.top);
        } else {
          this.positionDefault();
        }
        this.window.classList.add("is-visible");
      }.bind(this);

      if (typeof root.requestAnimationFrame === "function") {
        root.requestAnimationFrame(reveal);
      } else {
        reveal();
      }
      return true;
    }

    close() {
      if (!this.isOpen && this.window.hidden) {
        return;
      }
      const combatant = this.combatantId ? this.getCombatant(this.combatantId) : null;
      this.combatantId = null;
      this.window.classList.remove("is-visible", "is-open", "is-dragging");
      this.window.hidden = true;
      this.highlightCard(null);
      this.onClose(combatant);
    }

    highlightCard(combatantId) {
      if (!this.document) {
        return;
      }
      const cards = this.document.querySelectorAll(
        ".token-card[data-combatant-id]",
      );
      for (const card of cards) {
        card.classList.toggle(
          "is-sheet-open",
          combatantId !== null && card.dataset.combatantId === combatantId,
        );
      }
    }

    setTab(tabId, options) {
      const opts = options || {};
      if (!this.panels.has(tabId)) {
        return false;
      }
      if (this.activeTabId === tabId && opts.force !== true) {
        return true;
      }
      this.activeTabId = tabId;

      for (const entry of this.tabButtons) {
        const isActive = entry[0] === tabId;
        entry[1].classList.toggle("is-active", isActive);
        entry[1].setAttribute("aria-selected", isActive ? "true" : "false");
        entry[1].tabIndex = isActive ? 0 : -1;
      }
      for (const entry of this.panels) {
        const isActive = entry[0] === tabId;
        entry[1].classList.toggle("is-active", isActive);
        entry[1].hidden = !isActive;
      }

      this.render();
      return true;
    }

    getActiveTab() {
      return this.activeTabId;
    }

    // -------------------------------------------------------------- dragging

    bindDrag() {
      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.handlePointerMove = this.handlePointerMove.bind(this);
      this.handlePointerUp = this.handlePointerUp.bind(this);
      this.header.addEventListener("pointerdown", this.handlePointerDown);
    }

    handlePointerDown(event) {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }
      const target = event.target;
      if (target && typeof target.closest === "function" && target.closest("button")) {
        return;
      }
      if (event.preventDefault) {
        event.preventDefault();
      }
      const rect = this.window.getBoundingClientRect();
      this.drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      this.window.classList.add("is-dragging");
      if (typeof this.header.setPointerCapture === "function" && event.pointerId !== undefined) {
        try {
          this.header.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is best-effort; document listeners still work.
        }
      }
      this.document.addEventListener("pointermove", this.handlePointerMove);
      this.document.addEventListener("pointerup", this.handlePointerUp);
      this.document.addEventListener("pointercancel", this.handlePointerUp);
    }

    handlePointerMove(event) {
      if (!this.drag) {
        return;
      }
      this.applyPosition(
        event.clientX - this.drag.offsetX,
        event.clientY - this.drag.offsetY,
      );
    }

    handlePointerUp() {
      if (!this.drag) {
        return;
      }
      this.drag = null;
      this.window.classList.remove("is-dragging");
      this.document.removeEventListener("pointermove", this.handlePointerMove);
      this.document.removeEventListener("pointerup", this.handlePointerUp);
      this.document.removeEventListener("pointercancel", this.handlePointerUp);
    }

    // ---------------------------------------------------------- drop targets

    bindDrop() {
      this.handleDragOver = this.handleDragOver.bind(this);
      this.handleDragLeave = this.handleDragLeave.bind(this);
      this.handleDrop = this.handleDrop.bind(this);
      this.window.addEventListener("dragover", this.handleDragOver);
      this.window.addEventListener("dragleave", this.handleDragLeave);
      this.window.addEventListener("drop", this.handleDrop);
    }

    handleDragOver(event) {
      if (!this.isOpen || !hasCompendiumDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      this.window.classList.add("drag-over");
    }

    handleDragLeave(event) {
      if (
        event.relatedTarget &&
        typeof this.window.contains === "function" &&
        this.window.contains(event.relatedTarget)
      ) {
        return;
      }
      this.window.classList.remove("drag-over");
    }

    handleDrop(event) {
      this.window.classList.remove("drag-over");
      if (!this.isOpen) {
        return;
      }
      const payload = readCompendiumDrag(event.dataTransfer);
      if (!payload) {
        return;
      }
      event.preventDefault();
      const combatant = this.combatantId
        ? this.getCombatant(this.combatantId)
        : null;
      if (!combatant) {
        return;
      }
      this.onDropCompendium(combatant, payload);
      this.render();
    }

    applyPosition(left, top) {
      const margin = 8;
      const width = this.window.offsetWidth || 640;
      const height = this.window.offsetHeight || 560;
      const viewportWidth = root.innerWidth || 1280;
      const viewportHeight = root.innerHeight || 800;
      const clampedLeft = Math.max(
        margin,
        Math.min(viewportWidth - width - margin, Math.round(left)),
      );
      const clampedTop = Math.max(
        margin,
        Math.min(viewportHeight - height - margin, Math.round(top)),
      );
      this.window.style.left = clampedLeft + "px";
      this.window.style.top = clampedTop + "px";
      this.lastPosition = { left: clampedLeft, top: clampedTop };
    }

    positionDefault() {
      const viewportWidth = root.innerWidth || 1280;
      const viewportHeight = root.innerHeight || 800;
      const width = this.window.offsetWidth || 640;
      const height = this.window.offsetHeight || 560;
      const left = Math.max(16, Math.round((viewportWidth - width) / 2));
      const top = Math.max(72, Math.round((viewportHeight - height) / 2));
      this.applyPosition(left, top);
    }

    // ------------------------------------------------------------ reactivity

    bindBus() {
      if (!this.eventBus || typeof this.eventBus.on !== "function") {
        return;
      }
      const events = [
        "combatant:damaged",
        "combatant:healed",
        "combatant:moved",
        "condition:added",
        "condition:removed",
        "reaction:triggered",
        "turn:changed",
        "round:started",
        "hazard:triggered",
        "hazard:disabled",
      ];
      const handler = this.scheduleRefresh.bind(this);
      for (const event of events) {
        this.unsubscribers.push(this.eventBus.on(event, handler));
      }
    }

    scheduleRefresh() {
      if (this.refreshScheduled || !this.isOpen) {
        return;
      }
      this.refreshScheduled = true;
      const run = function () {
        this.refreshScheduled = false;
        this.render();
      }.bind(this);
      if (typeof root.requestAnimationFrame === "function") {
        root.requestAnimationFrame(run);
      } else if (typeof root.setTimeout === "function") {
        root.setTimeout(run, 0);
      }
    }

    refresh() {
      this.render();
    }

    // -------------------------------------------------------------- rendering

    render() {
      if (!this.combatantId) {
        return;
      }
      const combatant = this.getCombatant(this.combatantId);
      if (!combatant) {
        this.close();
        return;
      }

      this.nameEl.textContent = combatant.name;
      this.subtitleEl.textContent = this.subtitleOf(combatant);
      this.window.classList.toggle("is-defeated", combatant.isDefeated === true);

      switch (this.activeTabId) {
        case "actions":
          this.renderActions(combatant);
          break;
        case "inventory":
          this.renderInventory(combatant);
          break;
        case "spells":
          this.renderSpells(combatant);
          break;
        default:
          this.renderOverview(combatant);
          break;
      }

      this.keepInViewport();
    }

    keepInViewport() {
      if (this.window.hidden) {
        return;
      }
      const left = Number.parseFloat(this.window.style.left);
      const top = Number.parseFloat(this.window.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return;
      }
      this.applyPosition(left, top);
    }

    subtitleOf(combatant) {
      const parts = [];
      const alliance = combatant.alliance === "enemy" ? "Enemy" : "Party";
      parts.push(alliance);
      if (combatant.size) {
        parts.push(capitalize(combatant.size));
      }
      if (Number.isInteger(combatant.x) && Number.isInteger(combatant.y)) {
        parts.push(this.cellLabel(combatant));
      }
      if (combatant.isDefeated === true) {
        parts.push("Defeated");
      }
      return parts.join(" · ");
    }

    cellLabel(combatant) {
      const Grid = NS.Core && NS.Core.Grid;
      if (Grid && typeof Grid.gridToLabel === "function") {
        return Grid.gridToLabel(combatant);
      }
      return "(" + combatant.x + ", " + combatant.y + ")";
    }

    resolveTotal(base, modifiers) {
      const value = Number.isInteger(base) ? base : 0;
      const list = Array.isArray(modifiers) ? modifiers : [];
      const Modifiers = NS.Core && NS.Core.Rules && NS.Core.Rules.Modifiers;
      if (Modifiers && typeof Modifiers.resolveModifiers === "function") {
        return Modifiers.resolveModifiers(value, list).total;
      }
      return list.reduce(function (sum, modifier) {
        return sum + (Number(modifier && modifier.value) || 0);
      }, value);
    }

    canAct(combatant) {
      if (!combatant || combatant.isDefeated === true) {
        return false;
      }
      if (!this.isActiveCombatant(combatant)) {
        return false;
      }
      if (typeof combatant.canAct === "function") {
        return combatant.canAct().ok === true;
      }
      return true;
    }

    hasActions(combatant, count) {
      const cost = count === undefined ? 1 : count;
      if (!combatant) {
        return false;
      }
      if (typeof combatant.canSpendActions === "function") {
        return combatant.canSpendActions(cost);
      }
      return (combatant.actionsRemaining || 0) >= cost;
    }

    renderOverview(combatant) {
      const ratio =
        combatant.maxHP > 0
          ? Math.max(0, Math.min(1, combatant.currentHP / combatant.maxHP))
          : 0;

      this.hpValueEl.textContent =
        combatant.currentHP + " / " + combatant.maxHP;
      this.hpMaxEl.textContent = "/ " + combatant.maxHP;
      this.hpFillEl.style.width = Math.round(ratio * 100) + "%";
      this.hpFillEl.classList.toggle("is-mid", ratio > 0.25 && ratio <= 0.5);
      this.hpFillEl.classList.toggle("is-low", ratio <= 0.25);

      if (this.document.activeElement !== this.hpInput) {
        this.hpInput.value = String(combatant.currentHP);
      }
      this.hpInput.classList.toggle(
        "is-defeated",
        combatant.isDefeated === true || combatant.currentHP <= 0,
      );

      const acModifiers =
        typeof combatant.getConditionModifiers === "function"
          ? combatant.getConditionModifiers("ac")
          : [];
      const acTotal = this.resolveTotal(combatant.ac, acModifiers);
      const acDelta = acTotal - combatant.ac;

      const stats = [
        {
          label: "AC",
          value: String(acTotal),
          delta: acDelta === 0 ? null : signed(acDelta) + " active",
          title: "Armor Class with active condition modifiers",
        },
        {
          label: "Speed",
          value: String(combatant.speedFeet) + " ft",
          title: "Stride distance per action",
        },
        {
          label: "Elevation",
          value:
            String(
              typeof combatant.getElevation === "function"
                ? combatant.getElevation()
                : combatant.elevation || 0,
            ) + " ft",
          title: "Height above the battlefield baseline",
        },
        {
          label: "Actions",
          value: combatant.actionsRemaining + " / " + combatant.maxActions,
          title: "Actions remaining this turn",
        },
        {
          label: "Reactions",
          value: combatant.reactionsRemaining + " / " + combatant.maxReactions,
          title: "Reactions remaining this round",
        },
        {
          label: "MAP",
          value:
            typeof combatant.getMultipleAttackPenalty === "function"
              ? signed(combatant.getMultipleAttackPenalty())
              : "+0",
          title: "Multiple Attack Penalty on the next Strike",
        },
      ];

      this.overviewStats.replaceChildren();
      for (const stat of stats) {
        const cell = make(this.document, "div", "sheet-stat");
        if (stat.title) {
          cell.title = stat.title;
        }
        cell.append(
          make(this.document, "span", "sheet-stat-label", stat.label),
          make(this.document, "span", "sheet-stat-value", stat.value),
        );
        if (stat.delta) {
          cell.append(make(this.document, "span", "sheet-stat-delta", stat.delta));
        }
        this.overviewStats.append(cell);
      }

      this.renderSaves(combatant);
      this.renderSkills(combatant);
      this.renderConditions(combatant);
    }

    renderSaves(combatant) {
      const doc = this.document;
      const baseSaves =
        typeof combatant.getSaves === "function"
          ? combatant.getSaves()
          : combatant.saves || {};
      const rows = [
        ["fortitude", "Fortitude"],
        ["reflex", "Reflex"],
        ["will", "Will"],
      ];

      this.overviewSaves.replaceChildren();
      for (const entry of rows) {
        const key = entry[0];
        const label = entry[1];
        const base = Number.isInteger(baseSaves[key]) ? baseSaves[key] : 0;
        const modifiers =
          typeof combatant.getSaveModifiers === "function"
            ? combatant.getSaveModifiers(key)
            : [];
        const total = this.resolveTotal(base, modifiers);
        const delta = total - base;
        this.overviewSaves.append(
          this.statRow(label, signed(total), delta === 0 ? null : signed(delta), modifiers),
        );
      }
    }

    renderSkills(combatant) {
      const baseSkills =
        typeof combatant.getSkills === "function"
          ? combatant.getSkills()
          : combatant.skills || {};
      const rows = [
        ["athletics", "Athletics"],
        ["acrobatics", "Acrobatics"],
        ["stealth", "Stealth"],
        ["perception", "Perception"],
      ];

      this.overviewSkills.replaceChildren();
      for (const entry of rows) {
        const key = entry[0];
        const label = entry[1];
        const base = Number.isInteger(baseSkills[key]) ? baseSkills[key] : 0;
        const modifiers =
          typeof combatant.getSkillModifiers === "function"
            ? combatant.getSkillModifiers(key)
            : [];
        const total = this.resolveTotal(base, modifiers);
        const delta = total - base;
        this.overviewSkills.append(
          this.statRow(label, signed(total), delta === 0 ? null : signed(delta), modifiers),
        );
      }
    }

    statRow(label, value, delta, modifiers) {
      const doc = this.document;
      const row = make(doc, "div", "sheet-stat-row");
      const name = make(doc, "span", "sheet-stat-name", label);
      const valueEl = make(doc, "span", "sheet-stat-number", value);
      if (delta) {
        valueEl.append(make(doc, "span", "sheet-stat-delta", " " + delta));
      }
      if (Array.isArray(modifiers) && modifiers.length > 0) {
        row.title = modifiers
          .map(function (modifier) {
            return (
              (modifier.name || modifier.source || "Modifier") +
              " " +
              signed(modifier.value) +
              " [" +
              (modifier.type || "untyped") +
              "]"
            );
          })
          .join("\n");
      }
      row.append(name, valueEl);
      return row;
    }

    renderConditions(combatant) {
      const doc = this.document;
      const conditions =
        typeof combatant.getConditions === "function"
          ? combatant.getConditions()
          : [];
      const persistent =
        typeof combatant.getPersistentDamage === "function"
          ? combatant.getPersistentDamage()
          : [];

      this.overviewConditions.replaceChildren();
      if (conditions.length === 0 && persistent.length === 0) {
        this.overviewConditions.append(
          make(doc, "span", "sheet-empty", "Нет активных состояний"),
        );
        return;
      }

      for (const condition of conditions) {
        const badge = make(
          doc,
          "span",
          "condition-badge condition-" + (condition.slug || condition.name),
          condition.label || condition.name,
        );
        badge.title = condition.description || condition.name || "";
        this.overviewConditions.append(badge);
      }
      for (const instance of persistent) {
        const badge = make(
          doc,
          "span",
          "condition-badge persistent-badge persistent-" + instance.type,
          "Persistent " + capitalize(instance.type) + " " + instance.formula,
        );
        this.overviewConditions.append(badge);
      }
    }

    renderActions(combatant) {
      const doc = this.document;
      const weapon =
        typeof combatant.getWeapon === "function"
          ? combatant.getWeapon()
          : {
              formula: combatant.damage,
              type: combatant.damageType || "untyped",
              traits: combatant.traits || [],
            };
      const spec =
        typeof combatant.getDamageSpec === "function"
          ? combatant.getDamageSpec()
          : null;
      const labels =
        typeof combatant.getTraitLabels === "function"
          ? combatant.getTraitLabels()
          : [];
      const hands =
        typeof combatant.getHands === "function"
          ? combatant.getHands()
          : combatant.hands || {};
      const main = hands.mainHand || null;
      const weaponName =
        main && main.type === "weapon"
          ? main.name
          : main && main.type !== "shield"
            ? main.name
            : labels.length > 0
              ? "Weapon"
              : "Unarmed";

      this.weaponHotbarEntry =
        main && (main.type === "weapon" || main.type === "shield") ? main : null;
      this.weaponCard.draggable = Boolean(this.weaponHotbarEntry);
      this.weaponCard.title = this.weaponHotbarEntry
        ? "Перетащите " + this.weaponHotbarEntry.name + " в слот хотбара"
        : "";

      this.weaponCard.replaceChildren();
      const weaponHead = make(doc, "div", "sheet-weapon-head");
      weaponHead.append(
        make(doc, "span", "sheet-weapon-name", weaponName),
        make(
          doc,
          "span",
          "sheet-weapon-attack",
          "Attack " + signed(combatant.attackBonus),
        ),
      );
      const formula = make(
        doc,
        "div",
        "sheet-weapon-formula",
        (weapon.formula || (spec && spec.formula) || "1d4") +
          " " +
          (weapon.type || combatant.damageType || "untyped"),
      );
      const traits = make(doc, "div", "sheet-trait-row");
      if (labels.length === 0) {
        traits.append(make(doc, "span", "sheet-trait is-muted", "no traits"));
      } else {
        for (const label of labels) {
          traits.append(make(doc, "span", "sheet-trait", label));
        }
      }
      const weaponMeta = make(
        doc,
        "div",
        "sheet-weapon-meta",
        "Reach " +
          (typeof combatant.getReachFeet === "function"
            ? combatant.getReachFeet()
            : 5) +
          " ft · " +
          (combatant.agile === true ? "Agile" : "Normal") +
          " MAP",
      );
      this.weaponCard.append(weaponHead, formula, traits, weaponMeta);

      const canAct = this.canAct(combatant);
      const hasAction = this.hasActions(combatant, 1);
      const currentMap =
        typeof combatant.getMultipleAttackPenalty === "function"
          ? combatant.getMultipleAttackPenalty()
          : 0;
      const mapValues = combatant.agile === true ? [0, -4, -8] : [0, -5, -10];

      this.mapControls.replaceChildren();
      const strikeButton = make(doc, "button", "sheet-strike-button", "Strike");
      strikeButton.type = "button";
      strikeButton.disabled = !canAct || !hasAction;
      strikeButton.title = canAct
        ? "Strike the nearest hostile in reach, or arm Strike mode if none is in reach"
        : "Only the active combatant can Strike";
      strikeButton.addEventListener(
        "click",
        function () {
          this.onStrike(combatant, currentMap);
        }.bind(this),
      );

      const variantRow = make(doc, "div", "sheet-map-variants");
      variantRow.append(make(doc, "span", "sheet-map-label", "MAP"));
      for (const value of mapValues) {
        const variant = make(
          doc,
          "button",
          "sheet-map-button" + (value === currentMap ? " is-current" : ""),
          value === 0 ? "-0" : String(value),
        );
        variant.type = "button";
        variant.disabled = value !== currentMap || !canAct || !hasAction;
        variant.setAttribute(
          "aria-pressed",
          value === currentMap ? "true" : "false",
        );
        variant.title =
          value === currentMap
            ? "Next Strike uses MAP " + (value === 0 ? "0" : String(value))
            : "MAP advances automatically after each Strike";
        variant.addEventListener(
          "click",
          function () {
            this.onStrike(combatant, value);
          }.bind(this),
        );
        variantRow.append(variant);
      }
      this.mapControls.append(strikeButton, variantRow);

      const actions = [
        { id: "trip", label: "Trip", hint: "Athletics vs Reflex DC · 1 action" },
        { id: "shove", label: "Shove", hint: "Athletics vs Fortitude DC · 1 action" },
        { id: "grapple", label: "Grapple", hint: "Athletics vs Fortitude DC · 1 action" },
        { id: "stand", label: "Stand", hint: "Removes Prone · 1 action" },
        { id: "raise-shield", label: "Raise Shield", hint: "+2 circumstance AC · 1 action" },
        { id: "take-cover", label: "Take Cover", hint: "+4 circumstance AC behind cover · 1 action" },
      ];

      this.quickGrid.replaceChildren();
      for (const action of actions) {
        const button = make(doc, "button", "sheet-quick-button", action.label);
        button.type = "button";
        let disabled = !canAct || !hasAction;
        if (action.id === "stand") {
          const prone =
            typeof combatant.hasCondition === "function" &&
            combatant.hasCondition("prone");
          disabled = disabled || !prone;
        } else if (action.id === "raise-shield") {
          const shield =
            typeof combatant.getShield === "function"
              ? combatant.getShield()
              : combatant.shield;
          const held =
            shield &&
            (typeof combatant.isItemHeld === "function"
              ? combatant.isItemHeld(shield)
              : true);
          disabled = disabled || !held;
          if (shield && !held) {
            button.title = "Draw the shield before raising it.";
          }
        }
        button.disabled = disabled;
        button.title = disabled
          ? action.hint
          : action.hint + " — click to use the Core action";
        button.addEventListener(
          "click",
          function () {
            this.onQuickAction(combatant, action.id);
          }.bind(this),
        );
        this.quickGrid.append(button);
      }

      this.actionsNote.textContent =
        "MAP применяется автоматически: подсвечен только вариант, доступный для текущей атаки. " +
        "Быстрые действия выполняются через Core; если в досягаемости нет цели, включается режим выбора цели на карте.";
    }

    renderInventory(combatant) {
      const doc = this.document;
      const hands =
        typeof combatant.getHands === "function"
          ? combatant.getHands()
          : combatant.hands || {};
      const inventory =
        typeof combatant.getInventory === "function"
          ? combatant.getInventory()
          : Array.isArray(combatant.inventory)
            ? combatant.inventory
            : [];
      const active = this.canAct(combatant);
      const canSpend = this.hasActions(combatant, 1);

      this.handsGrid.replaceChildren();
      this.handsGrid.append(
        this.renderHand(combatant, "mainHand", "Main Hand", hands.mainHand, active, canSpend),
        this.renderHand(combatant, "offHand", "Off Hand", hands.offHand, active, canSpend),
      );

      this.renderShield(combatant);

      this.drawList.replaceChildren();
      const stowed = inventory.filter(function (item) {
        if (typeof combatant.isItemHeld === "function") {
          return !combatant.isItemHeld(item);
        }
        return item.equipped !== true;
      });

      if (stowed.length === 0) {
        this.drawList.append(
          make(doc, "span", "sheet-empty", "Все предметы уже в руках."),
        );
      } else {
        for (const item of stowed) {
          const row = make(doc, "div", "sheet-item-row");
          row.draggable = item.type === "weapon" || item.type === "shield";
          if (row.draggable) {
            row.classList.add("is-hotbar-source");
            row.title = "Перетащите " + (item.name || item.id) + " в слот хотбара";
            row.addEventListener(
              "dragstart",
              function (event) {
                if (!writeHotbarDrag(event.dataTransfer, "weapon", combatant, item)) {
                  event.preventDefault();
                  return;
                }
                row.classList.add("is-dragging");
              }.bind(this),
            );
            row.addEventListener("dragend", function () {
              row.classList.remove("is-dragging");
            });
          }
          const meta = make(doc, "div", "sheet-item-meta");
          meta.append(
            make(doc, "span", "sheet-item-name", item.name || item.id),
            make(
              doc,
              "span",
              "sheet-item-sub",
              (item.type || "gear") +
                " · " +
                (item.hands === 2 ? "2 hands" : "1 hand") +
                (item.hp !== undefined && item.maxHP !== undefined
                  ? " · HP " + item.hp + "/" + item.maxHP
                  : ""),
            ),
          );

          const drawButton = make(doc, "button", "sheet-button sheet-button-small", "Draw");
          drawButton.type = "button";
          const slot = item.type === "shield" ? "offHand" : undefined;
          const validation =
            typeof combatant.canEquipItem === "function"
              ? combatant.canEquipItem(item, { slot: slot })
              : { ok: true };
          drawButton.disabled = !active || !canSpend || validation.ok !== true;
          drawButton.title = validation.ok
            ? "Interact: draw " + (item.name || item.id) + " · 1 action"
            : "No free hand for " + (item.name || item.id);
          drawButton.addEventListener(
            "click",
            function () {
              this.onInteract(combatant, "draw", {
                item: item.id,
                slot: slot,
              });
            }.bind(this),
          );
          const rowActions = make(doc, "div", "sheet-item-actions");
          rowActions.append(
            drawButton,
            this.makeRemoveButton(combatant, item),
          );
          row.append(meta, rowActions);
          this.drawList.append(row);
        }
      }

      this.inventoryNote.textContent = active
        ? "Draw и Stow стоят 1 действие (manipulate); Drop — свободное действие."
        : "Только активный боец может взаимодействовать с предметами.";
    }

    renderHand(combatant, slot, label, item, active, canSpend) {
      const doc = this.document;
      const card = make(doc, "div", "sheet-hand");
      if (item && (item.type === "weapon" || item.type === "shield")) {
        card.draggable = true;
        card.classList.add("is-hotbar-source");
        card.title = "Перетащите " + (item.name || item.id) + " в слот хотбара";
        card.addEventListener("dragstart", function (event) {
          if (!writeHotbarDrag(event.dataTransfer, "weapon", combatant, item)) {
            event.preventDefault();
            return;
          }
          card.classList.add("is-dragging");
        });
        card.addEventListener("dragend", function () {
          card.classList.remove("is-dragging");
        });
      }
      const head = make(doc, "div", "sheet-hand-head");
      head.append(
        make(doc, "span", "sheet-hand-label", label),
        make(
          doc,
          "span",
          "sheet-hand-state",
          item ? (item.type || "item") : "empty",
        ),
      );

      const name = make(
        doc,
        "span",
        "sheet-hand-name" + (item ? "" : " is-empty"),
        item ? item.name || item.id : "Свободна",
      );
      card.append(head, name);

      if (item) {
        const actions = make(doc, "div", "sheet-hand-actions");
        const stow = make(doc, "button", "sheet-button sheet-button-small", "Stow");
        stow.type = "button";
        stow.disabled = !active || !canSpend;
        stow.title = "Interact: stow this item · 1 action";
        stow.addEventListener(
          "click",
          function () {
            this.onInteract(combatant, "stow", { slot: slot });
          }.bind(this),
        );

        const drop = make(doc, "button", "sheet-button sheet-button-small", "Drop");
        drop.type = "button";
        drop.disabled = !active;
        drop.title = "Interact: drop this item · free action";
        drop.addEventListener(
          "click",
          function () {
            this.onInteract(combatant, "drop", { slot: slot });
          }.bind(this),
        );

        actions.append(stow, drop, this.makeRemoveButton(combatant, item));
        card.append(actions);
      }
      return card;
    }

    makeRemoveButton(combatant, item) {
      const button = make(
        this.document,
        "button",
        "sheet-button sheet-button-small sheet-button-danger sheet-item-remove",
        "✖",
      );
      button.type = "button";
      button.title = "Удалить предмет: " + (item.name || item.id);
      button.setAttribute(
        "aria-label",
        "Удалить предмет " + (item.name || item.id),
      );
      button.addEventListener(
        "click",
        function (event) {
          if (event && event.preventDefault) {
            event.preventDefault();
          }
          this.onRemoveItem(combatant, item);
          this.render();
        }.bind(this),
      );
      return button;
    }

    renderShield(combatant) {
      const doc = this.document;
      const shield =
        typeof combatant.getShield === "function"
          ? combatant.getShield()
          : combatant.shield;
      this.shieldCard.replaceChildren();

      if (!shield) {
        this.shieldCard.classList.add("is-empty");
        this.shieldCard.append(
          make(doc, "h4", "sheet-section-title", "Щит"),
          make(doc, "span", "sheet-empty", "Щит не экипирован."),
        );
        return;
      }
      this.shieldCard.classList.remove("is-empty");

      const state =
        typeof combatant.getShieldState === "function"
          ? combatant.getShieldState()
          : null;
      const hp = state ? state.hp : shield.hp;
      const maxHP = state ? state.maxHP : shield.maxHP;
      const hardness = state ? state.hardness : shield.hardness;
      const brokenThreshold = state ? state.brokenThreshold : shield.brokenThreshold;
      const broken = state ? state.broken : shield.broken;
      const destroyed = state ? state.destroyed : shield.destroyed;
      const held =
        typeof combatant.isItemHeld === "function"
          ? combatant.isItemHeld(shield)
          : true;
      const raised =
        typeof combatant.hasCondition === "function" &&
        combatant.hasCondition("shield-raised");

      const head = make(doc, "div", "sheet-shield-head");
      const headInfo = make(doc, "div", "sheet-shield-head-info");
      headInfo.append(
        make(doc, "span", "sheet-shield-name", state ? state.name : shield.name),
        make(
          doc,
          "span",
          "sheet-shield-state",
          destroyed ? "Destroyed" : broken ? "Broken" : raised ? "Raised" : held ? "Held" : "Stowed",
        ),
      );
      head.append(headInfo, this.makeRemoveButton(combatant, shield));

      const stats = make(doc, "div", "sheet-shield-stats");
      const statEntries = [
        ["Hardness", String(hardness)],
        ["HP", hp + " / " + maxHP],
        ["BT", String(brokenThreshold)],
        ["AC", "+" + (state ? state.effectiveACBonus : shield.acBonus || 0)],
      ];
      for (const entry of statEntries) {
        const cell = make(doc, "div", "sheet-shield-stat");
        cell.append(
          make(doc, "span", "sheet-shield-stat-label", entry[0]),
          make(doc, "span", "sheet-shield-stat-value", entry[1]),
        );
        stats.append(cell);
      }

      const badges = make(doc, "div", "sheet-badge-row");
      if (broken) {
        badges.append(make(doc, "span", "sheet-badge sheet-badge-danger", "Broken"));
      }
      if (destroyed) {
        badges.append(make(doc, "span", "sheet-badge sheet-badge-danger", "Destroyed"));
      }
      if (raised) {
        badges.append(make(doc, "span", "sheet-badge sheet-badge-accent", "Shield Raised"));
      }
      if (!held && !destroyed) {
        badges.append(make(doc, "span", "sheet-badge", "Draw to wield"));
      }

      const blockRow = make(doc, "div", "sheet-shield-block");
      const damageInput = make(doc, "input", "sheet-shield-damage");
      damageInput.type = "number";
      damageInput.min = "1";
      damageInput.step = "1";
      damageInput.placeholder = "dmg";
      damageInput.title = "Incoming physical damage for the Shield Block reaction";
      damageInput.setAttribute("aria-label", "Incoming damage for Shield Block");

      const typeSelect = make(doc, "select", "sheet-shield-type");
      for (const type of ["bludgeoning", "piercing", "slashing"]) {
        const option = make(doc, "option", "", capitalize(type));
        option.value = type;
        typeSelect.append(option);
      }
      typeSelect.title = "Incoming physical damage type";

      const eligibility =
        typeof combatant.canShieldBlock === "function"
          ? combatant.canShieldBlock()
          : { ok: false, reason: "no-shield" };
      const blockable = eligibility.ok === true && held;

      const blockButton = make(
        doc,
        "button",
        "sheet-button sheet-button-accent sheet-shield-block-button",
        "Shield Block",
      );
      blockButton.type = "button";
      blockButton.disabled = !blockable;
      blockButton.title = blockable
        ? "Spend 1 reaction: Hardness absorbs damage, the shield and wielder split the rest"
        : this.shieldBlockReasonText(eligibility.reason, held);
      blockButton.addEventListener(
        "click",
        function () {
          const damage = Number.parseInt(damageInput.value, 10);
          if (!Number.isInteger(damage) || damage < 1) {
            damageInput.classList.add("is-invalid");
            this.onLog("Shield Block needs a positive whole number of damage.", "warn");
            return;
          }
          damageInput.classList.remove("is-invalid");
          this.onShieldBlock(combatant, {
            damage: damage,
            damageType: typeSelect.value || "bludgeoning",
          });
          damageInput.value = "";
        }.bind(this),
      );

      blockRow.append(damageInput, typeSelect, blockButton);
      this.shieldCard.append(head, stats, badges, blockRow);
    }

    shieldBlockReasonText(reason, held) {
      if (!held) {
        return "Draw the shield before using Shield Block.";
      }
      switch (reason) {
        case "shield-not-raised":
          return "Raise the Shield first.";
        case "no-reaction":
          return "No reaction remains.";
        case "shield-broken":
        case "shield-destroyed":
          return "The shield is broken and cannot block.";
        case "no-shield":
          return "No shield is equipped.";
        default:
          return "Shield Block is not currently available.";
      }
    }

    renderSpells(combatant) {
      const doc = this.document;
      const active = this.canAct(combatant);
      const canSpend = this.hasActions(combatant, 1);
      const round = this.getRound(combatant);

      this.resourceList.replaceChildren();
      const slots =
        typeof combatant.getSpellSlots === "function"
          ? combatant.getSpellSlots()
          : combatant.spellSlots || {};
      const ranks = Object.keys(slots)
        .map(function (key) {
          return Number.parseInt(key, 10);
        })
        .filter(function (value) {
          return Number.isInteger(value);
        })
        .sort(function (a, b) {
          return a - b;
        });

      if (ranks.length === 0) {
        this.resourceList.append(
          make(doc, "span", "sheet-empty", "Нет слотов заклинаний."),
        );
      } else {
        for (const rank of ranks) {
          const slot = slots[rank];
          const chip = make(doc, "div", "sheet-resource");
          chip.append(
            make(doc, "span", "sheet-resource-label", "Ранг " + rank),
            make(
              doc,
              "span",
              "sheet-resource-value",
              "[" + slot.current + " / " + slot.max + "]",
            ),
          );
          chip.classList.toggle("is-empty", slot.current <= 0);
          this.resourceList.append(chip);
        }
      }

      const focus =
        typeof combatant.getFocusPoints === "function"
          ? combatant.getFocusPoints()
          : combatant.focusPoints || null;
      if (focus && focus.max > 0) {
        const chip = make(doc, "div", "sheet-resource");
        chip.append(
          make(doc, "span", "sheet-resource-label", "Focus Points"),
          make(
            doc,
            "span",
            "sheet-resource-value",
            "[" + focus.current + " / " + focus.max + "]",
          ),
        );
        chip.classList.toggle("is-empty", focus.current <= 0);
        this.resourceList.append(chip);
      }

      const sustained =
        typeof combatant.getActiveSustainedSpells === "function"
          ? combatant.getActiveSustainedSpells()
          : Array.isArray(combatant.activeSustainedSpells)
            ? combatant.activeSustainedSpells
            : [];

      this.sustainedList.replaceChildren();
      if (sustained.length === 0) {
        this.sustainedSection.hidden = true;
      } else {
        this.sustainedSection.hidden = false;
        for (const entry of sustained) {
          const row = make(doc, "div", "sheet-sustained-row");
          const name = entry.spell ? entry.spell.name : entry.spellId || "Spell";
          const expires = Number.isInteger(entry.expiresAtRound)
            ? entry.expiresAtRound
            : null;
          const roundsLeft =
            expires === null ? null : Math.max(0, expires - (Number(round) || 0));
          const info = make(doc, "div", "sheet-sustained-info");
          info.append(
            make(doc, "span", "sheet-item-name", name),
            make(
              doc,
              "span",
              "sheet-item-sub",
              expires === null
                ? "sustained"
                : "until end of round " +
                  expires +
                  " · " +
                  (roundsLeft <= 0 ? "expires now" : roundsLeft + " round(s) left"),
            ),
          );

          const sustain = make(doc, "button", "sheet-button sheet-button-small", "Sustain");
          sustain.type = "button";
          sustain.disabled = !active || !canSpend;
          sustain.title = active
            ? "Spend 1 action to extend this spell by one round"
            : "Only the active combatant can Sustain a Spell";
          sustain.addEventListener(
            "click",
            function () {
              this.onSustain(combatant, entry.id);
            }.bind(this),
          );
          row.append(info, sustain);
          this.sustainedList.append(row);
        }
      }

      this.spellList.replaceChildren();
      const spells = Array.isArray(combatant.spells) ? combatant.spells : [];
      if (spells.length === 0) {
        this.spellList.append(
          make(doc, "span", "sheet-empty", "У персонажа нет заклинаний."),
        );
      } else {
        for (const spell of spells) {
          this.spellList.append(this.renderSpellRow(combatant, spell, active, canSpend, round));
        }
      }

      this.spellsNote.textContent = active
        ? "Cast готовит заклинание и включает режим размещения на карте. Attack-заклинания требуют цель; area-заклинания — точку начала шаблона."
        : "Только активный боец может Cast и Sustain.";
    }

    renderSpellRow(combatant, spell, active, canSpend, round) {
      const doc = this.document;
      const row = make(doc, "div", "sheet-spell-row");
      row.draggable = true;
      row.classList.add("is-hotbar-source");
      row.title =
        "Перетащите " +
        (spell.name || spell.id) +
        " в слот хотбара для быстрого каста";
      row.addEventListener("dragstart", function (event) {
        if (!writeHotbarDrag(event.dataTransfer, "spell", combatant, spell)) {
          event.preventDefault();
          return;
        }
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", function () {
        row.classList.remove("is-dragging");
      });
      const meta = make(doc, "div", "sheet-spell-meta");

      const cost = Number.isInteger(spell.cost) ? spell.cost : 2;
      const rank = Number.isInteger(spell.rank)
        ? spell.rank
        : Number.isInteger(spell.level)
          ? spell.level
          : null;
      const subtitleParts = [
        cost + " action" + (cost === 1 ? "" : "s"),
        spell.type === "attack" ? "Attack" : "Save",
      ];
      if (rank !== null) {
        subtitleParts.push("Rank " + rank);
      } else if (hasTrait(spell, "cantrip")) {
        subtitleParts.push("Cantrip");
      }
      if (spell.area) {
        subtitleParts.push(spell.area.type || "area");
      }

      const titleRow = make(doc, "div", "sheet-spell-title");
      titleRow.append(make(doc, "span", "sheet-item-name", spell.name || spell.id));
      if (hasTrait(spell, "sustained")) {
        titleRow.append(make(doc, "span", "sheet-badge sheet-badge-accent", "sustained"));
      }

      meta.append(
        titleRow,
        make(doc, "span", "sheet-item-sub", subtitleParts.join(" · ")),
      );

      const traits = traitSlugs(spell).filter(function (trait) {
        return trait !== "" && trait !== "sustained";
      });
      if (traits.length > 0) {
        const traitRow = make(doc, "div", "sheet-trait-row");
        for (const trait of traits) {
          traitRow.append(make(doc, "span", "sheet-trait", trait));
        }
        meta.append(traitRow);
      }

      const sustainedInstances =
        typeof combatant.getActiveSustainedSpells === "function"
          ? combatant.getActiveSustainedSpells().filter(function (entry) {
              return (
                entry.spellId === spell.id ||
                (entry.spell && entry.spell.id === spell.id)
              );
            })
          : [];
      if (sustainedInstances.length > 0) {
        const expires = sustainedInstances[0].expiresAtRound;
        const left = Number.isInteger(expires)
          ? Math.max(0, expires - (Number(round) || 0))
          : null;
        meta.append(
          make(
            doc,
            "span",
            "sheet-spell-active",
            "Active" +
              (Number.isInteger(expires)
                ? " · ends round " + expires + (left === 0 ? " (now)" : " (" + left + " left)")
                : ""),
          ),
        );
      }

      const controls = make(doc, "div", "sheet-spell-controls");
      const castButton = make(doc, "button", "sheet-button sheet-button-accent", "Cast");
      castButton.type = "button";

      let hasResource = true;
      if (hasTrait(spell, "focus")) {
        hasResource =
          typeof combatant.hasFocusPoint === "function"
            ? combatant.hasFocusPoint()
            : true;
      } else if (rank !== null && rank > 0) {
        hasResource =
          typeof combatant.hasSpellSlot === "function"
            ? combatant.hasSpellSlot(rank)
            : true;
      }

      const hasAction = this.hasActions(combatant, cost);
      castButton.disabled = !active || !hasAction || !hasResource;
      castButton.title = !active
        ? "Only the active combatant can Cast"
        : !hasAction
          ? "Not enough actions"
          : !hasResource
            ? "No slot or Focus Point of the required rank"
            : "Prepare " + (spell.name || spell.id) + " for casting";
      castButton.addEventListener(
        "click",
        function () {
          this.onCast(combatant, spell);
        }.bind(this),
      );
      controls.append(castButton);
      row.append(meta, controls);
      return row;
    }

    // --------------------------------------------------------------- HP edit

    handleHpKeyDown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        this.applyHpInput();
      }
    }

    applyHpInput() {
      const combatant = this.combatantId ? this.getCombatant(this.combatantId) : null;
      if (!combatant) {
        return;
      }
      const parsed = parseHpInput(this.hpInput.value);
      if (!parsed) {
        this.markHpInvalid();
        this.onLog("HP input must be a whole number, +N to heal, or -N to damage.", "warn");
        return;
      }

      const current = combatant.currentHP;
      let delta;
      if (parsed.sign === "+") {
        delta = parsed.amount;
      } else if (parsed.sign === "-") {
        delta = -parsed.amount;
      } else {
        delta = parsed.amount - current;
      }

      if (delta === 0) {
        this.hpInput.value = String(current);
        return;
      }

      if (delta > 0) {
        const result = combatant.applyHealing(delta);
        if (!result || result.ok === false) {
          this.markHpInvalid();
          this.onLog(
            combatant.name + " cannot regain HP right now.",
            "warn",
          );
          return;
        }
        const healed = Number.isInteger(result.healed) ? result.healed : delta;
        if (typeof combatant.emitEvent === "function") {
          combatant.emitEvent("combatant:healed", {
            amount: healed,
            healed: healed,
            currentHP: result.currentHP,
            maxHP: combatant.maxHP,
            wokeUp: result.wokeUp === true,
            source: this.HP_SOURCE,
          });
        }
        this.onLog(
          "[SHEET] " +
            combatant.name +
            " regains " +
            healed +
            " HP (HP " +
            current +
            " -> " +
            combatant.currentHP +
            "/" +
            combatant.maxHP +
            ")" +
            (result.wokeUp ? " and wakes up" : "") +
            ".",
          "info",
        );
      } else {
        const result = combatant.takeDamage(-delta, {
          applyIWR: false,
          shieldBlock: false,
          source: this.HP_SOURCE,
        });
        if (result.damageTaken === 0) {
          this.onLog(combatant.name + " has no HP left to lose.", "muted");
        }
      }

      this.hpInput.classList.remove("is-invalid");
      this.hpInput.value = String(combatant.currentHP);
      this.onHpChange(combatant, {
        source: this.HP_SOURCE,
        before: current,
        after: combatant.currentHP,
        delta: combatant.currentHP - current,
      });
      this.render();
      if (this.document.activeElement === this.hpInput) {
        this.hpInput.select();
      }
    }

    markHpInvalid() {
      this.hpInput.classList.remove("is-invalid");
      // Restart the CSS shake animation for repeated invalid input.
      void this.hpInput.offsetWidth;
      this.hpInput.classList.add("is-invalid");
      const combatant = this.combatantId ? this.getCombatant(this.combatantId) : null;
      if (combatant) {
        this.hpInput.value = String(combatant.currentHP);
      }
    }

    // ---------------------------------------------------------------- cleanup

    handleKeyDown(event) {
      if (event.key === "Escape" && this.isOpen) {
        event.preventDefault();
        this.close();
      }
    }

    destroy() {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      this.handlePointerUp();
      this.header.removeEventListener("pointerdown", this.handlePointerDown);
      this.window.removeEventListener("dragover", this.handleDragOver);
      this.window.removeEventListener("dragleave", this.handleDragLeave);
      this.window.removeEventListener("drop", this.handleDrop);
      for (const unsubscribe of this.unsubscribers) {
        unsubscribe();
      }
      this.unsubscribers = [];
      if (this.window.parentNode) {
        this.window.parentNode.removeChild(this.window);
      }
      this.combatantId = null;
    }
  }

  NS.View.CharacterSheet = CharacterSheet;
})(typeof globalThis !== "undefined" ? globalThis : this);
