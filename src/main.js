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
  const Stride = window.PF2e.Core.Actions.Stride;
  const Step = window.PF2e.Core.Actions.Step;
  const Strike = window.PF2e.Core.Actions.Strike;
  const RaiseShield = window.PF2e.Core.Actions.RaiseShield;
  const Checks = window.PF2e.Core.Rules.Checks;
  const MultipleAttack = window.PF2e.Core.Rules.MultipleAttack;
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
      damage: "1d8+4",
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
      damage: "1d6+2",
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
      damage: "1d6+1",
      agile: true,
    }),
  ];

  // Authored demo condition: the goblin starts shaken so the condition badge,
  // modifier breakdown, and end-of-turn decay are visible immediately.
  const demoGoblin = COMBATANTS.find(function (combatant) {
    return combatant.id === "goblin";
  });
  if (demoGoblin) {
    demoGoblin.addCondition("frightened", 1);
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

  function formatMap(penalty) {
    return MultipleAttack.formatPenalty(penalty);
  }

  function modifierLabel(modifier) {
    if (modifier.source === "multiple-attack-penalty") {
      return "MAP";
    }
    return modifier.name + " [" + modifier.type + "]";
  }

  function formatAttackExpression(result) {
    let text = "d20(" + result.attackRoll + ") " + signed(result.attackBonus) + " (base)";
    const modifiers = result.attackModifiers || [];
    for (const modifier of modifiers) {
      text += " " + signed(modifier.value) + " (" + modifierLabel(modifier) + ")";
    }
    return text + " = " + result.total;
  }

  function formatACExpression(result) {
    const modifiers = result.targetACModifiers || [];
    if (modifiers.length === 0) {
      return "AC " + result.targetAC;
    }

    let text = "AC " + result.targetAC + " (" + result.baseTargetAC;
    for (const modifier of modifiers) {
      text +=
        " " +
        signed(modifier.value) +
        " " +
        modifier.name +
        " [" +
        modifier.type +
        "]";
    }
    return text + ")";
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
      const diceText =
        damage.diceCount > 0
          ? " [" +
            damage.rolls.join(" + ") +
            (damage.modifier === 0 ? "" : " " + signed(damage.modifier)) +
            "]"
          : "";
      line +=
        " Damage: " +
        result.damageDealt +
        diceText +
        (damage.doubled ? " (base " + damage.baseTotal + " × 2)" : "") +
        ". " +
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

  function renderConditionBadges(container, combatant) {
    if (!container) {
      return;
    }
    container.replaceChildren();
    const conditions =
      typeof combatant.getConditions === "function" ? combatant.getConditions() : [];
    container.classList.toggle("is-empty", conditions.length === 0);

    for (const condition of conditions) {
      const badge = document.createElement("span");
      badge.className = "condition-badge condition-" + condition.slug;
      badge.textContent = condition.label;
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
          : "Reachable";

    addStat("Token", combatant.name, colorOf(combatant));
    addStat("Alliance", allianceLabel(combatant));
    addStat("Initiative", String(combatant.initiative));
    addStat("HP", combatant.currentHP + " / " + combatant.maxHP);
    addStat("AC", String(combatant.ac));
    addStat(
      "Attack",
      signed(combatant.attackBonus) + " · " + combatant.damage + (combatant.agile ? " (agile)" : ""),
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
    if (combatant.isDefeated === true) {
      addStat("State", "Defeated");
    }
    addStat("Mode", mode.charAt(0).toUpperCase() + mode.slice(1));
    addStat(
      reachableLabel,
      mode === MODES.STRIKE
        ? battlefield.getStrikeTargets().length + " in reach"
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
    strikeButton.title =
      "Next attack: " +
      signed(active.attackBonus) +
      " " +
      formatMap(penalty) +
      " MAP · " +
      active.damage;
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
          "Strike costs 1 action, requires 5 ft reach and line of sight. Resolves d20 + attack bonus - MAP vs AC; a critical hit doubles damage.";
      } else {
        modeHintEl.textContent =
          "Stride moves up to Speed for 1 action. Difficult terrain adds 5 ft per square. Leaving a threatened square can provoke a Reactive Strike; Step never does.";
      }
    }
    updateStrikeButton();
    updateRaiseShieldButton();
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
    updateRaiseShieldButton();
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
          " ft · line of sight clear · 1 action" +
          (info.flanked ? " · FLANKED (Off-Guard -2 AC)" : "");
        statusEl.classList.add("is-valid");
        statusEl.dataset.state = "strike";
      } else {
        statusEl.textContent =
          "Cannot Strike " +
          info.target.name +
          " — " +
          describeStrikeFailure(info.reason, info) +
          ".";
        statusEl.classList.add("is-invalid");
        statusEl.dataset.state = info.reason;
      }
      return;
    }

    if (info.status === "strike-empty") {
      statusEl.textContent = "Select a hostile token within reach to Strike.";
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
            ? " (" + info.distanceFeet + " ft, reach 5 ft)"
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
          : cells.length + (mode === MODES.STEP ? " step targets" : " squares reachable");

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
        logAttackResolution(reactor, combatant, reaction);
        log.add(
          reaction.attackerName +
            " reaction spent · Reactions left: " +
            reaction.reactionsLeft +
            "/" +
            reactor.maxReactions +
            ".",
          "info",
        );
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
      const result = Step.performStep({
        combatant: combatant,
        map: map,
        destination: cell,
        diagonalCornerPolicy: CORNER_POLICY,
        occupancy: getOccupancy(combatant),
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

    if (turn.previous && turn.previous.isDefeated === true) {
      log.add(
        turn.previous.name + " is defeated and is skipped in the initiative order.",
        "info",
      );
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

  if (endTurnEl) {
    endTurnEl.addEventListener("click", advanceTurn);
  }

  if (raiseShieldButton) {
    raiseShieldButton.addEventListener("click", useRaiseShield);
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
    if (demoGoblin && demoGoblin.hasCondition("frightened")) {
      log.add(
        "Goblin begins Frightened 1: -1 status to its checks and AC until the end of its turn.",
        "system",
      );
    }
    battlefield.selectCombatant(firstActive.id);
  } else {
    log.add("No living combatants remain — the encounter is over.", "system");
  }
})();
