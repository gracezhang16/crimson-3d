/**
 * Pure room maths for the planner (Claire): no three.js, no DOM, so
 * tests/roomMath.test.mjs can run it under node. room.js does the drawing.
 *
 * Coordinates are plan inches, [x, y] with y pointing south (SPEC.md 4.1).
 */

import { inwardNormal, signedArea } from "../shared/geometry.js";

/**
 * Is corner i an outer (convex) corner of the room, as opposed to the inner
 * corner of an L-shape?
 *
 * The cross product of the wall arriving at the corner and the wall leaving
 * it says which way the outline turns there. At an outer corner it turns the
 * same way as the whole outline does (the sign of the signed area); at an
 * inner corner it turns the other way. A straight-through corner (cross
 * product 0) counts as not convex.
 *
 * @param {number[][]} outline - corners as [x, y]
 * @param {number} i - corner index
 * @returns {boolean}
 */
export function isConvexCorner(outline, i) {
  const n = outline.length;
  const [px, py] = outline[(i - 1 + n) % n];
  const [cx, cy] = outline[i];
  const [nx, ny] = outline[(i + 1) % n];
  const cross = (cx - px) * (ny - cy) - (cy - py) * (nx - cx);
  return cross !== 0 && Math.sign(cross) === Math.sign(signedArea(outline));
}

/**
 * Is the camera on the outer side of wall i? Such a wall stands between the
 * camera and the room, so the planner draws it as a short stub
 * ("dollhouse view", SPEC.md 8.3).
 *
 * The dot product of the inward normal with the vector from the wall to the
 * camera is negative exactly when the camera is outside the wall's line.
 *
 * @param {number[][]} outline
 * @param {number} i - wall index
 * @param {number[]} camera - camera position in plan coordinates [x, y]
 *   (three.js x and z)
 * @returns {boolean}
 */
export function cameraOutsideWall(outline, i, camera) {
  const [nx, ny] = inwardNormal(outline, i);
  const [sx, sy] = outline[i];
  return (camera[0] - sx) * nx + (camera[1] - sy) * ny < 0;
}

/**
 * Which way an arrow key moves an item, in plan coordinates, so that ↑ moves
 * it "away" from the camera on screen (SPEC.md 8.5 asks for arrow keys; the
 * team chose camera-relative directions). The result always runs along a
 * wall direction (north, south, east or west), so items stay tidy.
 *
 * @param {"ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"} key
 * @param {number[]} forward - the camera's viewing direction on the floor,
 *   [x, y] in plan coordinates (three.js x and z of target minus camera)
 * @returns {number[]} a unit step [dx, dy]
 */
export function arrowDirection(key, forward) {
  const [fx, fy] = forward;
  // "Away from the camera", rounded to the nearest of the four directions.
  const up = Math.abs(fx) > Math.abs(fy) ? [Math.sign(fx), 0] : [0, Math.sign(fy) || -1];
  // Screen right is forward turned a quarter clockwise as seen from above.
  // With y pointing south, that turns (x, y) into (-y, x).
  const right = [-up[1] + 0, up[0] + 0];
  switch (key) {
    case "ArrowUp": return up;
    case "ArrowDown": return [-up[0] + 0, -up[1] + 0];
    case "ArrowRight": return right;
    default: return [-right[0] + 0, -right[1] + 0];
  }
}

// --- Suites: walls between rooms (U2) -------------------------------------------

const MAX_INSIDE_GAP = 12;   // inches; a wall this close to another room's wall is between rooms
const MIN_COVERAGE = 0.8;    // share of a wall's length that must face another room

/**
 * Each wall of an outline as a start point, unit direction, length and
 * inward normal.
 *
 * @param {number[][]} outline
 * @returns {{start: number[], dir: number[], length: number, normal: number[]}[]}
 */
function wallFrames(outline) {
  return outline.map((start, i) => {
    const end = outline[(i + 1) % outline.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    return {
      start,
      dir: [(end[0] - start[0]) / length, (end[1] - start[1]) / length],
      length,
      normal: inwardNormal(outline, i),
    };
  });
}

/** @returns {number} the dot product of two 2D vectors */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/**
 * Total length covered by a list of [from, to] intervals (overlaps counted once).
 * @param {number[][]} intervals
 * @returns {number}
 */
function coveredLength(intervals) {
  let total = 0;
  let reach = -Infinity;
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (to > reach) {
      total += to - Math.max(from, reach);
      reach = to;
    }
  }
  return total;
}

/**
 * [0, length] with the given intervals cut out, e.g. a wall minus its doorways.
 * @param {number} length
 * @param {number[][]} holes
 * @returns {number[][]}
 */
