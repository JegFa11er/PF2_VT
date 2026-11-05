/**
 * PF2E REMASTERED — STRIDE ACTION (HEADLESS CORE)
 *
 * PF2e Stride: 1 action, move up to Speed along a valid path.
 * The action is spent only after a reachable route within Speed is found.
 *
 * Reactive Strike window:
 *   - Before each step of the route the mover leaves its current square.
 *   - If a living hostile with a reaction threatens that square within reach,
 *     the first such enemy automatically spends 1 reaction and makes a
 *     Reactive Strike. The attack ignores MAP (see reactive-strike.js).
 *   - A defeated mover stops immediately on the square it was leaving; the
 *     remaining route is discarded.
 *   - Step uses a separate action and deliberately never enters this scan.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Grid/pathfinding.js"),
      require("./reactive-strike.js"),
      require("../Entities/conditions.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Stride = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.Pathfinding,
      root.PF2e.Core.Actions.ReactiveStrike,
      root.PF2e.Core.Conditions,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  Pathfinding,
  ReactiveStrike,
  Conditions,
) {
  "use strict";

  const STRIDE_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    IMMOBILIZED: "immobilized",
    ALREADY_THERE: "already-there",
    OUT_OF_BOUNDS: "out-of-bounds",
    BLOCKED_START: "blocked-start",
    BLOCKED_DESTINATION: "blocked-destination",
    DESTINATION_OCCUPIED: "destination-occupied",
    UNREACHABLE: "unreachable",
    EXCEEDS_SPEED: "exceeds-speed",
  });

  const DEFAULT_REACH_FEET = 5;

  function mapPathfindingFailure(reason) {
    if (reason === "out-of-bounds") {
      return STRIDE_REASONS.OUT_OF_BOUNDS;
    }
    if (reason === "blocked-start") {
      return STRIDE_REASONS.BLOCKED_START;
    }
    if (reason === "blocked-goal") {
      return STRIDE_REASONS.BLOCKED_DESTINATION;
    }
    if (reason === "goal-occupied") {
      return STRIDE_REASONS.DESTINATION_OCCUPIED;
    }
    return STRIDE_REASONS.UNREACHABLE;
  }

  function normalizeReach(reachFeet) {
    const reach = reachFeet === undefined ? DEFAULT_REACH_FEET : reachFeet;
    if (!Number.isInteger(reach) || reach <= 0 || reach % 5 !== 0) {
      throw new RangeError("reachFeet must be a positive multiple of 5.");
    }
    return reach;
  }

  function normalizeCombatants(options) {
    if (Array.isArray(options.combatants)) {
      return options.combatants;
    }
    if (Array.isArray(options.allies)) {
      return options.allies;
    }
    return [];
  }

  function stepCostFeet(map, destination, diagonalIndex) {
    const diagonal = destination.diagonal === true;
    let cost = diagonal
      ? Grid.diagonalStepCostFeet(diagonalIndex)
      : Grid.FEET_PER_SQUARE;
    if (
      typeof map.hasDifficultTerrain === "function" &&
      map.hasDifficultTerrain(destination.x, destination.y)
    ) {
      cost += Grid.DIFFICULT_TERRAIN_EXTRA_FEET;
    }
    return cost;
  }

  /**
   * Walk the validated route one square at a time, checking the Reactive
   * Strike window before each departure. Mutates the combatant's position and
   * diagonal-step counter.
   */
  function traversePath(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const map = opts.map;
    const path = opts.path;
    const roster = normalizeCombatants(opts);
    // Do not force the default 5 ft here: each threatening enemy contributes
    // its own weapon reach (`reach` trait = 10 ft). An explicit override is
    // forwarded as-is for tests and special effects.
    const reachOverride = opts.reachFeet;

    const startDiagonalSteps = Number.isInteger(combatant.diagonalStepsThisTurn)
      ? combatant.diagonalStepsThisTurn
      : 0;
    const movedPath = [{ x: path[0].x, y: path[0].y }];
    const reactions = [];
    let movedCostFeet = 0;
    let movedDiagonalSteps = 0;
    let interrupted = false;
    let stoppedAt = null;

    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const to = path[index];

      // The trigger is checked while the mover is still on `from`. Step never
      // reaches this path because Step owns its own one-square movement.
      if (roster.length > 0) {
        const threats = ReactiveStrike.findThreatenedEnemies({
          mover: combatant,
          cell: from,
          combatants: roster,
          reachFeet: reachOverride,
        });

        for (const enemy of threats) {
          const reaction = ReactiveStrike.performReactiveStrike({
            attacker: enemy,
            target: combatant,
            map: map,
            reachFeet: reachOverride,
            combatants: roster,
            allies: roster,
            rollD20: opts.rollD20,
            rollDamageDie: opts.rollDamageDie,
            rollDie: opts.rollDie,
          });

          // A failed attempt (for example no line of sight) spends nothing;
          // try the next eligible enemy, otherwise keep moving.
          if (reaction.ok) {
            reactions.push(reaction);
            break;
          }
        }

        if (combatant.isDefeated === true) {
          interrupted = true;
          stoppedAt = { x: from.x, y: from.y };
          break;
        }
      }

      const diagonal = from.x !== to.x && from.y !== to.y;
      movedCostFeet += stepCostFeet(
        map,
        { x: to.x, y: to.y, diagonal: diagonal },
        diagonal ? (startDiagonalSteps + movedDiagonalSteps) % 2 : 0,
      );
      if (diagonal) {
        movedDiagonalSteps += 1;
      }

      combatant.setPosition(to.x, to.y);
      movedPath.push({ x: to.x, y: to.y });
    }

    combatant.registerDiagonalSteps(movedDiagonalSteps);

    return {
      reactions: reactions,
      reaction: reactions.length > 0 ? reactions[0] : null,
      movementInterrupted: interrupted,
      stoppedAt: stoppedAt,
      movedPath: movedPath,
      movedCostFeet: movedCostFeet,
      movedDiagonalSteps: movedDiagonalSteps,
      destinationReached: !interrupted,
    };
  }

  /**
   * @param {{
   *   combatant: object,
   *   map: object,
   *   destination: {x:number,y:number},
   *   diagonalCornerPolicy?: string,
   *   occupancy?: object,
   *   combatants?: object[],
   *   allies?: object[],
   *   reachFeet?: number,
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides:number) => number,
   *   rollDie?: (sides:number) => number
   * }} options
   * @returns {{
   *   ok: true, path: {x:number,y:number}[], costFeet: number,
   *   actionsLeft: number, diagonalSteps: number, diagonalParity: number,
   *   reactions: object[], reaction: object|null,
   *   movementInterrupted: boolean, stoppedAt: {x:number,y:number}|null,
   *   movedPath: {x:number,y:number}[], movedCostFeet: number,
   *   movedDiagonalSteps: number, destinationReached: boolean
   * } | {
   *   ok: false, reason: string, path?: {x:number,y:number}[], costFeet?: number
   * }}
   */
  function performStride(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    const map = opts.map;
    const destination = opts.destination;

    if (!combatant || typeof combatant.canSpendActions !== "function") {
      throw new TypeError("performStride requires a Combatant instance.");
    }
    if (!map) {
      throw new TypeError("performStride requires a GridMap.");
    }
    if (destination === null || typeof destination !== "object") {
      throw new TypeError("performStride requires a destination cell.");
    }

    if (!combatant.canSpendActions(1)) {
      return { ok: false, reason: STRIDE_REASONS.NO_ACTIONS };
    }

    // Immobilized (including Grabbed/Restrained) sets Speed to 0 and forbids
    // move actions. Reject before any geometry or die roll.
    if (
      (typeof combatant.isImmobilized === "function" && combatant.isImmobilized()) ||
      Conditions.isImmobilized(combatant)
    ) {
      return { ok: false, reason: STRIDE_REASONS.IMMOBILIZED };
    }

    if (destination.x === combatant.x && destination.y === combatant.y) {
      return { ok: false, reason: STRIDE_REASONS.ALREADY_THERE };
    }

    const result = Pathfinding.findPath(
      { x: combatant.x, y: combatant.y },
      { x: destination.x, y: destination.y },
      {
        map: map,
        startDiagonalParity: combatant.diagonalParity,
        diagonalCornerPolicy: opts.diagonalCornerPolicy,
        occupancy: opts.occupancy,
      },
    );

    if (!result.found) {
      return { ok: false, reason: mapPathfindingFailure(result.reason) };
    }

    if (result.costFeet > combatant.speedFeet) {
      return {
        ok: false,
        reason: STRIDE_REASONS.EXCEEDS_SPEED,
        path: result.path,
        costFeet: result.costFeet,
      };
    }

    combatant.spendActions(1);

    const movement = traversePath({
      combatant: combatant,
      map: map,
      path: result.path,
      combatants: opts.combatants,
      allies: opts.allies,
      reachFeet: opts.reachFeet,
      rollD20: opts.rollD20,
      rollDamageDie: opts.rollDamageDie,
      rollDie: opts.rollDie,
    });

    // Take Cover's greater cover ends as soon as the creature moves, even if
    // the Stride was interrupted by a Reactive Strike.
    if (typeof combatant.removeCondition === "function") {
      combatant.removeCondition("greater-cover");
    }

    // A grappler that moves loses its hold. This is checked once the action is
    // committed, before the target can act again.
    const releasedGrapples = Conditions.releaseGrapplesBySource(
      normalizeCombatants(opts),
      combatant.id,
    );

    return Object.assign(
      {
        ok: true,
        path: result.path,
        costFeet: result.costFeet,
        actionsLeft: combatant.actionsRemaining,
        diagonalSteps: result.diagonalSteps,
        diagonalParity: combatant.diagonalParity,
        releasedGrapples: releasedGrapples,
      },
      movement,
    );
  }

  return Object.freeze({
    STRIDE_REASONS: STRIDE_REASONS,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    performStride: performStride,
    traversePath: traversePath,
  });
});
