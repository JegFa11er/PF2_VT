/**
 * Session 6.1 — PF2e cover geometry.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Grid/cover.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Grid — Cover Geometry",
      register: factory(root.PF2e.Core.GridMap, root.PF2e.Core.Cover),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (GridMap, Cover) {
  "use strict";

  if (!GridMap || !Cover) {
    throw new Error("Cover tests require GridMap and Cover.");
  }

  function mapWith(cols, rows, blocked) {
    return new GridMap({
      cols: cols || 8,
      rows: rows || 8,
      blocked: blocked || [],
    });
  }

  function attacker(x, y) {
    return { id: "attacker", name: "Attacker", x: x, y: y, alliance: "enemy" };
  }

  function target(x, y) {
    return { id: "target", name: "Target", x: x, y: y, alliance: "player" };
  }

  return function registerCoverTests(t) {
    t.test("an open battlefield gives no cover and all rays are clear", function () {
      const cover = Cover.determineCover(attacker(0, 0), target(2, 0), mapWith());

      t.assertEqual(cover.degree, "none");
      t.assertEqual(cover.acBonus, 0);
      t.assertEqual(cover.blockedRaysCount, 0);
      t.assertTrue(!cover.creatureCover);
      t.assertTrue(cover.lineOfSight);
      t.assertEqual(cover.rays.length, 4);
      t.assertTrue(
        cover.rays.every(function (ray) {
          return ray.blocked === false;
        }),
      );
    });

    t.test("a wall between the combatants gives standard cover from corner rays", function () {
      const cover = Cover.determineCover(
        attacker(0, 0),
        target(2, 0),
        mapWith(8, 8, [{ x: 1, y: 0 }]),
      );

      t.assertEqual(cover.degree, "standard");
      t.assertEqual(cover.acBonus, 2);
      t.assertEqual(cover.blockedRaysCount, 2);
      t.assertTrue(cover.lineOfSight);
      t.assertDeepEqual(cover.bestCorner, { x: 0, y: 0 });
    });

    t.test("three blocked rays give greater cover", function () {
      const cover = Cover.determineCover(
        attacker(0, 0),
        target(2, 2),
        mapWith(8, 8, [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: 1 },
        ]),
      );

      t.assertEqual(cover.degree, "greater");
      t.assertEqual(cover.acBonus, 4);
      t.assertEqual(cover.blockedRaysCount, 3);
      t.assertTrue(cover.lineOfSight);
    });

    t.test("creatures on the line provide lesser cover", function () {
      const friendly = {
        id: "bystander",
        name: "Bystander",
        x: 1,
        y: 0,
        alliance: "player",
        currentHP: 10,
      };

      const cover = Cover.determineCover(
        attacker(0, 0),
        target(3, 0),
        mapWith(),
        [friendly],
      );

      t.assertEqual(cover.degree, "lesser");
      t.assertEqual(cover.acBonus, 1);
      t.assertEqual(cover.blockedRaysCount, 0);
      t.assertTrue(cover.creatureCover);
      t.assertDeepEqual(cover.creatureCoverCells, [{ x: 1, y: 0 }]);
    });

    t.test("a defeated creature does not provide lesser cover", function () {
      const defeated = {
        id: "bystander",
        name: "Bystander",
        x: 1,
        y: 0,
        alliance: "player",
        currentHP: 0,
        isDefeated: true,
      };

      const cover = Cover.determineCover(
        attacker(0, 0),
        target(3, 0),
        mapWith(),
        [defeated],
      );

      t.assertEqual(cover.degree, "none");
      t.assertTrue(!cover.creatureCover);
    });

    t.test("the attacker and target never count as creature cover", function () {
      const a = attacker(0, 0);
      const d = target(3, 0);

      const cover = Cover.determineCover(a, d, mapWith(), [a, d]);

      t.assertEqual(cover.degree, "none");
      t.assertTrue(!cover.creatureCover);
    });

    t.test("four blocked rays mean no line of sight", function () {
      const cover = Cover.determineCover(
        attacker(0, 0),
        target(3, 3),
        mapWith(8, 8, [
          { x: 2, y: 1 },
          { x: 2, y: 2 },
          { x: 2, y: 3 },
        ]),
      );

      t.assertEqual(cover.blockedRaysCount, 4);
      t.assertTrue(!cover.lineOfSight);
      t.assertTrue(cover.noLineOfSight);
      t.assertEqual(cover.degree, "none");
      t.assertEqual(cover.acBonus, 0);
    });

    t.test("cover produces a circumstance modifier through the shared contract", function () {
      const standard = Cover.coverModifier({ degree: "standard", acBonus: 2 });
      t.assertDeepEqual(standard, {
        name: "Standard Cover",
        type: "circumstance",
        value: 2,
        source: "cover",
      });
      t.assertEqual(Cover.coverModifier("lesser").value, 1);
      t.assertEqual(Cover.coverModifier("greater").value, 4);
      t.assertEqual(Cover.coverModifier("none"), null);
    });

    t.test("a segment along a wall edge does not intersect the wall interior", function () {
      t.assertTrue(
        !Cover.segmentIntersectsCellInterior(
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 1, y: 0 },
        ),
        "horizontal boundary ray",
      );
      t.assertTrue(
        Cover.segmentIntersectsCellInterior(
          { x: 0, y: 0 },
          { x: 2, y: 2 },
          { x: 1, y: 1 },
        ),
        "diagonal ray",
      );
    });

    t.test("invalid geometry input is rejected", function () {
      t.assertThrows(function () {
        Cover.determineCover({ x: 0.5, y: 0 }, target(1, 0), mapWith());
      }, "fractional attacker");
      t.assertThrows(function () {
        Cover.determineCover(attacker(0, 0), target(1, 0), null);
      }, "missing map");
    });
  };
});
