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
  const AoE = window.PF2e.Core.Grid.AoE;
  const Illumination = window.PF2e.Core.Grid.Illumination;
  const Hazard = window.PF2e.Core.Hazard;
  const Equipment = window.PF2e.Core.Equipment;
  const Shield = window.PF2e.Core.Shield;
  const Afflictions = window.PF2e.Core.Rules.Afflictions;
  const Spells = window.PF2e.Core.Rules.Spells;
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
  const CastSpell = window.PF2e.Core.Actions.CastSpell;
  const SustainSpell = window.PF2e.Core.Actions.SustainSpell;
  const Interact = window.PF2e.Core.Actions.Interact;
  const ShieldBlock = window.PF2e.Core.Actions.ShieldBlock;
  const Stealth = window.PF2e.Core.Actions.Stealth;
  const DisableHazard = window.PF2e.Core.Actions.DisableHazard;
  const TacticalAI = window.PF2e.Core.AI.TacticalAI;
  const CombatEventBus = window.PF2e.Core.State.CombatEventBus;
  const Serializer = window.PF2e.Core.State.Serializer;
  const Initiative = window.PF2e.Core.Initiative;
  const Conditions = window.PF2e.Core.Conditions;
  const Checks = window.PF2e.Core.Rules.Checks;
  const MultipleAttack = window.PF2e.Core.Rules.MultipleAttack;
  const Damage = window.PF2e.Core.Rules.Damage;
  const WeaponTraits = window.PF2e.Core.Rules.WeaponTraits;
  const View = window.PF2e.View;
  const MODES = View.ACTION_MODES;
  const PAINT_TOOLS = View.PAINT_TOOLS;

  const COLS = 15;
  const ROWS = 15;
  const CELL_SIZE = 48;
  const CORNER_POLICY = Pathfinding.DIAGONAL_CORNER_POLICIES.BLOCK_ANY;

  // Phase 21: the token HUD is created after the BattlefieldView so it can
  // read the live token views. The variable is declared early because the
  // shared UI refresh helpers may run before the HUD is constructed.
  let tokenHud = null;
  // Phase 22: Foundry-style right sidebar and the floating character sheet.
  // Both are created after the BattlefieldView; the declarations live here so
  // shared refresh helpers can guard on them.
  let sidebar = null;
  let characterSheet = null;
  // Phase 23: generated compendium catalogs inside the Library tab.
  let compendiumBrowser = null;
  // Phase 24: scene presets, terrain brushes, and the clear-board dialog.
  let sceneEditor = null;
  // Phase 26-28: macro hotbar, tactical ruler, and measured templates.
  let hotbar = null;
  let ruler = null;
  let templateTool = null;

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

  // The authored default encounter is built by a factory so the Phase 24
  // "Default Encounter" preset can restore exactly the same battlefield after
  // the user clears it or switches to Empty Arena.
  function createDefaultMap() {
    const nextMap = GridMap.fromAscii(MAP_ROWS, "#", { difficultChars: "~" });

    // Demo battlefield decoration: greater-difficult rubble, hazardous fire
    // vents, and two light pockets.
    nextMap.setTerrain(5, 9, "greater-difficult");
    nextMap.setTerrain(6, 9, "greater-difficult");
    nextMap.setTerrain(5, 10, "greater-difficult");
    nextMap.setHazardous(9, 9, { damage: "1d6", type: "fire" });
    nextMap.setHazardous(10, 9, { damage: "1d6", type: "fire" });
    for (let y = 0; y <= 2; y += 1) {
      for (let x = 0; x <= 2; x += 1) {
        nextMap.setIllumination(x, y, "dim");
      }
    }
    for (let y = 12; y <= 14; y += 1) {
      for (let x = 0; x <= 2; x += 1) {
        nextMap.setIllumination(x, y, "darkness");
      }
    }
    return nextMap;
  }

  let map = createDefaultMap();

  const COLORS = {
    valeros: "#c8553d",
    merisiel: "#2e9e8f",
    goblin: "#d1495b",
    ogre: "#b07a4a",
    giant: "#7d6aa8",
  };

  function createDefaultCombatants() {
    const roster = [
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
      // Phase 22 demo equipment: a drawn longsword, a stowed steel shield,
      // and a potion. The shield stays stowed so the existing Trip/Shove/
      // Grapple free-hand demos keep working until it is drawn from the sheet.
      inventory: [
        {
          id: "longsword",
          name: "Longsword",
          type: "weapon",
          damage: "1d8",
          damageType: "slashing",
          traits: ["versatile-p"],
          hands: 1,
        },
        {
          id: "steel-shield",
          name: "Steel Shield",
          type: "shield",
          hardness: 5,
          hp: 20,
          maxHP: 20,
          acBonus: 2,
          hands: 1,
        },
        {
          id: "healing-potion",
          name: "Healing Potion",
          type: "gear",
          hands: 1,
        },
      ],
      hands: { mainHand: "longsword" },
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
      // Phase 22 demo equipment: a drawn dagger and stowed thieves' tools so
      // the Inventory tab can demonstrate Draw/Stow/Drop alongside the spell
      // slot and Focus Point pools below.
      inventory: [
        {
          id: "dagger",
          name: "Dagger",
          type: "weapon",
          damage: "1d6",
          damageType: "piercing",
          traits: ["agile", "finesse"],
          hands: 1,
        },
        {
          id: "thieves-tools",
          name: "Thieves' Tools",
          type: "gear",
          hands: 1,
        },
      ],
      hands: { mainHand: "dagger" },
      // Phase 20 demo spellbook: attack cantrips plus burst/cone/line/
      // emanation save spells and one sustained spell.
      spellAttackBonus: 9,
      spellDC: 19,
      spellSlots: { 1: { max: 2, current: 2 }, 2: { max: 2, current: 2 } },
      focusPoints: { max: 1, current: 1 },
      spells: [
        {
          id: "ray-of-frost",
          name: "Ray of Frost",
          cost: 2,
          type: "attack",
          traits: ["attack", "cantrip", "cold"],
          damage: { formula: "1d8", type: "cold" },
        },
        {
          id: "ignition",
          name: "Ignition",
          cost: 2,
          type: "attack",
          traits: ["attack", "cantrip", "fire"],
          damage: { formula: "1d4", type: "fire" },
        },
        {
          id: "fireball",
          name: "Fireball",
          cost: 2,
          type: "save",
          traits: ["fire", "manipulate"],
          rank: 2,
          saveType: "reflex",
          basic: true,
          area: { type: "burst", radiusFeet: 20 },
          damage: { formula: "2d6", type: "fire" },
        },
        {
          id: "burning-hands",
          name: "Burning Hands",
          cost: 2,
          type: "save",
          traits: ["fire", "manipulate"],
          rank: 1,
          saveType: "reflex",
          basic: true,
          area: { type: "cone", lengthFeet: 15 },
          damage: { formula: "2d6", type: "fire" },
        },
        {
          id: "lightning-bolt",
          name: "Lightning Bolt",
          cost: 2,
          type: "save",
          traits: ["electricity", "manipulate"],
          rank: 2,
          saveType: "reflex",
          basic: true,
          area: { type: "line", lengthFeet: 30, widthFeet: 5 },
          damage: { formula: "2d6", type: "electricity" },
        },
        {
          id: "bless",
          name: "Bless",
          cost: 2,
          type: "save",
          traits: ["mental", "manipulate"],
          rank: 1,
          saveType: "will",
          basic: true,
          area: { type: "emanation", radiusFeet: 10 },
        },
        {
          id: "flaming-sphere",
          name: "Flaming Sphere",
          cost: 2,
          type: "save",
          traits: ["fire", "manipulate", "sustained"],
          rank: 2,
          saveType: "reflex",
          basic: true,
          area: { type: "burst", radiusFeet: 5 },
          damage: { formula: "1d6", type: "fire" },
        },
      ],
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
      // Flying a few feet up demonstrates the elevation badge and 3D reach.
      elevation: 5,
    }),
    new Combatant({
      id: "ogre",
      name: "Ogre",
      alliance: "enemy",
      initiative: 10,
      x: 12,
      y: 10,
      size: "large",
      speedFeet: 25,
      maxActions: 3,
      maxHP: 34,
      ac: 16,
      attackBonus: 8,
      damage: { formula: "1d10+4", type: "bludgeoning" },
      saves: { fortitude: 8, reflex: 4, will: 3 },
      skills: { athletics: 9, acrobatics: 4, stealth: 3, perception: 6 },
      traits: ["reach"],
      agile: false,
    }),
    new Combatant({
      id: "giant",
      name: "Hill Giant",
      alliance: "enemy",
      initiative: 8,
      x: 12,
      y: 12,
      size: "huge",
      speedFeet: 30,
      maxActions: 3,
      maxHP: 50,
      ac: 18,
      attackBonus: 10,
      damage: { formula: "2d6+5", type: "bludgeoning" },
      saves: { fortitude: 10, reflex: 5, will: 5 },
      skills: { athletics: 11, acrobatics: 4, stealth: 2, perception: 7 },
      traits: ["reach"],
      agile: false,
    }),
    ];

    // Authored demo conditions: the goblin starts shaken and half-hidden by
    // smoke, and Merisiel starts in the shadows. This makes the condition
    // badges, flat checks, Hidden-attacker Off-Guard, and token opacity visible
    // immediately without adding Seek/Hide actions in this slice.
    const demoGoblin = roster.find(function (combatant) {
      return combatant.id === "goblin";
    });
    if (demoGoblin) {
      demoGoblin.addCondition("frightened", 1);
      demoGoblin.addCondition("concealed");
    }
    const demoMerisiel = roster.find(function (combatant) {
      return combatant.id === "merisiel";
    });
    if (demoMerisiel) {
      demoMerisiel.addCondition("hidden");
    }
    return roster;
  }

  let COMBATANTS = createDefaultCombatants();

  // One event bus feeds the combat log, the round badge, and the active-row
  // highlight. The Encounter propagates it to every combatant and hazard.
  const EVENT_BUS = new CombatEventBus({ recordHistory: true });

  function createDefaultHazards(bus) {
    const hazards = [
      new Hazard({
        id: "spike-trap",
        name: "Spike Trap",
        stealthDC: 18,
        disableDC: 16,
        disableSkill: "thievery",
        maxHP: 12,
        hardness: 4,
        triggerArea: [{ x: 6, y: 3 }, { x: 6, y: 4 }],
        reaction: {
          trigger: "enter",
          formula: "2d6",
          type: "piercing",
          saveType: "reflex",
          saveDC: 17,
        },
      }),
    ];
    for (const hazard of hazards) {
      if (typeof hazard.setEventBus === "function") {
        hazard.setEventBus(bus);
      }
    }
    return hazards;
  }

  let HAZARDS = createDefaultHazards(EVENT_BUS);

  let encounter = new Encounter({
    combatants: COMBATANTS,
    eventBus: EVENT_BUS,
  });

  /**
   * Phase 24: the headless Encounter intentionally requires at least one
   * combatant. Empty Arena therefore uses a tiny view-side adapter that keeps
   * the same read/write surface the UI already consumes, while owning no
   * initiative or rules state.
   */
  class NullEncounter {
    constructor() {
      this.combatants = [];
      this.round = 1;
      this.started = false;
      this.over = true;
      this.activeCombatantIndex = -1;
      this.eventBus = null;
    }

    get activeCombatant() {
      return null;
    }

    get isStarted() {
      return this.started;
    }

    get isOver() {
      return true;
    }

    get livingCombatants() {
      return [];
    }

    isActive() {
      return false;
    }

    getOrder() {
      return [];
    }

    indexOf() {
      return -1;
    }

    _syncRound() {
      return this;
    }

    _findLivingFrom() {
      return -1;
    }

    setEventBus(bus) {
      this.eventBus = bus || null;
      return this;
    }

    startEncounter() {
      this.started = true;
      this.round = Math.max(1, this.round || 1);
      return null;
    }

    rollInitiative() {
      this.started = true;
      this.round = Math.max(1, this.round || 1);
      return {
        active: null,
        round: this.round,
        order: [],
        entries: [],
        rolls: {},
      };
    }

    nextTurn() {
      return {
        active: null,
        previous: null,
        round: this.round,
        wrapped: false,
        index: -1,
        conditionTick: null,
        persistentTick: null,
        durationExpiry: [],
        afflictionTick: null,
        releasedGrapples: [],
        expiredSustainedSpells: [],
      };
    }
  }

  const canvas = document.getElementById("battlefield");
  const tokenListEl = document.getElementById("token-list");
  const selectionEl = document.getElementById("selection-panel");
  const statusEl = document.getElementById("board-status");
  const initiativeEl = document.getElementById("initiative-tracker");
  const roundIndicatorEl = document.getElementById("round-indicator");
  const endTurnEl = document.getElementById("end-turn");
  const rollInitiativeEl = document.getElementById("roll-initiative");
  const modeHintEl = document.getElementById("mode-hint");
  const spellSelectEl = document.getElementById("spell-select");
  const castSpellButton = document.getElementById("cast-spell");
  const sustainButton = document.getElementById("sustain-spell");
  const seekButton = document.getElementById("seek");
  const hideButton = document.getElementById("hide");
  const sneakButton = document.getElementById("sneak");
  const aiStepButton = document.getElementById("ai-step");
  const aiTurnButton = document.getElementById("ai-turn");
  const saveCombatButton = document.getElementById("save-combat");
  const loadCombatButton = document.getElementById("load-combat");
  const disableHazardButton = document.getElementById("disable-hazard");
  const hazardStatusEl = document.getElementById("hazard-status");
  const modeButtons = Array.from(
    document.querySelectorAll(".mode-button[data-mode]"),
  );
  const raiseShieldButton = document.getElementById("raise-shield");
  const takeCoverButton = document.getElementById("take-cover");
  const standButton = document.getElementById("stand");
  const escapeButton = document.getElementById("escape");
  const log = new View.CombatLog(document.getElementById("combat-log"));
  const eventLog = new View.EventLogBridge({
    bus: EVENT_BUS,
    log: log,
    getCombatant: function (id) {
      return COMBATANTS.find(function (candidate) {
        return candidate.id === id;
      }) || null;
    },
    roundIndicator: roundIndicatorEl,
    initiativeContainer: initiativeEl,
  });

  function flushEventLog() {
    eventLog.flush();
  }

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

  function rollD20() {
    return 1 + Math.floor(Math.random() * 20);
  }

  function rollDamageDie(sides) {
    return 1 + Math.floor(Math.random() * sides);
  }

  function rollDie(sides) {
    return 1 + Math.floor(Math.random() * sides);
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
      // The damage line itself is emitted by the event bus with the IWR audit.
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
        line +=
          " " +
          target.name +
          " is now Prone; the critical damage result follows from the combat event bus.";
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
      // The bus-backed damage line carries the IWR/Shield Block audit.
      line += " The damage result follows from the combat event bus.";
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
      const distance = Grid.getCombatantDistance(combatant, candidate);
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
    if (COMBATANTS.length === 0) {
      return "The battlefield is empty — choose a preset, paint terrain, or spawn a monster from the Compendium.";
    }
    if (!active) {
      return encounter.isStarted
        ? "All combatants are defeated - the encounter is over."
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
    if (mode === MODES.CAST) {
      return (
        active.name +
        "'s turn — pick a spell, then hover to preview its burst/cone/line/emanation template and click to cast."
      );
    }
    if (mode === MODES.SNEAK) {
      return (
        active.name +
        "'s turn — click a destination within half Speed (15 ft) to Sneak while Hidden."
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
                : mode === MODES.CAST
                  ? "Spell template"
                  : mode === MODES.SNEAK
                    ? "Sneak targets"
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
              : mode === MODES.CAST
                ? (battlefield.getSpell() ? battlefield.getSpell().name : "No spell selected")
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
      } else if (mode === MODES.CAST) {
        modeHintEl.textContent =
          "Cast a Spell spends the spell's action cost. Burst/cone/line/emanation templates highlight every affected cell and outline caught tokens in red. Attack spells target a token; save spells use the clicked cell as the area origin.";
      } else if (mode === MODES.SNEAK) {
        modeHintEl.textContent =
          "Sneak costs 1 action and must stay Hidden/Undetected. The destination may cost at most half Speed (15 ft at Speed 30); success keeps Hidden only while the destination still offers cover or concealment.";
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
    updateSpellUi();
    if (castSpellButton) {
      castSpellButton.classList.toggle("is-active", mode === MODES.CAST);
    }
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
    updateSpellUi();
    updateHazardUi();
    if (tokenHud) {
      tokenHud.refresh();
    }
    if (characterSheet) {
      characterSheet.refresh();
    }
    refreshHotbar();
    refreshTemplateTool();
  }

  function updateHoverStatus(info) {
    statusEl.className = "board-hint board-status";
    delete statusEl.dataset.state;

    if (!info || info.status === "no-selection") {
      statusEl.textContent = defaultStatus();
      return;
    }

    if (info.status === "origin") {
      statusEl.textContent = info.label + " - selected token's square.";
      return;
    }

    if (info.status === "paint") {
      const labels = {
        wall: "Wall",
        difficult: "Difficult Terrain (+5 ft)",
        "greater-difficult": "Greater Difficult Terrain (+10 ft)",
        hazardous: "Hazardous Fire (1d6 fire)",
        illumination: "Illumination (bright → dim → darkness)",
      };
      statusEl.textContent =
        "Brush: " +
        (labels[info.tool] || info.tool) +
        " — click " +
        info.label +
        " to apply.";
      statusEl.classList.add("is-valid");
      statusEl.dataset.state = "paint";
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

    if (info.status === "cast") {
      if (!info.spell) {
        statusEl.textContent = "Select a spell first.";
        return;
      }
      if (info.valid) {
        const isAttack = info.spell.type === "attack";
        statusEl.textContent =
          info.combatant.name +
          " casts " +
          info.spell.name +
          (isAttack
            ? " at " + (info.target ? info.target.name : "target")
            : " · " +
              info.areaType +
              " · " +
              info.cells.length +
              " cells affected") +
          " · " +
          info.spell.cost +
          " action" +
          (info.spell.cost === 1 ? "" : "s");
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "cast";
      } else {
        statusEl.textContent = info.spell.type === "attack"
          ? "Select a hostile token to cast " + info.spell.name + "."
          : "Move the cursor over a valid origin to place " + info.spell.name + ".";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = "cast-invalid";
      }
      return;
    }

    if (info.status === "sneak") {
      statusEl.textContent = info.valid
        ? info.combatant.name +
          ": Sneak " +
          info.label +
          " · " +
          info.costFeet +
          " / " +
          info.maxCostFeet +
          " ft · 1 action"
        : "Sneak to " +
          info.label +
          " is invalid — the route exceeds half Speed or is blocked.";
      statusEl.classList.add(info.valid ? "is-valid" : "is-invalid");
      statusEl.dataset.state = info.valid ? "sneak" : "sneak-invalid";
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

  /**
   * Phase 24: one click of the active terrain brush. The map object is the
   * same instance the pathfinder, cover rays, and hazards already read, so a
   * painted square is immediately authoritative for rules queries.
   */
  function paintTerrainCell(cell, tool) {
    if (!cell || !map.isInBounds(cell.x, cell.y)) {
      return;
    }
    const label = Grid.gridToLabel(cell);
    let message = null;

    if (tool === PAINT_TOOLS.WALL) {
      const blocked = !map.hasObstacle(cell.x, cell.y);
      map.setBlocked(cell.x, cell.y, blocked);
      message = (blocked ? "Wall placed" : "Wall removed") + " at " + label + ".";
    } else if (tool === PAINT_TOOLS.DIFFICULT) {
      const normal = map.getTerrain(cell.x, cell.y) === "difficult";
      map.setTerrain(cell.x, cell.y, normal ? "normal" : "difficult");
      message =
        (normal ? "Difficult terrain removed" : "Difficult terrain placed") +
        " at " +
        label +
        (normal ? "." : " (+5 ft).");
    } else if (tool === PAINT_TOOLS.GREATER_DIFFICULT) {
      const normal =
        map.getTerrain(cell.x, cell.y) === "greater-difficult";
      map.setTerrain(cell.x, cell.y, normal ? "normal" : "greater-difficult");
      message =
        (normal
          ? "Greater difficult terrain removed"
          : "Greater difficult terrain placed") +
        " at " +
        label +
        (normal ? "." : " (+10 ft).");
    } else if (tool === PAINT_TOOLS.HAZARDOUS) {
      const burning = !map.hasHazardous(cell.x, cell.y);
      map.setHazardous(
        cell.x,
        cell.y,
        burning ? { damage: "1d6", type: "fire" } : null,
      );
      message =
        (burning ? "Hazardous fire placed" : "Hazardous fire removed") +
        " at " +
        label +
        (burning ? " (1d6 fire)." : ".");
    } else if (tool === PAINT_TOOLS.ILLUMINATION) {
      const levels = GridMap.ILLUMINATION_VALUES;
      const current = map.getIllumination(cell.x, cell.y);
      const index = Math.max(0, levels.indexOf(current));
      const next = levels[(index + 1) % levels.length];
      map.setIllumination(cell.x, cell.y, next);
      message = "Illumination at " + label + " set to " + next + ".";
    }

    if (message) {
      log.add("[EDIT] " + message, "system");
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
    onDropCompendium: function (metadata, cell, token) {
      handleBattlefieldDrop(metadata, cell, token);
    },
    onSelectionChange: function (combatant, cells) {
      // A real battlefield selection supersedes the read-only Actors highlight.
      clearTokenHighlight();
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
                : mode === MODES.CAST
                  ? (battlefield.getSpell() ? battlefield.getSpell().name + " ready" : "no spell selected")
                  : mode === MODES.SNEAK
                    ? cells.length + " sneak destinations"
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
        hazards: HAZARDS,
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

      // The bus-backed [MOVE] line carries distance, squares, and actions.
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
        // [REACTION] is emitted by the bus with the trigger and reaction pool.
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
        flushEventLog();
        log.add(spentLine, "info");
      }

      if (lostGreaterCover) {
        log.add(combatant.name + " loses Greater Cover after moving.", "info");
      }

      if (result.movementInterrupted) {
        log.add(
          combatant.name +
            (combatant.isDefeated === true
              ? " is defeated and stops moving."
              : " stops moving after the hazard reaction."),
          "warn",
        );
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

      flushEventLog();
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

      // The bus-backed [MOVE] line reports the 5-ft Step and action spend.
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
      flushEventLog();
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
    onCastRequest: function (combatant, spell, cell, token) {
      useCastSpell(combatant, spell, cell, token);
    },
    onSneakRequest: function (combatant, cell) {
      useSneak(combatant, cell);
    },
    onPaintRequest: paintTerrainCell,
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

  // Right-click token HUD: settings gear, direct HP editing, and the condition
  // palette. All rules mutations go through Combatant's public API; the HUD
  // only refreshes presentation and flushes the shared event log.
  tokenHud = new View.TokenHud({
    battlefield: battlefield,
    canvas: canvas,
    container: canvas.parentElement,
    eventBus: EVENT_BUS,
    onStateChange: function (combatant, change) {
      flushEventLog();
      battlefield.refresh();
      updateTokenCards();
      renderSelection(
        battlefield.getSelectedCombatant(),
        battlefield.getReachableCells(),
      );
    },
    onLog: function (message, kind) {
      log.add(message, kind || "info");
    },
    onSettings: function (combatant) {
      log.add(
        "Token settings for " + combatant.name + " are not implemented yet.",
        "muted",
      );
    },
    onDelete: function (combatant) {
      deleteCombatant(combatant, { source: "token-hud" });
    },
  });

  // Phase 24: scene presets, the terrain/wall painter, and the clear-board
  // confirmation dialog. The editor forwards intents; main.js owns the live
  // map/encounter replacement.
  const confirmDialog = new View.ConfirmDialog({});
  sceneEditor = new View.SceneEditor({
    root: document.getElementById("scene-toolbar"),
    dialog: confirmDialog,
    onPresetChange: function (presetId) {
      applyScenePreset(presetId);
    },
    onToolChange: function (tool) {
      // Terrain brushes take precedence over the ruler/template overlays.
      if (ruler) {
        ruler.deactivate({ silent: true });
      }
      if (templateTool) {
        templateTool.deactivate({ silent: true });
      }
      battlefield.setPaintTool(tool);
      syncOverlayTool();
      syncRulerButton();
      updateHoverStatus(null);
      log.add(
        "Terrain brush: " + tool + (tool === "select" ? " (token/movement mode)" : "") + ".",
        "muted",
      );
    },
    onClearBoard: function () {
      clearBoard();
    },
  });

  // Phase 27: the tactical ruler overlays the canvas with a transparent
  // second canvas and owns only pointer measurement.
  ruler = new View.Ruler({
    canvas: canvas,
    container: canvas.parentElement,
    getGrid: function () {
      return battlefield.grid;
    },
    getMap: function () {
      return map;
    },
    getCombatant: function () {
      return battlefield.getSelectedCombatant() || encounter.activeCombatant;
    },
    onMeasure: updateRulerStatus,
    onActiveChange: function (active) {
      if (active) {
        if (templateTool) {
          templateTool.deactivate({ silent: true });
        }
        if (sceneEditor) {
          sceneEditor.setTool("select", { silent: true });
        }
        battlefield.setPaintTool(PAINT_TOOLS.SELECT);
        syncOverlayTool();
      } else {
        syncOverlayTool();
        if (!templateTool || !templateTool.isActive()) {
          updateHoverStatus(null);
        }
      }
      syncRulerButton();
    },
    onLog: function (message, kind) {
      log.add(message, kind || "info");
    },
  });

  // Phase 28: measured burst / cone / line templates and their Apply button.
  templateTool = new View.TemplateTool({
    canvas: canvas,
    container: canvas.parentElement,
    toolbar: document.querySelector("[data-template-toolbar]"),
    getGrid: function () {
      return battlefield.grid;
    },
    getMap: function () {
      return map;
    },
    getCombatants: function () {
      return COMBATANTS;
    },
    getTokenViews: function () {
      return battlefield.tokenViews;
    },
    getSpellcasters: templateSpellcasters,
    getSpells: templateSpellsFor,
    onApply: applyMeasuredTemplate,
    onActiveChange: function (active) {
      if (active) {
        if (ruler) {
          ruler.deactivate({ silent: true });
        }
        if (sceneEditor) {
          sceneEditor.setTool("select", { silent: true });
        }
        battlefield.setPaintTool(PAINT_TOOLS.SELECT);
        syncOverlayTool();
        syncRulerButton();
      } else {
        syncOverlayTool();
        if (!ruler || !ruler.isActive()) {
          updateHoverStatus(null);
        }
      }
    },
    onStateChange: updateTemplateStatus,
    onLog: function (message, kind) {
      log.add(message, kind || "info");
    },
  });

  const rulerButton = document.querySelector("[data-ruler-toggle]");
  if (rulerButton) {
    rulerButton.addEventListener("click", function () {
      const next = !ruler.isToolActive();
      if (next) {
        if (templateTool) {
          templateTool.deactivate({ silent: true });
        }
        if (sceneEditor) {
          sceneEditor.setTool("select", { silent: true });
        }
        battlefield.setPaintTool(PAINT_TOOLS.SELECT);
        ruler.setToolActive(true);
      } else {
        ruler.deactivate();
      }
      syncRulerButton();
    });
  }

  function selectCursorMode() {
    if (sceneEditor) {
      sceneEditor.setTool("select", { silent: true });
    }
    battlefield.setPaintTool(PAINT_TOOLS.SELECT);
    if (ruler) {
      ruler.deactivate({ silent: true });
    }
    if (templateTool) {
      templateTool.deactivate({ silent: true });
    }
    syncOverlayTool();
    syncRulerButton();
  }

  function findNextLivingIndex(encounterInstance, startIndex) {
    const count = encounterInstance.combatants.length;
    if (count === 0) {
      return -1;
    }
    const start =
      Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : 0;
    for (let step = 0; step < count; step += 1) {
      const index = (start + step) % count;
      const combatant = encounterInstance.combatants[index];
      if (combatant.isDefeated !== true && combatant.currentHP !== 0) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Rebuild the Encounter after a token leaves the roster. The round and
   * started flag survive; the active turn stays on the same creature unless
   * that creature was the one removed, in which case the next living
   * combatant in the old order takes over.
   */
  function rebuildEncounterForRoster(activeId, preferredIndex) {
    const previousRound =
      Number.isInteger(encounter.round) && encounter.round > 0
        ? encounter.round
        : 1;
    const wasStarted = encounter.started === true;

    if (COMBATANTS.length === 0) {
      const empty = new NullEncounter();
      empty.round = previousRound;
      empty.started = wasStarted;
      empty.setEventBus(EVENT_BUS);
      encounter = empty;
      return null;
    }

    const next = new Encounter({ combatants: COMBATANTS, eventBus: EVENT_BUS });
    next.round = previousRound;
    next.started = wasStarted;
    let index = activeId ? next.indexOf(activeId) : -1;
    if (index === -1 && wasStarted) {
      index = findNextLivingIndex(next, preferredIndex);
    }
    next.activeCombatantIndex = index;
    next.over = index === -1;
    if (typeof next._syncRound === "function") {
      next._syncRound();
    }
    encounter = next;
    return index === -1 ? null : next.activeCombatant;
  }

  function rebuildScenePresentation() {
    const active = encounter.activeCombatant;
    if (ruler) {
      ruler.deactivate({ silent: true });
    }
    if (templateTool) {
      templateTool.deactivate({ silent: true });
    }
    battlefield.setWorld(COMBATANTS, map);
    battlefield.setPaintTool(PAINT_TOOLS.SELECT);
    if (sceneEditor) {
      sceneEditor.setTool("select", { silent: true });
    }
    suppressSelectionLog = true;
    battlefield.setActiveCombatant(active ? active.id : null);
    rebuildTokenCards();
    populateSpellPicker();
    updateModeUi();
    renderInitiative();
    updateTokenCards();
    if (active) {
      battlefield.selectCombatant(active.id);
    } else {
      battlefield.clearSelection();
    }
    suppressSelectionLog = false;
    updateHoverStatus(null);
    updateHazardUi();
  }

  function createEmptyMap() {
    return new GridMap({ cols: COLS, rows: ROWS });
  }

  function applyScenePreset(presetId) {
    const id = String(presetId || "").trim().toLowerCase();

    if (tokenHud) {
      tokenHud.close();
    }
    if (characterSheet) {
      characterSheet.close();
    }
    clearTokenHighlight();

    if (id === "empty") {
      map = createEmptyMap();
      COMBATANTS = [];
      HAZARDS = [];
      encounter = new NullEncounter();
      encounter.setEventBus(EVENT_BUS);
      if (sceneEditor) {
        sceneEditor.setPreset("empty");
      }
      rebuildScenePresentation();
      log.add(
        "[SCENE] Empty Arena loaded — 15 × 15 grid, bright light, no combatants, walls, terrain, hazards, or traps.",
        "system",
      );
      return true;
    }

    if (id !== "default") {
      log.add("[SCENE] Unknown scene preset: " + id + ".", "warn");
      return false;
    }

    map = createDefaultMap();
    COMBATANTS = createDefaultCombatants();
    HAZARDS = createDefaultHazards(EVENT_BUS);
    encounter = new Encounter({
      combatants: COMBATANTS,
      eventBus: EVENT_BUS,
    });
    encounter.startEncounter();
    if (sceneEditor) {
      sceneEditor.setPreset("default");
    }
    rebuildScenePresentation();
    log.add(
      "[SCENE] Default Encounter restored — " +
        COMBATANTS.length +
        " combatants, central wall, difficult terrain, lava vents, and the Spike Trap.",
      "system",
    );
    return true;
  }

  function clearBoard() {
    if (tokenHud) {
      tokenHud.close();
    }
    if (characterSheet) {
      characterSheet.close();
    }
    clearTokenHighlight();

    map = createEmptyMap();
    COMBATANTS = [];
    HAZARDS = [];
    encounter = new NullEncounter();
    encounter.setEventBus(EVENT_BUS);
    encounter.round = 1;
    encounter.started = false;

    if (sceneEditor) {
      sceneEditor.setPreset("empty");
    }
    rebuildScenePresentation();
    log.add(
      "[SCENE] Поле боя очищено: все бойцы, стены, зоны ландшафта, опасные клетки и ловушки удалены.",
      "system",
    );
  }

  function deleteCombatant(combatant, options) {
    const opts = options || {};
    if (!combatant) {
      return false;
    }
    const index = COMBATANTS.findIndex(function (candidate) {
      return candidate.id === combatant.id;
    });
    if (index === -1) {
      log.add(combatant.name + " is no longer on the battlefield.", "warn");
      return false;
    }

    if (tokenHud) {
      tokenHud.close();
    }
    if (
      characterSheet &&
      typeof characterSheet.getCombatantId === "function" &&
      characterSheet.getCombatantId() === combatant.id
    ) {
      characterSheet.close();
    }
    if (
      battlefield.getSelectedCombatant() &&
      battlefield.getSelectedCombatant().id === combatant.id
    ) {
      battlefield.clearSelection();
    }

    const previousActive = encounter.activeCombatant;
    const wasActive =
      Boolean(previousActive) && previousActive.id === combatant.id;
    const activeId = previousActive ? previousActive.id : null;
    const preferredIndex = wasActive
      ? encounter.indexOf(previousActive)
      : -1;

    COMBATANTS.splice(index, 1);
    const released = Conditions.releaseGrapplesBySource(
      COMBATANTS,
      combatant.id,
    );
    const nextActive = rebuildEncounterForRoster(
      wasActive ? null : activeId,
      preferredIndex,
    );

    if (ruler) {
      ruler.deactivate({ silent: true });
    }
    if (templateTool) {
      templateTool.deactivate({ silent: true });
    }
    battlefield.setWorld(COMBATANTS, map);
    suppressSelectionLog = true;
    battlefield.setActiveCombatant(nextActive ? nextActive.id : null);
    rebuildTokenCards();
    populateSpellPicker();
    updateModeUi();
    renderInitiative();
    updateTokenCards();
    if (nextActive && !battlefield.isPainting()) {
      battlefield.selectCombatant(nextActive.id);
    } else if (!nextActive) {
      battlefield.clearSelection();
    }
    suppressSelectionLog = false;
    updateHoverStatus(null);
    updateHazardUi();

    logReleasedGrapples(
      combatant.name,
      released,
      "the token was removed",
    );
    log.add(
      combatant.name +
        " удален со сцены" +
        (opts.source === "hotkey" ? " (Delete)." : "."),
      "system",
    );
    return true;
  }

  // Phase 22: the Foundry-style right sidebar owns tab presentation only. The
  // existing combat controls and the CombatLog live inside its panels, so the
  // old left log column is no longer needed.
  sidebar = new View.Sidebar({
    root: document.getElementById("sidebar"),
    initialTab: "chat",
    chatElement: document.getElementById("combat-log"),
    onActivate: function (tabId) {
      if (tabId === "actors") {
        updateTokenCards();
      } else if (tabId === "compendium" && compendiumBrowser) {
        compendiumBrowser.activate();
      }
    },
  });

  // ------------------------------------------------- Phase 22 sheet helpers

  function isActiveCombatant(combatant) {
    const active = encounter.activeCombatant;
    return Boolean(active && combatant && active.id === combatant.id);
  }

  function highlightTokenOnMap(combatantId) {
    if (!battlefield || !Array.isArray(battlefield.tokenViews)) {
      return;
    }
    for (const view of battlefield.tokenViews) {
      if (typeof view.setHighlighted === "function") {
        view.setHighlighted(
          combatantId !== null &&
            combatantId !== undefined &&
            view.token.id === combatantId,
        );
      }
    }
    battlefield.render();
  }

  function clearTokenHighlight() {
    highlightTokenOnMap(null);
  }

  function findNearestStrikeTarget(combatant) {
    let best = null;
    for (const candidate of COMBATANTS) {
      if (candidate.id === combatant.id || candidate.isDefeated === true) {
        continue;
      }
      const evaluation = Strike.evaluateStrike({
        attacker: combatant,
        target: candidate,
        map: map,
        allies: COMBATANTS,
      });
      if (!evaluation.ok) {
        continue;
      }
      if (!best || evaluation.distanceFeet < best.distanceFeet) {
        best = { target: candidate, distanceFeet: evaluation.distanceFeet };
      }
    }
    return best ? best.target : null;
  }

  function evaluateManeuverTarget(action, combatant, target) {
    const options = {
      attacker: combatant,
      target: target,
      map: map,
      allies: COMBATANTS,
      combatants: COMBATANTS,
    };
    if (action === "trip") {
      return Trip.evaluateTrip(options);
    }
    if (action === "shove") {
      return Shove.evaluateShove(options);
    }
    return Grapple.evaluateGrapple(options);
  }

  function findNearestManeuverTarget(action, combatant) {
    let best = null;
    for (const candidate of COMBATANTS) {
      if (candidate.id === combatant.id || candidate.isDefeated === true) {
        continue;
      }
      const evaluation = evaluateManeuverTarget(action, combatant, candidate);
      if (!evaluation.ok) {
        continue;
      }
      const distance = Number.isFinite(evaluation.distanceFeet)
        ? evaluation.distanceFeet
        : Grid.getCombatantDistance(combatant, candidate);
      if (!best || distance < best.distanceFeet) {
        best = { target: candidate, distanceFeet: distance };
      }
    }
    return best ? best.target : null;
  }

  /**
   * Strike from the character sheet. The nearest hostile in reach is used so
   * the sheet button can actually resolve a Core Strike; when no target is in
   * reach the board arms Strike mode and asks the user to pick one.
   */
  function sheetStrike(combatant) {
    if (!isActiveCombatant(combatant)) {
      log.add(
        combatant.name + " cannot Strike — it is not that combatant's turn.",
        "warn",
      );
      return;
    }
    if (typeof combatant.canSpendActions === "function" &&
        !combatant.canSpendActions(1)) {
      log.add(combatant.name + " has no actions left to Strike.", "warn");
      return;
    }

    const target = findNearestStrikeTarget(combatant);
    if (!target) {
      battlefield.setMode(MODES.STRIKE);
      updateModeUi();
      log.add(
        "No hostile is in reach — Strike mode armed. Click a target on the board.",
        "muted",
      );
      return;
    }
    battlefield.onStrikeRequest(combatant, target);
  }

  function sheetQuickAction(combatant, action) {
    if (!isActiveCombatant(combatant)) {
      log.add(
        combatant.name + " cannot act — it is not that combatant's turn.",
        "warn",
      );
      return;
    }
    if (typeof combatant.canSpendActions === "function" &&
        !combatant.canSpendActions(1)) {
      log.add(combatant.name + " has no actions left.", "warn");
      return;
    }

    if (action === "stand") {
      if (!combatant.hasCondition("prone")) {
        log.add(combatant.name + " is not Prone.", "muted");
        return;
      }
      useStand();
      return;
    }

    if (action === "raise-shield") {
      const shield = combatant.getShield ? combatant.getShield() : null;
      if (!shield) {
        log.add(combatant.name + " has no shield to raise.", "warn");
        return;
      }
      if (
        typeof combatant.isItemHeld === "function" &&
        !combatant.isItemHeld(shield)
      ) {
        log.add(
          combatant.name + " must draw the shield before raising it.",
          "warn",
        );
        return;
      }
      useRaiseShield();
      return;
    }

    if (action === "take-cover") {
      useTakeCover();
      return;
    }

    if (action !== "trip" && action !== "shove" && action !== "grapple") {
      return;
    }

    const target = findNearestManeuverTarget(action, combatant);
    if (target) {
      if (action === "trip") {
        useTrip(combatant, target);
      } else if (action === "shove") {
        useShove(combatant, target);
      } else {
        useGrapple(combatant, target);
      }
      return;
    }

    const modes = {
      trip: MODES.TRIP,
      shove: MODES.SHOVE,
      grapple: MODES.GRAPPLE,
    };
    battlefield.setMode(modes[action]);
    updateModeUi();
    log.add(
      "No hostile is in reach — " +
        capitalize(action) +
        " mode armed. Click a target on the board.",
      "muted",
    );
  }

  function interactReasonText(reason) {
    switch (reason) {
      case "no-actions":
        return "no actions left";
      case "invalid-action":
        return "invalid Interact action";
      case "missing-item":
        return "the item was not found";
      case "no-free-hand":
        return "no free hand";
      case "slot-occupied":
        return "the hand slot is occupied";
      case "already-equipped":
        return "the item is already in hand";
      case "empty-hand":
        return "the hand is empty";
      case "not-held":
        return "the item is not held";
      case "disrupted":
        return "disrupted by a Reactive Strike";
      case "shield-not-held":
        return "the shield is not held";
      case "shield-not-raised":
        return "the shield is not raised";
      case "shield-broken":
        return "the shield is broken";
      case "shield-destroyed":
        return "the shield is destroyed";
      case "no-reaction":
        return "no reaction remains";
      case "no-damage":
        return "no damage to block";
      case "non-physical-damage":
        return "only physical damage can be blocked";
      default:
        return reason || "not possible";
    }
  }

  function useInteract(combatant, actionType, payload) {
    if (!isActiveCombatant(combatant)) {
      log.add(
        combatant.name + " cannot Interact — it is not that combatant's turn.",
        "warn",
      );
      return;
    }
    const opts = payload || {};
    const result = Interact.performInteract({
      combatant: combatant,
      actionType: actionType,
      item: opts.item,
      slot: opts.slot,
      combatants: COMBATANTS,
      map: map,
      allies: COMBATANTS,
      rollD20: rollD20,
      rollDamageDie: rollDamageDie,
      rollDie: rollDie,
    });

    if (!result.ok) {
      log.add(
        "Interact canceled — " + interactReasonText(result.reason) + ".",
        "warn",
      );
      flushEventLog();
      handleSheetMutation();
      return;
    }

    const itemName = result.item ? result.item.name : "the item";
    const verb =
      actionType === "draw"
        ? "draws"
        : actionType === "stow"
          ? "stows"
          : actionType === "drop"
            ? "drops"
            : "swaps to";
    log.add(
      combatant.name +
        " " +
        verb +
        " " +
        itemName +
        (result.actionCost > 0
          ? " (" + result.actionCost + " action). Actions left: " +
            result.actionsLeft + "."
          : " (free action)."),
      "info",
    );
    // A manipulate Interact may provoke; the bus already logs the reaction.
    if (result.reactionStrikes && result.reactionStrikes.length > 0) {
      flushEventLog();
    }
    handleSheetMutation();
  }

  function useSheetShieldBlock(combatant, payload) {
    const opts = payload || {};
    const result = ShieldBlock.performShieldBlock({
      combatant: combatant,
      damage: opts.damage,
      damageType: opts.damageType || "bludgeoning",
    });
    if (!result.ok) {
      log.add(
        "Shield Block unavailable — " + interactReasonText(result.reason) + ".",
        "warn",
      );
      return;
    }
    flushEventLog();
    handleSheetMutation();
  }

  function prepareSheetSpell(combatant, spell) {
    if (!isActiveCombatant(combatant)) {
      log.add(
        combatant.name + " cannot Cast — it is not that combatant's turn.",
        "warn",
      );
      return;
    }
    if (!spell) {
      return;
    }
    if (spellSelectEl) {
      spellSelectEl.value = spell.id;
    }
    battlefield.setSpell(spell);
    updateModeUi();
    updateSpellUi();
    updateHoverStatus(null);
    log.add(
      "Spell prepared: " +
        spell.name +
        ". Hover the board to place its template or choose a target.",
      "muted",
    );
  }

  function useSustainSpellById(combatant, activeSpellId) {
    if (!isActiveCombatant(combatant)) {
      log.add(
        combatant.name + " cannot Sustain — it is not that combatant's turn.",
        "warn",
      );
      return;
    }
    const sustained = activeSustainedSpells(combatant).find(function (entry) {
      return entry.id === activeSpellId;
    });
    if (!sustained) {
      log.add("Sustain canceled — the spell is no longer active.", "warn");
      return;
    }
    const result = SustainSpell.performSustainSpell({
      caster: combatant,
      activeSpellId: activeSpellId,
      encounter: encounter,
    });
    if (!result.ok) {
      log.add("Sustain canceled — " + (result.reason || "not possible") + ".", "warn");
      return;
    }
    log.add(
      "[SPELL] " +
        combatant.name +
        " sustains " +
        (sustained.spell ? sustained.spell.name : "the spell") +
        " until the end of round " +
        result.expiresAtRound +
        ". Actions left: " +
        result.actionsLeft +
        ".",
      "spell",
    );
    handleSheetMutation();
    updateSpellUi();
  }

  function handleSheetMutation() {
    flushEventLog();
    battlefield.refresh();
    updateTokenCards();
    renderSelection(
      battlefield.getSelectedCombatant(),
      battlefield.getReachableCells(),
    );
  }

  // ------------------------------------------------ Phase 26/27/28 UI glue

  function hotbarContext(combatant) {
    if (!combatant) {
      return {
        canAct: false,
        hasActions: false,
        shieldAvailable: false,
        coverAvailable: false,
        prone: false,
      };
    }
    const canAct =
      combatant.isDefeated !== true &&
      (typeof combatant.canAct !== "function" || combatant.canAct().ok);
    const hasActions =
      typeof combatant.canSpendActions === "function"
        ? combatant.canSpendActions(1)
        : combatant.actionsRemaining >= 1;

    let shieldAvailable = false;
    const shield =
      typeof combatant.getShield === "function"
        ? combatant.getShield()
        : combatant.shield || null;
    if (shield) {
      const state =
        typeof combatant.getShieldState === "function"
          ? combatant.getShieldState()
          : null;
      const intact =
        !state || (state.broken !== true && state.destroyed !== true);
      const held =
        typeof combatant.isItemHeld !== "function" ||
        combatant.isItemHeld(shield) === true;
      shieldAvailable = intact && held;
    }

    let coverAvailable = false;
    try {
      coverAvailable = TakeCover.canTakeCover({
        combatant: combatant,
        map: map,
        combatants: COMBATANTS,
      }).ok === true;
    } catch (error) {
      coverAvailable = false;
    }

    const prone =
      typeof combatant.hasCondition === "function" &&
      combatant.hasCondition("prone");

    return {
      canAct: canAct,
      hasActions: hasActions,
      shieldAvailable: shieldAvailable,
      coverAvailable: coverAvailable,
      prone: prone,
    };
  }

  function activateHotbarSlot(binding, combatant, index) {
    if (!binding || !combatant) {
      return;
    }
    if (!isActiveCombatant(combatant)) {
      log.add(
        combatant.name + " cannot act — it is not that combatant's turn.",
        "warn",
      );
      return;
    }
    updateHoverStatus(null);

    if (binding.kind === "spell") {
      prepareSheetSpell(combatant, binding.entry);
      return;
    }
    if (binding.kind === "weapon") {
      sheetStrike(combatant);
      return;
    }

    switch (binding.id) {
      case "stride":
      case "step":
        selectCursorMode();
        battlefield.setMode(binding.id === "step" ? MODES.STEP : MODES.STRIDE);
        updateModeUi();
        updateHoverStatus(null);
        log.add(
          "Hotbar " +
            (index + 1) +
            ": " +
            (binding.id === "step" ? "Step" : "Stride") +
            " mode armed.",
          "muted",
        );
        return;
      case "strike":
        sheetStrike(combatant);
        return;
      case "trip":
      case "shove":
      case "grapple":
      case "raise-shield":
      case "take-cover":
      case "stand":
        sheetQuickAction(combatant, binding.id);
        return;
      default:
        log.add("Неизвестное действие хотбара: " + binding.id, "warn");
    }
  }

  function refreshHotbar() {
    if (hotbar) {
      hotbar.refresh();
    }
  }

  // ------------------------------------------------------------ Phase 27

  function syncOverlayTool() {
    let active = null;
    if (templateTool && templateTool.isActive()) {
      active = templateTool;
    } else if (ruler && ruler.isActive()) {
      active = ruler;
    }
    battlefield.setExternalTool(active);
  }

  function syncRulerButton() {
    const button = document.querySelector("[data-ruler-toggle]");
    if (!button) {
      return;
    }
    const active = Boolean(ruler && ruler.isToolActive());
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }

  function updateRulerStatus(state) {
    if (!state) {
      if (!templateTool || !templateTool.isActive()) {
        updateHoverStatus(null);
      }
      return;
    }
    statusEl.className = "board-hint board-status ruler-status";
    delete statusEl.dataset.state;
    const parts = [];
    parts.push(
      "Ruler: " +
        Grid.gridToLabel(state.start) +
        " → " +
        Grid.gridToLabel(state.current) +
        " · " +
        state.totalFeet +
        " ft",
    );
    if (state.terrainFeet > 0) {
      parts.push("difficult terrain +" + state.terrainFeet + " ft");
    }
    if (state.waypoints.length > 0) {
      parts.push(state.waypoints.length + " waypoint(s)");
    }
    if (state.blocked) {
      parts.push("ЗАБЛОКИРОВАНО стеной");
      statusEl.classList.add("is-blocked");
      statusEl.dataset.state = "blocked";
    } else if (state.speedFeet !== null) {
      if (state.reach === "within") {
        parts.push("within Speed " + state.speedFeet + " ft");
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "valid";
      } else if (state.reach === "extended") {
        parts.push("2× Speed (up to " + state.speedFeet * 2 + " ft)");
        statusEl.classList.add("is-warning");
        statusEl.dataset.state = "warning";
      } else {
        parts.push("beyond 2× Speed");
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = "invalid";
      }
    } else {
      parts.push("no selected combatant — pure distance");
      statusEl.classList.add("is-valid");
      statusEl.dataset.state = "valid";
    }
    statusEl.textContent = parts.join(" · ");
  }

  // ------------------------------------------------------------ Phase 28

  function templateSpellcasters() {
    return COMBATANTS.filter(function (combatant) {
      return (
        combatant.isDefeated !== true &&
        isSpellcaster(combatant)
      );
    }).sort(function (left, right) {
      // Prefer the active combatant, then the current selection, then players.
      const active = encounter.activeCombatant;
      const selected = battlefield.getSelectedCombatant();
      const score = function (combatant) {
        let value = 0;
        if (active && active.id === combatant.id) {
          value += 4;
        }
        if (selected && selected.id === combatant.id) {
          value += 2;
        }
        if (allianceOf(combatant) === "player") {
          value += 1;
        }
        return value;
      };
      return score(right) - score(left);
    });
  }

  function templateSpellsFor(caster) {
    const spells = caster && Array.isArray(caster.spells) ? caster.spells : [];
    return spells.filter(function (spell) {
      return (
        spell &&
        spell.type === "save" &&
        spell.damage &&
        typeof spell.damage.formula === "string"
      );
    });
  }

  function spellDCFor(caster) {
    if (Number.isInteger(caster.spellDC)) {
      return caster.spellDC;
    }
    if (Number.isInteger(caster.spellAttackBonus) && caster.spellAttackBonus > 0) {
      return caster.spellAttackBonus + 8;
    }
    return 10 + Math.max(0, Number.isInteger(caster.attackBonus) ? caster.attackBonus : 0);
  }

  function updateTemplateStatus(state) {
    if (!state || !state.active) {
      if (!ruler || !ruler.isActive()) {
        updateHoverStatus(null);
      }
      return;
    }
    statusEl.className = "board-hint board-status template-status";
    delete statusEl.dataset.state;
    const labels = {
      burst: "Burst",
      cone: "Cone",
      line: "Line",
    };
    let text =
      "Шаблон: " +
      (labels[state.tool] || state.tool) +
      " " +
      state.sizeFeet +
      " ft";
    if (state.cells && state.cells.length > 0) {
      text += " · " + state.cells.length + " клеток";
    }
    if (state.targets && state.targets.length > 0) {
      text += " · " + state.targets.length + " целей подсвечено";
    }
    if (state.fixed) {
      text += " — нажмите «Применить заклинание» или ✖";
      statusEl.classList.add("is-invalid");
      statusEl.dataset.state = "template-fixed";
    } else {
      text += " — клик по полю фиксирует шаблон";
      statusEl.classList.add("is-valid");
      statusEl.dataset.state = "template-preview";
    }
    statusEl.textContent = text;
  }

  function applyMeasuredTemplate(template, caster, spell, targets) {
    if (!template || !caster || !spell) {
      log.add("Шаблон не применён: нет кастера или заклинания.", "warn");
      return;
    }
    const affected = Array.isArray(targets) ? targets : [];
    if (affected.length === 0) {
      log.add(
        "Шаблон " +
          (template.tool || "area") +
          " " +
          template.sizeFeet +
          " ft не задел ни одного существа.",
        "warn",
      );
      return;
    }

    const damageSpec = spell.damage || { formula: "1d6", type: "fire" };
    let damageRoll;
    try {
      damageRoll = Damage.rollDamage({
        formula: damageSpec.formula,
        type: damageSpec.type || "untyped",
        rollDie: rollDamageDie,
      });
    } catch (error) {
      log.add("Шаблон не применён: " + error.message, "warn");
      return;
    }

    const saveType = String(spell.saveType || "reflex").toLowerCase();
    const saveDC = spellDCFor(caster);
    const label = {
      burst: "Burst",
      cone: "Cone",
      line: "Line",
    }[template.tool] || "Area";

    log.add(
      "[SPELL] " +
        caster.name +
        " применяет " +
        spell.name +
        " · " +
        label +
        " " +
        template.sizeFeet +
        " ft · " +
        affected.length +
        " target(s) · " +
        capitalize(saveType) +
        " DC " +
        saveDC +
        " · " +
        damageSpec.formula +
        " " +
        damageRoll.type +
        ".",
      "spell",
    );
    log.add(
      "[SPELL] " +
        spell.name +
        " damage: " +
        damageSpec.formula +
        " " +
        damageRoll.type +
        " = " +
        damageRoll.total +
        (damageRoll.diceCount > 0
          ? " [" +
            damageRoll.rolls.join(" + ") +
            (damageRoll.modifier === 0 ? "" : " " + signed(damageRoll.modifier)) +
            "]"
          : "") +
        ".",
      "info",
    );

    let defeated = 0;
    for (const target of affected) {
      if (!target || target.isDefeated === true) {
        continue;
      }
      const saveModifier =
        target.saves && Number.isInteger(target.saves[saveType])
          ? target.saves[saveType]
          : 0;
      const d20 = rollD20();
      const save = Spells.evaluateBasicSave({
        saveRoll: d20,
        saveModifier: saveModifier,
        saveDC: saveDC,
        rawDamage: damageRoll.total,
      });
      const before = target.currentHP;
      const damageResult = target.takeDamage(save.damage, {
        type: damageRoll.type || "untyped",
        source: "measured-template",
      });
      const iwrText =
        formatIWRDamage({ diceCount: 0 }, damageResult.iwr) ||
        save.damage + " " + (damageRoll.type || "untyped") + " damage";
      const hpLine =
        "HP " +
        before +
        " -> " +
        target.currentHP +
        "/" +
        target.maxHP +
        (target.isDefeated === true ? " — DEFEATED" : "");
      log.add(
        "[SAVE] " +
          target.name +
          ": d20(" +
          d20 +
          ") " +
          signed(saveModifier) +
          " = " +
          (d20 + saveModifier) +
          " vs DC " +
          saveDC +
          " -> " +
          degreeLabel(save.degree) +
          " (" +
          Math.round(save.damageMultiplier * 100) +
          "% damage).",
        "info",
      );
      log.add("[IWR] " + target.name + ": " + iwrText + "; " + hpLine + ".", "info");
      if (target.isDefeated === true) {
        defeated += 1;
      }
    }

    if (defeated > 0) {
      log.add(defeated + " target(s) defeated by " + spell.name + ".", "warn");
    }
    flushEventLog();
    battlefield.refresh();
    updateTokenCards();
    renderSelection(
      battlefield.getSelectedCombatant(),
      battlefield.getReachableCells(),
    );
    if (templateTool) {
      templateTool.refreshAll();
    }
  }

  function refreshTemplateTool() {
    if (templateTool && templateTool.isActive()) {
      templateTool.refreshAll();
    }
  }

  function openCharacterSheet(combatantId) {
    if (!characterSheet) {
      return false;
    }
    const opened = characterSheet.open(combatantId);
    if (opened) {
      highlightTokenOnMap(combatantId);
    }
    return opened;
  }

  // Floating character sheet. Every action button delegates to the helpers
  // above, which in turn call the existing headless Core actions.
  characterSheet = new View.CharacterSheet({
    container: document.getElementById("character-sheet-layer"),
    eventBus: EVENT_BUS,
    getCombatant: findCombatant,
    getRound: function () {
      return encounter.round;
    },
    isActiveCombatant: isActiveCombatant,
    onStrike: function (combatant) {
      sheetStrike(combatant);
    },
    onQuickAction: function (combatant, action) {
      sheetQuickAction(combatant, action);
    },
    onInteract: function (combatant, actionType, payload) {
      useInteract(combatant, actionType, payload);
    },
    onShieldBlock: function (combatant, payload) {
      useSheetShieldBlock(combatant, payload);
    },
    onCast: function (combatant, spell) {
      prepareSheetSpell(combatant, spell);
    },
    onSustain: function (combatant, activeSpellId) {
      useSustainSpellById(combatant, activeSpellId);
    },
    onHpChange: function () {
      handleSheetMutation();
    },
    onDropCompendium: function (combatant, metadata) {
      handleCharacterSheetDrop(combatant, metadata);
    },
    onRemoveItem: function (combatant, item) {
      removeSheetItem(combatant, item);
    },
    onLog: function (message, kind) {
      log.add(message, kind || "info");
    },
    onClose: function () {
      // Keep the map highlight after the sheet closes so the inspected token
      // remains easy to find; a board click clears it.
    },
  });

  // Phase 26: bottom macro hotbar. Slots are rebuilt on every active-turn
  // change and manual spell/weapon bindings survive for each combatant.
  hotbar = new View.Hotbar({
    layer: document.getElementById("hotbar"),
    getActiveCombatant: function () {
      return encounter.activeCombatant;
    },
    getContext: hotbarContext,
    onActivate: activateHotbarSlot,
    onLog: function (message, kind) {
      log.add(message, kind || "info");
    },
  });

  // ------------------------------------------------- Phase 23 compendium glue

  const COMPENDIUM_AREA_TYPES = Object.freeze(["burst", "cone", "line", "emanation"]);
  const COMPENDIUM_SIZE_MAP = Object.freeze({
    tiny: "tiny",
    small: "small",
    medium: "medium",
    large: "large",
    huge: "huge",
    gargantuan: "huge",
  });
  const SPAWN_COLORS = [
    "#d1495b",
    "#b07a4a",
    "#7d6aa8",
    "#4b8f8c",
    "#b45f8c",
    "#6a8caf",
    "#a66a3a",
    "#567d46",
  ];
  let spawnSerial = 0;

  function isSpellcaster(combatant) {
    if (!combatant) {
      return false;
    }
    if (Array.isArray(combatant.spells) && combatant.spells.length > 0) {
      return true;
    }
    if (combatant.spellAttackBonus > 0) {
      return true;
    }
    if (
      combatant.spellSlots &&
      typeof combatant.spellSlots === "object" &&
      Object.keys(combatant.spellSlots).length > 0
    ) {
      return true;
    }
    return Boolean(
      combatant.focusPoints && combatant.focusPoints.max > 0,
    );
  }

  function compendiumRecipients(categoryId) {
    const living = COMBATANTS.filter(function (combatant) {
      return allianceOf(combatant) === "player" && combatant.isDefeated !== true;
    });
    if (categoryId === "spells") {
      return living.filter(isSpellcaster);
    }
    return living;
  }

  function compendiumPreferredRecipient(categoryId) {
    const recipients = compendiumRecipients(categoryId);
    if (recipients.length === 0) {
      return null;
    }
    const selected = battlefield.getSelectedCombatant();
    if (selected) {
      const selectedMatch = recipients.find(function (combatant) {
        return combatant.id === selected.id;
      });
      if (selectedMatch) {
        return selectedMatch;
      }
    }
    const active = encounter.activeCombatant;
    if (active) {
      const activeMatch = recipients.find(function (combatant) {
        return combatant.id === active.id;
      });
      if (activeMatch) {
        return activeMatch;
      }
    }
    return recipients[0];
  }

  /**
   * Foundry area templates that the core does not model directly collapse to
   * the closest 2D shape. The compendium JSON keeps the original type; only
   * the engine-side spell object is normalized here.
   */
  function compendiumAreaToEngine(area) {
    if (!area || typeof area.type !== "string") {
      return null;
    }
    const original = String(area.type).toLowerCase();
    const type =
      original === "sphere" || original === "cylinder" || original === "square"
        ? "burst"
        : original;
    if (COMPENDIUM_AREA_TYPES.indexOf(type) === -1) {
      return null;
    }
    let value = Number(area.value);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    value = Math.max(5, Math.round(value / 5) * 5);
    if (type === "line") {
      return { type: type, lengthFeet: value, widthFeet: 5 };
    }
    if (type === "cone") {
      return { type: type, lengthFeet: value };
    }
    return { type: type, radiusFeet: value };
  }

  /**
   * Convert one generated catalog spell into the headless spell contract used
   * by CastSpell: cost/type/traits/rank/save/area/damage.
   */
  function compendiumSpellToEngine(entry) {
    if (!entry || typeof entry.name !== "string") {
      return null;
    }
    const traits = Array.isArray(entry.traits) ? entry.traits.slice() : [];
    if (entry.isCantrip && traits.indexOf("cantrip") === -1) {
      traits.push("cantrip");
    }
    if (entry.isFocus && traits.indexOf("focus") === -1) {
      traits.push("focus");
    }
    if (entry.isSustained && traits.indexOf("sustained") === -1) {
      traits.push("sustained");
    }

    const cost =
      Number.isInteger(entry.actionCost) && entry.actionCost >= 1 && entry.actionCost <= 3
        ? entry.actionCost
        : 2;
    const spell = {
      id: entry.id,
      name: entry.name,
      cost: cost,
      type: traits.indexOf("attack") !== -1 ? "attack" : "save",
      traits: traits,
    };

    // Cantrips are free and display as "Cantrip"; omitting rank keeps the
    // character sheet from labeling them "Rank 0".
    if (!entry.isCantrip && Number.isInteger(entry.rank)) {
      spell.rank = entry.rank;
    }

    if (entry.save && entry.save.statistic) {
      spell.saveType = String(entry.save.statistic).toLowerCase();
      spell.basic = entry.save.basic === true;
    }
    if (entry.damage && entry.damage.formula) {
      spell.damage = {
        formula: entry.damage.formula,
        type: entry.damage.type || "untyped",
      };
    }
    const area = compendiumAreaToEngine(entry.area);
    if (area) {
      spell.area = area;
    }
    if (entry.description) {
      spell.description = entry.description;
    }
    return spell;
  }

  function compendiumItemToInventory(entry) {
    if (entry.hardness !== undefined && entry.acBonus !== undefined) {
      return {
        id: entry.id,
        name: entry.name,
        type: "shield",
        hardness: entry.hardness,
        hp: entry.hp,
        maxHP: entry.maxHP,
        brokenThreshold: entry.brokenThreshold,
        acBonus: entry.acBonus,
        speedPenalty: entry.speedPenalty,
        hands: 1,
      };
    }
    return {
      id: entry.id,
      name: entry.name,
      type: "weapon",
      damage: entry.damage ? entry.damage.formula : "1d4",
      damageType: entry.damage ? entry.damage.type : "untyped",
      traits: Array.isArray(entry.traits) ? entry.traits.slice() : [],
      hands: entry.hands === 2 ? 2 : 1,
    };
  }

  function sameCompendiumName(left, right) {
    const a = String(left === undefined || left === null ? "" : left)
      .trim()
      .toLowerCase();
    const b = String(right === undefined || right === null ? "" : right)
      .trim()
      .toLowerCase();
    return a !== "" && a === b;
  }

  /**
   * Phase 25 drop path: unlike the "Экипировать" button, dropping the same
   * weapon/shield twice must create two inventory records. Core de-duplicates
   * by id, so the view assigns a stable copy suffix before calling the public
   * addInventoryItem API.
   */
  function addCompendiumItemToInventory(combatant, entry) {
    if (!combatant || !entry) {
      return null;
    }
    const itemInput = compendiumItemToInventory(entry);
    const existing =
      typeof combatant.findInventoryItem === "function"
        ? combatant.findInventoryItem(itemInput.id)
        : null;
    if (existing) {
      let suffix = 2;
      let candidate = itemInput.id + "-" + suffix;
      while (
        typeof combatant.findInventoryItem === "function" &&
        combatant.findInventoryItem(candidate)
      ) {
        suffix += 1;
        candidate = itemInput.id + "-" + suffix;
      }
      itemInput.id = candidate;
    }

    const item =
      typeof combatant.addInventoryItem === "function"
        ? combatant.addInventoryItem(itemInput)
        : null;
    if (!item) {
      log.add("Не удалось добавить " + entry.name + " в инвентарь.", "warn");
      return null;
    }

    log.add(
      "[COMPENDIUM] " +
        entry.name +
        " добавлен в инвентарь " +
        combatant.name +
        ".",
      "system",
    );
    handleSheetMutation();
    return item;
  }

  function equipCompendiumItem(combatant, entry) {
    if (!combatant || !entry) {
      return;
    }
    const itemInput = compendiumItemToInventory(entry);
    const item =
      typeof combatant.addInventoryItem === "function"
        ? combatant.addInventoryItem(itemInput)
        : null;
    if (!item) {
      log.add("Не удалось добавить " + entry.name + " в инвентарь.", "warn");
      return;
    }

    const slot = itemInput.type === "shield" ? "offHand" : undefined;
    let result = combatant.equipItem(item, slot ? { slot: slot } : undefined);
    if (!result.ok && itemInput.hands === 1) {
      // The preferred slot may be busy; let the Combatant pick the other hand.
      result = combatant.equipItem(item);
    }

    if (result.ok) {
      log.add(
        "[COMPENDIUM] " +
          combatant.name +
          " экипирует " +
          entry.name +
          (result.slot
            ? " (" + (result.slot === "mainHand" ? "основная рука" : "вторая рука") + ")."
            : " (двумя руками)."),
        "system",
      );
    } else {
      log.add(
        "[COMPENDIUM] " +
          entry.name +
          " добавлен в инвентарь " +
          combatant.name +
          ", но не взят в руки (" +
          (result.reason === "no-free-hand" ? "нет свободной руки" : result.reason) +
          ").",
        "warn",
      );
    }

    handleSheetMutation();
    populateSpellPicker();
    updateSpellUi();
  }

  function addCompendiumSpell(combatant, entry, options) {
    if (!combatant || !entry) {
      return false;
    }
    const opts = options || {};
    const spell = compendiumSpellToEngine(entry);
    if (!spell) {
      log.add("Не удалось подготовить " + entry.name + " для боевого ядра.", "warn");
      return false;
    }

    const existing = Array.isArray(combatant.spells)
      ? combatant.spells.find(function (candidate) {
          return (
            candidate.id === spell.id ||
            sameCompendiumName(candidate.name, spell.name) ||
            sameCompendiumName(candidate.name, entry.name)
          );
        })
      : null;
    if (existing) {
      log.add(
        opts.source === "drop"
          ? "Заклинание " + entry.name + " уже известно персонажу."
          : "[COMPENDIUM] " + combatant.name + " уже знает " + entry.name + ".",
        opts.source === "drop" ? "warn" : "muted",
      );
      return false;
    }

    if (!Array.isArray(combatant.spells)) {
      combatant.spells = [];
    }
    combatant.spells.push(spell);
    log.add(
      "[COMPENDIUM] " +
        entry.name +
        " добавлено в заклинания " +
        combatant.name +
        (entry.isCantrip ? " (кантрип)." : " (ранг " + entry.rank + ")."),
      "spell",
    );
    handleSheetMutation();
    populateSpellPicker();
    updateSpellUi();
    return true;
  }

  function spawnNameFor(baseName) {
    const name = String(baseName || "Monster").trim() || "Monster";
    const existing = COMBATANTS.filter(function (combatant) {
      return combatant.name === name || combatant.name.indexOf(name + " ") === 0;
    });
    return existing.length === 0 ? name : name + " " + (existing.length + 1);
  }

  function spawnIdFor(baseId) {
    spawnSerial += 1;
    let id = String(baseId || "monster") + "-spawn-" + spawnSerial;
    while (
      COMBATANTS.some(function (combatant) {
        return combatant.id === id;
      })
    ) {
      spawnSerial += 1;
      id = String(baseId || "monster") + "-spawn-" + spawnSerial;
    }
    return id;
  }

  function monsterFootprint(size) {
    if (size === "large") return 2;
    if (size === "huge") return 3;
    return 1;
  }

  function findFreeSpawnCell(size, anchor) {
    const footprint = monsterFootprint(size);
    const hasAnchor =
      anchor &&
      Number.isInteger(anchor.x) &&
      Number.isInteger(anchor.y);
    const targetX = hasAnchor ? anchor.x : (map.cols - 1) / 2;
    const targetY = hasAnchor ? anchor.y : (map.rows - 1) / 2;
    const probe = {
      id: "__spawn_probe__",
      x: 0,
      y: 0,
      getFootprint: function () {
        return footprint;
      },
    };
    let best = null;
    for (let y = 0; y < map.rows; y += 1) {
      for (let x = 0; x < map.cols; x += 1) {
        probe.x = x;
        probe.y = y;
        if (!Occupancy.canOccupySpace(x, y, probe, map, COMBATANTS)) {
          continue;
        }
        const dx = x - targetX;
        const dy = y - targetY;
        const distance = dx * dx + dy * dy;
        if (!best || distance < best.distance) {
          best = { x: x, y: y, distance: distance };
        }
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  function monsterCombatTraits(entry, attack) {
    const raw = []
      .concat(Array.isArray(entry.traits) ? entry.traits : [])
      .concat(attack && Array.isArray(attack.traits) ? attack.traits : []);
    const traits = [];
    let reachFeet = 0;
    for (const trait of raw) {
      const text = String(trait);
      const reach = /^reach(?:-(\d+))?$/i.exec(text);
      if (reach) {
        reachFeet = Math.max(reachFeet, reach[1] ? Number.parseInt(reach[1], 10) : 10);
        continue;
      }
      if (/^(ranged|thrown|volley|reload)-0$/i.test(text)) {
        continue;
      }
      if (traits.indexOf(text) === -1) {
        traits.push(text);
      }
    }
    if (reachFeet >= 10 && traits.indexOf("reach") === -1) {
      traits.unshift("reach");
    }
    return traits;
  }

  function createMonsterCombatant(entry, options) {
    const opts = options || {};
    const requested =
      opts.position &&
      Number.isInteger(opts.position.x) &&
      Number.isInteger(opts.position.y)
        ? { x: opts.position.x, y: opts.position.y }
        : null;
    const position = findFreeSpawnCell(
      COMPENDIUM_SIZE_MAP[entry.size] || "medium",
      requested,
    );
    if (!position) {
      return { ok: false, reason: "no-free-cell" };
    }

    const attacks = Array.isArray(entry.attacks) ? entry.attacks : [];
    const attack =
      attacks.find(function (candidate) {
        return candidate.type === "melee" && candidate.damage;
      }) ||
      attacks.find(function (candidate) {
        return candidate.damage;
      }) ||
      attacks[0] ||
      null;

    const size = COMPENDIUM_SIZE_MAP[entry.size] || "medium";
    const id = spawnIdFor(entry.id);
    const name = spawnNameFor(entry.name);
    const initiative = rollD20() + (Number.isInteger(entry.perception) ? entry.perception : 0);
    const attackTraits = attack && Array.isArray(attack.traits) ? attack.traits : [];
    const damage =
      attack && attack.damage
        ? {
            formula: attack.damage.formula,
            type: attack.damage.type || "untyped",
          }
        : { formula: "1d4", type: "untyped" };

    const skills = Object.assign({}, entry.skills || {});
    skills.perception = Number.isInteger(entry.perception) ? entry.perception : 0;

    const spells = (Array.isArray(entry.spells) ? entry.spells : [])
      .map(compendiumSpellToEngine)
      .filter(function (spell) {
        return spell !== null;
      });

    const combatant = new Combatant({
      id: id,
      name: name,
      alliance: "enemy",
      initiative: initiative,
      x: position.x,
      y: position.y,
      size: size,
      speedFeet: Number.isInteger(entry.speed) && entry.speed > 0 ? entry.speed : 25,
      maxHP: Number.isInteger(entry.hp) && entry.hp > 0 ? entry.hp : 1,
      ac: Number.isInteger(entry.ac) ? entry.ac : 10,
      attackBonus:
        attack && Number.isInteger(attack.attackBonus) ? attack.attackBonus : 0,
      damage: damage,
      damageType: damage.type,
      traits: monsterCombatTraits(entry, attack),
      agile: attackTraits.indexOf("agile") !== -1,
      rangeIncrement:
        attack && Number.isInteger(attack.rangeIncrement) ? attack.rangeIncrement : undefined,
      reload:
        attack && Number.isInteger(attack.reload) ? attack.reload : undefined,
      saves: entry.saves || {},
      skills: skills,
      senses: Array.isArray(entry.senses) ? entry.senses : undefined,
      spells: spells,
      spellAttackBonus: Number.isInteger(entry.level) ? Math.max(0, entry.level + 5) : 0,
    });

    return {
      ok: true,
      combatant: combatant,
      position: position,
      requested: requested,
    };
  }

  /**
   * Add a spawned combatant to the roster and rebuild the Encounter around the
   * same live combatants. Rebuilding through the public constructor keeps the
   * canonical initiative tie-break order while preserving the current round
   * and active turn.
   */
  function registerSpawnedCombatant(combatant) {
    const previousActive = encounter.activeCombatant;
    let activeId = previousActive ? previousActive.id : null;
    const previousRound = encounter.round;
    const wasStarted = encounter.started;

    COMBATANTS.push(combatant);
    const next = new Encounter({ combatants: COMBATANTS, eventBus: EVENT_BUS });
    next.round = previousRound;
    next.started = wasStarted;
    next.over = next.livingCombatants.length === 0;
    if (!wasStarted) {
      // Spawning into an empty or freshly cleared arena starts the encounter
      // immediately so the new monster can act without an extra setup step.
      const startedActive = next.startEncounter();
      activeId = startedActive ? startedActive.id : null;
      next.round = previousRound || 1;
    } else {
      next.activeCombatantIndex = activeId ? next.indexOf(activeId) : -1;
    }
    if (typeof next._syncRound === "function") {
      next._syncRound();
    }
    encounter = next;
    return activeId;
  }

  function spawnCompendiumMonster(entry, options) {
    if (!entry) {
      return;
    }
    const created = createMonsterCombatant(entry, options);
    if (!created.ok) {
      log.add(
        "[BESTIARY] Нет свободной клетки для " + entry.name + " на поле.",
        "warn",
      );
      return;
    }

    const combatant = created.combatant;
    COLORS[combatant.id] = SPAWN_COLORS[(spawnSerial - 1) % SPAWN_COLORS.length];

    const activeId = registerSpawnedCombatant(combatant);
    const selected = battlefield.getSelectedCombatant();
    const selectedId = selected ? selected.id : null;

    if (ruler) {
      ruler.deactivate({ silent: true });
    }
    if (templateTool) {
      templateTool.deactivate({ silent: true });
    }
    battlefield.setWorld(COMBATANTS, map);
    battlefield.setActiveCombatant(activeId);
    suppressSelectionLog = true;
    if (selectedId) {
      battlefield.selectCombatant(selectedId);
    } else if (activeId) {
      battlefield.selectCombatant(activeId);
    } else {
      battlefield.clearSelection();
    }
    suppressSelectionLog = false;

    rebuildTokenCards();
    updateTokenCards();
    populateSpellPicker();
    updateSpellUi();
    updateHoverStatus(null);

    const requested = created.requested;
    const adjusted =
      requested &&
      (requested.x !== combatant.x || requested.y !== combatant.y);
    log.add(
      "[BESTIARY] " +
        combatant.name +
        " (уровень " +
        entry.level +
        ") появляется на " +
        Grid.gridToLabel(combatant) +
        (adjusted ? " — ближайшая свободная клетка" : "") +
        " · HP " +
        combatant.maxHP +
        " · AC " +
        combatant.ac +
        " · инициатива " +
        combatant.initiative +
        ".",
      "system",
    );
  }

  /**
   * Phase 25: a catalog card dropped on the canvas. Monsters spawn at the
   * exact cell under the cursor (or the nearest free footprint); spells and
   * items are added to a friendly token standing on that cell.
   */
  function handleBattlefieldDrop(metadata, cell, token) {
    if (!metadata || metadata.type !== "compendium-item" || !metadata.entry) {
      return;
    }
    const category = metadata.category;
    const entry = metadata.entry;

    if (category === "monsters") {
      spawnCompendiumMonster(entry, { position: cell });
      return;
    }

    if (category !== "spells" && category !== "weapons" && category !== "shields") {
      return;
    }

    const target = token && token.isDefeated !== true ? token : null;
    if (!target) {
      log.add(
        "[DROP] На клетке " +
          Grid.gridToLabel(cell) +
          " нет бойца — " +
          entry.name +
          " не добавлен.",
        "warn",
      );
      return;
    }
    if (allianceOf(target) !== "player") {
      log.add(
        "[DROP] " +
          entry.name +
          " можно добавить только дружественному бойцу; " +
          target.name +
          " — противник.",
        "warn",
      );
      return;
    }

    if (category === "spells") {
      addCompendiumSpell(target, entry, { source: "drop" });
    } else {
      addCompendiumItemToInventory(target, entry);
    }
  }

  /**
   * Phase 25: the floating character sheet accepts the same payload.
   */
  function handleCharacterSheetDrop(combatant, metadata) {
    if (!combatant || !metadata || metadata.type !== "compendium-item") {
      return;
    }
    const category = metadata.category;
    const entry = metadata.entry;
    if (category === "spells") {
      addCompendiumSpell(combatant, entry, { source: "drop" });
      return;
    }
    if (category === "weapons" || category === "shields") {
      addCompendiumItemToInventory(combatant, entry);
      return;
    }
    if (category === "monsters") {
      log.add(
        "[DROP] Монстров нельзя добавить в лист персонажа — перетащите карточку на поле боя.",
        "warn",
      );
    }
  }

  /**
   * Phase 25: ✖ in the character sheet. Release a held item first, then let
   * the Combatant remove it from the inventory.
   */
  function removeSheetItem(combatant, item) {
    if (!combatant || !item) {
      return false;
    }
    if (
      typeof combatant.isItemHeld === "function" &&
      combatant.isItemHeld(item) &&
      typeof combatant.unequipItem === "function"
    ) {
      combatant.unequipItem(item);
    }
    const removed =
      typeof combatant.removeInventoryItem === "function"
        ? combatant.removeInventoryItem(item)
        : false;
    if (!removed) {
      log.add("Не удалось удалить " + (item.name || item.id) + " из инвентаря.", "warn");
      return false;
    }
    log.add(
      "[SHEET] " +
        (item.name || item.id) +
        " удалён из инвентаря " +
        combatant.name +
        ".",
      "system",
    );
    handleSheetMutation();
    return true;
  }

  if (View.CompendiumBrowser) {
    compendiumBrowser = new View.CompendiumBrowser({
      root: document.querySelector("[data-compendium-root]"),
      dataBasePath: "data/compendiums/",
      getRecipients: compendiumRecipients,
      getPreferredRecipient: compendiumPreferredRecipient,
      onEquipItem: equipCompendiumItem,
      onAddSpell: addCompendiumSpell,
      onSpawnMonster: spawnCompendiumMonster,
      onLog: function (message, kind) {
        log.add(message, kind || "info");
      },
      onStateChanged: function () {
        handleSheetMutation();
      },
    });
  }

  function advanceTurn() {
    if (COMBATANTS.length === 0) {
      log.add("The battlefield is empty — no turn to advance.", "muted");
      return;
    }
    const turn = encounter.nextTurn();
    flushEventLog();

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
    // Round/turn lines are emitted by the event bus (round:started /
    // turn:changed) so the log, round badge, and active row stay in sync.

    suppressSelectionLog = true;
    battlefield.setActiveCombatant(turn.active.id);
    renderInitiative();
    updateTokenCards();
    battlefield.selectCombatant(turn.active.id);
    suppressSelectionLog = false;
    updateHoverStatus(null);
    populateSpellPicker();
    updateSpellUi();
    updateHazardUi();
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
    flushEventLog();
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
      // [REACTION] is emitted by the bus; keep the per-attack audit here.
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
      flushEventLog();
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

  // ---------------------------------------------------------- Phase 20 HUD

  function findSpellById(id) {
    const active = encounter.activeCombatant;
    if (!active || !Array.isArray(active.spells)) {
      return null;
    }
    return (
      active.spells.find(function (spell) {
        return spell.id === id;
      }) || null
    );
  }

  function spellSubtitle(spell) {
    const kind = spell.type === "attack" ? "Attack" : "Save";
    const area = spell.area ? " · " + spell.area.type : "";
    return (
      spell.name +
      " · " +
      spell.cost +
      " action" +
      (spell.cost === 1 ? "" : "s") +
      " · " +
      kind +
      area
    );
  }

  function populateSpellPicker() {
    if (!spellSelectEl) {
      return;
    }
    const active = encounter.activeCombatant;
    const spells = active && Array.isArray(active.spells) ? active.spells : [];
    const previous = spellSelectEl.value;
    spellSelectEl.replaceChildren();

    if (spells.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = active ? active.name + " has no spells" : "No active combatant";
      spellSelectEl.append(option);
      spellSelectEl.disabled = true;
      return;
    }

    spellSelectEl.disabled = false;
    for (const spell of spells) {
      const option = document.createElement("option");
      option.value = spell.id;
      option.textContent = spellSubtitle(spell);
      spellSelectEl.append(option);
    }
    if (previous && spells.some(function (spell) { return spell.id === previous; })) {
      spellSelectEl.value = previous;
    }
  }

  function activeSustainedSpells(combatant) {
    return combatant && typeof combatant.getActiveSustainedSpells === "function"
      ? combatant.getActiveSustainedSpells()
      : [];
  }

  function updateSpellUi() {
    const active = encounter.activeCombatant;
    const hasActions = Boolean(active && active.actionsRemaining >= 1);
    const canAct = Boolean(
      active &&
        active.isDefeated !== true &&
        (typeof active.canAct !== "function" || active.canAct().ok),
    );

    if (castSpellButton) {
      castSpellButton.disabled =
        !canAct || !hasActions || !spellSelectEl || !spellSelectEl.value;
    }
    if (sustainButton) {
      const sustained = activeSustainedSpells(active);
      sustainButton.disabled = !canAct || !hasActions || sustained.length === 0;
      sustainButton.textContent =
        sustained.length > 0
          ? "Sustain (" + (sustained[0].spell ? sustained[0].spell.name : "spell") + ")"
          : "Sustain";
    }
    if (seekButton) {
      seekButton.disabled = !canAct || !hasActions;
    }
    if (hideButton) {
      hideButton.disabled = !canAct || !hasActions;
    }
    if (sneakButton) {
      const hidden = Boolean(
        canAct &&
          active &&
          typeof active.hasCondition === "function" &&
          (active.hasCondition("hidden") || active.hasCondition("undetected")),
      );
      sneakButton.disabled = !hidden || !hasActions;
    }
    if (disableHazardButton) {
      const nearest = nearestArmedHazard(active);
      const hasTwoActions =
        Boolean(active) &&
        (typeof active.canSpendActions === "function"
          ? active.canSpendActions(2)
          : active.actionsRemaining >= 2);
      disableHazardButton.disabled = !canAct || !nearest || !hasTwoActions;
      disableHazardButton.title = nearest
        ? "Disable " +
          nearest.hazard.name +
          " · " +
          nearest.distanceFeet +
          " ft · " +
          nearest.hazard.disableSkill +
          " DC " +
          nearest.hazard.disableDC +
          " · 2 actions"
        : "No armed hazard remains.";
    }
  }

  function nearestArmedHazard(combatant) {
    if (!combatant || !Number.isInteger(combatant.x)) {
      return null;
    }
    let best = null;
    for (const hazard of HAZARDS) {
      if (!hazard || hazard.isArmed !== true) {
        continue;
      }
      let distance = Infinity;
      const area = Array.isArray(hazard.triggerArea) && hazard.triggerArea.length > 0
        ? hazard.triggerArea
        : [{ x: combatant.x, y: combatant.y }];
      for (const cell of area) {
        const value = Grid.getCombatantDistance(combatant, cell);
        if (value < distance) {
          distance = value;
        }
      }
      if (!best || distance < best.distanceFeet) {
        best = { hazard: hazard, distanceFeet: distance };
      }
    }
    return best;
  }

  function updateHazardUi() {
    if (!hazardStatusEl) {
      return;
    }
    if (HAZARDS.length === 0) {
      hazardStatusEl.textContent = "No hazards on this battlefield.";
      return;
    }
    hazardStatusEl.textContent = HAZARDS.map(function (hazard) {
      return (
        hazard.name +
        " — " +
        (hazard.isArmed === true ? "armed" : "disarmed") +
        " · HP " +
        hazard.hp +
        "/" +
        hazard.maxHP
      );
    }).join(" · ");
  }

  function useRollInitiative() {
    if (COMBATANTS.length === 0) {
      log.add("No combatants on the battlefield to roll initiative for.", "warn");
      return;
    }
    const report = encounter.rollInitiative({ rollD20: rollD20 });
    for (const entry of report.entries) {
      log.add(
        "[INITIATIVE] " +
          entry.combatantName +
          ": d20(" +
          entry.d20 +
          ") " +
          signed(entry.modifier) +
          " = " +
          entry.total +
          " (" +
          entry.statistic +
          ").",
        "info",
      );
    }
    flushEventLog();

    const active = report.active;
    suppressSelectionLog = true;
    battlefield.setActiveCombatant(active ? active.id : null);
    renderInitiative();
    updateTokenCards();
    if (active) {
      battlefield.selectCombatant(active.id);
    } else {
      battlefield.clearSelection();
    }
    suppressSelectionLog = false;
    updateHoverStatus(null);
    populateSpellPicker();
    updateSpellUi();
    updateHazardUi();

    log.add(
      "[INITIATIVE] Order: " +
        report.order
          .map(function (combatant) {
            return combatant.name + " " + combatant.initiative;
          })
          .join(" → ") +
        ".",
      "system",
    );
  }

  function castFailureText(result) {
    switch (result.reason) {
      case CastSpell.CAST_SPELL_REASONS.NO_ACTIONS:
        return "not enough actions";
      case CastSpell.CAST_SPELL_REASONS.NO_SPELL_SLOTS:
        return "no spell slot of that rank remains";
      case CastSpell.CAST_SPELL_REASONS.NO_FOCUS_POINTS:
        return "no Focus Points remain";
      case CastSpell.CAST_SPELL_REASONS.INVALID_TARGET:
        return "select a valid hostile target";
      case CastSpell.CAST_SPELL_REASONS.INVALID_AREA:
        return "place a valid area template";
      case CastSpell.CAST_SPELL_REASONS.DISRUPTED:
        return "disrupted by a Reactive Strike";
      case CastSpell.CAST_SPELL_REASONS.UNCONSCIOUS:
        return "unconscious";
      case CastSpell.CAST_SPELL_REASONS.DEFEATED:
        return "defeated";
      default:
        return result.reason || "unknown reason";
    }
  }

  function logCastResolution(caster, spell, result) {
    if (result.reactionStrikes && result.reactionStrikes.length > 0) {
      flushEventLog();
    }

    if (result.type === "attack") {
      const targetResult = result.results[0];
      let line =
        "[SPELL] " +
        caster.name +
        " casts " +
        spell.name +
        " at " +
        (targetResult ? targetResult.targetName : "target") +
        ": ";
      if (targetResult && targetResult.automaticMiss) {
        line += "Flat Check FAILED — the spell misses. Action spent.";
      } else if (targetResult) {
        line +=
          "d20(" +
          targetResult.attackRoll +
          ") " +
          signed(targetResult.attackBonus) +
          " vs AC " +
          targetResult.targetAC +
          " -> " +
          degreeLabel(targetResult.degree) +
          (targetResult.hit ? "." : " — no damage.");
      }
      log.add(line, "spell");
    } else {
      log.add(
        "[SPELL] " +
          caster.name +
          " casts " +
          spell.name +
          " · " +
          (result.area ? result.area.type : "save") +
          " · " +
          (result.area ? result.area.cells.length + " cells" : "single target") +
          " · " +
          capitalize(result.saveType || "save") +
          " DC " +
          result.spellDC +
          " · " +
          result.results.length +
          " target(s).",
        "spell",
      );
      for (const entry of result.results) {
        log.add(
          "[SAVE] " +
            entry.targetName +
            ": d20(" +
            entry.d20 +
            ") " +
            signed(entry.saveModifier) +
            " = " +
            entry.saveTotal +
            " vs DC " +
            entry.saveDC +
            " -> " +
            degreeLabel(entry.degree) +
            " (" +
            Math.round(entry.damageMultiplier * 100) +
            "% damage).",
          "info",
        );
      }
    }

    if (result.resourceCost) {
      const cost = result.resourceCost;
      if (cost.type === "slot") {
        log.add(
          "[SPELL] Spell slot spent: rank " +
            cost.rank +
            " (" +
            cost.remaining +
            " remaining).",
          "info",
        );
      } else if (cost.type === "focus") {
        log.add(
          "[SPELL] Focus Point spent (" + cost.remaining + " remaining).",
          "info",
        );
      }
    }
    if (result.sustainedSpell) {
      log.add(
        "[SPELL] " +
          spell.name +
          " is sustained until the end of round " +
          result.sustainedSpell.expiresAtRound +
          ".",
        "info",
      );
    }
  }

  function useCastSpell(caster, spell, cell, token) {
    const options = {
      caster: caster,
      spell: spell,
      map: map,
      combatants: COMBATANTS,
      allies: COMBATANTS,
      encounter: encounter,
      rollD20: rollD20,
      rollDamageDie: rollDamageDie,
      rollDie: rollDie,
    };

    if (spell.type === "attack") {
      options.target = token || null;
    } else {
      options.target = token || null;
      const areaType = spell.area ? String(spell.area.type || "burst").toLowerCase() : "burst";
      options.origin =
        areaType === "emanation"
          ? { x: caster.x, y: caster.y }
          : { x: cell.x, y: cell.y };
      if (areaType === "cone" || areaType === "line") {
        options.direction = { x: cell.x - caster.x, y: cell.y - caster.y };
      }
    }

    const result = CastSpell.performCastSpell(options);
    if (!result.ok) {
      log.add(
        "Cast canceled — " + capitalize(spell.name) + ": " + castFailureText(result) + ".",
        "warn",
      );
      return;
    }

    logCastResolution(caster, spell, result);
    flushEventLog();
    battlefield.refresh();
    updateTokenCards();
    renderSelection(caster, battlefield.getReachableCells());
    updateSpellUi();
  }

  function useSustainSpell() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can Sustain a Spell.", "warn");
      return;
    }
    const sustained = activeSustainedSpells(active);
    if (sustained.length === 0) {
      log.add("Sustain canceled — " + active.name + " has no sustained spell.", "warn");
      return;
    }
    const result = SustainSpell.performSustainSpell({
      caster: active,
      activeSpellId: sustained[0].id,
      encounter: encounter,
    });
    if (!result.ok) {
      log.add("Sustain canceled — " + (result.reason || "not possible") + ".", "warn");
      return;
    }
    const spellName = sustained[0].spell ? sustained[0].spell.name : "the spell";
    log.add(
      "[SPELL] " +
        active.name +
        " sustains " +
        spellName +
        " until the end of round " +
        result.expiresAtRound +
        ". Actions left: " +
        result.actionsLeft +
        ".",
      "spell",
    );
    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
    updateSpellUi();
  }

  function useSeek() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can Seek.", "warn");
      return;
    }
    const result = Stealth.performSeek({
      seeker: active,
      areaType: "burst",
      radiusFeet: 30,
      origin: { x: active.x, y: active.y },
      combatants: COMBATANTS,
      map: map,
      rollD20: rollD20,
    });
    if (!result.ok) {
      log.add("Seek canceled — " + (result.reason || "not possible") + ".", "warn");
      return;
    }
    log.add(
      "[SEEK] " +
        active.name +
        " scans a 30-ft burst" +
        (result.check
          ? ": Perception d20(" +
            result.check.d20 +
            ") " +
            signed(result.check.modifier) +
            " = " +
            result.check.total
          : " and finds nothing") +
        ".",
      "info",
    );
    for (const target of result.targets || []) {
      log.add(
        "[SEEK] " +
          target.targetName +
          ": " +
          degreeLabel(target.degree) +
          " — " +
          (target.revealed ? "observed" : target.previousVisibility + " -> " + target.visibility) +
          ".",
        "info",
      );
    }
    flushEventLog();
    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
  }

  function useHide() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can Hide.", "warn");
      return;
    }
    const result = Stealth.performHide({
      combatant: active,
      observers: COMBATANTS.filter(function (candidate) {
        return candidate.id !== active.id && candidate.isDefeated !== true;
      }),
      map: map,
      rollD20: rollD20,
    });
    if (!result.ok) {
      log.add(
        "Hide canceled — " +
          (result.reason === Stealth.REASONS.NO_COVER_OR_CONCEALMENT
            ? "no cover or concealment from an observer"
            : result.reason || "not possible") +
          ".",
        "warn",
      );
      return;
    }
    log.add(
      "[HIDE] " +
        active.name +
        " rolls Stealth d20(" +
        (result.check ? result.check.d20 : "?") +
        ") " +
        signed(result.stealth ? result.stealth.total : 0) +
        " vs Perception DC " +
        (result.perception ? result.perception.dc : "?") +
        " -> " +
        degreeLabel(result.check ? result.check.degree : null) +
        (result.succeeded ? " — Hidden." : " — observed."),
      "info",
    );
    flushEventLog();
    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
    updateSpellUi();
  }

  function useSneak(combatant, cell) {
    const result = Stealth.performSneak({
      combatant: combatant,
      destination: cell,
      observers: COMBATANTS.filter(function (candidate) {
        return candidate.id !== combatant.id && candidate.isDefeated !== true;
      }),
      map: map,
      rollD20: rollD20,
    });
    if (!result.ok) {
      log.add("Sneak canceled — " + (result.reason || "not possible") + ".", "warn");
      return;
    }

    log.add(
      "[SNEAK] " +
        combatant.name +
        " moves to " +
        Grid.gridToLabel(result.position || result.destination) +
        " · " +
        result.costFeet +
        "/" +
        result.maxFeet +
        " ft" +
        (result.check
          ? " · Stealth d20(" +
            result.check.d20 +
            ") " +
            signed(result.check.modifier) +
            " = " +
            result.check.total +
            " vs DC " +
            result.perceptionDC +
            " -> " +
            degreeLabel(result.degree)
          : "") +
        (result.keptHidden ? " — stays Hidden." : " — becomes observed."),
      "info",
    );

    if (result.moved && typeof combatant.emitEvent === "function") {
      combatant.emitEvent("combatant:moved", {
        movementType: "sneak",
        path: result.path,
        costFeet: result.costFeet,
        actionsSpent: 1,
        actionsLeft: result.actionsLeft,
        from: result.path && result.path.length > 0 ? result.path[0] : null,
        to: result.position || result.destination,
        interrupted: false,
        destinationReached: true,
      });
    }
    flushEventLog();
    battlefield.refresh();
    updateTokenCards();
    renderSelection(combatant, battlefield.getReachableCells());
    updateSpellUi();
  }

  function useDisableHazard() {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can disable a hazard.", "warn");
      return;
    }
    const nearest = nearestArmedHazard(active);
    if (!nearest) {
      log.add("No armed hazard remains on the battlefield.", "warn");
      return;
    }
    if (nearest.distanceFeet > 10) {
      log.add(
        nearest.hazard.name + " is " + nearest.distanceFeet + " ft away — move within 10 ft first.",
        "warn",
      );
      return;
    }

    const result = DisableHazard.performDisableHazard({
      combatant: active,
      hazard: nearest.hazard,
      rollD20: rollD20,
    });
    if (!result.ok) {
      log.add(
        "Disable canceled — " +
          (result.reason === DisableHazard.DISABLE_HAZARD_REASONS.NO_ACTIONS
            ? "Disable a Device costs 2 actions"
            : result.reason || "not possible") +
          ".",
        "warn",
      );
      return;
    }

    log.add(
      "[HAZARD] " +
        active.name +
        " attempts to disable " +
        nearest.hazard.name +
        " (" +
        result.skill +
        "): d20(" +
        result.attackRoll +
        ") " +
        signed(result.totalModifier) +
        " = " +
        result.total +
        " vs DC " +
        result.disableDC +
        " -> " +
        degreeLabel(result.degree) +
        (result.disarmed ? " — disarmed." : result.triggeredReaction ? " — the trap fires!" : " — no effect."),
      "hazard",
    );
    flushEventLog();
    updateHazardUi();
    battlefield.refresh();
    updateTokenCards();
    renderSelection(active, battlefield.getReachableCells());
    updateSpellUi();
  }

  function summarizeAiAction(action) {
    switch (action.type) {
      case TacticalAI.ACTION_TYPES.STAND:
        return "stands up";
      case TacticalAI.ACTION_TYPES.STRIDE:
      case TacticalAI.ACTION_TYPES.STEP:
        return (
          action.type +
          " to " +
          Grid.gridToLabel(action.destination) +
          (action.costFeet ? " · " + action.costFeet + " ft" : "") +
          (action.reactions && action.reactions.length > 0
            ? " · " + action.reactions.length + " reaction(s)"
            : "")
        );
      case TacticalAI.ACTION_TYPES.STRIKE:
        return (
          "Strikes " +
          action.targetName +
          " (MAP " +
          (action.mapPenalty === null ? "?" : action.mapPenalty) +
          ")" +
          (action.hit
            ? action.critical
              ? " — CRITICAL, " + action.damageDealt + " damage"
              : " — hit, " + action.damageDealt + " damage"
            : " — miss") +
          (action.targetDefeated ? " (defeated)" : "")
        );
      case TacticalAI.ACTION_TYPES.RAISE_SHIELD:
        return "raises a shield";
      case TacticalAI.ACTION_TYPES.TAKE_COVER:
        return "takes cover";
      default:
        return action.type;
    }
  }

  function useAiTurn(maxActions) {
    const active = encounter.activeCombatant;
    if (!active || active.isDefeated === true) {
      log.add("No active combatant can take an AI turn.", "warn");
      return;
    }

    const result = TacticalAI.executeAITurn({
      combatant: active,
      map: map,
      combatants: COMBATANTS,
      encounter: encounter,
      rollD20: rollD20,
      rollDamageDie: rollDamageDie,
      maxActions: maxActions,
    });

    log.add(
      "[AI] " +
        active.name +
        (maxActions === 1 ? " — AI Step" : " — AI Turn") +
        ": " +
        result.executedActions.length +
        " action(s), " +
        result.actionsRemaining +
        " remaining.",
      "system",
    );
    for (const action of result.executedActions) {
      log.add(
        "[AI] " +
          active.name +
          " " +
          summarizeAiAction(action) +
          (action.ok ? "." : " — " + (action.reason || "failed") + "."),
        action.ok ? "info" : "warn",
      );
    }
    if (result.executedActions.length === 0) {
      log.add("[AI] No legal action found (" + (result.reason || "none") + ").", "warn");
    }

    flushEventLog();
    battlefield.refresh();
    updateTokenCards();
    if (encounter.activeCombatant) {
      renderSelection(encounter.activeCombatant, battlefield.getReachableCells());
    }
    updateSpellUi();
    updateHazardUi();
  }

  function saveCombatState() {
    try {
      const state = Serializer.serializeCombatState({
        encounter: encounter,
        map: map,
        combatants: COMBATANTS,
        hazards: HAZARDS,
      });
      const json = JSON.stringify(state);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("pf2e.combatState", json);
      }
      log.add(
        "[SAVE] Combat state saved (" +
          COMBATANTS.length +
          " combatants, " +
          HAZARDS.length +
          " hazards, " +
          json.length +
          " bytes).",
        "system",
      );
    } catch (error) {
      log.add("[SAVE] Failed to save combat state: " + error.message, "warn");
    }
  }

  function loadCombatState() {
    try {
      if (typeof localStorage === "undefined") {
        throw new Error("localStorage is unavailable.");
      }
      const json = localStorage.getItem("pf2e.combatState");
      if (!json) {
        log.add("[LOAD] No saved combat state found in localStorage.", "warn");
        return;
      }

      const restored = Serializer.deserializeCombatState(json, {
        eventBus: EVENT_BUS,
      });
      if (tokenHud) {
        tokenHud.close();
      }
      if (characterSheet) {
        characterSheet.close();
      }
      clearTokenHighlight();
      encounter = restored.encounter;
      map = restored.map;
      COMBATANTS = restored.combatants;
      HAZARDS = Array.isArray(restored.hazards) ? restored.hazards : [];
      for (const hazard of HAZARDS) {
        if (typeof hazard.setEventBus === "function") {
          hazard.setEventBus(EVENT_BUS);
        }
      }
      if (typeof encounter.setEventBus === "function") {
        encounter.setEventBus(EVENT_BUS);
      }

      if (ruler) {
        ruler.deactivate({ silent: true });
      }
      if (templateTool) {
        templateTool.deactivate({ silent: true });
      }
      battlefield.setWorld(COMBATANTS, map);
      rebuildTokenCards();
      populateSpellPicker();

      const active = encounter.activeCombatant;
      suppressSelectionLog = true;
      battlefield.setActiveCombatant(active ? active.id : null);
      renderInitiative();
      updateTokenCards();
      if (active) {
        battlefield.selectCombatant(active.id);
      } else {
        battlefield.clearSelection();
      }
      suppressSelectionLog = false;
      updateModeUi();
      updateHoverStatus(null);
      updateHazardUi();

      log.add(
        "[LOAD] Combat restored: " +
          COMBATANTS.length +
          " combatants, round " +
          encounter.round +
          (active ? ", " + active.name + "'s turn" : "") +
          ".",
        "system",
      );
    } catch (error) {
      log.add("[LOAD] Failed to restore combat state: " + error.message, "warn");
    }
  }

  // Phase 22 — double-click any token to open its floating character sheet.
  // The first click still performs normal battlefield input; the dblclick
  // handler is an additional inspection affordance and never mutates rules.
  canvas.addEventListener("dblclick", function (event) {
    if (battlefield.getPaintTool() !== PAINT_TOOLS.SELECT) {
      return;
    }
    const point = battlefield.eventPoint(event);
    if (!point) {
      return;
    }
    const token = battlefield.findTokenAt(point.x, point.y);
    if (!token) {
      return;
    }
    event.preventDefault();
    openCharacterSheet(token.id);
  });

  // Any board click clears the read-only Actors highlight; a real selection
  // ring remains because it is driven by BattlefieldView.selectedCombatant.
  canvas.addEventListener("click", function () {
    clearTokenHighlight();
  });

  // Phase 24: Delete / Backspace removes the currently selected token. Typing
  // in a form control or a modal must never trigger it.
  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.repeat) {
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }
    if (confirmDialog.isOpen) {
      return;
    }
    const target = event.target;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable === true)
    ) {
      return;
    }
    const selected = battlefield.getSelectedCombatant();
    if (!selected) {
      return;
    }
    event.preventDefault();
    deleteCombatant(selected, { source: "hotkey" });
  });

  if (endTurnEl) {
    endTurnEl.addEventListener("click", advanceTurn);
  }

  if (rollInitiativeEl) {
    rollInitiativeEl.addEventListener("click", useRollInitiative);
  }

  if (castSpellButton) {
    castSpellButton.addEventListener("click", function () {
      selectCursorMode();
      const spell = findSpellById(spellSelectEl ? spellSelectEl.value : null);
      if (!spell) {
        log.add("Select a spell first.", "warn");
        return;
      }
      battlefield.setSpell(spell);
      updateModeUi();
      log.add("Spell prepared: " + spell.name + ". Hover the board to place its template.", "muted");
    });
  }

  if (spellSelectEl) {
    spellSelectEl.addEventListener("change", function () {
      updateSpellUi();
      if (battlefield.getMode() === MODES.CAST) {
        const spell = findSpellById(spellSelectEl.value);
        if (spell) {
          battlefield.setSpell(spell);
        }
      }
    });
  }

  if (sustainButton) {
    sustainButton.addEventListener("click", useSustainSpell);
  }
  if (seekButton) {
    seekButton.addEventListener("click", useSeek);
  }
  if (hideButton) {
    hideButton.addEventListener("click", useHide);
  }
  if (disableHazardButton) {
    disableHazardButton.addEventListener("click", useDisableHazard);
  }
  if (aiStepButton) {
    aiStepButton.addEventListener("click", function () {
      useAiTurn(1);
    });
  }
  if (aiTurnButton) {
    aiTurnButton.addEventListener("click", function () {
      useAiTurn(Infinity);
    });
  }
  if (saveCombatButton) {
    saveCombatButton.addEventListener("click", saveCombatState);
  }
  if (loadCombatButton) {
    loadCombatButton.addEventListener("click", loadCombatState);
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
      selectCursorMode();
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

  function rebuildTokenCards() {
    if (!tokenListEl) {
      return;
    }
    tokenListEl.replaceChildren();
    tokenCards.clear();

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
        const active = encounter.activeCombatant;
        if (active && active.id === combatant.id) {
          battlefield.selectCombatant(combatant.id);
          clearTokenHighlight();
          return;
        }
        highlightTokenOnMap(combatant.id);
        log.add(
          combatant.name +
            " highlighted on the map (inspect only — " +
            (active ? active.name + "'s turn" : "no active combatant") +
            ").",
          "muted",
        );
      });
      card.addEventListener("dblclick", function (event) {
        event.preventDefault();
        openCharacterSheet(combatant.id);
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
  }

  rebuildTokenCards();

  const demoGoblin = COMBATANTS.find(function (combatant) {
    return combatant.id === "goblin";
  });
  const demoMerisiel = COMBATANTS.find(function (combatant) {
    return combatant.id === "merisiel";
  });

  const firstActive = encounter.startEncounter();
  if (firstActive) {
    battlefield.setActiveCombatant(firstActive.id);
  }
  populateSpellPicker();
  updateModeUi();
  updateSpellUi();
  updateHazardUi();
  renderSelection(null, []);
  updateTokenCards();
  updateHoverStatus(null);
  flushEventLog();

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

  // Small debug/integration surface for the browser console and end-to-end
  // checks. Rules state remains owned by the live core objects.
  window.PF2e.App = {
    get encounter() {
      return encounter;
    },
    get map() {
      return map;
    },
    get combatants() {
      return COMBATANTS;
    },
    get hazards() {
      return HAZARDS;
    },
    battlefield: battlefield,
    tokenHud: tokenHud,
    sidebar: sidebar,
    characterSheet: characterSheet,
    compendiumBrowser: compendiumBrowser,
    sceneEditor: sceneEditor,
    hotbar: hotbar,
    ruler: ruler,
    templateTool: templateTool,
    applyMeasuredTemplate: applyMeasuredTemplate,
    templateSpellcasters: templateSpellcasters,
    templateSpellsFor: templateSpellsFor,
    applyScenePreset: applyScenePreset,
    clearBoard: clearBoard,
    deleteCombatant: deleteCombatant,
    paintTerrainCell: paintTerrainCell,
    openCharacterSheet: openCharacterSheet,
    spawnCompendiumMonster: spawnCompendiumMonster,
    dropCompendium: handleBattlefieldDrop,
    removeSheetItem: removeSheetItem,
    eventBus: EVENT_BUS,
    eventLog: eventLog,
    log: log,
    refreshUi: function () {
      updateTokenCards();
      updateModeUi();
      updateHoverStatus(null);
    },
  };
})();
