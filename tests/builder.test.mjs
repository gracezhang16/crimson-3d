// Tests for the admin builder's pure code: static/js/builder/state.js and the
// helpers in static/js/builder/preview.js. Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildGeometry,
  buildSuite,
  featureFromValues,
  featureProblems,
  geometryToForm,
  newRoom,
  parseRoom,
  positionNextTo,
  outlineFromWalls,
  parseInches,
  rectangleOutline,
  rectangleWalls,
  wallProblem,
} from "../static/js/builder/state.js";
import { featureRect, labelAnchor, labelPoint, previewBox, wallSegments } from "../static/js/builder/preview.js";

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
    version: 2, units: "in", ceiling: 102,
    rooms: [{ name: "Main room", kind: "bedroom", outline: [[0, 0], [114, 0], [114, 150], [0, 150]], features: [] }],
  });
});

test("rectangle sizes and ceiling are checked", () => {
  const { geometry, errors } = buildGeometry({ shape: "rectangle", width: NaN, length: 1201, ceiling: 50 });
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
    "Wall C: Length must be a whole number from 1 to 1200 in.",
  ]);
});

test("wallProblem", () => {
  assert.equal(wallProblem(wall("north", 1)), null);
  assert.equal(wallProblem(wall("north", 1200)), null);
  assert.match(wallProblem(wall("north", 0)), /1 to 1200/);
  assert.match(wallProblem(wall("north", 1201)), /1 to 1200/);
});

test("a room bigger than 1200 in is rejected", () => {
  const { errors } = outlineFromWalls(rectangleWalls(1210, 100));
  assert.ok(errors.some((e) => /1 to 1200/.test(e)));
});

