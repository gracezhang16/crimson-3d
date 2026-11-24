/**
 * Formatting lengths for people (SHARED: planner and builder).
 *
 * No DOM or three.js imports, so tests/units.test.mjs runs it under node.
 * The Python twin is the feet_inches Jinja filter in pages.py.
 */

/**
 * Format inches as feet and inches, e.g. 114 -> "9′ 6″". Rounds to the
 * nearest inch first, so a 100.6 in diagonal wall reads "8′ 5″".
 *
 * @param {number} inches
 * @returns {string}
 */
export function formatFeetInches(inches) {
  const total = Math.round(inches);
  const feet = Math.floor(total / 12);
  return `${feet}′ ${total - feet * 12}″`;
}
