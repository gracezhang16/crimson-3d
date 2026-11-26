/**
 * Furnish a suite with the furniture Harvard supplies, for suite types that
 * have no default layout yet (Claire, 2026-11-26).
 *
 * Pure: no three.js, no DOM, so tests/furnish.test.mjs runs it under node.
 * planner/main.js uses it when a suite type's default layout is empty, so
 * students (and admins on the Default layout page) never open a bare suite.
 * An admin's saved default layout always wins over this.
 *
 * Who gets what:
 *   - The suite's capacity is shared out across its bedrooms, with any
 *     extra students going to the biggest bedrooms (a double: 2 sets in its
 *     one bedroom; 3 bedrooms for 4: 2 + 1 + 1). Common rooms and hallways
 *     get nothing.
 *   - Each student gets a bed, desk, desk chair, dresser, bookcase and floor
 *     lamp, plus a wardrobe in a bedroom with no closet (the same list the
 *     shopping list says Harvard supplies).
 *
 * Where it goes: each piece, biggest first, at the first free spot in its
 * bedroom (rules.findFreeSpot: a 6 in grid from the north-west corner), clear
 * of other furniture and of the door, closet and radiator zones; turned 90°
 * if that's the only way it fits. Each desk chair goes in front of its desk.
 * A piece that can't fit anywhere in the room is left out rather than piled
 * on top of another.
 */

import { findFreeSpot, footprintBox, insideAnyRoom, overlaps, zones } from "./rules.js";

// One student's set, biggest first so the big pieces get the good spots.
const PER_STUDENT = ["bed-twin-xl", "dresser", "desk", "bookcase", "floor-lamp"];
const WARDROBE = "wardrobe";   // only in a bedroom with no closet
const CHAIR = "desk-chair";    // placed in front of each desk

/**
 * How many students each room houses: the capacity shared across bedrooms,
 * extra students to the biggest. Rooms that aren't bedrooms get 0.
 *
 * @param {{kind: string, outline: number[][]}[]} rooms
 * @param {number} capacity - the suite's number of students
 * @returns {number[]} students in each room, in the same order
 */
export function studentsPerRoom(rooms, capacity) {
  const counts = rooms.map(() => 0);
  const bedrooms = rooms
    .map((room, i) => ({ i, area: boxArea(room.outline), kind: room.kind }))
    .filter((room) => room.kind === "bedroom")
    .sort((a, b) => b.area - a.area || a.i - b.i); // biggest first; ties keep their order
  if (!bedrooms.length) return counts;
  const each = Math.floor(capacity / bedrooms.length);
  const extra = capacity % bedrooms.length;
  bedrooms.forEach(({ i }, rank) => {
    counts[i] = each + (rank < extra ? 1 : 0);
  });
  return counts;
}

/** The area of an outline's bounding box (enough to tell big rooms from small). */
function boxArea(outline) {
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

/**
 * Which way a piece's front faces for each rotation, in plan coordinates:
 * at rotation 0 the front faces south (+y), and rotations turn clockwise
 * seen from above, as in the sample default layouts.
 */
const FRONT = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] };

/**
 * Placements for a whole suite.
 *
 * @param {{rooms: {kind: string, outline: number[][], features: object[]}[]}} geometry
 * @param {number} capacity
 * @param {{id: number, slug: string, width: number, depth: number, height: number,
 *   clearance: number}[]} catalog - /api/furniture rows
 * @returns {{furniture_id: number, x: number, y: number, rotation: number}[]}
 */
export function furnish(geometry, capacity, catalog) {
  const bySlug = new Map(catalog.map((item) => [item.slug, item]));
  const counts = studentsPerRoom(geometry.rooms, capacity);
  const placements = [];
  geometry.rooms.forEach((room, r) => {
    if (counts[r] > 0) {
      placements.push(...furnishRoom(geometry, r, counts[r], bySlug));
    }
  });
  return placements;
}

/**
 * Placements for one bedroom housing `students` students.
 *
 * @param {object} geometry - the suite (for the room's door and closet zones)
 * @param {number} r - which room
 * @param {number} students
 * @param {Map<string, object>} bySlug - catalog items by slug
 * @returns {object[]}
 */
