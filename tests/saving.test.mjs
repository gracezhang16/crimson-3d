// Tests for the pure parts of static/js/planner/saving.js.
// Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { nameForCopy, placementForSaving } from "../static/js/planner/saving.js";

test("a catalog item sends only its id, centre and rotation", () => {
  const placement = { furniture_id: 3, x: 37, y: 33, rotation: 90, label: "ignored", width: 5 };
  assert.deepEqual(placementForSaving(placement), { furniture_id: 3, x: 37, y: 33, rotation: 90 });
});

test("a custom item also sends its label and size (SPEC.md 4.4)", () => {
  const beanBag = { furniture_id: null, label: "Bean bag chair", width: 36, depth: 36, height: 28, x: 60, y: 80, rotation: 0 };
  assert.deepEqual(placementForSaving(beanBag), beanBag);
});

test("positions are sent as whole inches", () => {
  assert.deepEqual(placementForSaving({ furniture_id: 1, x: 20.4, y: 41.6, rotation: 0 }),
    { furniture_id: 1, x: 20, y: 42, rotation: 0 });
});

test("Save as new adds (copy) only when the name wasn't changed", () => {
  assert.equal(nameForCopy("Bed by the window", "Bed by the window"), "Bed by the window (copy)");
  assert.equal(nameForCopy("  Bed by the window ", "Bed by the window"), "Bed by the window (copy)");
  assert.equal(nameForCopy("Bed by the door", "Bed by the window"), "Bed by the door");
  assert.equal(nameForCopy("My layout", null), "My layout");   // never saved: nothing to copy
});
