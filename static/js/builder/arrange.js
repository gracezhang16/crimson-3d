/**
 * Arranging a suite's rooms by dragging them in the builder preview. Hannah.
 *
 * Pure: no DOM, no three.js, so tests/arrange.test.mjs runs it under node.
 * builder/main.js handles the mouse and calls these.
 *
 * Snapping: while a room is dragged, any edge that comes within SNAP_DISTANCE
 * of a neighbour either sits beside it with exactly one wall's thickness
 * between them (the "gap"), or lines up with the neighbour's matching edge.
 * A wall between rooms is real floor-plan space: in the suite format, rooms
 * touch or leave a gap, and the planner finds walls in those gaps
 * (roomMath.insideWalls). That's why the gap is the wall's thickness.
 *
 * roomsOverlap() mirrors geometry.py's _rooms_overlap, so the builder can say
 * "Bedroom A and Hallway overlap" while dragging, in the server's words
 * (tests/fixtures/overlap_cases.json is checked by both test suites).
 */

import { inwardNormal, walls } from "../shared/geometry.js";

export const SNAP_DISTANCE = 12; // inches: how close an edge must come to snap

/**
 * A room outline's bounding box.
 * @param {number[][]} outline
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
export function bounds(outline) {
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** How much two ranges [aLo, aHi] and [bLo, bHi] overlap (negative = the gap between them). */
function rangeOverlap(aLo, aHi, bLo, bHi) {
  return Math.min(aHi, bHi) - Math.max(aLo, bLo);
}

/**
 * The best snap along one axis: the smallest move (at most `threshold`) that
 * puts the moving box beside a neighbour with `gap` between them, or lines an
 * edge up with the neighbour's same edge.
 *
 * @param {object} box - the moving room's box where the pointer put it
 * @param {object[]} others - every other room's box
 * @param {"x" | "y"} axis
 * @param {number} gap - wall thickness, inches
 * @param {number} threshold
 * @returns {{delta: number, at: number, other: object} | null} `at` is where the guide line goes
 */
function snapAxis(box, others, axis, gap, threshold) {
  const [lo, hi, crossLo, crossHi] = axis === "x" ? ["minX", "maxX", "minY", "maxY"] : ["minY", "maxY", "minX", "maxX"];
  let best = null;
  const consider = (delta, at, other) => {
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
      best = { delta, at, other };
    }
  };
  for (const other of others) {
    const across = rangeOverlap(box[crossLo], box[crossHi], other[crossLo], other[crossHi]);
    if (across > 0) {
      // Side by side on this axis: leave exactly one wall between them.
      consider(other[hi] + gap - box[lo], other[hi] + gap / 2, other);
      consider(other[lo] - gap - box[hi], other[lo] - gap / 2, other);
    }
    if (across > -(gap + threshold)) {
      // Next to each other the other way (or nearly): line the edges up.
      consider(other[lo] - box[lo], other[lo], other);
      consider(other[hi] - box[hi], other[hi], other);
    }
  }
  return best;
}

/**
 * Where a dragged room should really go: its position snapped to neighbours.
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} box - where the pointer put it
 * @param {object[]} others - every other room's box
 * @param {number} gap - wall thickness between rooms, inches
 * @param {number} [threshold]
 * @returns {{dx: number, dy: number, guides: {axis: "x" | "y", at: number, from: number, to: number}[]}}
 *   how far to move the box, and dashed guide lines to draw: a guide on axis
 *   "x" is a vertical line at x = at, from y = from to y = to.
 */
export function snapRoom(box, others, gap, threshold = SNAP_DISTANCE) {
  const x = snapAxis(box, others, "x", gap, threshold);
  const y = snapAxis(box, others, "y", gap, threshold);
  const dx = x ? x.delta : 0;
  const dy = y ? y.delta : 0;
  const moved = { minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy };
  const guides = [];
  if (x) {
    guides.push({ axis: "x", at: x.at, from: Math.min(moved.minY, x.other.minY), to: Math.max(moved.maxY, x.other.maxY) });
  }
  if (y) {
    guides.push({ axis: "y", at: y.at, from: Math.min(moved.minX, y.other.minX), to: Math.max(moved.maxX, y.other.maxX) });
  }
  return { dx, dy, guides };
}

/**
 * Move every room so the suite's north-west corner is at (0, 0): rooms can
 * be dragged above or left of the others, but suite coordinates start at 0
 * (SPEC.md 4.2).
 *
 * @param {{x: number, y: number}[]} positions - each room's north-west corner
 * @returns {{x: number, y: number}[]}
 */
export function normalizePositions(positions) {
  if (!positions.length) return [];
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  return positions.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

// ---------------------------------------------------------------------------
// Overlap between rooms: the same test as geometry.py's _rooms_overlap.
// ---------------------------------------------------------------------------

/** Cross product sign: >0 if p->q->r turns one way, <0 the other, 0 if in a line. */
function orientation(p, q, r) {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

/** True if q lies on segment pr, given that p, q, r are in a line. */
function onSegment(p, q, r) {
  return Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0])
    && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
}

/** True if point is inside the outline and not on its boundary. */
function strictlyInside([px, py], outline) {
  let inside = false;
  for (const { start: [ax, ay], end: [bx, by] } of walls(outline)) {
    if (orientation([ax, ay], [bx, by], [px, py]) === 0 && onSegment([ax, ay], [px, py], [bx, by])) {
      return false; // on the boundary
    }
    if ((ay > py) !== (by > py) && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Do two room outlines share floor space (not just a wall or a corner)?
 * Yes if any wall of one properly crosses a wall of the other, or if a point
 * just inside any wall of one lies strictly inside the other.
 *
 * @param {number[][]} a
 * @param {number[][]} b
 * @returns {boolean}
 */
export function roomsOverlap(a, b) {
  for (const { start: p1, end: p2 } of walls(a)) {
    for (const { start: p3, end: p4 } of walls(b)) {
      const d1 = orientation(p3, p4, p1);
      const d2 = orientation(p3, p4, p2);
      const d3 = orientation(p1, p2, p3);
      const d4 = orientation(p1, p2, p4);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  for (const [first, second] of [[a, b], [b, a]]) {
    const firstWalls = walls(first);
    for (let i = 0; i < firstWalls.length; i++) {
      const { start, end } = firstWalls[i];
      const [nx, ny] = inwardNormal(first, i);
      const probe = [(start[0] + end[0]) / 2 + nx * 0.5, (start[1] + end[1]) / 2 + ny * 0.5];
      if (strictlyInside(probe, second)) return true;
    }
  }
  return false;
}

/**
 * Every pair of rooms that overlap, in the server's words (geometry.validate_suite).
 *
 * @param {{name: string, outline: number[][] | null}[]} rooms
 * @returns {{message: string, rooms: number[]}[]} rooms: the two indexes
 */
export function overlapProblems(rooms) {
  const problems = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (rooms[i].outline && rooms[j].outline && roomsOverlap(rooms[i].outline, rooms[j].outline)) {
        problems.push({
          message: `${rooms[i].name} and ${rooms[j].name} overlap. Rooms may share a wall but not floor space.`,
          rooms: [i, j],
        });
      }
    }
  }
  return problems;
}
