/**
 * PF2E REMASTERED — BATTLEFIELD VIEW
 * Composes grid, difficult terrain, obstacles, tokens, hover routes, and click
 * input. Rules math and action resolution live in PF2e.Core; this layer renders
 * and emits intents (select token, request Stride / Step / Strike).
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const Grid = NS.Core.Grid;
  const Pathfinding = NS.Core.Pathfinding;
  const Step = NS.Core.Actions.Step;
  const Strike = NS.Core.Actions.Strike;
  const POLICY = Pathfinding.DIAGONAL_CORNER_POLICIES;

  const MODES = Object.freeze({
    STRIDE: "stride",
    STEP: "step",
    STRIKE: "strike",
  });

  function allianceOf(combatant) {
    return combatant.alliance === undefined ? "player" : combatant.alliance;
  }

  function stepReasonText(reason) {
    switch (reason) {
      case Step.STEP_REASONS.DIFFICULT_TERRAIN:
        return "Difficult terrain";
      case Step.STEP_REASONS.DESTINATION_OCCUPIED:
        return "Square occupied";
      case Step.STEP_REASONS.NOT_ADJACENT:
        return "Not adjacent";
      case Step.STEP_REASONS.CORNER_BLOCKED:
        return "Corner blocked";
      case Step.STEP_REASONS.BLOCKED_DESTINATION:
        return "Blocked";
      case Step.STEP_REASONS.NO_ACTIONS:
        return "No actions";
      default:
        return "Cannot Step";
    }
  }

  function strikeReasonText(reason) {
    switch (reason) {
      case Strike.STRIKE_REASONS.OUT_OF_REACH:
        return "Out of reach";
      case Strike.STRIKE_REASONS.NO_LINE_OF_SIGHT:
        return "No line of sight";
      case Strike.STRIKE_REASONS.ALLY:
        return "Ally";
      case Strike.STRIKE_REASONS.NO_ACTIONS:
        return "No actions";
      case Strike.STRIKE_REASONS.INVALID_TARGET:
        return "Invalid target";
      default:
        return "Cannot Strike";
    }
  }

  class BattlefieldView {
    constructor(options) {
      const opts = options || {};

      if (!opts.canvas) {
        throw new Error("BattlefieldView requires a canvas element.");
      }
      if (!Array.isArray(opts.combatants)) {
        throw new Error("BattlefieldView requires a combatants array.");
      }
      if (!opts.map || typeof opts.map.isBlocked !== "function") {
        throw new Error("BattlefieldView requires a GridMap.");
      }

      this.canvas = opts.canvas;
      this.ctx = this.canvas.getContext("2d");
      if (!this.ctx) {
        throw new Error("Canvas 2D context is unavailable.");
      }

      this.map = opts.map;
      this.cols = this.map.cols;
      this.rows = this.map.rows;
      this.grid = new NS.View.GridView({
        cols: this.cols,
        rows: this.rows,
        cellSize: opts.cellSize,
      });

      this.combatants = opts.combatants;
      this.getColor =
        typeof opts.getColor === "function"
          ? opts.getColor
          : function () {
              return "#8a94a3";
            };
      this.getOccupancy =
        typeof opts.getOccupancy === "function"
          ? opts.getOccupancy
          : function () {
              return { blockedCells: [], passThroughCells: [] };
            };

      this.tokenViews = this.combatants.map(
        function (combatant) {
          return new NS.View.TokenView(combatant, this.grid, this.getColor(combatant));
        }.bind(this),
      );

      this.cornerPolicy = opts.diagonalCornerPolicy || POLICY.BLOCK_ANY;
      this.mode = MODES.STRIDE;
      this.activeCombatantId = opts.activeCombatantId || null;
      this.selectedCombatant = null;
      this.reachable = [];
      this.strikeTargets = [];

      this.hover = null;
      this.hoverKey = null;
      this.hoverInfo = null;
      this.hoverPath = null;

      this.onSelectionChange =
        typeof opts.onSelectionChange === "function" ? opts.onSelectionChange : function () {};
      this.onStrideRequest =
        typeof opts.onStrideRequest === "function" ? opts.onStrideRequest : function () {};
      this.onStepRequest =
        typeof opts.onStepRequest === "function" ? opts.onStepRequest : function () {};
      this.onStrikeRequest =
        typeof opts.onStrikeRequest === "function" ? opts.onStrikeRequest : function () {};
      this.onHoverChange =
        typeof opts.onHoverChange === "function" ? opts.onHoverChange : function () {};
      this.onInactiveToken =
        typeof opts.onInactiveToken === "function" ? opts.onInactiveToken : function () {};

      this.handleClick = this.handleClick.bind(this);
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseLeave = this.handleMouseLeave.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);

      this.canvas.addEventListener("click", this.handleClick);
      this.canvas.addEventListener("mousemove", this.handleMouseMove);
      this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
      root.addEventListener("keydown", this.handleKeyDown);

      this.resize();
    }

    resize() {
      const dpr = Math.max(1, Math.min(2, root.devicePixelRatio || 1));
      this.canvas.width = Math.round(this.grid.width * dpr);
      this.canvas.height = Math.round(this.grid.height * dpr);
      this.canvas.style.aspectRatio = this.grid.width + " / " + this.grid.height;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.render();
    }

    getReachableCells() {
      return this.reachable;
    }

    getStrikeTargets() {
      return this.strikeTargets;
    }

    getSelectedCombatant() {
      return this.selectedCombatant;
    }

    getMode() {
      return this.mode;
    }

    setMode(mode) {
      if (mode !== MODES.STRIDE && mode !== MODES.STEP && mode !== MODES.STRIKE) {
        throw new RangeError("Unknown action mode: " + String(mode) + ".");
      }
      if (this.mode === mode) {
        return;
      }
      this.mode = mode;
      this.resetHover();
      this.refreshReachable();
      this.render();
    }

    setActiveCombatant(id) {
      const combatant = this.combatants.find(function (candidate) {
        return candidate.id === id;
      });
      this.activeCombatantId = combatant ? combatant.id : null;

      if (this.selectedCombatant && this.selectedCombatant.id !== this.activeCombatantId) {
        this.clearSelection();
      } else {
        this.refreshReachable();
        this.render();
      }
    }

    getActiveCombatant() {
      const id = this.activeCombatantId;
      return this.combatants.find(function (candidate) {
        return candidate.id === id;
      }) || null;
    }

    findCombatantAtCell(cell) {
      return this.combatants.find(function (combatant) {
        return combatant.x === cell.x && combatant.y === cell.y;
      }) || null;
    }

    refreshReachable() {
      this.strikeTargets = [];

      if (!this.selectedCombatant) {
        this.reachable = [];
        return;
      }

      const combatant = this.selectedCombatant;
      const occupancy = this.getOccupancy(combatant);

      if (this.mode === MODES.STEP) {
        this.reachable = Step.getStepDestinations({
          combatant: combatant,
          map: this.map,
          occupancy: occupancy,
          diagonalCornerPolicy: this.cornerPolicy,
        });
        return;
      }

      if (this.mode === MODES.STRIKE) {
        const map = this.map;
        const combatants = this.combatants;
        this.reachable = [];
        this.strikeTargets = this.combatants
          .filter(function (candidate) {
            if (candidate.id === combatant.id) {
              return false;
            }
            return Strike.evaluateStrike({
              attacker: combatant,
              target: candidate,
              map: map,
              allies: combatants,
            }).ok;
          })
          .map(function (candidate) {
            return { x: candidate.x, y: candidate.y };
          });
        return;
      }

      this.reachable = Pathfinding.reachableCells(
        this.map,
        { x: combatant.x, y: combatant.y },
        combatant.speedFeet,
        {
          startDiagonalParity: combatant.diagonalParity,
          diagonalCornerPolicy: this.cornerPolicy,
          occupancy: occupancy,
        },
      );
    }

    selectCombatant(id) {
      const combatant = this.combatants.find(function (candidate) {
        return candidate.id === id;
      });
      if (!combatant) {
        return false;
      }
      if (this.activeCombatantId && combatant.id !== this.activeCombatantId) {
        this.onInactiveToken(combatant);
        return false;
      }

      this.resetHover();
      this.selectedCombatant = combatant;
      this.refreshReachable();
      this.render();
      this.onSelectionChange(combatant, this.reachable);
      return true;
    }

    clearSelection() {
      if (!this.selectedCombatant) {
        return;
      }
      this.selectedCombatant = null;
      this.reachable = [];
      this.strikeTargets = [];
      this.resetHover();
      this.render();
      this.onSelectionChange(null, []);
    }

    /** Recompute state after an external core action, e.g. a successful action. */
    refresh() {
      this.resetHover();
      this.refreshReachable();
      this.render();
    }

    resetHover() {
      const hadHover = this.hoverKey !== null || this.hoverInfo !== null;
      this.hover = null;
      this.hoverKey = null;
      this.hoverInfo = null;
      this.hoverPath = null;
      if (hadHover) {
        this.onHoverChange(null);
      }
    }

    eventPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return null;
      }
      return {
        x: ((event.clientX - rect.left) / rect.width) * this.grid.width,
        y: ((event.clientY - rect.top) / rect.height) * this.grid.height,
      };
    }

    findTokenAt(px, py) {
      for (let i = this.tokenViews.length - 1; i >= 0; i -= 1) {
        if (this.tokenViews[i].hitTest(px, py)) {
          return this.tokenViews[i].token;
        }
      }
      return null;
    }

    handleClick(event) {
      const point = this.eventPoint(event);
      if (!point) {
        return;
      }
      const cell = this.grid.cellAtPoint(point.x, point.y);
      if (!cell) {
        return;
      }

      const token = this.findTokenAt(point.x, point.y);

      if (this.mode === MODES.STRIKE) {
        if (!this.selectedCombatant) {
          return;
        }
        if (token && token.id !== this.selectedCombatant.id) {
          this.resetHover();
          this.onStrikeRequest(this.selectedCombatant, token);
          this.render();
        } else if (token && token.id === this.selectedCombatant.id) {
          this.clearSelection();
        }
        return;
      }

      if (token) {
        if (!this.activeCombatantId || token.id !== this.activeCombatantId) {
          this.onInactiveToken(token);
          return;
        }
        if (this.selectedCombatant && this.selectedCombatant.id === token.id) {
          this.clearSelection();
        } else {
          this.selectCombatant(token.id);
        }
        return;
      }

      if (!this.selectedCombatant) {
        return;
      }
      if (
        cell.x === this.selectedCombatant.x &&
        cell.y === this.selectedCombatant.y
      ) {
        this.clearSelection();
        return;
      }

      this.resetHover();
      if (this.mode === MODES.STEP) {
        this.onStepRequest(this.selectedCombatant, cell);
      } else {
        this.onStrideRequest(this.selectedCombatant, cell);
      }
      this.render();
    }

    handleMouseMove(event) {
      const point = this.eventPoint(event);
      if (!point) {
        return;
      }
      const cell = this.grid.cellAtPoint(point.x, point.y);
      if (!cell) {
        this.setHover(null);
        return;
      }
      this.setHover(cell);
    }

    handleMouseLeave() {
      this.setHover(null);
    }

    handleKeyDown(event) {
      if (event.key === "Escape" && this.selectedCombatant) {
        this.clearSelection();
      }
    }

    setHover(cell) {
      const key = cell ? cell.x + "," + cell.y : null;
      if (key === this.hoverKey) {
        return;
      }

      this.hoverKey = key;
      this.hover = cell;
      this.hoverInfo = null;
      this.hoverPath = null;

      if (!cell) {
        this.onHoverChange(null);
        this.render();
        return;
      }

      const label = Grid.gridToLabel(cell);

      if (!this.selectedCombatant) {
        this.hoverInfo = { status: "no-selection", cell: cell, label: label };
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      const combatant = this.selectedCombatant;
      const occupant = this.findCombatantAtCell(cell);
      const occupancy = this.getOccupancy(combatant);
      const isOrigin = cell.x === combatant.x && cell.y === combatant.y;

      if (this.mode === MODES.STRIKE) {
        if (occupant && occupant.id !== combatant.id) {
          const evaluation = Strike.evaluateStrike({
            attacker: combatant,
            target: occupant,
            map: this.map,
            allies: this.combatants,
          });
          this.hoverInfo = {
            status: "strike",
            cell: cell,
            label: label,
            combatant: combatant,
            target: occupant,
            valid: evaluation.ok,
            reason: evaluation.reason || null,
            distanceFeet: evaluation.distanceFeet,
            flanked: evaluation.flanked === true,
            offGuard: evaluation.offGuard === true,
            flankers: evaluation.flankers || [],
          };
        } else {
          this.hoverInfo = {
            status: "strike-empty",
            cell: cell,
            label: label,
            combatant: combatant,
          };
        }
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      if (this.mode === MODES.STEP) {
        const evaluation = Step.evaluateStep({
          combatant: combatant,
          map: this.map,
          destination: cell,
          occupancy: occupancy,
          diagonalCornerPolicy: this.cornerPolicy,
        });
        if (evaluation.ok) {
          this.hoverPath = [
            { x: combatant.x, y: combatant.y },
            { x: cell.x, y: cell.y },
          ];
        }
        this.hoverInfo = {
          status: "step",
          cell: cell,
          label: label,
          combatant: combatant,
          valid: evaluation.ok,
          reason: evaluation.reason || null,
          costFeet: evaluation.ok ? 5 : null,
        };
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      if (occupant && occupant.id !== combatant.id) {
        const hostile = allianceOf(occupant) !== allianceOf(combatant);
        this.hoverInfo = {
          status: hostile ? "occupied-enemy" : "occupied-ally",
          cell: cell,
          label: label,
          combatant: combatant,
          occupant: occupant,
        };
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      if (this.map.isBlocked(cell.x, cell.y)) {
        this.hoverInfo = { status: "blocked", cell: cell, label: label, combatant: combatant };
      } else if (isOrigin) {
        this.hoverInfo = { status: "origin", cell: cell, label: label, combatant: combatant };
      } else {
        const pathResult = Pathfinding.findPath(
          { x: combatant.x, y: combatant.y },
          cell,
          {
            map: this.map,
            startDiagonalParity: combatant.diagonalParity,
            diagonalCornerPolicy: this.cornerPolicy,
            occupancy: occupancy,
          },
        );

        if (!pathResult.found) {
          this.hoverInfo = {
            status: "no-path",
            cell: cell,
            label: label,
            combatant: combatant,
            reason: pathResult.reason,
          };
        } else {
          const tooFar = pathResult.costFeet > combatant.speedFeet;
          const noActions = combatant.actionsRemaining < 1;
          const affordable = !tooFar && !noActions;
          this.hoverPath = pathResult.path;
          this.hoverInfo = {
            status: "path",
            cell: cell,
            label: label,
            combatant: combatant,
            path: pathResult.path,
            costFeet: pathResult.costFeet,
            affordable: affordable,
            reason: tooFar ? "exceeds-speed" : noActions ? "no-actions" : null,
            difficultTerrain:
              typeof this.map.hasDifficultTerrain === "function" &&
              this.map.hasDifficultTerrain(cell.x, cell.y),
            startLabel: Grid.gridToLabel(combatant),
            destinationLabel: label,
          };
        }
      }

      this.onHoverChange(this.hoverInfo);
      this.render();
    }

    drawHoverOverlay(ctx) {
      if (!this.hoverInfo || this.hoverInfo.status === "no-selection") {
        return;
      }

      const info = this.hoverInfo;

      if (info.status === "strike") {
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        if (info.valid && info.flanked) {
          this.grid.drawFlankedCell(ctx, info.cell);
        }
        this.grid.drawLineOfSight(ctx, info.combatant, info.target, info.valid);
        this.grid.drawPathLabel(
          ctx,
          info.cell,
          info.valid
            ? info.flanked
              ? "Strike · " + info.distanceFeet + " ft · FLANKED (-2 AC)"
              : "Strike · " + info.distanceFeet + " ft"
            : strikeReasonText(info.reason),
          info.valid ? (info.flanked ? "flank" : "valid") : "invalid",
        );
        return;
      }

      if (info.status === "strike-empty") {
        return;
      }

      if (info.status === "step") {
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        if (this.hoverPath) {
          this.grid.drawPath(ctx, this.hoverPath, info.valid);
        }
        this.grid.drawPathLabel(
          ctx,
          info.cell,
          info.valid ? "Step · 5 ft" : stepReasonText(info.reason),
          info.valid ? "valid" : "invalid",
        );
        return;
      }

      let valid = true;
      let text = null;
      let labelKind = "valid";

      if (info.status === "blocked") {
        valid = false;
        text = "Blocked";
        labelKind = "blocked";
      } else if (info.status === "occupied-enemy") {
        valid = false;
        text = "Enemy";
        labelKind = "blocked";
      } else if (info.status === "occupied-ally") {
        valid = false;
        text = "Ally";
        labelKind = "blocked";
      } else if (info.status === "no-path") {
        valid = false;
        text = "No path";
        labelKind = "blocked";
      } else if (info.status === "path") {
        valid = info.affordable;
        text = info.costFeet + " ft";
        if (info.difficultTerrain) {
          text += " · difficult";
        }
        if (info.reason === "exceeds-speed") {
          text += " · Too far";
        } else if (info.reason === "no-actions") {
          text += " · No actions";
        }
        labelKind = valid ? "valid" : "invalid";
      }

      if (info.status !== "origin") {
        this.grid.drawHoverCell(ctx, info.cell, valid);
      }
      if (this.hoverPath) {
        this.grid.drawPath(ctx, this.hoverPath, valid);
      }
      if (text) {
        this.grid.drawPathLabel(ctx, info.cell, text, labelKind);
      }
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.grid.width, this.grid.height);
      this.grid.draw(ctx);

      const difficultCells =
        typeof this.map.getDifficultTerrainCells === "function"
          ? this.map.getDifficultTerrainCells()
          : [];
      if (difficultCells.length > 0) {
        this.grid.drawDifficultTerrain(ctx, difficultCells);
      }

      if (this.reachable.length > 0) {
        this.grid.drawReachable(ctx, this.reachable);
      }
      if (this.strikeTargets.length > 0) {
        this.grid.drawStrikeTargets(ctx, this.strikeTargets);
      }

      this.grid.drawObstacles(ctx, this.map.getBlockedCells());

      this.drawHoverOverlay(ctx);

      // Draw the selected token last so its ring stays visible.
      const selectedId = this.selectedCombatant ? this.selectedCombatant.id : null;
      const ordered = this.tokenViews.slice().sort(function (a, b) {
        const aSelected = a.token.id === selectedId ? 1 : 0;
        const bSelected = b.token.id === selectedId ? 1 : 0;
        return aSelected - bSelected;
      });

      for (const tokenView of ordered) {
        tokenView.draw(ctx, tokenView.token.id === selectedId);
      }
    }

    destroy() {
      this.canvas.removeEventListener("click", this.handleClick);
      this.canvas.removeEventListener("mousemove", this.handleMouseMove);
      this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
      root.removeEventListener("keydown", this.handleKeyDown);
    }
  }

  NS.View.BattlefieldView = BattlefieldView;
  NS.View.ACTION_MODES = MODES;
})(typeof globalThis !== "undefined" ? globalThis : this);
