// Tests for arranging rooms by dragging (static/js/builder/arrange.js).
// Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  bounds, normalizePositions, overlapProblems, roomsOverlap, snapRoom,
} from "../static/js/builder/arrange.js";

const box = (x, y, w, h) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
const BEDROOM = box(0, 0, 120, 144);

test("bounds gives an outline's bounding box", () => {
  assert.deepEqual(bounds([[0, 0], [120, 0], [120, 60], [60, 60], [60, 144], [0, 144]]), box(0, 0, 120, 144));
});

test("a room dragged close to the east side of another snaps one wall's thickness away", () => {
  // Dropped with its west edge at 130 (10 in from the bedroom, 5 in gap wanted).
  const { dx, dy, guides } = snapRoom(box(130, 3, 180, 293), [BEDROOM], 5);
  assert.equal(dx, -5);               // west edge to 125 = 120 + 5
  assert.equal(dy, -3);               // top lines up with the bedroom's top
  assert.deepEqual(guides.map((g) => g.axis).sort(), ["x", "y"]);
  assert.equal(guides.find((g) => g.axis === "x").at, 122.5); // middle of the wall
});

test("a room dragged below another snaps under it with the gap", () => {
  const { dx, dy } = snapRoom(box(4, 153, 120, 144), [BEDROOM], 5);
  assert.deepEqual({ dx, dy }, { dx: -4, dy: -4 }); // left edges line up; top at 149 = 144 + 5
});

test("nothing snaps when the room is further away than the snap distance", () => {
  assert.deepEqual(snapRoom(box(300, 300, 50, 50), [BEDROOM], 5), { dx: 0, dy: 0, guides: [] });
});

test("the nearest neighbour wins", () => {
  const hallway = box(125, 0, 48, 293);
  // A common room dropped between: 6 in from the hallway's east side (173 + 5 wanted = 178).
  const { dx } = snapRoom(box(184, 0, 180, 293), [BEDROOM, hallway], 5);
  assert.equal(dx, -6);
});

test("normalizePositions moves the suite's north-west corner to (0, 0)", () => {
  assert.deepEqual(normalizePositions([{ x: -30, y: 10 }, { x: 95, y: -12 }]), [{ x: 0, y: 22 }, { x: 125, y: 0 }]);
  assert.deepEqual(normalizePositions([{ x: 40, y: 40 }]), [{ x: 0, y: 0 }]);
  assert.deepEqual(normalizePositions([]), []);
});

// --- Overlap: the same answers as geometry.py ------------------------------------

const { cases: OVERLAP_CASES } = JSON.parse(
  readFileSync(new URL("./fixtures/overlap_cases.json", import.meta.url), "utf8"),
);

for (const testCase of OVERLAP_CASES) {
  test(`shared overlap case: ${testCase.name}`, () => {
    assert.equal(roomsOverlap(testCase.a, testCase.b), testCase.overlap);
    assert.equal(roomsOverlap(testCase.b, testCase.a), testCase.overlap);
  });
}

test("overlapProblems names the rooms in the server's words", () => {
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const problems = overlapProblems([
    { name: "Bedroom A", outline: rect(0, 0, 120, 144) },
    { name: "Hallway", outline: rect(100, 0, 48, 293) },
    { name: "Common room", outline: rect(153, 0, 180, 293) },
    { name: "Unfinished", outline: null },
  ]);
  assert.deepEqual(problems, [{
    message: "Bedroom A and Hallway overlap. Rooms may share a wall but not floor space.",
    rooms: [0, 1],
  }]);
});
