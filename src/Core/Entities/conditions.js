/**
 * PF2E REMASTERED — CONDITION MANAGER (HEADLESS CORE)
 *
 * Owns the canonical condition records used by Combatant. The manager is
 * intentionally presentation-free: it exposes slugs, labels, values, and the
 * modifier objects each condition contributes to checks, DCs, and AC.
 *
 * Conditions implemented in this slice:
 *   - off-guard: -2 circumstance penalty to AC (not to attack checks).
 *   - frightened N: -N status penalty to all checks and DCs, including attack
 *     rolls and AC. The value decreases by 1 at the end of the frightened
 *     creature's turn and the condition is removed at 0.
 *   - shield-raised: +2 circumstance bonus to AC until the start of the
 *     raiser's next turn. Combatant.resetTurn() removes it unconditionally.
 *
 * Unknown condition slugs are stored for forward compatibility but contribute
 * no modifiers until a definition is added here.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../Rules/modifiers.js"));
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Conditions = factory(root.PF2e.Core.Rules.Modifiers);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Modifiers) {
  "use strict";

  const MODIFIER_TYPES = Modifiers.MODIFIER_TYPES;

  const CONDITION_SLUGS = Object.freeze({
    OFF_GUARD: "off-guard",
    FRIGHTENED: "frightened",
    SHIELD_RAISED: "shield-raised",
  });

  const DEFINITIONS = Object.freeze({
    "off-guard": Object.freeze({
      slug: "off-guard",
      label: "Off-Guard",
      valued: false,
      description: "-2 circumstance penalty to AC.",
    }),
    frightened: Object.freeze({
      slug: "frightened",
      label: "Frightened",
      valued: true,
      description:
        "Status penalty equal to the value to all checks and DCs; decreases by 1 at the end of each turn.",
    }),
    "shield-raised": Object.freeze({
      slug: "shield-raised",
      label: "Shield Raised",
      valued: false,
      description:
        "+2 circumstance bonus to AC until the start of the raiser's next turn.",
    }),
  });

  function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
  }

  function normalizeSlug(name) {
    assertNonEmptyString(name, "condition name");
    return name.trim().toLowerCase();
  }

  function prettifySlug(slug) {
    return slug
      .split("-")
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" ");
  }

  function isKnownCondition(name) {
    return Object.prototype.hasOwnProperty.call(DEFINITIONS, normalizeSlug(name));
  }

  /**
   * Build a normalized condition record. Frightened 0 removes the condition,
   * so this helper returns null for it.
   *
   * @param {string} name
   * @param {number} [value] required for valued conditions, ignored otherwise
   * @returns {{name:string,slug:string,label:string,value:number|null}|null}
   */
  function createCondition(name, value) {
    const slug = normalizeSlug(name);
    const definition = DEFINITIONS[slug] || null;
    const isValued = definition
      ? definition.valued
      : value !== undefined && value !== null;

    if (isValued) {
      const actualValue = value === undefined ? 1 : value;
      if (!Number.isInteger(actualValue) || actualValue < 0) {
        throw new RangeError(
          "condition " + slug + " value must be a non-negative integer; received " +
            String(actualValue) +
            ".",
        );
      }
      if (actualValue === 0) {
        return null;
      }
      return {
        name: slug,
        slug: slug,
        label: (definition ? definition.label : prettifySlug(slug)) + " " + actualValue,
        value: actualValue,
      };
    }

    if (value !== undefined && value !== null) {
      if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(
          "condition " + slug + " value must be a non-negative integer.",
        );
      }
    }

    return {
      name: slug,
      slug: slug,
      label: definition ? definition.label : prettifySlug(slug),
      value: null,
    };
  }

  /**
   * Copy a condition so callers cannot mutate the Combatant's internal store.
   */
  function copyCondition(condition) {
    return {
      name: condition.name,
      slug: condition.slug,
      label: condition.label,
      value: condition.value,
    };
  }

  /**
   * Modifiers contributed by one condition.
   *
   * Scope values:
   *   - "attack": attack rolls (checks); off-guard does not apply
   *   - "ac": AC (a DC); off-guard and frightened apply
   *   - "check": non-AC checks; frightened applies
   *   - "all" / undefined: every modifier the condition can contribute
   *
   * @param {object} condition
   * @param {"attack"|"ac"|"check"|"all"} [scope]
   * @returns {{name:string,type:string,value:number,source:string}[]}
   */
  function conditionModifiers(condition, scope) {
    const modifiers = [];
    const appliesToAc = scope === undefined || scope === "ac" || scope === "all";

    if (condition.name === CONDITION_SLUGS.OFF_GUARD && appliesToAc) {
      modifiers.push({
        name: "Off-Guard",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    // A raised shield is an AC-only circumstance bonus. The resolver keeps
    // this bonus separate from any circumstance penalty (for example
    // Off-Guard), so both contribute to the final AC.
    if (condition.name === CONDITION_SLUGS.SHIELD_RAISED && appliesToAc) {
      modifiers.push({
        name: "Shield Raised",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: 2,
        source: "shield-raised",
      });
    }

    // Frightened applies to every check and DC, which includes both attack
    // rolls and AC in this engine. It is therefore valid in every scope.
    if (condition.name === CONDITION_SLUGS.FRIGHTENED && condition.value > 0) {
      modifiers.push({
        name: "Frightened " + condition.value,
        type: MODIFIER_TYPES.STATUS,
        value: -condition.value,
        source: "frightened",
      });
    }

    return modifiers;
  }

  return Object.freeze({
    CONDITION_SLUGS: CONDITION_SLUGS,
    CONDITIONS: CONDITION_SLUGS,
    DEFINITIONS: DEFINITIONS,
    CONDITION_DEFINITIONS: DEFINITIONS,
    isKnownCondition: isKnownCondition,
    createCondition: createCondition,
    copyCondition: copyCondition,
    conditionModifiers: conditionModifiers,
  });
});