test("buildGeometry uses the walls in walls mode", () => {
  const { geometry, errors } = buildGeometry({ shape: "walls", walls: L_WALLS, ceiling: 96 });
  assert.deepEqual(errors, []);
  assert.deepEqual(geometry.rooms[0].outline, L_OUTLINE);
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


// --- Features (A3) ---------------------------------------------------------------

// The same cases tests/test_geometry.py checks against geometry.validate_room,
// so the builder's inline errors match the server's word for word.
const { cases: FEATURE_CASES } = JSON.parse(
  readFileSync(new URL("./fixtures/feature_cases.json", import.meta.url), "utf8"),
);
const RECT_114 = [[0, 0], [114, 0], [114, 150], [0, 150]];

for (const testCase of FEATURE_CASES) {
  test(`shared feature case: ${testCase.name}`, () => {
    const features = testCase.features === "41 outlets"
      ? Array(41).fill({ kind: "outlet", wall: 0, offset: 1 })
      : testCase.features;
    const { general, perFeature } = featureProblems(testCase.outline ?? RECT_114, features, 102);
    assert.deepEqual([...general, ...perFeature.flat()], testCase.expected);
  });
}

test("featureProblems lists problems per feature, for the table rows", () => {
  const { perFeature } = featureProblems(RECT_114, [
    { kind: "outlet", wall: 0, offset: 10 },
    { kind: "outlet", wall: 0, offset: 500 },
  ], 102);
  assert.deepEqual(perFeature[0], []);
  assert.match(perFeature[1][0], /^Outlet 2 is past the end of wall A/);
});

test("featureFromValues keeps only the keys each kind uses", () => {
  const values = { wall: 1, offset: 5, width: 30, height: 80, sill: 30, depth: 6 };
  assert.deepEqual(featureFromValues({ ...values, kind: "outlet" }), { kind: "outlet", wall: 1, offset: 5 });
  assert.deepEqual(featureFromValues({ ...values, kind: "door" }),
    { kind: "door", wall: 1, offset: 5, width: 30, height: 80 });
  assert.deepEqual(featureFromValues({ ...values, kind: "window" }),
    { kind: "window", wall: 1, offset: 5, width: 30, height: 80, sill: 30 });
  assert.deepEqual(featureFromValues({ ...values, kind: "radiator" }),
    { kind: "radiator", wall: 1, offset: 5, width: 30, height: 80, depth: 6 });
});

test("a radiator's empty height and depth are left out, not NaN", () => {
  const radiator = featureFromValues({ kind: "radiator", wall: 0, offset: 0, width: 30, height: NaN, sill: NaN, depth: NaN });
  assert.deepEqual(radiator, { kind: "radiator", wall: 0, offset: 0, width: 30 });
});

test("buildGeometry includes features and their errors", () => {
  const window = { kind: "window", wall: 0, offset: 0, width: 120, height: 54, sill: 30 };
  const { geometry, errors, featureErrors } = buildGeometry({
    shape: "rectangle", width: 114, length: 150, ceiling: 102, features: [window],
  });
  assert.deepEqual(geometry.rooms[0].features, [window]);
  assert.deepEqual(errors, ["Window 1 is wider than wall A (120 in on a 114 in wall)."]);
  assert.deepEqual(featureErrors, [["Window 1 is wider than wall A (120 in on a 114 in wall)."]]);
});

test("features aren't checked until the outline is valid", () => {
  const { featureErrors } = buildGeometry({
    shape: "rectangle", width: NaN, length: 150, ceiling: 102,
    features: [{ kind: "outlet", wall: 9, offset: 0 }],
  });
  assert.deepEqual(featureErrors, [[]]);
});

test("with a bad ceiling, feature heights are checked against 240 in", () => {
  const tallDoor = { kind: "door", wall: 0, offset: 0, width: 34, height: 200 };
  const { errors } = buildGeometry({ shape: "rectangle", width: 114, length: 150, ceiling: NaN, features: [tallDoor] });
  assert.equal(errors.length, 1);   // only the ceiling message; 200 <= 240
});


test("featureRect: a door's zone on the south wall, measured from its left corner", () => {
  // The south wall runs east to west from (114, 150); inside is north.
  const door = { kind: "door", wall: 2, offset: 10, width: 34, height: 80 };
  assert.deepEqual(featureRect(RECT_114, door, 34), [[104, 150], [70, 150], [70, 116], [104, 116]]);
});

test("featureRect on the west wall reaches east into the room", () => {
  const closet = { kind: "closet", wall: 3, offset: 30, width: 60, height: 84 };
  assert.deepEqual(featureRect(RECT_114, closet, 24), [[0, 120], [0, 60], [24, 60], [24, 120]]);
});

// --- geometryToForm (A4) ----------------------------------------------------------

/** A one-room suite (format version 2). */
const oneRoom = (ceiling, outline, features = []) => ({
  version: 2, units: "in", ceiling, rooms: [{ name: "Main room", kind: "bedroom", outline, features }],
});

test("a saved two-room suite opens as two rooms with their positions", () => {
  const two = oneRoom(96, rectangleOutline(100, 100));
  two.rooms.push({ name: "Common room", kind: "common", outline: [[105, 0], [200, 0], [200, 100], [105, 100]], features: [] });
  const form = geometryToForm(two);
  assert.deepEqual(form.rooms.map((r) => [r.name, r.kind, r.x, r.y, r.width, r.length]),
    [["Main room", "bedroom", "0", "0", "100", "100"], ["Common room", "common", "105", "0", "95", "100"]]);
});

test("a saved rectangle opens in Rectangle mode", () => {
  const door = { kind: "door", wall: 2, offset: 10, width: 34, height: 80 };
  const form = geometryToForm(oneRoom(102, rectangleOutline(114, 150), [door]));
  assert.equal(form.ceiling, "102");
  const [room] = form.rooms;
  assert.deepEqual([room.shape, room.width, room.length, room.x, room.y], ["rectangle", "114", "150", "0", "0"]);
  assert.deepEqual(room.features, [{ kind: "door", wall: "2", offset: "10", width: "34", height: "80", sill: "", depth: "" }]);
});

test("a saved L-shape opens as walked walls that rebuild the same outline", () => {
  const [room] = geometryToForm(oneRoom(96, L_OUTLINE)).rooms;
  assert.equal(room.shape, "walls");
  const walls = room.walls.map((w) => ({ direction: w.direction, length: Number(w.length) }));
  assert.deepEqual(walls, L_WALLS);
  assert.deepEqual(outlineFromWalls(walls).outline, L_OUTLINE);   // round trip
});

test("a rectangle not starting at the north-west corner opens as walls", () => {
  const [room] = geometryToForm(oneRoom(96, [[114, 0], [114, 150], [0, 150], [0, 0]])).rooms;
  assert.equal(room.shape, "walls");
  assert.deepEqual(room.walls.map((w) => w.direction), ["south", "west", "north", "east"]);
});

test("a room with an angled wall can't be shown in the form", () => {
  assert.equal(geometryToForm(oneRoom(96, [[0, 0], [100, 0], [0, 100]])), null);
});


// --- Suites (U3) -------------------------------------------------------------------

const BEDROOM_A = { ...newRoom("Bedroom A"), width: "120", length: "144" };
const COMMON_ROOM = { ...newRoom("Common room", "common", { x: 125, y: 0 }), width: "180", length: "293" };

test("buildSuite moves each room to its position", () => {
  const { geometry, errors } = buildSuite({ ceiling: 102, rooms: [BEDROOM_A, COMMON_ROOM].map(parseRoom) });
  assert.deepEqual(errors, []);
  assert.equal(geometry.version, 2);
  assert.deepEqual(geometry.rooms.map((r) => [r.name, r.kind]), [["Bedroom A", "bedroom"], ["Common room", "common"]]);
  assert.deepEqual(geometry.rooms[1].outline, [[125, 0], [305, 0], [305, 293], [125, 293]]);
});

test("in a suite with several rooms, problems name the room", () => {
  const badWindow = { kind: "window", wall: "0", offset: "0", width: "200", height: "50", sill: "30", depth: "" };
  const rooms = [BEDROOM_A, { ...COMMON_ROOM, features: [badWindow] }].map(parseRoom);
  const { errors, rooms: views } = buildSuite({ ceiling: 102, rooms });
  assert.deepEqual(errors, ["Common room: Window 1 is wider than wall A (200 in on a 180 in wall)."]);
  assert.deepEqual(views[1].featureErrors, [["Window 1 is wider than wall A (200 in on a 180 in wall)."]]);
});

test("room names, kinds and positions are checked", () => {
  const rooms = [
    { ...BEDROOM_A, name: "  " },
    { ...COMMON_ROOM, kind: "kitchen", x: "-5" },
  ].map(parseRoom);
  const { errors, geometry } = buildSuite({ ceiling: 102, rooms });
  assert.deepEqual(errors, [
    "Room 1: Give the room a name of 1 to 40 characters.",
    "Common room: Room kind must be bedroom, common or hallway.",
    "Common room: Position must be whole numbers from 0 to 1200 in.",
  ]);
  assert.ok(geometry, "still drawn in the preview");
});

test("a room pushed past 1200 in is rejected", () => {
  const far = parseRoom({ ...COMMON_ROOM, x: "1100" });
  assert.ok(buildSuite({ ceiling: 102, rooms: [far] }).errors[0].includes("fit within 1200"));
});

test("a suite needs 1 to 8 rooms", () => {
  assert.deepEqual(buildSuite({ ceiling: 102, rooms: [] }).errors, ["A suite needs 1 to 8 rooms."]);
});

test("positionNextTo leaves a wall's gap east or south of a room", () => {
  const bedroom = rectangleOutline(120, 144);
  assert.deepEqual(positionNextTo(bedroom, "east", 5), { x: 125, y: 0 });
  assert.deepEqual(positionNextTo(bedroom, "south", 5), { x: 0, y: 149 });
  assert.deepEqual(positionNextTo([[125, 0], [305, 0], [305, 293], [125, 293]], "south", 0), { x: 125, y: 293 });
});

test("parseRoom turns typed text into numbers and features", () => {
  const raw = { ...newRoom("Bedroom"), width: "12a", features: [{ kind: "outlet", wall: "1", offset: "20", width: "", height: "", sill: "", depth: "" }] };
  const room = parseRoom(raw);
  assert.ok(Number.isNaN(room.width));
  assert.deepEqual(room.features, [{ kind: "outlet", wall: 1, offset: 20 }]);
});

test("the sample suite survives a round trip through the form", () => {
  const sample = JSON.parse(readFileSync(new URL("../seed/suites/demo-hall-two-bedroom-suite.json", import.meta.url), "utf8")).geometry;
  const form = geometryToForm(sample);
  const { geometry, errors } = buildSuite({ ceiling: Number(form.ceiling), rooms: form.rooms.map(parseRoom) });
  assert.deepEqual(errors, []);
  assert.deepEqual(geometry, sample);
});

test("a new hallway starts long and thin, and builds as a hallway", () => {
  const hallway = newRoom("Hallway", "hallway", { x: 0, y: 149 });
  assert.equal(hallway.width, "48");
  assert.equal(hallway.length, "180");
  const { geometry, errors } = buildSuite({ ceiling: 102, rooms: [parseRoom(newRoom("Bedroom A")), parseRoom(hallway)] });
  assert.deepEqual(errors, []);
  assert.equal(geometry.rooms[1].kind, "hallway");
});
