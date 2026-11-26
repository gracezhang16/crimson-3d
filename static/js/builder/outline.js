/**
 * Click-to-draw room outlines (SPEC.md 9.2, milestone A8). Hannah.
 *
 * Pure: no DOM, no three.js, so tests/outline.test.mjs runs it under node.
 * builder/draw.js handles the mouse and calls these.
 *
 * How drawing works: the admin clicks corners on the preview. Each click
 * snaps to a 6 in grid, and each wall is kept at a right angle (it runs
 * north, south, east or west). Clicking the first corner closes the shape.
 * The closed outline becomes ordinary "walk the walls" rows (state.js), so a
 * drawn room is saved, edited and checked exactly like a walked one.
 *
 * The drawing is only a sketch: its lengths are "drawn" estimates. When the
 * admin types a measured length, closeWalk() changes the nearest drawn wall
 * on the same axis so the room still closes ("lengths propagate around the
 * polygon").
 *
 * findCrossing() mirrors geometry.py's _find_crossing message for message
 * (tests/fixtures/outline_cases.json is checked by both test suites).
 */

import { signedArea, wallLetter } from "../shared/geometry.js";

// One step of 1 inch in each direction, in plan coordinates (y points south).
export const DIRECTIONS = {
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
  north: [0, -1],
};

export const SNAP = 6;              // inches: the drawing grid (SPEC.md 9.2)
const MAX_COORDINATE = 1200;        // SPEC.md 4.2
const MIN_WALLS = 4;                // a closed right-angled room has at least 4 walls
const MAX_WALLS = 12;               // state.js MAX_WALLS: what the walls table allows

/**
 * Snap a point to the drawing grid, kept inside the allowed coordinates.
 *
 * @param {number[]} point - [x, y] in inches, any precision
 * @param {number} [step]
 * @returns {number[]} whole-inch [x, y], a multiple of `step`
 */
export function snapPoint([x, y], step = SNAP) {
  const snap = (value) => Math.min(MAX_COORDINATE, Math.max(0, Math.round(value / step) * step));
  return [snap(x), snap(y)];
}

/**
 * Keep the wall from `from` to `to` at a right angle: whichever of the east-west
 * or north-south distance is bigger wins, and the other is dropped.
 *
 * @param {number[]} from - the last corner
 * @param {number[]} to - where the pointer is (already snapped)
 * @returns {number[]}
 */
export function rightAngle(from, to) {
  return Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]];
}

/**
 * True if b lies on the straight line through a and c (cross product 0).
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[]} c
 */
function inLine(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0;
}

/**
 * Add a clicked corner to an outline being drawn.
 *
 * A click on the last corner does nothing. A click that carries on in the
 * same line as the last wall (or back along it) moves the last corner
 * instead of adding one, so a wall is never split in two by accident.
 *
 * @param {number[][]} corners - placed so far
 * @param {number[]} point - snapped and right-angled
 * @returns {number[][]} a new array (the input is not changed)
 */
export function addCorner(corners, point) {
  const last = corners.at(-1);
  if (last && last[0] === point[0] && last[1] === point[1]) {
    return corners;
  }
  if (corners.length >= 2 && inLine(corners.at(-2), last, point)) {
    const before = corners.at(-2);
    const backToStart = before[0] === point[0] && before[1] === point[1];
    return backToStart ? corners.slice(0, -1) : [...corners.slice(0, -1), point];
  }
  return [...corners, point];
}

/**
 * Remove repeated corners and corners in the middle of a straight wall,
 * going round the closed outline until none are left.
 *
 * @param {number[][]} corners
 * @returns {number[][]}
 */
function simplify(corners) {
  let points = corners.filter((p, i) => {
    const next = corners[(i + 1) % corners.length];
    return p[0] !== next[0] || p[1] !== next[1];
  });
  let changed = true;
  while (changed && points.length > 2) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];
      // Only drop a corner that sits *between* its neighbours; one where the
      // wall folds straight back stays, so findCrossing() can report it.
      const between = (prev[0] - points[i][0]) * (next[0] - points[i][0])
        + (prev[1] - points[i][1]) * (next[1] - points[i][1]) < 0;
      if (inLine(prev, points[i], next) && between) {
        points = points.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return points;
}

/**
 * Close a drawn outline: the last wall goes back to the first corner.
 *
 * If the last corner isn't in line with the first, one corner is added so the
 * closing walls are still at right angles (turning from the last wall). The
 * result is clockwise (reversed if drawn the other way), starting at the first
 * corner clicked, so wall A is the first wall drawn whenever possible.
 *
 * @param {number[][]} corners - at least three, each wall at a right angle
 * @returns {{outline: number[][] | null, error: string | null}}
 */
