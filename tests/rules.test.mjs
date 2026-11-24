// Tests for static/js/planner/rules.js. Run with: node --test tests/*.test.mjs
// P3: zones. P7 adds footprint, overlap, inside, snap and issues.

import { test } from "node:test";
import assert from "node:assert/strict";

import { zones } from "../static/js/planner/rules.js";

// 114 × 150 rectangle, clockwise from the top-left: walls 0 N, 1 E, 2 S, 3 W.
const RECT = [[0, 0], [114, 0], [114, 150], [0, 150]];
const L_SHAPE = [[0, 0], [120, 0], [120, 60], [60, 60], [60, 150], [0, 150]];

function room(outline, ...features) {
  return { outline, features };
}

test("a door on the north wall makes a width × width square inside the room", () => {
  const [zone] = zones(room(RECT, { kind: "door", wall: 0, offset: 10, width: 34, height: 80 }));
  assert.equal(zone.kind, "door");
  assert.equal(zone.issue, "Blocks the door");
  assert.deepEqual(zone.corners, [[10, 0], [44, 0], [44, 34], [10, 34]]);
  assert.deepEqual(zone.box, { minX: 10, minY: 0, maxX: 44, maxY: 34 });
});

test("offset counts from the wall's left corner as seen from inside", () => {
  // The south wall runs east to west, so its start (left) corner is (114, 150).
  const [zone] = zones(room(RECT, { kind: "door", wall: 2, offset: 10, width: 34, height: 80 }));
  assert.deepEqual(zone.box, { minX: 70, minY: 116, maxX: 104, maxY: 150 });
});

test("zones on the east and west walls reach inward", () => {
  const [east, west] = zones(room(RECT,
    { kind: "door", wall: 1, offset: 0, width: 30, height: 80 },
    { kind: "door", wall: 3, offset: 0, width: 30, height: 80 },
  ));
  assert.deepEqual(east.box, { minX: 84, minY: 0, maxX: 114, maxY: 30 });
  // The west wall runs north from (0, 150), so offset 0 is its south end.
  assert.deepEqual(west.box, { minX: 0, minY: 120, maxX: 30, maxY: 150 });
});

test("a closet zone is 24 in deep and a radiator's is its depth (default 6)", () => {
  const [closet, radiator, deepRadiator] = zones(room(RECT,
    { kind: "closet", wall: 0, offset: 0, width: 60, height: 84 },
    { kind: "radiator", wall: 0, offset: 70, width: 30, height: 24 },
    { kind: "radiator", wall: 2, offset: 0, width: 30, height: 24, depth: 10 },
  ));
  assert.equal(closet.box.maxY, 24);
  assert.equal(closet.issue, "Blocks the closet");
  assert.equal(radiator.box.maxY, 6);
  assert.equal(radiator.issue, "Hits the radiator");
  assert.equal(deepRadiator.box.minY, 140);
});

test("windows and outlets make no zone", () => {
  assert.deepEqual(zones(room(RECT,
    { kind: "window", wall: 0, offset: 10, width: 40, height: 50, sill: 30 },
    { kind: "outlet", wall: 1, offset: 20 },
  )), []);
});

test("a door on the inner wall of an L-shape opens into the room", () => {
  // Wall 3 runs south from the inner corner (60, 60); inside is to the west.
  const [zone] = zones(room(L_SHAPE, { kind: "door", wall: 3, offset: 20, width: 30, height: 80 }));
  assert.deepEqual(zone.box, { minX: 30, minY: 80, maxX: 60, maxY: 110 });
});
