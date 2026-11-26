/**
 * Placement rules (SPEC.md 4.5). Claire.
 *
 * PURE: imports nothing from three.js or the DOM, so `node --test` can run it
 * (tests/rules.test.mjs). P3 added the zones that wall features create on the
 * floor; P4 added item sizes and footprints; P5 added overlap, inside-the-room,
 * snapping and finding a free spot; P7 adds evaluate(): flat items, under-bed
 * clearance and each item's issue (SPEC.md 4.5 rules 3, 4, 6 and 8).
 *
 * Coordinates are plan inches, [x, y] with y pointing south (SPEC.md 4.1).
 * A suite (format version 2) has several rooms in one shared plan; an item
 * is fine anywhere inside any one room. Functions that take `outlines` want
 * every room's outline (geometry.rooms.map((room) => room.outline)).
 */

import { featureSpan, inwardNormal, walls } from "../shared/geometry.js";
import { insideWallBoxes } from "./roomMath.js";

const CLOSET_ZONE_DEPTH = 24;      // inches in front of a closet (SPEC.md 4.3)
const DEFAULT_RADIATOR_DEPTH = 6;  // SPEC.md 4.2

// The issue an item gets when it overlaps each kind of zone (SPEC.md 4.5 rule 8).
const ZONE_ISSUES = {
  door: "Blocks the door",
  closet: "Blocks the closet",
  radiator: "Hits the radiator",
};

/**
 * How far a feature's floor zone reaches into the room, or 0 for features
 * that make no zone (windows, outlets).
 *
 * @param {{kind: string, width?: number, depth?: number}} feature
 * @returns {number} inches
 */
function zoneDepth(feature) {
  switch (feature.kind) {
    case "door":
      return feature.width;                         // a width × width square
    case "closet":
      return CLOSET_ZONE_DEPTH;
    case "radiator":
      return feature.depth ?? DEFAULT_RADIATOR_DEPTH;
    default:
      return 0;
  }
}

/**
 * The floor zones a room's features create (SPEC.md 4.3): a rectangle against
 * the wall, as wide as the feature, reaching `zoneDepth` inches into the room.
 *
 * Each zone has its four corners (in order, so it can be drawn) and its
 * axis-aligned bounding box, which the P7 overlap rules use.
 *
 * @param {{rooms: {outline: number[][], features: object[]}[]}} geometry - a suite
 * @returns {{kind: string, issue: string, corners: number[][],
 *   box: {minX: number, minY: number, maxX: number, maxY: number}}[]}
 */
export function zones(geometry) {
  return geometry.rooms.flatMap((room) => roomZones(room));
}

/**
 * The zones of one room's features.
 * @param {{outline: number[][], features: object[]}} room
 */
function roomZones({ outline, features }) {
  return features
    .filter((feature) => zoneDepth(feature) > 0)
    .map((feature) => {
      const { start, end } = featureSpan(outline, feature);
      const [nx, ny] = inwardNormal(outline, feature.wall);
      const depth = zoneDepth(feature);
      // Along the wall from start to end, then step into the room and back.
      const corners = [
        start,
        end,
        [end[0] + nx * depth, end[1] + ny * depth],
        [start[0] + nx * depth, start[1] + ny * depth],
      ].map(([x, y]) => [x + 0, y + 0]); // "+ 0" turns -0 into 0 for clean comparisons
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      return {
        kind: feature.kind,
        issue: ZONE_ISSUES[feature.kind],
        corners,
        box: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
      };
    });
}


// Colour for custom "will it fit" items, which have no catalog colour.
const CUSTOM_ITEM_COLOR = "#9aa1ad";

/**
 * The name, size and colour of a placed item (SPEC.md 4.4): from the catalog
 * for a catalog item, or from the placement itself for a custom item.
 *
 * @param {{furniture_id: number | null, label?: string, width?: number,
 *   depth?: number, height?: number}} placement
 * @param {Map<number, object>} catalogById - /api/furniture rows by id
 * `slug` picks the item's 3D shape (shapes.js); custom items have none.
 *
 * @returns {{name: string, slug: string | null, width: number, depth: number,
 *   height: number, clearance: number, color: string, category: string} | null}
 *   null if the catalog item no longer exists
 */
