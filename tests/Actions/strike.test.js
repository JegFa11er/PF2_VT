/**
 * Phase 3.2/4.1/4.2 — Strike resolution, MAP, damage, and HP.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Rules/checks.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Strike, MAP, Damage & HP",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Rules.Checks,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Strike,
  Checks,
) {
  "use strict";

  if (!GridMap || !Combatant || !Strike || !Checks) {
    throw new Error("Strike tests require GridMap, Combatant, Strike and Checks.");
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "hero",
          name: "Valeros",
          alliance: "player",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 100,
          ac: 10,
          attackBonus: 0,
          damage: "1d8+4",
          agile: false,
        },
        overrides || {},
      ),
    );
  }

  function makeTarget(overrides) {
    return makeCombatant(
      Object.assign(
        {
          id: "goblin",
          name: "Goblin",
          alliance: "enemy",
          initiative: 5,
          x: 1,
          y: 0,
          maxHP: 100,
          ac: 10,
          attackBonus: 0,
          damage: "1d6+1",
          agile: true,
        },
        overrides || {},
      ),
    );
  }

  function makeMap() {
    return new GridMap({ cols: 5, rows: 5 });
  }

  function perform(attacker, target, d20, damageDie, overrides) {
    let lastDieSize = null;
    const result = Strike.performStrike(
      Object.assign(
        {
          attacker: attacker,
          target: target,
          map: makeMap(),
          rollD20: function () {
            return d20;
          },
          rollDamageDie: function (sides) {
            lastDieSize = sides;
            return damageDie === undefined ? 1 : damageDie;
          },
        },
        overrides || {},
      ),
    );
    result.lastDieSize = lastDieSize;
    return result;
  }

  return function registerStrikeTests(t) {
    // ------------------------------------------------------------------ MAP

    t.test("normal weapon MAP is 0, -5, -10 across three attacks", function () {
      const attacker = makeCombatant();
      const target = makeTarget({ maxHP: 1000, ac: 10 });

      const first = perform(attacker, target, 10, 1);
      t.assertTrue(first.ok);
      t.assertEqual(first.mapPenalty, 0);
      t.assertEqual(attacker.attacksThisTurn, 1);

      const second = perform(attacker, target, 10, 1);
      t.assertTrue(second.ok);
      t.assertEqual(second.mapPenalty, -5);
      t.assertEqual(attacker.attacksThisTurn, 2);

      const third = perform(attacker, target, 10, 1);
      t.assertTrue(third.ok);
      t.assertEqual(third.mapPenalty, -10);
      t.assertEqual(attacker.attacksThisTurn, 3);
      t.assertEqual(attacker.actionsRemaining, 0);
    });

    t.test("agile weapon MAP is 0, -4, -8 across three attacks", function () {
      const attacker = makeCombatant({ agile: true });
      const target = makeTarget({ maxHP: 1000, ac: 10 });

      t.assertEqual(perform(attacker, target, 10, 1).mapPenalty, 0);
      t.assertEqual(perform(attacker, target, 10, 1).mapPenalty, -4);
      t.assertEqual(perform(attacker, target, 10, 1).mapPenalty, -8);
    });

    t.test("MAP is applied to the attack total", function () {
      const attacker = makeCombatant({ attackBonus: 5 });
      const target = makeTarget({ maxHP: 1000, ac: 15 });

      const first = perform(attacker, target, 10, 1);
      t.assertEqual(first.total, 15);
      t.assertEqual(first.degree, Checks.DEGREES.SUCCESS);

      const second = perform(attacker, target, 10, 1);
      t.assertEqual(second.mapPenalty, -5);
      t.assertEqual(second.total, 10);
      t.assertEqual(second.degree, Checks.DEGREES.FAILURE);
      t.assertEqual(second.damageDealt, 0);
    });

    t.test("resetTurn clears attacksThisTurn and restores actions", function () {
      const attacker = makeCombatant();
      const target = makeTarget({ maxHP: 1000, ac: 10 });

      perform(attacker, target, 10, 1);
      t.assertEqual(attacker.attacksThisTurn, 1);
      t.assertEqual(attacker.getMultipleAttackPenalty(), -5);

      attacker.resetTurn();
      t.assertEqual(attacker.attacksThisTurn, 0);
      t.assertEqual(attacker.getMultipleAttackPenalty(), 0);
      t.assertEqual(attacker.actionsRemaining, 3);
    });

    // --------------------------------------------------------------- damage

    t.test("a success deals damage once and reduces target HP", function () {
      const attacker = makeCombatant({ attackBonus: 0, damage: "1d8+4" });
      const target = makeTarget({ maxHP: 20, ac: 10 });

      const result = perform(attacker, target, 10, 5);

      t.assertEqual(result.degree, Checks.DEGREES.SUCCESS);
      t.assertTrue(result.hit);
      t.assertTrue(!result.critical);
      t.assertEqual(result.damage.doubled, false);
      t.assertEqual(result.damage.baseTotal, 9);
      t.assertEqual(result.damageDealt, 9);
      t.assertEqual(result.hpBefore, 20);
      t.assertEqual(result.hpAfter, 11);
      t.assertEqual(target.currentHP, 11);
      t.assertEqual(result.lastDieSize, 8);
    });

    t.test("a critical success doubles total damage", function () {
      const attacker = makeCombatant({ attackBonus: 10, damage: "1d8+4" });
      const target = makeTarget({ maxHP: 100, ac: 10 });

      const result = perform(attacker, target, 10, 5);

      t.assertEqual(result.degree, Checks.DEGREES.CRITICAL_SUCCESS);
      t.assertTrue(result.critical);
      t.assertEqual(result.damage.baseTotal, 9);
      t.assertEqual(result.damage.doubled, true);
      t.assertEqual(result.damage.total, 18);
      t.assertEqual(result.damageDealt, 18);
      t.assertEqual(target.currentHP, 82);
    });

    t.test("a failure deals no damage", function () {
      const attacker = makeCombatant({ attackBonus: 0 });
      const target = makeTarget({ maxHP: 20, ac: 20 });

      const result = perform(attacker, target, 12, 5);

      t.assertEqual(result.degree, Checks.DEGREES.FAILURE);
      t.assertTrue(!result.hit);
      t.assertEqual(result.damage, null);
      t.assertEqual(result.damageDealt, 0);
      t.assertEqual(result.hpAfter, null);
      t.assertEqual(target.currentHP, 20);
    });

    t.test("HP floors at 0 and the target is marked defeated", function () {
      const attacker = makeCombatant({ attackBonus: 0, damage: "1d8+4" });
      const target = makeTarget({ maxHP: 6, ac: 10 });

      const result = perform(attacker, target, 10, 3);

      t.assertEqual(result.degree, Checks.DEGREES.SUCCESS);
      t.assertEqual(result.damageDealt, 7);
      t.assertEqual(target.currentHP, 0);
      t.assertTrue(target.isDefeated);
      t.assertEqual(result.hpAfter, 0);
      t.assertTrue(result.targetDefeated);
    });

    t.test("takeDamage clamps at 0 and keeps the defeated flag", function () {
      const combatant = makeCombatant({ maxHP: 10 });

      const first = combatant.takeDamage(4);
      t.assertEqual(first.damageTaken, 4);
      t.assertEqual(combatant.currentHP, 6);
      t.assertTrue(!combatant.isDefeated);

      const second = combatant.takeDamage(10);
      t.assertEqual(second.damageTaken, 6);
      t.assertEqual(combatant.currentHP, 0);
      t.assertTrue(combatant.isDefeated);

      const third = combatant.takeDamage(5);
      t.assertEqual(third.damageTaken, 0);
      t.assertEqual(combatant.currentHP, 0);
      t.assertTrue(combatant.isDefeated);
    });

    t.test("negative damage is rejected", function () {
      const combatant = makeCombatant();
      t.assertThrows(function () {
        combatant.takeDamage(-1);
      }, "negative damage");
    });

    // ------------------------------------------------- natural 20 / natural 1

    t.test("natural 20 upgrades a failure to a success and deals damage", function () {
      const attacker = makeCombatant({ attackBonus: -10, damage: "1d8+4" });
      const target = makeTarget({ maxHP: 20, ac: 15 });

      const result = perform(attacker, target, 20, 1);

      t.assertEqual(result.total, 10);
      t.assertEqual(result.degree, Checks.DEGREES.SUCCESS);
      t.assertTrue(result.isNatural20);
      t.assertEqual(result.damageDealt, 5);
      t.assertEqual(target.currentHP, 15);
    });

    t.test("natural 1 downgrades a success to a failure", function () {
      const attacker = makeCombatant({ attackBonus: 10, damage: "1d8+4" });
      const target = makeTarget({ maxHP: 20, ac: 10 });

      const result = perform(attacker, target, 1, 5);

      t.assertEqual(result.total, 11);
      t.assertEqual(result.degree, Checks.DEGREES.FAILURE);
      t.assertTrue(result.isNatural1);
      t.assertTrue(!result.hit);
      t.assertEqual(result.damageDealt, 0);
      t.assertEqual(target.currentHP, 20);
    });

    // ------------------------------------------------------------ boundaries

    t.test("a defeated target cannot be struck and consumes nothing", function () {
      const attacker = makeCombatant({ attackBonus: 0, damage: "1d8+4" });
      const target = makeTarget({ maxHP: 1, ac: 10 });

      const first = perform(attacker, target, 10, 1);
      t.assertTrue(first.ok);
      t.assertTrue(target.isDefeated);
      t.assertEqual(attacker.actionsRemaining, 2);
      t.assertEqual(attacker.attacksThisTurn, 1);

      const second = perform(attacker, target, 10, 1);
      t.assertTrue(!second.ok);
      t.assertEqual(second.reason, Strike.STRIKE_REASONS.TARGET_DEFEATED);
      t.assertEqual(attacker.actionsRemaining, 2);
      t.assertEqual(attacker.attacksThisTurn, 1);
    });

    t.test("an invalid d20 throws before spending an action or MAP", function () {
      const attacker = makeCombatant();
      const target = makeTarget();

      t.assertThrows(function () {
        perform(attacker, target, 21, 1);
      }, "out-of-range d20");

      t.assertEqual(attacker.actionsRemaining, 3);
      t.assertEqual(attacker.attacksThisTurn, 0);
    });

    t.test("attack bonuses and damage can be overridden per Strike", function () {
      const attacker = makeCombatant({ attackBonus: 0, damage: "1d4" });
      const target = makeTarget({ maxHP: 20, ac: 30 });

      const result = perform(attacker, target, 10, 2, {
        attackBonus: 15,
        targetAC: 10,
        damage: "2d6+3",
        agile: true,
      });

      t.assertEqual(result.total, 25);
      t.assertEqual(result.degree, Checks.DEGREES.CRITICAL_SUCCESS);
      t.assertEqual(result.damage.diceCount, 2);
      t.assertEqual(result.damage.baseTotal, 7);
      t.assertEqual(result.damage.total, 14);
      t.assertEqual(result.lastDieSize, 6);
    });

    // ------------------------------------------------------------- flanking

    t.test("flanking applies -2 circumstance AC and can turn a miss into a hit", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0, damage: "1d8+4" });
      const target = makeTarget({ x: 1, y: 0, ac: 12, maxHP: 100 });
      const ally = makeCombatant({
        id: "merisiel",
        name: "Merisiel",
        x: 2,
        y: 0,
      });

      const withoutFlank = perform(attacker, target, 10, 1);
      t.assertEqual(withoutFlank.degree, Checks.DEGREES.FAILURE);
      t.assertEqual(withoutFlank.targetAC, 12);

      const flankingAttacker = makeCombatant({
        x: 0,
        y: 0,
        attackBonus: 0,
        damage: "1d8+4",
      });
      const withFlank = perform(flankingAttacker, target, 10, 1, {
        allies: [flankingAttacker, ally],
      });
      t.assertTrue(withFlank.flanked);
      t.assertTrue(withFlank.offGuard);
      t.assertEqual(withFlank.baseTargetAC, 12);
      t.assertEqual(withFlank.targetAC, 10);
      t.assertEqual(withFlank.degree, Checks.DEGREES.SUCCESS);
      t.assertEqual(withFlank.damageDealt, 5);
      t.assertEqual(withFlank.defenseModifiers.length, 1);
      t.assertEqual(withFlank.defenseModifiers[0].source, "off-guard");
    });

    t.test("an L-shaped ally does not flank", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 12, maxHP: 100 });
      const ally = makeCombatant({ id: "merisiel", name: "Merisiel", x: 1, y: 1 });

      const result = perform(attacker, target, 10, 1, {
        allies: [attacker, ally],
      });

      t.assertTrue(!result.flanked);
      t.assertEqual(result.targetAC, 12);
      t.assertEqual(result.degree, Checks.DEGREES.FAILURE);
    });

    t.test("a defeated ally cannot complete a flank", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 12, maxHP: 100 });
      const ally = makeCombatant({
        id: "merisiel",
        name: "Merisiel",
        x: 2,
        y: 0,
      });
      ally.isDefeated = true;

      const result = perform(attacker, target, 10, 1, {
        allies: [attacker, ally],
      });

      t.assertTrue(!result.flanked);
      t.assertEqual(result.targetAC, 12);
    });

    t.test("an existing Off-Guard condition applies without flanking", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 12, maxHP: 100 });
      target.addCondition("off-guard");

      const result = perform(attacker, target, 10, 1);

      t.assertTrue(!result.flanked);
      t.assertTrue(result.offGuard);
      t.assertEqual(result.targetAC, 10);
      t.assertEqual(result.degree, Checks.DEGREES.SUCCESS);
    });

    t.test("Off-Guard and flanking do not stack the same circumstance penalty", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 12, maxHP: 100 });
      const ally = makeCombatant({ id: "merisiel", name: "Merisiel", x: 2, y: 0 });
      target.addCondition("off-guard");

      const result = perform(attacker, target, 10, 1, {
        allies: [attacker, ally],
      });

      t.assertTrue(result.flanked);
      t.assertEqual(result.targetAC, 10);
      t.assertEqual(result.defenseModifiers.length, 1);
      t.assertEqual(result.defenseModifiers[0].value, -2);
    });

    t.test("frightened on the attacker is a status penalty to the attack", function () {
      const attacker = makeCombatant({
        x: 0,
        y: 0,
        attackBonus: 0,
        maxHP: 100,
      });
      const target = makeTarget({ x: 1, y: 0, ac: 10, maxHP: 100 });
      attacker.addCondition("frightened", 2);

      const result = perform(attacker, target, 10, 1);

      t.assertEqual(result.total, 8);
      t.assertEqual(result.attackModifiers.length, 1);
      t.assertEqual(result.attackModifiers[0].type, "status");
      t.assertEqual(result.degree, Checks.DEGREES.FAILURE);
    });

    t.test("frightened on the target reduces its AC", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 10, maxHP: 100 });
      target.addCondition("frightened", 1);

      const result = perform(attacker, target, 10, 1);

      t.assertEqual(result.baseTargetAC, 10);
      t.assertEqual(result.targetAC, 9);
      t.assertEqual(result.defenseModifiers.length, 1);
      t.assertEqual(result.defenseModifiers[0].type, "status");
      t.assertEqual(result.degree, Checks.DEGREES.SUCCESS);
    });

    t.test("a raised shield adds +2 circumstance AC to the target", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 16, maxHP: 100 });
      target.addCondition("shield-raised");

      const result = perform(attacker, target, 10, 1);

      t.assertEqual(result.baseTargetAC, 16);
      t.assertEqual(result.targetAC, 18);
      t.assertEqual(result.defenseModifiers.length, 1);
      t.assertEqual(result.defenseModifiers[0].name, "Shield Raised");
      t.assertEqual(result.defenseModifiers[0].type, "circumstance");
      t.assertEqual(result.defenseModifiers[0].value, 2);
      t.assertEqual(result.degree, Checks.DEGREES.FAILURE);
    });

    t.test("shield-raised and off-guard apply as +2 and -2 circumstance", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 16, maxHP: 100 });
      target.addCondition("shield-raised");
      target.addCondition("off-guard");

      const result = perform(attacker, target, 16, 1);

      t.assertEqual(result.baseTargetAC, 16);
      t.assertEqual(result.targetAC, 16, "Base 16 + 2 Shield Raised - 2 Off-Guard");
      t.assertEqual(result.defenseModifiers.length, 2);

      const bySource = {};
      for (const modifier of result.defenseModifiers) {
        bySource[modifier.source] = modifier;
      }
      t.assertEqual(bySource["shield-raised"].value, 2);
      t.assertEqual(bySource["shield-raised"].type, "circumstance");
      t.assertEqual(bySource["off-guard"].value, -2);
      t.assertEqual(bySource["off-guard"].type, "circumstance");

      t.assertEqual(result.total, 16);
      t.assertEqual(result.degree, Checks.DEGREES.SUCCESS);
    });

    t.test("flanking off-guard and shield-raised keep both circumstance sides", function () {
      const attacker = makeCombatant({ x: 0, y: 0, attackBonus: 0 });
      const target = makeTarget({ x: 1, y: 0, ac: 16, maxHP: 100 });
      const ally = makeCombatant({ id: "merisiel", name: "Merisiel", x: 2, y: 0 });
      target.addCondition("shield-raised");

      const result = perform(attacker, target, 10, 1, {
        allies: [attacker, ally],
      });

      t.assertTrue(result.flanked);
      t.assertTrue(result.offGuard);
      t.assertEqual(result.baseTargetAC, 16);
      t.assertEqual(result.targetAC, 16);
      t.assertEqual(result.defenseModifiers.length, 2, "no duplicate Off-Guard");
    });

    t.test("evaluateStrike reports flanking without spending an action", function () {
      const attacker = makeCombatant({ x: 0, y: 0 });
      const target = makeTarget({ x: 1, y: 0 });
      const ally = makeCombatant({ id: "merisiel", name: "Merisiel", x: 2, y: 0 });

      const evaluation = Strike.evaluateStrike({
        attacker: attacker,
        target: target,
        map: makeMap(),
        allies: [attacker, ally],
      });

      t.assertTrue(evaluation.ok);
      t.assertTrue(evaluation.flanked);
      t.assertTrue(evaluation.offGuard);
      t.assertEqual(attacker.actionsRemaining, 3);
      t.assertEqual(attacker.attacksThisTurn, 0);
    });
  };
});
