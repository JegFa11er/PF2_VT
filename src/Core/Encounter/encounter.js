/**
 * PF2E REMASTERED — ENCOUNTER / INITIATIVE ENGINE (HEADLESS CORE)
 *
 * Owns the initiative order, the active combatant, and the round counter.
 *
 * Rules implemented:
 *   - Combatants act in descending initiative order.
 *   - Equal initiatives keep their declaration order (deterministic tie-break).
 *   - Starting an encounter sets round 1 and resets every combatant's turn.
 *   - Advancing past the last combatant increments the round and wraps to the
 *     first combatant.
 *   - Every newly active combatant gets resetTurn() before acting.
 *   - The outgoing combatant gets endTurn() so timed conditions such as
 *     Frightened decay at the correct moment.
 *   - Defeated combatants remain in the roster but are skipped by the turn
 *     cycle. When no living combatant remains, activeCombatant becomes null.
 *
 * No presentation state and no combat math live here.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Entities/conditions.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Encounter = factory(root.PF2e.Core.Conditions);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Conditions) {
  "use strict";

  function assertCombatants(combatants) {
    if (!Array.isArray(combatants) || combatants.length === 0) {
      throw new TypeError("Encounter requires a non-empty combatants array.");
    }

    const ids = new Set();
    for (const combatant of combatants) {
      if (combatant === null || typeof combatant !== "object") {
        throw new TypeError("Every combatant must be an object.");
      }
      if (typeof combatant.id !== "string" || combatant.id.trim() === "") {
        throw new TypeError("Every combatant must have a non-empty string id.");
      }
      if (typeof combatant.resetTurn !== "function") {
        throw new TypeError("Every combatant must implement resetTurn().");
      }
      if (!Number.isInteger(combatant.initiative)) {
        throw new TypeError("Every combatant must have an integer initiative.");
      }
      if (ids.has(combatant.id)) {
        throw new RangeError("Duplicate combatant id: " + combatant.id + ".");
      }
      ids.add(combatant.id);
    }
  }

  function sortStable(combatants) {
    return combatants
      .map(function (combatant, index) {
        return { combatant: combatant, index: index };
      })
      .sort(function (a, b) {
        return (
          b.combatant.initiative - a.combatant.initiative || a.index - b.index
        );
      })
      .map(function (entry) {
        return entry.combatant;
      });
  }

  class Encounter {
    constructor(options) {
      const opts = options || {};
      assertCombatants(opts.combatants);

      this.combatants = sortStable(opts.combatants.slice());
      this.round = 0;
      this.activeCombatantIndex = -1;
      this.started = false;
      this.over = false;
    }

    get activeCombatant() {
      if (!this.started || this.activeCombatantIndex < 0) {
        return null;
      }
      return this.combatants[this.activeCombatantIndex] || null;
    }

    get isStarted() {
      return this.started;
    }

    get isOver() {
      return this.over || this.livingCombatants.length === 0;
    }

    get livingCombatants() {
      return this.combatants.filter(function (combatant) {
        return !Encounter.isDefeated(combatant);
      });
    }

    static isDefeated(combatant) {
      return combatant.isDefeated === true || combatant.currentHP === 0;
    }

    /** First living index at or after startIndex, or -1. */
    _findLivingFrom(startIndex) {
      const length = this.combatants.length;
      for (let step = 0; step < length; step += 1) {
        const index = (startIndex + step) % length;
        if (!Encounter.isDefeated(this.combatants[index])) {
          return index;
        }
      }
      return -1;
    }

    /**
     * @returns {object|null} the first living combatant, or null if none
     */
    startEncounter() {
      this.combatants = sortStable(this.combatants);
      for (const combatant of this.combatants) {
        // Starting an encounter is not the end of anyone's turn. Conditions
        // must not tick here.
        combatant.resetTurn({ tickConditions: false });
      }
      this.round = 1;
      this.started = true;

      const index = this._findLivingFrom(0);
      if (index === -1) {
        this.activeCombatantIndex = -1;
        this.over = true;
        return null;
      }

      this.activeCombatantIndex = index;
      this.over = false;
      return this.activeCombatant;
    }

    /**
     * Advance the initiative pointer. Wrapping past the last combatant starts
     * the next round. The incoming active combatant always gets a fresh turn.
     *
     * The outgoing combatant's endTurn() resolves Frightened decay and
     * persistent damage. Optional die callbacks are forwarded so a host/test
     * can keep the tick deterministic.
     *
     * @param {{rollDie?:Function,rollDamageDie?:Function,rollD20?:Function,rollFlatCheck?:Function}} [options]
     * @returns {{
     *   active: object,
     *   previous: object | null,
     *   round: number,
     *   wrapped: boolean,
     *   index: number,
     *   conditionTick: object|null,
     *   persistentTick: object|null
     * }}
     */
    nextTurn(options) {
      if (!this.started) {
        const active = this.startEncounter();
        return {
          active: active,
          previous: null,
          round: this.round,
          wrapped: false,
          index: this.activeCombatantIndex,
          conditionTick: null,
          persistentTick: null,
          releasedGrapples: [],
        };
      }

      const previous = this.activeCombatant;
      // A defeated grappler cannot maintain a hold. Clean up before the next
      // creature acts so no stale Grabbed/Restrained state survives the death.
      const releasedGrapples = this.releaseGrapplesFromDefeated();
      const endTurnOptions = Object.assign({}, options || {}, {
        combatants: this.combatants,
      });
      const endTurnResult =
        previous && typeof previous.endTurn === "function"
          ? previous.endTurn(endTurnOptions)
          : null;
      const conditionTick = endTurnResult;
      const persistentTick =
        endTurnResult && endTurnResult.persistentTick
          ? endTurnResult.persistentTick
          : null;
      if (endTurnResult && Array.isArray(endTurnResult.releasedGrapples)) {
        for (const entry of endTurnResult.releasedGrapples) {
          releasedGrapples.push(entry);
        }
      }
      const length = this.combatants.length;
      let index = this.activeCombatantIndex;
      let wrapped = false;
      let nextIndex = -1;

      // Step forward until a living combatant is found. Passing the end of the
      // order advances the round exactly once, even when many defeated
      // combatants are skipped.
      for (let step = 0; step < length; step += 1) {
        index += 1;
        if (index >= length) {
          index = 0;
          this.round += 1;
          wrapped = true;
        }
        if (!Encounter.isDefeated(this.combatants[index])) {
          nextIndex = index;
          break;
        }
      }

      if (nextIndex === -1) {
        this.activeCombatantIndex = -1;
        this.over = true;
        return {
          active: null,
          previous: previous,
          round: this.round,
          wrapped: wrapped,
          index: -1,
          conditionTick: conditionTick,
          persistentTick: persistentTick,
          releasedGrapples: releasedGrapples,
        };
      }

      this.activeCombatantIndex = nextIndex;
      this.over = false;

      const active = this.activeCombatant;
      // The outgoing combatant already received its end-of-turn tick above.
      active.resetTurn({ tickConditions: false });

      return {
        active: active,
        previous: previous,
        round: this.round,
        wrapped: wrapped,
        index: this.activeCombatantIndex,
        conditionTick: conditionTick,
        persistentTick: persistentTick,
        releasedGrapples: releasedGrapples,
      };
    }

    /**
     * Break all grapples maintained by defeated combatants. Called at the
     * start of nextTurn so a slain grappler cannot keep a victim immobilized.
     *
     * @returns {{combatant:object,combatantId:string,combatantName:string,removed:object[]}[]}
     */
    releaseGrapplesFromDefeated() {
      const released = [];
      for (const combatant of this.combatants) {
        if (!Encounter.isDefeated(combatant)) {
          continue;
        }
        const entries = Conditions.releaseGrapplesBySource(
          this.combatants,
          combatant.id,
        );
        for (const entry of entries) {
          released.push(entry);
        }
      }
      return released;
    }

    /**
     * @param {object|string} combatantOrId
     * @returns {boolean}
     */
    isActive(combatantOrId) {
      const active = this.activeCombatant;
      if (!active) {
        return false;
      }
      if (typeof combatantOrId === "string") {
        return active.id === combatantOrId;
      }
      return active === combatantOrId || active.id === combatantOrId.id;
    }

    /**
     * @returns {object[]} initiative order, highest first (copy)
     */
    getOrder() {
      return this.combatants.slice();
    }

    /**
     * Index of a combatant in the current order, or -1.
     *
     * @param {object|string} combatantOrId
     * @returns {number}
     */
    indexOf(combatantOrId) {
      const id =
        typeof combatantOrId === "string" ? combatantOrId : combatantOrId.id;
      return this.combatants.findIndex(function (combatant) {
        return combatant.id === id;
      });
    }
  }

  return Encounter;
});
