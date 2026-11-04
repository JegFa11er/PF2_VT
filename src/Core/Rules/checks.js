/**
 * PF2E REMASTERED — D20 CHECKS & DEGREES OF SUCCESS (HEADLESS CORE)
 *
 * Implements the Remastered check pipeline:
 *   total = d20 + modifier
 *   total >= DC + 10  -> CRITICAL_SUCCESS
 *   total >= DC       -> SUCCESS
 *   total <= DC - 10  -> CRITICAL_FAILURE
 *   otherwise         -> FAILURE
 *
 * A natural 20 increases the degree one step; a natural 1 decreases it one
 * step. Both adjustments are capped at CRITICAL_SUCCESS / CRITICAL_FAILURE.
 *
 * No presentation state and no random source live here: the caller supplies
 * the d20 result.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Rules = root.PF2e.Core.Rules || {};
    root.PF2e.Core.Rules.Checks = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEGREES = Object.freeze({
    CRITICAL_FAILURE: "CRITICAL_FAILURE",
    FAILURE: "FAILURE",
    SUCCESS: "SUCCESS",
    CRITICAL_SUCCESS: "CRITICAL_SUCCESS",
  });

  /** Lowest to highest. Used for natural 20 / natural 1 shifts. */
  const DEGREE_ORDER = Object.freeze([
    DEGREES.CRITICAL_FAILURE,
    DEGREES.FAILURE,
    DEGREES.SUCCESS,
    DEGREES.CRITICAL_SUCCESS,
  ]);

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  /**
   * Shift a degree by whole steps, clamped to the legal range.
   *
   * @param {string} degree
   * @param {number} steps
   * @returns {string}
   */
  function shiftDegree(degree, steps) {
    assertInteger(steps, "steps");
    const index = DEGREE_ORDER.indexOf(degree);
    if (index === -1) {
      throw new RangeError("Unknown degree of success: " + String(degree) + ".");
    }
    const next = Math.max(0, Math.min(DEGREE_ORDER.length - 1, index + steps));
    return DEGREE_ORDER[next];
  }

  /**
   * Base degree from the total versus the DC, before natural 20/1 adjustment.
   *
   * @param {number} total
   * @param {number} dc
   * @returns {string}
   */
  function classifyTotal(total, dc) {
    assertInteger(total, "total");
    assertInteger(dc, "dc");

    if (total >= dc + 10) {
      return DEGREES.CRITICAL_SUCCESS;
    }
    if (total >= dc) {
      return DEGREES.SUCCESS;
    }
    if (total <= dc - 10) {
      return DEGREES.CRITICAL_FAILURE;
    }
    return DEGREES.FAILURE;
  }

  /**
   * @param {{ d20: number, modifier: number, dc: number }} options
   * @returns {{
   *   d20: number,
   *   modifier: number,
   *   total: number,
   *   dc: number,
   *   degree: string,
   *   isNatural20: boolean,
   *   isNatural1: boolean
   * }}
   */
  function evaluateCheck(options) {
    const opts = options || {};

    assertInteger(opts.d20, "d20");
    if (opts.d20 < 1 || opts.d20 > 20) {
      throw new RangeError("d20 must be an integer from 1 to 20.");
    }
    assertInteger(opts.modifier, "modifier");
    assertInteger(opts.dc, "dc");

    const total = opts.d20 + opts.modifier;
    const isNatural20 = opts.d20 === 20;
    const isNatural1 = opts.d20 === 1;

    let degree = classifyTotal(total, opts.dc);
    if (isNatural20) {
      degree = shiftDegree(degree, 1);
    } else if (isNatural1) {
      degree = shiftDegree(degree, -1);
    }

    return {
      d20: opts.d20,
      modifier: opts.modifier,
      total: total,
      dc: opts.dc,
      degree: degree,
      isNatural20: isNatural20,
      isNatural1: isNatural1,
    };
  }

  return Object.freeze({
    DEGREES: DEGREES,
    DEGREE_ORDER: DEGREE_ORDER,
    shiftDegree: shiftDegree,
    classifyTotal: classifyTotal,
    evaluateCheck: evaluateCheck,
  });
});