export function cutIntervals(length, holes) {
  const pieces = [];
  let from = 0;
  for (const [a, b] of [...holes].sort((x, y) => x[0] - y[0])) {
    const start = Math.max(0, a);
    const end = Math.min(length, b);
    if (end <= start) continue;
    if (start > from) pieces.push([from, start]);
    from = Math.max(from, end);
  }
  if (from < length) pieces.push([from, length]);
  return pieces;
}

/**
 * Find the walls between rooms of a suite.
 *
 * A wall is an inside wall if, along at least 80% of its length, it faces a
 * wall of another room that runs the opposite way (as walls of two
 * clockwise rooms do when they face each other) across a gap of at most
 * 12 in. Each inside wall also gets its doorways: the doors on it, and the
 * doors on the wall opposite, projected across, so both sides open up.
 *
 * @param {{rooms: {outline: number[][], features: object[]}[]}} geometry
 * @returns {{inside: boolean, gap: number, doorways: number[][],
 *   pieces: number[][]}[][]} result[room][wall]: `gap` is the distance to the
 *   facing wall (inches); `doorways` are [from, to, height] (inches along the
 *   wall from its start corner, and the door's height); `pieces` are the
 *   [from, to] stretches of wall left once the doorways are cut out.
 */
export function insideWalls(geometry) {
  const frames = geometry.rooms.map((room) => wallFrames(room.outline));
  const info = frames.map((walls) => walls.map(() => ({ gap: Infinity, covered: [], facing: [], doorways: [] })));

  frames.forEach((wallsA, ra) => wallsA.forEach((a, wa) => {
    frames.forEach((wallsB, rb) => {
      if (rb === ra) return;
      wallsB.forEach((b, wb) => {
        if (dot(a.dir, b.dir) > -0.999) return;              // must run the opposite way
        const offset = [b.start[0] - a.start[0], b.start[1] - a.start[1]];
        const gap = -dot(offset, a.normal);                    // distance outward from a to b
        if (gap < -0.01 || gap > MAX_INSIDE_GAP) return;
        const t1 = dot(offset, a.dir);
        const t2 = t1 - b.length;                              // b runs the other way along a
        const from = Math.max(0, Math.min(t1, t2));
        const to = Math.min(a.length, Math.max(t1, t2));
        if (to - from <= 0.01) return;
        const entry = info[ra][wa];
        entry.covered.push([from, to]);
        entry.gap = Math.min(entry.gap, Math.max(gap, 0));
        entry.facing.push({ room: rb, wall: wb });
      });
    });
  }));

  const result = info.map((walls, r) => walls.map((entry, w) => ({
    inside: coveredLength(entry.covered) >= MIN_COVERAGE * frames[r][w].length,
    gap: entry.gap === Infinity ? 0 : entry.gap,
    doorways: [],
    pieces: [],
  })));

  // Doorways: each door on an inside wall opens that wall and the wall facing it.
  geometry.rooms.forEach((room, r) => {
    for (const feature of room.features) {
      if (feature.kind !== "door" || !result[r][feature.wall]?.inside) continue;
      const a = frames[r][feature.wall];
      result[r][feature.wall].doorways.push([feature.offset, feature.offset + feature.width, feature.height]);
      for (const { room: rb, wall: wb } of info[r][feature.wall].facing) {
        const b = frames[rb][wb];
        const along = (t) => dot([a.start[0] + a.dir[0] * t - b.start[0], a.start[1] + a.dir[1] * t - b.start[1]], b.dir);
        const [p, q] = [along(feature.offset), along(feature.offset + feature.width)];
        result[rb][wb].doorways.push([Math.min(p, q), Math.max(p, q), feature.height]);
      }
    }
  });
  result.forEach((walls, r) => walls.forEach((wall, w) => {
    wall.pieces = cutIntervals(frames[r][w].length, wall.doorways);
  }));
  return result;
}

/**
 * The floor area each inside wall stands on (its gap), as boxes: an item
 * that overlaps one "Crosses a wall". A shared wall (no gap) counts as 1 in
 * thick, so items straddling it are caught too.
 *
 * @param {{rooms: {outline: number[][], features: object[]}[]}} geometry
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}[]}
 */
export function insideWallBoxes(geometry) {
  const walls = insideWalls(geometry);
  const boxes = [];
  geometry.rooms.forEach((room, r) => wallFrames(room.outline).forEach((frame, w) => {
    if (!walls[r][w].inside) return;
    const depth = Math.max(walls[r][w].gap, 1);
    const end = [frame.start[0] + frame.dir[0] * frame.length, frame.start[1] + frame.dir[1] * frame.length];
    const out = [-frame.normal[0] * depth, -frame.normal[1] * depth];
    const xs = [frame.start[0], end[0], frame.start[0] + out[0], end[0] + out[0]];
    const ys = [frame.start[1], end[1], frame.start[1] + out[1], end[1] + out[1]];
    boxes.push({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
  }));
  return boxes;
}
