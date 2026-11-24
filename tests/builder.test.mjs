// Tests for the admin builder's pure code: static/js/builder/state.js and the
// helpers in static/js/builder/preview.js. Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGeometry,
  outlineFromWalls,
  parseInches,
  rectangleOutline,
  rectangleWalls,
  wallProblem,
} from "../static/js/builder/state.js";
import { labelAnchor, labelPoint, previewBox, wallSegments } from "../static/js/builder/preview.js";

const wall = (direction, length) => ({ direction, length });

// The L-shape used across the project's tests, walked from its top-left corner.
const L_WALLS = [
  wall("east", 120), wall("south", 60), wall("west", 60),
  wall("south", 90), wall("west", 60), wall("north", 150),
];
const L_OUTLINE = [[0, 0], [120, 0], [120, 60], [60, 60], [60, 150], [0, 150]];

// --- parseInches ---------------------------------------------------------------

test("parseInches accepts whole numbers only", () => {
  assert.equal(parseInches("114"), 114);
  assert.equal(parseInches(" 42 "), 42);
  for (const bad of ["", "abc", "12.5", "-3", "1e2", null]) {
    assert.ok(Number.isNaN(parseInches(bad)), `"${bad}"`);
  }
});

// --- Rectangle -----------------------------------------------------------------

test("a rectangle is clockwise from the north-west corner", () => {
  assert.deepEqual(rectangleOutline(114, 150), [[0, 0], [114, 0], [114, 150], [0, 150]]);
});

test("buildGeometry makes the SPEC.md 4.2 format for a rectangle", () => {
  const { geometry, errors } = buildGeometry({ shape: "rectangle", width: 114, length: 150, ceiling: 102 });
  assert.deepEqual(errors, []);
  assert.deepEqual(geometry, {
    version: 1, units: "in", ceiling: 102,
    outline: [[0, 0], [114, 0], [114, 150], [0, 150]], features: [],
  });
});

test("rectangle sizes and ceiling are checked", () => {
  const { geometry, errors } = buildGeometry({ shape: "rectangle", width: NaN, length: 601, ceiling: 50 });
  assert.equal(geometry, null);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Width/);
  assert.match(errors[1], /Length/);
  assert.match(errors[2], /Ceiling .* 72 to 240/);
});

test("a bad ceiling still leaves an outline to preview", () => {
  const { geometry, errors } = buildGeometry({ shape: "rectangle", width: 100, length: 100, ceiling: NaN });
  assert.ok(geometry);
  assert.equal(errors.length, 1);
});

// --- Walk the walls ------------------------------------------------------------

test("walking a rectangle's walls gives the rectangle", () => {
  assert.deepEqual(outlineFromWalls(rectangleWalls(114, 150)), {
    outline: rectangleOutline(114, 150), errors: [], openEnd: null,
  });
});

test("an L-shape walked clockwise", () => {
  assert.deepEqual(outlineFromWalls(L_WALLS), { outline: L_OUTLINE, errors: [], openEnd: null });
});

test("starting from another corner shifts the outline so it starts at 0", () => {
  // Same L, starting at its inner corner (60, 60) and heading south.
  const fromInner = [...L_WALLS.slice(3), ...L_WALLS.slice(0, 3)];
  const { outline, errors } = outlineFromWalls(fromInner);
  assert.deepEqual(errors, []);
  assert.deepEqual(outline[0], [60, 60]);
  assert.ok(outline.every(([x, y]) => x >= 0 && y >= 0));
});

test("walls that don't meet say how far off they are", () => {
  const walls = [wall("east", 120), wall("south", 100), wall("west", 114), wall("north", 98)];
  const { outline, errors, openEnd } = outlineFromWalls(walls);
  assert.ok(outline, "still drawn in the preview");
  assert.deepEqual(errors, [
    "The walls don't meet up: the last wall ends 6 in east and 2 in south of where you started.",
  ]);
  assert.deepEqual(openEnd, [6, 2]);   // where the last wall really ends
});

