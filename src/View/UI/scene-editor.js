/**
 * PF2E REMASTERED — SCENE EDITOR TOOLBAR (VIEW)
 *
 * Presentation shell for the Phase 24 battlefield editor:
 *   - scene preset selector (Default Encounter / Empty Arena)
 *   - terrain/wall brush buttons
 *   - "Очистить поле боя" button with a Foundry-style confirmation modal
 *
 * The component only reads the DOM and forwards intents. Map mutation and
 * encounter rebuilding stay in the application entry point, which delegates
 * all rules state to the headless core.
 *
 * Markup contract:
 *   <div data-scene-editor>
 *     <select data-scene-preset>...</select>
 *     <button data-painter="wall">...</button>
 *     <button data-clear-board>...</button>
 *   </div>
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const PAINT_TOOL_IDS = Object.freeze([
    "select",
    "wall",
    "difficult",
    "greater-difficult",
    "hazardous",
    "illumination",
  ]);

  const CLEAR_BOARD_MESSAGE =
    "Вы уверены, что хотите очистить поле боя? Все бойцы, стены и зоны ландшафта будут удалены.";

  function normalizeTool(value) {
    const tool = value === undefined || value === null ? "" : String(value);
    return PAINT_TOOL_IDS.indexOf(tool) === -1 ? null : tool;
  }

  class SceneEditor {
    constructor(options) {
      const opts = options || {};
      this.root = opts.root;
      if (!this.root) {
        throw new Error("SceneEditor requires a root element.");
      }

      this.dialog = opts.dialog || null;
      this.onPresetChange =
        typeof opts.onPresetChange === "function" ? opts.onPresetChange : function () {};
      this.onToolChange =
        typeof opts.onToolChange === "function" ? opts.onToolChange : function () {};
      this.onClearBoard =
        typeof opts.onClearBoard === "function" ? opts.onClearBoard : function () {};

      this.presetSelect =
        opts.presetSelect || this.root.querySelector("[data-scene-preset]");
      this.clearButton =
        opts.clearButton || this.root.querySelector("[data-clear-board]");
      this.brushButtons = Array.from(
        this.root.querySelectorAll("[data-painter]"),
      );
      this.activeTool = "select";

      this.handlePresetChange = this.handlePresetChange.bind(this);
      this.handleClearClick = this.handleClearClick.bind(this);
      this.handleBrushClick = this.handleBrushClick.bind(this);

      if (this.presetSelect) {
        this.presetSelect.addEventListener("change", this.handlePresetChange);
      }
      if (this.clearButton) {
        this.clearButton.addEventListener("click", this.handleClearClick);
      }
      for (const button of this.brushButtons) {
        button.addEventListener("click", this.handleBrushClick);
      }

      this.setTool("select", { silent: true });
    }

    getPreset() {
      return this.presetSelect ? this.presetSelect.value : null;
    }

    setPreset(presetId) {
      if (!this.presetSelect) {
        return false;
      }
      const id = presetId === undefined || presetId === null ? "" : String(presetId);
      const option = Array.from(this.presetSelect.options).find(function (entry) {
        return entry.value === id;
      });
      if (!option) {
        return false;
      }
      this.presetSelect.value = id;
      return true;
    }

    getTool() {
      return this.activeTool;
    }

    setTool(tool, options) {
      const opts = options || {};
      const id = normalizeTool(tool) || "select";
      this.activeTool = id;

      for (const button of this.brushButtons) {
        const active = button.dataset.painter === id;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }

      if (!opts.silent) {
        this.onToolChange(id);
      }
      return id;
    }

    handlePresetChange(event) {
      const value = event && event.target ? event.target.value : this.getPreset();
      this.onPresetChange(value);
    }

    handleBrushClick(event) {
      const button = event.currentTarget;
      if (!button) {
        return;
      }
      this.setTool(button.dataset.painter);
    }

    handleClearClick() {
      if (this.dialog && typeof this.dialog.open === "function") {
        this.dialog.open({
          title: "Очистить поле боя?",
          message: CLEAR_BOARD_MESSAGE,
          confirmLabel: "Да",
          cancelLabel: "Нет",
          onConfirm: this.onClearBoard,
        });
        return;
      }
      this.onClearBoard();
    }

    destroy() {
      if (this.presetSelect) {
        this.presetSelect.removeEventListener("change", this.handlePresetChange);
      }
      if (this.clearButton) {
        this.clearButton.removeEventListener("click", this.handleClearClick);
      }
      for (const button of this.brushButtons) {
        button.removeEventListener("click", this.handleBrushClick);
      }
      this.brushButtons = [];
    }
  }

  NS.View.SceneEditor = SceneEditor;
  NS.View.SCENE_PRESETS = Object.freeze({
    DEFAULT: "default",
    EMPTY: "empty",
  });
  NS.View.CLEAR_BOARD_MESSAGE = CLEAR_BOARD_MESSAGE;
})(typeof globalThis !== "undefined" ? globalThis : this);
