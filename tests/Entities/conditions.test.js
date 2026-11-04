/**
 * Phase 4 — PF2e Remastered conditions (Off-Guard and Frightened).
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Rules/modifiers.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Entities — Conditions",
      register: factory(root.PF2e.Core.Combatant, root.PF2e.Core.Rules.Modifiers),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Combatant, Modifiers) {
  "use strict";

  if (!Combatant || !Modifiers) {
    throw new Error("Condition tests require Combatant and Modifiers.");
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
          maxHP: 20,
          ac: 18,
          attackBonus: 9,
          damage: "1d8+4",
          agile: false,
        },
        overrides || {},
      ),
    );
  }

  return function registerConditionTests(t) {
    t.test("a new combatant has no conditions", function () {
      const combatant = makeCombatant();
      t.assertEqual(combatant.getConditions().length, 0);
      t.assertTrue(!combatant.hasCondition("off-guard"));
      t.assertEqual(combatant.getCondition("frightened"), null);
    });

    t.test("off-guard can be added, queried, and removed", function () {
      const combatant = makeCombatant();

      const added = combatant.addCondition("off-guard");
      t.assertTrue(combatant.hasCondition("off-guard"));
      t.assertEqual(added.label, "Off-Guard");
      t.assertEqual(combatant.getCondition("off-guard").value, null);

      t.assertTrue(combatant.removeCondition("off-guard"));
      t.assertTrue(!combatant.hasCondition("off-guard"));
      t.assertTrue(!combatant.removeCondition("off-guard"));
    });

    t.test("frightened stores its value and does not lower on re-application", function () {
      const combatant = makeCombatant();

      combatant.addCondition("frightened", 2);
      t.assertTrue(combatant.hasCondition("frightened"));
      t.assertEqual(combatant.getCondition("frightened").value, 2);
      t.assertEqual(combatant.getCondition("frightened").label, "Frightened 2");

      combatant.addCondition("frightened", 1);
      t.assertEqual(combatant.getCondition("frightened").value, 2);

      combatant.addCondition("frightened", 3);
      t.assertEqual(combatant.getCondition("frightened").value, 3);
    });

    t.test("frightened decays by 1 at the end of the turn and is removed at 0", function () {
      const combatant = makeCombatant();
      combatant.addCondition("frightened", 2);

      const first = combatant.endTurn();
      t.assertTrue(first.changed);
      t.assertEqual(combatant.getCondition("frightened").value, 1);

      const second = combatant.endTurn();
      t.assertTrue(second.changed);
      t.assertTrue(second.frightened.removed);
      t.assertTrue(!combatant.hasCondition("frightened"));
    });

    t.test("resetTurn also ticks conditions when used as a turn boundary", function () {
      const combatant = makeCombatant();
      combatant.addCondition("frightened", 1);

      combatant.resetTurn();
      t.assertTrue(!combatant.hasCondition("frightened"));
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("adding frightened 0 removes the condition", function () {
      const combatant = makeCombatant();
      combatant.addCondition("frightened", 2);

      const result = combatant.addCondition("frightened", 0);
      t.assertEqual(result, null);
      t.assertTrue(!combatant.hasCondition("frightened"));
    });

    t.test("off-guard contributes -2 circumstance AC but not an attack penalty", function () {
      const combatant = makeCombatant();
      combatant.addCondition("off-guard");

      const acModifiers = combatant.getConditionModifiers("ac");
      const attackModifiers = combatant.getConditionModifiers("attack");

      t.assertEqual(acModifiers.length, 1);
      t.assertEqual(acModifiers[0].type, "circumstance");
      t.assertEqual(acModifiers[0].value, -2);
      t.assertEqual(attackModifiers.length, 0);
    });

    t.test("frightened contributes an equal status penalty to attacks and AC", function () {
      const combatant = makeCombatant();
      combatant.addCondition("frightened", 2);

      const acModifiers = combatant.getConditionModifiers("ac");
      const attackModifiers = combatant.getConditionModifiers("attack");

      t.assertEqual(acModifiers.length, 1);
      t.assertEqual(acModifiers[0].type, "status");
      t.assertEqual(acModifiers[0].value, -2);
      t.assertEqual(attackModifiers.length, 1);
      t.assertEqual(attackModifiers[0].value, -2);
    });

    t.test("conditions resolve through the central modifier pipeline", function () {
      const combatant = makeCombatant();
      combatant.addCondition("off-guard");
      combatant.addCondition("frightened", 1);

      const result = Modifiers.resolveModifiers(
        combatant.ac,
        combatant.getConditionModifiers("ac"),
      );

      t.assertEqual(result.total, 15);
      t.assertEqual(result.penaltyTotal, -3);
    });

    t.test("shield-raised contributes +2 circumstance AC but no attack penalty", function () {
      const combatant = makeCombatant();
      combatant.addCondition("shield-raised");

      const acModifiers = combatant.getConditionModifiers("ac");
      const attackModifiers = combatant.getConditionModifiers("attack");

      t.assertEqual(acModifiers.length, 1);
      t.assertEqual(acModifiers[0].name, "Shield Raised");
      t.assertEqual(acModifiers[0].type, "circumstance");
      t.assertEqual(acModifiers[0].value, 2);
      t.assertEqual(attackModifiers.length, 0);
    });

    t.test("shield-raised and off-guard resolve as independent circumstance modifiers", function () {
      const combatant = makeCombatant();
      combatant.addCondition("shield-raised");
      combatant.addCondition("off-guard");

      const result = Modifiers.resolveModifiers(
        combatant.ac,
        combatant.getConditionModifiers("ac"),
      );

      t.assertEqual(result.total, 18);
      t.assertEqual(result.bonusTotal, 2);
      t.assertEqual(result.penaltyTotal, -2);
      t.assertEqual(result.effectiveModifiers.length, 2);
    });

    t.test("resetTurn removes shield-raised even when condition ticking is disabled", function () {
      const combatant = makeCombatant();
      combatant.addCondition("shield-raised");
      combatant.addCondition("frightened", 1);
      combatant.spendActions(1);

      combatant.resetTurn({ tickConditions: false });

      t.assertTrue(!combatant.hasCondition("shield-raised"));
      t.assertEqual(
        combatant.getCondition("frightened").value,
        1,
        "the suppressed tick leaves Frightened untouched",
      );
      t.assertEqual(combatant.actionsRemaining, 3);
    });

    t.test("resetTurn removes shield-raised on a normal turn boundary", function () {
      const combatant = makeCombatant();
      combatant.addCondition("shield-raised");

      combatant.resetTurn();

      t.assertTrue(!combatant.hasCondition("shield-raised"));
    });

    t.test("unknown conditions are stored but contribute no modifiers", function () {
      const combatant = makeCombatant();
      combatant.addCondition("prone");

      t.assertTrue(combatant.hasCondition("prone"));
      t.assertEqual(combatant.getConditionModifiers("ac").length, 0);
    });

    t.test("invalid condition values are rejected", function () {
      const combatant = makeCombatant();
      t.assertThrows(function () {
        combatant.addCondition("frightened", -1);
      }, "negative frightened");
      t.assertThrows(function () {
        combatant.addCondition("frightened", 1.5);
      }, "fractional frightened");
      t.assertThrows(function () {
        combatant.addCondition("", 1);
      }, "empty name");
    });
  };
});
