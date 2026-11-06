/**
 * PF2E REMASTERED — EVENT LOG BRIDGE (VIEW)
 *
 * Translates CombatEventBus payloads into readable combat-log lines and keeps
 * the round badge / initiative highlight in sync. Presentation stays entirely
 * outside the rules core: the bridge only subscribes, never writes to state.
 *
 * The bridge also exposes `suppress(type)` so a caller that already prints a
 * richer synchronous line (for example the Strike resolution breakdown) can
 * avoid a duplicate event line for that one action. Suppression is scoped and
 * always released through the returned callback.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};

  const EVENT_TYPES = Object.freeze({
    COMBATANT_DAMAGED: "combatant:damaged",
    COMBATANT_MOVED: "combatant:moved",
    CONDITION_ADDED: "condition:added",
    CONDITION_REMOVED: "condition:removed",
    HAZARD_TRIGGERED: "hazard:triggered",
    HAZARD_DISABLED: "hazard:disabled",
    TURN_CHANGED: "turn:changed",
    ROUND_STARTED: "round:started",
    REACTION_TRIGGERED: "reaction:triggered",
  });

  function gridLabel(cell) {
    const Grid = NS.Core && NS.Core.Grid;
    if (!cell || !Grid || typeof Grid.gridToLabel !== "function") {
      return cell && Number.isInteger(cell.x)
        ? "(" + cell.x + "," + cell.y + ")"
        : "?";
    }
    return Grid.gridToLabel(cell);
  }

  function signed(value) {
    return value >= 0 ? "+" + value : String(value);
  }

  function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function conditionLabel(condition, fallbackName, value) {
    if (condition && typeof condition.label === "string") {
      return condition.label;
    }
    const name = capitalize(condition && condition.name ? condition.name : fallbackName);
    const rawValue = condition && condition.value !== undefined
      ? condition.value
      : value;
    return rawValue === null || rawValue === undefined || rawValue === ""
      ? name
      : name + " " + rawValue;
  }

  /** Expand an IWR audit into `6 -> Weakness +2 -> 8 -> Resistance 2 -> 6`. */
  function formatIWRChain(iwr) {
    if (!iwr || !Array.isArray(iwr.breakdown) || iwr.breakdown.length === 0) {
      return null;
    }

    return iwr.breakdown
      .map(function (entry) {
        let text = String(entry.amount) + " " + entry.type;
        if (entry.immune) {
          return text + " -> IMMUNE -> 0";
        }
        for (const step of entry.steps || []) {
          if (step.kind === "weakness") {
            text += " -> Weakness +" + step.value;
          } else if (step.kind === "resistance") {
            text += " -> Resistance -" + step.amount;
          }
        }
        return text + " -> " + entry.finalAmount;
      })
      .join("; ");
  }

  function shieldBlockText(block) {
    if (!block || block.ok !== true) {
      return "";
    }
    let text =
      " Shield Block: Hardness " +
      block.absorbedByHardness +
      " absorbed, shield took " +
      block.damageToShield +
      " (HP " +
      block.shieldHpBefore +
      " -> " +
      block.shieldHpAfter +
      ")";
    if (block.shieldJustBroken) {
      text += " and is now Broken";
    }
    if (block.shieldJustDestroyed) {
      text += " and is now Destroyed";
    }
    return text + ".";
  }

  class EventLogBridge {
    constructor(options) {
      const opts = options || {};
      if (!opts.bus || typeof opts.bus.on !== "function") {
        throw new Error("EventLogBridge requires a CombatEventBus.");
      }
      if (!opts.log || typeof opts.log.add !== "function") {
        throw new Error("EventLogBridge requires a CombatLog.");
      }

      this.bus = opts.bus;
      this.log = opts.log;
      this.getCombatant =
        typeof opts.getCombatant === "function"
          ? opts.getCombatant
          : function () {
              return null;
            };
      this.roundIndicator =
        opts.roundIndicator === undefined ? null : opts.roundIndicator;
      this.initiativeContainer =
        opts.initiativeContainer === undefined ? null : opts.initiativeContainer;
      this.onTurnChanged =
        typeof opts.onTurnChanged === "function" ? opts.onTurnChanged : null;
      this.onRoundStarted =
        typeof opts.onRoundStarted === "function" ? opts.onRoundStarted : null;

      this.suppressed = new Set();
      this.unsubscribers = [];
      this.destroyed = false;
      // Damage is queued so the attack-roll line printed by the action host
      // appears before the damage result that the core emitted mid-action.
      this.pendingLines = [];
      this.flushScheduled = false;

      this.bind(EVENT_TYPES.COMBATANT_DAMAGED, this.handleDamage);
      this.bind(EVENT_TYPES.COMBATANT_MOVED, this.handleMove);
      this.bind(EVENT_TYPES.CONDITION_ADDED, this.handleConditionAdded);
      this.bind(EVENT_TYPES.CONDITION_REMOVED, this.handleConditionRemoved);
      this.bind(EVENT_TYPES.REACTION_TRIGGERED, this.handleReaction);
      this.bind(EVENT_TYPES.HAZARD_TRIGGERED, this.handleHazardTriggered);
      this.bind(EVENT_TYPES.HAZARD_DISABLED, this.handleHazardDisabled);
      this.bind(EVENT_TYPES.TURN_CHANGED, this.handleTurnChanged);
      this.bind(EVENT_TYPES.ROUND_STARTED, this.handleRoundStarted);
    }

    bind(eventType, handler) {
      const method = handler.bind(this);
      this.unsubscribers.push(this.bus.on(eventType, method));
    }

    /**
     * Silently skip events of `eventType` until the returned callback runs.
     *
     * @param {string} eventType
     * @returns {() => void}
     */
    suppress(eventType) {
      this.suppressed.add(eventType);
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        this.suppressed.delete(eventType);
      };
    }

    isSuppressed(eventType) {
      return this.suppressed.has(eventType);
    }

    emitLine(eventType, message, kind) {
      if (this.isSuppressed(eventType)) {
        return null;
      }
      return this.log.add(message, kind);
    }

    handleDamage(payload) {
      const data = payload || {};
      const applied =
        data.actorDamageApplied === undefined || data.actorDamageApplied === null
          ? data.damageApplied === undefined || data.damageApplied === null
            ? data.damageTaken || 0
            : data.damageApplied
          : data.actorDamageApplied;
      const hpBefore =
        Number.isInteger(data.currentHP) && Number.isInteger(applied)
          ? Math.min(
              Number.isInteger(data.maxHP) ? data.maxHP : Infinity,
              data.currentHP + applied,
            )
          : null;
      const chain = formatIWRChain(data.iwr);
      const persistent = data.source === "persistent";

      let line = persistent ? "[PERSISTENT DAMAGE] " : "[DAMAGE] ";
      line +=
        (data.combatantName || data.combatantId || "Combatant") +
        " takes " +
        applied +
        " " +
        (data.damageType || "untyped") +
        " damage";
      if (chain) {
        line += " (" + chain + ")";
      }
      line += ".";
      line += shieldBlockText(data.shieldBlock);
      if (hpBefore !== null) {
        line +=
          " HP " +
          hpBefore +
          " -> " +
          data.currentHP +
          (data.isDefeated ? " (Defeated)" : "") +
          ".";
      }
      if (this.isSuppressed(EVENT_TYPES.COMBATANT_DAMAGED)) {
        return;
      }
      this.queueLine(line, persistent ? "persistent" : "damage");
    }

    queueLine(message, kind) {
      if (this.destroyed) {
        return;
      }
      this.pendingLines.push({ message: message, kind: kind });
      this.scheduleFlush();
    }

    scheduleFlush() {
      if (this.flushScheduled) {
        return;
      }
      this.flushScheduled = true;
      const flush = this.flush.bind(this);
      // A macrotask, not a microtask: the synchronous action host gets to
      // print its roll/save summary before the queued damage lines.
      if (typeof setTimeout === "function") {
        setTimeout(flush, 0);
      }
    }

    /** Flush queued damage/turn lines in core emission order. */
    flush() {
      this.flushScheduled = false;
      if (this.pendingLines.length === 0) {
        return;
      }
      const pending = this.pendingLines;
      this.pendingLines = [];
      for (const entry of pending) {
        this.log.add(entry.message, entry.kind);
      }
    }

    handleMove(payload) {
      const data = payload || {};
      const movement =
        data.movementType === "step"
          ? "Step"
          : data.movementType === "sneak"
            ? "Sneak"
            : "Stride";
      const from = gridLabel(data.from);
      const to = gridLabel(data.to);
      const squares = Number.isFinite(data.costFeet) ? Math.round(data.costFeet / 5) : null;

      let line =
        "[MOVE] " +
        (data.combatantName || data.combatantId || "Combatant") +
        " uses " +
        movement +
        ". " +
        (data.costFeet || 0) +
        " ft";
      if (squares !== null) {
        line += " (" + squares + " square" + (squares === 1 ? "" : "s") + ")";
      }
      line += ", " + from + " -> " + to + ".";
      if (data.interrupted) {
        line += " Movement interrupted.";
      }
      line +=
        " Actions left: " +
        (data.actionsLeft === undefined ? "?" : data.actionsLeft) +
        ".";
      this.emitLine(
        EVENT_TYPES.COMBATANT_MOVED,
        line,
        movement === "Step" ? "step" : movement === "Sneak" ? "condition" : "move",
      );
    }

    handleConditionAdded(payload) {
      const data = payload || {};
      const label = conditionLabel(data.condition, data.name, data.value);
      this.emitLine(
        EVENT_TYPES.CONDITION_ADDED,
        "[CONDITION] " +
          (data.combatantName || data.combatantId || "Combatant") +
          (data.refreshed ? " refreshes " : " gains ") +
          label +
          ".",
        "condition",
      );
    }

    handleConditionRemoved(payload) {
      const data = payload || {};
      const label = conditionLabel(data.condition, data.name, data.value);
      this.emitLine(
        EVENT_TYPES.CONDITION_REMOVED,
        "[CONDITION] " +
          (data.combatantName || data.combatantId || "Combatant") +
          " loses " +
          label +
          ".",
        "condition",
      );
    }

    handleReaction(payload) {
      const data = payload || {};
      const actor = data.combatantName || data.combatantId || "Combatant";
      const type = data.reactionType || "reaction";
      let text;

      if (type === "shield-block") {
        text =
          "[REACTION] " +
          actor +
          " uses Shield Block: Hardness " +
          (data.absorbedByHardness === undefined ? "?" : data.absorbedByHardness) +
          " absorbs damage; " +
          (data.damageToActor === undefined ? "?" : data.damageToActor) +
          " reaches " +
          actor +
          ".";
      } else if (type === "reactive-strike") {
        text =
          "[REACTION] " +
          actor +
          " uses Reactive Strike against " +
          (data.targetName || data.targetId || "the mover") +
          " (" +
          (data.trigger || "leave-threatened-square") +
          ").";
      } else {
        text = "[REACTION] " + actor + " uses " + capitalize(type) + ".";
      }

      text +=
        " Reactions left: " +
        (data.reactionsLeft === undefined ? "?" : data.reactionsLeft) +
        ".";
      this.emitLine(EVENT_TYPES.REACTION_TRIGGERED, text, "reaction");
    }

    handleHazardTriggered(payload) {
      const data = payload || {};
      this.emitLine(
        EVENT_TYPES.HAZARD_TRIGGERED,
        "[HAZARD] " +
          (data.hazardName || data.hazardId || "Hazard") +
          " triggers against " +
          (data.targetName || data.targetId || "a creature") +
          ".",
        "hazard",
      );
    }

    handleHazardDisabled(payload) {
      const data = payload || {};
      this.emitLine(
        EVENT_TYPES.HAZARD_DISABLED,
        "[HAZARD] " +
          (data.hazardName || data.hazardId || "Hazard") +
          " is disabled" +
          (data.reason ? " (" + data.reason + ")" : "") +
          ".",
        "hazard",
      );
    }

    handleTurnChanged(payload) {
      const data = payload || {};
      if (Number.isInteger(data.round)) {
        this.setRoundBadge(data.round);
      }

      const active = this.getCombatant(data.activeId);
      this.highlightActiveRow(data.activeId);

      if (!this.isSuppressed(EVENT_TYPES.TURN_CHANGED)) {
        if (!data.activeId) {
          this.queueLine("[TURN] No living combatant remains.", "turn");
        } else {
          const actions =
            active && Number.isInteger(active.actionsRemaining)
              ? " Actions: " + active.actionsRemaining + "/" + active.maxActions + "."
              : "";
          this.queueLine(
            "[TURN] Round " +
              (data.round === undefined ? "?" : data.round) +
              " — " +
              (data.activeName || data.activeId) +
              "'s turn." +
              actions,
            "turn",
          );
        }
      }

      if (this.onTurnChanged) {
        this.onTurnChanged(data, active);
      }
    }

    handleRoundStarted(payload) {
      const data = payload || {};
      if (Number.isInteger(data.round)) {
        this.setRoundBadge(data.round);
      }
      if (!this.isSuppressed(EVENT_TYPES.ROUND_STARTED)) {
        this.queueLine(
          "[ROUND] Round " + (data.round === undefined ? "?" : data.round) + " begins.",
          "round",
        );
      }
      if (this.onRoundStarted) {
        this.onRoundStarted(data);
      }
    }

    setRoundBadge(round) {
      if (this.roundIndicator) {
        this.roundIndicator.textContent = "Round " + round;
      }
    }

    highlightActiveRow(activeId) {
      if (!this.initiativeContainer) {
        return;
      }
      for (const row of this.initiativeContainer.querySelectorAll(".initiative-row")) {
        const isActive = row.dataset.combatantId === activeId;
        row.classList.toggle("is-active", isActive);
        if (isActive) {
          row.setAttribute("aria-current", "true");
        } else {
          row.removeAttribute("aria-current");
        }
      }
    }

    destroy() {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      for (const unsubscribe of this.unsubscribers) {
        unsubscribe();
      }
      this.unsubscribers = [];
      this.suppressed.clear();
    }
  }

  NS.View.EventLogBridge = EventLogBridge;
  NS.View.EVENT_TYPES = EVENT_TYPES;
})(typeof globalThis !== "undefined" ? globalThis : this);
