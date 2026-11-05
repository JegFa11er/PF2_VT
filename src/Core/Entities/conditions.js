/**
 * PF2E REMASTERED — CONDITION MANAGER (HEADLESS CORE)
 *
 * Owns the canonical condition records used by Combatant. The manager is
 * intentionally presentation-free: it exposes slugs, labels, values, and the
 * modifier objects each condition contributes to checks, DCs, and AC.
 *
 * Conditions implemented in this slice:
 *   - off-guard: -2 circumstance penalty to AC (not to attack checks).
 *   - prone: Off-Guard (-2 circumstance AC) and -2 circumstance penalty to
 *     attack rolls. The only movement actions available while prone are Stand
 *     and Crawl; Stand is implemented in Actions/stand.js.
 *   - frightened N: -N status penalty to all checks and DCs, including attack
 *     rolls and AC. The value decreases by 1 at the end of the frightened
 *     creature's turn and the condition is removed at 0.
 *   - shield-raised: +2 circumstance bonus to AC until the start of the
 *     raiser's next turn. Combatant.resetTurn() removes it unconditionally.
 *   - greater-cover: +4 circumstance bonus to AC from Take Cover until the
 *     start of the creature's next turn or its next Stride/Step.
 *   - concealed / hidden / undetected: visibility states. They contribute no
 *     AC modifiers; instead a Strike resolves a flat check before the attack
 *     roll. Hidden and Undetected attackers make their target Off-Guard.
 *   - grabbed / restrained: Off-Guard (-2 circumstance AC) plus Immobilized.
 *     Both carry the grappler's `sourceId` and the source turn on which they
 *     expire, so the Encounter can end them on the grappler's turn rather
 *     than the victim's.
 *   - immobilized: no modifiers of its own. Stride, Step, and Stand refuse to
 *     run while it is present. Grabbed and Restrained are treated as
 *     Immobilized even if the companion condition was authored separately.
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
    PRONE: "prone",
    FRIGHTENED: "frightened",
    SHIELD_RAISED: "shield-raised",
    GREATER_COVER: "greater-cover",
    CONCEALED: "concealed",
    HIDDEN: "hidden",
    UNDETECTED: "undetected",
    IMMOBILIZED: "immobilized",
    GRABBED: "grabbed",
    RESTRAINED: "restrained",
  });

  /** Conditions that a Grapple action can apply. */
  const GRAPPLE_CONDITIONS = Object.freeze(["grabbed", "restrained"]);

  /**
   * Conditions that prevent Stride, Step, and Stand. Grabbed and Restrained
   * both include Immobilized, but they are listed here as a defensive fallback
   * for authored or migrated saves that only carry the parent condition.
   */
  const MOVEMENT_BLOCKING_CONDITIONS = Object.freeze([
    "immobilized",
    "grabbed",
    "restrained",
  ]);

  /**
   * Visibility states and the flat check they impose on an attack that targets
   * the creature. `undetected` cannot be targeted directly at all.
   */
  const VISIBILITY_CONDITIONS = Object.freeze({
    concealed: Object.freeze({
      slug: "concealed",
      label: "Concealed",
      flatCheckDC: 5,
      targetable: true,
    }),
    hidden: Object.freeze({
      slug: "hidden",
      label: "Hidden",
      flatCheckDC: 11,
      targetable: true,
    }),
    undetected: Object.freeze({
      slug: "undetected",
      label: "Undetected",
      flatCheckDC: null,
      targetable: false,
    }),
  });

  /** Hidden is stricter than concealed when a creature has both. */
  const VISIBILITY_PRIORITY = Object.freeze(["undetected", "hidden", "concealed"]);

  const DEFINITIONS = Object.freeze({
    "off-guard": Object.freeze({
      slug: "off-guard",
      label: "Off-Guard",
      valued: false,
      description: "-2 circumstance penalty to AC.",
    }),
    prone: Object.freeze({
      slug: "prone",
      label: "Prone",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC) and a -2 circumstance penalty to attack rolls. Stand or Crawl to move.",
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
    "greater-cover": Object.freeze({
      slug: "greater-cover",
      label: "Greater Cover",
      valued: false,
      description:
        "+4 circumstance bonus to AC from Take Cover until the start of the creature's next turn or its next movement.",
    }),
    concealed: Object.freeze({
      slug: "concealed",
      label: "Concealed",
      valued: false,
      description:
        "Attacks against this creature require a DC 5 flat check; a failure misses. The creature's AC is unchanged.",
    }),
    hidden: Object.freeze({
      slug: "hidden",
      label: "Hidden",
      valued: false,
      description:
        "Attacks against this creature require a DC 11 flat check; a failure misses. The creature's AC is unchanged, but its own attacks leave the target Off-Guard.",
    }),
    undetected: Object.freeze({
      slug: "undetected",
      label: "Undetected",
      valued: false,
      description:
        "Enemies do not know the exact position. The creature cannot be selected as a direct target; its own attacks leave the target Off-Guard.",
    }),
    immobilized: Object.freeze({
      slug: "immobilized",
      label: "Immobilized",
      valued: false,
      description:
        "Speed is 0. The creature cannot use move actions such as Stride, Step, or Stand.",
    }),
    grabbed: Object.freeze({
      slug: "grabbed",
      label: "Grabbed",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC) and Immobilized. Ends at the end of the grappler's next turn, or when the grappler moves or is defeated.",
    }),
    restrained: Object.freeze({
      slug: "restrained",
      label: "Restrained",
      valued: false,
      description:
        "Off-Guard (-2 circumstance AC) and Immobilized. In this tactical prototype Restrained uses the same movement and AC effects as Grabbed.",
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
   * `options` carries source-linked metadata used by Grapple:
   *   - `sourceId`: the combatant that applied the condition;
   *   - `expiresOnSourceTurn`: the source combatant's turn number at whose
   *     end the condition expires. The Grapple action sets this to
   *     `source.turnNumber + 1`, implementing "until the end of your next
   *     turn" without expiring on the turn it was applied.
   *
   * @param {string} name
   * @param {number} [value] required for valued conditions, ignored otherwise
   * @param {{sourceId?:string,expiresOnSourceTurn?:number}} [options]
   * @returns {{name:string,slug:string,label:string,value:number|null,sourceId:string|null,expiresOnSourceTurn:number|null}|null}
   */
  function createCondition(name, value, options) {
    const slug = normalizeSlug(name);
    const definition = DEFINITIONS[slug] || null;
    const isValued = definition
      ? definition.valued
      : value !== undefined && value !== null;
    const opts = options || {};
    const sourceId =
      typeof opts.sourceId === "string" && opts.sourceId.trim() !== ""
        ? opts.sourceId
        : null;
    const expiresOnSourceTurn = Number.isInteger(opts.expiresOnSourceTurn)
      ? opts.expiresOnSourceTurn
      : null;

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
        sourceId: sourceId,
        expiresOnSourceTurn: expiresOnSourceTurn,
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
      sourceId: sourceId,
      expiresOnSourceTurn: expiresOnSourceTurn,
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
      sourceId: condition.sourceId === undefined ? null : condition.sourceId,
      expiresOnSourceTurn:
        condition.expiresOnSourceTurn === undefined
          ? null
          : condition.expiresOnSourceTurn,
    };
  }

  /**
   * Normalize a scope argument into a tag set. A scope may be one string or an
   * array of strings. Named scopes expand to their family tag:
   * `"skill:athletics"` also counts as `"skill"`, `"save:reflex"` as `"save"`,
   * and `"dc:reflex"` as `"dc"`.
   *
   * @param {string|string[]|undefined} scope
   * @returns {Set<string>}
   */
  function scopeTags(scope) {
    const tags = new Set();
    if (scope === undefined || scope === null || scope === "all") {
      tags.add("all");
      return tags;
    }

    const list = Array.isArray(scope) ? scope : [scope];
    for (const entry of list) {
      if (typeof entry !== "string" || entry.trim() === "") {
        continue;
      }
      const value = entry.trim().toLowerCase();
      if (value === "all") {
        tags.clear();
        tags.add("all");
        return tags;
      }
      tags.add(value);
      if (value.indexOf("skill:") === 0) {
        tags.add("skill");
      } else if (value.indexOf("save:") === 0) {
        tags.add("save");
      } else if (value.indexOf("dc:") === 0) {
        tags.add("dc");
      }
    }
    return tags;
  }

  /**
   * Modifiers contributed by one condition.
   *
   * Scope values:
   *   - "attack": attack rolls (checks); off-guard does not apply
   *   - "ac": AC (a DC); off-guard and frightened apply
   *   - "check": generic non-AC checks; frightened applies
   *   - "skill:<name>": skill checks; frightened applies (prone applies only
   *     when the caller also requests the attack scope)
   *   - "save:<name>": saving throws; frightened applies
   *   - "dc:<name>": DCs such as Reflex DC; frightened applies
   *   - "all" / undefined: every modifier the condition can contribute
   *
   * Arrays of scopes are supported, so a caller can request
   * `["skill:athletics", "attack"]` for an Athletics check with the attack
   * trait without double-counting Frightened.
   *
   * @param {object} condition
   * @param {string|string[]} [scope]
   * @returns {{name:string,type:string,value:number,source:string}[]}
   */
  function conditionModifiers(condition, scope) {
    const modifiers = [];
    const tags = scopeTags(scope);
    const all = tags.has("all");
    const appliesToAc =
      all || tags.has("ac") || tags.has("dc:ac");
    const appliesToAttack = all || tags.has("attack");

    if (condition.name === CONDITION_SLUGS.OFF_GUARD && appliesToAc) {
      modifiers.push({
        name: "Off-Guard",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    // Prone grants Off-Guard, so its AC contribution uses the same
    // circumstance/source identity as the condition. That lets the resolver
    // suppress a duplicate when Off-Guard is also present.
    if (condition.name === CONDITION_SLUGS.PRONE) {
      if (appliesToAc) {
        modifiers.push({
          name: "Off-Guard (Prone)",
          type: MODIFIER_TYPES.CIRCUMSTANCE,
          value: -2,
          source: "off-guard",
        });
      }
      if (appliesToAttack) {
        modifiers.push({
          name: "Prone",
          type: MODIFIER_TYPES.CIRCUMSTANCE,
          value: -2,
          source: "prone",
        });
      }
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

    // Take Cover upgrades the defender to greater cover. It is a circumstance
    // bonus, so the resolver compares it with Shield Raised and any geometric
    // cover modifier and keeps only the highest.
    if (condition.name === CONDITION_SLUGS.GREATER_COVER && appliesToAc) {
      modifiers.push({
        name: "Greater Cover",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: 4,
        source: "greater-cover",
      });
    }

    // Grabbed and Restrained both impose Off-Guard. Their AC contribution
    // uses the same circumstance/source identity as the Off-Guard condition so
    // the resolver suppresses a duplicate when more than one Off-Guard source
    // is present. Unlike Prone they do not penalize the creature's own attack
    // rolls; their action restriction is Immobilized instead.
    if (
      (condition.name === CONDITION_SLUGS.GRABBED ||
        condition.name === CONDITION_SLUGS.RESTRAINED) &&
      appliesToAc
    ) {
      modifiers.push({
        name:
          condition.name === CONDITION_SLUGS.GRABBED
            ? "Off-Guard (Grabbed)"
            : "Off-Guard (Restrained)",
        type: MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    // Frightened applies to every check and DC, which includes attack rolls,
    // AC, skills, saving throws, and Reflex/Fortitude/Will DCs in this engine.
    // It is therefore valid in every scope and must contribute exactly once.
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

  function hasCondition(combatant, name) {
    return (
      combatant !== null &&
      typeof combatant === "object" &&
      typeof combatant.hasCondition === "function" &&
      combatant.hasCondition(name)
    );
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  function isVisibilityCondition(name) {
    if (typeof name !== "string") {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(
      VISIBILITY_CONDITIONS,
      normalizeSlug(name),
    );
  }

  /**
   * Flat check required to target a creature with this visibility condition,
   * or null when the condition does not allow direct targeting.
   *
   * @param {string} name
   * @returns {number|null}
   */
  function visibilityFlatCheckDC(name) {
    if (typeof name !== "string") {
      return null;
    }
    const definition = VISIBILITY_CONDITIONS[normalizeSlug(name)];
    return definition === undefined ? null : definition.flatCheckDC;
  }

  /**
   * Resolve the strictest visibility state on a creature. Hidden supersedes
   * concealed, and undetected supersedes both.
   *
   * @param {object} combatant
   * @returns {{
   *   condition: string|null,
   *   label: string|null,
   *   flatCheckDC: number|null,
   *   targetable: boolean,
   *   undetected: boolean
   * }}
   */
  function getVisibility(combatant) {
    for (const slug of VISIBILITY_PRIORITY) {
      if (hasCondition(combatant, slug)) {
        const definition = VISIBILITY_CONDITIONS[slug];
        return {
          condition: definition.slug,
          label: definition.label,
          flatCheckDC: definition.flatCheckDC,
          targetable: definition.targetable,
          undetected: definition.slug === "undetected",
        };
      }
    }

    return {
      condition: null,
      label: null,
      flatCheckDC: null,
      targetable: true,
      undetected: false,
    };
  }

  /**
   * A hidden or undetected attacker leaves its target Off-Guard against its
   * own attack. This is a boolean helper only; the Strike action injects the
   * circumstance penalty through the modifier resolver.
   *
   * @param {object} combatant
   * @returns {boolean}
   */
  function isHiddenAttacker(combatant) {
    return (
      hasCondition(combatant, CONDITION_SLUGS.HIDDEN) ||
      hasCondition(combatant, CONDITION_SLUGS.UNDETECTED)
    );
  }

  /**
   * A creature is immobilized while it has the Immobilized condition or any
   * grapple condition that implies it. This is the single predicate used by
   * Stride, Step, Stand, and the View, so the rule is not duplicated.
   *
   * @param {object} combatant
   * @returns {boolean}
   */
  function isImmobilized(combatant) {
    for (const slug of MOVEMENT_BLOCKING_CONDITIONS) {
      if (hasCondition(combatant, slug)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The active grapple condition on a creature. Restrained supersedes Grabbed
   * because it is the stronger state, even if both records exist.
   *
   * @param {object} combatant
   * @returns {object|null}
   */
  function getGrappleCondition(combatant) {
    if (hasCondition(combatant, CONDITION_SLUGS.RESTRAINED)) {
      return combatant.getCondition(CONDITION_SLUGS.RESTRAINED);
    }
    if (hasCondition(combatant, CONDITION_SLUGS.GRABBED)) {
      return combatant.getCondition(CONDITION_SLUGS.GRABBED);
    }
    return null;
  }

  /**
   * Remove every grapple condition and the companion Immobilized record that
   * a single source applied to a combatant. Conditions from other sources are
   * left untouched.
   *
   * The Combatant owns the actual store; this helper only adapts a roster to
   * that API so movement and Encounter code can call one function.
   *
   * @param {object[]} combatants
   * @param {string} sourceId
   * @returns {{combatant:object,removed:object[]}[]}
   */
  function releaseGrapplesBySource(combatants, sourceId) {
    if (!Array.isArray(combatants) || typeof sourceId !== "string") {
      return [];
    }
    const released = [];
    for (const combatant of combatants) {
      if (
        combatant === null ||
        typeof combatant !== "object" ||
        typeof combatant.releaseGrappleFrom !== "function"
      ) {
        continue;
      }
      const removed = combatant.releaseGrappleFrom(sourceId);
      if (removed.length > 0) {
        released.push({
          combatant: combatant,
          combatantId: combatant.id,
          combatantName: combatant.name,
          removed: removed,
        });
      }
    }
    return released;
  }

  return Object.freeze({
    CONDITION_SLUGS: CONDITION_SLUGS,
    CONDITIONS: CONDITION_SLUGS,
    DEFINITIONS: DEFINITIONS,
    CONDITION_DEFINITIONS: DEFINITIONS,
    VISIBILITY_CONDITIONS: VISIBILITY_CONDITIONS,
    VISIBILITY_PRIORITY: VISIBILITY_PRIORITY,
    GRAPPLE_CONDITIONS: GRAPPLE_CONDITIONS,
    MOVEMENT_BLOCKING_CONDITIONS: MOVEMENT_BLOCKING_CONDITIONS,
    isKnownCondition: isKnownCondition,
    isVisibilityCondition: isVisibilityCondition,
    visibilityFlatCheckDC: visibilityFlatCheckDC,
    getVisibility: getVisibility,
    isHiddenAttacker: isHiddenAttacker,
    isImmobilized: isImmobilized,
    getGrappleCondition: getGrappleCondition,
    releaseGrapplesBySource: releaseGrapplesBySource,
    createCondition: createCondition,
    copyCondition: copyCondition,
    conditionModifiers: conditionModifiers,
  });
});
