/**
 * PF2E REMASTERED — TOKEN HUD & CONDITION PALETTE (VIEW)
 *
 * Foundry-style right-click HUD anchored to the token on the canvas. The HUD
 * is a thin presentation shell: HP changes call the existing Combatant
 * `takeDamage` / `applyHealing` contracts, and conditions are toggled through
 * `addCondition` / `removeCondition`. No rules state is owned here.
 *
 * The palette mirrors the condition slugs already implemented by the headless
 * core. Valued conditions (Frightened, Stunned, Slowed) use left click to add
 * or increment and right click to decrement or remove. Every other condition
 * toggles on left click and is removed on right click.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const PALETTE_CONDITIONS = Object.freeze([
    { slug: "prone", short: "Pr" },
    { slug: "off-guard", short: "Og" },
    { slug: "frightened", short: "Fr" },
    { slug: "shield-raised", short: "Sr" },
    { slug: "greater-cover", short: "Gc" },
    { slug: "concealed", short: "Cn" },
    { slug: "hidden", short: "Hd" },
    { slug: "undetected", short: "Ud" },
    { slug: "grabbed", short: "Gr" },
    { slug: "restrained", short: "Rs" },
    { slug: "immobilized", short: "Im" },
    { slug: "paralyzed", short: "Pz" },
    { slug: "stunned", short: "St" },
    { slug: "slowed", short: "Sl" },
    { slug: "dying", short: "Dy" },
    { slug: "unconscious", short: "Uc" },
  ]);

  const VALUED_CONDITIONS = Object.freeze({
    frightened: true,
    stunned: true,
    slowed: true,
    dying: true,
    wounded: true,
  });

  function definitions() {
    const Conditions = NS.Core && NS.Core.Conditions;
    return Conditions && Conditions.DEFINITIONS ? Conditions.DEFINITIONS : {};
  }

  function conditionDefinition(slug) {
    return definitions()[slug] || null;
  }

  function conditionLabel(slug) {
    const definition = conditionDefinition(slug);
    return definition && definition.label
      ? definition.label
      : slug
          .split("-")
          .map(function (part) {
            return part.charAt(0).toUpperCase() + part.slice(1);
          })
          .join(" ");
  }

  function conditionDescription(slug) {
    const definition = conditionDefinition(slug);
    return definition && definition.description ? definition.description : "";
  }

  function isValued(slug) {
    if (VALUED_CONDITIONS[slug] === true) {
      return true;
    }
    const definition = conditionDefinition(slug);
    return Boolean(definition && definition.valued);
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

  class TokenHud {
    constructor(options) {
      const opts = options || {};
      if (!opts.battlefield || !opts.canvas) {
        throw new Error("TokenHud requires a battlefield and a canvas element.");
      }

      this.battlefield = opts.battlefield;
      this.canvas = opts.canvas;
      this.container = opts.container || this.canvas.parentElement;
      this.eventBus = opts.eventBus || null;
      this.onStateChange =
        typeof opts.onStateChange === "function" ? opts.onStateChange : function () {};
      this.onLog =
        typeof opts.onLog === "function" ? opts.onLog : function () {};
      this.onSettings =
        typeof opts.onSettings === "function" ? opts.onSettings : function () {};
      this.onDelete =
        typeof opts.onDelete === "function" ? opts.onDelete : function () {};

      this.document = this.canvas.ownerDocument || root.document;
      this.currentCombatant = null;
      this.paletteOpen = false;

      this.handleCanvasClick = this.handleCanvasClick.bind(this);
      this.handleContextMenu = this.handleContextMenu.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleResize = this.handleResize.bind(this);

      this.buildLayer();
      this.buildHud();
      this.bind();
    }

    buildLayer() {
      this.layer = this.document.createElement("div");
      this.layer.className = "token-hud-layer";
      this.container.append(this.layer);
    }

    buildHud() {
      const hud = this.document.createElement("div");
      hud.className = "token-hud";
      hud.setAttribute("role", "dialog");
      hud.setAttribute("aria-label", "Token HUD");
      hud.hidden = true;

      // Right clicks inside the HUD must not open the browser context menu.
      hud.addEventListener("contextmenu", function (event) {
        event.preventDefault();
      });

      const top = this.document.createElement("div");
      top.className = "token-hud-top";

      this.gearButton = this.document.createElement("button");
      this.gearButton.type = "button";
      this.gearButton.className = "token-hud-button token-hud-gear";
      this.gearButton.textContent = "⚙️";
      this.gearButton.title = "Настройки токена";
      this.gearButton.setAttribute("aria-label", "Настройки токена");
      this.gearButton.addEventListener(
        "click",
        function () {
          if (this.currentCombatant) {
            this.onSettings(this.currentCombatant);
          }
        }.bind(this),
      );

      this.nameEl = this.document.createElement("span");
      this.nameEl.className = "token-hud-name";

      this.effectsButton = this.document.createElement("button");
      this.effectsButton.type = "button";
      this.effectsButton.className = "token-hud-button token-hud-effects";
      this.effectsButton.textContent = "🧍";
      this.effectsButton.title = "Палитра состояний";
      this.effectsButton.setAttribute("aria-label", "Палитра состояний");
      this.effectsButton.addEventListener("click", this.togglePalette.bind(this));

      this.deleteButton = this.document.createElement("button");
      this.deleteButton.type = "button";
      this.deleteButton.className = "token-hud-button token-hud-delete";
      this.deleteButton.textContent = "🗑️";
      this.deleteButton.title = "Удалить токен";
      this.deleteButton.setAttribute("aria-label", "Удалить токен");
      this.deleteButton.addEventListener(
        "click",
        function () {
          if (this.currentCombatant) {
            const combatant = this.currentCombatant;
            this.close();
            this.onDelete(combatant);
          }
        }.bind(this),
      );

      top.append(
        this.gearButton,
        this.nameEl,
        this.effectsButton,
        this.deleteButton,
      );

      const bottom = this.document.createElement("div");
      bottom.className = "token-hud-bottom";

      const hpLabel = this.document.createElement("span");
      hpLabel.className = "token-hud-hp-label";
      hpLabel.textContent = "HP";

      this.hpInput = this.document.createElement("input");
      this.hpInput.type = "text";
      this.hpInput.className = "token-hud-hp-input";
      this.hpInput.inputMode = "numeric";
      this.hpInput.autocomplete = "off";
      this.hpInput.spellcheck = false;
      this.hpInput.title =
        "Enter a value to set HP, +N to heal, or -N to damage. Press Enter to apply.";
      this.hpInput.setAttribute(
        "aria-label",
        "Hit points. Enter a value to set HP, +N to heal, or -N to damage.",
      );
      this.hpInput.addEventListener("keydown", this.handleHpKeyDown.bind(this));
      this.hpInput.addEventListener("focus", function () {
        this.hpInput.select();
      });

      this.hpMaxEl = this.document.createElement("span");
      this.hpMaxEl.className = "token-hud-hp-max";

      bottom.append(hpLabel, this.hpInput, this.hpMaxEl);

      this.palette = this.buildPalette();

      hud.append(top, bottom, this.palette);
      this.layer.append(hud);
      this.hud = hud;
    }

    buildPalette() {
      const palette = this.document.createElement("div");
      palette.className = "token-hud-palette";
      palette.hidden = true;
      palette.setAttribute("role", "group");
      palette.setAttribute("aria-label", "Condition palette");

      const head = this.document.createElement("div");
      head.className = "token-hud-palette-head";

      const title = this.document.createElement("span");
      title.textContent = "Conditions";

      const hint = this.document.createElement("span");
      hint.className = "token-hud-palette-hint";
      hint.textContent = "LMB add · RMB remove";

      head.append(title, hint);

      const grid = this.document.createElement("div");
      grid.className = "token-hud-palette-grid";

      this.conditionCells = new Map();

      for (const entry of PALETTE_CONDITIONS) {
        const cell = this.document.createElement("button");
        cell.type = "button";
        cell.className = "condition-cell";
        cell.dataset.condition = entry.slug;
        cell.setAttribute("aria-pressed", "false");
        cell.setAttribute("aria-label", conditionLabel(entry.slug));
        cell.dataset.tooltip = conditionLabel(entry.slug);

        const short = this.document.createElement("span");
        short.className = "condition-cell-short";
        short.textContent = entry.short;

        const value = this.document.createElement("span");
        value.className = "condition-cell-value";

        cell.append(short, value);
        cell.addEventListener("click", this.handleConditionLeft.bind(this, entry.slug));
        cell.addEventListener(
          "contextmenu",
          this.handleConditionRight.bind(this, entry.slug),
        );
        grid.append(cell);
        this.conditionCells.set(entry.slug, { cell: cell, value: value });
      }

      palette.append(head, grid);
      return palette;
    }

    bind() {
      this.canvas.addEventListener("click", this.handleCanvasClick);
      this.canvas.addEventListener("contextmenu", this.handleContextMenu);
      this.document.addEventListener("keydown", this.handleKeyDown);
      root.addEventListener("resize", this.handleResize);
    }

    get isOpen() {
      return this.currentCombatant !== null;
    }

    getCombatantId() {
      return this.currentCombatant ? this.currentCombatant.id : null;
    }

    show(combatant) {
      if (!combatant) {
        this.close();
        return;
      }
      this.currentCombatant = combatant;
      this.hud.hidden = false;
      this.hud.classList.add("is-open");
      this.refresh();
      this.position();
    }

    close() {
      if (!this.isOpen && this.hud.hidden) {
        return;
      }
      this.currentCombatant = null;
      this.paletteOpen = false;
      this.palette.hidden = true;
      this.effectsButton.classList.remove("is-active");
      this.hud.classList.remove("is-open");
      this.hud.hidden = true;
    }

    togglePalette() {
      this.paletteOpen = !this.paletteOpen;
      this.palette.hidden = !this.paletteOpen;
      this.effectsButton.classList.toggle("is-active", this.paletteOpen);
      if (this.paletteOpen) {
        this.refreshConditionCells();
        this.positionPalette();
      }
    }

    /** Re-read combatant state without moving the HUD. Safe to call often. */
    refresh() {
      if (!this.currentCombatant) {
        return;
      }
      const combatant = this.currentCombatant;
      const editing = this.document.activeElement === this.hpInput;

      this.nameEl.textContent = combatant.name;
      this.nameEl.style.color = combatant.isDefeated ? "#9aa3af" : "";
      if (!editing) {
        this.hpInput.value = String(combatant.currentHP);
      }
      this.hpMaxEl.textContent = "/ " + combatant.maxHP;
      this.hpInput.classList.toggle(
        "is-defeated",
        combatant.isDefeated === true || combatant.currentHP <= 0,
      );
      this.refreshConditionCells();
      this.positionPalette();
    }

    refreshConditionCells() {
      if (!this.currentCombatant) {
        return;
      }
      const combatant = this.currentCombatant;
      for (const entry of PALETTE_CONDITIONS) {
        const refs = this.conditionCells.get(entry.slug);
        if (!refs) {
          continue;
        }
        const active =
          typeof combatant.getCondition === "function"
            ? combatant.getCondition(entry.slug)
            : null;
        const valued = isValued(entry.slug);
        const value =
          active && Number.isInteger(active.value) ? active.value : null;
        const label = conditionLabel(entry.slug);
        const description = conditionDescription(entry.slug);
        const activeLabel = active
          ? label + (value === null ? "" : " " + value)
          : label;

        refs.cell.classList.toggle("is-active", Boolean(active));
        refs.cell.classList.toggle("is-valued", valued);
        refs.cell.setAttribute("aria-pressed", active ? "true" : "false");
        refs.cell.dataset.tooltip =
          activeLabel +
          (description ? " — " + description : "") +
          (valued ? " (LMB +1 · RMB −1)" : "");
        refs.value.textContent = value === null ? "" : String(value);
      }
    }

    handleHpKeyDown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        this.applyHpInput();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    }

    applyInputValue(raw) {
      const combatant = this.currentCombatant;
      if (!combatant) {
        return null;
      }
      const parsed = parseHpInput(raw);
      if (!parsed) {
        return { ok: false, reason: "invalid" };
      }

      let delta;
      if (parsed.sign === "+") {
        delta = parsed.amount;
      } else if (parsed.sign === "-") {
        delta = -parsed.amount;
      } else {
        delta = parsed.amount - combatant.currentHP;
      }

      if (delta === 0) {
        return { ok: true, kind: "none", amount: 0 };
      }

      if (delta > 0) {
        const before = combatant.currentHP;
        const result = combatant.applyHealing(delta);
        if (!result || result.ok === false) {
          return { ok: false, reason: result && result.reason ? result.reason : "heal" };
        }
        if (typeof combatant.emitEvent === "function") {
          combatant.emitEvent("combatant:healed", {
            amount: delta,
            healed: result.healed,
            currentHP: result.currentHP,
            maxHP: combatant.maxHP,
            wokeUp: result.wokeUp === true,
            source: "token-hud",
          });
        }
        return {
          ok: true,
          kind: "heal",
          amount: result.healed,
          before: before,
          after: combatant.currentHP,
          wokeUp: result.wokeUp === true,
        };
      }

      const amount = -delta;
      const before = combatant.currentHP;
      // Manual HP adjustment from the HUD is a direct bookkeeping operation:
      // bypass IWR and the automatic Shield Block reaction so an exact number
      // entered by the user is the number applied. The combatant still handles
      // 0 HP, Dying, Unconscious and Prone through its normal pipeline and
      // emits combatant:damaged on the shared bus.
      const result = combatant.takeDamage(amount, {
        applyIWR: false,
        shieldBlock: false,
        source: "token-hud",
      });
      return {
        ok: true,
        kind: "damage",
        amount: result.damageTaken,
        before: before,
        after: combatant.currentHP,
        isDefeated: result.isDefeated === true,
      };
    }

    applyHpInput() {
      const combatant = this.currentCombatant;
      if (!combatant) {
        return;
      }

      const result = this.applyInputValue(this.hpInput.value);
      if (!result || result.ok === false) {
        this.hpInput.classList.remove("is-invalid");
        // Restart the CSS shake animation if the same invalid value is entered
        // twice in a row.
        void this.hpInput.offsetWidth;
        this.hpInput.classList.add("is-invalid");
        this.hpInput.value = String(combatant.currentHP);
        this.onLog(
          "HP input must be a whole number, +N to heal, or -N to damage.",
          "warn",
        );
        return;
      }

      this.hpInput.classList.remove("is-invalid");

      if (result.kind === "heal" && result.amount > 0) {
        this.onLog(
          "[HUD] " +
            combatant.name +
            " regains " +
            result.amount +
            " HP (HP " +
            result.before +
            " -> " +
            result.after +
            "/" +
            combatant.maxHP +
            ")" +
            (result.wokeUp ? " and wakes up" : "") +
            ".",
          "heal",
        );
      } else if (result.kind === "damage") {
        // combatant:damaged already reaches the log through EventLogBridge.
        if (result.amount === 0) {
          this.onLog(
            "[HUD] " + combatant.name + " has no HP left to lose.",
            "muted",
          );
        }
      }

      this.refresh();
      this.hpInput.value = String(combatant.currentHP);
      this.onStateChange(combatant, {
        source: "token-hud",
        kind: result.kind,
        amount: result.amount,
      });
      if (this.document.activeElement === this.hpInput) {
        this.hpInput.select();
      }
    }

    handleConditionLeft(slug, event) {
      event.preventDefault();
      this.applyCondition(slug, false);
    }

    handleConditionRight(slug, event) {
      event.preventDefault();
      this.applyCondition(slug, true);
    }

    applyCondition(slug, decrease) {
      const combatant = this.currentCombatant;
      if (!combatant) {
        return;
      }

      const active =
        typeof combatant.getCondition === "function"
          ? combatant.getCondition(slug)
          : null;
      const valued = isValued(slug);
      const currentValue =
        active && Number.isInteger(active.value) ? active.value : 0;

      if (!valued) {
        if (active) {
          combatant.removeCondition(slug);
        } else if (!decrease) {
          combatant.addCondition(slug);
        }
      } else if (!active) {
        if (!decrease) {
          combatant.addCondition(slug, 1);
        }
      } else if (decrease) {
        if (currentValue <= 1) {
          combatant.removeCondition(slug);
        } else {
          // addCondition only raises valued conditions, so step down through an
          // explicit remove + re-add. Both events remain visible on the bus.
          combatant.removeCondition(slug);
          combatant.addCondition(slug, currentValue - 1);
        }
      } else {
        combatant.addCondition(slug, currentValue + 1);
      }

      this.refresh();
      this.onStateChange(combatant, {
        source: "token-hud-condition",
        condition: slug,
        kind: decrease ? "decrement" : "increment",
      });
    }

    handleCanvasClick(event) {
      if (!this.isOpen) {
        return;
      }
      const point = this.battlefield.eventPoint(event);
      if (!point) {
        this.close();
        return;
      }
      const token = this.battlefield.findTokenAt(point.x, point.y);
      if (!token || token.id !== this.currentCombatant.id) {
        this.close();
      }
    }

    handleContextMenu(event) {
      event.preventDefault();
      const point = this.battlefield.eventPoint(event);
      if (!point) {
        this.close();
        return;
      }
      const token = this.battlefield.findTokenAt(point.x, point.y);
      if (!token) {
        this.close();
        return;
      }
      this.show(token);
    }

    handleKeyDown(event) {
      if (event.key === "Escape" && this.isOpen) {
        this.close();
      }
    }

    handleResize() {
      if (this.isOpen) {
        this.position();
        this.positionPalette();
      }
    }

    findTokenView() {
      if (!this.currentCombatant) {
        return null;
      }
      const id = this.currentCombatant.id;
      return (
        this.battlefield.tokenViews.find(function (view) {
          return view.token.id === id;
        }) || null
      );
    }

    position() {
      const view = this.findTokenView();
      if (!view) {
        this.close();
        return;
      }

      const grid = this.battlefield.grid;
      const canvasRect = this.canvas.getBoundingClientRect();
      const layerRect = this.layer.getBoundingClientRect();
      if (canvasRect.width === 0 || canvasRect.height === 0) {
        return;
      }

      const scaleX = canvasRect.width / grid.width;
      const scaleY = canvasRect.height / grid.height;
      const center = view.center;
      const tokenLeft =
        canvasRect.left - layerRect.left + (center.x - view.footprintSize / 2) * scaleX;
      const tokenTop =
        canvasRect.top - layerRect.top + (center.y - view.footprintSize / 2) * scaleY;
      const tokenRight = tokenLeft + view.footprintSize * scaleX;
      const tokenBottom = tokenTop + view.footprintSize * scaleY;

      const hudWidth = this.hud.offsetWidth || 260;
      const hudHeight = this.hud.offsetHeight || 74;
      const margin = 8;
      const gap = 10;

      let left = (tokenLeft + tokenRight) / 2 - hudWidth / 2;
      let top = tokenTop - hudHeight - gap;

      if (top < margin) {
        top = tokenBottom + gap;
      }

      const maxLeft = Math.max(margin, layerRect.width - hudWidth - margin);
      const maxTop = Math.max(margin, layerRect.height - hudHeight - margin);
      left = Math.max(margin, Math.min(maxLeft, left));
      top = Math.max(margin, Math.min(maxTop, top));

      this.hud.style.left = Math.round(left) + "px";
      this.hud.style.top = Math.round(top) + "px";
    }

    positionPalette() {
      if (!this.paletteOpen || !this.isOpen) {
        return;
      }
      const layerRect = this.layer.getBoundingClientRect();
      const hudRect = this.hud.getBoundingClientRect();
      const paletteWidth = this.palette.offsetWidth || 250;
      const spaceRight = layerRect.right - hudRect.right;
      this.palette.classList.toggle("is-left", spaceRight < paletteWidth + 12);

      // Keep the palette inside the board vertically when the HUD sits near
      // the bottom edge.
      const paletteHeight = this.palette.offsetHeight || 0;
      const overflowBottom =
        hudRect.top + paletteHeight - (layerRect.top + layerRect.height - 6);
      if (overflowBottom > 0) {
        this.palette.style.top = Math.round(-overflowBottom) + "px";
      } else {
        this.palette.style.top = "";
      }
    }

    destroy() {
      this.canvas.removeEventListener("click", this.handleCanvasClick);
      this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
      this.document.removeEventListener("keydown", this.handleKeyDown);
      root.removeEventListener("resize", this.handleResize);
      if (this.layer && this.layer.parentNode) {
        this.layer.parentNode.removeChild(this.layer);
      }
      this.currentCombatant = null;
    }
  }

  NS.View.TokenHud = TokenHud;
  NS.View.PALETTE_CONDITIONS = PALETTE_CONDITIONS;
})(typeof globalThis !== "undefined" ? globalThis : this);