export function closeShape(corners) {
  if (corners.length < 3) {
    return { outline: null, error: "Place at least three corners before closing the shape." };
  }
  const points = [...corners];
  const first = points[0];
  const last = points.at(-1);
  if (last[0] !== first[0] && last[1] !== first[1]) {
    const lastWallRunsEastWest = points.at(-2)[1] === last[1];
    points.push(lastWallRunsEastWest ? [last[0], first[1]] : [first[0], last[1]]);
  }
  let outline = simplify(points);
  if (outline.length < MIN_WALLS) {
    return { outline: null, error: `A room needs at least ${MIN_WALLS} walls. Add more corners.` };
  }
  if (outline.length > MAX_WALLS) {
    return { outline: null, error: `A room can have at most ${MAX_WALLS} walls.` };
  }
  if (signedArea(outline) === 0) {
    return { outline: null, error: "The outline has no area." };
  }
  const crossing = findCrossing(outline);
  if (crossing) {
    return { outline: null, error: crossing };
  }
  // With y pointing down, clockwise on screen has a positive signed area.
  if (signedArea(outline) < 0) {
    outline = [outline[0], ...outline.slice(1).reverse()];
  }
  return { outline, error: null };
}

// ---------------------------------------------------------------------------
// Crossing walls: the same checks, in the same order and words, as
// geometry.py's _find_crossing, _segments_meet and _folds_back.
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

/** True if segment p1p2 and segment p3p4 share at least one point. */
function segmentsMeet(p1, p2, p3, p4) {
  const d1 = orientation(p3, p4, p1);
  const d2 = orientation(p3, p4, p2);
  const d3 = orientation(p1, p2, p3);
  const d4 = orientation(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (d1 === 0 && onSegment(p3, p1, p4)) || (d2 === 0 && onSegment(p3, p2, p4))
    || (d3 === 0 && onSegment(p1, p3, p2)) || (d4 === 0 && onSegment(p1, p4, p2));
}

/** True if `second` starts where `first` ends and heads straight back along it. */
function foldsBack([p, q], [, r]) {
  const backwards = (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]) < 0;
  return orientation(p, q, r) === 0 && backwards;
}

/**
 * A message if any two walls cross or touch, else null. Neighbouring walls
 * share a corner, so for them only doubling straight back counts.
 *
 * @param {number[][]} outline
 * @returns {string | null}
 */
export function findCrossing(outline) {
  const n = outline.length;
  const edges = outline.map((p, i) => [p, outline[(i + 1) % n]]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const neighbours = j === i + 1 || (i === 0 && j === n - 1);
      if (neighbours) {
        const [first, second] = j === i + 1 ? [edges[i], edges[j]] : [edges[j], edges[i]];
        if (foldsBack(first, second)) {
          return `Walls ${wallLetter(i)} and ${wallLetter(j)} double back over each other.`;
        }
      } else if (segmentsMeet(...edges[i], ...edges[j])) {
        return `Walls ${wallLetter(i)} and ${wallLetter(j)} cross each other.`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Outline <-> walked walls
// ---------------------------------------------------------------------------

/**
 * The walls of an outline as walk-the-walls rows, starting at corner 0.
 *
 * @param {number[][]} outline
 * @returns {{direction: string, length: number}[] | null} null if a wall is angled
 */
export function wallsFromOutline(outline) {
  const walls = [];
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    const [dx, dy] = [x2 - x1, y2 - y1];
    if (dx !== 0 && dy !== 0) {
      return null;
    }
    const direction = dx > 0 ? "east" : dx < 0 ? "west" : dy > 0 ? "south" : "north";
    walls.push({ direction, length: Math.abs(dx + dy) });
  }
  return walls;
}

/**
 * Keep a walk closed after the admin types a measured length.
 *
 * For each axis (east-west, north-south) where the walk no longer returns to
 * its start, change the first *drawn* wall on that axis after the edited one,
 * going round the room, by exactly the gap. Walls with typed lengths are
 * never changed. If no drawn wall can take up the gap (it would drop below
 * 1 in), the gap stays and the preview shows it as usual.
 *
 * @param {{direction: string, length: number}[]} walls - parsed lengths
 * @param {number} edited - index of the wall just typed in
 * @param {boolean[]} drawn - drawn[i] is true while wall i's length is a sketch
 * @returns {{lengths: number[], adjusted: number[]} | null} null when a row is unusable
 */
export function closeWalk(walls, edited, drawn) {
  const usable = walls.every((wall) => wall.direction in DIRECTIONS && Number.isInteger(wall.length));
  if (!usable) {
    return null;
  }
  const lengths = walls.map((wall) => wall.length);
  const gap = [0, 0];
  walls.forEach((wall, i) => {
    const [dx, dy] = DIRECTIONS[wall.direction];
    gap[0] += dx * lengths[i];
    gap[1] += dy * lengths[i];
  });
  const adjusted = [];
  for (const axis of [0, 1]) {
    if (gap[axis] === 0) continue;
    for (let step = 1; step < walls.length; step++) {
      const j = (edited + step) % walls.length;
      const along = DIRECTIONS[walls[j].direction][axis]; // +1, -1, or 0 (other axis)
      if (!drawn[j] || along === 0) continue;
      // Wall j adds along * length to this axis; change it by -gap to cancel the gap.
      const length = lengths[j] - along * gap[axis];
      if (length >= 1 && length <= MAX_COORDINATE) {
        lengths[j] = length;
        adjusted.push(j);
        break;
      }
    }
  }
  return { lengths, adjusted };
}