export function itemDimensions(placement, catalogById) {
  if (placement.furniture_id === null) {
    const { label, width, depth, height } = placement;
    return {
      name: label, slug: null, width, depth, height, clearance: 0, color: CUSTOM_ITEM_COLOR, category: "custom",
    };
  }
  const item = catalogById.get(placement.furniture_id);
  if (!item) {
    return null;
  }
  const { name, slug, width, depth, height, clearance, color, category } = item;
  return { name, slug, width, depth, height, clearance, color, category };
}

/**
 * Rule 1 (SPEC.md 4.5): half the footprint's size along plan x and plan y.
 * At rotation 0 or 180 the width runs along x and the depth along y; at 90
 * or 270 they swap. Rotation is always a multiple of 90, so footprints stay
 * axis-aligned rectangles.
 *
 * @param {{width: number, depth: number}} size
 * @param {number} rotation - 0, 90, 180 or 270
 * @returns {{halfX: number, halfY: number}}
 */
export function footprint(size, rotation) {
  const turned = rotation === 90 || rotation === 270;
  return {
    halfX: (turned ? size.depth : size.width) / 2,
    halfY: (turned ? size.width : size.depth) / 2,
  };
}

/**
 * The footprint of a placed item as a box in plan coordinates.
 *
 * @param {{x: number, y: number, rotation: number}} placement - x, y is the centre
 * @param {{width: number, depth: number}} size
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
export function footprintBox(placement, size) {
  const { halfX, halfY } = footprint(size, placement.rotation);
  return {
    minX: placement.x - halfX,
    minY: placement.y - halfY,
    maxX: placement.x + halfX,
    maxY: placement.y + halfY,
  };
}


// --- P5: overlap, inside the room, snap, free spot -----------------------------

const OVERLAP_TOLERANCE = 0.01; // inches; touching edges don't count (rule 2)
const SNAP_DISTANCE = 3;        // inches from a parallel wall (rule 7)
const FREE_SPOT_GRID = 6;       // inches between spots tried (SPEC.md 8.6)

/**
 * Rule 2: do two footprint boxes overlap? Only if they overlap on both axes
 * by more than 0.01 in, so items standing edge to edge are fine.
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} a
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} b
 * @returns {boolean}
 */
export function overlaps(a, b) {
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return overlapX > OVERLAP_TOLERANCE && overlapY > OVERLAP_TOLERANCE;
}

/**
 * Is point p on the segment from a to b?
 * @returns {boolean}
 */
function onSegment([px, py], [ax, ay], [bx, by]) {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  return Math.abs(cross) < 1e-9 &&
    px >= Math.min(ax, bx) - 1e-9 && px <= Math.max(ax, bx) + 1e-9 &&
    py >= Math.min(ay, by) - 1e-9 && py <= Math.max(ay, by) + 1e-9;
}

/**
 * Is a point inside the outline? Points on the boundary count as inside.
 *
 * Ray casting: imagine a ray from the point going right (east). Each time it
 * crosses an edge it goes from inside to outside or back, so an odd number
 * of crossings means the point is inside.
 *
 * @param {number[]} point - [x, y]
 * @param {number[][]} outline
 * @returns {boolean}
 */
