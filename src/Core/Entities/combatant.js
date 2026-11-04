/**
 * PF2E REMASTERED — COMBATANT (HEADLESS CORE)
 *
 * Combat entity for the movement, turn, and combat slices:
 *   - Speed in feet (multiple of 5).
 *   - Three actions per turn by default.
 *   - Cumulative diagonal count, used for the 5-10-5 alternation.
 *   - Alliance ("player" / "enemy") and initiative for encounter order.
 *   - HP, AC, attack bonus, damage formula, and agile trait.
 *   - Multiple Attack Penalty counter reset at the start of each turn.
 *   - One reaction per turn by default, spent by reactions such as Reactive
 *     Strike and restored at the start of the combatant's turn.
 *   - Active condition store (Off-Guard, Frightened, Shield Raised) with typed
 *     modifiers, end-of-turn Frightened decay, and start-of-turn shield reset.
 *
 * Presentation data (token color, portrait, etc.) is intentionally absent.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/map.js"),
      require("../Rules/damage.js"),
      require("./conditions.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Combatant = factory(
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Conditions,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  MultipleAttack,
  Damage,
  Conditions,
) {
  "use strict";

  function assertNonEmptyString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
  }

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  const ALLIANCES = Object.freeze({
    PLAYER: "player",
    ENEMY: "enemy",
  });

  function normalizeAlliance(value) {
    const alliance = value === undefined ? ALLIANCES.PLAYER : value;
    if (alliance !== ALLIANCES.PLAYER && alliance !== ALLIANCES.ENEMY) {
      throw new RangeError('alliance must be "player" or "enemy".');
    }
    return alliance;
  }

  class Combatant {
    constructor(options) {
      const opts = options || {};

      assertNonEmptyString(opts.id, "id");
      assertNonEmptyString(opts.name, "name");
      assertInteger(opts.x, "x");
      assertInteger(opts.y, "y");

      if (!Number.isInteger(opts.speedFeet) || opts.speedFeet <= 0 || opts.speedFeet % 5 !== 0) {
        throw new RangeError("speedFeet must be a positive multiple of 5.");
      }

      const maxActions = opts.maxActions === undefined ? 3 : opts.maxActions;
      if (!Number.isInteger(maxActions) || maxActions <= 0) {
        throw new RangeError("maxActions must be a positive integer.");
      }

      if (opts.actionsRemaining !== undefined) {
        if (
          !Number.isInteger(opts.actionsRemaining) ||
          opts.actionsRemaining < 0 ||
          opts.actionsRemaining > maxActions
        ) {
          throw new RangeError("actionsRemaining must be between 0 and maxActions.");
        }
      }

      const maxReactions = opts.maxReactions === undefined ? 1 : opts.maxReactions;
      if (!Number.isInteger(maxReactions) || maxReactions < 0) {
        throw new RangeError("maxReactions must be a non-negative integer.");
      }

      if (opts.reactionsRemaining !== undefined) {
        if (
          !Number.isInteger(opts.reactionsRemaining) ||
          opts.reactionsRemaining < 0 ||
          opts.reactionsRemaining > maxReactions
        ) {
          throw new RangeError("reactionsRemaining must be between 0 and maxReactions.");
        }
      }

      if (opts.diagonalStepsThisTurn !== undefined) {
        if (!Number.isInteger(opts.diagonalStepsThisTurn) || opts.diagonalStepsThisTurn < 0) {
          throw new RangeError("diagonalStepsThisTurn must be a non-negative integer.");
        }
      }

      const initiative = opts.initiative === undefined ? 0 : opts.initiative;
      assertInteger(initiative, "initiative");

      const maxHP = opts.maxHP === undefined ? 1 : opts.maxHP;
      if (!Number.isInteger(maxHP) || maxHP <= 0) {
        throw new RangeError("maxHP must be a positive integer.");
      }

      const currentHP = opts.currentHP === undefined ? maxHP : opts.currentHP;
      if (!Number.isInteger(currentHP) || currentHP < 0 || currentHP > maxHP) {
        throw new RangeError("currentHP must be an integer between 0 and maxHP.");
      }

      const ac = opts.ac === undefined ? 10 : opts.ac;
      assertInteger(ac, "ac");

      const attackBonus = opts.attackBonus === undefined ? 0 : opts.attackBonus;
      assertInteger(attackBonus, "attackBonus");

      const damageFormula = opts.damage === undefined ? "1d4" : opts.damage;
      Damage.parseDamageFormula(damageFormula);

      const agile = opts.agile === undefined ? false : opts.agile;
      if (typeof agile !== "boolean") {
        throw new TypeError("agile must be a boolean.");
      }

      const attacksThisTurn =
        opts.attacksThisTurn === undefined ? 0 : opts.attacksThisTurn;
      if (!Number.isInteger(attacksThisTurn) || attacksThisTurn < 0) {
        throw new RangeError("attacksThisTurn must be a non-negative integer.");
      }

      this.id = opts.id;
      this.name = opts.name;
      this.alliance = normalizeAlliance(opts.alliance);
      this.initiative = initiative;
      this.speedFeet = opts.speedFeet;
      this.maxActions = maxActions;
      this.actionsRemaining =
        opts.actionsRemaining === undefined ? maxActions : opts.actionsRemaining;
      this.maxReactions = maxReactions;
      this.reactionsRemaining =
        opts.reactionsRemaining === undefined ? maxReactions : opts.reactionsRemaining;
      this.diagonalStepsThisTurn =
        opts.diagonalStepsThisTurn === undefined ? 0 : opts.diagonalStepsThisTurn;
      this.maxHP = maxHP;
      this.currentHP = currentHP;
      this.ac = ac;
      this.attackBonus = attackBonus;
      this.damage = damageFormula;
      this.agile = agile;
      this.attacksThisTurn = attacksThisTurn;
      this.isDefeated = currentHP <= 0;
      this.conditions = new Map();
      this._x = opts.x;
      this._y = opts.y;

      if (opts.conditions !== undefined) {
        this._initializeConditions(opts.conditions);
      }
    }

    _initializeConditions(source) {
      if (source instanceof Map) {
        for (const entry of source.entries()) {
          const value = entry[1];
          this.addCondition(
            entry[0],
            value && typeof value === "object" ? value.value : value,
          );
        }
        return;
      }
      if (Array.isArray(source)) {
        for (const entry of source) {
          if (entry && typeof entry === "object") {
            this.addCondition(entry.name || entry.slug, entry.value);
          }
        }
        return;
      }
      if (source && typeof source === "object") {
        for (const name of Object.keys(source)) {
          const value = source[name];
          this.addCondition(
            name,
            value && typeof value === "object" ? value.value : value,
          );
        }
        return;
      }
      throw new TypeError("conditions must be a Map, array, or object.");
    }

    get x() {
      return this._x;
    }

    get y() {
      return this._y;
    }

    get position() {
      return { x: this._x, y: this._y };
    }

    get speedSquares() {
      return this.speedFeet / 5;
    }

    get diagonalParity() {
      return this.diagonalStepsThisTurn % 2;
    }

    get hpRatio() {
      return this.maxHP > 0 ? this.currentHP / this.maxHP : 0;
    }

    get isAlive() {
      return !this.isDefeated && this.currentHP > 0;
    }

    /**
     * Current Multiple Attack Penalty for the next attack this turn.
     *
     * @param {boolean} [agile] override the weapon trait for this query
     * @returns {number}
     */
    getMultipleAttackPenalty(agile) {
      const isAgile = agile === undefined ? this.agile : agile === true;
      return MultipleAttack.multipleAttackPenalty(this.attacksThisTurn, isAgile);
    }

    // ------------------------------------------------------------ conditions

    _conditionKey(name) {
      // createCondition validates the slug and returns the canonical key.
      return Conditions.createCondition(name).name;
    }

    /**
     * Add or refresh a condition. Frightened uses the higher of the old and new
     * values, matching PF2e's non-stacking condition value rule.
     *
     * @param {string} name
     * @param {number} [value]
     * @returns {object|null} a copy of the stored condition, or null when the
     *   condition was removed (frightened 0)
     */
    addCondition(name, value) {
      const condition = Conditions.createCondition(name, value);
      if (condition === null) {
        this.removeCondition(name);
        return null;
      }

      const existing = this.conditions.get(condition.name);
      if (existing !== undefined) {
        if (
          existing.value !== null &&
          condition.value !== null &&
          condition.value > existing.value
        ) {
          this.conditions.set(condition.name, condition);
          return Conditions.copyCondition(condition);
        }
        return Conditions.copyCondition(existing);
      }

      this.conditions.set(condition.name, condition);
      return Conditions.copyCondition(condition);
    }

    /**
     * @param {string} name
     * @returns {boolean} true when a condition was removed
     */
    removeCondition(name) {
      const slug = this._conditionKey(name);
      return this.conditions.delete(slug);
    }

    /**
     * @param {string} name
     * @returns {object|null} a defensive copy of the condition record
     */
    getCondition(name) {
      const slug = this._conditionKey(name);
      const condition = this.conditions.get(slug);
      return condition === undefined ? null : Conditions.copyCondition(condition);
    }

    /**
     * Numeric value of a valued condition, or 0 when it is absent/unvalued.
     *
     * @param {string} name
     * @returns {number}
     */
    getConditionValue(name) {
      const condition = this.conditions.get(this._conditionKey(name));
      return condition && Number.isInteger(condition.value) ? condition.value : 0;
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    hasCondition(name) {
      return this.conditions.has(this._conditionKey(name));
    }

    /**
     * @returns {object[]} defensive copies in insertion order
     */
    getConditions() {
      const conditions = [];
      for (const condition of this.conditions.values()) {
        conditions.push(Conditions.copyCondition(condition));
      }
      return conditions;
    }

    /**
     * Modifier objects contributed by active conditions.
     *
     * @param {"attack"|"ac"|"check"|"all"} [scope]
     * @returns {{name:string,type:string,value:number,source:string}[]}
     */
    getConditionModifiers(scope) {
      const modifiers = [];
      for (const condition of this.conditions.values()) {
        const contributed = Conditions.conditionModifiers(condition, scope);
        for (const modifier of contributed) {
          modifiers.push(modifier);
        }
      }
      return modifiers;
    }

    /**
     * Decrease timed condition values at the end of this combatant's turn.
     * Frightened is the only timed condition in this slice.
     *
     * @returns {{name:string,from:number,to:number,removed:boolean}|null}
     */
    tickConditions() {
      const slug = Conditions.CONDITION_SLUGS.FRIGHTENED;
      const frightened = this.conditions.get(slug);
      if (frightened === undefined) {
        return null;
      }

      const from = frightened.value;
      const to = from - 1;
      if (to <= 0) {
        this.conditions.delete(slug);
        return { name: slug, from: from, to: 0, removed: true };
      }

      const next = Conditions.createCondition(slug, to);
      this.conditions.set(slug, next);
      return { name: slug, from: from, to: to, removed: false };
    }

    /**
     * End-of-turn condition tick. This is the canonical place where Frightened
     * decays. Encounter calls it for the outgoing combatant.
     *
     * @returns {{frightened: object|null, changed: boolean}}
     */
    endTurn() {
      const frightened = this.tickConditions();
      return {
        frightened: frightened,
        changed: frightened !== null,
      };
    }

    /**
     * Apply damage. HP floors at 0 and the combatant becomes defeated at 0.
     *
     * @param {number} amount non-negative integer
     * @returns {{ damageTaken: number, currentHP: number, maxHP: number, isDefeated: boolean }}
     */
    takeDamage(amount) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError("Damage must be a non-negative integer.");
      }

      const before = this.currentHP;
      this.currentHP = Math.max(0, before - amount);
      if (this.currentHP === 0) {
        this.isDefeated = true;
      }

      return {
        damageTaken: before - this.currentHP,
        currentHP: this.currentHP,
        maxHP: this.maxHP,
        isDefeated: this.isDefeated,
      };
    }

    canSpendActions(count) {
      const amount = count === undefined ? 1 : count;
      return Number.isInteger(amount) && amount > 0 && this.actionsRemaining >= amount;
    }

    spendActions(count) {
      const amount = count === undefined ? 1 : count;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new RangeError("Action cost must be a positive integer.");
      }
      if (this.actionsRemaining < amount) {
        throw new Error(
          this.name + " has only " + this.actionsRemaining + " action(s) remaining.",
        );
      }
      this.actionsRemaining -= amount;
      return this.actionsRemaining;
    }

    /**
     * Whether the combatant can still pay for a reaction this round.
     *
     * @param {number} [count]
     * @returns {boolean}
     */
    canSpendReaction(count) {
      const amount = count === undefined ? 1 : count;
      return (
        Number.isInteger(amount) &&
        amount > 0 &&
        this.reactionsRemaining >= amount
      );
    }

    /**
     * Spend reactions. Reactions are a separate pool from actions and are
     * restored only at the start of this combatant's own turn.
     *
     * @param {number} [count]
     * @returns {number} reactions remaining
     */
    spendReaction(count) {
      const amount = count === undefined ? 1 : count;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new RangeError("Reaction cost must be a positive integer.");
      }
      if (this.reactionsRemaining < amount) {
        throw new Error(
          this.name +
            " has only " +
            this.reactionsRemaining +
            " reaction(s) remaining.",
        );
      }
      this.reactionsRemaining -= amount;
      return this.reactionsRemaining;
    }

    setPosition(x, y) {
      assertInteger(x, "x");
      assertInteger(y, "y");
      this._x = x;
      this._y = y;
      return this;
    }

    registerDiagonalSteps(count) {
      const amount = count === undefined ? 1 : count;
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError("Diagonal step count must be a non-negative integer.");
      }
      this.diagonalStepsThisTurn += amount;
      return this.diagonalStepsThisTurn;
    }

    /**
     * Reset per-turn action and movement state.
     *
     * By default this also performs the end-of-turn condition tick so a caller
     * that drives turns manually gets the Frightened decay. Encounter passes
     * `{ tickConditions: false }` because it calls endTurn() on the outgoing
     * combatant and must not tick the incoming combatant prematurely.
     *
     * A raised shield lasts until the start of the raiser's next turn, so it
     * is removed here unconditionally, including when the Frightened tick is
     * suppressed for the incoming combatant. The reaction budget is also
     * restored here: reactions spent during other creatures' turns come back
     * at the start of this combatant's own turn.
     *
     * @param {{tickConditions?: boolean}} [options]
     * @returns {Combatant}
     */
    resetTurn(options) {
      const opts = options || {};
      if (opts.tickConditions !== false) {
        this.endTurn();
      }
      this.conditions.delete(Conditions.CONDITION_SLUGS.SHIELD_RAISED);
      this.actionsRemaining = this.maxActions;
      this.reactionsRemaining = this.maxReactions;
      this.diagonalStepsThisTurn = 0;
      this.attacksThisTurn = 0;
      return this;
    }
  }

  Combatant.ALLIANCES = ALLIANCES;

  return Combatant;
});
