// Tests for click-to-draw outlines (A8): static/js/builder/outline.js.
// Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  addCorner, closeShape, closeWalk, findCrossing, rightAngle, snapPoint, wallsFromOutline,
} from "../static/js/builder/outline.js";
import { outlineFromWalls } from "../static/js/builder/state.js";

// --- Snapping and right angles ----------------------------------------------

test("snapPoint rounds to the 6 in grid and stays inside 0 to 1200", () => {
  assert.deepEqual(snapPoint([14.9, 2.9]), [12, 0]);
  assert.deepEqual(snapPoint([15.1, 3.1]), [18, 6]);
  assert.deepEqual(snapPoint([-20, 1300]), [0, 1200]);
});

test("rightAngle keeps the longer direction", () => {
  assert.deepEqual(rightAngle([0, 0], [100, 30]), [100, 0]);   // mostly east
  assert.deepEqual(rightAngle([0, 0], [-20, 90]), [0, 90]);    // mostly south
});

// --- Placing corners ------------------------------------------------------------

test("addCorner adds corners, ignores a repeat click, and never splits a wall", () => {
  let corners = addCorner([], [0, 0]);
  corners = addCorner(corners, [120, 0]);
  assert.deepEqual(addCorner(corners, [120, 0]), corners);                 // same spot again
  assert.deepEqual(addCorner(corners, [150, 0]), [[0, 0], [150, 0]]);      // carries on: moves the corner
  assert.deepEqual(addCorner(corners, [60, 0]), [[0, 0], [60, 0]]);        // back along: shortens it
  assert.deepEqual(addCorner(corners, [0, 0]), [[0, 0]]);                  // all the way back: undoes it
  assert.deepEqual(addCorner(corners, [120, 90]), [[0, 0], [120, 0], [120, 90]]);
});

// --- Closing ------------------------------------------------------------------

test("closeShape closes a rectangle drawn clockwise as it was drawn", () => {
  const { outline, error } = closeShape([[0, 0], [120, 0], [120, 144], [0, 144]]);
  assert.equal(error, null);
  assert.deepEqual(outline, [[0, 0], [120, 0], [120, 144], [0, 144]]);
});

test("closeShape adds the missing corner at a right angle", () => {
  // Three corners: east, then south. The last wall ran north-south, so the
  // closing walls turn west first, then north back to the start.
  const { outline } = closeShape([[0, 0], [120, 0], [120, 144]]);
  assert.deepEqual(outline, [[0, 0], [120, 0], [120, 144], [0, 144]]);
});

test("closeShape makes a counter-clockwise drawing clockwise, starting at the first corner", () => {
  const { outline, error } = closeShape([[0, 0], [0, 144], [120, 144], [120, 0]]);
  assert.equal(error, null);
  assert.deepEqual(outline, [[0, 0], [120, 0], [120, 144], [0, 144]]);
});

test("closeShape drops a corner in the middle of a straight wall", () => {
  // The closing wall from (0, 144) runs north into (0, 0), then wall A runs
  // east: no extra corner. But (0, 72) sits halfway up the west wall.
  const { outline } = closeShape([[0, 0], [120, 0], [120, 144], [0, 144], [0, 72]]);
  assert.deepEqual(outline, [[0, 0], [120, 0], [120, 144], [0, 144]]);
});

test("closeShape handles an L-shape", () => {
  const corners = [[0, 0], [120, 0], [120, 60], [60, 60], [60, 144], [0, 144]];
  assert.deepEqual(closeShape(corners), { outline: corners, error: null });
});

test("closeShape refuses too few corners and crossing walls", () => {
  assert.match(closeShape([[0, 0], [120, 0]]).error, /at least three corners/);
  assert.equal(
    closeShape([[0, 0], [120, 0], [120, 120], [60, 120], [60, 60], [120, 60], [120, 30], [0, 30]]).error,
    "Walls B and E cross each other.",
  );
  // A figure of eight's two halves cancel out, so (as on the server) it has no area.
  assert.equal(closeShape([[0, 50], [100, 50], [100, 100], [50, 100], [50, 0], [0, 0]]).error, "The outline has no area.");
});

