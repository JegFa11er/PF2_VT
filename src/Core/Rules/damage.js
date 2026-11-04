/**
 * PF2E REMASTERED — DAMAGE FORMULA PARSING & ROLLING (HEADLESS CORE)
 *
 * Supported formula shape: one dice term plus an optional flat modifier,
 * e.g. "1d8+4", "2d6", "1d6 - 1", or a flat integer such as "3".
 *
 * The caller supplies a deterministic die callback in tests/replays. When no
 * callback is supplied, the default uses Math.random so the browser prototype
 * remains playable. The rules engine never decides which die face is rolled.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Damage = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DICE_PATTERN = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;
  const FLAT_PATTERN = /^\s*[+-]?\d+\s*$/;

  function defaultRollDie(sides) {
    return 1 + Math.floor(Math.random() * sides);
  }

  /**
   * @param {string} formula
   * @returns {{ formula: string, diceCount: number, dieSize: number, modifier: number }}
   */
  function parseDamageFormula(formula) {
    if (typeof formula !== "string" || formula.trim() === "") {
      throw new TypeError("damage formula must be a non-empty string.");
    }

    const text = formula.trim();

    if (FLAT_PATTERN.test(text)) {
      return Object.freeze({
        formula: text,
        diceCount: 0,
        dieSize: 0,
        modifier: Number.parseInt(text, 10),
      });
    }

    const match = DICE_PATTERN.exec(text);
    if (!match) {
      throw new RangeError(
        'Unsupported damage formula "' + text + '"; expected NdM or NdM+K.',
      );
    }

    const diceCount = match[1] === "" ? 1 : Number.parseInt(match[1], 10);
    const dieSize = Number.parseInt(match[2], 10);
    const modifier = match[3] ? Number.parseInt(match[3].replace(/\s+/g, ""), 10) : 0;

    if (!Number.isInteger(diceCount) || diceCount <= 0) {
      throw new RangeError("Damage dice count must be a positive integer.");
    }
    if (!Number.isInteger(dieSize) || dieSize <= 0) {
      throw new RangeError("Damage die size must be a positive integer.");
    }
    if (!Number.isInteger(modifier)) {
      throw new RangeError("Damage modifier must be an integer.");
    }

    return Object.freeze({
      formula: text,
      diceCount: diceCount,
      dieSize: dieSize,
      modifier: modifier,
    });
  }

  /**
   * Roll a damage formula once.
   *
   * @param {{
   *   formula: string,
   *   rollDie?: (sides: number) => number
   * }} options
   * @returns {{
   *   formula: string,
   *   diceCount: number,
   *   dieSize: number,
   *   modifier: number,
   *   rolls: number[],
   *   diceTotal: number,
   *   baseTotal: number,
   *   total: number
   * }}
   */
  function rollDamage(options) {
    const opts = options || {};
    const parsed = parseDamageFormula(opts.formula);
    const rollDie =
      typeof opts.rollDie === "function" ? opts.rollDie : defaultRollDie;

    const rolls = [];
    let diceTotal = 0;
    for (let index = 0; index < parsed.diceCount; index += 1) {
      const value = rollDie(parsed.dieSize);
      if (!Number.isInteger(value) || value < 1 || value > parsed.dieSize) {
        throw new RangeError(
          "rollDie(" + parsed.dieSize + ") must return an integer from 1 to " + parsed.dieSize + ".",
        );
      }
      rolls.push(value);
      diceTotal += value;
    }

    const baseTotal = diceTotal + parsed.modifier;

    return {
      formula: parsed.formula,
      diceCount: parsed.diceCount,
      dieSize: parsed.dieSize,
      modifier: parsed.modifier,
      rolls: rolls,
      diceTotal: diceTotal,
      baseTotal: baseTotal,
      total: Math.max(0, baseTotal),
    };
  }

  return Object.freeze({
    defaultRollDie: defaultRollDie,
    parseDamageFormula: parseDamageFormula,
    rollDamage: rollDamage,
  });
});
