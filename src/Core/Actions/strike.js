/**
 * PF2E REMASTERED — STRIKE ACTION (HEADLESS CORE)
 *
 * One-action melee Strike:
 *   - reach is 5 feet by default (adjacent orthogonal or diagonal cell);
 *   - the target must be a living hostile visible via centre-to-centre LoS;
 *   - the attack resolves base attack bonus + conditions (Frightened) + MAP
 *     [untyped] through the central modifier resolver;
 *   - the target resolves base AC + conditions (Off-Guard, Frightened, Shield
 *     Raised) and flanking through the same resolver;
 *   - the check resolves through the four degrees of success;
 *   - a success deals damage, a critical success doubles total damage;
 *   - damage is applied to the target's HP, marking it defeated at 0.
 *
 * The host may inject deterministic die callbacks for both the d20 and damage
 * dice. Invalid attempts consume no action, no MAP increment, and no dice.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Grid/los-math.js"),
      require("../Rules/checks.js"),
      require("../Rules/damage.js"),
      require("../Rules/map.js"),
      require("../Rules/modifiers.js"),
      require("../Grid/flanking.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.Strike = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.LosMath,
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Flanking,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  LosMath,
  Checks,
  Damage,
  MultipleAttack,
  Modifiers,
  Flanking,
) {
  "use strict";

  const STRIKE_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    INVALID_TARGET: "invalid-target",
    ALLY: "ally",
    OUT_OF_REACH: "out-of-reach",
    NO_LINE_OF_SIGHT: "no-line-of-sight",
    ATTACKER_DEFEATED: "attacker-defeated",
    TARGET_DEFEATED: "target-defeated",
  });

  const DEFAULT_REACH_FEET = 5;
  const DEFAULT_AC = 10;
  const DEFAULT_ATTACK_BONUS = 0;
  const DEFAULT_DAMAGE = "1d4";

  function assertCombatant(combatant, label) {
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError(label + " must be a positioned Combatant.");
    }
    if (typeof combatant.alliance !== "string") {
      throw new TypeError(label + " must declare an alliance.");
    }
  }

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function normalizeReach(reachFeet) {
    const reach = reachFeet === undefined ? DEFAULT_REACH_FEET : reachFeet;
    if (!Number.isInteger(reach) || reach <= 0 || reach % 5 !== 0) {
      throw new RangeError("reachFeet must be a positive multiple of 5.");
    }
    return reach;
  }

  function normalizeAttackBonus(options, attacker) {
    if (options.attackBonus !== undefined) {
      assertInteger(options.attackBonus, "attackBonus");
      return options.attackBonus;
    }
    return Number.isInteger(attacker.attackBonus)
      ? attacker.attackBonus
      : DEFAULT_ATTACK_BONUS;
  }

  function normalizeTargetAC(options, target) {
    if (options.targetAC !== undefined) {
      assertInteger(options.targetAC, "targetAC");
      return options.targetAC;
    }
    return Number.isInteger(target.ac) ? target.ac : DEFAULT_AC;
  }

  function normalizeDamageFormula(options, attacker) {
    if (options.damage !== undefined) {
      Damage.parseDamageFormula(options.damage);
      return options.damage;
    }
    return typeof attacker.damage === "string" ? attacker.damage : DEFAULT_DAMAGE;
  }

  function normalizeAgile(options, attacker) {
    if (options.agile !== undefined) {
      if (typeof options.agile !== "boolean") {
        throw new TypeError("agile must be a boolean.");
      }
      return options.agile;
    }
    return attacker.agile === true;
  }

  function currentMapPenalty(attacker, agile) {
    if (typeof attacker.getMultipleAttackPenalty === "function") {
      return attacker.getMultipleAttackPenalty(agile);
    }
    const attacksMade = Number.isInteger(attacker.attacksThisTurn)
      ? attacker.attacksThisTurn
      : 0;
    return MultipleAttack.multipleAttackPenalty(attacksMade, agile);
  }

  function normalizeAllies(options) {
    if (Array.isArray(options.allies)) {
      return options.allies;
    }
    if (Array.isArray(options.combatants)) {
      return options.combatants;
    }
    return [];
  }

  function detectFlanking(attacker, target, options, reachFeet) {
    const flankers = Flanking.getFlankingAllies(
      target,
      attacker,
      normalizeAllies(options),
      options.map,
      { reachFeet: reachFeet },
    );
    return {
      flanked: flankers.length > 0,
      flankers: flankers.map(function (combatant) {
        return { id: combatant.id, name: combatant.name };
      }),
    };
  }

  function hasOffGuard(target) {
    return (
      typeof target.hasCondition === "function" &&
      target.hasCondition("off-guard")
    );
  }

  /**
   * Attack-side modifiers: the attacker's frightened (status) and the current
   * Multiple Attack Penalty (untyped). Off-Guard never applies to attacks.
   */
  function collectAttackModifiers(attacker, mapPenalty) {
    const modifiers =
      typeof attacker.getConditionModifiers === "function"
        ? attacker.getConditionModifiers("attack")
        : [];

    const result = modifiers.slice();
    if (mapPenalty !== 0) {
      result.push({
        name: "MAP",
        type: Modifiers.MODIFIER_TYPES.UNTYPED,
        value: mapPenalty,
        source: "multiple-attack-penalty",
      });
    }
    return result;
  }

  /**
   * Defense-side modifiers: the target's conditions (Off-Guard, Frightened,
   * Shield Raised) plus flanking. A target that already has Off-Guard must not
   * receive a second circumstance penalty from being flanked. The resolver
   * keeps the Shield Raised circumstance bonus independent from the Off-Guard
   * circumstance penalty, so both appear in the breakdown.
   */
  function collectDefenseModifiers(target, flanked) {
    const modifiers =
      typeof target.getConditionModifiers === "function"
        ? target.getConditionModifiers("ac")
        : [];

    const result = modifiers.slice();
    const alreadyOffGuard =
      hasOffGuard(target) ||
      result.some(function (modifier) {
        return modifier.source === "off-guard";
      });

    if (flanked && !alreadyOffGuard) {
      result.push({
        name: "Off-Guard",
        type: Modifiers.MODIFIER_TYPES.CIRCUMSTANCE,
        value: -2,
        source: "off-guard",
      });
    }

    return result;
  }

  /**
   * Validation without spending an action or rolling dice.
   *
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   reachFeet?: number,
   *   allies?: object[]
   * }} options
   * @returns {{
   *   ok:true, distanceFeet:number, reachFeet:number, lineOfSight:true
   * } | {ok:false, reason:string, distanceFeet?:number}}
   */
  function evaluateStrike(options) {
    const opts = options || {};
    assertCombatant(opts.attacker, "attacker");
    assertCombatant(opts.target, "target");
    if (!opts.map || typeof opts.map.hasObstacle !== "function") {
      throw new TypeError("Strike requires a GridMap.");
    }

    const attacker = opts.attacker;
    const target = opts.target;
    const reachFeet = normalizeReach(opts.reachFeet);

    if (attacker.isDefeated === true) {
      return { ok: false, reason: STRIKE_REASONS.ATTACKER_DEFEATED };
    }
    if (attacker === target) {
      return { ok: false, reason: STRIKE_REASONS.INVALID_TARGET };
    }
    if (
      attacker.id !== undefined &&
      target.id !== undefined &&
      attacker.id === target.id
    ) {
      return { ok: false, reason: STRIKE_REASONS.INVALID_TARGET };
    }
    if (attacker.x === target.x && attacker.y === target.y) {
      return { ok: false, reason: STRIKE_REASONS.INVALID_TARGET };
    }
    if (attacker.alliance === target.alliance) {
      return { ok: false, reason: STRIKE_REASONS.ALLY };
    }
    if (target.isDefeated === true) {
      return { ok: false, reason: STRIKE_REASONS.TARGET_DEFEATED };
    }

    const distanceFeet = Grid.distanceFeet(attacker, target);
    if (distanceFeet > reachFeet) {
      return {
        ok: false,
        reason: STRIKE_REASONS.OUT_OF_REACH,
        distanceFeet: distanceFeet,
      };
    }

    const sight = LosMath.traceLineOfSight(
      { x: attacker.x, y: attacker.y },
      { x: target.x, y: target.y },
      opts.map,
    );
    if (!sight.visible) {
      return {
        ok: false,
        reason: STRIKE_REASONS.NO_LINE_OF_SIGHT,
        distanceFeet: distanceFeet,
        blockedBy: sight.blockedBy,
      };
    }

    const flanking = detectFlanking(attacker, target, opts, reachFeet);

    return {
      ok: true,
      distanceFeet: distanceFeet,
      reachFeet: reachFeet,
      lineOfSight: true,
      flanked: flanking.flanked,
      flankers: flanking.flankers,
      offGuard: flanking.flanked || hasOffGuard(target),
    };
  }

  function rollAttack(options) {
    const opts = options || {};
    let value;

    if (typeof opts.rollD20 === "function") {
      value = opts.rollD20();
    } else if (typeof opts.rollDie === "function") {
      value = opts.rollDie(20);
    } else {
      value = 1 + Math.floor(Math.random() * 20);
    }

    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new RangeError("rollD20 must return an integer from 1 to 20.");
    }
    return value;
  }

  function resolveDamageDie(options) {
    if (typeof options.rollDamageDie === "function") {
      return options.rollDamageDie;
    }
    if (typeof options.rollDie === "function") {
      return options.rollDie;
    }
    return undefined;
  }

  /**
   * @param {{
   *   attacker: object,
   *   target: object,
   *   map: object,
   *   reachFeet?: number,
   *   attackBonus?: number,
   *   targetAC?: number,
   *   damage?: string,
   *   agile?: boolean,
   *   allies?: object[],
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides: number) => number,
   *   rollDie?: (sides: number) => number
   * }} options
   * @returns {object}
   */
  function performStrike(options) {
    const opts = options || {};
    assertCombatant(opts.attacker, "attacker");
    if (typeof opts.attacker.canSpendActions !== "function") {
      throw new TypeError("Strike requires a Combatant with an action pool.");
    }
    if (!opts.attacker.canSpendActions(1)) {
      return { ok: false, reason: STRIKE_REASONS.NO_ACTIONS };
    }

    const evaluation = evaluateStrike(opts);
    if (!evaluation.ok) {
      return evaluation;
    }

    const attacker = opts.attacker;
    const target = opts.target;

    const attackBonus = normalizeAttackBonus(opts, attacker);
    const targetAC = normalizeTargetAC(opts, target);
    const damageFormula = normalizeDamageFormula(opts, attacker);
    const agile = normalizeAgile(opts, attacker);
    const mapPenalty = currentMapPenalty(attacker, agile);
    const flanked = evaluation.flanked === true;
    const offGuard = flanked || hasOffGuard(target);

    // Resolve both sides through the single modifier pipeline. The attack
    // bonus and base AC are base values; conditions, MAP, and flanking are
    // typed modifiers.
    const attackModifiers = collectAttackModifiers(attacker, mapPenalty);
    const attackResolution = Modifiers.resolveModifiers(attackBonus, attackModifiers);
    const defenseModifiers = collectDefenseModifiers(target, flanked);
    const defenseResolution = Modifiers.resolveModifiers(targetAC, defenseModifiers);

    // Roll only after every validation passed, so invalid attempts consume no
    // randomness, no action, and no MAP increment.
    const d20 = rollAttack(opts);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: attackResolution.total,
      dc: defenseResolution.total,
    });

    const hit =
      check.degree === Checks.DEGREES.SUCCESS ||
      check.degree === Checks.DEGREES.CRITICAL_SUCCESS;
    const critical = check.degree === Checks.DEGREES.CRITICAL_SUCCESS;

    let damage = null;
    if (hit) {
      if (typeof target.takeDamage !== "function") {
        throw new TypeError("Strike target must implement takeDamage(amount).");
      }
      const rolled = Damage.rollDamage({
        formula: damageFormula,
        rollDie: resolveDamageDie(opts),
      });
      const multiplier = critical ? 2 : 1;
      damage = {
        formula: rolled.formula,
        diceCount: rolled.diceCount,
        dieSize: rolled.dieSize,
        modifier: rolled.modifier,
        rolls: rolled.rolls,
        diceTotal: rolled.diceTotal,
        baseTotal: rolled.baseTotal,
        doubled: critical,
        multiplier: multiplier,
        total: Math.max(0, rolled.baseTotal * multiplier),
      };
    }

    attacker.spendActions(1);
    attacker.attacksThisTurn = Number.isInteger(attacker.attacksThisTurn)
      ? attacker.attacksThisTurn + 1
      : 1;

    let hpBefore = null;
    let hpAfter = null;
    let targetDefeated = target.isDefeated === true;
    let damageDealt = 0;
    let hpDamage = 0;

    if (hit) {
      hpBefore = Number.isInteger(target.currentHP) ? target.currentHP : null;
      const applied = target.takeDamage(damage.total);
      damageDealt = damage.total;
      hpDamage = applied.damageTaken;
      hpAfter = applied.currentHP;
      targetDefeated = applied.isDefeated;
    }

    return {
      ok: true,
      attackerId: attacker.id,
      targetId: target.id,
      distanceFeet: evaluation.distanceFeet,
      reachFeet: evaluation.reachFeet,
      attackRoll: d20,
      attackBonus: attackBonus,
      baseAttackBonus: attackBonus,
      attackModifier: attackResolution.total,
      attackModifiers: attackResolution.effectiveModifiers,
      attackBreakdown: attackResolution.breakdown,
      mapPenalty: mapPenalty,
      multipleAttackPenalty: mapPenalty,
      total: check.total,
      attackTotal: check.total,
      dc: defenseResolution.total,
      targetAC: defenseResolution.total,
      targetACTotal: defenseResolution.total,
      targetACBase: targetAC,
      baseTargetAC: targetAC,
      targetACModifiers: defenseResolution.effectiveModifiers,
      defenseModifiers: defenseResolution.effectiveModifiers,
      targetACBreakdown: defenseResolution.breakdown,
      defenseBreakdown: defenseResolution.breakdown,
      flanked: flanked,
      flankers: evaluation.flankers || [],
      offGuard: offGuard,
      degree: check.degree,
      isNatural20: check.isNatural20,
      isNatural1: check.isNatural1,
      hit: hit,
      isHit: hit,
      critical: critical,
      isCritical: critical,
      attack: {
        d20: check.d20,
        attackBonus: attackBonus,
        baseAttackBonus: attackBonus,
        attackModifier: attackResolution.total,
        modifiers: attackResolution.effectiveModifiers,
        breakdown: attackResolution.breakdown,
        mapPenalty: mapPenalty,
        modifier: check.modifier,
        total: check.total,
        dc: check.dc,
        degree: check.degree,
        isNatural20: check.isNatural20,
        isNatural1: check.isNatural1,
      },
      damage: damage,
      damageDealt: damageDealt,
      damageAmount: damageDealt,
      damageTotal: damageDealt,
      hpDamage: hpDamage,
      hpBefore: hpBefore,
      hpAfter: hpAfter,
      targetMaxHP: Number.isInteger(target.maxHP) ? target.maxHP : null,
      targetDefeated: targetDefeated,
      attacksThisTurn: attacker.attacksThisTurn,
      actionsLeft: attacker.actionsRemaining,
    };
  }

  return Object.freeze({
    STRIKE_REASONS: STRIKE_REASONS,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    DEFAULT_AC: DEFAULT_AC,
    DEFAULT_ATTACK_BONUS: DEFAULT_ATTACK_BONUS,
    DEFAULT_DAMAGE: DEFAULT_DAMAGE,
    evaluateStrike: evaluateStrike,
    performStrike: performStrike,
    // Shared with Reactive Strike so both attacks use the exact same
    // modifier collection and d20 handling. These do not spend actions.
    collectAttackModifiers: collectAttackModifiers,
    collectDefenseModifiers: collectDefenseModifiers,
    rollAttack: rollAttack,
    resolveDamageDie: resolveDamageDie,
  });
});
