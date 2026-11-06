/**
 * PF2E REMASTERED — 3D DISTANCE (HEADLESS CORE)
 *
 * Three-dimensional distance between elevated creatures. The horizontal
 * displacement uses the canonical 5-10-5 diagonal rule; the vertical
 * displacement (elevation delta) is folded into the same grid-counting rule.
 *
 * Canonical resolution (mirrors Foundry PF2e `measureDistanceOnGrid`):
 *
 *   1. Convert each axis to 5-ft squares:
 *        nx = ceil(|dx|)      (x is already in squares)
 *        ny = ceil(|dy|)
 *        nz = ceil(|dzFeet| / 5)
 *   2. Sort ascending. Let:
 *        doubleDiagonal = smallest  (moves that advance all three axes)
 *        diagonal       = middle - smallest  (moves advancing two axes)
 *        straight       = largest - middle   (moves advancing one axis)
 *   3. squares = floor(doubleDiagonal * 1.75 + diagonal * 1.5 + straight)
 *   4. feet    = squares * 5
 *
 * When the elevation delta is zero the formula reduces exactly to the 2D
 * 5-10-5 rule: `max(dx, dy) + floor(min(dx, dy) / 2)` squares.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./grid-math.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Distance3D = factory(root.PF2e.Core.Grid);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Grid) {
  "use strict";

  const FEET_PER_SQUARE = Grid.FEET_PER_SQUARE;

  /**
   * Read a unit's elevation in feet. Combatants expose `getElevation()`; plain
   * cells and legacy objects fall back to the `elevation` field, then 0.
   *
   * @param {object} unit
   * @returns {number}
   */
  function elevationOf(unit) {
    if (unit !== null && typeof unit === "object") {
      if (typeof unit.getElevation === "function") {
        const value = unit.getElevation();
        if (Number.isFinite(value)) {
          return value;
        }
      }
      if (Number.isFinite(unit.elevation)) {
        return unit.elevation;
      }
    }
    return 0;
  }

  /**
   * PF2e 3D distance measured in 5-ft squares.
   *
   * @param {number} dxSquares horizontal column delta in squares
   * @param {number} dySquares horizontal row delta in squares
   * @param {number} dzFeet vertical elevation delta in feet
   * @returns {number} distance in whole 5-ft squares
   */
  function distance3DSquares(dxSquares, dySquares, dzFeet) {
    const nx = Math.ceil(Math.abs(dxSquares));
    const ny = Math.ceil(Math.abs(dySquares));
    const nz = Math.ceil(Math.abs(dzFeet) / FEET_PER_SQUARE);

    const sorted = [nx, ny, nz].sort(function (a, b) {
      return a - b;
    });
    const doubleDiagonal = sorted[0];
    const diagonal = sorted[1] - sorted[0];
    const straight = sorted[2] - sorted[1];

    return Math.floor(doubleDiagonal * 1.75 + diagonal * 1.5 + straight);
  }

  /**
   * 3D distance between two anchor cells, in feet. `a` and `b` may be plain
   * `{ x, y }` cells or combatants; elevation defaults to 0 when absent.
   *
   * @param {object} a
   * @param {object} b
   * @returns {number}
   */
  function getDistance3D(a, b) {
    if (a === null || typeof a !== "object" || b === null || typeof b !== "object") {
      throw new TypeError("getDistance3D requires two positioned units.");
    }
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) {
      throw new TypeError("getDistance3D 'a' must be a positioned unit.");
    }
    if (!Number.isInteger(b.x) || !Number.isInteger(b.y)) {
      throw new TypeError("getDistance3D 'b' must be a positioned unit.");
    }

    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const dz = Math.abs(elevationOf(b) - elevationOf(a));

    return distance3DSquares(dx, dy, dz) * FEET_PER_SQUARE;
  }

  /**
   * Edge-to-edge 3D distance between two combatants, using the closest pair of
   * occupied cells. This mirrors `Grid.getCombatantDistance` but adds the
   * elevation delta, so a Large creature's reach still measures from its
   * nearest edge.
   *
   * @param {object} a
   * @param {object} b
   * @returns {number}
   */
  function getCombatantDistance3D(a, b) {
    const fromCells = Grid.occupiedCellsOf(a);
    const toCells = Grid.occupiedCellsOf(b);
    const fromElevation = elevationOf(a);
    const toElevation = elevationOf(b);
    const dz = Math.abs(toElevation - fromElevation);

    let minDistance = Infinity;
    for (const from of fromCells) {
      for (const to of toCells) {
        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);
        const feet = distance3DSquares(dx, dy, dz) * FEET_PER_SQUARE;
        if (feet < minDistance) {
          minDistance = feet;
        }
      }
    }
    return minDistance;
  }

  return Object.freeze({
    FEET_PER_SQUARE: FEET_PER_SQUARE,
    elevationOf: elevationOf,
    distance3DSquares: distance3DSquares,
    getDistance3D: getDistance3D,
    getCombatantDistance3D: getCombatantDistance3D,
  });
});