function furnishRoom(geometry, r, students, bySlug) {
  const room = geometry.rooms[r];
  const outlines = [room.outline];
  // Keep clear of doors, closets and radiators (as for a newly added item, layout.js).
  const blockers = zones({ rooms: [room] }).map((zone) => ({ box: zone.box, height: 2 }));
  const hasCloset = room.features.some((feature) => feature.kind === "closet");
  const slugs = [];
  for (let s = 0; s < students; s++) {
    slugs.push(...PER_STUDENT, ...(hasCloset ? [] : [WARDROBE]));
  }
  // Biggest first across the whole room: all the beds, then wardrobes, ...
  const order = ["bed-twin-xl", WARDROBE, "dresser", "desk", "bookcase", "floor-lamp"];
  slugs.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const placements = [];
  const place = (item, spot, rotation) => {
    const placement = { furniture_id: item.id, x: spot.x, y: spot.y, rotation };
    placements.push(placement);
    blockers.push({ box: footprintBox(placement, item), height: item.height });
    return placement;
  };
  for (const slug of slugs) {
    const item = bySlug.get(slug);
    if (!item) continue; // removed from the catalog: nothing to place
    const chair = slug === "desk" ? bySlug.get(CHAIR) : null;
    if (chair) {
      placeDeskAndChair(item, chair, outlines, blockers, place);
      continue;
    }
    const found = freeSpot(item, outlines, blockers);
    if (found) place(item, found.spot, found.rotation); // else the room is full
  }
  return placements;
}

/**
 * A desk with its chair in front, facing it. Each way round is tried in
 * turn, so the desk ends up facing into the room rather than a wall. If no
 * way leaves room for the chair in front, the desk goes in its first free
 * spot and the chair in its own.
 */
function placeDeskAndChair(desk, chair, outlines, blockers, place) {
  for (const rotation of [0, 90, 180, 270]) {
    const spot = findFreeSpot(desk, rotation, outlines, blockers);
    if (!fits(desk, spot, rotation, outlines, blockers)) continue;
    const deskBox = { box: footprintBox({ ...spot, rotation }, desk), height: desk.height };
    const front = chairInFront({ ...spot, rotation }, desk, chair);
    if (fits(chair, front, front.rotation, outlines, [...blockers, deskBox])) {
      place(desk, spot, rotation);
      place(chair, front, front.rotation);
      return;
    }
  }
  const found = freeSpot(desk, outlines, blockers);
  if (found) place(desk, found.spot, found.rotation);
  const seat = freeSpot(chair, outlines, blockers);
  if (seat) place(chair, seat.spot, seat.rotation);
}

/**
 * The first free spot for an item in the room, upright or turned 90°.
 * @returns {{spot: {x: number, y: number}, rotation: number} | null}
 */
function freeSpot(item, outlines, blockers) {
  for (const rotation of [0, 90]) {
    const spot = findFreeSpot(item, rotation, outlines, blockers);
    if (fits(item, spot, rotation, outlines, blockers)) {
      return { spot, rotation };
    }
  }
  return null;
}

/** True if the item at this spot is inside the room and clear of every blocker. */
function fits(item, spot, rotation, outlines, blockers) {
  const box = footprintBox({ ...spot, rotation }, item);
  return insideAnyRoom(box, outlines) && !blockers.some((other) => overlaps(box, other.box));
}

/**
 * Where a desk chair goes to sit at a desk: touching the desk's front,
 * turned to face it.
 *
 * @param {{x: number, y: number, rotation: number}} desk - the desk's placement
 * @param {{depth: number}} deskItem
 * @param {{depth: number}} chair
 * @returns {{x: number, y: number, rotation: number}}
 */
export function chairInFront(desk, deskItem, chair) {
  const [fx, fy] = FRONT[desk.rotation];
  const reach = deskItem.depth / 2 + chair.depth / 2;
  return { x: desk.x + fx * reach, y: desk.y + fy * reach, rotation: (desk.rotation + 180) % 360 };
}
