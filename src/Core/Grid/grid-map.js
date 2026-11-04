/**
 * PF2E REMASTERED — GRID MAP (HEADLESS CORE)
 *
 * Static battlefield geometry: bounds, impassable cells, and difficult
 * terrain. Obstacles and terrain are deliberately data-only; rendering and
 * input live in View.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.GridMap = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function assertPositiveInteger(value, label) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(label + " must be a positive integer; received " + String(value) + ".");
    }
  }

  function cellKey(x, y) {
    return x + "," + y;
  }

  function sortedCells(keys) {
    const cells = [];
    for (const key of keys) {
      const parts = key.split(",");
      cells.push({ x: Number(parts[0]), y: Number(parts[1]) });
    }
    cells.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
    return cells;
  }

  class GridMap {
    constructor(options) {
      const opts = options || {};
      this.cols = opts.cols === undefined ? 15 : opts.cols;
      this.rows = opts.rows === undefined ? 15 : opts.rows;
      assertPositiveInteger(this.cols, "cols");
      assertPositiveInteger(this.rows, "rows");

      this.blocked = new Set();
      this.difficult = new Set();

      if (opts.blocked !== undefined) {
        if (!Array.isArray(opts.blocked)) {
          throw new TypeError("blocked must be an array of cells.");
        }
        for (const cell of opts.blocked) {
          this.setBlocked(cell.x, cell.y, true);
        }
      }

      if (opts.difficult !== undefined) {
        if (!Array.isArray(opts.difficult)) {
          throw new TypeError("difficult must be an array of cells.");
        }
        for (const cell of opts.difficult) {
          this.setDifficultTerrain(cell.x, cell.y, true);
        }
      }
    }

    /**
     * Build a map from ASCII rows.
     *
     * Characters listed in `blockedChars` are impassable. Characters listed in
     * `options.difficultChars` are difficult terrain (blocked cells win when a
     * character is listed in both sets).
     *
     * @param {string[]} rows
     * @param {string} [blockedChars]
     * @param {{ difficultChars?: string }} [options]
     * @returns {GridMap}
     */
    static fromAscii(rows, blockedChars, options) {
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new TypeError("rows must be a non-empty array of strings.");
      }

      const cols = rows[0].length;
      if (cols === 0) {
        throw new RangeError("ASCII map rows must not be empty.");
      }

      const chars = blockedChars === undefined ? "#" : blockedChars;
      if (typeof chars !== "string" || chars.length === 0) {
        throw new TypeError("blockedChars must be a non-empty string.");
      }

      const opts = options || {};
      const difficultChars = opts.difficultChars === undefined ? "" : opts.difficultChars;
      if (typeof difficultChars !== "string") {
        throw new TypeError("difficultChars must be a string.");
      }

      const blocked = [];
      const difficult = [];
      for (let y = 0; y < rows.length; y += 1) {
        const row = rows[y];
        if (typeof row !== "string" || row.length !== cols) {
          throw new RangeError("All ASCII map rows must have the same length.");
        }
        for (let x = 0; x < cols; x += 1) {
          if (chars.indexOf(row[x]) !== -1) {
            blocked.push({ x: x, y: y });
          } else if (difficultChars.indexOf(row[x]) !== -1) {
            difficult.push({ x: x, y: y });
          }
        }
      }

      return new GridMap({
        cols: cols,
        rows: rows.length,
        blocked: blocked,
        difficult: difficult,
      });
    }

    isInBounds(x, y) {
      return (
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        x >= 0 &&
        y >= 0 &&
        x < this.cols &&
        y < this.rows
      );
    }

    hasObstacle(x, y) {
      return this.blocked.has(cellKey(x, y));
    }

    /**
     * True when entering the cell costs an additional 5 feet. The origin cell
     * of a move never charges terrain; only entering a square does.
     */
    hasDifficultTerrain(x, y) {
      return this.difficult.has(cellKey(x, y));
    }

    /**
     * True when a creature cannot occupy the cell. Out-of-bounds cells count
     * as blocked so pathfinding and corner checks can use one predicate.
     */
    isBlocked(x, y) {
      return !this.isInBounds(x, y) || this.hasObstacle(x, y);
    }

    setBlocked(x, y, blocked) {
      if (!this.isInBounds(x, y)) {
        throw new RangeError("Cannot modify a blocked cell outside the map.");
      }
      if (blocked === false) {
        this.blocked.delete(cellKey(x, y));
      } else {
        this.blocked.add(cellKey(x, y));
      }
      return this;
    }

    setDifficultTerrain(x, y, difficult) {
      if (!this.isInBounds(x, y)) {
        throw new RangeError("Cannot modify terrain outside the map.");
      }
      if (difficult === false) {
        this.difficult.delete(cellKey(x, y));
      } else {
        this.difficult.add(cellKey(x, y));
      }
      return this;
    }

    /**
     * @returns {{x:number,y:number}[]}
     */
    getBlockedCells() {
      return sortedCells(this.blocked);
    }

    /**
     * @returns {{x:number,y:number}[]}
     */
    getDifficultTerrainCells() {
      return sortedCells(this.difficult);
    }

    clone() {
      const copy = new GridMap({ cols: this.cols, rows: this.rows });
      for (const key of this.blocked) {
        copy.blocked.add(key);
      }
      for (const key of this.difficult) {
        copy.difficult.add(key);
      }
      return copy;
    }

    toAscii(blockedChar, floorChar, difficultChar) {
      const wall = blockedChar === undefined ? "#" : blockedChar;
      const floor = floorChar === undefined ? "." : floorChar;
      const tough = difficultChar === undefined ? floor : difficultChar;
      const rows = [];
      for (let y = 0; y < this.rows; y += 1) {
        let row = "";
        for (let x = 0; x < this.cols; x += 1) {
          if (this.hasObstacle(x, y)) {
            row += wall;
          } else {
            row += this.hasDifficultTerrain(x, y) ? tough : floor;
          }
        }
        rows.push(row);
      }
      return rows;
    }
  }

  return GridMap;
});
