/**
 * PF2E REMASTERED — CREATURE OCCUPANCY (HEADLESS CORE)
 *
 * Translates combatant factions into the two cell sets used by pathfinding:
 *
 *   blockedCells      — enemies of the mover; the search cannot enter them.
 *   passThroughCells  — allies of the mover; the search may cross them but
 *                       must not end the move there.
 *
 * Creature occupancy does not feed the diagonal corner rule; only solid map
 * obstacles do. This keeps the "block-any" policy about walls, not bodies.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Occupancy = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLIANCES = Object.freeze({
    PLAYER: "player",
    ENEMY: "enemy",
  });

  function assertCombatant(combatant, label) {
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError(label + " must be a positioned combatant.");
    }
  }

  function allianceOf(combatant) {
    return combatant.alliance === undefined ? ALLIANCES.PLAYER : combatant.alliance;
  }

  function copyCell(combatant) {
    return { x: combatant.x, y: combatant.y };
  }

  /**
   * Build occupancy sets for one mover.
   *
   * @param {object[]} combatants
   * @param {object} mover
   * @returns {{blockedCells: {x:number,y:number}[], passThroughCells: {x:number,y:number}[]}}
   */
  function buildOccupancy(combatants, mover) {
    if (!Array.isArray(combatants)) {
      throw new TypeError("combatants must be an array.");
    }
    assertCombatant(mover, "mover");

    const moverAlliance = allianceOf(mover);
    const blockedCells = [];
    const passThroughCells = [];

    for (const combatant of combatants) {
      assertCombatant(combatant, "combatant");
      if (combatant.id !== undefined && combatant.id === mover.id) {
        continue;
      }
      if (combatant.x === mover.x && combatant.y === mover.y) {
        continue;
      }
      if (allianceOf(combatant) === moverAlliance) {
        passThroughCells.push(copyCell(combatant));
      } else {
        blockedCells.push(copyCell(combatant));
      }
    }

    return Object.freeze({
      blockedCells: Object.freeze(blockedCells),
      passThroughCells: Object.freeze(passThroughCells),
    });
  }

  /**
   * @param {{x:number,y:number}[]} cells
   * @param {{x:number,y:number}} cell
   * @returns {boolean}
   */
  function containsCell(cells, cell) {
    return cells.some(function (candidate) {
      return candidate.x === cell.x && candidate.y === cell.y;
    });
  }

  return Object.freeze({
    ALLIANCES: ALLIANCES,
    buildOccupancy: buildOccupancy,
    containsCell: containsCell,
  });
});
