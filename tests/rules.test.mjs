// Tests for static/js/planner/rules.js. Run with: node --test tests/*.test.mjs
// P3: zones. P4: item sizes and footprints. P5: overlap, inside, snap, free spot.
// P7: evaluate (flat items, clearance, issues and their priority).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  checkCustomItem, evaluate, findFreeSpot, footprint, footprintBox, insideAnyRoom, insideRoom, itemDimensions,
  mayOverlap, overlaps, pointInPolygon, snap, zones,
} from "../static/js/planner/rules.js";

// 114 × 150 rectangle, clockwise from the top-left: walls 0 N, 1 E, 2 S, 3 W.
const RECT = [[0, 0], [114, 0], [114, 150], [0, 150]];
const L_SHAPE = [[0, 0], [120, 0], [120, 60], [60, 60], [60, 150], [0, 150]];

/** A one-room suite with these features. */
function room(outline, ...features) {
  return { rooms: [{ outline, features }] };
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


// --- Item sizes and footprints (P4) --------------------------------------------

const BED = { id: 1, slug: "bed-twin-xl", name: "Bed, twin XL", category: "harvard",
  width: 40, depth: 84, height: 36, clearance: 14, color: "#b8875a", note: "" };
const CATALOG = new Map([[1, BED]]);

test("itemDimensions takes a catalog item's size from the catalog", () => {
  assert.deepEqual(itemDimensions({ furniture_id: 1, x: 0, y: 0, rotation: 0 }, CATALOG), {
    name: "Bed, twin XL", slug: "bed-twin-xl", width: 40, depth: 84, height: 36, clearance: 14,
    color: "#b8875a", category: "harvard",
  });
});

test("itemDimensions takes a custom item's size from the placement", () => {
  const beanBag = { furniture_id: null, label: "Bean bag chair", width: 36, depth: 36, height: 28, x: 0, y: 0, rotation: 0 };
  const item = itemDimensions(beanBag, CATALOG);
  assert.equal(item.name, "Bean bag chair");
  assert.deepEqual([item.width, item.depth, item.height, item.clearance], [36, 36, 28, 0]);
  assert.equal(item.category, "custom");
  assert.equal(item.slug, null);   // no special 3D shape: drawn as a box
});

test("itemDimensions returns null for an item no longer in the catalog", () => {
  assert.equal(itemDimensions({ furniture_id: 99, x: 0, y: 0, rotation: 0 }, CATALOG), null);
});

test("footprint swaps width and depth at 90 and 270 degrees (rule 1)", () => {
  assert.deepEqual(footprint(BED, 0), { halfX: 20, halfY: 42 });
  assert.deepEqual(footprint(BED, 180), { halfX: 20, halfY: 42 });
  assert.deepEqual(footprint(BED, 90), { halfX: 42, halfY: 20 });
  assert.deepEqual(footprint(BED, 270), { halfX: 42, halfY: 20 });
});

test("footprintBox is centred on the placement", () => {
  assert.deepEqual(footprintBox({ x: 94, y: 72, rotation: 0 }, BED), { minX: 74, minY: 30, maxX: 114, maxY: 114 });
  assert.deepEqual(footprintBox({ x: 50, y: 30, rotation: 90 }, BED), { minX: 8, minY: 10, maxX: 92, maxY: 50 });
});


// --- P5: overlap, inside, snap, free spot -------------------------------------

const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

test("overlaps: rule 2, touching edges are fine", () => {
  assert.equal(overlaps(box(0, 0, 10, 10), box(5, 5, 15, 15)), true);
  assert.equal(overlaps(box(0, 0, 10, 10), box(10, 0, 20, 10)), false);       // edge to edge
  assert.equal(overlaps(box(0, 0, 10, 10), box(9.995, 0, 20, 10)), false);    // within 0.01
  assert.equal(overlaps(box(0, 0, 10, 10), box(9.98, 0, 20, 10)), true);
  assert.equal(overlaps(box(0, 0, 10, 10), box(5, 10, 15, 20)), false);
});

test("pointInPolygon counts the boundary as inside", () => {
  assert.equal(pointInPolygon([50, 50], RECT), true);
  assert.equal(pointInPolygon([0, 75], RECT), true);      // on the west wall
  assert.equal(pointInPolygon([114, 150], RECT), true);   // a corner
  assert.equal(pointInPolygon([115, 50], RECT), false);
  assert.equal(pointInPolygon([90, 90], L_SHAPE), false); // in the L's cut-out
  assert.equal(pointInPolygon([30, 120], L_SHAPE), true);
});

test("insideRoom: rule 5 for a rectangle", () => {
  assert.equal(insideRoom(box(0, 0, 40, 84), RECT), true);       // flush in a corner
  assert.equal(insideRoom(box(80, 0, 120, 84), RECT), false);    // sticks out east
});

test("insideRoom rejects a box over the inner corner of an L-shape", () => {
  // Any box covering the inner corner (60, 60) has a corner in the cut-out.
  assert.equal(insideRoom(box(50, 50, 70, 70), L_SHAPE), false);
  assert.equal(insideRoom(box(0, 0, 60, 60), L_SHAPE), true);     // in the leg's top
  assert.equal(insideRoom(box(60, 0, 120, 60), L_SHAPE), true);   // the bar's far end, flush
});

test("insideRoom rejects a box whose corners are all inside but which a wall crosses", () => {
  // This is why rule 5 has a second check. A U-shaped room: a notch 20 wide
  // and 60 deep comes down from the north wall between x = 50 and x = 70.
  const U = [[0, 0], [50, 0], [50, 60], [70, 60], [70, 0], [120, 0], [120, 100], [0, 100]];
  const spanningNotch = box(40, 50, 80, 90);   // corners (40,50) and (80,50) are inside, (50..70, 50..60) is the notch
  assert.equal([[40, 50], [80, 50], [80, 90], [40, 90]].every((c) => pointInPolygon(c, U)), true);
  assert.equal(insideRoom(spanningNotch, U), false);
});

const DESK = { width: 42, depth: 24 };

test("snap rounds the centre to whole inches", () => {
  assert.deepEqual(snap({ x: 50.4, y: 70.6 }, DESK, 0, [RECT]), { x: 50, y: 71 });
});

test("snap moves an edge within 3 in of a wall flush against it", () => {
  // Desk 42 wide: its west edge is at x - 21. At x = 23 the edge is 2 in from the wall.
  assert.deepEqual(snap({ x: 23, y: 70 }, DESK, 0, [RECT]), { x: 21, y: 70 });
  // 3 in exactly still snaps; 4 in doesn't.
  assert.deepEqual(snap({ x: 24, y: 70 }, DESK, 0, [RECT]), { x: 21, y: 70 });
  assert.deepEqual(snap({ x: 25, y: 70 }, DESK, 0, [RECT]), { x: 25, y: 70 });
  // East wall at 114: the east edge is x + 21.
  assert.deepEqual(snap({ x: 91, y: 70 }, DESK, 0, [RECT]), { x: 93, y: 70 });
  // North wall, depth 24: north edge y - 12.
  assert.deepEqual(snap({ x: 57, y: 14 }, DESK, 0, [RECT]), { x: 57, y: 12 });
});

test("snap uses the turned footprint", () => {
  // At 90 degrees the desk is 24 along x: west edge x - 12.
  assert.deepEqual(snap({ x: 14, y: 70 }, DESK, 90, [RECT]), { x: 12, y: 70 });
});

test("snap keeps the footprint inside the room's bounding box", () => {
  assert.deepEqual(snap({ x: -40, y: 500 }, DESK, 0, [RECT]), { x: 21, y: 138 });
});

test("an item bigger than the room is centred on that axis", () => {
  assert.deepEqual(snap({ x: 10, y: 10 }, { width: 200, depth: 24 }, 0, [RECT]), { x: 57, y: 12 });
});

test("snap only flushes against walls that run alongside the item", () => {
  // In the L, the bar's south wall (y = 60) only spans x 60..120. A desk at
  // x 0..42 near y = 60 is in the leg, beside no such wall, so it stays put.
  assert.deepEqual(snap({ x: 21, y: 50 }, DESK, 0, [L_SHAPE]), { x: 21, y: 50 });
  // Over in the bar, the same wall is alongside, so the desk snaps to it.
  assert.deepEqual(snap({ x: 90, y: 46 }, DESK, 0, [L_SHAPE]), { x: 90, y: 48 });
});

test("findFreeSpot takes the first free spot on a 6 in grid", () => {
  const bed = { width: 40, depth: 84, height: 36 };
  assert.deepEqual(findFreeSpot(bed, 0, [RECT], []), { x: 20, y: 42 });
  const taken = [{ box: box(0, 0, 40, 84), height: 36 }];
  const spot = findFreeSpot(bed, 0, [RECT], taken);
  assert.equal(overlaps(footprintBox({ ...spot, rotation: 0 }, bed), taken[0].box), false);
  assert.deepEqual(spot, { x: 62, y: 42 });
});

test("findFreeSpot ignores flat items, and flat items ignore everything", () => {
  const rug = { box: box(0, 0, 114, 150), height: 1 };
  assert.deepEqual(findFreeSpot({ width: 40, depth: 84, height: 36 }, 0, [RECT], [rug]), { x: 20, y: 42 });
  const bed = { box: box(0, 0, 40, 84), height: 36 };
  assert.deepEqual(findFreeSpot({ width: 60, depth: 96, height: 1 }, 0, [RECT], [bed]), { x: 30, y: 48 });
});

test("findFreeSpot falls back to the middle of a full room", () => {
  const full = [{ box: box(0, 0, 114, 150), height: 40 }];
  assert.deepEqual(findFreeSpot({ width: 20, depth: 20, height: 30 }, 0, [RECT], full), { x: 57, y: 75 });
});

test("findFreeSpot never picks the L-shape's cut-out", () => {
  const blocker = { box: box(0, 0, 60, 150), height: 40 };   // fill the leg and the bar's west half
  const spot = findFreeSpot({ width: 30, depth: 30, height: 30 }, 0, [L_SHAPE], [blocker]);
  assert.equal(insideRoom(footprintBox({ ...spot, rotation: 0 }, { width: 30, depth: 30 }), L_SHAPE), true);
  assert.deepEqual(spot, { x: 75, y: 15 });
});


test("snap with flush off (arrow keys) leaves small gaps alone but still keeps items in", () => {
  assert.deepEqual(snap({ x: 22, y: 70 }, DESK, 0, [RECT], { flush: false }), { x: 22, y: 70 });
  assert.deepEqual(snap({ x: 10, y: 70 }, DESK, 0, [RECT], { flush: false }), { x: 21, y: 70 });
});


// --- P7: evaluate ---------------------------------------------------------------

const SIZES = {
  bed: { name: "Bed, twin XL", width: 40, depth: 84, height: 36, clearance: 14 },
  desk: { name: "Desk", width: 42, depth: 24, height: 30, clearance: 0 },
  bin: { name: "Storage bin", width: 24, depth: 16, height: 13, clearance: 0 },
  fridge: { name: "Mini fridge", width: 19, depth: 20, height: 33, clearance: 0 },
  rug: { name: "Rug, 5 × 8 ft", width: 60, depth: 96, height: 1, clearance: 0 },
  futon: { name: "Futon", width: 72, depth: 34, height: 32, clearance: 0 },
};

/** A room for these tests: the 114 x 150 rectangle with any features. */
const testRoom = (...features) => ({ rooms: [{ outline: RECT, features }] });

/** Place a named item centred at (x, y). */
const at = (name, x, y, rotation = 0) => ({ placement: { x, y, rotation }, item: SIZES[name] });

test("items that fit have no issue", () => {
  assert.deepEqual(evaluate(testRoom(), [at("bed", 20, 42), at("desk", 93, 12)]), [null, null]);
});

test("too big for this room: doesn't fit turned either way", () => {
  const huge = { placement: { x: 57, y: 75, rotation: 0 }, item: { ...SIZES.desk, width: 160, depth: 120 } };
  assert.deepEqual(evaluate(testRoom(), [huge]), ["Too big for this room"]);
  // 140 x 100 fits the 114 x 150 room if turned, so it's only outside the room.
  const turnable = { placement: { x: 57, y: 75, rotation: 0 }, item: { ...SIZES.desk, width: 140, depth: 100 } };
  assert.deepEqual(evaluate(testRoom(), [turnable]), ["Outside the room"]);
});

test("outside the room, including the inner corner of an L-shape", () => {
  assert.deepEqual(evaluate(testRoom(), [at("desk", 100, 12)]), ["Outside the room"]);
  const lRoom = { rooms: [{ outline: L_SHAPE, features: [] }] };
  assert.deepEqual(evaluate(lRoom, [at("desk", 70, 60)]), ["Outside the room"]);
  assert.deepEqual(evaluate(lRoom, [at("desk", 30, 100, 90)]), [null]);
});

test("blocks the door, blocks the closet, hits the radiator", () => {
  const room = testRoom(
    { kind: "door", wall: 0, offset: 0, width: 34, height: 80 },
    { kind: "closet", wall: 3, offset: 0, width: 60, height: 84 },
    { kind: "radiator", wall: 1, offset: 50, width: 30 },
  );
  assert.deepEqual(evaluate(room, [at("fridge", 20, 20)]), ["Blocks the door"]);
  assert.deepEqual(evaluate(room, [at("fridge", 15, 120)]), ["Blocks the closet"]);
  assert.deepEqual(evaluate(room, [at("fridge", 100, 65)]), ["Hits the radiator"]);
});

test("overlapping items both get an issue naming the other", () => {
  assert.deepEqual(evaluate(testRoom(), [at("bed", 20, 42), at("desk", 45, 42)]),
    ["Overlaps the desk", "Overlaps the bed, twin XL"]);
});

test("touching edges is fine", () => {
  assert.deepEqual(evaluate(testRoom(), [at("bed", 20, 42), at("desk", 61, 12)]), [null, null]);
});

test("rule 3: a rug never collides, with a door zone or with furniture", () => {
  const room = testRoom({ kind: "door", wall: 0, offset: 0, width: 34, height: 80 });
  assert.deepEqual(evaluate(room, [at("rug", 30, 48)]), [null]);                       // over the door zone
  assert.deepEqual(evaluate(testRoom(), [at("rug", 60, 100), at("bed", 94, 108)]), [null, null]); // under the bed
});

test("rule 4: a storage bin fits under the bed, a mini fridge doesn't", () => {
  assert.deepEqual(evaluate(testRoom(), [at("bed", 20, 42), at("bin", 20, 42)]), [null, null]);
  assert.deepEqual(evaluate(testRoom(), [at("bed", 20, 42), at("fridge", 20, 42)]),
    ["Overlaps the mini fridge", "Overlaps the bed, twin XL"]);
});

test("mayOverlap is symmetric", () => {
  assert.equal(mayOverlap(SIZES.bed, SIZES.bin), true);
  assert.equal(mayOverlap(SIZES.bin, SIZES.bed), true);
  assert.equal(mayOverlap(SIZES.desk, SIZES.futon), false);
});

test("priority: outside beats a zone, a zone beats an overlap (rule 8)", () => {
  const room = testRoom({ kind: "door", wall: 0, offset: 0, width: 34, height: 80 });
  // In the door zone and overlapping the fridge: the door wins.
  assert.equal(evaluate(room, [at("desk", 25, 15), at("fridge", 20, 15)])[0], "Blocks the door");
  // Poking out of the room and overlapping: outside wins.
  assert.equal(evaluate(testRoom(), [at("futon", 100, 75), at("desk", 93, 75)])[0], "Outside the room");
});

test("the sample suites' default layouts have no issues", () => {
  const root = new URL("../seed/", import.meta.url);
  const catalog = JSON.parse(readFileSync(new URL("furniture.json", root), "utf8"));
  const bySlug = new Map(catalog.map((item) => [item.slug, { ...item, name: item.name }]));
  for (const file of readdirSync(new URL("suites/", root)).filter((f) => f.endsWith(".json"))) {
    const room = JSON.parse(readFileSync(new URL(`suites/${file}`, root), "utf8"));
    const entries = room.default_layout.map(({ slug, x, y, rotation }) => ({
      placement: { x, y, rotation }, item: bySlug.get(slug),
    }));
    assert.deepEqual(evaluate(room.geometry, entries), entries.map(() => null), file);
  }
});


// --- Suites: several rooms in one plan (format version 2) ----------------------

// Bedroom (0..120 x 0..144) and a common room (125..305 x 0..144), with a
// 5 in wall gap between them.
const BEDROOM = [[0, 0], [120, 0], [120, 144], [0, 144]];
const COMMON = [[125, 0], [305, 0], [305, 144], [125, 144]];
const SUITE = { rooms: [{ outline: BEDROOM, features: [] }, { outline: COMMON, features: [{ kind: "door", wall: 1, offset: 50, width: 36, height: 80 }] }] };

test("an item is fine in either room of a suite", () => {
  assert.deepEqual(evaluate(SUITE, [at("bed", 20, 42), at("desk", 200, 12)]), [null, null]);
});

test("an item straddling the wall between rooms crosses a wall", () => {
  assert.equal(insideAnyRoom(box(118, 10, 127, 20), [BEDROOM, COMMON]), false);
  assert.deepEqual(evaluate(SUITE, [at("desk", 122, 60, 90)]), ["Crosses a wall"]);   // in the gap
  assert.deepEqual(evaluate(SUITE, [at("desk", 122, 60)]), ["Crosses a wall"]);       // half in each room
});

test("an item poking out of the suite's outside wall is still outside the room", () => {
  assert.deepEqual(evaluate(SUITE, [at("desk", 300, 60)]), ["Outside the room"]);
  assert.deepEqual(evaluate(SUITE, [at("desk", 60, 140)]), ["Outside the room"]);     // bedroom's south wall is outside here
});

test("zones come from every room", () => {
  assert.deepEqual(zones(SUITE).map((z) => z.kind), ["door"]);
  assert.deepEqual(evaluate(SUITE, [at("fridge", 290, 68)]), ["Blocks the door"]);
});

test("a new item lands in the next room once the first is full", () => {
  const fullBedroom = [{ box: box(0, 0, 120, 144), height: 40 }];
  const spot = findFreeSpot({ width: 30, depth: 30, height: 30 }, 0, [BEDROOM, COMMON], fullBedroom);
  assert.deepEqual(spot, { x: 141, y: 15 });   // the first 6 in grid spot inside the common room
});

test("snap flushes against the second room's walls too", () => {
  // Desk 42 wide: its west edge 2 in from the common room's west wall (x = 125).
  assert.deepEqual(snap({ x: 148, y: 60 }, DESK, 0, [BEDROOM, COMMON]), { x: 146, y: 60 });
});


// --- P8: "Will it fit?" ------------------------------------------------------------

test("checkCustomItem accepts a named item in whole inches", () => {
  assert.deepEqual(checkCustomItem({ label: " Bean bag chair ", width: "36", depth: "36", height: "28" }),
    { item: { label: "Bean bag chair", width: 36, depth: 36, height: 28 }, error: null });
});

test("checkCustomItem explains the first problem", () => {
  const ok = { label: "Shelf", width: "30", depth: "12", height: "60" };
  assert.match(checkCustomItem({ ...ok, label: "  " }).error, /name of 1 to 60/);
  assert.match(checkCustomItem({ ...ok, label: "x".repeat(61) }).error, /name of 1 to 60/);
  assert.match(checkCustomItem({ ...ok, width: "0" }).error, /width .* 1 to 200/);
  assert.match(checkCustomItem({ ...ok, depth: "12.5" }).error, /depth/);
  assert.match(checkCustomItem({ ...ok, height: "121" }).error, /height .* 1 to 120/);
  assert.match(checkCustomItem({ ...ok, width: "" }).error, /width/);
  assert.equal(checkCustomItem({ ...ok, width: "200", height: "120" }).error, null);
});
