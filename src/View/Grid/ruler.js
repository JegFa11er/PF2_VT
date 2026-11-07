/**
 * PF2E REMASTERED — TACTICAL RULER (VIEW)
 *
 * Foundry-style measurement overlay. It draws on a transparent canvas layered
 * exactly over the battlefield canvas, so the Core grid renderer is untouched.
 *
 * Activation:
 *   - the 📏 toolbar button toggles a persistent ruler tool;
 *   - holding Space starts a temporary measurement from the hovered cell (or
 *     the selected combatant when the pointer has not entered the board yet);
 *   - middle-mouse drag starts a measurement without changing the cursor mode.
 *
 * Measurement follows the canonical 5-10-5 diagonal alternation. Difficult
 * terrain adds +5 ft per entered square and greater-difficult terrain adds
 * +10 ft. A wall in the measured line marks the segment as blocked (red).
 *
 * Ctrl or X adds a waypoint at the current cursor cell, so bent paths can be
 * measured around obstacles. The final colour compares the total distance with
 * the selected combatant's Speed: green ≤ Speed, amber ≤ 2 × Speed, red above.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const FEET_PER_SQUARE = 5;

  const COLORS = Object.freeze({
    normal: "rgba(88, 198, 255, 0.96)",
    normalGlow: "rgba(88, 198, 255, 0.5)",
    within: "rgba(126, 230, 157, 0.96)",
    withinGlow: "rgba(126, 230, 157, 0.5)",
    extended: "rgba(255, 207, 106, 0.96)",
    extendedGlow: "rgba(255, 207, 106, 0.5)",
    blocked: "rgba(255, 124, 116, 0.96)",
    blockedGlow: "rgba(255, 124, 116, 0.5)",
  });

  function isTypingTarget(target) {
    if (!target) {
      return false;
    }
    if (target.isContentEditable === true) {
      return true;
    }
    const tag = String(target.tagName || "").toUpperCase();
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON"
    );
  }

  function copyCell(cell) {
    return cell ? { x: cell.x, y: cell.y } : null;
  }

  function sameCell(a, b) {
    return Boolean(a && b && a.x === b.x && a.y === b.y);
  }

  function diagonalCost(index) {
    return index % 2 === 0 ? FEET_PER_SQUARE : FEET_PER_SQUARE * 2;
  }

  function endpointLabel(cell, Grid) {
    if (!cell) {
      return "?";
    }
    if (Grid && typeof Grid.gridToLabel === "function") {
      try {
        return Grid.gridToLabel(cell);
      } catch (error) {
        return cell.x + "," + cell.y;
      }
    }
    return cell.x + "," + cell.y;
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

  class Ruler {
    constructor(options) {
      const opts = options || {};
      if (!opts.canvas) {
        throw new Error("Ruler requires a battlefield canvas.");
      }

      this.canvas = opts.canvas;
      this.container = opts.container || this.canvas.parentElement;
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
      this.getCombatant =
        typeof opts.getCombatant === "function"
          ? opts.getCombatant
          : function () {
              return null;
            };
      this.onMeasure =
        typeof opts.onMeasure === "function" ? opts.onMeasure : function () {};
      this.onActiveChange =
        typeof opts.onActiveChange === "function"
          ? opts.onActiveChange
          : function () {};
      this.onLog =
        typeof opts.onLog === "function" ? opts.onLog : function () {};

      this.Grid = NS.Core && NS.Core.Grid ? NS.Core.Grid : null;

      this.toolActive = false;
      this.spaceDown = false;
      this.measuring = false;
      this.pointerDown = false;
      this.middleDown = false;
      this.start = null;
      this.current = null;
      this.waypoints = [];
      this.lastCell = null;
      this.wasActive = false;

      this.buildOverlay();
      this.bind();
    }

    buildOverlay() {
      const overlay = this.document.createElement("canvas");
      overlay.className = "ruler-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.hidden = true;
      this.container.append(overlay);
      this.overlay = overlay;
      this.ctx = overlay.getContext("2d");
    }

    bind() {
      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.handlePointerMove = this.handlePointerMove.bind(this);
      this.handlePointerUp = this.handlePointerUp.bind(this);
      this.handlePointerEnter = this.handlePointerEnter.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleKeyUp = this.handleKeyUp.bind(this);
      this.handleSync = this.handleSync.bind(this);

      this.canvas.addEventListener("pointerdown", this.handlePointerDown);
      this.canvas.addEventListener("pointermove", this.handlePointerMove);
      this.canvas.addEventListener("pointerenter", this.handlePointerEnter);
      this.canvas.addEventListener("pointerleave", this.handlePointerUp);
      root.addEventListener("pointerup", this.handlePointerUp);
      root.addEventListener("keydown", this.handleKeyDown);
      root.addEventListener("keyup", this.handleKeyUp);
      root.addEventListener("resize", this.handleSync);
      if (this.container && this.container.addEventListener) {
        this.container.addEventListener("scroll", this.handleSync, { passive: true });
      }
    }

    isToolActive() {
      return this.toolActive;
    }

    isActive() {
      return this.toolActive || this.spaceDown || this.measuring || this.middleDown;
    }

    /** BattlefieldView suppresses its own click/hover handling while true. */
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

    anchorCell() {
      const combatant = this.getCombatant();
      if (combatant && Number.isInteger(combatant.x) && Number.isInteger(combatant.y)) {
        return { x: combatant.x, y: combatant.y };
      }
      return this.lastCell ? copyCell(this.lastCell) : null;
    }

    notifyActiveChange() {
      const active = this.isActive();
      if (active === this.wasActive) {
        return;
      }
      this.wasActive = active;
      this.onActiveChange(active);
    }

    handlePointerEnter(event) {
      const cell = this.cellFromEvent(event);
      if (cell) {
        this.lastCell = copyCell(cell);
      }
    }

    handlePointerDown(event) {
      const cell = this.cellFromEvent(event);
      if (cell) {
        this.lastCell = copyCell(cell);
      }

      if (event.button === 1) {
        event.preventDefault();
        this.middleDown = true;
        this.beginMeasure(cell || this.anchorCell());
        this.notifyActiveChange();
        return;
      }

      if (event.button !== 0) {
        return;
      }
      if (!this.toolActive && !this.spaceDown) {
        return;
      }
      event.preventDefault();
      this.pointerDown = true;
      this.beginMeasure(cell || this.anchorCell());
      this.notifyActiveChange();
    }

    handlePointerMove(event) {
      const cell = this.cellFromEvent(event);
      if (cell) {
        this.lastCell = copyCell(cell);
      }
      if (!this.isActive()) {
        return;
      }
      if (!this.measuring) {
        if (this.toolActive) {
          this.beginMeasure(this.anchorCell() || cell);
        } else {
          return;
        }
      }
      if (cell && this.current && sameCell(cell, this.current)) {
        return;
      }
      if (cell) {
        this.current = copyCell(cell);
      }
      this.render();
      this.emit();
    }

    handlePointerUp() {
      const wasMeasuring = this.measuring;
      this.pointerDown = false;
      if (this.middleDown) {
        this.middleDown = false;
      }
      if (wasMeasuring && !this.toolActive && !this.spaceDown) {
        this.finishMeasurement();
      }
      this.notifyActiveChange();
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

      const isSpace =
        event.code === "Space" || event.key === " " || event.key === "Spacebar";
      if (isSpace) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        this.spaceDown = true;
        if (!this.measuring) {
          this.beginMeasure(this.lastCell || this.anchorCell());
        }
        this.render();
        this.emit();
        this.notifyActiveChange();
        return;
      }

      if (event.key === "Escape" && this.isActive()) {
        event.preventDefault();
        this.deactivate({ silent: true });
        return;
      }

      if (!this.measuring || event.repeat) {
        return;
      }
      const isWaypointKey =
        event.key === "Control" ||
        event.key === "x" ||
        event.key === "X";
      if (!isWaypointKey) {
        return;
      }
      if (event.key === "x" || event.key === "X") {
        event.preventDefault();
      }
      this.addWaypoint(this.current);
    }

    handleKeyUp(event) {
      const isSpace =
        event.code === "Space" || event.key === " " || event.key === "Spacebar";
      if (!isSpace) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      this.spaceDown = false;
      if (!this.toolActive) {
        this.finishMeasurement();
      }
      this.notifyActiveChange();
    }

    handleSync() {
      this.render();
    }

    setToolActive(active, options) {
      const opts = options || {};
      const next = active === true;
      if (next === this.toolActive) {
        return this.toolActive;
      }
      this.toolActive = next;
      if (next) {
        this.spaceDown = false;
        this.beginMeasure(this.lastCell || this.anchorCell());
        this.onLog("Линейка активна. Тяните по сетке; Ctrl или X ставит путевую точку.", "muted");
      } else if (!opts.keepMeasurement) {
        this.clearMeasurement();
      }
      this.render();
      this.emit();
      this.notifyActiveChange();
      return this.toolActive;
    }

    toggle() {
      return this.setToolActive(!this.toolActive);
    }

    deactivate(options) {
      const opts = options || {};
      const wasActive = this.isActive();
      this.toolActive = false;
      this.spaceDown = false;
      this.middleDown = false;
      this.pointerDown = false;
      this.clearMeasurement();
      if (wasActive && !opts.silent) {
        this.onLog("Линейка выключена.", "muted");
      }
      this.notifyActiveChange();
    }

    beginMeasure(cell) {
      if (!cell) {
        this.start = null;
        this.current = null;
        this.waypoints = [];
        this.measuring = false;
        this.clearOverlay();
        return;
      }
      this.start = copyCell(cell);
      this.current = copyCell(cell);
      this.waypoints = [];
      this.measuring = true;
      this.render();
      this.emit();
    }

    addWaypoint(cell) {
      if (!this.measuring || !cell) {
        return false;
      }
      const last = this.waypoints.length > 0
        ? this.waypoints[this.waypoints.length - 1]
        : this.start;
      if (sameCell(last, cell)) {
        return false;
      }
      this.waypoints.push(copyCell(cell));
      this.current = copyCell(cell);
      this.render();
      this.emit();
      return true;
    }

    finishMeasurement() {
      this.measuring = false;
      this.clearOverlay();
      this.onMeasure(null);
    }

    clearMeasurement() {
      this.start = null;
      this.current = null;
      this.waypoints = [];
      this.measuring = false;
      this.clearOverlay();
      this.onMeasure(null);
    }

    measureSegment(from, to, diagonalIndex) {
      const map = this.getMap();
      let x = from.x;
      let y = from.y;
      let feet = 0;
      let terrainFeet = 0;
      let blocked = false;
      let diagonals = diagonalIndex;
      const path = [copyCell(from)];

      if (sameCell(from, to)) {
        return {
          from: copyCell(from),
          to: copyCell(to),
          feet: 0,
          terrainFeet: 0,
          blocked: false,
          path: path,
          diagonalIndex: diagonals,
        };
      }

      let guard = 0;
      while ((x !== to.x || y !== to.y) && guard < 10000) {
        guard += 1;
        const dx = to.x - x;
        const dy = to.y - y;
        let diagonal = false;
        if (dx !== 0 && dy !== 0) {
          x += dx > 0 ? 1 : -1;
          y += dy > 0 ? 1 : -1;
          diagonal = true;
        } else if (dx !== 0) {
          x += dx > 0 ? 1 : -1;
        } else {
          y += dy > 0 ? 1 : -1;
        }

        const stepCost = diagonal ? diagonalCost(diagonals) : FEET_PER_SQUARE;
        if (diagonal) {
          diagonals += 1;
        }

        let extra = 0;
        if (map) {
          if (typeof map.getTerrainExtraFeet === "function") {
            extra = map.getTerrainExtraFeet(x, y) || 0;
          } else if (
            typeof map.hasDifficultTerrain === "function" &&
            map.hasDifficultTerrain(x, y)
          ) {
            extra = FEET_PER_SQUARE;
          }
          if (typeof map.isBlocked === "function" && map.isBlocked(x, y)) {
            blocked = true;
          }
        }

        feet += stepCost + extra;
        terrainFeet += extra;
        path.push({ x: x, y: y });
      }

      return {
        from: copyCell(from),
        to: copyCell(to),
        feet: feet,
        terrainFeet: terrainFeet,
        blocked: blocked,
        path: path,
        diagonalIndex: diagonals,
      };
    }

    measure() {
      if (!this.start || !this.current) {
        return null;
      }
      const points = [copyCell(this.start)];
      for (const waypoint of this.waypoints) {
        points.push(copyCell(waypoint));
      }
      if (!sameCell(points[points.length - 1], this.current)) {
        points.push(copyCell(this.current));
      }

      const segments = [];
      let totalFeet = 0;
      let terrainFeet = 0;
      let blocked = false;
      let diagonalIndex = 0;
      for (let index = 1; index < points.length; index += 1) {
        const segment = this.measureSegment(
          points[index - 1],
          points[index],
          diagonalIndex,
        );
        diagonalIndex = segment.diagonalIndex;
        totalFeet += segment.feet;
        terrainFeet += segment.terrainFeet;
        blocked = blocked || segment.blocked;
        segments.push(segment);
      }

      const combatant = this.getCombatant();
      const speedFeet =
        combatant && Number.isFinite(combatant.speedFeet)
          ? combatant.speedFeet
          : null;
      let reach = "normal";
      if (blocked) {
        reach = "blocked";
      } else if (speedFeet !== null && totalFeet > speedFeet * 2) {
        reach = "blocked";
      } else if (speedFeet !== null && totalFeet > speedFeet) {
        reach = "extended";
      } else if (speedFeet !== null) {
        reach = "within";
      }

      return {
        active: true,
        points: points,
        segments: segments,
        start: copyCell(this.start),
        current: copyCell(this.current),
        waypoints: this.waypoints.map(copyCell),
        totalFeet: totalFeet,
        terrainFeet: terrainFeet,
        blocked: blocked,
        speedFeet: speedFeet,
        reach: reach,
      };
    }

    colorFor(reach) {
      switch (reach) {
        case "within":
          return { line: COLORS.within, glow: COLORS.withinGlow };
        case "extended":
          return { line: COLORS.extended, glow: COLORS.extendedGlow };
        case "blocked":
          return { line: COLORS.blocked, glow: COLORS.blockedGlow };
        default:
          return { line: COLORS.normal, glow: COLORS.normalGlow };
      }
    }

    emit() {
      const state = this.measure();
      this.onMeasure(state);
      return state;
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
      if (!this.measuring || !this.start || !this.current) {
        this.clearOverlay();
        return;
      }
      if (!this.syncOverlay()) {
        return;
      }
      const ctx = this.ctx;
      const grid = this.getGrid();
      const state = this.measure();
      if (!state || state.segments.length === 0) {
        return;
      }
      const palette = this.colorFor(state.reach);

      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash([8, 6]);

      for (const segment of state.segments) {
        if (!segment.path || segment.path.length < 2) {
          continue;
        }
        const color = segment.blocked
          ? { line: COLORS.blocked, glow: COLORS.blockedGlow }
          : palette;
        const centers = segment.path.map(function (cell) {
          return grid.cellCenter(cell.x, cell.y);
        });

        ctx.beginPath();
        ctx.moveTo(centers[0].x, centers[0].y);
        for (let index = 1; index < centers.length; index += 1) {
          ctx.lineTo(centers[index].x, centers[index].y);
        }
        ctx.strokeStyle = "rgba(7, 10, 13, 0.72)";
        ctx.lineWidth = 8;
        ctx.setLineDash([]);
        ctx.stroke();

        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(centers[0].x, centers[0].y);
        for (let index = 1; index < centers.length; index += 1) {
          ctx.lineTo(centers[index].x, centers[index].y);
        }
        ctx.strokeStyle = color.line;
        ctx.lineWidth = 3;
        ctx.shadowColor = color.glow;
        ctx.shadowBlur = 9;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.setLineDash([]);

      // Start marker.
      const startCenter = grid.cellCenter(state.start.x, state.start.y);
      ctx.beginPath();
      ctx.arc(startCenter.x, startCenter.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = palette.line;
      ctx.fill();

      // Waypoint diamonds.
      for (const waypoint of state.waypoints) {
        const center = grid.cellCenter(waypoint.x, waypoint.y);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y - 5);
        ctx.lineTo(center.x + 5, center.y);
        ctx.lineTo(center.x, center.y + 5);
        ctx.lineTo(center.x - 5, center.y);
        ctx.closePath();
        ctx.fillStyle = "#f2e2b6";
        ctx.fill();
        ctx.strokeStyle = "rgba(7, 10, 13, 0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Destination ring.
      const endCenter = grid.cellCenter(state.current.x, state.current.y);
      ctx.beginPath();
      ctx.arc(endCenter.x, endCenter.y, grid.cellSize * 0.2, 0, Math.PI * 2);
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.restore();

      this.drawLabel(state, palette);
    }

    drawLabel(state, palette) {
      const ctx = this.ctx;
      const grid = this.getGrid();
      if (!ctx || !grid) {
        return;
      }
      const cell = state.current;
      const rect = grid.cellRect(cell.x, cell.y);
      let text = state.totalFeet + " ft";
      if (state.terrainFeet > 0) {
        text += " · difficult +" + state.terrainFeet;
      }
      if (state.blocked) {
        text += " · BLOCKED";
      } else if (state.speedFeet !== null) {
        if (state.totalFeet <= state.speedFeet) {
          text += " · within Speed";
        } else if (state.totalFeet <= state.speedFeet * 2) {
          text += " · 2× Speed";
        } else {
          text += " · beyond 2× Speed";
        }
      }
      if (state.waypoints.length > 0) {
        text += " · " + state.waypoints.length + " waypoint(s)";
      }
      text += " · " + endpointLabel(state.start, this.Grid) + " → " + endpointLabel(cell, this.Grid);

      const height = 22;
      const font = "600 11px 'Segoe UI', 'Inter', system-ui, sans-serif";
      ctx.save();
      ctx.font = font;
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
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = palette.line;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
      ctx.restore();
    }

    getState() {
      return this.measure();
    }

    destroy() {
      this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
      this.canvas.removeEventListener("pointermove", this.handlePointerMove);
      this.canvas.removeEventListener("pointerenter", this.handlePointerEnter);
      this.canvas.removeEventListener("pointerleave", this.handlePointerUp);
      root.removeEventListener("pointerup", this.handlePointerUp);
      root.removeEventListener("keydown", this.handleKeyDown);
      root.removeEventListener("keyup", this.handleKeyUp);
      root.removeEventListener("resize", this.handleSync);
      if (this.container && this.container.removeEventListener) {
        this.container.removeEventListener("scroll", this.handleSync);
      }
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
    }
  }

  Ruler.FEET_PER_SQUARE = FEET_PER_SQUARE;
  NS.View.Ruler = Ruler;
})(typeof globalThis !== "undefined" ? globalThis : this);