export function pointInPolygon(point, outline) {
  const [px, py] = point;
  let inside = false;
  for (const { start, end } of walls(outline)) {
    if (onSegment(point, start, end)) {
      return true;
    }
    const [ax, ay] = start;
    const [bx, by] = end;
    // Does this edge straddle the ray's height, and cross it to the right?
    if ((ay > py) !== (by > py) && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Does the segment from a to b pass through the inside of a box (not just
 * touch its edge)? Uses the Liang-Barsky clipping method on the box shrunk
 * by the overlap tolerance: walk along the segment as t goes from 0 to 1 and
 * narrow down the stretch of t that lies inside the box on each side.
 *
 * @returns {boolean}
 */
function segmentEntersBox([ax, ay], [bx, by], box) {
  const t = OVERLAP_TOLERANCE;
  const [minX, minY, maxX, maxY] = [box.minX + t, box.minY + t, box.maxX - t, box.maxY - t];
  if (minX >= maxX || minY >= maxY) {
    return false;
  }
  const dx = bx - ax;
  const dy = by - ay;
  let low = 0;
  let high = 1;
  for (const [p, q] of [[-dx, ax - minX], [dx, maxX - ax], [-dy, ay - minY], [dy, maxY - ay]]) {
    if (p === 0) {
      if (q < 0) return false; // parallel to this side and outside it
    } else if (p < 0) {
      low = Math.max(low, q / p);
    } else {
      high = Math.min(high, q / p);
    }
    if (low > high) return false;
  }
  return true;
}

/**
 * Rule 5: is a footprint inside the room? All four corners must be inside
 * the outline (the boundary counts), AND no wall may pass through the
 * footprint. The second check catches a box straddling the inner corner of
 * an L-shape, whose corners can all be inside while the corner pokes in.
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} box
 * @param {number[][]} outline
 * @returns {boolean}
 */
export function insideRoom(box, outline) {
  const corners = [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]];
  return corners.every((corner) => pointInPolygon(corner, outline)) &&
    walls(outline).every(({ start, end }) => !segmentEntersBox(start, end, box));
}

/**
 * The bounding box around one or more outlines (a room, or a whole suite).
 * @param {number[][][]} outlines
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
function outlinesBox(outlines) {
  const corners = outlines.flat();
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Is a footprint inside one of the suite's rooms?
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} box
 * @param {number[][][]} outlines
 * @returns {boolean}
 */
export function insideAnyRoom(box, outlines) {
  return outlines.some((outline) => insideRoom(box, outline));
}

/**
 * How far to move a footprint along one axis to sit flush against the
 * nearest parallel wall within SNAP_DISTANCE, or 0.
 *
 * @param {number[][][]} outlines - every room's outline
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} box
 * @param {"x" | "y"} axis - "x": look at walls running north-south
 * @returns {number}
 */
function flushShift(outlines, box, axis) {
  let best = 0;
  for (const outline of outlines) {
    best = flushShiftForRoom(outline, box, axis, best);
  }
  return best;
}

/**
 * flushShift() for one room's walls, keeping `best` if it's already closer.
 * @returns {number}
 */
function flushShiftForRoom(outline, box, axis, best) {
  walls(outline).forEach(({ start, end }, i) => {
    const [nx, ny] = inwardNormal(outline, i);
    const normal = axis === "x" ? nx : ny;
    if (Math.abs(normal) !== 1) {
      return; // not a wall parallel to this pair of footprint edges
    }
    // The wall must run alongside the footprint, not just line up with it.
    const [lo, hi] = axis === "x"
      ? [Math.min(start[1], end[1]), Math.max(start[1], end[1])]
      : [Math.min(start[0], end[0]), Math.max(start[0], end[0])];
    const [boxLo, boxHi] = axis === "x" ? [box.minY, box.maxY] : [box.minX, box.maxX];
    if (Math.min(hi, boxHi) - Math.max(lo, boxLo) <= 0) {
      return;
    }
    const wall = axis === "x" ? start[0] : start[1];
    // The room is on the normal's side, so the footprint edge facing this
    // wall is the low edge when the normal points +, the high edge when -.
    const edge = normal > 0 ? (axis === "x" ? box.minX : box.minY) : (axis === "x" ? box.maxX : box.maxY);
    const shift = wall - edge;
    if (Math.abs(shift) <= SNAP_DISTANCE && (best === 0 || Math.abs(shift) < Math.abs(best))) {
      best = shift;
    }
  });
  return best;
}

/**
 * Rule 7: where a dragged (or nudged, or turned) item should end up.
 * Round the centre to whole inches; if a footprint edge is within 3 in of a
 * parallel wall, move it flush; keep the whole footprint inside the room's
 * bounding box (an item wider than the room is centred on that axis).
 *
 * Moving flush to walls is for dragging (SPEC.md 4.5 rule 7 says "on drag").
 * Arrow keys and turning pass { flush: false }, otherwise nudging an item
 * 1 in away from a wall would snap it straight back.
 *
 * @param {{x: number, y: number}} position - the wanted centre
 * @param {{width: number, depth: number}} size
 * @param {number} rotation
 * @param {number[][][]} outlines - every room's outline
 * @param {{flush?: boolean}} [options]
 * @returns {{x: number, y: number}}
 */
export function snap(position, size, rotation, outlines, { flush = true } = {}) {
  const { halfX, halfY } = footprint(size, rotation);
  let x = Math.round(position.x);
  let y = Math.round(position.y);
  const box = () => ({ minX: x - halfX, minY: y - halfY, maxX: x + halfX, maxY: y + halfY });
  if (flush) {
    x += flushShift(outlines, box(), "x");
    y += flushShift(outlines, box(), "y");
  }

  const room = outlinesBox(outlines); // the whole suite's box
  x = halfX * 2 > room.maxX - room.minX ? (room.minX + room.maxX) / 2
    : Math.min(Math.max(x, room.minX + halfX), room.maxX - halfX);
  y = halfY * 2 > room.maxY - room.minY ? (room.minY + room.maxY) / 2
    : Math.min(Math.max(y, room.minY + halfY), room.maxY - halfY);
  return { x, y };
}

/**
 * Where to put a newly added item (SPEC.md 8.6): the first spot, scanning the
 * room on a 6 in grid from the north-west, where the item is inside the room
 * and overlaps nothing. If there's no such spot, the middle of the room.
 * Flat items (height 1 in or less, like rugs) never collide (rule 3), so they
 * only need to be inside the room, and flat items already placed never block.
 *
 * @param {{width: number, depth: number, height: number}} size
 * @param {number} rotation
 * @param {number[][][]} outlines - every room's outline
 * @param {{box: object, height: number}[]} others - items already placed
 * @returns {{x: number, y: number}}
 */
export function findFreeSpot(size, rotation, outlines, others) {
  const { halfX, halfY } = footprint(size, rotation);
  const room = outlinesBox(outlines);
  const blockers = size.height <= 1 ? [] : others.filter((other) => other.height > 1);
  for (let y = room.minY + halfY; y <= room.maxY - halfY; y += FREE_SPOT_GRID) {
    for (let x = room.minX + halfX; x <= room.maxX - halfX; x += FREE_SPOT_GRID) {
      const box = { minX: x - halfX, minY: y - halfY, maxX: x + halfX, maxY: y + halfY };
      if (insideAnyRoom(box, outlines) && !blockers.some((other) => overlaps(box, other.box))) {
        return { x, y };
      }
    }
  }
  return { x: (room.minX + room.maxX) / 2, y: (room.minY + room.maxY) / 2 };
}


// --- Solid furniture (2026-11-26): items can't be dragged into each other -------

/**
 * Move a footprint along one axis towards `target`, stopping at the first
 * blocker in the way. Only blockers alongside it on the other axis can be in
 * the way. Stops on a whole inch, so an item may end up to 1 in short of
 * touching (positions are whole inches, SPEC.md 4.4).
 *
 * @param {{x: number, y: number}} pos - the current centre
 * @param {"x" | "y"} axis
 * @param {number} target - the wanted coordinate on that axis
 * @param {{halfX: number, halfY: number}} half - from footprint()
 * @param {object[]} blockers - footprint boxes
 * @returns {{x: number, y: number}}
 */
function slideAlong(pos, axis, target, half, blockers) {
  const along = axis === "x" ? ["minX", "maxX", half.halfX, pos.x] : ["minY", "maxY", half.halfY, pos.y];
  const across = axis === "x" ? ["minY", "maxY", half.halfY, pos.y] : ["minX", "maxX", half.halfX, pos.x];
  const [lo, hi, h, current] = along;
  const [crossLo, crossHi, crossHalf, cross] = across;
  let value = target;
  for (const box of blockers) {
    const side = Math.min(cross + crossHalf, box[crossHi]) - Math.max(cross - crossHalf, box[crossLo]);
    if (side <= OVERLAP_TOLERANCE) continue; // beside it, not in the way
    if (value > current && box[lo] >= current + h - OVERLAP_TOLERANCE) {
      value = Math.min(value, Math.max(current, Math.floor(box[lo] - h + 1e-9)));
    } else if (value < current && box[hi] <= current - h + OVERLAP_TOLERANCE) {
      value = Math.max(value, Math.min(current, Math.ceil(box[hi] + h - 1e-9)));
    }
  }
  return axis === "x" ? { x: value, y: pos.y } : { x: pos.x, y: value };
}

/**
 * Where a move from `from` towards `to` really ends when other furniture is
 * solid: the item stops against anything in its way and slides along it,
 * like a box pushed against a wall.
 *
 * Not everything is solid: rules 3 and 4 still hold (a rug never blocks, a
 * storage bin fits under a bed, see mayOverlap()). Anything the item already
 * overlaps doesn't block either, so an item that starts out overlapping
 * (an old saved layout, or no free spot when it was added) can always be
 * dragged free.
 *
 * Each axis is moved in turn. Both orders (east-west first, or north-south
 * first) are tried and the one ending nearer `to` wins, so dragging
 * diagonally into a corner between two items still gets as close as it can.
 *
 * @param {{x: number, y: number}} from - the item's current centre
 * @param {{x: number, y: number}} to - where it was dragged (already snapped)
 * @param {{width: number, depth: number, height: number, clearance: number}} item
 * @param {number} rotation
 * @param {{box: object, item: {height: number, clearance: number}}[]} others - every other item
 * @returns {{x: number, y: number}}
 */
export function blockMove(from, to, item, rotation, others) {
  const half = footprint(item, rotation);
  const start = { minX: from.x - half.halfX, minY: from.y - half.halfY, maxX: from.x + half.halfX, maxY: from.y + half.halfY };
  const blockers = others
    .filter((other) => !mayOverlap(item, other.item) && !overlaps(start, other.box))
    .map((other) => other.box);
  if (!blockers.length) {
    return { x: to.x, y: to.y };
  }
  const xFirst = slideAlong(slideAlong(from, "x", to.x, half, blockers), "y", to.y, half, blockers);
  const yFirst = slideAlong(slideAlong(from, "y", to.y, half, blockers), "x", to.x, half, blockers);
  const distance = (p) => Math.hypot(p.x - to.x, p.y - to.y);
  return distance(yFirst) < distance(xFirst) ? yFirst : xFirst;
}

/**
 * Where to put a dragged item that was let go on top of other furniture:
 * the nearest spot (to where it was dropped) that is inside a room and clear
 * of everything it can't share space with. Furniture can be dragged over
 * other furniture (2026-11-26), but never left on top of it.
 *
 * Searches outwards in square rings 1 in apart, and within the first ring
 * that has free spots, takes the one nearest in a straight line. Only the
 * walls of the rooms limit it, so a piece dropped on a crowded bed can end
 * up just beside it.
 *
 * @param {{x: number, y: number}} position - where it was dropped (its centre)
 * @param {{width: number, depth: number, height: number, clearance: number}} item
 * @param {number} rotation
 * @param {number[][][]} outlines - every room's outline
 * @param {{box: object, item: object}[]} others - every other item
 * @param {number} [maxDistance] - how far to look, inches
 * @returns {{x: number, y: number} | null} null if nowhere within maxDistance is free
 */
export function nearestFreeSpot(position, item, rotation, outlines, others, maxDistance = 240) {
  const { halfX, halfY } = footprint(item, rotation);
  const blockers = others.filter((other) => !mayOverlap(item, other.item)).map((other) => other.box);
  const x0 = Math.round(position.x);
  const y0 = Math.round(position.y);
  const free = (x, y) => {
    const box = { minX: x - halfX, minY: y - halfY, maxX: x + halfX, maxY: y + halfY };
    return insideAnyRoom(box, outlines) && !blockers.some((other) => overlaps(box, other));
  };
  for (let ring = 0; ring <= maxDistance; ring++) {
    let best = null;
    let bestDistance = Infinity;
    // Every point on the square ring at this distance (just the centre for ring 0).
    for (let dx = -ring; dx <= ring; dx++) {
      const edge = Math.abs(dx) === ring;
      for (const dy of edge ? range(-ring, ring) : [-ring, ring]) {
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance && free(x0 + dx, y0 + dy)) {
          best = { x: x0 + dx, y: y0 + dy };
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Whole numbers from lo to hi inclusive. */
function range(lo, hi) {
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/**
 * The first item that a footprint would overlap, ignoring things it may
 * share space with (rules 3 and 4). Used to refuse a turn with no room.
 *
 * @param {object} box - the footprint to test
 * @param {{height: number, clearance: number}} item
 * @param {{box: object, item: object}[]} others
 * @returns {object | null} the other item, or null if the box is clear
 */
export function firstCollision(box, item, others) {
  const hit = others.find((other) => !mayOverlap(item, other.item) && overlaps(box, other.box));
  return hit ? hit.item : null;
}


// --- P7: issues (rules 3, 4, 6, 8) ---------------------------------------------

const FLAT_HEIGHT = 1; // inches; items this low (rugs) never collide (rule 3)

/**
 * Could the item fit inside some room's bounding box, turned either way?
 * If not, no amount of moving or turning helps: "Too big for this room".
 *
 * @param {{width: number, depth: number}} size
 * @param {number[][][]} outlines
 * @returns {boolean}
 */
function fitsInSomeRoom(size, outlines) {
  return outlines.some((outline) => {
    const room = outlinesBox([outline]);
    const across = room.maxX - room.minX;
    const down = room.maxY - room.minY;
    return (size.width <= across && size.depth <= down) || (size.depth <= across && size.width <= down);
  });
}

/**
 * May two items overlap without it being a problem?
 * Rule 3: a flat item (a rug) never collides with anything.
 * Rule 4: an item no taller than the other's clearance fits underneath it
 * (a 13 in storage bin under a bed with 14 in clearance).
 *
 * @param {{height: number, clearance: number}} a
 * @param {{height: number, clearance: number}} b
 * @returns {boolean}
 */
export function mayOverlap(a, b) {
  return a.height <= FLAT_HEIGHT || b.height <= FLAT_HEIGHT ||
    a.height <= b.clearance || b.height <= a.clearance;
}

/**
 * "Bed, twin XL" -> "bed, twin XL", for "Overlaps the bed, twin XL".
 * Only the first letter changes, so "XL" stays as it is.
 * @param {string} name
 * @returns {string}
 */
function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * Rule 8: each item's issue, or null if it fits. At most one issue per item,
 * the first that applies in this order: too big, crosses a wall (straddles
 * the wall between two rooms of a suite) or outside the room, blocks the
 * door, blocks the closet, hits the radiator, overlaps another item.
 *
 * Zones are compared by their bounding boxes, which are exact for walls that
 * run north-south or east-west (all our rooms) and slightly generous for an
 * angled wall.
 *
 * @param {{rooms: {outline: number[][], features: object[]}[]}} geometry - a suite
 * @param {{placement: object, item: {name: string, width: number, depth: number,
 *   height: number, clearance: number}}[]} entries - from layout.js
 * @returns {(string | null)[]} entries[i]'s issue
 */
export function evaluate(geometry, entries) {
  const outlines = geometry.rooms.map((room) => room.outline);
  const allZones = zones(geometry);
  const wallsBetweenRooms = insideWallBoxes(geometry);
  const boxes = entries.map((entry) => footprintBox(entry.placement, entry.item));

  return entries.map((entry, i) => {
    const { item } = entry;
    const box = boxes[i];
    if (!fitsInSomeRoom(item, outlines)) {
      return "Too big for this room";
    }
    if (!insideAnyRoom(box, outlines)) {
      // Not wholly inside one room: if it overlaps a wall between rooms it's
      // straddling that wall; otherwise it sticks out of the suite.
      return wallsBetweenRooms.some((wall) => overlaps(box, wall)) ? "Crosses a wall" : "Outside the room";
    }
    if (item.height <= FLAT_HEIGHT) {
      return null; // rule 3: nothing else applies to a rug
    }
    for (const kind of ["door", "closet", "radiator"]) {
      const zone = allZones.find((z) => z.kind === kind && overlaps(box, z.box));
      if (zone) {
        return zone.issue;
      }
    }
    const other = entries.findIndex((candidate, j) =>
      j !== i && overlaps(box, boxes[j]) && !mayOverlap(item, candidate.item));
    return other >= 0 ? `Overlaps the ${lowerFirst(entries[other].item.name)}` : null;
  });
}

// --- P8: "Will it fit?" custom items ----------------------------------------------

// The same limits the server applies (geometry.py, SPEC.md 4.4).
const CUSTOM_MAX_LABEL = 60;
const CUSTOM_MAX_SIZE = 200;
const CUSTOM_MAX_HEIGHT = 120;

/**
 * Check the "Will it fit?" form: a name and a whole-inch width, depth and
 * height within the server's limits.
 *
 * @param {{label: string, width: string, depth: string, height: string}} values - as typed
 * @returns {{item: {label: string, width: number, depth: number, height: number} | null,
 *   error: string | null}} the item ready to add, or the first problem in words
 */
export function checkCustomItem({ label, width, depth, height }) {
  const name = (label ?? "").trim();
  if (!name || name.length > CUSTOM_MAX_LABEL) {
    return { item: null, error: `Give it a name of 1 to ${CUSTOM_MAX_LABEL} characters.` };
  }
  const sizes = {};
  for (const [field, text, max] of [["width", width, CUSTOM_MAX_SIZE], ["depth", depth, CUSTOM_MAX_SIZE], ["height", height, CUSTOM_MAX_HEIGHT]]) {
    const value = /^\s*\d+\s*$/.test(String(text ?? "")) ? Number(text) : NaN;
    if (!Number.isInteger(value) || value < 1 || value > max) {
      return { item: null, error: `The ${field} must be a whole number of inches from 1 to ${max}.` };
    }
    sizes[field] = value;
  }
  return { item: { label: name, ...sizes }, error: null };
}

// --- S7: shopping list ---------------------------------------------------------------

/**
 * The things to buy in a layout (SPEC.md 8.6): catalog items in the
 * "purchase" category and custom "will it fit" items, identical ones
 * grouped with a count. Harvard-supplied furniture isn't listed.
 *
 * @param {{item: {name: string, width: number, depth: number, height: number,
 *   category: string}}[]} entries
 * @returns {{name: string, width: number, depth: number, height: number, count: number,
 *   custom: boolean}[]} in the order first placed
 */
export function shoppingList(entries) {
  const groups = new Map();
  for (const { item } of entries) {
    if (item.category !== "purchase" && item.category !== "custom") continue;
    const key = [item.name, item.width, item.depth, item.height].join("|");
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      groups.set(key, {
        name: item.name, width: item.width, depth: item.depth, height: item.height,
        count: 1, custom: item.category === "custom",
      });
    }
  }
  return [...groups.values()];
}
