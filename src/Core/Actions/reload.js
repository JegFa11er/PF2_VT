/**
 * PF2E REMASTERED — RELOAD ACTION (HEADLESS CORE)
 *
 * Reload is an Interact action whose cost comes from the weapon profile:
 *   - bows and thrown weapons: reload 0 (nothing to spend);
 *   - crossbows: reload 1;
 *   - heavy crossbows: reload 2.
 *
 * A ranged Strike with reload > 0 discharges the weapon (`isLoaded = false`).
 * Reload spends the authored number of actions and sets `isLoaded = true`.
 * Invalid attempts leave the action pool untouched.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Rules/weapon-traits.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Reload = factory(root.PF2e.Core.Rules.WeaponTraits);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (WeaponTraits) {
  "use strict";

  const RELOAD_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
  });

  function assertCombatant(combatant) {
    if (combatant === null || typeof combatant !== "object") {
      throw new TypeError("Reload requires a Combatant.");
    }
    if (typeof combatant.canSpendActions !== "function") {
      throw new TypeError("Reload requires a Combatant with an action pool.");
    }
  }

  /**
   * Resolve the weapon profile for this Reload. A per-call weapon override
   * wins; otherwise use the combatant's authored weapon profile.
   *
   * @param {object} combatant
   * @param {object|string[]} [weapon]
   * @returns {object}
   */
  function resolveWeaponProfile(combatant, weapon) {
    if (weapon !== undefined) {
      return WeaponTraits.getWeaponProfile(weapon);
    }
    if (
      combatant.weapon !== undefined &&
      combatant.weapon !== null &&
      typeof combatant.weapon === "object"
    ) {
      return combatant.weapon;
    }
    if (typeof combatant.getWeapon === "function") {
      return WeaponTraits.getWeaponProfile(combatant.getWeapon());
    }
    return WeaponTraits.getWeaponProfile(combatant);
  }

  /**
   * @param {number} reload
   * @returns {number} actions required to reload from empty
   */
  function getReloadCost(reload) {
    if (!Number.isInteger(reload) || reload < 0) {
      throw new RangeError("reload must be a non-negative integer.");
    }
    return reload > 0 ? reload : 1;
  }

  /**
   * Perform the Reload action.
   *
   * @param {{
   *   combatant: object,
   *   weapon?: object|string[],
   *   forceAction?: boolean
   * }} options
   * @returns {{
   *   ok: boolean,
   *   reason?: string,
   *   actionsLeft?: number,
   *   actionsSpent?: number,
   *   actionsRequired?: number,
   *   reload?: number,
   *   isLoaded?: boolean,
   *   alreadyLoaded?: boolean
   * }}
   */
  function performReload(options) {
    const opts = options || {};
    const combatant = opts.combatant;
    assertCombatant(combatant);

    if (typeof combatant.canAct === "function") {
      const gate = combatant.canAct();
      if (!gate.ok) {
        return {
          ok: false,
          reason: gate.reason,
          actionsLeft: combatant.actionsRemaining,
          isLoaded: combatant.isLoaded !== false,
        };
      }
    }

    const profile = resolveWeaponProfile(combatant, opts.weapon);

    // Already loaded: no action is wasted. A reload-0 weapon that was somehow
    // marked empty is restored immediately.
    if (combatant.isLoaded !== false) {
      return {
        ok: true,
        alreadyLoaded: true,
        actionsSpent: 0,
        actionsLeft: combatant.actionsRemaining,
        reload: profile.reload,
        isLoaded: true,
      };
    }

    if (profile.reload <= 0) {
      combatant.isLoaded = true;
      return {
        ok: true,
        alreadyLoaded: false,
        actionsSpent: 0,
        actionsLeft: combatant.actionsRemaining,
        reload: 0,
        isLoaded: true,
      };
    }

    const cost = getReloadCost(profile.reload);
    if (!combatant.canSpendActions(cost)) {
      return {
        ok: false,
        reason: RELOAD_REASONS.NO_ACTIONS,
        actionsRequired: cost,
        actionsLeft: combatant.actionsRemaining,
        reload: profile.reload,
        isLoaded: false,
      };
    }

    combatant.spendActions(cost);
    combatant.isLoaded = true;

    return {
      ok: true,
      alreadyLoaded: false,
      actionsSpent: cost,
      actionsLeft: combatant.actionsRemaining,
      reload: profile.reload,
      isLoaded: true,
    };
  }

  return Object.freeze({
    RELOAD_REASONS: RELOAD_REASONS,
    getReloadCost: getReloadCost,
    performReload: performReload,
  });
});
