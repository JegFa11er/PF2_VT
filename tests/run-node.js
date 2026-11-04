"use strict";

const { createHarness } = require("./harness.js");

const suites = [
  {
    name: "Core/Grid — PF2e 5-10-5 distance",
    register: require("./Grid/distance.test.js"),
  },
  {
    name: "Core/Grid & Actions — Pathfinding + Stride",
    register: require("./Grid/pathfinding.test.js"),
  },
  {
    name: "Core/Grid — Difficult Terrain & Occupancy",
    register: require("./Grid/terrain-occupancy.test.js"),
  },
  {
    name: "Core/Grid — Line of Sight",
    register: require("./Grid/los.test.js"),
  },
  {
    name: "Core/Rules — d20 Checks & Degrees of Success",
    register: require("./Rules/checks.test.js"),
  },
  {
    name: "Core/Rules — Modifier Stacking",
    register: require("./Rules/modifiers.test.js"),
  },
  {
    name: "Core/Grid — Flanking Geometry",
    register: require("./Grid/flanking.test.js"),
  },
  {
    name: "Core/Entities — Conditions",
    register: require("./Entities/conditions.test.js"),
  },
  {
    name: "Core/Actions — Step & Strike",
    register: require("./Actions/step-strike.test.js"),
  },
  {
    name: "Core/Actions — Strike, MAP, Damage & HP",
    register: require("./Actions/strike.test.js"),
  },
  {
    name: "Core/Actions — Raise a Shield",
    register: require("./Actions/raise-shield.test.js"),
  },
  {
    name: "Core/Actions — Reactions & Reactive Strike",
    register: require("./Actions/reactive-strike.test.js"),
  },
  {
    name: "Core/Encounter — Initiative & Round Cycle",
    register: require("./Encounter/encounter.test.js"),
  },
];

let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  console.log("\n" + suite.name);
  const harness = createHarness();
  suite.register(harness);

  for (const result of harness.results) {
    if (result.passed) {
      totalPassed += 1;
      console.log("  PASS  " + result.name);
    } else {
      totalFailed += 1;
      console.error("  FAIL  " + result.name);
      console.error("        " + result.error);
    }
  }
}

console.log("\n" + totalPassed + " passed, " + totalFailed + " failed (" + suites.length + " suite(s))");

if (totalFailed > 0) {
  process.exitCode = 1;
}
