// Tests for static/js/shared/units.js. Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatFeetInches } from "../static/js/shared/units.js";

test("whole feet and inches", () => {
  assert.equal(formatFeetInches(114), "9′ 6″");
  assert.equal(formatFeetInches(144), "12′ 0″");
  assert.equal(formatFeetInches(11), "0′ 11″");
});

test("rounds to the nearest inch first", () => {
  assert.equal(formatFeetInches(100.6), "8′ 5″");
  assert.equal(formatFeetInches(143.6), "12′ 0″"); // not "11′ 12″"
});
