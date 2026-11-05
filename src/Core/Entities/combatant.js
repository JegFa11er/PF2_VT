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
      require("../Rules/iwr.js"),
      require("../Rules/weapon-traits.js"),
      require("./persistent-damage.js"),
      require("../Grid/cover.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Combatant = factory(
      root.PF2e.Core.Rules.MultipleAttack,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Rules.IWR,
      root.PF2e.Core.Rules.WeaponTraits,
      root.PF2e.Core.PersistentDamage,
      root.PF2e.Core.Cover,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  MultipleAttack,
  Damage,
  Conditions,
  IWR,
  WeaponTraits,
  PersistentDamage,
  Cover,
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

  /**
   * Saving throws are treated the same way as PF2e: a static modifier used to
   * derive a defence DC (`10 + modifier`). Skills use the same underlying math
   * for Athletics, Acrobatics, Stealth, and Perception checks.
   */
  const SAVE_NAMES = Object.freeze(["fortitude", "reflex", "will"]);
  const SKILL_NAMES = Object.freeze([
    "acrobatics",
    "athletics",
    "perception",
    "stealth",
  ]);

  function normalizeStatName(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(label + " must be a non-empty string.");
    }
    return value.trim().toLowerCase();
  }

  /**
   * Normalize an authored save/skill block. Known names default to 0 and any
   * additional future name is preserved, so the engine stays forward
   * compatible without silently dropping authored data.
   *
   * @param {object|undefined} input
   * @param {string[]} defaults
   * @param {string} label
   * @returns {Object<string, number>}
   */
  function normalizeStatBlock(input, defaults, label) {
    const result = {};
    for (const name of defaults) {
      result[name] = 0;
    }
    if (input === undefined || input === null) {
      return result;
    }
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError(label + " must be an object of integer modifiers.");
    }
    for (const key of Object.keys(input)) {
      const name = normalizeStatName(key, label + " key");
      assertInteger(input[key], label + "." + name);
      result[name] = input[key];
    }
    return result;
  }

  function appendExtraModifiers(modifiers, extraModifiers) {
    if (extraModifiers === undefined || extraModifiers === null) {
      return;
    }
    if (!Array.isArray(extraModifiers)) {
      throw new TypeError("extraModifiers must be an array.");
    }
    for (const modifier of extraModifiers) {
      modifiers.push(modifier);
    }
  }

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

      const saves = normalizeStatBlock(opts.saves, SAVE_NAMES, "saves");
      const skills = normalizeStatBlock(opts.skills, SKILL_NAMES, "skills");

      const damageInput =
        opts.damage === undefined
          ? opts.weapon === undefined
            ? "1d4"
            : opts.weapon
          : opts.damage;
      const damageSpec = Damage.parseDamageSpec(damageInput, opts.damageType);
      const traitsInput =
        opts.traits === undefined
          ? opts.weapon && opts.weapon.traits
          : opts.traits;
      const traitDefinitions = WeaponTraits.normalizeTraits(traitsInput);

      const immunities = IWR.normalizeImmunities(opts.immunities);
      const weaknesses = IWR.normalizeIWRValues(opts.weaknesses, "weaknesses");
      const resistances = IWR.normalizeIWRValues(
        opts.resistances,
        "resistances",
      );

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
      this.saves = saves;
      this.skills = skills;
      // `damage` stays a formula string for backwards compatibility. The
      // companion `damageType`/`damageSpec` fields carry the typed contract.
      this.damage = damageSpec.formula;
      this.damageType = damageSpec.type;
      this.damageSpec = damageSpec;
      this.traitDefinitions = Object.freeze(traitDefinitions.slice());
      this.traits = Object.freeze(
        traitDefinitions.map(function (trait) {
          return trait.slug;
        }),
      );
      this.immunities = immunities;
      this.weaknesses = weaknesses;
      this.resistances = resistances;
      this.agile = agile;
      this.attacksThisTurn = attacksThisTurn;
      this.isDefeated = currentHP <= 0;
      this.conditions = new Map();
      this.persistentDamage = [];
      // Monotonic count of the turns this combatant has begun. Grapple
      // duration is expressed against the grappler's turn count so it expires
      // at the end of the grappler's next turn, not the victim's.
      const turnNumber = opts.turnNumber === undefined ? 0 : opts.turnNumber;
      if (!Number.isInteger(turnNumber) || turnNumber < 0) {
        throw new RangeError("turnNumber must be a non-negative integer.");
      }
      this.turnNumber = turnNumber;
      this._x = opts.x;
      this._y = opts.y;

      if (opts.conditions !== undefined) {
        this._initializeConditions(opts.conditions);
      }
      if (opts.persistentDamage !== undefined) {
        this._initializePersistentDamage(opts.persistentDamage);
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

    _initializePersistentDamage(source) {
      if (Array.isArray(source)) {
        for (const entry of source) {
          this.addPersistentDamage(entry);
        }
        return;
      }
      if (source !== null && typeof source === "object") {
        if (source.formula !== undefined || source.damage !== undefined) {
          this.addPersistentDamage(source);
          return;
        }
        // Type-keyed map: { fire: "1d6", bleed: "1d4" }.
        for (const type of Object.keys(source)) {
          const value = source[type];
          if (value !== null && typeof value === "object") {
            this.addPersistentDamage(
              Object.assign({}, value, { type: value.type || type }),
            );
          } else {
            this.addPersistentDamage({ formula: String(value), type: type });
          }
        }
        return;
      }
      throw new TypeError(
        "persistentDamage must be an array, an object, or a type-keyed map.",
      );
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
     * `options` carries source-linked metadata for Grapple:
     * `{ sourceId, expiresOnSourceTurn }`. Re-applying the same unvalued
     * condition refreshes its duration instead of stacking.
     *
     * @param {string} name
     * @param {number} [value]
     * @param {{sourceId?:string,expiresOnSourceTurn?:number}} [options]
     * @returns {object|null} a copy of the stored condition, or null when the
     *   condition was removed (frightened 0)
     */
    addCondition(name, value, options) {
      const condition = Conditions.createCondition(name, value, options);
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
        // Unvalued conditions (Grabbed, Restrained, Immobilized, ...) refresh
        // their source and expiry metadata rather than stacking.
        existing.sourceId = condition.sourceId;
        existing.expiresOnSourceTurn = condition.expiresOnSourceTurn;
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
     * Whether movement actions are forbidden. Grabbed and Restrained imply
     * Immobilized, so all three conditions count even if only the parent was
     * authored.
     *
     * @returns {boolean}
     */
    isImmobilized() {
      return Conditions.isImmobilized(this);
    }

    /**
     * Active grapple condition (Restrained before Grabbed), or null.
     *
     * @returns {object|null}
     */
    getGrappleCondition() {
      return Conditions.getGrappleCondition(this);
    }

    _removeGrappleRecords(sourceId, predicate) {
      const removed = [];
      for (const slug of Conditions.GRAPPLE_CONDITIONS) {
        const condition = this.conditions.get(slug);
        if (condition === undefined || condition.sourceId !== sourceId) {
          continue;
        }
        if (!predicate(condition)) {
          continue;
        }
        this.conditions.delete(slug);
        removed.push(Conditions.copyCondition(condition));
      }

      if (removed.length > 0) {
        const immobilized = this.conditions.get(
          Conditions.CONDITION_SLUGS.IMMOBILIZED,
        );
        const stillGrappled =
          this.hasCondition("grabbed") || this.hasCondition("restrained");
        if (
          immobilized !== undefined &&
          immobilized.sourceId === sourceId &&
          !stillGrappled
        ) {
          this.conditions.delete(Conditions.CONDITION_SLUGS.IMMOBILIZED);
          removed.push(Conditions.copyCondition(immobilized));
        }
      }

      return removed;
    }

    /**
     * Break every grapple this source maintains on this combatant. Called when
     * the grappler Strides/Steps or is defeated.
     *
     * @param {string} sourceId
     * @returns {object[]} removed condition records
     */
    releaseGrappleFrom(sourceId) {
      if (typeof sourceId !== "string") {
        return [];
      }
      return this._removeGrappleRecords(sourceId, function () {
        return true;
      });
    }

    /**
     * End this source's grapples when the source's turn ends. The duration is
     * "until the end of the grappler's next turn": a grapple applied on the
     * grappler's turn N stores `expiresOnSourceTurn = N + 1`, so the end of
     * turn N keeps it and the end of turn N + 1 removes it.
     *
     * @param {string} sourceId
     * @param {number} sourceTurnNumber
     * @returns {object[]} removed condition records
     */
    expireGrapplesFrom(sourceId, sourceTurnNumber) {
      if (typeof sourceId !== "string" || !Number.isInteger(sourceTurnNumber)) {
        return [];
      }
      return this._removeGrappleRecords(sourceId, function (condition) {
        return (
          condition.expiresOnSourceTurn !== null &&
          condition.expiresOnSourceTurn !== undefined &&
          sourceTurnNumber >= condition.expiresOnSourceTurn
        );
      });
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

    // ------------------------------------------------- saves, skills & DCs

    /**
     * @returns {Object<string, number>} defensive copy of the saving throws
     */
    getSaves() {
      return Object.assign({}, this.saves);
    }

    /**
     * @returns {Object<string, number>} defensive copy of the skill modifiers
     */
    getSkills() {
      return Object.assign({}, this.skills);
    }

    /**
     * Raw saving-throw modifier, defaulting to 0 for an unknown save.
     *
     * @param {string} saveName
     * @returns {number}
     */
    getSaveModifier(saveName) {
      const name = normalizeStatName(saveName, "saveName");
      return Number.isInteger(this.saves[name]) ? this.saves[name] : 0;
    }

    /**
     * Raw skill modifier, defaulting to 0 for an unknown skill.
     *
     * @param {string} skillName
     * @returns {number}
     */
    getSkillModifier(skillName) {
      const name = normalizeStatName(skillName, "skillName");
      return Number.isInteger(this.skills[name]) ? this.skills[name] : 0;
    }

    /**
     * Situational modifiers for a skill check.
     *
     * Frightened contributes its status penalty. Attack-roll modifiers such as
     * Prone deliberately do NOT apply: an Attack-trait action such as Trip is a
     * skill check, not an attack roll, even though it uses MAP. Future
     * skill-specific bonuses can be appended through `extraModifiers`.
     *
     * @param {string} skillName
     * @param {{extraModifiers?:object[]}} [options]
     * @returns {object[]}
     */
    getSkillModifiers(skillName, options) {
      const name = normalizeStatName(skillName, "skillName");
      const opts = options || {};
      const modifiers = this.getConditionModifiers([
        "skill",
        "skill:" + name,
        "check",
      ]);
      appendExtraModifiers(modifiers, opts.extraModifiers);
      return modifiers;
    }

    /**
     * Situational modifiers for a saving throw. Standard and greater cover add
     * a circumstance bonus to Reflex saves; lesser cover is AC-only.
     *
     * @param {string} saveName
     * @param {{cover?:object|string, extraModifiers?:object[]}} [options]
     * @returns {object[]}
     */
    getSaveModifiers(saveName, options) {
      const name = normalizeStatName(saveName, "saveName");
      const opts = options || {};
      const modifiers = this.getConditionModifiers([
        "save",
        "save:" + name,
      ]);

      if (name === "reflex" && opts.cover !== undefined) {
        const coverModifier = Cover.coverReflexModifier(opts.cover);
        if (coverModifier !== null) {
          modifiers.push(coverModifier);
        }
      }

      appendExtraModifiers(modifiers, opts.extraModifiers);
      return modifiers;
    }

    /**
     * Situational modifiers for a defence DC such as Reflex DC, Fortitude DC,
     * or Will DC. Cover applies to Reflex DC at standard/greater cover.
     * `"ac"` is also accepted for AC-scope condition queries; AC itself is
     * already a DC and is resolved directly by Strike rather than through
     * `calculateDC`.
     *
     * @param {string} dcName
     * @param {{cover?:object|string, extraModifiers?:object[]}} [options]
     * @returns {object[]}
     */
    getDCModifiers(dcName, options) {
      const name = normalizeStatName(dcName, "dcName");
      const opts = options || {};
      const scopes = ["dc", "dc:" + name];
      if (name === "ac") {
        scopes.push("ac");
      }
      const modifiers = this.getConditionModifiers(scopes);

      if (name === "reflex" && opts.cover !== undefined) {
        const coverModifier = Cover.coverReflexModifier(opts.cover);
        if (coverModifier !== null) {
          modifiers.push(coverModifier);
        }
      }

      appendExtraModifiers(modifiers, opts.extraModifiers);
      return modifiers;
    }

    // ----------------------------------------------------- persistent damage

    /**
     * Add or upgrade persistent damage. Same-type instances do not stack; the
     * stronger formula wins. Different types coexist.
     *
     * @param {{id?:string,formula:string,type?:string}|string} input
     * @param {string} [fallbackType]
     * @returns {{instance:object,added:boolean,replaced:boolean,keptExisting:boolean,previous:object|null}}
     */
    addPersistentDamage(input, fallbackType) {
      return PersistentDamage.addPersistentDamage(
        this.persistentDamage,
        input,
        fallbackType,
      );
    }

    /**
     * Remove by instance id, or by damage type. A type removes every instance
     * of that type (there is at most one by construction).
     *
     * @param {string} idOrType
     * @returns {boolean}
     */
    removePersistentDamage(idOrType) {
      return PersistentDamage.removePersistentDamage(
        this.persistentDamage,
        idOrType,
      );
    }

    /**
     * @param {string} [type] omit to ask whether any persistent damage is active
     * @returns {boolean}
     */
    hasPersistentDamage(type) {
      return PersistentDamage.hasPersistentDamage(
        this.persistentDamage,
        type,
      );
    }

    /**
     * @returns {{id:string,formula:string,type:string}[]} defensive copies
     */
    getPersistentDamage() {
      return PersistentDamage.getPersistentDamage(this.persistentDamage);
    }

    clearPersistentDamage() {
      this.persistentDamage.length = 0;
      return this;
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
     * End-of-turn resolution. Frightened decays here, and every persistent
     * damage instance rolls its damage, runs the target's IWR, and makes a
     * recovery flat check against DC 15.
     *
     * Callbacks:
     *   - `rollDie(sides)` / `rollDamageDie(sides)` for persistent damage dice;
     *   - `rollD20()` / `rollFlatCheck()` for the recovery check.
     *
     * @param {{rollDie?:Function,rollDamageDie?:Function,rollD20?:Function,rollFlatCheck?:Function}} [options]
     * @returns {{
     *   frightened: object|null,
     *   changed: boolean,
     *   persistentTick: object,
     *   persistentChanged: boolean
     * }}
     */
    endTurn(options) {
      const opts = options || {};
      const frightened = this.tickConditions();
      const persistentTick = PersistentDamage.tickPersistentDamage({
        combatant: this,
        instances: this.persistentDamage,
        rollDie: opts.rollDie,
        rollDamageDie: opts.rollDamageDie,
        rollD20: opts.rollD20,
        rollFlatCheck: opts.rollFlatCheck,
      });
      const releasedGrapples = this._releaseGrapplesAtEndOfTurn(opts.combatants);
      return {
        frightened: frightened,
        changed: frightened !== null,
        persistentTick: persistentTick,
        persistentChanged: persistentTick.changed,
        releasedGrapples: releasedGrapples,
      };
    }

    /**
     * End or break the grapples this combatant maintains. A living grappler
     * expires only grapples whose `expiresOnSourceTurn` has been reached; a
     * defeated grappler releases them immediately.
     *
     * @param {object[]} [combatants]
     * @returns {{combatant:object,combatantId:string,combatantName:string,removed:object[]}[]}
     */
    _releaseGrapplesAtEndOfTurn(combatants) {
      if (!Array.isArray(combatants)) {
        return [];
      }

      const released = [];
      for (const combatant of combatants) {
        if (
          combatant === null ||
          typeof combatant !== "object" ||
          combatant === this
        ) {
          continue;
        }

        let removed = [];
        if (this.isDefeated) {
          if (typeof combatant.releaseGrappleFrom === "function") {
            removed = combatant.releaseGrappleFrom(this.id);
          }
        } else if (typeof combatant.expireGrapplesFrom === "function") {
          removed = combatant.expireGrapplesFrom(this.id, this.turnNumber);
        }

        if (removed.length > 0) {
          released.push({
            combatant: combatant,
            combatantId: combatant.id,
            combatantName: combatant.name,
            removed: removed,
          });
        }
      }
      return released;
    }

    /**
     * Frozen typed damage contract for this combatant's weapon/attack.
     *
     * @returns {{formula:string,type:string}}
     */
    getDamageSpec() {
      return this.damageSpec;
    }

    /**
     * Active weapon definition used by the damage calculator.
     *
     * @returns {{formula:string,type:string,traits:string[]}}
     */
    getWeapon() {
      return {
        formula: this.damage,
        type: this.damageType,
        traits: this.traits.slice(),
      };
    }

    /**
     * @param {string} name canonical trait name or full slug ("deadly" or "deadly-d8")
     * @returns {boolean}
     */
    hasTrait(name) {
      return WeaponTraits.hasTrait(this.traits, name);
    }

    /**
     * @param {string} name
     * @returns {object|null} structured trait definition
     */
    getTrait(name) {
      return WeaponTraits.getTrait(this.traitDefinitions, name);
    }

    /**
     * @returns {string[]} canonical trait slugs, e.g. ["reach", "deadly-d8"]
     */
    getTraits() {
      return this.traits.slice();
    }

    /**
     * @returns {string[]} display labels, e.g. ["reach", "deadly d8"]
     */
    getTraitLabels() {
      return WeaponTraits.traitLabels(this.traitDefinitions);
    }

    /**
     * Melee reach in feet. The `reach` weapon trait increases it to 10 ft.
     *
     * @returns {number}
     */
    getReachFeet() {
      return WeaponTraits.getReachFeet(this.traitDefinitions, 5);
    }

    /**
     * Snapshot of this combatant's authored IWR profile.
     *
     * @returns {{
     *   immunities: string[],
     *   weaknesses: {type:string,value:number}[],
     *   resistances: {type:string,value:number}[]
     * }}
     */
    getIWR() {
      return {
        immunities: this.immunities.slice(),
        weaknesses: this.weaknesses.map(function (entry) {
          return { type: entry.type, value: entry.value };
        }),
        resistances: this.resistances.map(function (entry) {
          return { type: entry.type, value: entry.value };
        }),
      };
    }

    /**
     * Apply damage through the canonical Immunity -> Weakness -> Resistance
     * pipeline. HP floors at 0 and the combatant becomes defeated at 0.
     *
     * Options:
     *   - `type`: damage type for a single-instance hit (default `untyped`).
     *   - `damageInstances`: pre-split typed instances, used when an attack
     *     deals more than one type. When present, `amount` is only the base
     *     caller amount and the instances drive the calculation.
     *   - `applyIWR: false`: bypass IWR entirely (e.g. future healing rules).
     *
     * `damageTaken` remains the actual HP lost (clamped), while
     * `damageApplied` is the post-IWR damage; `baseDamage` is the pre-IWR
     * amount. This keeps overkill visible in the log exactly like Phase 4.
     *
     * @param {number} amount non-negative integer
     * @param {{type?:string, damageInstances?:{amount:number,type:string}[], applyIWR?:boolean}} [options]
     * @returns {{
     *   damageTaken: number,
     *   damageApplied: number,
     *   baseDamage: number,
     *   currentHP: number,
     *   maxHP: number,
     *   isDefeated: boolean,
     *   iwr: object|null
     * }}
     */
    takeDamage(amount, options) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError("Damage must be a non-negative integer.");
      }

      const opts = options || {};
      let finalDamage = amount;
      let iwr = null;

      if (opts.applyIWR !== false) {
        const damageInstances = Array.isArray(opts.damageInstances)
          ? opts.damageInstances
          : [
              {
                amount: amount,
                type: opts.type === undefined ? "untyped" : opts.type,
              },
            ];

        iwr = IWR.applyIWR({
          damageInstances: damageInstances,
          immunities: this.immunities,
          weaknesses: this.weaknesses,
          resistances: this.resistances,
        });
        finalDamage = iwr.totalDamage;
      }

      const before = this.currentHP;
      this.currentHP = Math.max(0, before - finalDamage);
      if (this.currentHP === 0) {
        this.isDefeated = true;
      }

      return {
        damageTaken: before - this.currentHP,
        damageApplied: finalDamage,
        baseDamage: amount,
        currentHP: this.currentHP,
        maxHP: this.maxHP,
        isDefeated: this.isDefeated,
        iwr: iwr,
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
     * suppressed for the incoming combatant. Greater cover from Take Cover
     * has the same duration and is cleared here as well. The reaction budget
     * is also restored here: reactions spent during other creatures' turns
     * come back at the start of this combatant's own turn.
     *
     * @param {{tickConditions?: boolean}} [options]
     * @returns {Combatant}
     */
    resetTurn(options) {
      const opts = options || {};
      if (opts.tickConditions !== false) {
        this.endTurn(opts);
      }
      this.conditions.delete(Conditions.CONDITION_SLUGS.SHIELD_RAISED);
      this.conditions.delete(Conditions.CONDITION_SLUGS.GREATER_COVER);
      this.actionsRemaining = this.maxActions;
      this.reactionsRemaining = this.maxReactions;
      this.diagonalStepsThisTurn = 0;
      this.attacksThisTurn = 0;
      // A new turn begins. Grapple durations are expressed against this
      // monotonic counter so "until the end of your next turn" is exact.
      this.turnNumber += 1;
      return this;
    }
  }

  Combatant.ALLIANCES = ALLIANCES;
  Combatant.SAVE_NAMES = SAVE_NAMES;
  Combatant.SKILL_NAMES = SKILL_NAMES;

  return Combatant;
});
