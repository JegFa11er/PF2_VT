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
  const Trip = NS.Core.Actions.Trip;
  const Shove = NS.Core.Actions.Shove;
  const Grapple = NS.Core.Actions.Grapple;
  const AoE = NS.Core.Grid.AoE;
  const POLICY = Pathfinding.DIAGONAL_CORNER_POLICIES;

  const MODES = Object.freeze({
    STRIDE: "stride",
    STEP: "step",
    STRIKE: "strike",
    TRIP: "trip",
    SHOVE: "shove",
    GRAPPLE: "grapple",
    CAST: "cast",
    SNEAK: "sneak",
  });

  const PAINT_TOOLS = Object.freeze({
    SELECT: "select",
    WALL: "wall",
    DIFFICULT: "difficult",
    GREATER_DIFFICULT: "greater-difficult",
    HAZARDOUS: "hazardous",
    ILLUMINATION: "illumination",
  });

  const PAINT_TOOL_VALUES = Object.freeze([
    PAINT_TOOLS.SELECT,
    PAINT_TOOLS.WALL,
    PAINT_TOOLS.DIFFICULT,
    PAINT_TOOLS.GREATER_DIFFICULT,
    PAINT_TOOLS.HAZARDOUS,
    PAINT_TOOLS.ILLUMINATION,
  ]);

  const SPELL_AREA_TYPES = Object.freeze(["burst", "cone", "line", "emanation"]);

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
      case Strike.STRIKE_REASONS.TARGET_UNDETECTED:
        return "CANNOT TARGET UNDETECTED";
      default:
        return "Cannot Strike";
    }
  }

  function coverLabel(cover) {
    if (!cover || cover.degree === "none" || !cover.acBonus) {
      return null;
    }
    return cover.label.toUpperCase() + " (+" + cover.acBonus + " AC)";
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
      // Phase 24: the terrain brush is a cursor mode layered on top of the
      // action mode. "select" is the normal token/movement cursor.
      this.paintTool = PAINT_TOOLS.SELECT;
      this.activeCombatantId = opts.activeCombatantId || null;
      this.selectedCombatant = null;
      this.reachable = [];
      this.strikeTargets = [];
      this.tripTargets = [];
      this.shoveTargets = [];
      this.grappleTargets = [];
      this.spell = null;
      this.aoeCells = [];
      this.aoeTargets = [];
      // Phase 27/28: ruler and measured-template overlays are external View
      // tools. While one consumes input, the battlefield click/hover handlers
      // stay out of the way; the tool owns the pointer interaction.
      this.externalTool = null;

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
      this.onTripRequest =
        typeof opts.onTripRequest === "function" ? opts.onTripRequest : function () {};
      this.onShoveRequest =
        typeof opts.onShoveRequest === "function" ? opts.onShoveRequest : function () {};
      this.onGrappleRequest =
        typeof opts.onGrappleRequest === "function" ? opts.onGrappleRequest : function () {};
      this.onCastRequest =
        typeof opts.onCastRequest === "function" ? opts.onCastRequest : function () {};
      this.onSneakRequest =
        typeof opts.onSneakRequest === "function" ? opts.onSneakRequest : function () {};
      this.onPaintRequest =
        typeof opts.onPaintRequest === "function" ? opts.onPaintRequest : function () {};
      this.onHoverChange =
        typeof opts.onHoverChange === "function" ? opts.onHoverChange : function () {};
      this.onInactiveToken =
        typeof opts.onInactiveToken === "function" ? opts.onInactiveToken : function () {};
      this.onDropCompendium =
        typeof opts.onDropCompendium === "function"
          ? opts.onDropCompendium
          : function () {};

      this.handleClick = this.handleClick.bind(this);
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseLeave = this.handleMouseLeave.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleDragOver = this.handleDragOver.bind(this);
      this.handleDragLeave = this.handleDragLeave.bind(this);
      this.handleDrop = this.handleDrop.bind(this);

      this.canvas.addEventListener("click", this.handleClick);
      this.canvas.addEventListener("mousemove", this.handleMouseMove);
      this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
      this.canvas.addEventListener("dragover", this.handleDragOver);
      this.canvas.addEventListener("dragleave", this.handleDragLeave);
      this.canvas.addEventListener("drop", this.handleDrop);
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

    getTripTargets() {
      return this.tripTargets;
    }

    getShoveTargets() {
      return this.shoveTargets;
    }

    getGrappleTargets() {
      return this.grappleTargets;
    }

    getSelectedCombatant() {
      return this.selectedCombatant;
    }

    getMode() {
      return this.mode;
    }

    getPaintTool() {
      return this.paintTool;
    }

    setPaintTool(tool) {
      const value = tool === undefined || tool === null ? PAINT_TOOLS.SELECT : String(tool);
      if (PAINT_TOOL_VALUES.indexOf(value) === -1) {
        throw new RangeError("Unknown terrain brush: " + value + ".");
      }
      if (this.paintTool === value) {
        return;
      }
      this.paintTool = value;
      this.aoeCells = [];
      this.aoeTargets = [];
      this.resetHover();
      this.refreshReachable();
      this.render();
    }

    isPainting() {
      return this.paintTool !== PAINT_TOOLS.SELECT;
    }

    /**
     * Attach or detach an external pointer tool (ruler / measured template).
     * The tool may expose consumesClicks(), consumesHover(), and getCursor().
     */
    setExternalTool(tool) {
      const next = tool || null;
      if (this.externalTool === next) {
        return;
      }
      this.externalTool = next;
      const consumesHover = Boolean(
        next &&
          typeof next.consumesHover === "function" &&
          next.consumesHover(),
      );
      if (consumesHover) {
        // The external tool owns the status line while it is active. Clear the
        // battlefield hover state without firing a default status callback.
        this.hover = null;
        this.hoverKey = null;
        this.hoverInfo = null;
        this.hoverPath = null;
        this.render();
        return;
      }
      this.resetHover();
      this.render();
    }

    externalToolConsumesClicks() {
      return Boolean(
        this.externalTool &&
          typeof this.externalTool.consumesClicks === "function" &&
          this.externalTool.consumesClicks(),
      );
    }

    externalToolConsumesHover() {
      return Boolean(
        this.externalTool &&
          typeof this.externalTool.consumesHover === "function" &&
          this.externalTool.consumesHover(),
      );
    }

    getSpell() {
      return this.spell;
    }

    /** Enter Cast a Spell mode with the selected spell definition. */
    setSpell(spell) {
      this.spell = spell || null;
      if (this.spell) {
        this.mode = MODES.CAST;
        this.resetHover();
        this.refreshReachable();
        this.refreshAoe(null);
        this.render();
        return true;
      }
      this.clearSpell();
      return false;
    }

    clearSpell() {
      const wasCast = this.mode === MODES.CAST;
      this.spell = null;
      this.aoeCells = [];
      this.aoeTargets = [];
      if (wasCast) {
        this.mode = MODES.STRIDE;
        this.resetHover();
        this.refreshReachable();
        this.render();
      }
    }

    getAoeCells() {
      return this.aoeCells;
    }

    getAoeTargets() {
      return this.aoeTargets;
    }

    setMode(mode) {
      if (
        mode !== MODES.STRIDE &&
        mode !== MODES.STEP &&
        mode !== MODES.STRIKE &&
        mode !== MODES.TRIP &&
        mode !== MODES.SHOVE &&
        mode !== MODES.GRAPPLE &&
        mode !== MODES.CAST &&
        mode !== MODES.SNEAK
      ) {
        throw new RangeError("Unknown action mode: " + String(mode) + ".");
      }
      if (mode !== MODES.CAST) {
        this.spell = null;
      }
      if (this.mode === mode) {
        return;
      }
      this.mode = mode;
      this.aoeCells = [];
      this.aoeTargets = [];
      this.resetHover();
      this.refreshReachable();
      this.render();
    }

    /**
     * Swap the rendered world after deserialization without replacing the
     * BattlefieldView instance (and therefore its listeners).
     */
    setWorld(combatants, map) {
      if (!Array.isArray(combatants)) {
        throw new TypeError("setWorld requires a combatants array.");
      }
      if (!map || typeof map.isBlocked !== "function") {
        throw new TypeError("setWorld requires a GridMap.");
      }
      const cellSize = this.grid.cellSize;
      this.map = map;
      this.cols = map.cols;
      this.rows = map.rows;
      this.grid = new NS.View.GridView({
        cols: this.cols,
        rows: this.rows,
        cellSize: cellSize,
      });
      this.combatants = combatants;
      this.tokenViews = combatants.map(
        function (combatant) {
          return new NS.View.TokenView(combatant, this.grid, this.getColor(combatant));
        }.bind(this),
      );
      this.activeCombatantId = null;
      this.selectedCombatant = null;
      this.reachable = [];
      this.strikeTargets = [];
      this.tripTargets = [];
      this.shoveTargets = [];
      this.grappleTargets = [];
      this.spell = null;
      this.aoeCells = [];
      this.aoeTargets = [];
      this.mode = MODES.STRIDE;
      this.resetHover();
      this.resize();
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
        if (
          combatant.x === cell.x &&
          combatant.y === cell.y &&
          (typeof combatant.getFootprint !== "function" || combatant.getFootprint() === 1)
        ) {
          return true;
        }
        if (typeof combatant.getOccupiedCells === "function") {
          return combatant.getOccupiedCells().some(function (occupied) {
            return occupied.x === cell.x && occupied.y === cell.y;
          });
        }
        return false;
      }) || null;
    }

    /**
     * Compute the affected cells for the active spell at a hovered origin.
     *
     * @param {{x:number,y:number}|null} originCell
     * @returns {{cells:object[],areaType:string|null}}
     */
    computeSpellArea(originCell) {
      if (!this.spell || !this.spell.area || !this.selectedCombatant) {
        return { cells: [], areaType: null };
      }
      const area = this.spell.area;
      const areaType = String(area.type === undefined ? "burst" : area.type).toLowerCase();
      if (SPELL_AREA_TYPES.indexOf(areaType) === -1) {
        return { cells: [], areaType: areaType };
      }
      const radiusFeet =
        area.radiusFeet !== undefined
          ? area.radiusFeet
          : area.radius !== undefined
            ? area.radius
            : area.lengthFeet !== undefined
              ? area.lengthFeet
              : area.length;
      if (!Number.isInteger(radiusFeet)) {
        return { cells: [], areaType: areaType };
      }

      const caster = this.selectedCombatant;
      if (areaType === "emanation") {
        return {
          cells: AoE.getEmanationCells(caster, radiusFeet, this.map),
          areaType: areaType,
        };
      }

      if (areaType === "burst") {
        if (!originCell) {
          return { cells: [], areaType: areaType };
        }
        return {
          cells: AoE.getBurstCells(originCell, radiusFeet, this.map),
          areaType: areaType,
        };
      }

      if (!originCell) {
        return { cells: [], areaType: areaType };
      }
      const dx = originCell.x - caster.x;
      const dy = originCell.y - caster.y;
      if (dx === 0 && dy === 0) {
        return { cells: [], areaType: areaType };
      }
      const direction = AoE.normalizeDirection({ x: dx, y: dy });
      const origin = { x: caster.x, y: caster.y };
      return {
        cells:
          areaType === "cone"
            ? AoE.getConeCells(origin, direction, radiusFeet, this.map)
            : AoE.getLineCells(
                origin,
                direction,
                radiusFeet,
                area.widthFeet === undefined ? 5 : area.widthFeet,
                this.map,
              ),
        areaType: areaType,
      };
    }

    refreshAoe(originCell) {
      const result = this.computeSpellArea(originCell);
      this.aoeCells = result.cells;
      this.aoeTargets = [];
      if (this.aoeCells.length === 0) {
        return { cells: [], areaType: result.areaType, targets: [] };
      }

      const keys = new Set(
        this.aoeCells.map(function (cell) {
          return cell.x + "," + cell.y;
        }),
      );
      const targets = [];
      for (let index = 0; index < this.tokenViews.length; index += 1) {
        const view = this.tokenViews[index];
        const token = view.token;
        if (!token || token.isDefeated === true) {
          continue;
        }
        const occupied =
          typeof token.getOccupiedCells === "function"
            ? token.getOccupiedCells()
            : [{ x: token.x, y: token.y }];
        const caught = occupied.some(function (cell) {
          return keys.has(cell.x + "," + cell.y);
        });
        if (caught) {
          targets.push(view);
        }
      }
      this.aoeTargets = targets;
      return { cells: this.aoeCells, areaType: result.areaType, targets: targets };
    }

    refreshReachable() {
      this.strikeTargets = [];
      this.tripTargets = [];
      this.shoveTargets = [];
      this.grappleTargets = [];

      if (!this.selectedCombatant) {
        this.reachable = [];
        return;
      }

      const combatant = this.selectedCombatant;
      const occupancy = this.getOccupancy(combatant);

      // Immobilized creatures cannot Stride or Step. This also suppresses the
      // reachable highlights so the board matches the core rule.
      if (
        (this.mode === MODES.STRIDE || this.mode === MODES.STEP) &&
        typeof combatant.isImmobilized === "function" &&
        combatant.isImmobilized()
      ) {
        this.reachable = [];
        return;
      }

      if (this.mode === MODES.CAST) {
        this.reachable = [];
        return;
      }

      if (this.mode === MODES.SNEAK) {
        const halfSpeed = Math.floor(combatant.speedFeet / 10) * 5;
        this.reachable = Pathfinding.reachableCells(
          this.map,
          { x: combatant.x, y: combatant.y },
          halfSpeed,
          {
            startDiagonalParity: combatant.diagonalParity,
            diagonalCornerPolicy: this.cornerPolicy,
            occupancy: occupancy,
          },
        );
        return;
      }

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

      if (this.mode === MODES.TRIP) {
        const map = this.map;
        const combatants = this.combatants;
        this.reachable = [];
        this.tripTargets = this.combatants
          .filter(function (candidate) {
            if (candidate.id === combatant.id) {
              return false;
            }
            return Trip.evaluateTrip({
              attacker: combatant,
              target: candidate,
              map: map,
              allies: combatants,
              combatants: combatants,
            }).ok;
          })
          .map(function (candidate) {
            return { x: candidate.x, y: candidate.y };
          });
        return;
      }

      if (this.mode === MODES.SHOVE) {
        const map = this.map;
        const combatants = this.combatants;
        this.reachable = [];
        this.shoveTargets = this.combatants
          .filter(function (candidate) {
            if (candidate.id === combatant.id) {
              return false;
            }
            return Shove.evaluateShove({
              attacker: combatant,
              target: candidate,
              map: map,
              allies: combatants,
              combatants: combatants,
            }).ok;
          })
          .map(function (candidate) {
            return { x: candidate.x, y: candidate.y };
          });
        return;
      }

      if (this.mode === MODES.GRAPPLE) {
        const map = this.map;
        const combatants = this.combatants;
        this.reachable = [];
        this.grappleTargets = this.combatants
          .filter(function (candidate) {
            if (candidate.id === combatant.id) {
              return false;
            }
            return Grapple.evaluateGrapple({
              attacker: combatant,
              target: candidate,
              map: map,
              allies: combatants,
              combatants: combatants,
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
      this.tripTargets = [];
      this.shoveTargets = [];
      this.grappleTargets = [];
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

    /**
     * Exact grid cell under a mouse/drag event. Used by the Phase 25 drop
     * target so a bestiary card spawns on the square the cursor is over.
     *
     * @param {MouseEvent|DragEvent} event
     * @returns {{x:number,y:number}|null}
     */
    cellFromEvent(event) {
      const point = this.eventPoint(event);
      if (!point) {
        return null;
      }
      return this.grid.cellAtPoint(point.x, point.y);
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
      if (this.externalToolConsumesClicks()) {
        return;
      }
      const point = this.eventPoint(event);
      if (!point) {
        return;
      }
      const cell = this.grid.cellAtPoint(point.x, point.y);
      if (!cell) {
        return;
      }

      const token = this.findTokenAt(point.x, point.y);

      // Phase 24 terrain/wall painter: while a brush is active every board
      // click edits the map instead of resolving an action.
      if (this.paintTool !== PAINT_TOOLS.SELECT) {
        this.onPaintRequest(cell, this.paintTool);
        this.resetHover();
        this.refreshReachable();
        this.render();
        return;
      }

      if (this.mode === MODES.CAST) {
        if (!this.selectedCombatant || !this.spell) {
          return;
        }
        this.onCastRequest(this.selectedCombatant, this.spell, cell, token);
        this.render();
        return;
      }

      if (this.mode === MODES.SNEAK) {
        if (!this.selectedCombatant) {
          return;
        }
        if (cell.x === this.selectedCombatant.x && cell.y === this.selectedCombatant.y) {
          this.clearSelection();
          return;
        }
        this.resetHover();
        this.onSneakRequest(this.selectedCombatant, cell);
        this.render();
        return;
      }

      if (
        this.mode === MODES.STRIKE ||
        this.mode === MODES.TRIP ||
        this.mode === MODES.SHOVE ||
        this.mode === MODES.GRAPPLE
      ) {
        if (!this.selectedCombatant) {
          return;
        }
        if (token && token.id !== this.selectedCombatant.id) {
          this.resetHover();
          if (this.mode === MODES.TRIP) {
            this.onTripRequest(this.selectedCombatant, token);
          } else if (this.mode === MODES.SHOVE) {
            this.onShoveRequest(this.selectedCombatant, token);
          } else if (this.mode === MODES.GRAPPLE) {
            this.onGrappleRequest(this.selectedCombatant, token);
          } else {
            this.onStrikeRequest(this.selectedCombatant, token);
          }
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
      if (this.externalToolConsumesHover()) {
        return;
      }
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

    handleDragOver(event) {
      if (!hasCompendiumDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      this.canvas.classList.add("drag-over");
    }

    handleDragLeave(event) {
      if (
        event.relatedTarget &&
        typeof this.canvas.contains === "function" &&
        this.canvas.contains(event.relatedTarget)
      ) {
        return;
      }
      this.canvas.classList.remove("drag-over");
    }

    handleDrop(event) {
      this.canvas.classList.remove("drag-over");
      const payload = readCompendiumDrag(event.dataTransfer);
      if (!payload) {
        return;
      }
      event.preventDefault();
      const point = this.eventPoint(event);
      const cell = point ? this.grid.cellAtPoint(point.x, point.y) : null;
      if (!cell) {
        this.resetHover();
        return;
      }
      const token = point ? this.findTokenAt(point.x, point.y) : null;
      this.onDropCompendium(
        payload,
        { x: cell.x, y: cell.y },
        token || this.findCombatantAtCell(cell),
      );
      this.resetHover();
      this.refreshReachable();
      this.render();
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

      if (this.mode !== MODES.CAST) {
        this.aoeCells = [];
        this.aoeTargets = [];
      }

      if (!cell) {
        this.onHoverChange(null);
        this.render();
        return;
      }

      const label = Grid.gridToLabel(cell);

      if (this.paintTool !== PAINT_TOOLS.SELECT) {
        this.hoverInfo = {
          status: "paint",
          cell: cell,
          label: label,
          tool: this.paintTool,
        };
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

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

      if (
        (this.mode === MODES.STRIDE || this.mode === MODES.STEP) &&
        typeof combatant.isImmobilized === "function" &&
        combatant.isImmobilized()
      ) {
        this.hoverInfo = {
          status: "immobilized",
          cell: cell,
          label: label,
          combatant: combatant,
        };
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      if (this.mode === MODES.CAST) {
        const spell = this.spell;
        if (!spell) {
          this.onHoverChange(null);
          this.render();
          return;
        }
        const area = this.refreshAoe(cell);
        const isAttack = spell.type === "attack";
        const validTarget =
          !isAttack || (occupant !== null && occupant.id !== combatant.id);
        const hasArea = isAttack || area.cells.length > 0;
        this.hoverInfo = {
          status: "cast",
          cell: cell,
          label: label,
          combatant: combatant,
          spell: spell,
          target: occupant,
          areaType: area.areaType,
          cells: area.cells,
          valid: validTarget && hasArea,
        };
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      if (this.mode === MODES.SNEAK) {
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
        const halfSpeed = Math.floor(combatant.speedFeet / 10) * 5;
        const tooFar = !pathResult.found || pathResult.costFeet > halfSpeed;
        if (pathResult.found && !tooFar) {
          this.hoverPath = pathResult.path;
        }
        this.hoverInfo = {
          status: "sneak",
          cell: cell,
          label: label,
          combatant: combatant,
          valid: pathResult.found && !tooFar,
          costFeet: pathResult.found ? pathResult.costFeet : null,
          maxCostFeet: halfSpeed,
          path: pathResult.found ? pathResult.path : null,
        };
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

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
            reachFeet: evaluation.reachFeet,
            flanked: evaluation.flanked === true,
            offGuard: evaluation.offGuard === true,
            flankers: evaluation.flankers || [],
            cover: evaluation.cover || null,
            coverDegree: evaluation.coverDegree || "none",
            coverBonus: evaluation.coverBonus || 0,
            blockedRaysCount: evaluation.blockedRaysCount || 0,
            flatCheckDC: evaluation.flatCheckDC || null,
            flatCheckCondition: evaluation.flatCheckCondition || null,
            hiddenAttacker: evaluation.hiddenAttacker === true,
            visibility: evaluation.visibility || null,
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

      if (this.mode === MODES.TRIP) {
        if (occupant && occupant.id !== combatant.id) {
          const evaluation = Trip.evaluateTrip({
            attacker: combatant,
            target: occupant,
            map: this.map,
            allies: this.combatants,
            combatants: this.combatants,
          });
          this.hoverInfo = {
            status: "trip",
            cell: cell,
            label: label,
            combatant: combatant,
            target: occupant,
            valid: evaluation.ok,
            reason: evaluation.reason || null,
            distanceFeet: evaluation.distanceFeet,
            reachFeet: evaluation.reachFeet,
            skillBase: evaluation.skillBase || 0,
            mapPenalty: evaluation.mapPenalty || 0,
            reflexDC: evaluation.reflexDC,
            targetDC: evaluation.targetDC,
            cover: evaluation.cover || null,
            coverDegree: evaluation.coverDegree || "none",
            flatCheckDC: evaluation.flatCheckDC || null,
            flatCheckCondition: evaluation.flatCheckCondition || null,
            visibility: evaluation.visibility || null,
          };
        } else {
          this.hoverInfo = {
            status: "trip-empty",
            cell: cell,
            label: label,
            combatant: combatant,
          };
        }
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      if (this.mode === MODES.SHOVE) {
        if (occupant && occupant.id !== combatant.id) {
          const evaluation = Shove.evaluateShove({
            attacker: combatant,
            target: occupant,
            map: this.map,
            allies: this.combatants,
            combatants: this.combatants,
          });
          this.hoverInfo = {
            status: "shove",
            cell: cell,
            label: label,
            combatant: combatant,
            target: occupant,
            valid: evaluation.ok,
            reason: evaluation.reason || null,
            distanceFeet: evaluation.distanceFeet,
            reachFeet: evaluation.reachFeet,
            skillBase: evaluation.skillBase || 0,
            mapPenalty: evaluation.mapPenalty || 0,
            fortitudeDC:
              evaluation.fortitudeDC === undefined
                ? null
                : evaluation.fortitudeDC,
            targetDC: evaluation.targetDC,
            pushDirection: evaluation.pushDirection || null,
            potentialPushPath: evaluation.potentialPushPath || [],
            potentialPushedFeet: evaluation.potentialPushedFeet || 0,
            potentialBlockedReason: evaluation.potentialBlockedReason || null,
            cover: evaluation.cover || null,
            coverDegree: evaluation.coverDegree || "none",
            flatCheckDC: evaluation.flatCheckDC || null,
            flatCheckCondition: evaluation.flatCheckCondition || null,
            visibility: evaluation.visibility || null,
          };
        } else {
          this.hoverInfo = {
            status: "shove-empty",
            cell: cell,
            label: label,
            combatant: combatant,
          };
        }
        this.onHoverChange(this.hoverInfo);
        this.render();
        return;
      }

      if (this.mode === MODES.GRAPPLE) {
        if (occupant && occupant.id !== combatant.id) {
          const evaluation = Grapple.evaluateGrapple({
            attacker: combatant,
            target: occupant,
            map: this.map,
            allies: this.combatants,
            combatants: this.combatants,
          });
          this.hoverInfo = {
            status: "grapple",
            cell: cell,
            label: label,
            combatant: combatant,
            target: occupant,
            valid: evaluation.ok,
            reason: evaluation.reason || null,
            distanceFeet: evaluation.distanceFeet,
            reachFeet: evaluation.reachFeet,
            skillBase: evaluation.skillBase || 0,
            mapPenalty: evaluation.mapPenalty || 0,
            fortitudeDC:
              evaluation.fortitudeDC === undefined
                ? null
                : evaluation.fortitudeDC,
            targetDC: evaluation.targetDC,
            cover: evaluation.cover || null,
            coverDegree: evaluation.coverDegree || "none",
            flatCheckDC: evaluation.flatCheckDC || null,
            flatCheckCondition: evaluation.flatCheckCondition || null,
            visibility: evaluation.visibility || null,
          };
        } else {
          this.hoverInfo = {
            status: "grapple-empty",
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

      if (info.status === "cast") {
        const isAttack = info.spell && info.spell.type === "attack";
        const label = isAttack
          ? (info.valid
              ? (info.spell.name || "Spell") + " → " + (info.target ? info.target.name : "target")
              : "Select a hostile target")
          : (info.valid
              ? (info.spell.name || "Spell") + " · " + (info.areaType || "area") + " · " + info.cells.length + " cells"
              : "Invalid spell origin");
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        this.grid.drawPathLabel(
          ctx,
          info.cell,
          label,
          info.valid ? "valid" : "invalid",
        );
        return;
      }

      if (info.status === "sneak") {
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        if (this.hoverPath) {
          this.grid.drawPath(ctx, this.hoverPath, info.valid);
        }
        this.grid.drawPathLabel(
          ctx,
          info.cell,
          info.valid
            ? "Sneak · " + info.costFeet + " / " + info.maxCostFeet + " ft"
            : "Sneak · exceeds half Speed",
          info.valid ? "valid" : "invalid",
        );
        return;
      }

      if (info.status === "strike") {
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        if (info.valid && info.flanked) {
          this.grid.drawFlankedCell(ctx, info.cell);
        }
        this.grid.drawLineOfSight(ctx, info.combatant, info.target, info.valid);
        if (
          info.cover &&
          (info.cover.degree !== "none" || info.cover.blockedRaysCount > 0)
        ) {
          this.grid.drawCoverRays(ctx, info.cover.rays);
        }

        const coverText = coverLabel(info.cover);
        let label = info.valid
          ? "Strike · " + info.distanceFeet + " ft"
          : strikeReasonText(info.reason);
        const targetBlocked =
          !info.valid &&
          info.reason === Strike.STRIKE_REASONS.TARGET_UNDETECTED;

        if (info.valid && info.flanked) {
          label += " · FLANKED (-2 AC)";
        }
        if (!targetBlocked && info.hiddenAttacker) {
          label += " · TARGET OFF-GUARD (-2 AC)";
        }
        if (!targetBlocked && info.flatCheckDC) {
          label += " · FLAT CHECK DC " + info.flatCheckDC;
        }
        if (info.valid && coverText) {
          label += " · " + coverText;
        }

        let labelKind = info.valid ? "valid" : "invalid";
        if (!targetBlocked && (coverText || info.flatCheckDC)) {
          labelKind = "cover";
        } else if (!targetBlocked && (info.flanked || info.hiddenAttacker)) {
          labelKind = "flank";
        }

        this.grid.drawPathLabel(ctx, info.cell, label, labelKind);
        return;
      }

      if (
        info.status === "strike-empty" ||
        info.status === "trip-empty" ||
        info.status === "shove-empty" ||
        info.status === "grapple-empty"
      ) {
        return;
      }

      if (info.status === "trip") {
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        this.grid.drawLineOfSight(ctx, info.combatant, info.target, info.valid);
        if (
          info.cover &&
          (info.cover.degree !== "none" || info.cover.blockedRaysCount > 0)
        ) {
          this.grid.drawCoverRays(ctx, info.cover.rays);
        }

        let label = info.valid
          ? "TRIP · Athletics vs Reflex DC " + info.reflexDC
          : strikeReasonText(info.reason);
        const coverText = coverLabel(info.cover);
        if (info.valid && coverText) {
          label += " · " + coverText;
        }
        if (info.valid && info.flatCheckDC) {
          label += " · FLAT CHECK DC " + info.flatCheckDC;
        }
        this.grid.drawPathLabel(
          ctx,
          info.cell,
          label,
          info.valid ? "valid" : "invalid",
        );
        return;
      }

      if (info.status === "shove") {
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        this.grid.drawLineOfSight(ctx, info.combatant, info.target, info.valid);
        if (info.valid && info.potentialPushPath.length > 1) {
          this.grid.drawPath(ctx, info.potentialPushPath, true);
        }

        let label = info.valid
          ? "SHOVE · Athletics vs Fortitude DC " + info.fortitudeDC
          : strikeReasonText(info.reason);
        if (info.valid) {
          label += " · push up to " + info.potentialPushedFeet + " ft";
        }
        if (info.valid && info.flatCheckDC) {
          label += " · FLAT CHECK DC " + info.flatCheckDC;
        }
        this.grid.drawPathLabel(
          ctx,
          info.cell,
          label,
          info.valid ? "valid" : "invalid",
        );
        return;
      }

      if (info.status === "grapple") {
        this.grid.drawHoverCell(ctx, info.cell, info.valid);
        this.grid.drawLineOfSight(ctx, info.combatant, info.target, info.valid);
        if (
          info.cover &&
          (info.cover.degree !== "none" || info.cover.blockedRaysCount > 0)
        ) {
          this.grid.drawCoverRays(ctx, info.cover.rays);
        }

        let label = info.valid
          ? "GRAPPLE · Athletics vs Fortitude DC " + info.fortitudeDC
          : strikeReasonText(info.reason);
        const coverText = coverLabel(info.cover);
        if (info.valid && coverText) {
          label += " · " + coverText;
        }
        if (info.valid && info.flatCheckDC) {
          label += " · FLAT CHECK DC " + info.flatCheckDC;
        }
        this.grid.drawPathLabel(
          ctx,
          info.cell,
          label,
          info.valid ? "valid" : "invalid",
        );
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

      if (info.status === "immobilized") {
        this.grid.drawHoverCell(ctx, info.cell, false);
        this.grid.drawPathLabel(ctx, info.cell, "IMMOBILIZED", "blocked");
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
      const externalCursor =
        this.externalTool && typeof this.externalTool.getCursor === "function"
          ? this.externalTool.getCursor()
          : null;
      this.canvas.style.cursor = externalCursor
        ? externalCursor
        : this.isPainting()
          ? "crosshair"
          : this.hoverInfo &&
            (this.hoverInfo.status === "strike" ||
              this.hoverInfo.status === "trip" ||
              this.hoverInfo.status === "shove" ||
              this.hoverInfo.status === "grapple") &&
            this.hoverInfo.reason === Strike.STRIKE_REASONS.TARGET_UNDETECTED
            ? "not-allowed"
            : "";
      ctx.clearRect(0, 0, this.grid.width, this.grid.height);
      this.grid.draw(ctx);

      const difficultCells =
        typeof this.map.getDifficultTerrainCells === "function"
          ? this.map.getDifficultTerrainCells()
          : [];
      if (difficultCells.length > 0) {
        this.grid.drawDifficultTerrain(ctx, difficultCells);
      }

      const greaterCells =
        typeof this.map.getGreaterDifficultTerrainCells === "function"
          ? this.map.getGreaterDifficultTerrainCells()
          : [];
      if (greaterCells.length > 0) {
        this.grid.drawGreaterDifficultTerrain(ctx, greaterCells);
      }

      const hazardousCells =
        typeof this.map.getHazardousCells === "function"
          ? this.map.getHazardousCells()
          : [];
      if (hazardousCells.length > 0) {
        this.grid.drawHazardousTerrain(ctx, hazardousCells);
      }

      const dimCells =
        typeof this.map.getIlluminationCells === "function"
          ? this.map.getIlluminationCells("dim")
          : [];
      const darknessCells =
        typeof this.map.getIlluminationCells === "function"
          ? this.map.getIlluminationCells("darkness")
          : [];
      if (dimCells.length > 0 || darknessCells.length > 0) {
        this.grid.drawIllumination(ctx, dimCells, darknessCells);
      }

      if (this.reachable.length > 0) {
        this.grid.drawReachable(ctx, this.reachable);
      }
      if (this.strikeTargets.length > 0) {
        this.grid.drawStrikeTargets(ctx, this.strikeTargets);
      }
      if (this.tripTargets.length > 0) {
        this.grid.drawStrikeTargets(ctx, this.tripTargets);
      }
      if (this.shoveTargets.length > 0) {
        this.grid.drawStrikeTargets(ctx, this.shoveTargets);
      }
      if (this.grappleTargets.length > 0) {
        this.grid.drawStrikeTargets(ctx, this.grappleTargets);
      }

      this.grid.drawObstacles(ctx, this.map.getBlockedCells());

      if (this.mode === MODES.CAST && this.aoeCells.length > 0) {
        const areaType =
          this.hoverInfo && this.hoverInfo.status === "cast"
            ? this.hoverInfo.areaType
            : this.spell && this.spell.area
              ? this.spell.area.type
              : "burst";
        this.grid.drawAoeCells(ctx, this.aoeCells, areaType);
      }

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

      if (this.mode === MODES.CAST && this.aoeTargets.length > 0) {
        this.grid.drawAoeTargets(ctx, this.aoeTargets);
      }
    }

    destroy() {
      this.canvas.removeEventListener("click", this.handleClick);
      this.canvas.removeEventListener("mousemove", this.handleMouseMove);
      this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
      this.canvas.removeEventListener("dragover", this.handleDragOver);
      this.canvas.removeEventListener("dragleave", this.handleDragLeave);
      this.canvas.removeEventListener("drop", this.handleDrop);
      root.removeEventListener("keydown", this.handleKeyDown);
    }
  }

  NS.View.BattlefieldView = BattlefieldView;
  NS.View.ACTION_MODES = MODES;
  NS.View.PAINT_TOOLS = PAINT_TOOLS;
})(typeof globalThis !== "undefined" ? globalThis : this);
