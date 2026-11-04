/**
 * PF2E REMASTERED — REACTIVE STRIKE (HEADLESS CORE)
 *
 * Reactive Strike (formerly Attack of Opportunity) is a reaction:
 *   - it costs 1 reaction from the reactor's separate reaction pool;
 *   - it is a melee Strike against a creature within reach;
 *   - it never uses and never increases the reactor's Multiple Attack
 *     Penalty, so the attack always resolves at the full attack bonus;
 *   - attack and AC flow through the same modifier resolver as a normal Strike
 *     (conditions, flanking, and typed non-stacking rules).
 *
 * The trigger implemented in this slice is "leaves a threatened square during
 * a Stride". Step deliberately never triggers it. The host drives the trigger
 * scan from Stride; this module exposes the attack and the threatened-enemy
 * query.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Rules/checks.js"),
      require("../Rules/damage.js"),
      require("../Rules/modifiers.js"),
      require("./strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.ReactiveStrike = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Actions.Strike,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  Checks,
  Damage,
  Modifiers,
  Strike,
) {
  "use strict";

  const REACTIVE_STRIKE_REASONS = Object.freeze({
    NO_REACTION: "no-reaction",
  });

  const DEFAULT_REACH_FEET = Strike.DEFAULT_REACH_FEET;
  const DEFAULT_AC = Strike.DEFAULT_AC;
  const DEFAULT_ATTACK_BONUS = Strike.DEFAULT_ATTACK_BONUS;
  const DEFAULT_DAMAGE = Strike.DEFAULT_DAMAGE;

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function assertCell(cell, label) {
    if (
      cell === null ||
      typeof cell !== "object" ||
      !Number.isInteger(cell.x) ||
      !Number.isInteger(cell.y)
    ) {
      throw new TypeError(label + " must be a cell object { x, y }.");
    }
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

  function normalizeCombatants(options) {
    if (Array.isArray(options.combatants)) {
      return options.combatants;
    }
    if (Array.isArray(options.allies)) {
      return options.allies;
    }
    return [];
  }

  /**
   * Enemies that currently threaten `cell` and still have a reaction. Results
   * keep the roster order, which makes the auto-trigger deterministic.
   *
   * @param {{
   *   mover: object,
   *   cell: {x:number,y:number},
   *   combatants: object[],
   *   reachFeet?: number
   * }} options
   * @returns {object[]}
   */
  function findThreatenedEnemies(options) {
    const opts = options || {};
    assertCell(opts.cell, "cell");
    if (!opts.mover || typeof opts.mover !== "object") {
      throw new TypeError("findThreatenedEnemies requires a mover.");
    }
    if (!Array.isArray(opts.combatants)) {
      throw new TypeError("findThreatenedEnemies requires a combatants array.");
    }

    const reachFeet = normalizeReach(opts.reachFeet);
    const threats = [];

    for (const candidate of opts.combatants) {
      if (candidate === null || typeof candidate !== "object") {
        continue;
      }
      if (sameCreature(candidate, opts.mover)) {
        continue;
      }
      if (isDefeated(candidate)) {
        continue;
      }
      if (
        candidate.alliance !== undefined &&
        opts.mover.alliance !== undefined &&
        candidate.alliance === opts.mover.alliance
      ) {
        continue;
      }
      if (
        typeof candidate.canSpendReaction !== "function" ||
        !candidate.canSpendReaction(1)
      ) {
        continue;
      }
      if (
        !Number.isInteger(candidate.x) ||
        !Number.isInteger(candidate.y) ||
        Grid.distanceFeet(opts.cell, candidate) > reachFeet
      ) {
        continue;
      }
      threats.push(candidate);
    }

    return threats;
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
   *   combatants?: object[],
   *   allies?: object[],
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides: number) => number,
   *   rollDie?: (sides: number) => number
   * }} options
   * @returns {object}
   */
  function performReactiveStrike(options) {
    const opts = options || {};
    const attacker = opts.attacker;
    const target = opts.target;

    if (!attacker || typeof attacker.canSpendReaction !== "function") {
      throw new TypeError(
        "Reactive Strike requires a Combatant with a reaction pool.",
      );
    }

    if (!attacker.canSpendReaction(1)) {
      return {
        ok: false,
        reason: REACTIVE_STRIKE_REASONS.NO_REACTION,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target && target.id,
        targetName: target && target.name,
        reactionSpent: false,
      };
    }

    // Strike validation covers the target, alliance, reach, and line of sight.
    const evaluation = Strike.evaluateStrike(opts);
    if (!evaluation.ok) {
      return {
        ok: false,
        reason: evaluation.reason,
        distanceFeet: evaluation.distanceFeet,
        blockedBy: evaluation.blockedBy,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target && target.id,
        targetName: target && target.name,
        reactionSpent: false,
      };
    }

    const attackBonus = normalizeAttackBonus(opts, attacker);
    const targetAC = normalizeTargetAC(opts, target);
    const damageFormula = normalizeDamageFormula(opts, attacker);
    const flanked = evaluation.flanked === true;

    // Reactive Strike ignores the attacker's current MAP entirely: no penalty
    // is applied and attacksThisTurn is not incremented afterwards.
    const attackModifiers = Strike.collectAttackModifiers(attacker, 0);
    const attackResolution = Modifiers.resolveModifiers(
      attackBonus,
      attackModifiers,
    );
    const defenseModifiers = Strike.collectDefenseModifiers(target, flanked);
    const defenseResolution = Modifiers.resolveModifiers(
      targetAC,
      defenseModifiers,
    );

    const d20 = Strike.rollAttack(opts);
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
        throw new TypeError(
          "Reactive Strike target must implement takeDamage(amount).",
        );
      }
      const rolled = Damage.rollDamage({
        formula: damageFormula,
        rollDie: Strike.resolveDamageDie(opts),
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

    // Spend the reaction only after every validation and roll succeeded.
    // No action is spent and MAP is neither used nor advanced.
    attacker.spendReaction(1);

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
      reaction: true,
      reactionTrigger: "leave-threatened-square",
      reactionSpent: true,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      distanceFeet: evaluation.distanceFeet,
      reachFeet: evaluation.reachFeet,
      attackRoll: d20,
      attackBonus: attackBonus,
      baseAttackBonus: attackBonus,
      attackModifier: attackResolution.total,
      attackModifiers: attackResolution.effectiveModifiers,
      attackBreakdown: attackResolution.breakdown,
      mapPenalty: 0,
      multipleAttackPenalty: 0,
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
      offGuard: evaluation.offGuard === true,
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
        mapPenalty: 0,
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
      reactionsLeft: attacker.reactionsRemaining,
    };
  }

  return Object.freeze({
    REACTIVE_STRIKE_REASONS: REACTIVE_STRIKE_REASONS,
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    findThreatenedEnemies: findThreatenedEnemies,
    performReactiveStrike: performReactiveStrike,
  });
});
