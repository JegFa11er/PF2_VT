/**
 * PF2E REMASTERED — APPLICATION ENTRY POINT
 * Wires the headless rules core (map, pathfinding, occupancy, LoS, encounter,
 * combatants, Stride/Step/Strike) to the canvas battlefield, initiative tracker,
 * sidebar, hover preview, and combat log.
 */
(function () {
  "use strict";

  const Grid = window.PF2e.Core.Grid;
  const Pathfinding = window.PF2e.Core.Pathfinding;
  const GridMap = window.PF2e.Core.GridMap;
  const Combatant = window.PF2e.Core.Combatant;
  const Encounter = window.PF2e.Core.Encounter;
  const Occupancy = window.PF2e.Core.Occupancy;
  const LosMath = window.PF2e.Core.LosMath;
  const Cover = window.PF2e.Core.Cover;
  const Stride = window.PF2e.Core.Actions.Stride;
  const Step = window.PF2e.Core.Actions.Step;
  const Strike = window.PF2e.Core.Actions.Strike;
  const RaiseShield = window.PF2e.Core.Actions.RaiseShield;
  const TakeCover = window.PF2e.Core.Actions.TakeCover;
  const Trip = window.PF2e.Core.Actions.Trip;
  const Stand = window.PF2e.Core.Actions.Stand;
  const Shove = window.PF2e.Core.Actions.Shove;
  const Grapple = window.PF2e.Core.Actions.Grapple;
  const Escape = window.PF2e.Core.Actions.Escape;
  const Conditions = window.PF2e.Core.Conditions;
  const Checks = window.PF2e.Core.Rules.Checks;
  const MultipleAttack = window.PF2e.Core.Rules.MultipleAttack;
  const Damage = window.PF2e.Core.Rules.Damage;
  const WeaponTraits = window.PF2e.Core.Rules.WeaponTraits;
  const View = window.PF2e.View;
  const MODES = View.ACTION_MODES;

  const COLS = 15;
  const ROWS = 15;
  const CELL_SIZE = 48;
  const CORNER_POLICY = Pathfinding.DIAGONAL_CORNER_POLICIES.BLOCK_ANY;

  const MAP_ROWS = [
    "...............",
    "...........##..",
    "....##.....##..",
    "....##.........",
    ".......#..~~...",
    ".......#..~~...",
    ".......#.......",
    ".......#.......",
    "...............",
    "...............",
    ".......#..~~...",
    ".......#..~~...",
    "..##...........",
    "..##...........",
    "...............",
  ];

  const map = GridMap.fromAscii(MAP_ROWS, "#", { difficultChars: "~" });

  const COLORS = {
    valeros: "#c8553d",
    merisiel: "#2e9e8f",
    goblin: "#d1495b",
  };

  const COMBATANTS = [
    new Combatant({
      id: "valeros",
      name: "Valeros",
      alliance: "player",
      initiative: 18,
      x: 3,
      y: 7,
      speedFeet: 25,
      maxActions: 3,
      maxHP: 20,
      ac: 18,
      attackBonus: 9,
      damage: { formula: "1d8+4", type: "slashing" },
      saves: { fortitude: 9, reflex: 6, will: 5 },
      skills: { athletics: 10, acrobatics: 6, stealth: 2, perception: 7 },
      // Demo weapon traits: a 10-ft reach weapon that punishes Off-Guard
      // targets and adds a deadly d8 die on a critical hit.
      traits: ["reach", "backstabber", "deadly-d8"],
      agile: false,
    }),
    new Combatant({
      id: "merisiel",
      name: "Merisiel",
      alliance: "player",
      initiative: 12,
      x: 10,
      y: 8,
      speedFeet: 25,
      maxActions: 3,
      maxHP: 16,
      ac: 17,
      attackBonus: 8,
      damage: { formula: "1d6+2", type: "piercing" },
      saves: { fortitude: 5, reflex: 9, will: 6 },
      skills: { athletics: 4, acrobatics: 9, stealth: 10, perception: 8 },
      agile: true,
    }),
    new Combatant({
      id: "goblin",
      name: "Goblin",
      alliance: "enemy",
      initiative: 15,
      x: 11,
      y: 7,
      speedFeet: 25,
      maxActions: 3,
      maxHP: 6,
      ac: 16,
      attackBonus: 8,
      damage: { formula: "1d6+1", type: "slashing" },
      saves: { fortitude: 4, reflex: 8, will: 3 },
      skills: { athletics: 3, acrobatics: 7, stealth: 8, perception: 5 },
      agile: true,
      // Authored demo IWR: Valeros exploits the slashing weakness, Merisiel's
      // piercing damage is resisted, and fire cannot hurt the Goblin at all.
      immunities: ["fire"],
      weaknesses: [{ type: "slashing", value: 2 }],
      resistances: [{ type: "piercing", value: 2 }],
      // Authored persistent damage: fire demonstrates immunity (0 damage) and
      // bleed demonstrates a real end-of-turn tick with a DC 15 recovery check.
      persistentDamage: [
        { formula: "1d6", type: "fire" },
        { formula: "1d4", type: "bleed" },
      ],
    }),
  ];

  // Authored demo conditions: the goblin starts shaken and half-hidden by
  // smoke, and Merisiel starts in the shadows. This makes the condition
  // badges, flat checks, Hidden-attacker Off-Guard, and token opacity visible
  // immediately without adding Seek/Hide actions in this slice.
  const demoGoblin = COMBATANTS.find(function (combatant) {
    return combatant.id === "goblin";
  });
  if (demoGoblin) {
    demoGoblin.addCondition("frightened", 1);
    demoGoblin.addCondition("concealed");
  }
  const demoMerisiel = COMBATANTS.find(function (combatant) {
    return combatant.id === "merisiel";
  });
  if (demoMerisiel) {
    demoMerisiel.addCondition("hidden");
  }

  const encounter = new Encounter({ combatants: COMBATANTS });

  const canvas = document.getElementById("battlefield");
  const tokenListEl = document.getElementById("token-list");
  const selectionEl = document.getElementById("selection-panel");
  const statusEl = document.getElementById("board-status");
  const initiativeEl = document.getElementById("initiative-tracker");
  const roundIndicatorEl = document.getElementById("round-indicator");
  const endTurnEl = document.getElementById("end-turn");
  const modeHintEl = document.getElementById("mode-hint");
  const modeButtons = Array.from(
    document.querySelectorAll(".mode-button[data-mode]"),
  );
  const raiseShieldButton = document.getElementById("raise-shield");
  const takeCoverButton = document.getElementById("take-cover");
  const standButton = document.getElementById("stand");
  const escapeButton = document.getElementById("escape");
  const log = new View.CombatLog(document.getElementById("combat-log"));

  /**
   * @type {Map<string, {
   *   card: HTMLButtonElement,
   *   sub: HTMLElement,
   *   conditionBadges: HTMLElement,
   *   pips: HTMLElement[],
   *   reactionPips: HTMLElement[],
   *   hpFill: HTMLElement,
   *   hpText: HTMLElement
   * }>}
   */
  const tokenCards = new Map();
  let suppressSelectionLog = false;

  function allianceOf(combatant) {
    return combatant.alliance === undefined ? "player" : combatant.alliance;
  }

  function allianceLabel(combatant) {
    return allianceOf(combatant) === "enemy" ? "Enemy" : "Party";
  }

  function colorOf(combatant) {
    return COLORS[combatant.id] || "#8a94a3";
  }

  function degreeLabel(degree) {
    switch (degree) {
      case Checks.DEGREES.CRITICAL_SUCCESS:
        return "CRITICAL SUCCESS";
      case Checks.DEGREES.SUCCESS:
        return "SUCCESS";
      case Checks.DEGREES.FAILURE:
        return "FAILURE";
      case Checks.DEGREES.CRITICAL_FAILURE:
        return "CRITICAL FAILURE";
      default:
        return String(degree);
    }
  }

  function signed(value) {
    return value >= 0 ? "+ " + value : "- " + Math.abs(value);
  }

  function signedCompact(value) {
    return value >= 0 ? "+" + value : String(value);
  }

  function formatSaves(combatant) {
    const saves =
      typeof combatant.getSaves === "function"
        ? combatant.getSaves()
        : combatant.saves || {};
    return (
      "Fort " +
      signedCompact(saves.fortitude || 0) +
      " | Ref " +
      signedCompact(saves.reflex || 0) +
      " | Will " +
      signedCompact(saves.will || 0)
    );
  }

  function formatSkills(combatant) {
    const skills =
      typeof combatant.getSkills === "function"
        ? combatant.getSkills()
        : combatant.skills || {};
    return (
      "Athletics " +
      signedCompact(skills.athletics || 0) +
      " | Acrobatics " +
      signedCompact(skills.acrobatics || 0) +
      " | Stealth " +
      signedCompact(skills.stealth || 0) +
      " | Perception " +
      signedCompact(skills.perception || 0)
    );
  }

  function damageSpecOf(combatant) {
    return Damage.parseDamageSpec(combatant.damage, combatant.damageType);
  }

  function combatantIWR(combatant) {
    if (typeof combatant.getIWR === "function") {
      return combatant.getIWR();
    }
    return {
      immunities: Array.isArray(combatant.immunities) ? combatant.immunities : [],
      weaknesses: Array.isArray(combatant.weaknesses) ? combatant.weaknesses : [],
      resistances: Array.isArray(combatant.resistances) ? combatant.resistances : [],
    };
  }

  /**
   * Compact Selection-panel line:
   *   Immune: fire | Weak: slashing 2 | Resist: piercing 2
   */
  function formatIWRSummary(combatant) {
    const iwr = combatantIWR(combatant);
    const parts = [];

    if (iwr.immunities.length > 0) {
      parts.push("Immune: " + iwr.immunities.join(", "));
    }
    if (iwr.weaknesses.length > 0) {
      parts.push(
        "Weak: " +
          iwr.weaknesses
            .map(function (entry) {
              return entry.type + " " + entry.value;
            })
            .join(", "),
      );
    }
    if (iwr.resistances.length > 0) {
      parts.push(
        "Resist: " +
          iwr.resistances
            .map(function (entry) {
              return entry.type + " " + entry.value;
            })
            .join(", "),
      );
    }

    return parts.length > 0 ? parts.join(" | ") : "None";
  }

  /**
   * Expand the IWR audit into the combat-log chain. Each damage instance is
   * shown separately; the dice expression is only attached when the attack had
   * exactly one damage type, which is the common Strike case.
   */
  function formatIWRDamage(damage, iwr) {
    if (!iwr || !Array.isArray(iwr.breakdown) || iwr.breakdown.length === 0) {
      return null;
    }

    const diceText =
      damage && damage.diceCount > 0
        ? " [" +
          damage.rolls.join(" + ") +
          (damage.modifier === 0 ? "" : " " + signed(damage.modifier)) +
          "]"
        : "";

    const parts = iwr.breakdown.map(function (entry) {
      let text = String(entry.amount);
      if (iwr.breakdown.length === 1) {
        text += diceText;
      }
      text += " " + entry.type;

      if (entry.immune) {
        return text + " -> IMMUNE -> 0 damage dealt";
      }

      for (const step of entry.steps) {
        if (step.kind === "weakness") {
          text += " -> Weakness +" + step.value + " (" + entry.type + ")";
        } else if (step.kind === "resistance") {
          text += " -> Resistance -" + step.amount;
          if (step.amount < step.value) {
            text += " of " + step.value;
          }
          text += " (" + entry.type + ")";
        }
      }

      return text + " -> " + entry.finalAmount + " damage dealt";
    });

    let result = parts.join("; ");
    if (damage && damage.doubled) {
      const preDouble =
        (Number.isInteger(damage.baseTotal) ? damage.baseTotal : 0) +
        (Number.isInteger(damage.backstabber) ? damage.backstabber : 0);
      result += " (base " + preDouble + " × 2)";
    }
    return result;
  }

  /**
   * Explain fatal/deadly/backstabber contributions separately from the base
   * IWR chain, e.g.
   *   Fatal d10 replaces the base die (1d10+4): (11 + 1 Backstabber) × 2 = 24
   *   + Fatal extra 1d10 (7) = 31 slashing.
   */
  function formatTraitDamage(damage) {
    if (!damage) {
      return null;
    }
    const hasTraits =
      damage.fatal ||
      damage.deadly ||
      (Number.isInteger(damage.backstabber) && damage.backstabber > 0);
    if (!hasTraits) {
      return null;
    }

    const backstabber = Number.isInteger(damage.backstabber)
      ? damage.backstabber
      : 0;
    const parts = [];

    if (damage.critical && damage.fatal) {
      parts.push(
        "Fatal d" +
          damage.fatal.dieSize +
          " replaces the base die (" +
          damage.effectiveFormula +
          "): (" +
          damage.baseTotal +
          (backstabber > 0 ? " + 1 Backstabber" : "") +
          ") × 2 = " +
          damage.doubledBase,
      );
    } else if (damage.critical) {
      parts.push(
        "Base (" +
          damage.baseTotal +
          (backstabber > 0 ? " + 1 Backstabber" : "") +
          ") × 2 = " +
          damage.doubledBase,
      );
    } else {
      parts.push(
        "Base " +
          damage.baseTotal +
          (backstabber > 0 ? " + 1 Backstabber" : "") +
          " = " +
          damage.doubledBase,
      );
    }

    for (const extra of damage.extras || []) {
      if (extra.kind === "fatal") {
        parts.push("Fatal extra 1d" + extra.dieSize + " (" + extra.roll + ")");
      } else if (extra.kind === "deadly") {
        parts.push("Deadly 1d" + extra.dieSize + " (" + extra.roll + ")");
      }
    }

    return parts.join(" + ") + " = " + damage.total + " " + damage.type;
  }

  /**
   * Log every persistent damage instance and its separate DC 15 recovery
   * check. Damage and recovery are deliberately two lines: damage happens
   * first, then the condition is removed only if the flat check passes.
   */
  function logPersistentTick(tick) {
    if (!tick || !Array.isArray(tick.events) || tick.events.length === 0) {
      return null;
    }

    for (const event of tick.events) {
      const chain = formatIWRDamage(event.damage, event.iwr);
      let line =
        "[PERSISTENT DAMAGE] " +
        tick.combatantName +
        " takes " +
        (chain || event.damageDealt + " " + event.type + " damage") +
        ". " +
        tick.combatantName +
        " HP: " +
        event.hpBefore +
        " -> " +
        event.hpAfter;
      if (event.defeated) {
        line += " (Defeated)";
      }
      line += ".";
      log.add(line, "persistent");

      const recovery = event.recovery;
      log.add(
        "Recovery Check: Flat Check d20(" +
          recovery.d20 +
          ") vs DC " +
          recovery.dc +
          " -> " +
          (recovery.passed
            ? "PASSED (" + capitalize(event.type) + " cleared)."
            : "FAILED (" + capitalize(event.type) + " persists)."),
        recovery.passed ? "info" : "warn",
      );
    }

    return tick;
  }

  function formatMap(penalty) {
    return MultipleAttack.formatPenalty(penalty);
  }

  function modifierLabel(modifier) {
    if (modifier.source === "multiple-attack-penalty") {
      return "MAP";
    }
    if (modifier.name === "Hidden Attacker" && modifier.source === "off-guard") {
      return "Off-Guard (Hidden Attacker) [" + modifier.type + "]";
    }
    return modifier.name + " [" + modifier.type + "]";
  }

  function acModifierName(modifier) {
    if (modifier.name === "Hidden Attacker" && modifier.source === "off-guard") {
      return "Off-Guard (Hidden Attacker)";
    }
    return modifier.name;
  }

  function visibilityLabel(condition) {
    switch (condition) {
      case "concealed":
        return "Concealed";
      case "hidden":
        return "Hidden";
      case "undetected":
        return "Undetected";
      default:
        return condition;
    }
  }

  function flatCheckDescription(attacker, target, flatCheck) {
    return (
      attacker.name +
      " attacks " +
      target.name +
      " (" +
      visibilityLabel(flatCheck.condition) +
      "): Flat Check d20(" +
      flatCheck.roll +
      ") vs DC " +
      flatCheck.dc +
      " -> "
    );
  }

  function formatAttackExpression(result) {
    let text = "d20(" + result.attackRoll + ") " + signed(result.attackBonus) + " (base)";
    const modifiers = result.attackModifiers || [];
    for (const modifier of modifiers) {
      text += " " + signed(modifier.value) + " (" + modifierLabel(modifier) + ")";
    }
    return text + " = " + result.total;
  }

  function coverLabel(cover) {
    if (!cover || cover.degree === "none" || !cover.acBonus) {
      return "";
    }
    return cover.label.toUpperCase() + " (+" + cover.acBonus + " AC)";
  }

  function formatACExpression(result) {
    const modifiers = result.targetACModifiers || [];
    const suppressed = result.suppressedACModifiers || [];
    const visibleSuppressed = suppressed.filter(function (modifier) {
      return modifier.value !== 0;
    });

    if (modifiers.length === 0 && visibleSuppressed.length === 0) {
      return "AC " + result.targetAC;
    }

    let text = "AC " + result.targetAC + " (" + result.baseTargetAC;
    for (const modifier of modifiers) {
      text +=
        " " +
        signed(modifier.value) +
        " " +
        acModifierName(modifier) +
        " [" +
        modifier.type +
        "]";
    }
    for (const modifier of visibleSuppressed) {
      text +=
        " " +
        signed(modifier.value) +
        " " +
        acModifierName(modifier) +
        " [" +
        modifier.type +
        " · suppressed]";
    }
    return text + ")";
  }

  function formatReflexDCExpression(result) {
    let text = "Reflex DC " + result.reflexDC + " (10 + " + result.targetDCBaseValue;
    for (const modifier of result.targetDCModifiers || []) {
      text +=
        " " +
        signed(modifier.value) +
        " " +
        acModifierName(modifier) +
        " [" +
        modifier.type +
        "]";
    }
    return text + ")";
  }

  function formatFortitudeDCExpression(result) {
    let text =
      "Fortitude DC " + result.fortitudeDC + " (10 + " + result.targetDCBaseValue;
    for (const modifier of result.targetDCModifiers || []) {
      text +=
        " " +
        signed(modifier.value) +
        " " +
        acModifierName(modifier) +
        " [" +
        modifier.type +
        "]";
    }
    return text + ")";
  }

  function formatSkillExpression(result) {
    let text =
      result.skillLabel +
      " d20(" +
      result.attackRoll +
      ") " +
      signed(result.skillBase) +
      " (base)";
    for (const modifier of result.attackModifiers || []) {
      text += " " + signed(modifier.value) + " (" + modifierLabel(modifier) + ")";
    }
    return text + " = " + result.total;
  }

  /**
   * Trip log, e.g.
   *   Valeros attempts to Trip Goblin: Athletics d20(15) + 10 (base) - 5 (MAP)
   *   = 20 vs Reflex DC 18 (10 + 8) -> SUCCESS. Goblin is now Prone.
   */
  function logTripResolution(attacker, target, result) {
    const baseDegree = Checks.classifyTotal(result.total, result.dc);
    let line =
      attacker.name +
      " attempts to Trip " +
      target.name +
      ": " +
      formatSkillExpression(result) +
      " vs " +
      formatReflexDCExpression(result) +
      " -> " +
      degreeLabel(result.degree);

    if (result.isNatural20) {
      line +=
        baseDegree === result.degree
          ? " (Natural 20: already " + degreeLabel(result.degree) + ")"
          : " (Natural 20: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    } else if (result.isNatural1) {
      line +=
        baseDegree === result.degree
          ? " (Natural 1: already " + degreeLabel(result.degree) + ")"
          : " (Natural 1: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    }
    line += ".";

    if (result.critical) {
      line += " CRITICAL SUCCESS!";
      if (result.damage) {
        const iwrText = formatIWRDamage(result.damage, result.iwr);
        line +=
          " " +
          target.name +
          " is now Prone and takes " +
          (iwrText ||
            result.damage.total + " " + result.damage.type + " damage") +
          ".";
        line +=
          " " +
          target.name +
          " HP: " +
          result.hpBefore +
          " -> " +
          result.hpAfter +
          (result.targetDefeated ? " (Defeated)" : "") +
          ".";
      } else {
        line += " " + target.name + " is now Prone.";
      }
    } else if (result.success) {
      line += " " + target.name + " is now Prone.";
    } else if (result.attackerProne) {
      line += " " + attacker.name + " loses balance and is now Prone.";
    } else {
      line += " No effect.";
    }

    log.add(line, "trip");
    return line;
  }

  /**
   * Shove log, e.g.
   *   Valeros shoves Goblin: Athletics d20(5) + 10 (base) = 15 vs Fortitude
   *   DC 14 (10 + 4) -> SUCCESS. Goblin is pushed 5 ft to E3.
   */
  function logShoveResolution(attacker, target, result) {
    const baseDegree = Checks.classifyTotal(result.total, result.dc);
    let line =
      attacker.name +
      " shoves " +
      target.name +
      ": " +
      formatSkillExpression(result) +
      " vs " +
      formatFortitudeDCExpression(result) +
      " -> " +
      degreeLabel(result.degree) +
      ".";

    if (result.isNatural20) {
      line +=
        baseDegree === result.degree
          ? " (Natural 20: already " + degreeLabel(result.degree) + ")"
          : " (Natural 20: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    } else if (result.isNatural1) {
      line +=
        baseDegree === result.degree
          ? " (Natural 1: already " + degreeLabel(result.degree) + ")"
          : " (Natural 1: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    }

    if (result.critical) {
      line += " CRITICAL SUCCESS!";
    }

    if (result.success) {
      line +=
        " " +
        target.name +
        " is pushed " +
        result.pushedFeet +
        " ft to " +
        Grid.gridToLabel(result.targetPositionAfter) +
        ".";
      if (result.stoppedEarly) {
        line +=
          " The push stops early at " +
          (result.blockedReason === "wall"
            ? "a wall"
            : result.blockedReason === "creature"
              ? "another creature"
              : "the battlefield edge") +
          ".";
      } else if (result.pushedFeet === 0) {
        line += " The push is blocked immediately.";
      }
    } else if (result.attackerProne) {
      line += " " + attacker.name + " loses balance and is now Prone.";
    } else {
      line += " No effect.";
    }

    log.add(line, "shove");
    return line;
  }

  /**
   * Grapple log, e.g.
   *   Valeros attempts to Grapple Goblin: Athletics d20(5) + 10 (base) = 15
   *   vs Fortitude DC 14 (10 + 4) -> SUCCESS. Goblin is Grabbed.
   */
  function logGrappleResolution(attacker, target, result) {
    const baseDegree = Checks.classifyTotal(result.total, result.dc);
    let line =
      attacker.name +
      " attempts to Grapple " +
      target.name +
      ": " +
      formatSkillExpression(result) +
      " vs " +
      formatFortitudeDCExpression(result) +
      " -> " +
      degreeLabel(result.degree) +
      ".";

    if (result.isNatural20) {
      line +=
        baseDegree === result.degree
          ? " (Natural 20: already " + degreeLabel(result.degree) + ")"
          : " (Natural 20: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    } else if (result.isNatural1) {
      line +=
        baseDegree === result.degree
          ? " (Natural 1: already " + degreeLabel(result.degree) + ")"
          : " (Natural 1: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    }

    if (result.critical) {
      line += " CRITICAL SUCCESS!";
    }

    if (result.success) {
      const state = result.targetRestrained ? "Restrained" : "Grabbed";
      line +=
        " " +
        target.name +
        " is " +
        state +
        " (Off-Guard, Immobilized) until the end of " +
        attacker.name +
        "'s next turn.";
    } else if (result.attackerProne) {
      line +=
        " " +
        attacker.name +
        " loses balance and is now Prone." +
        (result.released.length > 0
          ? " " + target.name + " breaks free."
          : "");
    } else {
      line += " No effect.";
    }

    log.add(line, "grapple");
    return line;
  }

  /**
   * Escape log, e.g.
   *   Goblin attempts to Escape (Acrobatics +9) from Valeros: Acrobatics
   *   d20(5) + 9 (base) = 14 vs Athletics DC 13 (10 + 3) -> SUCCESS.
   */
  function logEscapeResolution(actor, result) {
    const baseDegree = Checks.classifyTotal(result.total, result.dc);
    let line =
      actor.name +
      " attempts to Escape (" +
      result.skillLabel +
      " " +
      signedCompact(result.skillBase) +
      ") from " +
      result.sourceName +
      ": " +
      formatSkillExpression(result) +
      " vs Athletics DC " +
      result.athleticsDC +
      " (10 + " +
      result.targetDCBaseValue;

    for (const modifier of result.targetDCModifiers || []) {
      line +=
        " " +
        signed(modifier.value) +
        " " +
        acModifierName(modifier) +
        " [" +
        modifier.type +
        "]";
    }
    line += ") -> " + degreeLabel(result.degree) + ".";

    if (result.isNatural20) {
      line +=
        baseDegree === result.degree
          ? " (Natural 20: already " + degreeLabel(result.degree) + ")"
          : " (Natural 20: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    } else if (result.isNatural1) {
      line +=
        baseDegree === result.degree
          ? " (Natural 1: already " + degreeLabel(result.degree) + ")"
          : " (Natural 1: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    }

    if (result.critical) {
      line += " CRITICAL SUCCESS!";
    }

    if (result.escaped) {
      line += " " + actor.name + " breaks free.";
    } else {
      line +=
        " " +
        actor.name +
        " remains " +
        (result.conditionLabel || "Grabbed") +
        ".";
    }

    log.add(line, "escape");
    return line;
  }

  function logReleasedGrapples(sourceName, released, reason) {
    if (!Array.isArray(released)) {
      return;
    }
    for (const entry of released) {
      const labels = entry.removed
        .map(function (condition) {
          return condition.label;
        })
        .join(", ");
      log.add(
        sourceName +
          " releases " +
          entry.combatantName +
          (labels ? " — " + labels + " ends" : "") +
          " (" +
          reason +
          ").",
        "info",
      );
    }
  }

  /**
   * Shared attack log used by both the normal Strike action and Reactive
   * Strike, so the roll/damage breakdown is identical for both.
   *
   * @param {{id:string,name:string}} attacker
   * @param {{id:string,name:string}} target
   * @param {object} result
   * @param {{label?:string, kind?:string}} [options]
   */
  function logAttackResolution(attacker, target, result, options) {
    const opts = options || {};

    if (result.flanked) {
      const flankerNames = (result.flankers || [])
        .map(function (flanker) {
          return flanker.name;
        })
        .join(", ");
      log.add(
        "FLANKED — " +
          attacker.name +
          (flankerNames ? " and " + flankerNames : "") +
          " catch " +
          target.name +
          " between them. " +
          target.name +
          " is Off-Guard (-2 circumstance AC).",
        "info",
      );
    }

    const hiddenPenalty = (result.targetACModifiers || []).some(function (modifier) {
      return modifier.name === "Hidden Attacker" && modifier.source === "off-guard";
    });
    if (hiddenPenalty) {
      log.add(
        "HIDDEN ATTACKER — " +
          target.name +
          " is Off-Guard (-2 circumstance AC) against " +
          attacker.name +
          "'s attack.",
        "info",
      );
    }

    const baseDegree = Checks.classifyTotal(result.total, result.dc);
    let line =
      (opts.label || attacker.name + " strikes " + target.name) +
      ": " +
      formatAttackExpression(result) +
      " vs " +
      formatACExpression(result) +
      " -> " +
      degreeLabel(result.degree);

    if (result.isNatural20) {
      line +=
        baseDegree === result.degree
          ? " (Natural 20: already " + degreeLabel(result.degree) + ")"
          : " (Natural 20: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    } else if (result.isNatural1) {
      line +=
        baseDegree === result.degree
          ? " (Natural 1: already " + degreeLabel(result.degree) + ")"
          : " (Natural 1: " +
            degreeLabel(baseDegree) +
            " -> " +
            degreeLabel(result.degree) +
            ")";
    }

    line += ".";
    if (result.critical) {
      line += " CRITICAL SUCCESS (Double Damage)!";
    }

    if (result.hit) {
      const damage = result.damage;
      const iwrText = formatIWRDamage(damage, result.iwr);
      line += " Damage: ";

      if (iwrText) {
        line += iwrText + ". ";
      } else {
        const diceText =
          damage.diceCount > 0
            ? " [" +
              damage.rolls.join(" + ") +
              (damage.modifier === 0 ? "" : " " + signed(damage.modifier)) +
              "]"
            : "";
        line +=
          result.damageDealt +
          diceText +
          (damage.doubled ? " (base " + damage.baseTotal + " × 2)" : "") +
          ". ";
      }

      line +=
        target.name +
        " HP: " +
        result.hpBefore +
        " -> " +
        result.hpAfter;
      if (result.targetDefeated) {
        line += " (Defeated)";
      }
      line += ".";
    } else {
      line +=
        " " +
        target.name +
        " takes no damage. HP: " +
        target.currentHP +
        "/" +
        target.maxHP +
        ".";
    }

    log.add(line, opts.kind || "attack");

    if (result.hit) {
      const traitText = formatTraitDamage(result.damage);
      if (traitText) {
        log.add("TRAITS — " + attacker.name + ": " + traitText + ".", "info");
      }
    }

    return line;
  }

  function conditionLabels(combatant) {
    if (typeof combatant.getConditions !== "function") {
      return [];
    }
    return combatant.getConditions().map(function (condition) {
      return condition.label;
    });
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function renderConditionBadges(container, combatant) {
    if (!container) {
      return;
    }
    container.replaceChildren();
    const conditions =
      typeof combatant.getConditions === "function" ? combatant.getConditions() : [];
    const persistent =
      typeof combatant.getPersistentDamage === "function"
        ? combatant.getPersistentDamage()
        : [];
    container.classList.toggle(
      "is-empty",
      conditions.length === 0 && persistent.length === 0,
    );

    for (const condition of conditions) {
      const badge = document.createElement("span");
      badge.className = "condition-badge condition-" + condition.slug;
      badge.textContent = condition.label;
      container.append(badge);
    }

    for (const instance of persistent) {
      const badge = document.createElement("span");
      badge.className =
        "condition-badge persistent-badge persistent-" + instance.type;
      badge.textContent =
        "Persistent " + capitalize(instance.type) + " " + instance.formula;
      container.append(badge);
    }
  }

  /**
   * Build action circles or reaction diamonds. The caller owns the spent state
   * because initiative rows are rebuilt while token cards are updated in place.
   *
   * @param {object} combatant
   * @param {"action"|"reaction"} kind
   * @param {string} className
   * @returns {{container: HTMLElement, pips: HTMLElement[]}}
   */
  function buildPips(combatant, kind, className) {
    const container = document.createElement("span");
    container.className = className;
    const count =
      kind === "reaction" ? combatant.maxReactions : combatant.maxActions;
    container.setAttribute(
      "aria-label",
      kind === "reaction" ? "Reactions remaining" : "Actions remaining",
    );

    const pips = [];
    for (let index = 0; index < count; index += 1) {
      const pip = document.createElement("span");
      pip.className = kind === "reaction" ? "reaction-pip" : "action-pip";
      container.append(pip);
      pips.push(pip);
    }
    return { container: container, pips: pips };
  }

  function findCombatant(id) {
    return COMBATANTS.find(function (candidate) {
      return candidate.id === id;
    });
  }

  function findNearestEnemy(combatant) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const candidate of COMBATANTS) {
      if (candidate.id === combatant.id) {
        continue;
      }
      if (candidate.isDefeated === true) {
        continue;
      }
      if (allianceOf(candidate) === allianceOf(combatant)) {
        continue;
      }
      const distance = Grid.distanceFeet(combatant, candidate);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return nearest ? { combatant: nearest, distanceFeet: nearestDistance } : null;
  }

  function getOccupancy(combatant) {
    return Occupancy.buildOccupancy(COMBATANTS, combatant);
  }

  function defaultStatus() {
    const active = encounter.activeCombatant;
    if (!active) {
      return encounter.isStarted
        ? "All combatants are defeated — the encounter is over."
        : "Start the encounter to begin the turn cycle.";
    }
    const mode = battlefield.getMode();
    if (mode === MODES.STEP) {
      return active.name + "'s turn — click an adjacent square to Step 5 ft (no difficult terrain).";
    }
    if (mode === MODES.STRIKE) {
      return (
        active.name +
        "'s turn — click an adjacent hostile token to Strike (MAP " +
        formatMap(active.getMultipleAttackPenalty()) +
        ")."
      );
    }
    if (mode === MODES.TRIP) {
      return (
        active.name +
        "'s turn — click a hostile token in reach to Trip (Athletics vs Reflex DC, MAP " +
        formatMap(active.getMultipleAttackPenalty()) +
        ")."
      );
    }
    if (mode === MODES.SHOVE) {
      return (
        active.name +
        "'s turn — click a hostile token in reach to Shove (Athletics vs Fortitude DC, MAP " +
        formatMap(active.getMultipleAttackPenalty()) +
        ")."
      );
    }
    if (mode === MODES.GRAPPLE) {
      return (
        active.name +
        "'s turn — click a hostile token in reach to Grapple (Athletics vs Fortitude DC, MAP " +
        formatMap(active.getMultipleAttackPenalty()) +
        ")."
      );
    }
    return active.name + "'s turn — hover a square to preview a Stride, click to move.";
  }

  function addStat(label, value, color) {
    const row = document.createElement("div");
    row.className = "stat-row";

    const labelEl = document.createElement("span");
    labelEl.className = "stat-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("span");
    valueEl.className = "stat-value";

    if (color) {
      const swatch = document.createElement("span");
      swatch.className = "stat-swatch";
      swatch.style.background = color;
      valueEl.append(swatch);
    }

    valueEl.append(document.createTextNode(value));
    row.append(labelEl, valueEl);
    selectionEl.append(row);
  }

  function renderSelection(combatant, cells) {
    selectionEl.replaceChildren();

    if (!combatant) {
      const empty = document.createElement("p");
      empty.className = "selection-empty";
      empty.textContent =
        "No token selected. The active combatant is selected automatically at the start of its turn.";
      selectionEl.append(empty);
      return;
    }

    const mode = battlefield.getMode();
    const reachableLabel =
      mode === MODES.STEP
        ? "Step targets"
        : mode === MODES.STRIKE
          ? "Strike targets"
          : mode === MODES.TRIP
            ? "Trip targets"
            : mode === MODES.SHOVE
              ? "Shove targets"
              : mode === MODES.GRAPPLE
                ? "Grapple targets"
                : "Reachable";

    addStat("Token", combatant.name, colorOf(combatant));
    addStat("Alliance", allianceLabel(combatant));
    addStat("Initiative", String(combatant.initiative));
    addStat("HP", combatant.currentHP + " / " + combatant.maxHP);
    addStat("AC", String(combatant.ac));
    addStat("Saves", formatSaves(combatant));
    addStat("Skills", formatSkills(combatant));
    const damageSpec = damageSpecOf(combatant);
    const traitLabels =
      typeof combatant.getTraitLabels === "function"
        ? combatant.getTraitLabels()
        : [];
    addStat(
      "Attack",
      signed(combatant.attackBonus) +
        " · " +
        damageSpec.formula +
        " " +
        damageSpec.type +
        (combatant.agile ? " (agile)" : ""),
    );
    addStat(
      "Weapon",
      damageSpec.formula +
        " " +
        damageSpec.type +
        (traitLabels.length > 0 ? " [" + traitLabels.join(", ") + "]" : ""),
    );
    addStat(
      "Traits",
      traitLabels.length > 0 ? traitLabels.join(", ") : "None",
    );
    addStat(
      "Reach",
      (typeof combatant.getReachFeet === "function"
        ? combatant.getReachFeet()
        : 5) + " ft",
    );
    addStat(
      "MAP",
      formatMap(combatant.getMultipleAttackPenalty()) +
        " (attack " +
        (combatant.attacksThisTurn + 1) +
        ")",
    );
    addStat("Position", Grid.gridToLabel(combatant));
    addStat("Speed", combatant.speedFeet + " ft (" + combatant.speedSquares + " squares)");
    addStat("Actions", combatant.actionsRemaining + " / " + combatant.maxActions);
    addStat(
      "Reactions",
      combatant.reactionsRemaining + " / " + combatant.maxReactions,
    );
    const conditions = conditionLabels(combatant);
    addStat("Conditions", conditions.length > 0 ? conditions.join(", ") : "None");
    addStat("IWR", formatIWRSummary(combatant));
    const bestCover = Cover.getBestCover(combatant, COMBATANTS, map);
    addStat(
      "Cover",
      bestCover.degree === "none"
        ? "None"
        : coverLabel(bestCover),
    );
    if (combatant.isDefeated === true) {
      addStat("State", "Defeated");
    }
    addStat("Mode", mode.charAt(0).toUpperCase() + mode.slice(1));
    addStat(
      reachableLabel,
      mode === MODES.STRIKE
        ? battlefield.getStrikeTargets().length + " in reach"
        : mode === MODES.TRIP
          ? battlefield.getTripTargets().length + " in reach"
          : mode === MODES.SHOVE
            ? battlefield.getShoveTargets().length + " in reach"
            : mode === MODES.GRAPPLE
              ? battlefield.getGrappleTargets().length + " in reach"
              : cells.length + " squares",
    );
    addStat(
      "Next diagonal",
      combatant.diagonalParity === 0 ? "5 ft" : "10 ft",
    );

    const nearest = findNearestEnemy(combatant);
    if (nearest) {
      const sight = LosMath.hasLineOfSight(combatant, nearest.combatant, map);
      addStat(
        "Nearest foe",
        nearest.combatant.name +
          " · " +
          nearest.distanceFeet +
          " ft · " +
          (sight ? "LoS" : "no LoS"),
      );
    }
  }

  function renderInitiative() {
    roundIndicatorEl.textContent = "Round " + encounter.round;
    initiativeEl.replaceChildren();

    encounter.getOrder().forEach(function (combatant, index) {
      const row = document.createElement("div");
      row.className = "initiative-row";
      row.dataset.combatantId = combatant.id;
      if (encounter.isActive(combatant)) {
        row.classList.add("is-active");
        row.setAttribute("aria-current", "true");
      }
      if (allianceOf(combatant) === "enemy") {
        row.classList.add("is-enemy");
      }
      if (combatant.isDefeated === true) {
        row.classList.add("is-defeated");
      }

      const order = document.createElement("span");
      order.className = "initiative-index";
      order.textContent = String(index + 1);

      const dot = document.createElement("span");
      dot.className = "initiative-dot";
      dot.style.background = combatant.isDefeated === true ? "#5c636d" : colorOf(combatant);

      const meta = document.createElement("span");
      meta.className = "initiative-meta";

      const name = document.createElement("span");
      name.className = "initiative-name";
      name.textContent = combatant.name;

      const alliance = document.createElement("span");
      alliance.className = "initiative-alliance";
      alliance.textContent =
        combatant.isDefeated === true
          ? "Defeated · HP 0/" + combatant.maxHP
          : allianceLabel(combatant) +
            " · HP " +
            combatant.currentHP +
            "/" +
            combatant.maxHP;

      const conditionBadges = document.createElement("span");
      conditionBadges.className = "initiative-conditions condition-badges is-empty";
      renderConditionBadges(conditionBadges, combatant);

      meta.append(name, alliance, conditionBadges);

      const value = document.createElement("span");
      value.className = "initiative-value";
      value.textContent = String(combatant.initiative);

      const pools = document.createElement("span");
      pools.className = "initiative-pools";
      const actionPips = buildPips(
        combatant,
        "action",
        "action-pips initiative-action-pips",
      );
      const reactionPips = buildPips(
        combatant,
        "reaction",
        "reaction-pips initiative-reaction-pips",
      );

      actionPips.pips.forEach(function (pip, index) {
        pip.classList.toggle(
          "is-spent",
          combatant.isDefeated === true || index >= combatant.actionsRemaining,
        );
      });
      reactionPips.pips.forEach(function (pip, index) {
        pip.classList.toggle(
          "is-spent",
          combatant.isDefeated === true ||
            index >= combatant.reactionsRemaining,
        );
      });

      pools.title = combatant.isDefeated
        ? "Defeated"
        : combatant.actionsRemaining +
          "/" +
          combatant.maxActions +
          " actions · " +
          combatant.reactionsRemaining +
          "/" +
          combatant.maxReactions +
          " reactions";
      pools.append(actionPips.container, reactionPips.container);

      row.append(order, dot, meta, value, pools);
      initiativeEl.append(row);
    });
  }

  function updateStrikeButton() {
    const strikeButton = modeButtons.find(function (button) {
      return button.dataset.mode === MODES.STRIKE;
    });
    if (!strikeButton) {
      return;
    }

    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      strikeButton.textContent = "Strike";
      strikeButton.removeAttribute("title");
      return;
    }

    const penalty = active.getMultipleAttackPenalty();
    strikeButton.textContent = "Strike (" + formatMap(penalty) + ")";
    const damageSpec = damageSpecOf(active);
    const traitLabels =
      typeof active.getTraitLabels === "function" ? active.getTraitLabels() : [];
    strikeButton.title =
      "Next attack: " +
      signed(active.attackBonus) +
      " " +
      formatMap(penalty) +
      " MAP · " +
      damageSpec.formula +
      " " +
      damageSpec.type +
      (traitLabels.length > 0 ? " [" + traitLabels.join(", ") + "]" : "") +
      " · reach " +
      (typeof active.getReachFeet === "function" ? active.getReachFeet() : 5) +
      " ft";
  }

  function updateRaiseShieldButton() {
    if (!raiseShieldButton) {
      return;
    }

    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      raiseShieldButton.textContent = "Raise Shield";
      raiseShieldButton.disabled = true;
      raiseShieldButton.classList.remove("is-raised");
      raiseShieldButton.removeAttribute("title");
      return;
    }

    const raised = active.hasCondition("shield-raised");
    const hasAction =
      typeof active.canSpendActions === "function"
        ? active.canSpendActions(1)
        : active.actionsRemaining >= 1;

    raiseShieldButton.textContent = raised ? "Shield Raised ✓" : "Raise Shield";
    raiseShieldButton.disabled = !hasAction;
    raiseShieldButton.classList.toggle("is-raised", raised);
    raiseShieldButton.title = raised
      ? "+2 circumstance AC is active. Raising again costs 1 action but does not stack."
      : "+2 circumstance AC until the start of your next turn · 1 action";
  }

  function updateTakeCoverButton() {
    if (!takeCoverButton) {
      return;
    }

    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      takeCoverButton.textContent = "Take Cover";
      takeCoverButton.disabled = true;
      takeCoverButton.classList.remove("is-raised");
      takeCoverButton.removeAttribute("title");
      return;
    }

    const hasAction =
      typeof active.canSpendActions === "function"
        ? active.canSpendActions(1)
        : active.actionsRemaining >= 1;
    const cover = Cover.getBestCover(active, COMBATANTS, map);
    const eligible = Cover.isStandardOrGreater(cover);
    const covered = active.hasCondition("greater-cover");

    takeCoverButton.textContent = covered ? "Greater Cover ✓" : "Take Cover";
    takeCoverButton.disabled = !hasAction || !eligible;
    takeCoverButton.classList.toggle("is-raised", covered);
    takeCoverButton.title = eligible
      ? covered
        ? "+4 circumstance AC is active. Moving or ending the turn removes it."
        : "Standard cover detected (" +
          cover.degree +
          "). +4 circumstance AC until your next turn or move · 1 action"
      : "Requires standard cover or better from a hostile attacker.";
  }

  function updateTripButton() {
    const tripButton = modeButtons.find(function (button) {
      return button.dataset.mode === MODES.TRIP;
    });
    if (!tripButton) {
      return;
    }

    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      tripButton.textContent = "Trip";
      tripButton.removeAttribute("title");
      return;
    }

    const penalty = active.getMultipleAttackPenalty(false);
    const athletics =
      typeof active.getSkillModifier === "function"
        ? active.getSkillModifier("athletics")
        : 0;
    tripButton.textContent = "Trip (" + formatMap(penalty) + ")";
    tripButton.title =
      "Athletics " +
      signedCompact(athletics) +
      " " +
      formatMap(penalty) +
      " MAP vs Reflex DC · 1 action · success = Prone";
  }

  function updateManeuverModeButton(mode, label, defenseLabel, effectText) {
    const button = modeButtons.find(function (candidate) {
      return candidate.dataset.mode === mode;
    });
    if (!button) {
      return;
    }

    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      button.textContent = label;
      button.removeAttribute("title");
      return;
    }

    const penalty = active.getMultipleAttackPenalty(false);
    const athletics =
      typeof active.getSkillModifier === "function"
        ? active.getSkillModifier("athletics")
        : 0;
    button.textContent = label + " (" + formatMap(penalty) + ")";
    button.title =
      "Athletics " +
      signedCompact(athletics) +
      " " +
      formatMap(penalty) +
      " MAP vs " +
      defenseLabel +
      " · 1 action · " +
      effectText;
  }

  function updateShoveButton() {
    updateManeuverModeButton(
      MODES.SHOVE,
      "Shove",
      "Fortitude DC",
      "push 5 ft (critical 10 ft), critical failure = Prone",
    );
  }

  function updateGrappleButton() {
    updateManeuverModeButton(
      MODES.GRAPPLE,
      "Grapple",
      "Fortitude DC",
      "success = Grabbed, critical = Restrained",
    );
  }

  function updateEscapeButton() {
    if (!escapeButton) {
      return;
    }

    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      escapeButton.textContent = "Escape";
      escapeButton.disabled = true;
      escapeButton.classList.remove("is-raised");
      escapeButton.removeAttribute("title");
      return;
    }

    const condition =
      typeof active.getGrappleCondition === "function"
        ? active.getGrappleCondition()
        : Conditions.getGrappleCondition(active);
    const hasAction =
      typeof active.canSpendActions === "function"
        ? active.canSpendActions(1)
        : active.actionsRemaining >= 1;

    if (!condition) {
      escapeButton.textContent = "Escape";
      escapeButton.disabled = true;
      escapeButton.classList.remove("is-raised");
      escapeButton.title = "Only available while Grabbed or Restrained.";
      return;
    }

    const evaluation = Escape.evaluateEscape({
      actor: active,
      combatants: COMBATANTS,
    });

    escapeButton.disabled = !hasAction;
    escapeButton.classList.add("is-raised");

    if (!evaluation.ok) {
      escapeButton.textContent = "Escape ✓";
      escapeButton.title =
        evaluation.reason === Escape.ESCAPE_REASONS.SOURCE_DEFEATED
          ? "The grappler is defeated — clicking Escape releases the hold without spending an action."
          : "Escape is not currently possible.";
      return;
    }

    escapeButton.textContent =
      "Escape (" + evaluation.skillLabel + " " + signedCompact(evaluation.attackModifier) + ")";
    escapeButton.title =
      "Best option: " +
      evaluation.skillLabel +
      " " +
      signedCompact(evaluation.attackModifier) +
      " (MAP " +
      formatMap(evaluation.mapPenalty) +
      ") vs Athletics DC " +
      evaluation.athleticsDC +
      " · 1 action" +
      (evaluation.flatCheckDC ? " · FLAT CHECK DC " + evaluation.flatCheckDC : "");
  }

  function updateStandButton() {
    if (!standButton) {
      return;
    }

    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      standButton.textContent = "Stand";
      standButton.disabled = true;
      standButton.classList.remove("is-raised");
      standButton.removeAttribute("title");
      return;
    }

    const prone =
      typeof active.hasCondition === "function" &&
      active.hasCondition("prone");
    const hasAction =
      typeof active.canSpendActions === "function"
        ? active.canSpendActions(1)
        : active.actionsRemaining >= 1;
    const immobilized =
      typeof active.isImmobilized === "function" && active.isImmobilized();

    standButton.textContent = prone ? "Stand ✓" : "Stand";
    standButton.disabled = !prone || !hasAction || immobilized;
    standButton.classList.toggle("is-raised", prone);
    standButton.title = immobilized
      ? "Cannot Stand while Immobilized by Grabbed/Restrained. Use Escape first."
      : prone
        ? hasAction
          ? "Removes Prone for 1 action. Stand is a move action and provokes Reactive Strike."
          : "Removes Prone for 1 action, but no actions remain."
        : "Only available while Prone.";
  }

  function updateModeUi() {
    const mode = battlefield.getMode();
    for (const button of modeButtons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (modeHintEl) {
      if (mode === MODES.STEP) {
        modeHintEl.textContent =
          "Step moves exactly 5 ft for 1 action and cannot enter difficult terrain.";
      } else if (mode === MODES.STRIKE) {
        modeHintEl.textContent =
          "Strike costs 1 action, uses weapon reach (5 ft, or 10 ft with reach) and line of sight. Concealed targets need a DC 5 flat check, Hidden DC 11; a failed check still spends the action and MAP. Undetected targets cannot be selected.";
      } else if (mode === MODES.TRIP) {
        modeHintEl.textContent =
          "Trip costs 1 action and has the attack trait. Roll Athletics against Reflex DC (10 + Reflex + modifiers): critical success = Prone + 1d6 bludgeoning, success = Prone, critical failure = you fall Prone.";
      } else if (mode === MODES.SHOVE) {
        modeHintEl.textContent =
          "Shove costs 1 action and has the attack trait. Roll Athletics against Fortitude DC (10 + Fortitude + modifiers): success pushes the target 5 ft, critical success 10 ft, critical failure = you fall Prone. The push stops before a wall, another creature, or the battlefield edge.";
      } else if (mode === MODES.GRAPPLE) {
        modeHintEl.textContent =
          "Grapple costs 1 action and has the attack trait. Roll Athletics against Fortitude DC: success = Grabbed, critical success = Restrained, critical failure = you fall Prone. Grabbed/Restrained impose Off-Guard and Immobilized until the end of your next turn, or until you move or are defeated.";
      } else {
        modeHintEl.textContent =
          "Stride moves up to Speed for 1 action. Difficult terrain adds 5 ft per square. Leaving a threatened square can provoke a Reactive Strike; Step never does.";
      }
    }
    updateStrikeButton();
    updateTripButton();
    updateShoveButton();
    updateGrappleButton();
    updateRaiseShieldButton();
    updateTakeCoverButton();
    updateStandButton();
    updateEscapeButton();
  }

  function setSelectedCard(combatantId) {
    for (const entry of tokenCards) {
      const isSelected = entry[0] === combatantId;
      entry[1].card.classList.toggle("is-selected", isSelected);
      entry[1].card.setAttribute("aria-pressed", isSelected ? "true" : "false");
    }
  }

  function updateTokenCards() {
    for (const combatant of COMBATANTS) {
      const refs = tokenCards.get(combatant.id);
      if (!refs) {
        continue;
      }

      const defeated = combatant.isDefeated === true;
      const ratio =
        combatant.maxHP > 0 ? combatant.currentHP / combatant.maxHP : 0;

      refs.sub.textContent = defeated
        ? "Defeated · HP 0/" + combatant.maxHP
        : "Init " +
          combatant.initiative +
          " · " +
          Grid.gridToLabel(combatant) +
          " · " +
          combatant.actionsRemaining +
          "/" +
          combatant.maxActions;
      refs.hpText.textContent = "HP " + combatant.currentHP + "/" + combatant.maxHP;
      renderConditionBadges(refs.conditionBadges, combatant);
      refs.hpFill.style.width = Math.round(ratio * 100) + "%";
      refs.hpFill.classList.toggle("is-mid", ratio > 0.25 && ratio <= 0.5);
      refs.hpFill.classList.toggle("is-low", ratio <= 0.25);
      refs.pips.forEach(function (pip, index) {
        pip.classList.toggle("is-spent", index >= combatant.actionsRemaining);
      });
      refs.reactionPips.forEach(function (pip, index) {
        pip.classList.toggle("is-spent", index >= combatant.reactionsRemaining);
      });
      refs.card.classList.toggle("is-active-turn", encounter.isActive(combatant));
      refs.card.classList.toggle("is-enemy", allianceOf(combatant) === "enemy");
      refs.card.classList.toggle("is-defeated", defeated);
    }
    renderInitiative();
    updateStrikeButton();
    updateTripButton();
    updateShoveButton();
    updateGrappleButton();
    updateRaiseShieldButton();
    updateTakeCoverButton();
    updateStandButton();
    updateEscapeButton();
  }

  function updateHoverStatus(info) {
    statusEl.className = "board-hint board-status";
    delete statusEl.dataset.state;

    if (!info || info.status === "no-selection") {
      statusEl.textContent = defaultStatus();
      return;
    }

    if (info.status === "origin") {
      statusEl.textContent = info.label + " — selected token's square.";
      return;
    }

    if (info.status === "blocked") {
      statusEl.textContent = info.label + " is blocked.";
      statusEl.classList.add("is-blocked");
      statusEl.dataset.state = "blocked";
      return;
    }

    if (info.status === "occupied-enemy") {
      statusEl.textContent =
        info.label +
        " is occupied by " +
        info.occupant.name +
        " (enemy) — the square blocks movement.";
      statusEl.classList.add("is-blocked");
      statusEl.dataset.state = "occupied-enemy";
      return;
    }

    if (info.status === "occupied-ally") {
      statusEl.textContent =
        info.label +
        " is occupied by " +
        info.occupant.name +
        " (ally) — you may pass through, but cannot stop there.";
      statusEl.classList.add("is-invalid");
      statusEl.dataset.state = "occupied-ally";
      return;
    }

    if (info.status === "no-path") {
      statusEl.textContent = "No route to " + info.label + ".";
      statusEl.classList.add("is-blocked");
      statusEl.dataset.state = "no-path";
      return;
    }

    if (info.status === "step") {
      if (info.valid) {
        statusEl.textContent =
          info.combatant.name +
          ": Step " +
          info.label +
          " · 5 ft · 1 action";
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "step";
        statusEl.dataset.cost = "5";
      } else {
        statusEl.textContent =
          "Step to " + info.label + " — " + describeStepFailure(info.reason) + ".";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      }
      return;
    }

    if (info.status === "strike") {
      if (info.valid) {
        statusEl.textContent =
          info.combatant.name +
          " → " +
          info.target.name +
          " · " +
          info.distanceFeet +
          " ft · reach " +
          (info.reachFeet || 5) +
          " ft · line of sight clear · 1 action" +
          (info.flanked ? " · FLANKED (Off-Guard -2 AC)" : "") +
          (info.hiddenAttacker ? " · TARGET OFF-GUARD (-2 AC)" : "") +
          (info.flatCheckDC ? " · FLAT CHECK DC " + info.flatCheckDC : "") +
          (coverLabel(info.cover) ? " · " + coverLabel(info.cover) : "");
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "strike";
      } else if (info.reason === Strike.STRIKE_REASONS.TARGET_UNDETECTED) {
        statusEl.textContent =
          "CANNOT TARGET UNDETECTED — " +
          info.target.name +
          " is not at a known position.";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      } else {
        const hints = [];
        if (info.hiddenAttacker) {
          hints.push("TARGET OFF-GUARD (-2 AC)");
        }
        if (info.flatCheckDC) {
          hints.push("FLAT CHECK DC " + info.flatCheckDC);
        }
        statusEl.textContent =
          "Cannot Strike " +
          info.target.name +
          " — " +
          describeStrikeFailure(info.reason, info) +
          "." +
          (hints.length > 0 ? " " + hints.join(" · ") + "." : "");
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      }
      return;
    }

    if (info.status === "strike-empty") {
      statusEl.textContent = "Select a hostile token within reach to Strike.";
      return;
    }

    if (info.status === "trip") {
      if (info.valid) {
        statusEl.textContent =
          info.combatant.name +
          " → " +
          info.target.name +
          " · TRIP · Athletics " +
          signedCompact(info.skillBase) +
          (info.mapPenalty ? " " + info.mapPenalty + " MAP" : "") +
          " vs Reflex DC " +
          info.reflexDC +
          " · 1 action" +
          (info.flatCheckDC ? " · FLAT CHECK DC " + info.flatCheckDC : "") +
          (coverLabel(info.cover) ? " · " + coverLabel(info.cover) : "");
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "trip";
      } else if (info.reason === Strike.STRIKE_REASONS.TARGET_UNDETECTED) {
        statusEl.textContent =
          "CANNOT TARGET UNDETECTED — " +
          info.target.name +
          " is not at a known position.";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      } else {
        statusEl.textContent =
          "Cannot Trip " +
          info.target.name +
          " — " +
          describeStrikeFailure(info.reason, info) +
          ".";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      }
      return;
    }

    if (info.status === "trip-empty") {
      statusEl.textContent = "Select a hostile token within reach to Trip.";
      return;
    }

    if (info.status === "shove") {
      if (info.valid) {
        statusEl.textContent =
          info.combatant.name +
          " → " +
          info.target.name +
          " · SHOVE · Athletics " +
          signedCompact(info.skillBase) +
          (info.mapPenalty ? " " + info.mapPenalty + " MAP" : "") +
          " vs Fortitude DC " +
          info.fortitudeDC +
          " · push up to " +
          info.potentialPushedFeet +
          " ft · 1 action" +
          (info.flatCheckDC ? " · FLAT CHECK DC " + info.flatCheckDC : "");
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "shove";
      } else {
        statusEl.textContent =
          "Cannot Shove " +
          info.target.name +
          " — " +
          describeStrikeFailure(info.reason, info) +
          ".";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      }
      return;
    }

    if (info.status === "shove-empty") {
      statusEl.textContent = "Select a hostile token within reach to Shove.";
      return;
    }

    if (info.status === "grapple") {
      if (info.valid) {
        statusEl.textContent =
          info.combatant.name +
          " → " +
          info.target.name +
          " · GRAPPLE · Athletics " +
          signedCompact(info.skillBase) +
          (info.mapPenalty ? " " + info.mapPenalty + " MAP" : "") +
          " vs Fortitude DC " +
          info.fortitudeDC +
          " · 1 action" +
          (info.flatCheckDC ? " · FLAT CHECK DC " + info.flatCheckDC : "");
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "grapple";
      } else {
        statusEl.textContent =
          "Cannot Grapple " +
          info.target.name +
          " — " +
          describeStrikeFailure(info.reason, info) +
          ".";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      }
      return;
    }

    if (info.status === "grapple-empty") {
      statusEl.textContent = "Select a hostile token within reach to Grapple.";
      return;
    }

    if (info.status === "immobilized") {
      statusEl.textContent =
        info.combatant.name +
        " is Immobilized (Grabbed/Restrained) and cannot Stride, Step, or Stand.";
      statusEl.classList.add("is-blocked");
      statusEl.dataset.state = "immobilized";
      return;
    }

    if (info.status === "path") {
      let suffix = "";
      if (info.reason === "exceeds-speed") {
        suffix = " — exceeds Speed";
      } else if (info.reason === "no-actions") {
        suffix = " — no actions left";
      }
      if (info.difficultTerrain) {
        suffix += " — difficult terrain";
      }

      statusEl.textContent =
        info.combatant.name +
        ": " +
        info.startLabel +
        " → " +
        info.destinationLabel +
        " · " +
        info.costFeet +
        " ft" +
        suffix;
      statusEl.classList.add(info.affordable ? "is-valid" : "is-invalid");
      statusEl.dataset.state = info.reason || "valid";
      statusEl.dataset.cost = String(info.costFeet);
    }
  }

  function describeStrideFailure(result, combatant) {
    switch (result.reason) {
      case Stride.STRIDE_REASONS.NO_ACTIONS:
        return combatant.name + " has no actions left";
      case Stride.STRIDE_REASONS.IMMOBILIZED:
        return combatant.name + " is Immobilized (Grabbed/Restrained) and cannot Stride";
      case Stride.STRIDE_REASONS.ALREADY_THERE:
        return "the token is already on that square";
      case Stride.STRIDE_REASONS.OUT_OF_BOUNDS:
        return "the destination is outside the battlefield";
      case Stride.STRIDE_REASONS.BLOCKED_START:
        return "the token's current square is blocked";
      case Stride.STRIDE_REASONS.BLOCKED_DESTINATION:
        return "the destination is blocked";
      case Stride.STRIDE_REASONS.DESTINATION_OCCUPIED:
        return "the destination is occupied by an ally";
      case Stride.STRIDE_REASONS.UNREACHABLE:
        return "there is no route to the destination";
      case Stride.STRIDE_REASONS.EXCEEDS_SPEED:
        return (
          "the route costs " +
          result.costFeet +
          " ft but Speed is " +
          combatant.speedFeet +
          " ft"
        );
      default:
        return result.reason;
    }
  }

  function describeStepFailure(reason) {
    switch (reason) {
      case Step.STEP_REASONS.NO_ACTIONS:
        return "no actions left";
      case Step.STEP_REASONS.IMMOBILIZED:
        return "the creature is Immobilized (Grabbed/Restrained) and cannot Step";
      case Step.STEP_REASONS.NOT_ADJACENT:
        return "the destination is not adjacent";
      case Step.STEP_REASONS.DIFFICULT_TERRAIN:
        return "Step cannot enter difficult terrain";
      case Step.STEP_REASONS.DESTINATION_OCCUPIED:
        return "the destination is occupied";
      case Step.STEP_REASONS.CORNER_BLOCKED:
        return "the diagonal corner is blocked";
      case Step.STEP_REASONS.BLOCKED_DESTINATION:
        return "the destination is blocked";
      case Step.STEP_REASONS.OUT_OF_BOUNDS:
        return "the destination is outside the battlefield";
      case Step.STEP_REASONS.ALREADY_THERE:
        return "the token is already on that square";
      default:
        return reason;
    }
  }

  function describeStrikeFailure(reason, info) {
    switch (reason) {
      case Strike.STRIKE_REASONS.NO_ACTIONS:
        return "no actions left";
      case Strike.STRIKE_REASONS.OUT_OF_REACH:
        return (
          "out of reach" +
          (info && info.distanceFeet !== undefined
            ? " (" +
              info.distanceFeet +
              " ft, reach " +
              (info.reachFeet || 5) +
              " ft)"
            : "")
        );
      case Strike.STRIKE_REASONS.NO_LINE_OF_SIGHT:
        return "no line of sight";
      case Strike.STRIKE_REASONS.ALLY:
        return "the target is an ally";
      case Strike.STRIKE_REASONS.INVALID_TARGET:
        return "invalid target";
      case Strike.STRIKE_REASONS.ATTACKER_DEFEATED:
        return "the attacker is defeated";
      case Strike.STRIKE_REASONS.TARGET_DEFEATED:
        return "the target is already defeated";
      case Strike.STRIKE_REASONS.TARGET_UNDETECTED:
        return "the target is Undetected and cannot be targeted directly";
      default:
        return reason;
    }
  }

  const battlefield = new View.BattlefieldView({
    canvas: canvas,
    combatants: COMBATANTS,
    map: map,
    cellSize: CELL_SIZE,
    diagonalCornerPolicy: CORNER_POLICY,
    getColor: colorOf,
    getOccupancy: getOccupancy,
    onSelectionChange: function (combatant, cells) {
      setSelectedCard(combatant ? combatant.id : null);
      renderSelection(combatant, cells);
      updateTokenCards();

      if (!combatant) {
        if (!suppressSelectionLog) {
          log.add("Selection cleared.", "muted");
        }
        return;
      }

      const mode = battlefield.getMode();
      const countText =
        mode === MODES.STRIKE
          ? battlefield.getStrikeTargets().length + " targets in reach"
          : mode === MODES.TRIP
            ? battlefield.getTripTargets().length + " trip targets in reach"
            : mode === MODES.SHOVE
              ? battlefield.getShoveTargets().length + " shove targets in reach"
              : mode === MODES.GRAPPLE
                ? battlefield.getGrappleTargets().length + " grapple targets in reach"
                : cells.length +
                  (mode === MODES.STEP ? " step targets" : " squares reachable");

      log.add(
        combatant.name +
          " selected at " +
          Grid.gridToLabel(combatant) +
          " — " +
          countText +
          ", " +
          combatant.actionsRemaining +
          "/" +
          combatant.maxActions +
          " actions left.",
        "select",
      );

      const nearest = findNearestEnemy(combatant);
      if (nearest) {
        const sight = LosMath.hasLineOfSight(combatant, nearest.combatant, map);
        log.add(
          nearest.combatant.name +
            " is " +
            nearest.distanceFeet +
            " ft away; line of sight " +
            (sight ? "clear" : "blocked") +
            ".",
          "info",
        );
      }
    },
    onStrideRequest: function (combatant, cell) {
      const lostGreaterCover = combatant.hasCondition("greater-cover");
      const result = Stride.performStride({
        combatant: combatant,
        map: map,
        destination: cell,
        diagonalCornerPolicy: CORNER_POLICY,
        occupancy: getOccupancy(combatant),
        combatants: COMBATANTS,
        rollD20: function () {
          return 1 + Math.floor(Math.random() * 20);
        },
        rollDamageDie: function (sides) {
          return 1 + Math.floor(Math.random() * sides);
        },
      });

      if (!result.ok) {
        log.add(
          "Stride canceled — " + describeStrideFailure(result, combatant) + ".",
          "warn",
        );
        return;
      }

      const movementText = result.movementInterrupted
        ? "Moves " + result.movedCostFeet + " ft before being stopped."
        : "Moves " + result.movedCostFeet + " ft.";
      log.add(
        combatant.name +
          " uses Stride. " +
          movementText +
          " Actions left: " +
          result.actionsLeft,
        "move",
      );

      logReleasedGrapples(
        combatant.name,
        result.releasedGrapples,
        "the grappler moved",
      );

      for (const reaction of result.reactions) {
        const reactor =
          findCombatant(reaction.attackerId) || {
            id: reaction.attackerId,
            name: reaction.attackerName,
            maxReactions: 1,
          };
        log.add(
          "[REACTION] " +
            reaction.attackerName +
            " uses Reactive Strike against " +
            reaction.targetName +
            "!",
          "reaction",
        );

        const spentLine =
          reaction.attackerName +
          " reaction spent · Reactions left: " +
          reaction.reactionsLeft +
          "/" +
          reactor.maxReactions +
          ".";

        if (reaction.flatCheck) {
          const flatText = flatCheckDescription(
            reactor,
            combatant,
            reaction.flatCheck,
          );
          if (!reaction.flatCheck.passed) {
            log.add(
              flatText + "FAILED. Attack missed. Reaction spent.",
              "warn",
            );
            log.add(spentLine, "info");
            continue;
          }
          log.add(flatText + "PASSED. Reactive Strike proceeds.", "info");
        }

        logAttackResolution(reactor, combatant, reaction);
        log.add(spentLine, "info");
      }

      if (lostGreaterCover) {
        log.add(combatant.name + " loses Greater Cover after moving.", "info");
      }

      if (result.movementInterrupted) {
        log.add(combatant.name + " is defeated and stops moving.", "warn");
      }

      if (result.movedDiagonalSteps > 0) {
        log.add(
          combatant.name +
            "'s diagonal steps this turn: " +
            combatant.diagonalStepsThisTurn +
            "; next diagonal costs " +
            (combatant.diagonalParity === 0 ? 5 : 10) +
            " ft.",
          "info",
        );
      }

      battlefield.refresh();
      updateTokenCards();
      renderSelection(combatant, battlefield.getReachableCells());
    },
    onStepRequest: function (combatant, cell) {
      const lostGreaterCover = combatant.hasCondition("greater-cover");
      const result = Step.performStep({
        combatant: combatant,
        map: map,
        destination: cell,
        diagonalCornerPolicy: CORNER_POLICY,
        occupancy: getOccupancy(combatant),
        combatants: COMBATANTS,
      });

      if (!result.ok) {
        log.add("Step canceled — " + describeStepFailure(result.reason) + ".", "warn");
        return;
      }

      log.add(
        combatant.name +
          " uses Step. Moves 5 ft to " +
          Grid.gridToLabel(cell) +
          ". Actions left: " +
          result.actionsLeft,
        "step",
      );
      if (lostGreaterCover) {
        log.add(combatant.name + " loses Greater Cover after moving.", "info");
      }

      logReleasedGrapples(
        combatant.name,
        result.releasedGrapples,
        "the grappler moved",
      );

      battlefield.refresh();
      updateTokenCards();
      renderSelection(combatant, battlefield.getReachableCells());
    },
    onStrikeRequest: function (combatant, target) {
      const result = Strike.performStrike({
        attacker: combatant,
        target: target,
        map: map,
        allies: COMBATANTS,
        rollD20: function () {
          return 1 + Math.floor(Math.random() * 20);
        },
        rollDamageDie: function (sides) {
          return 1 + Math.floor(Math.random() * sides);
        },
      });

      if (!result.ok) {
        log.add("Strike canceled — " + describeStrikeFailure(result.reason, result) + ".", "warn");
        return;
      }

      if (result.flatCheck) {
        const flatText = flatCheckDescription(combatant, target, result.flatCheck);
        if (!result.flatCheck.passed) {
          log.add(
            flatText + "FAILED. Attack missed. Action spent, MAP increased.",
            "warn",
          );
          log.add(
            "MAP now " +
              formatMap(combatant.getMultipleAttackPenalty()) +
              " · Actions left: " +
              result.actionsLeft +
              ".",
            "info",
          );

          battlefield.refresh();
          updateTokenCards();
          renderSelection(combatant, battlefield.getReachableCells());
          return;
        }
        log.add(flatText + "PASSED. Strike proceeds.", "info");
      }

      logAttackResolution(combatant, target, result);
      log.add(
        "MAP now " +
          formatMap(combatant.getMultipleAttackPenalty()) +
          " · Actions left: " +
          result.actionsLeft +
          ".",
        "info",
      );

      battlefield.refresh();
      updateTokenCards();
      renderSelection(combatant, battlefield.getReachableCells());
    },
    onTripRequest: function (combatant, target) {
      useTrip(combatant, target);
    },
    onShoveRequest: function (combatant, target) {
      useShove(combatant, target);
    },
    onGrappleRequest: function (combatant, target) {
      useGrapple(combatant, target);
    },
    onHoverChange: updateHoverStatus,
    onInactiveToken: function (combatant) {
      if (combatant.isDefeated === true) {
        log.add(combatant.name + " is defeated and cannot act.", "warn");
        return;
      }
      const active = encounter.activeCombatant;
      log.add(
        "It is " +
          (active ? active.name : "no one") +
          "'s turn — " +
          combatant.name +
          " cannot act right now.",
        "warn",
      );
    },
  });

  function advanceTurn() {
    const turn = encounter.nextTurn();

    if (!turn.active) {
      log.add("All combatants are defeated — the encounter is over.", "system");
      suppressSelectionLog = true;
      battlefield.setActiveCombatant(null);
      renderInitiative();
      updateTokenCards();
      battlefield.clearSelection();
      suppressSelectionLog = false;
      updateHoverStatus(null);
      return;
    }

    if (turn.persistentTick) {
      logPersistentTick(turn.persistentTick);
    }
    if (turn.conditionTick && turn.conditionTick.changed) {
      const frightened = turn.conditionTick.frightened;
      log.add(
        turn.previous.name +
          "'s Frightened decreases " +
          frightened.from +
          " -> " +
          frightened.to +
          (frightened.removed ? " (removed)." : "."),
        "info",
      );
    }
    if (turn.previous && turn.previous.isDefeated === true) {
      log.add(
        turn.previous.name + " is defeated and is skipped in the initiative order.",
        "info",
      );
    }
    for (const entry of turn.releasedGrapples || []) {
      const labels = entry.removed
        .map(function (condition) {
          return condition.label;
        })
        .join(", ");
      log.add(
        "Grapple ends for " +
          entry.combatantName +
          (labels ? " — " + labels : "") +
          ".",
        "info",
      );
    }
    if (turn.wrapped) {
      log.add("Round " + turn.round + " begins.", "turn");
    }
    log.add(
      "Round " +
        turn.round +
        " — " +
        turn.active.name +
        "'s turn. Actions reset to " +
        turn.active.actionsRemaining +
        ".",
      "turn",
    );

    suppressSelectionLog = true;
    battlefield.setActiveCombatant(turn.active.id);
    renderInitiative();
    updateTokenCards();
    battlefield.selectCombatant(turn.active.id);
    suppressSelectionLog = false;
    updateHoverStatus(null);
  }

  function useRaiseShield() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can Raise a Shield.", "warn");
      return;
    }

    const wasRaised = active.hasCondition("shield-raised");
    const result = RaiseShield.performRaiseShield({ combatant: active });

    if (!result.ok) {
      log.add(
        "Raise a Shield canceled — " + active.name + " has no actions left.",
        "warn",
      );
      return;
    }

    log.add(
      active.name +
        " uses Raise a Shield. Actions left: " +
        result.actionsLeft +
        ".",
      "shield",
    );
    if (wasRaised) {
      log.add(
        active.name +
          " already had Shield Raised — the +2 circumstance bonus does not stack.",
        "info",
      );
    }

    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
  }

  function useTakeCover() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can Take Cover.", "warn");
      return;
    }

    const wasCovered = active.hasCondition("greater-cover");
    const result = TakeCover.performTakeCover({
      combatant: active,
      map: map,
      combatants: COMBATANTS,
    });

    if (!result.ok) {
      if (result.reason === TakeCover.TAKE_COVER_REASONS.NO_ACTIONS) {
        log.add(
          "Take Cover canceled — " + active.name + " has no actions left.",
          "warn",
        );
      } else {
        log.add(
          "Take Cover canceled — " +
            active.name +
            " needs standard cover or better from a hostile attacker.",
          "warn",
        );
      }
      return;
    }

    log.add(
      active.name +
        " uses Take Cover (" +
        result.requiredCover +
        " cover detected). Actions left: " +
        result.actionsLeft +
        ".",
      "shield",
    );
    log.add(
      "+4 circumstance AC (Greater Cover) until the start of " +
        active.name +
        "'s next turn or its next Stride/Step." +
        (wasCovered ? " The bonus does not stack with itself." : ""),
      "info",
    );

    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
  }

  function useTrip(combatant, target) {
    const result = Trip.performTrip({
      attacker: combatant,
      target: target,
      map: map,
      combatants: COMBATANTS,
      allies: COMBATANTS,
      rollD20: function () {
        return 1 + Math.floor(Math.random() * 20);
      },
      rollDamageDie: function (sides) {
        return 1 + Math.floor(Math.random() * sides);
      },
    });

    if (!result.ok) {
      log.add(
        "Trip canceled — " + describeStrikeFailure(result.reason, result) + ".",
        "warn",
      );
      return;
    }

    if (result.flatCheck) {
      const flatText =
        combatant.name +
        " attempts to Trip " +
        target.name +
        " (" +
        visibilityLabel(result.flatCheck.condition) +
        "): Flat Check d20(" +
        result.flatCheck.roll +
        ") vs DC " +
        result.flatCheck.dc +
        " -> ";
      if (!result.flatCheck.passed) {
        log.add(flatText + "FAILED. Trip missed. Action spent, MAP increased.", "warn");
        log.add(
          "MAP now " +
            formatMap(combatant.getMultipleAttackPenalty(false)) +
            " · Actions left: " +
            result.actionsLeft +
            ".",
          "info",
        );
        battlefield.refresh();
        updateTokenCards();
        renderSelection(combatant, battlefield.getReachableCells());
        return;
      }
      log.add(flatText + "PASSED. Trip proceeds.", "info");
    }

    logTripResolution(combatant, target, result);
    log.add(
      "MAP now " +
        formatMap(combatant.getMultipleAttackPenalty(false)) +
        " · Actions left: " +
        result.actionsLeft +
        ".",
      "info",
    );

    battlefield.refresh();
    updateTokenCards();
    renderSelection(combatant, battlefield.getReachableCells());
  }

  function useShove(combatant, target) {
    const result = Shove.performShove({
      attacker: combatant,
      target: target,
      map: map,
      combatants: COMBATANTS,
      allies: COMBATANTS,
      rollD20: function () {
        return 1 + Math.floor(Math.random() * 20);
      },
    });

    if (!result.ok) {
      log.add(
        "Shove canceled — " + describeStrikeFailure(result.reason, result) + ".",
        "warn",
      );
      return;
    }

    if (result.flatCheck) {
      const flatText =
        combatant.name +
        " attempts to Shove " +
        target.name +
        " (" +
        visibilityLabel(result.flatCheck.condition) +
        "): Flat Check d20(" +
        result.flatCheck.roll +
        ") vs DC " +
        result.flatCheck.dc +
        " -> ";
      if (!result.flatCheck.passed) {
        log.add(flatText + "FAILED. Shove missed. Action spent, MAP increased.", "warn");
        log.add(
          "MAP now " +
            formatMap(combatant.getMultipleAttackPenalty(false)) +
            " · Actions left: " +
            result.actionsLeft +
            ".",
          "info",
        );
        battlefield.refresh();
        updateTokenCards();
        renderSelection(combatant, battlefield.getReachableCells());
        return;
      }
      log.add(flatText + "PASSED. Shove proceeds.", "info");
    }

    logShoveResolution(combatant, target, result);
    log.add(
      "MAP now " +
        formatMap(combatant.getMultipleAttackPenalty(false)) +
        " · Actions left: " +
        result.actionsLeft +
        ".",
      "info",
    );

    battlefield.refresh();
    updateTokenCards();
    renderSelection(combatant, battlefield.getReachableCells());
  }

  function useGrapple(combatant, target) {
    const result = Grapple.performGrapple({
      attacker: combatant,
      target: target,
      map: map,
      combatants: COMBATANTS,
      allies: COMBATANTS,
      rollD20: function () {
        return 1 + Math.floor(Math.random() * 20);
      },
    });

    if (!result.ok) {
      log.add(
        "Grapple canceled — " + describeStrikeFailure(result.reason, result) + ".",
        "warn",
      );
      return;
    }

    if (result.flatCheck) {
      const flatText =
        combatant.name +
        " attempts to Grapple " +
        target.name +
        " (" +
        visibilityLabel(result.flatCheck.condition) +
        "): Flat Check d20(" +
        result.flatCheck.roll +
        ") vs DC " +
        result.flatCheck.dc +
        " -> ";
      if (!result.flatCheck.passed) {
        log.add(
          flatText + "FAILED. Grapple missed. Action spent, MAP increased.",
          "warn",
        );
        log.add(
          "MAP now " +
            formatMap(combatant.getMultipleAttackPenalty(false)) +
            " · Actions left: " +
            result.actionsLeft +
            ".",
          "info",
        );
        battlefield.refresh();
        updateTokenCards();
        renderSelection(combatant, battlefield.getReachableCells());
        return;
      }
      log.add(flatText + "PASSED. Grapple proceeds.", "info");
    }

    logGrappleResolution(combatant, target, result);
    log.add(
      "MAP now " +
        formatMap(combatant.getMultipleAttackPenalty(false)) +
        " · Actions left: " +
        result.actionsLeft +
        ".",
      "info",
    );

    battlefield.refresh();
    updateTokenCards();
    renderSelection(combatant, battlefield.getReachableCells());
  }

  function useEscape() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can Escape.", "warn");
      return;
    }

    const result = Escape.performEscape({
      actor: active,
      combatants: COMBATANTS,
      rollD20: function () {
        return 1 + Math.floor(Math.random() * 20);
      },
    });

    if (!result.ok) {
      if (result.reason === Escape.ESCAPE_REASONS.NOT_GRABBED) {
        log.add("Escape canceled — " + active.name + " is not Grabbed or Restrained.", "warn");
      } else if (result.reason === Escape.ESCAPE_REASONS.NO_ACTIONS) {
        log.add("Escape canceled — " + active.name + " has no actions left.", "warn");
      } else if (result.reason === Escape.ESCAPE_REASONS.SOURCE_DEFEATED) {
        log.add(
          "The grappler is defeated — " + active.name + " is no longer Grabbed.",
          "info",
        );
        battlefield.refresh();
        updateTokenCards();
        renderSelection(active, battlefield.getReachableCells());
      } else {
        log.add("Escape canceled — " + active.name + " cannot Escape right now.", "warn");
      }
      return;
    }

    if (result.flatCheck) {
      const flatText =
        active.name +
        " attempts to Escape " +
        result.sourceName +
        " (" +
        visibilityLabel(result.flatCheck.condition) +
        "): Flat Check d20(" +
        result.flatCheck.roll +
        ") vs DC " +
        result.flatCheck.dc +
        " -> ";
      if (!result.flatCheck.passed) {
        log.add(flatText + "FAILED. Escape missed. Action spent, MAP increased.", "warn");
        log.add(
          "MAP now " +
            formatMap(active.getMultipleAttackPenalty(false)) +
            " · Actions left: " +
            result.actionsLeft +
            ".",
          "info",
        );
        battlefield.refresh();
        updateTokenCards();
        renderSelection(active, battlefield.getReachableCells());
        return;
      }
      log.add(flatText + "PASSED. Escape proceeds.", "info");
    }

    logEscapeResolution(active, result);
    log.add(
      "MAP now " +
        formatMap(active.getMultipleAttackPenalty(false)) +
        " · Actions left: " +
        result.actionsLeft +
        ".",
      "info",
    );

    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
  }

  function useStand() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can Stand.", "warn");
      return;
    }

    const result = Stand.performStand({
      combatant: active,
      map: map,
      combatants: COMBATANTS,
      rollD20: function () {
        return 1 + Math.floor(Math.random() * 20);
      },
      rollDamageDie: function (sides) {
        return 1 + Math.floor(Math.random() * sides);
      },
    });

    if (!result.ok) {
      if (result.reason === Stand.STAND_REASONS.NOT_PRONE) {
        log.add("Stand canceled — " + active.name + " is not Prone.", "warn");
      } else if (result.reason === Stand.STAND_REASONS.NO_ACTIONS) {
        log.add(
          "Stand canceled — " + active.name + " has no actions left.",
          "warn",
        );
      } else if (result.reason === Stand.STAND_REASONS.IMMOBILIZED) {
        log.add(
          "Stand canceled — " +
            active.name +
            " is Immobilized by Grabbed/Restrained. Use Escape first.",
          "warn",
        );
      } else {
        log.add("Stand canceled — " + active.name + " cannot Stand.", "warn");
      }
      return;
    }

    log.add(
      active.name +
        " uses Stand. Actions left: " +
        result.actionsLeft +
        ".",
      "step",
    );

    for (const reaction of result.reactions) {
      const reactor =
        findCombatant(reaction.attackerId) || {
          id: reaction.attackerId,
          name: reaction.attackerName,
          maxReactions: 1,
        };
      log.add(
        "[REACTION] " +
          reaction.attackerName +
          " uses Reactive Strike against standing " +
          active.name +
          "!",
        "reaction",
      );

      const spentLine =
        reaction.attackerName +
        " reaction spent · Reactions left: " +
        reaction.reactionsLeft +
        "/" +
        reactor.maxReactions +
        ".";

      if (reaction.flatCheck) {
        const flatText = flatCheckDescription(reactor, active, reaction.flatCheck);
        if (!reaction.flatCheck.passed) {
          log.add(
            flatText + "FAILED. Attack missed. Reaction spent.",
            "warn",
          );
          log.add(spentLine, "info");
          continue;
        }
        log.add(flatText + "PASSED. Reactive Strike proceeds.", "info");
      }

      logAttackResolution(reactor, active, reaction);
      log.add(spentLine, "info");
    }

    if (result.proneRemoved) {
      log.add(active.name + " is no longer Prone.", "info");
    }
    if (result.defeated) {
      log.add(
        active.name + " is defeated while standing and remains Prone.",
        "warn",
      );
    }

    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
  }

  if (endTurnEl) {
    endTurnEl.addEventListener("click", advanceTurn);
  }

  if (raiseShieldButton) {
    raiseShieldButton.addEventListener("click", useRaiseShield);
  }

  if (takeCoverButton) {
    takeCoverButton.addEventListener("click", useTakeCover);
  }

  if (standButton) {
    standButton.addEventListener("click", useStand);
  }

  if (escapeButton) {
    escapeButton.addEventListener("click", useEscape);
  }

  for (const button of modeButtons) {
    button.addEventListener("click", function () {
      const mode = button.dataset.mode;
      battlefield.setMode(mode);
      updateModeUi();
      updateHoverStatus(null);
      log.add(
        "Action mode: " +
          mode.charAt(0).toUpperCase() +
          mode.slice(1) +
          ".",
        "muted",
      );
    });
  }

  for (const combatant of COMBATANTS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "token-card";
    card.setAttribute("aria-pressed", "false");
    card.dataset.combatantId = combatant.id;

    const dot = document.createElement("span");
    dot.className = "token-dot";
    dot.style.background =
      "radial-gradient(circle at 32% 30%, rgba(255,255,255,0.65), " +
      colorOf(combatant) +
      " 62%)";

    const meta = document.createElement("span");
    meta.className = "token-meta";

    const name = document.createElement("span");
    name.className = "token-name";
    name.textContent = combatant.name;

    const conditionBadges = document.createElement("span");
    conditionBadges.className = "token-conditions condition-badges is-empty";

    const sub = document.createElement("span");
    sub.className = "token-sub";

    const hp = document.createElement("span");
    hp.className = "token-hp";

    const hpBar = document.createElement("span");
    hpBar.className = "token-hp-bar";
    const hpFill = document.createElement("span");
    hpFill.className = "token-hp-fill";
    hpBar.append(hpFill);

    const hpText = document.createElement("span");
    hpText.className = "token-hp-text";

    hp.append(hpBar, hpText);

    const pools = document.createElement("span");
    pools.className = "token-pools";
    const actionPips = buildPips(combatant, "action", "action-pips token-action-pips");
    const reactionPips = buildPips(
      combatant,
      "reaction",
      "reaction-pips token-reaction-pips",
    );
    pools.append(actionPips.container, reactionPips.container);

    meta.append(name, conditionBadges, sub, hp);
    card.append(dot, meta, pools);
    card.addEventListener("click", function () {
      battlefield.selectCombatant(combatant.id);
    });

    tokenListEl.append(card);
    tokenCards.set(combatant.id, {
      card: card,
      sub: sub,
      conditionBadges: conditionBadges,
      pips: actionPips.pips,
      reactionPips: reactionPips.pips,
      hpFill: hpFill,
      hpText: hpText,
    });
  }

  const firstActive = encounter.startEncounter();
  if (firstActive) {
    battlefield.setActiveCombatant(firstActive.id);
  }
  updateModeUi();
  renderSelection(null, []);
  updateTokenCards();
  updateHoverStatus(null);

  log.add(
    "Battlefield initialized — " +
      COLS +
      " × " +
      ROWS +
      " squares, " +
      map.getBlockedCells().length +
      " blocked cells, " +
      map.getDifficultTerrainCells().length +
      " difficult-terrain squares.",
    "system",
  );
  log.add(
    "Initiative: " +
      encounter
        .getOrder()
        .map(function (combatant) {
          return combatant.name + " " + combatant.initiative;
        })
        .join(" → ") +
      ". Members of the same alliance may be crossed but not occupied; enemies block movement.",
    "system",
  );
  if (firstActive) {
    log.add(
      "Round 1 — " +
        firstActive.name +
        "'s turn. Stride, Step, and Strike each cost 1 action; Step cannot enter difficult terrain.",
      "turn",
    );
    log.add(
      "Strike resolves d20 + attack bonus - MAP vs AC through the modifier pipeline. Flanking applies Off-Guard (-2 circumstance AC). A critical hit doubles damage; at 0 HP the target is defeated and skipped.",
      "system",
    );
    log.add(
      "Each combatant has 1 reaction per turn. Striding out of a square threatened by an enemy with a reaction automatically provokes a Reactive Strike; it costs no action and ignores MAP. Step never provokes.",
      "system",
    );
    log.add(
      "Cover is measured from the attacker's best corner: 1-2 blocked rays = Standard Cover (+2 AC), 3 = Greater Cover (+4 AC), 4 = no line of sight. A creature on the line gives Lesser Cover (+1 AC). Cover is a circumstance bonus and never stacks with Shield Raised.",
      "system",
    );
    log.add(
      "Take Cover costs 1 action behind standard cover or better and grants +4 circumstance AC until the start of your next turn or your next Stride/Step.",
      "system",
    );
    log.add(
      "Shove and Grapple are 1-action attack-trait Athletics checks against Fortitude DC (10 + Fortitude + modifiers). Shove pushes 5 ft (critical 10 ft) and stops at walls, creatures, or the map edge; a critical failure makes the shover Prone.",
      "system",
    );
    log.add(
      "Grapple applies Grabbed (critical: Restrained) plus Off-Guard and Immobilized until the end of the grappler's next turn. The hold also ends if the grappler Strides, Steps, or is defeated.",
      "system",
    );
    log.add(
      "Escape costs 1 action and has the attack trait. A Grabbed/Restrained creature rolls its best of Unarmed Attack, Athletics, or Acrobatics (MAP applies) against the grappler's Athletics DC; success or critical success breaks free.",
      "system",
    );
    log.add(
      "Damage is typed. After the critical multiplier, the target applies Immunity -> Weakness -> Resistance: immunity zeroes the damage, weakness adds its value once per attack, and resistance subtracts (floored at 0).",
      "system",
    );
    log.add(
      "Demo IWR — Goblin is immune to fire, has Weakness 2 to slashing (Valeros), and Resistance 2 to piercing (Merisiel).",
      "system",
    );
    log.add(
      "Weapon traits — Valeros has reach (10 ft), backstabber (+1 vs Off-Guard, doubled on a crit), and deadly d8 (+1d8 on a critical hit, not doubled).",
      "system",
    );
    if (demoGoblin && demoGoblin.hasPersistentDamage()) {
      log.add(
        "Goblin has Persistent Fire 1d6 and Persistent Bleed 1d4. At the end of its turn each type rolls damage through IWR, then a separate flat check DC 15 removes it on a success.",
        "system",
      );
    }
    if (demoGoblin && demoGoblin.hasCondition("frightened")) {
      log.add(
        "Goblin begins Frightened 1: -1 status to its checks and AC until the end of its turn.",
        "system",
      );
    }
    if (demoGoblin && demoGoblin.hasCondition("concealed")) {
      log.add(
        "Goblin begins Concealed in smoke: attacks against it require a DC 5 flat check, but its own AC is unchanged.",
        "system",
      );
    }
    if (demoMerisiel && demoMerisiel.hasCondition("hidden")) {
      log.add(
        "Merisiel begins Hidden: attacks against her require a DC 11 flat check, and her own attacks leave the target Off-Guard (-2 circumstance AC).",
        "system",
      );
    }
    log.add(
      "Undetected creatures cannot be selected as direct Strike targets; the action is not spent.",
      "system",
    );
    battlefield.selectCombatant(firstActive.id);
  } else {
    log.add("No living combatants remain — the encounter is over.", "system");
  }
})();
