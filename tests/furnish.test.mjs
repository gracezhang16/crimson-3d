// Tests for furnishing suites with Harvard furniture (static/js/planner/furnish.js).
// Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chairInFront, furnish, studentsPerRoom } from "../static/js/planner/furnish.js";
import { evaluate, footprintBox, insideRoom, itemDimensions } from "../static/js/planner/rules.js";

// The real catalog and sample suites, with ids as init_db.py gives them (1, 2, ...).
const CATALOG = JSON.parse(readFileSync(new URL("../seed/furniture.json", import.meta.url), "utf8"))
  .map((item, i) => ({ ...item, id: i + 1 }));
const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));
const seedSuite = (file) => JSON.parse(readFileSync(new URL(`../seed/suites/${file}`, import.meta.url), "utf8"));
const slugs = (placements) => placements.map((p) => BY_ID.get(p.furniture_id).slug);
const count = (list, slug) => list.filter((s) => s === slug).length;
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

test("studentsPerRoom shares the capacity across bedrooms, extra to the biggest", () => {
  const rooms = [
    { kind: "bedroom", outline: rect(0, 0, 100, 100) },
    { kind: "common", outline: rect(105, 0, 200, 200) },
    { kind: "bedroom", outline: rect(0, 105, 140, 140) },   // the biggest bedroom
    { kind: "bedroom", outline: rect(0, 250, 100, 100) },
    { kind: "hallway", outline: rect(310, 0, 48, 200) },
  ];
  assert.deepEqual(studentsPerRoom(rooms, 4), [1, 0, 2, 1, 0]);
  assert.deepEqual(studentsPerRoom(rooms, 3), [1, 0, 1, 1, 0]);
  assert.deepEqual(studentsPerRoom(rooms, 1), [0, 0, 1, 0, 0]);
  assert.deepEqual(studentsPerRoom([{ kind: "common", outline: rect(0, 0, 9, 9) }], 2), [0]);
});

test("a single gets one full set, with no wardrobe when the room has a closet", () => {
  const suite = seedSuite("demo-hall-single.json");
  const placed = slugs(furnish(suite.geometry, 1, CATALOG));
  for (const slug of ["bed-twin-xl", "desk", "desk-chair", "dresser", "bookcase", "floor-lamp"]) {
    assert.equal(count(placed, slug), 1, slug);
  }
  const hasCloset = suite.geometry.rooms[0].features.some((f) => f.kind === "closet");
  assert.equal(count(placed, "wardrobe"), hasCloset ? 0 : 1);
});

test("a bedroom with no closet gets a wardrobe", () => {
  const geometry = { rooms: [{ kind: "bedroom", outline: rect(0, 0, 150, 180), features: [] }] };
  assert.equal(count(slugs(furnish(geometry, 1, CATALOG)), "wardrobe"), 1);
});

test("a double gets two sets in its one bedroom", () => {
  const suite = seedSuite("demo-hall-double.json");
  const placed = slugs(furnish(suite.geometry, 2, CATALOG));
  assert.equal(count(placed, "bed-twin-xl"), 2);
  assert.equal(count(placed, "desk"), 2);
  assert.equal(count(placed, "desk-chair"), 2);
});

test("the two-bedroom suite: a set in each bedroom, nothing in the common room", () => {
  const { geometry } = seedSuite("demo-hall-two-bedroom-suite.json");
  const placements = furnish(geometry, 2, CATALOG);
  const common = geometry.rooms.find((room) => room.kind === "common");
  const inCommon = placements.filter((p) => insideRoom(footprintBox(p, BY_ID.get(p.furniture_id)), common.outline));
  assert.equal(inCommon.length, 0);
  assert.equal(count(slugs(placements), "bed-twin-xl"), 2);
});

for (const [file, capacity] of [["demo-hall-single.json", 1], ["demo-hall-double.json", 2], ["demo-hall-two-bedroom-suite.json", 2]]) {
  test(`everything furnished in ${file} fits: inside its room, clear of doors and of each other`, () => {
    const { geometry } = seedSuite(file);
    const placements = furnish(geometry, capacity, CATALOG);
    const entries = placements.map((placement) => ({ placement, item: itemDimensions(placement, BY_ID) }));
    assert.deepEqual(evaluate(geometry, entries), entries.map(() => null));
  });
}

test("each desk chair sits at the front of a desk, facing it", () => {
  const { geometry } = seedSuite("demo-hall-double.json");
  const placements = furnish(geometry, 2, CATALOG);
  const desk = CATALOG.find((item) => item.slug === "desk");
  const chair = CATALOG.find((item) => item.slug === "desk-chair");
  const desks = placements.filter((p) => p.furniture_id === desk.id);
  const chairs = placements.filter((p) => p.furniture_id === chair.id);
  for (const d of desks) {
    const want = chairInFront(d, desk, chair);
    assert.ok(chairs.some((c) => c.x === want.x && c.y === want.y && c.rotation === want.rotation), "a chair in front");
  }
});

test("chairInFront: at rotation 0 a desk faces south, at 270 east (as in the sample layouts)", () => {
  const desk = { depth: 24 };
  const chair = { depth: 18 };
  assert.deepEqual(chairInFront({ x: 50, y: 12, rotation: 0 }, desk, chair), { x: 50, y: 33, rotation: 180 });
  assert.deepEqual(chairInFront({ x: 12, y: 103, rotation: 270 }, desk, chair), { x: 33, y: 103, rotation: 90 });
});

test("a room too small for everything gets what fits, never pieces on top of each other", () => {
  const geometry = { rooms: [{ kind: "bedroom", outline: rect(0, 0, 50, 90), features: [] }] };
  const placements = furnish(geometry, 1, CATALOG);
  const entries = placements.map((placement) => ({ placement, item: itemDimensions(placement, BY_ID) }));
  assert.ok(placements.length > 0 && placements.length < 7);
  assert.deepEqual(evaluate(geometry, entries), entries.map(() => null));
});

test("items missing from the catalog are skipped", () => {
  const { geometry } = seedSuite("demo-hall-single.json");
  const placed = slugs(furnish(geometry, 1, CATALOG.filter((item) => item.slug !== "floor-lamp")));
  assert.equal(count(placed, "floor-lamp"), 0);
  assert.equal(count(placed, "bed-twin-xl"), 1);
});
