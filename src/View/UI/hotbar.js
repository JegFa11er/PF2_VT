/**
 * PF2E REMASTERED — FOUNDRY-STYLE MACRO HOTBAR (VIEW)
 *
 * The bottom hotbar is a presentation-only macro palette. It never spends an
 * action or mutates a combatant directly: activating a slot forwards the bound
 * intent to the host, which calls the existing Core action contracts.
 *
 * Slots 1-9 and 0 are shown. When the active combatant changes, slots are
 * auto-filled with the basic actions available to that combatant:
 *
 *   1 Stride            2 Step             3 Strike (current MAP)
 *   4 Raise a Shield    5 Take Cover       6 Stand (while Prone)
 *   7 Trip              8 Shove            9 Grapple       0 free
 *
 * Dragging a spell or weapon from the character sheet onto a slot stores a
 * per-combatant manual binding. Manual bindings override the auto-filled slot
 * and survive turn changes for that combatant.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const SLOT_COUNT = 10;
  const SLOT_KEYS = Object.freeze([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "0",
  ]);
  const SLOT_CODES = Object.freeze([
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
    "Digit0",
    "Numpad1",
    "Numpad2",
    "Numpad3",
    "Numpad4",
    "Numpad5",
    "Numpad6",
    "Numpad7",
    "Numpad8",
    "Numpad9",
    "Numpad0",
  ]);

  const ACTION_DEFINITIONS = Object.freeze({
    stride: Object.freeze({
      kind: "action",
      id: "stride",
      label: "Stride",
      icon: "🏃",
      hint: "Move up to Speed · 1 action",
    }),
    step: Object.freeze({
      kind: "action",
      id: "step",
      label: "Step",
      icon: "👣",
      hint: "Move exactly 5 ft without provoking · 1 action",
    }),
    strike: Object.freeze({
      kind: "action",
      id: "strike",
      label: "Strike",
      icon: "⚔️",
      hint: "Attack with the current MAP · 1 action",
    }),
    "raise-shield": Object.freeze({
      kind: "action",
      id: "raise-shield",
      label: "Raise Shield",
      icon: "🛡️",
      hint: "+2 circumstance AC until your next turn · 1 action",
    }),
    "take-cover": Object.freeze({
      kind: "action",
      id: "take-cover",
      label: "Take Cover",
      icon: "🪨",
      hint: "+4 circumstance AC behind cover · 1 action",
    }),
    stand: Object.freeze({
      kind: "action",
      id: "stand",
      label: "Stand",
      icon: "🧍",
      hint: "Remove Prone · 1 action",
    }),
    trip: Object.freeze({
      kind: "action",
      id: "trip",
      label: "Trip",
      icon: "🦵",
      hint: "Athletics vs Reflex DC · 1 action",
    }),
    shove: Object.freeze({
      kind: "action",
      id: "shove",
      label: "Shove",
      icon: "💥",
      hint: "Athletics vs Fortitude DC · 1 action",
    }),
    grapple: Object.freeze({
      kind: "action",
      id: "grapple",
      label: "Grapple",
      icon: "🤜",
      hint: "Athletics vs Fortitude DC · 1 action",
    }),
  });

  function isTypingTarget(target) {
    if (!target) {
      return false;
    }
    if (target.isContentEditable === true) {
      return true;
    }
    const tag = String(target.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function readHotbarDrag(dataTransfer) {
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
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      return null;
    }
    if (!payload || !payload.entry) {
      return null;
    }
    if (payload.type === "hotbar-binding") {
      if (payload.kind !== "spell" && payload.kind !== "weapon") {
        return null;
      }
      return payload;
    }
    if (payload.type === "compendium-item") {
      if (payload.category === "spells") {
        return {
          type: "hotbar-binding",
          kind: "spell",
          entry: payload.entry,
        };
      }
      if (payload.category === "weapons" || payload.category === "shields") {
        return {
          type: "hotbar-binding",
          kind: "weapon",
          entry: payload.entry,
        };
      }
    }
    return null;
  }

  function normalizeSpellBinding(entry, combatantId) {
    const spell = entry || {};
    return {
      kind: "spell",
      id: String(spell.id || spell.name || "spell"),
      name: String(spell.name || spell.id || "Spell"),
      icon: "✨",
      hint:
        "Cast " +
        String(spell.name || spell.id || "spell") +
        (Number.isInteger(spell.cost) ? " · " + spell.cost + " action(s)" : ""),
      combatantId: combatantId || null,
      entry: spell,
    };
  }

  function normalizeWeaponBinding(entry, combatantId) {
    const item = entry || {};
    return {
      kind: "weapon",
      id: String(item.id || item.name || "weapon"),
      name: String(item.name || item.id || "Weapon"),
      icon: item.type === "shield" ? "🛡️" : "⚔️",
      hint: "Strike with " + String(item.name || item.id || "weapon"),
      combatantId: combatantId || null,
      entry: item,
    };
  }

  function mapPenaltyText(combatant) {
    if (!combatant || typeof combatant.getMultipleAttackPenalty !== "function") {
      return "MAP 0";
    }
    const value = combatant.getMultipleAttackPenalty();
    return "MAP " + (value === 0 ? "0" : String(value));
  }

  class Hotbar {
    constructor(options) {
      const opts = options || {};
      this.document = opts.document || root.document;
      if (!this.document) {
        throw new Error("Hotbar requires a document.");
      }

      this.layer = opts.layer || this.document.getElementById("hotbar");
      if (!this.layer) {
        this.layer = this.document.createElement("div");
        this.layer.id = "hotbar";
        this.layer.className = "hotbar-layer";
        this.document.body.append(this.layer);
      }

      this.getActiveCombatant =
        typeof opts.getActiveCombatant === "function"
          ? opts.getActiveCombatant
          : function () {
              return null;
            };
      this.getContext =
        typeof opts.getContext === "function"
          ? opts.getContext
          : function () {
              return {};
            };
      this.onActivate =
        typeof opts.onActivate === "function" ? opts.onActivate : function () {};
      this.onLog =
        typeof opts.onLog === "function" ? opts.onLog : function () {};

      this.slots = new Array(SLOT_COUNT).fill(null);
      /** @type {Map<string, Map<number, object>>} */
      this.manualByCombatant = new Map();
      this.activeCombatantId = null;
      this.slotElements = [];

      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleDragOver = this.handleDragOver.bind(this);
      this.handleDragLeave = this.handleDragLeave.bind(this);
      this.handleDrop = this.handleDrop.bind(this);

      this.build();
      this.bind();
      this.refresh();
    }

    build() {
      const doc = this.document;
      this.bar = doc.createElement("div");
      this.bar.className = "hotbar";
      this.bar.setAttribute("role", "toolbar");
      this.bar.setAttribute("aria-label", "Foundry macro hotbar");
      this.bar.setAttribute(
        "aria-keyshortcuts",
        "1 2 3 4 5 6 7 8 9 0",
      );

      this.caption = doc.createElement("span");
      this.caption.className = "hotbar-caption";
      this.caption.textContent = "Быстрые действия";
      this.bar.append(this.caption);

      this.slotsRoot = doc.createElement("div");
      this.slotsRoot.className = "hotbar-slots";
      this.bar.append(this.slotsRoot);

      for (let index = 0; index < SLOT_COUNT; index += 1) {
        const slot = doc.createElement("button");
        slot.type = "button";
        slot.className = "hotbar-slot is-empty";
        slot.dataset.slot = String(index);
        slot.setAttribute("aria-label", "Слот " + SLOT_KEYS[index]);
        slot.title = "Пустой слот " + SLOT_KEYS[index];

        const key = doc.createElement("span");
        key.className = "hotbar-key";
        key.textContent = SLOT_KEYS[index];
        key.setAttribute("aria-hidden", "true");

        const icon = doc.createElement("span");
        icon.className = "hotbar-icon";
        icon.textContent = "+";
        icon.setAttribute("aria-hidden", "true");

        const name = doc.createElement("span");
        name.className = "hotbar-name";
        name.textContent = "Empty";

        slot.append(key, icon, name);
        slot.addEventListener(
          "click",
          function (event) {
            event.preventDefault();
            this.activateSlot(index);
          }.bind(this),
        );
        slot.addEventListener(
          "contextmenu",
          function (event) {
            event.preventDefault();
            this.clearSlot(index);
          }.bind(this),
        );
        slot.addEventListener("dragover", this.handleDragOver);
        slot.addEventListener("dragleave", this.handleDragLeave);
        slot.addEventListener("drop", this.handleDrop);

        this.slotsRoot.append(slot);
        this.slotElements.push({ button: slot, icon: icon, name: name });
      }

      this.layer.append(this.bar);
    }

    bind() {
      this.document.addEventListener("keydown", this.handleKeyDown);
    }

    isModalOpen() {
      return Boolean(
        this.document.body &&
          this.document.body.classList.contains("dialog-open"),
      );
    }

    handleKeyDown(event) {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (this.isModalOpen() || isTypingTarget(event.target)) {
        return;
      }
      let index = -1;
      const key = String(event.key || "");
      if (SLOT_KEYS.indexOf(key) !== -1) {
        index = SLOT_KEYS.indexOf(key);
      } else {
        const code = String(event.code || "");
        if (SLOT_CODES.indexOf(code) !== -1) {
          index = SLOT_CODES.indexOf(code) % SLOT_COUNT;
        }
      }
      if (index === -1) {
        return;
      }
      event.preventDefault();
      this.activateSlot(index);
    }

    getManualMap(combatantId) {
      let map = this.manualByCombatant.get(combatantId);
      if (!map) {
        map = new Map();
        this.manualByCombatant.set(combatantId, map);
      }
      return map;
    }

    defaultBinding(index, combatant, context) {
      const ctx = context || {};
      switch (index) {
        case 0:
          return ACTION_DEFINITIONS.stride;
        case 1:
          return ACTION_DEFINITIONS.step;
        case 2:
          return {
            kind: "action",
            id: "strike",
            label: "Strike",
            icon: "⚔️",
            hint: "Strike with " + mapPenaltyText(combatant) + " · 1 action",
          };
        case 3:
          return ctx.shieldAvailable ? ACTION_DEFINITIONS["raise-shield"] : null;
        case 4:
          return ctx.coverAvailable ? ACTION_DEFINITIONS["take-cover"] : null;
        case 5:
          return ctx.prone ? ACTION_DEFINITIONS.stand : null;
        case 6:
          return ACTION_DEFINITIONS.trip;
        case 7:
          return ACTION_DEFINITIONS.shove;
        case 8:
          return ACTION_DEFINITIONS.grapple;
        default:
          return null;
      }
    }

    buildDefaultSlots(combatant) {
      const context = combatant ? this.getContext(combatant) || {} : {};
      const defaults = [];
      for (let index = 0; index < SLOT_COUNT; index += 1) {
        defaults.push(this.defaultBinding(index, combatant, context));
      }
      return defaults;
    }

    refresh() {
      const combatant = this.getActiveCombatant();
      const combatantId = combatant ? combatant.id : null;
      const context = combatant ? this.getContext(combatant) || {} : {};
      const defaults = this.buildDefaultSlots(combatant);
      const manual = combatantId ? this.getManualMap(combatantId) : new Map();

      this.activeCombatantId = combatantId;
      for (let index = 0; index < SLOT_COUNT; index += 1) {
        this.slots[index] = manual.has(index) ? manual.get(index) : defaults[index];
      }

      for (let index = 0; index < SLOT_COUNT; index += 1) {
        this.renderSlot(index, combatant, context);
      }
      return this;
    }

    renderSlot(index, combatant, context) {
      const refs = this.slotElements[index];
      if (!refs) {
        return;
      }
      const binding = this.slots[index];
      const button = refs.button;
      button.classList.toggle("is-empty", !binding);
      button.classList.toggle("is-bound", Boolean(binding));
      button.classList.toggle(
        "is-manual",
        Boolean(
          binding &&
            combatant &&
            this.getManualMap(combatant.id).has(index),
        ),
      );
      button.classList.toggle("is-defeated", Boolean(combatant && combatant.isDefeated));

      if (!binding) {
        refs.icon.textContent = "+";
        refs.name.textContent = "Empty";
        button.title = "Пустой слот " + SLOT_KEYS[index] + " — перетащите заклинание или оружие";
        button.disabled = !combatant;
        button.dataset.binding = "";
        return;
      }

      const hasActions = context.hasActions !== false;
      const canAct = context.canAct !== false;
      refs.icon.textContent = binding.icon || "•";
      refs.name.textContent = binding.label || binding.name || binding.id;
      button.title =
        (binding.label || binding.name || binding.id) +
        (binding.hint ? " · " + binding.hint : "") +
        " [" +
        SLOT_KEYS[index] +
        "]";
      button.disabled = !combatant || !canAct || !hasActions;
      button.dataset.binding = binding.kind + ":" + binding.id;
    }

    activateSlot(index) {
      const binding = this.slots[index];
      const combatant = this.getActiveCombatant();
      if (!combatant) {
        this.onLog("Нет активного бойца для быстрых действий.", "warn");
        return false;
      }
      if (!binding) {
        this.onLog("Слот " + SLOT_KEYS[index] + " пуст.", "muted");
        return false;
      }
      if (combatant.isDefeated === true) {
        this.onLog(combatant.name + " побежден и не может действовать.", "warn");
        return false;
      }
      const context = this.getContext(combatant) || {};
      if (context.canAct === false || context.hasActions === false) {
        this.onLog(combatant.name + " не может использовать слот " + SLOT_KEYS[index] + ".", "warn");
        return false;
      }
      this.onActivate(binding, combatant, index);
      return true;
    }

    bindSlot(index, binding, combatant) {
      if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) {
        return false;
      }
      const active = combatant || this.getActiveCombatant();
      if (!active) {
        this.onLog("Нет активного бойца для привязки слота.", "warn");
        return false;
      }
      let normalized = null;
      if (binding.kind === "spell") {
        normalized = normalizeSpellBinding(binding.entry, active.id);
      } else if (binding.kind === "weapon") {
        normalized = normalizeWeaponBinding(binding.entry, active.id);
      }
      if (!normalized) {
        return false;
      }
      if (binding.combatantId && binding.combatantId !== active.id) {
        this.onLog(
          "Этот предмет принадлежит другому персонажу — выберите его ход.",
          "warn",
        );
        return false;
      }
      this.getManualMap(active.id).set(index, normalized);
      this.refresh();
      this.onLog(
        normalized.name + " привязан к слоту " + SLOT_KEYS[index] + ".",
        "info",
      );
      return true;
    }

    clearSlot(index) {
      const combatant = this.getActiveCombatant();
      if (!combatant || !Number.isInteger(index)) {
        return false;
      }
      const manual = this.getManualMap(combatant.id);
      if (!manual.has(index)) {
        return false;
      }
      const binding = manual.get(index);
      manual.delete(index);
      this.refresh();
      this.onLog(
        "Слот " + SLOT_KEYS[index] + " очищен" + (binding ? " (" + binding.name + ")." : "."),
        "muted",
      );
      return true;
    }

    handleDragOver(event) {
      if (!event.dataTransfer) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const slot = event.currentTarget;
      if (slot && slot.classList) {
        slot.classList.add("is-dragover");
      }
    }

    handleDragLeave(event) {
      const slot = event.currentTarget;
      if (slot && slot.classList) {
        slot.classList.remove("is-dragover");
      }
    }

    handleDrop(event) {
      const slot = event.currentTarget;
      if (slot && slot.classList) {
        slot.classList.remove("is-dragover");
      }
      const payload = readHotbarDrag(event.dataTransfer);
      if (!payload) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const index = Number.parseInt(slot.dataset.slot, 10);
      this.bindSlot(index, payload);
    }

    getBinding(index) {
      return this.slots[index] || null;
    }

    getBindings() {
      return this.slots.slice();
    }

    destroy() {
      this.document.removeEventListener("keydown", this.handleKeyDown);
      if (this.bar && this.bar.parentNode) {
        this.bar.parentNode.removeChild(this.bar);
      }
    }
  }

  NS.View.Hotbar = Hotbar;
  NS.View.HOTBAR_SLOT_KEYS = SLOT_KEYS;
  NS.View.HOTBAR_ACTIONS = ACTION_DEFINITIONS;
})(typeof globalThis !== "undefined" ? globalThis : this);
