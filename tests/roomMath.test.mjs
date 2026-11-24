// Tests for static/js/planner/roomMath.js. Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import {
  arrowDirection, cameraOutsideWall, cutIntervals, insideWallBoxes, insideWalls, isConvexCorner,
} from "../static/js/planner/roomMath.js";

// Clockwise on screen from the top-left corner, as in SPEC.md 4.1.
const RECT = [[0, 0], [114, 0], [114, 150], [0, 150]];
// A 120-wide top bar with a 60-wide leg down the left. Corner 3, (60, 60),
// is the inner corner.
const L_SHAPE = [[0, 0], [120, 0], [120, 60], [60, 60], [60, 150], [0, 150]];

test("every corner of a rectangle is convex", () => {
  for (let i = 0; i < RECT.length; i++) {
    assert.equal(isConvexCorner(RECT, i), true, `corner ${i}`);
  }
});

test("the inner corner of an L-shape is not convex; the rest are", () => {
  const convex = L_SHAPE.map((_, i) => isConvexCorner(L_SHAPE, i));
  assert.deepEqual(convex, [true, true, true, false, true, true]);
});

test("convexity doesn't depend on drawing direction", () => {
  const reversed = [...L_SHAPE].reverse(); // counter-clockwise; (60, 60) is now index 2
  assert.equal(isConvexCorner(reversed, 2), false);
  assert.equal(isConvexCorner(reversed, 0), true);
});

test("a straight-through corner is not convex", () => {
  const withMidpoint = [[0, 0], [57, 0], [114, 0], [114, 150], [0, 150]];
  assert.equal(isConvexCorner(withMidpoint, 1), false);
});

test("from the south-east, the south and east walls hide the room", () => {
  // Walls: 0 north, 1 east, 2 south, 3 west.
  const camera = [300, 400];
  const hidden = RECT.map((_, i) => cameraOutsideWall(RECT, i, camera));
  assert.deepEqual(hidden, [false, true, true, false]);
});

test("from the north-west, the north and west walls hide the room", () => {
  const hidden = RECT.map((_, i) => cameraOutsideWall(RECT, i, [-50, -80]));
  assert.deepEqual(hidden, [true, false, false, true]);
});

test("straight overhead, no wall hides the room", () => {
  const hidden = RECT.map((_, i) => cameraOutsideWall(RECT, i, [57, 75]));
  assert.deepEqual(hidden, [false, false, false, false]);
});

test("L-shape from the south: the inner wall and the leg's south wall hide the room", () => {
  // Walls: 0 top, 1 right of bar, 2 bottom of bar (inner), 3 inner side of leg,
  // 4 bottom of leg, 5 left.
  const hidden = L_SHAPE.map((_, i) => cameraOutsideWall(L_SHAPE, i, [40, 400]));
  assert.deepEqual(hidden, [false, false, true, false, true, false]);
});


const arrows = (forward) => Object.fromEntries(
  ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((key) => [key, arrowDirection(key, forward)]),
);

test("looking north (camera south of the room), arrows match the compass", () => {
  assert.deepEqual(arrows([0, -1]), {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  });
});

test("looking south (camera north of the room), arrows are reversed", () => {
  assert.deepEqual(arrows([0, 1]), {
    ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0],
  });
});

test("looking east, up moves east and right moves south", () => {
  assert.deepEqual(arrows([1, 0.2]), {
    ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
  });
});

test("from the default south-east view, up is north (the nearer axis)", () => {
  // The camera sits south-east, looking north-west: more north than west.
  assert.deepEqual(arrowDirection("ArrowUp", [-0.55, -1]), [0, -1]);
});

test("straight overhead, arrows fall back to the compass", () => {
  assert.deepEqual(arrowDirection("ArrowUp", [0, 0]), [0, -1]);
  assert.deepEqual(arrowDirection("ArrowRight", [0, 0]), [1, 0]);
});


// --- Suites: walls between rooms (U2) -------------------------------------------

const SAMPLE_SUITE = JSON.parse(readFileSync(
  new URL("../seed/suites/demo-hall-two-bedroom-suite.json", import.meta.url), "utf8",
)).geometry;
// Rooms: 0 Bedroom A (0..120 x 0..144), 1 Bedroom B (0..120 x 149..293),
// 2 Common room (125..305 x 0..293). Walls: 0 north, 1 east, 2 south, 3 west.

test("a one-room suite has no inside walls", () => {
  const single = { rooms: [{ outline: RECT, features: [] }] };
  assert.deepEqual(insideWalls(single)[0].map((w) => w.inside), [false, false, false, false]);
});

test("the sample suite's walls between rooms are found, with their 5 in gap", () => {
  const walls = insideWalls(SAMPLE_SUITE);
  assert.deepEqual(walls[0].map((w) => w.inside), [false, true, true, false]);   // A: east and south
  assert.deepEqual(walls[1].map((w) => w.inside), [true, true, false, false]);   // B: north and east
  assert.deepEqual(walls[2].map((w) => w.inside), [false, false, false, true]);  // common: west
  assert.equal(walls[0][1].gap, 5);
  assert.equal(walls[2][3].gap, 5);
});

test("a door between rooms opens both walls", () => {
  const walls = insideWalls(SAMPLE_SUITE);
  // Bedroom A's door: east wall, 100 in from its north end, 32 wide.
  assert.deepEqual(walls[0][1].doorways, [[100, 132, 80]]);   // from, to, door height
  assert.deepEqual(walls[0][1].pieces, [[0, 100], [132, 144]]);
  // The common room's west wall runs north from (125, 293): A's door (y 100..132)
  // is 161..193 along it, and B's door (y 153..185) is 108..140.
  assert.deepEqual(walls[2][3].doorways.sort((p, q) => p[0] - q[0]), [[108, 140, 80], [161, 193, 80]]);
  assert.deepEqual(walls[2][3].pieces, [[0, 108], [140, 161], [193, 293]]);
});

test("rooms sharing a wall (no gap) still find each other", () => {
  const shared = { rooms: [
    { outline: [[0, 0], [100, 0], [100, 100], [0, 100]], features: [] },
    { outline: [[100, 0], [200, 0], [200, 100], [100, 100]], features: [] },
  ] };
  const walls = insideWalls(shared);
  assert.equal(walls[0][1].inside, true);
  assert.equal(walls[0][1].gap, 0);
  assert.equal(walls[1][3].inside, true);
});

test("walls 13 in apart are not between rooms", () => {
  const apart = { rooms: [
    { outline: [[0, 0], [100, 0], [100, 100], [0, 100]], features: [] },
    { outline: [[113, 0], [200, 0], [200, 100], [113, 100]], features: [] },
  ] };
  assert.equal(insideWalls(apart)[0][1].inside, false);
});

test("cutIntervals", () => {
  assert.deepEqual(cutIntervals(100, []), [[0, 100]]);
  assert.deepEqual(cutIntervals(100, [[10, 20], [50, 60]]), [[0, 10], [20, 50], [60, 100]]);
  assert.deepEqual(cutIntervals(100, [[0, 30], [90, 120]]), [[30, 90]]);
  assert.deepEqual(cutIntervals(100, [[10, 40], [30, 50]]), [[0, 10], [50, 100]]);
});

test("insideWallBoxes covers the gaps between rooms", () => {
  const boxes = insideWallBoxes(SAMPLE_SUITE);
  assert.ok(boxes.some((b) => b.minX === 120 && b.maxX === 125 && b.minY === 0 && b.maxY === 144));
  assert.ok(boxes.some((b) => b.minY === 144 && b.maxY === 149 && b.minX === 0 && b.maxX === 120));
});