// --- Crossing walls: the same messages as geometry.py ----------------------------

const { cases: OUTLINE_CASES } = JSON.parse(
  readFileSync(new URL("./fixtures/outline_cases.json", import.meta.url), "utf8"),
);

for (const testCase of OUTLINE_CASES) {
  test(`shared outline case: ${testCase.name}`, () => {
    assert.equal(findCrossing(testCase.outline), testCase.expected);
  });
}

test("walk the walls now reports crossing walls too", () => {
  const walls = wallsFromOutline([[0, 50], [100, 50], [100, 100], [50, 100], [50, 0], [0, 0]]);
  assert.ok(outlineFromWalls(walls).errors.includes("Walls A and D cross each other."));
});

// --- Outline -> walls, and keeping a walk closed ---------------------------------

test("wallsFromOutline gives each wall's direction and length", () => {
  assert.deepEqual(wallsFromOutline([[0, 0], [120, 0], [120, 60], [60, 60], [60, 144], [0, 144]]), [
    { direction: "east", length: 120 },
    { direction: "south", length: 60 },
    { direction: "west", length: 60 },
    { direction: "south", length: 84 },
    { direction: "west", length: 60 },
    { direction: "north", length: 144 },
  ]);
  assert.equal(wallsFromOutline([[0, 0], [100, 0], [50, 80]]), null); // angled
});

const RECT_WALLS = [
  { direction: "east", length: 120 },
  { direction: "south", length: 144 },
  { direction: "west", length: 120 },
  { direction: "north", length: 144 },
];
const ALL_DRAWN = [true, true, true, true];

test("closeWalk: typing wall A's length changes the drawn wall opposite it", () => {
  const walls = RECT_WALLS.map((wall, i) => (i === 0 ? { ...wall, length: 117 } : wall));
  const drawn = [false, true, true, true];
  assert.deepEqual(closeWalk(walls, 0, drawn), { lengths: [117, 144, 117, 144], adjusted: [2] });
});

test("closeWalk never changes a wall whose length was typed", () => {
  const walls = RECT_WALLS.map((wall, i) => (i === 0 ? { ...wall, length: 117 } : wall));
  assert.deepEqual(closeWalk(walls, 0, [false, true, false, true]), {
    lengths: [117, 144, 120, 144], adjusted: [],
  });
});

test("closeWalk goes round the room to find a drawn wall on the same axis", () => {
  // L-shape: typing the short south wall B as 66 (was 60) is taken up by the
  // next drawn north-south wall after it: D, the long south wall, shrinks to 78.
  const walls = wallsFromOutline([[0, 0], [120, 0], [120, 60], [60, 60], [60, 144], [0, 144]]);
  walls[1].length = 66;
  const { lengths, adjusted } = closeWalk(walls, 1, [true, false, true, true, true, true]);
  assert.deepEqual(adjusted, [3]);
  assert.deepEqual(lengths, [120, 66, 60, 78, 60, 144]);
  assert.equal(outlineFromWalls(walls.map((w, i) => ({ ...w, length: lengths[i] }))).errors.length, 0);
});

test("closeWalk leaves the gap when no drawn wall can take it", () => {
  const walls = RECT_WALLS.map((wall, i) => (i === 0 ? { ...wall, length: 500 } : wall));
  // Wall C would need to be 500, fine; but only B and D are drawn, on the other axis.
  assert.deepEqual(closeWalk(walls, 0, [false, true, false, true]).adjusted, []);
  assert.equal(closeWalk([{ direction: "east", length: NaN }, ...RECT_WALLS.slice(1)], 0, ALL_DRAWN), null);
});
