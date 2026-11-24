// Tests for static/js/planner/roomMath.js. Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { arrowDirection, cameraOutsideWall, isConvexCorner } from "../static/js/planner/roomMath.js";

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
