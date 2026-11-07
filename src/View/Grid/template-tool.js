/**
 * PF2E REMASTERED — MEASURED TEMPLATE TOOL (VIEW)
 *
 * Foundry-style measured templates for burst, cone, and line areas. This module
 * only computes and draws the template: it uses the headless Core AoE geometry
 * for cells and the host callback for the actual saving throws/damage.
 *
 * The overlay is a transparent canvas positioned over the battlefield canvas.
 * It never mutates the map, tokens, or rules state.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const TOOL_VALUES = Object.freeze(["burst", "cone", "line"]);
  const TOOL_LABELS = Object.freeze({
    burst: "Burst",
    cone: "Cone",
    line: "Line",
  });
  const TOOL_ICONS = Object.freeze({
    burst: "⭕",
    cone: "📐",
    line: "📏",
  });
  const SIZE_OPTIONS = Object.freeze({
    burst: Object.freeze([5, 10, 15, 20, 30]),
    cone: Object.freeze([15, 30]),
    line: Object.freeze([30, 60]),
  });
  const DEFAULT_SIZES = Object.freeze({
    burst: 20,
    cone: 15,
    line: 30,
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

  function copyCell(cell) {
    return cell ? { x: cell.x, y: cell.y } : null;
  }

  function cellKey(cell) {
    return cell.x + "," + cell.y;
  }

  function livingCombatant(combatant) {
    if (!combatant) {
      return false;
    }
    if (combatant.isDefeated === true) {
      return false;
    }
    if (Number.isInteger(combatant.currentHP) && combatant.currentHP <= 0) {
      return false;
    }
    return true;
  }

  function occupiedCells(combatant) {
    if (combatant && typeof combatant.getOccupiedCells === "function") {
      return combatant.getOccupiedCells();
    }
    if (combatant && Number.isInteger(combatant.x) && Number.isInteger(combatant.y)) {
      return [{ x: combatant.x, y: combatant.y }];
    }
    return [];
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  class TemplateTool {
    constructor(options) {
      const opts = options || {};
      if (!opts.canvas) {
        throw new Error("TemplateTool requires a battlefield canvas.");
      }
      this.canvas = opts.canvas;
      this.container = opts.container || this.canvas.parentElement;
      this.toolbar = opts.toolbar || null;
      this.document = this.canvas.ownerDocument || root.document;

      this.getGrid =
        typeof opts.getGrid === "function"
          ? opts.getGrid
          : function () {
              return null;
            };
      this.getMap =
        typeof opts.getMap === "function"
          ? opts.getMap
          : function () {
              return null;
            };
      this.getCombatants =
        typeof opts.getCombatants === "function"
          ? opts.getCombatants
          : function () {
              return [];
            };
      this.getTokenViews =
        typeof opts.getTokenViews === "function"
          ? opts.getTokenViews
          : function () {
              return [];
            };
      this.getSpellcasters =
        typeof opts.getSpellcasters === "function"
          ? opts.getSpellcasters
          : function () {
              return [];
            };
      this.getSpells =
        typeof opts.getSpells === "function"
          ? opts.getSpells
          : function () {
              return [];
            };
      this.onApply =
        typeof opts.onApply === "function" ? opts.onApply : function () {};
      this.onActiveChange =
        typeof opts.onActiveChange === "function"
          ? opts.onActiveChange
          : function () {};
      this.onStateChange =
        typeof opts.onStateChange === "function"
          ? opts.onStateChange
          : function () {};
      this.onLog =
        typeof opts.onLog === "function" ? opts.onLog : function () {};

      this.AoE = NS.Core && NS.Core.Grid ? NS.Core.Grid.AoE : null;

      this.activeTool = null;
      this.sizeFeet = DEFAULT_SIZES.burst;
      this.fixed = null;
      this.preview = null;
      this.cursorCell = null;
      this.casterId = null;
      this.spellId = null;
      this.wasActive = false;

      this.buildOverlay();
      this.collectToolbar();
      this.bindToolbar();
      this.bindCanvas();
      this.refreshAll();
    }

    buildOverlay() {
      const overlay = this.document.createElement("canvas");
      overlay.className = "template-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.hidden = true;
      this.container.append(overlay);
      this.overlay = overlay;
      this.ctx = overlay.getContext("2d");
    }

    collectToolbar() {
      if (!this.toolbar) {
        return;
      }
      this.toolButtons = Array.from(
        this.toolbar.querySelectorAll("[data-template-tool]"),
      );
      this.sizeSelect = this.toolbar.querySelector("[data-template-size]");
      this.casterSelect = this.toolbar.querySelector("[data-template-caster]");
      this.spellSelect = this.toolbar.querySelector("[data-template-spell]");
      this.applyButton = this.toolbar.querySelector("[data-template-apply]");
      this.clearButton = this.toolbar.querySelector("[data-template-clear]");
    }

    bindToolbar() {
      this.handleToolClick = this.handleToolClick.bind(this);
      this.handleSizeChange = this.handleSizeChange.bind(this);
      this.handleCasterChange = this.handleCasterChange.bind(this);
      this.handleSpellChange = this.handleSpellChange.bind(this);
      this.handleApply = this.handleApply.bind(this);
      this.handleClear = this.handleClear.bind(this);

      for (const button of this.toolButtons || []) {
        button.addEventListener("click", this.handleToolClick);
      }
      if (this.sizeSelect) {
        this.sizeSelect.addEventListener("change", this.handleSizeChange);
      }
      if (this.casterSelect) {
        this.casterSelect.addEventListener("change", this.handleCasterChange);
      }
      if (this.spellSelect) {
        this.spellSelect.addEventListener("change", this.handleSpellChange);
      }
      if (this.applyButton) {
        this.applyButton.addEventListener("click", this.handleApply);
      }
      if (this.clearButton) {
        this.clearButton.addEventListener("click", this.handleClear);
      }
    }

    bindCanvas() {
      this.handleMove = this.handleMove.bind(this);
      this.handleClick = this.handleClick.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleSync = this.handleSync.bind(this);

      this.canvas.addEventListener("pointermove", this.handleMove);
      this.canvas.addEventListener("pointerenter", this.handleMove);
      this.canvas.addEventListener("click", this.handleClick);
      root.addEventListener("resize", this.handleSync);
      root.addEventListener("keydown", this.handleKeyDown);
      if (this.container && this.container.addEventListener) {
        this.container.addEventListener("scroll", this.handleSync, { passive: true });
      }
    }

    isActive() {
      return this.activeTool !== null;
    }

    consumesClicks() {
      return this.isActive();
    }

    consumesHover() {
      return this.isActive();
    }

    getCursor() {
      return this.isActive() ? "crosshair" : null;
    }

    cellFromEvent(event) {
      const grid = this.getGrid();
      if (!grid || !this.canvas.getBoundingClientRect) {
        return null;
      }
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return null;
      }
      const px = ((event.clientX - rect.left) / rect.width) * grid.width;
      const py = ((event.clientY - rect.top) / rect.height) * grid.height;
      return grid.cellAtPoint(px, py);
    }

    selectedToolOption(tool) {
      return TOOL_VALUES.indexOf(tool) === -1 ? null : tool;
    }

    configureSizes(tool, preferred) {
      if (!this.sizeSelect) {
        return;
      }
      const allowed = SIZE_OPTIONS[tool] || SIZE_OPTIONS.burst;
      const previous = Number.isInteger(preferred)
        ? preferred
        : this.sizeFeet;
      this.sizeSelect.replaceChildren();
      for (const size of allowed) {
        const option = this.document.createElement("option");
        option.value = String(size);
        option.textContent = size + " ft";
        this.sizeSelect.append(option);
      }
      const next =
        allowed.indexOf(previous) !== -1
          ? previous
          : DEFAULT_SIZES[tool] || allowed[0];
      this.sizeFeet = next;
      this.sizeSelect.value = String(next);
    }

    setSize(feet) {
      const value = Number(feet);
      const allowed = SIZE_OPTIONS[this.activeTool] || [];
      if (allowed.indexOf(value) === -1) {
        return false;
      }
      this.sizeFeet = value;
      if (this.sizeSelect) {
        this.sizeSelect.value = String(value);
      }
      if (this.fixed && this.fixed.cursor) {
        this.fixed = this.computeTemplate(this.fixed.cursor);
      }
      this.refreshPreview();
      this.render();
      this.syncToolbar();
      this.emitState();
      return true;
    }

    selectTool(tool) {
      const id = this.selectedToolOption(tool);
      if (!id) {
        this.deactivate();
        return null;
      }
      if (this.activeTool === id) {
        this.deactivate();
        return null;
      }
      this.activeTool = id;
      this.fixed = null;
      this.preview = null;
      this.configureSizes(id);
      this.refreshCasters();
      this.overlay.hidden = false;
      this.render();
      this.syncToolbar();
      this.emitState();
      this.notifyActiveChange();
      this.onLog(
        "Шаблон " +
          TOOL_LABELS[id] +
          " активен · " +
          this.sizeFeet +
          " ft. Двигайте мышь и кликните по полю.",
        "muted",
      );
      return id;
    }

    deactivate(options) {
      const opts = options || {};
      const wasActive = this.isActive();
      this.activeTool = null;
      this.fixed = null;
      this.preview = null;
      this.clearOverlay();
      this.syncToolbar();
      this.emitState();
      if (wasActive) {
        this.notifyActiveChange();
        if (!opts.silent) {
          this.onLog("Шаблон снят с поля.", "muted");
        }
      }
    }

    notifyActiveChange() {
      const active = this.isActive();
      if (active === this.wasActive) {
        return;
      }
      this.wasActive = active;
      this.onActiveChange(active);
    }

    clearTemplate() {
      if (!this.fixed && !this.preview) {
        return false;
      }
      this.fixed = null;
      this.preview = null;
      this.render();
      this.syncToolbar();
      this.emitState();
      this.onLog("Шаблон очищен.", "muted");
      return true;
    }

    refreshAll() {
      this.refreshCasters();
      this.syncToolbar();
      if (this.isActive()) {
        this.refreshPreview();
        this.render();
        this.emitState();
      }
    }

    refreshCasters() {
      if (!this.casterSelect) {
        return;
      }
      const casters = this.getSpellcasters() || [];
      const previous =
        this.casterId || (this.casterSelect ? this.casterSelect.value : null);
      this.casterSelect.replaceChildren();
      if (casters.length === 0) {
        const option = this.document.createElement("option");
        option.value = "";
        option.textContent = "Нет кастеров";
        this.casterSelect.append(option);
        this.casterSelect.disabled = true;
        this.casterId = null;
        this.refreshSpells();
        return;
      }
      this.casterSelect.disabled = false;
      for (const caster of casters) {
        const option = this.document.createElement("option");
        option.value = caster.id;
        option.textContent = caster.name;
        this.casterSelect.append(option);
      }
      const match = casters.find(function (caster) {
        return caster.id === previous;
      });
      this.casterId = match ? match.id : casters[0].id;
      this.casterSelect.value = this.casterId;
      this.refreshSpells();
    }

    refreshSpells() {
      if (!this.spellSelect) {
        return;
      }
      const caster = this.getSelectedCaster();
      const spells = caster ? this.getSpells(caster) || [] : [];
      const previous =
        this.spellId || (this.spellSelect ? this.spellSelect.value : null);
      this.spellSelect.replaceChildren();
      if (spells.length === 0) {
        const option = this.document.createElement("option");
        option.value = "";
        option.textContent = caster ? "Нет save-заклинаний" : "Нет кастера";
        this.spellSelect.append(option);
        this.spellSelect.disabled = true;
        this.spellId = null;
        this.syncToolbar();
        return;
      }
      this.spellSelect.disabled = false;
      for (const spell of spells) {
        const option = this.document.createElement("option");
        option.value = spell.id;
        option.textContent =
          (spell.name || spell.id) +
          (spell.saveType ? " · " + spell.saveType : "") +
          (spell.damage && spell.damage.formula ? " · " + spell.damage.formula : "");
        this.spellSelect.append(option);
      }
      const match = spells.find(function (spell) {
        return spell.id === previous;
      });
      this.spellId = match ? match.id : spells[0].id;
      this.spellSelect.value = this.spellId;
      this.syncToolbar();
    }

    getSelectedCaster() {
      if (!this.casterId) {
        return null;
      }
      const casters = this.getSpellcasters() || [];
      return (
        casters.find(
          function (caster) {
            return caster.id === this.casterId;
          }.bind(this),
        ) || null
      );
    }

    getSelectedSpell() {
      const caster = this.getSelectedCaster();
      if (!caster || !this.spellId) {
        return null;
      }
      const spells = this.getSpells(caster) || [];
      return (
        spells.find(
          function (spell) {
            return spell.id === this.spellId;
          }.bind(this),
        ) || null
      );
    }

    targetViewsFor(targets) {
      const views = this.getTokenViews() || [];
      const ids = new Set(
        targets.map(function (target) {
          return target.id;
        }),
      );
      return views.filter(function (view) {
        return view && view.token && ids.has(view.token.id);
      });
    }

    targetsInCells(cells) {
      const keys = new Set(
        cells.map(function (cell) {
          return cellKey(cell);
        }),
      );
      const combatants = this.getCombatants() || [];
      return combatants.filter(function (combatant) {
        if (!livingCombatant(combatant)) {
          return false;
        }
        return occupiedCells(combatant).some(function (cell) {
          return keys.has(cellKey(cell));
        });
      });
    }

    computeTemplate(cell) {
      if (!cell || !this.AoE) {
        return {
          tool: this.activeTool,
          areaType: this.activeTool,
          sizeFeet: this.sizeFeet,
          origin: cell ? copyCell(cell) : null,
          direction: null,
          cells: [],
          targets: [],
          targetViews: [],
          caster: this.getSelectedCaster(),
          cursor: cell ? copyCell(cell) : null,
        };
      }

      const map = this.getMap();
      const caster = this.getSelectedCaster();
      let origin = copyCell(cell);
      let direction = null;
      let cells = [];

      if (this.activeTool === "burst") {
        cells = this.AoE.getBurstCells(cell, this.sizeFeet, map);
      } else {
        origin = caster
          ? { x: caster.x, y: caster.y }
          : copyCell(cell);
        const dx = cell.x - origin.x;
        const dy = cell.y - origin.y;
        if (dx !== 0 || dy !== 0) {
          direction = this.AoE.normalizeDirection({ x: dx, y: dy });
          if (this.activeTool === "cone") {
            cells = this.AoE.getConeCells(origin, direction, this.sizeFeet, map);
          } else {
            cells = this.AoE.getLineCells(origin, direction, this.sizeFeet, 5, map);
          }
        }
      }

      const targets = this.targetsInCells(cells);
      return {
        tool: this.activeTool,
        areaType: this.activeTool,
        sizeFeet: this.sizeFeet,
        origin: origin,
        direction: direction,
        cells: cells,
        targets: targets,
        targetViews: this.targetViewsFor(targets),
        caster: caster,
        cursor: copyCell(cell),
      };
    }

    refreshPreview() {
      if (!this.isActive()) {
        this.preview = null;
        return null;
      }
      const cell = this.cursorCell;
      this.preview = cell ? this.computeTemplate(cell) : null;
      return this.preview;
    }

    handleToolClick(event) {
      const button = event.currentTarget;
      if (!button) {
        return;
      }
      this.selectTool(button.dataset.templateTool);
    }

    handleSizeChange(event) {
      this.setSize(event.target.value);
    }

    handleCasterChange(event) {
      this.casterId = event.target.value || null;
      this.spellId = null;
      this.refreshSpells();
      this.cursorCell = this.fixed && this.fixed.cursor ? this.fixed.cursor : this.cursorCell;
      if (this.fixed && this.fixed.cursor) {
        this.fixed = this.computeTemplate(this.fixed.cursor);
      } else {
        this.refreshPreview();
      }
      this.render();
      this.syncToolbar();
      this.emitState();
    }

    handleSpellChange(event) {
      this.spellId = event.target.value || null;
      this.syncToolbar();
      this.emitState();
    }

    handleApply() {
      if (!this.fixed) {
        this.onLog("Сначала разместите шаблон на поле.", "warn");
        return;
      }
      const caster = this.getSelectedCaster();
      const spell = this.getSelectedSpell();
      if (!caster) {
        this.onLog("Выберите кастера для шаблона.", "warn");
        return;
      }
      if (!spell) {
        this.onLog("Выберите save-заклинание с уроном.", "warn");
        return;
      }
      this.onApply(this.fixed, caster, spell, this.fixed.targets || []);
    }

    handleClear() {
      this.clearTemplate();
    }

    handleMove(event) {
      if (!this.isActive()) {
        return;
      }
      const cell = this.cellFromEvent(event);
      if (!cell) {
        return;
      }
      this.cursorCell = copyCell(cell);
      if (this.fixed) {
        // Once fixed, the template stays in place until Apply or Clear.
        this.render();
        return;
      }
      this.preview = this.computeTemplate(cell);
      this.render();
      this.emitState();
    }

    handleClick(event) {
      if (!this.isActive()) {
        return;
      }
      const cell = this.cellFromEvent(event);
      if (!cell) {
        return;
      }
      event.preventDefault();
      const template = this.computeTemplate(cell);
      if (template.cells.length === 0) {
        this.onLog("Шаблон вне области действия — выберите другую клетку.", "warn");
        return;
      }
      this.fixed = template;
      this.preview = template;
      this.render();
      this.syncToolbar();
      this.emitState();
      this.onLog(
        TOOL_LABELS[template.tool] +
          " " +
          template.sizeFeet +
          " ft зафиксирован: " +
          template.cells.length +
          " клеток, " +
          template.targets.length +
          " целей.",
        "info",
      );
    }

    handleKeyDown(event) {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (
        this.document.body &&
        this.document.body.classList.contains("dialog-open")
      ) {
        return;
      }
      if (event.key === "Escape" && this.isActive()) {
        event.preventDefault();
        this.deactivate();
      }
    }

    handleSync() {
      this.render();
    }

    emitState() {
      const state = {
        active: this.isActive(),
        tool: this.activeTool,
        sizeFeet: this.sizeFeet,
        fixed: this.fixed,
        preview: this.preview,
        caster: this.getSelectedCaster(),
        spell: this.getSelectedSpell(),
        cells: this.fixed ? this.fixed.cells : this.preview ? this.preview.cells : [],
        targets: this.fixed
          ? this.fixed.targets || []
          : this.preview
            ? this.preview.targets || []
            : [],
      };
      this.onStateChange(state);
      return state;
    }

    syncToolbar() {
      for (const button of this.toolButtons || []) {
        const active = button.dataset.templateTool === this.activeTool;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
      if (this.sizeSelect) {
        this.sizeSelect.disabled = !this.isActive();
      }
      if (this.casterSelect) {
        this.casterSelect.disabled = !this.isActive() || !this.casterSelect.options.length;
      }
      if (this.spellSelect) {
        this.spellSelect.disabled = !this.isActive() || !this.spellSelect.options.length;
      }
      if (this.applyButton) {
        this.applyButton.disabled =
          !this.fixed || !this.getSelectedCaster() || !this.getSelectedSpell();
      }
      if (this.clearButton) {
        this.clearButton.disabled = !this.fixed;
      }
      if (this.overlay) {
        this.overlay.hidden = !this.isActive();
      }
    }

    syncOverlay() {
      const rect = this.canvas.getBoundingClientRect
        ? this.canvas.getBoundingClientRect()
        : null;
      if (!rect || rect.width === 0 || rect.height === 0) {
        this.overlay.hidden = true;
        return false;
      }
      const containerRect = this.container.getBoundingClientRect
        ? this.container.getBoundingClientRect()
        : { left: 0, top: 0 };
      const scrollLeft = this.container.scrollLeft || 0;
      const scrollTop = this.container.scrollTop || 0;
      const clientLeft = this.container.clientLeft || 0;
      const clientTop = this.container.clientTop || 0;
      const dpr = Math.max(1, Math.min(2, root.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      this.overlay.hidden = false;
      this.overlay.style.left =
        rect.left - containerRect.left - clientLeft + scrollLeft + "px";
      this.overlay.style.top =
        rect.top - containerRect.top - clientTop + scrollTop + "px";
      this.overlay.style.width = rect.width + "px";
      this.overlay.style.height = rect.height + "px";
      if (this.overlay.width !== width) {
        this.overlay.width = width;
      }
      if (this.overlay.height !== height) {
        this.overlay.height = height;
      }
      if (!this.ctx) {
        return false;
      }
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, width, height);
      const grid = this.getGrid();
      if (!grid) {
        return false;
      }
      this.ctx.setTransform(
        (dpr * rect.width) / grid.width,
        0,
        0,
        (dpr * rect.height) / grid.height,
        0,
        0,
      );
      return true;
    }

    clearOverlay() {
      if (!this.overlay) {
        return;
      }
      this.overlay.hidden = true;
      if (this.ctx) {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      }
    }

    render() {
      if (!this.isActive()) {
        this.clearOverlay();
        return;
      }
      if (!this.syncOverlay()) {
        return;
      }
      const template = this.fixed || this.preview;
      const grid = this.getGrid();
      const ctx = this.ctx;
      if (!template || !grid || !ctx) {
        return;
      }
      const cells = template.cells || [];
      if (cells.length === 0) {
        return;
      }

      grid.drawAoeCells(ctx, cells, template.areaType || template.tool);
      if (this.fixed) {
        // Draw the fixed template a second time with a stronger outline.
        grid.drawAoeCells(ctx, cells, template.areaType || template.tool);
        const views = template.targetViews || [];
        if (views.length > 0) {
          grid.drawAoeTargets(ctx, views);
        }
      }

      if (template.origin && (template.tool === "cone" || template.tool === "line")) {
        const origin = grid.cellCenter(template.origin.x, template.origin.y);
        ctx.save();
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, grid.cellSize * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 236, 176, 0.95)";
        ctx.fill();
        ctx.strokeStyle = "rgba(8, 11, 15, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      this.drawLabel(template, grid, ctx);
    }

    drawLabel(template, grid, ctx) {
      const cell = template.cursor || template.origin;
      if (!cell) {
        return;
      }
      const rect = grid.cellRect(cell.x, cell.y);
      let text =
        (TOOL_ICONS[template.tool] ? TOOL_ICONS[template.tool] + " " : "") +
        TOOL_LABELS[template.tool] +
        " " +
        template.sizeFeet +
        " ft";
      if (template.cells && template.cells.length > 0) {
        text += " · " + template.cells.length + " cells";
      }
      const targets = template.targets || [];
      if (targets.length > 0) {
        text += " · " + targets.length + " targets";
      }
      if (this.fixed) {
        text += " · FIXED";
      }

      const height = 22;
      ctx.save();
      ctx.font = "600 11px 'Segoe UI', 'Inter', system-ui, sans-serif";
      const width = ctx.measureText(text).width + 18;
      let x = rect.x + rect.width / 2 - width / 2;
      let y = rect.y - height - 7;
      if (y < 3) {
        y = rect.y + rect.height + 7;
      }
      x = Math.max(3, Math.min(grid.width - width - 3, x));
      y = Math.max(3, Math.min(grid.height - height - 3, y));

      roundedRect(ctx, x, y, width, height, 6);
      ctx.fillStyle = "rgba(9, 14, 18, 0.92)";
      ctx.fill();
      ctx.strokeStyle = this.fixed
        ? "rgba(255, 184, 110, 0.95)"
        : "rgba(126, 216, 255, 0.85)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = this.fixed ? "#ffd9a3" : "#c7efff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
      ctx.restore();
    }

    getState() {
      return {
        active: this.isActive(),
        tool: this.activeTool,
        sizeFeet: this.sizeFeet,
        fixed: this.fixed,
        preview: this.preview,
        caster: this.getSelectedCaster(),
        spell: this.getSelectedSpell(),
      };
    }

    destroy() {
      for (const button of this.toolButtons || []) {
        button.removeEventListener("click", this.handleToolClick);
      }
      if (this.sizeSelect) {
        this.sizeSelect.removeEventListener("change", this.handleSizeChange);
      }
      if (this.casterSelect) {
        this.casterSelect.removeEventListener("change", this.handleCasterChange);
      }
      if (this.spellSelect) {
        this.spellSelect.removeEventListener("change", this.handleSpellChange);
      }
      if (this.applyButton) {
        this.applyButton.removeEventListener("click", this.handleApply);
      }
      if (this.clearButton) {
        this.clearButton.removeEventListener("click", this.handleClear);
      }
      this.canvas.removeEventListener("pointermove", this.handleMove);
      this.canvas.removeEventListener("pointerenter", this.handleMove);
      this.canvas.removeEventListener("click", this.handleClick);
      root.removeEventListener("resize", this.handleSync);
      root.removeEventListener("keydown", this.handleKeyDown);
      if (this.container && this.container.removeEventListener) {
        this.container.removeEventListener("scroll", this.handleSync);
      }
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
    }
  }

  TemplateTool.TOOL_VALUES = TOOL_VALUES;
  TemplateTool.SIZE_OPTIONS = SIZE_OPTIONS;
  TemplateTool.TOOL_LABELS = TOOL_LABELS;
  NS.View.TemplateTool = TemplateTool;
})(typeof globalThis !== "undefined" ? globalThis : this);