test("counter-clockwise walls are rejected with directions to fix it", () => {
  const ccw = [wall("south", 150), wall("east", 114), wall("north", 150), wall("west", 114)];
  const { errors } = outlineFromWalls(ccw);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /counter-clockwise/);
});

test("a wall that doubles back is rejected", () => {
  const walls = [wall("east", 100), wall("west", 20), wall("south", 50), wall("west", 80), wall("north", 50)];
  assert.ok(outlineFromWalls(walls).errors.some((e) => e === "Wall B doubles back on wall A."));
});

test("too few or too many walls", () => {
  assert.match(outlineFromWalls(rectangleWalls(10, 10).slice(0, 3)).errors[0], /4 to 12 walls/);
  assert.match(outlineFromWalls(Array(13).fill(wall("east", 1))).errors[0], /4 to 12 walls/);
});

test("bad rows are named by wall letter and stop the outline", () => {
  const walls = [wall("east", 100), wall("sideways", 50), wall("west", NaN), wall("north", 50)];
  const { outline, errors } = outlineFromWalls(walls);
  assert.equal(outline, null);
  assert.deepEqual(errors, [
    "Wall B: Pick a direction.",
    "Wall C: Length must be a whole number from 1 to 600 in.",
  ]);
});

test("wallProblem", () => {
  assert.equal(wallProblem(wall("north", 1)), null);
  assert.equal(wallProblem(wall("north", 600)), null);
  assert.match(wallProblem(wall("north", 0)), /1 to 600/);
  assert.match(wallProblem(wall("north", 601)), /1 to 600/);
});

test("a room bigger than 600 in is rejected", () => {
  const { errors } = outlineFromWalls(rectangleWalls(610, 100));
  assert.ok(errors.some((e) => /1 to 600/.test(e)));
});

test("buildGeometry uses the walls in walls mode", () => {
  const { geometry, errors } = buildGeometry({ shape: "walls", walls: L_WALLS, ceiling: 96 });
  assert.deepEqual(errors, []);
  assert.deepEqual(geometry.outline, L_OUTLINE);
});

// --- Preview helpers -------------------------------------------------------------

test("previewBox adds a 20% margin around the room", () => {
  assert.deepEqual(previewBox([[0, 0], [100, 0], [100, 50], [0, 50]]), {
    x: -20, y: -20, width: 140, height: 90, margin: 20,
  });
});

test("an open walk starting west of its end shifts so nothing is negative", () => {
  const walls = [wall("east", 100), wall("south", 50), wall("west", 110), wall("north", 50)];
  const { outline, openEnd } = outlineFromWalls(walls);
  assert.deepEqual(openEnd, [0, 0]);
  assert.deepEqual(outline[0], [10, 0]);
});

test("wallSegments closes a room, or ends an open walk where it really ends", () => {
  const rect = rectangleOutline(100, 50);
  assert.deepEqual(wallSegments(rect)[3], { start: [0, 50], end: [0, 0] });
  assert.deepEqual(wallSegments(rect, [0, 6])[3], { start: [0, 50], end: [0, 6] });
});

test("labelPoint sits outside the middle of each wall", () => {
  const [north, east, south, west] = wallSegments(rectangleOutline(100, 50));
  assert.deepEqual(labelPoint(north, 10), [50, -10]);
  assert.deepEqual(labelPoint(east, 10), [110, 25]);
  assert.deepEqual(labelPoint(south, 10), [50, 60]);
  assert.deepEqual(labelPoint(west, 10), [-10, 25]);
});

test("labelPoint is outside the inner wall of an L-shape too", () => {
  // Wall 2 runs west along y = 60 under the top bar; outside is south of it.
  assert.deepEqual(labelPoint(wallSegments(L_OUTLINE)[2], 10), [90, 70]);
});

test("labelAnchor keeps side labels off their wall", () => {
  const anchors = wallSegments(rectangleOutline(100, 50)).map(labelAnchor);
  assert.deepEqual(anchors, ["middle", "start", "middle", "end"]);   // N, E, S, W
});
