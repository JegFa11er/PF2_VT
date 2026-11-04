/**
 * PF2E REMASTERED — FLANKING GEOMETRY (HEADLESS CORE)
 *
 * Two creatures flank a target when both are able to attack it in melee and
 * they occupy opposite sides or opposite corners of the target's square.
 *
 * For a Medium target on a 5-ft grid this reduces to:
 *   - both creatures are adjacent (orthogonally or diagonally);
 *   - both are within the default 5-ft melee reach;
 *   - neither is defeated;
 *   - the direction from the target to each creature is exactly opposite.
 *
 * Example (target T, attackers A):
 *
 *   A . . . A        A . T . A        A . .
 *   . . T . .   or   . . . . .   or   . T .
 *   . . . . .        . . . . .        . . A   (diagonal corners)
 *
 * The result is pure geometry. Whether the target actually becomes Off-Guard
 * is decided by the Strike action, because a target that already has the
 * Off-Guard condition must not receive the penalty twice.
 *
 * `gridMap` is optional but, when supplied, target and attacker cells must be
 * inside its bounds. This keeps the check honest on partial battlefields.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Grid/grid-math.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Flanking = factory(root.PF2e.Core.Grid);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Grid) {
  "use strict";

  const DEFAULT_REACH_FEET = 5;

  function assertUnit(unit, label) {
    if (
      unit === null ||
      typeof unit !== "object" ||
      !Number.isInteger(unit.x) ||
      !Number.isInteger(unit.y)
    ) {
      throw new TypeError(label + " must be a positioned combatant with integer x and y.");
    }
  }

  function assertAllies(allies) {
    if (allies === undefined || allies === null) {
      return [];
    }
    if (!Array.isArray(allies)) {
      throw new TypeError("allies must be an array of combatants.");
    }
    return allies;
  }

  function normalizeReach(reachFeet) {
    const reach = reachFeet === undefined ? DEFAULT_REACH_FEET : reachFeet;
    if (!Number.isInteger(reach) || reach <= 0 || reach % 5 !== 0) {
      throw new RangeError("reachFeet must be a positive multiple of 5.");
    }
    return reach;
  }

  function isDefeated(unit) {
    return unit.isDefeated === true || unit.currentHP === 0;
  }

  function sameCreature(a, b) {
    if (a === b) {
      return true;
    }
    return a.id !== undefined && b.id !== undefined && a.id === b.id;
  }

  function isHostileTo(unit, target) {
    if (unit.alliance === undefined || target.alliance === undefined) {
      return true;
    }
    return unit.alliance !== target.alliance;
  }

  function inBounds(gridMap, unit) {
    if (!gridMap || typeof gridMap.isInBounds !== "function") {
      return true;
    }
    return gridMap.isInBounds(unit.x, unit.y);
  }

  function sign(value) {
    if (value === 0) {
      return 0;
    }
    return value > 0 ? 1 : -1;
  }

  /**
   * Direction from `target` to `unit` on the square grid.
   * Each component is -1, 0, or 1.
   *
   * @param {{x:number,y:number}} target
   * @param {{x:number,y:number}} unit
   * @returns {{x:number,y:number}}
   */
  function directionFrom(target, unit) {
    return {
      x: sign(unit.x - target.x),
      y: sign(unit.y - target.y),
    };
  }

  function isOppositeDirection(a, b) {
    return a.x === -b.x && a.y === -b.y && !(a.x === 0 && a.y === 0);
  }

  /**
   * Adjacent means one square in any of the eight directions. Combined with the
   * distance check this covers orthogonal and diagonal 5-ft reach.
   */
  function isAdjacent(target, unit) {
    const dx = Math.abs(unit.x - target.x);
    const dy = Math.abs(unit.y - target.y);
    return Math.max(dx, dy) === 1;
  }

  function canReach(target, unit, reachFeet) {
    if (!isAdjacent(target, unit)) {
      return false;
    }
    return Grid.distanceFeet(target, unit) <= reachFeet;
  }

  /**
   * Opposing creatures that actually flank `target`. The attacker is included
   * implicitly and does not need to appear in `allies`, but passing the full
   * roster is safe.
   *
   * @param {object} target
   * @param {object} attacker
   * @param {object[]} allies
   * @param {object} [gridMap]
   * @param {{reachFeet?: number}} [options]
   * @returns {object[]}
   */
  function getFlankingAllies(target, attacker, allies, gridMap, options) {
    assertUnit(target, "target");
    assertUnit(attacker, "attacker");
    const roster = assertAllies(allies);
    const opts = options || {};
    const reachFeet = normalizeReach(opts.reachFeet);

    if (isDefeated(target) || isDefeated(attacker)) {
      return [];
    }
    if (sameCreature(target, attacker) || !isHostileTo(attacker, target)) {
      return [];
    }
    if (!inBounds(gridMap, target) || !inBounds(gridMap, attacker)) {
      return [];
    }
    if (!canReach(target, attacker, reachFeet)) {
      return [];
    }

    const attackerDirection = directionFrom(target, attacker);
    if (attackerDirection.x === 0 && attackerDirection.y === 0) {
      return [];
    }

    const flankers = [];
    for (const ally of roster) {
      if (ally === null || typeof ally !== "object") {
        continue;
      }
      if (!Number.isInteger(ally.x) || !Number.isInteger(ally.y)) {
        continue;
      }
      if (sameCreature(ally, attacker) || sameCreature(ally, target)) {
        continue;
      }
      if (isDefeated(ally) || !isHostileTo(ally, target)) {
        continue;
      }
      if (!inBounds(gridMap, ally) || !canReach(target, ally, reachFeet)) {
        continue;
      }

      const allyDirection = directionFrom(target, ally);
      if (isOppositeDirection(attackerDirection, allyDirection)) {
        flankers.push(ally);
      }
    }

    return flankers;
  }

  /**
   * @param {object} target
   * @param {object} attacker
   * @param {object[]} allies
   * @param {object} [gridMap]
   * @param {{reachFeet?: number}} [options]
   * @returns {boolean}
   */
  function isFlanked(target, attacker, allies, gridMap, options) {
    return getFlankingAllies(target, attacker, allies, gridMap, options).length > 0;
  }

  return Object.freeze({
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    directionFrom: directionFrom,
    isOppositeDirection: isOppositeDirection,
    isAdjacent: isAdjacent,
    getFlankingAllies: getFlankingAllies,
    isFlanked: isFlanked,
  });
});
