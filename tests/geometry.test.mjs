// Tests for static/js/shared/geometry.js. Run with: node --test tests/*.test.mjs
// These mirror tests/test_geometry.py so both halves of the contract agree.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  walls,
  wallLength,
  wallLetter,
  signedArea,
  inwardNormal,
  pointAlongWall,
  featureSpan,
} from "../static/js/shared/geometry.js";

// A 114 x 150 rectangle, drawn clockwise from the top-left corner.
const RECT = [[0, 0], [114, 0], [114, 150], [0, 150]];

// An L-shape: a 120-wide top bar and a 60-wide leg going down on the left.
// Corner [60, 60] is the inner corner.
const L_SHAPE = [[0, 0], [120, 0], [120, 60], [60, 60], [60, 150], [0, 150]];

/** True if every coordinate of two points is within 1e-9. */
function close(a, b) {
  return a.every((value, k) => Math.abs(value - b[k]) < 1e-9);
}

test("walls close the shape back to the first corner", () => {
  const result = walls(RECT);
  assert.equal(result.length, 4);
  assert.deepEqual(result[0], { start: [0, 0], end: [114, 0] });
  assert.deepEqual(result[3], { start: [0, 150], end: [0, 0] });
});

test("wall lengths", () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => wallLength(RECT, i)), [114, 150, 114, 150]);
  assert.equal(wallLength([[0, 0], [30, 0], [0, 40]], 1), 50); // 3-4-5 triangle
});

test("wall letters", () => {
  assert.equal(wallLetter(0), "A");
  assert.equal(wallLetter(3), "D");
});

test("clockwise outlines have positive signed area", () => {
  assert.equal(signedArea(RECT), 114 * 150);
  assert.equal(signedArea(L_SHAPE), 120 * 60 + 60 * 90);
  assert.equal(signedArea([...RECT].reverse()), -114 * 150);
});

test("inward normals of a rectangle point into the room", () => {
  assert.deepEqual(inwardNormal(RECT, 0), [0, 1]); // top wall -> down
  assert.deepEqual(inwardNormal(RECT, 1), [-1, 0]); // right wall -> left
  assert.deepEqual(inwardNormal(RECT, 2), [0, -1]); // bottom wall -> up
  assert.deepEqual(inwardNormal(RECT, 3), [1, 0]); // left wall -> right
});

test("inward normals at the inner corner of an L-shape", () => {
  assert.deepEqual(inwardNormal(L_SHAPE, 2), [0, -1]); // inner horizontal wall faces up
  assert.deepEqual(inwardNormal(L_SHAPE, 3), [-1, 0]); // inner vertical wall faces left
});

test("inward normals do not depend on drawing order", () => {
  // Reversing the outline reverses each wall too, but "inside" must not move.
  // Original wall i (corner i to i+1) is reversed wall (n - 2 - i) mod n.
  const n = RECT.length;
  const reversed = [...RECT].reverse();
  for (let i = 0; i < n; i++) {
    assert.deepEqual(inwardNormal(reversed, (2 * n - 2 - i) % n), inwardNormal(RECT, i));
  }
});

test("a wall's start corner is on your left as you face it from inside", () => {
  for (const outline of [RECT, L_SHAPE]) {
    walls(outline).forEach(({ start, end }, i) => {
      const [nx, ny] = inwardNormal(outline, i);
      // Facing the wall from inside means looking against the inward normal.
      const facing = [-nx, -ny];
      // With y pointing down, "left" of a facing direction (fx, fy) is (fy, -fx).
      const left = [facing[1], -facing[0]];
      const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const toStart = [start[0] - middle[0], start[1] - middle[1]];
      const dot = toStart[0] * left[0] + toStart[1] * left[1];
      assert.ok(dot > 0, `wall ${wallLetter(i)}: start corner should be on the left`);
    });
  }
});

test("points along a wall", () => {
  assert.deepEqual(pointAlongWall(RECT, 0, 36), [36, 0]);
  assert.deepEqual(pointAlongWall(RECT, 3, 8), [0, 142]); // left wall runs upward
  assert.ok(close(pointAlongWall([[0, 0], [30, 0], [0, 40]], 1, 25), [15, 20]));
});

test("feature spans", () => {
  const window = { kind: "window", wall: 0, offset: 36, width: 42, height: 54, sill: 30 };
  assert.deepEqual(featureSpan(RECT, window), { start: [36, 0], end: [78, 0] });

  const door = { kind: "door", wall: 2, offset: 10, width: 34, height: 80 };
  assert.deepEqual(featureSpan(RECT, door), { start: [104, 150], end: [70, 150] });

  const outlet = { kind: "outlet", wall: 1, offset: 20 };
  assert.deepEqual(featureSpan(RECT, outlet), { start: [114, 20], end: [114, 20] });
});
