/**
 * Room-format wall helpers (the contract, SPEC.md section 4).
 *
 * THIS FILE IS SHARED. geometry.py holds the same helpers in Python; any
 * change here needs the matching change there. Validation lives only in
 * Python (geometry.validate_room), because the server is the gatekeeper.
 *
 * This module must not import three.js or touch the DOM, so that
 * `node --test` can run its tests without a browser.
 *
 * Coordinates are plan-view inches: x grows to the right (east), y grows
 * downward (south), exactly like SVG. Outlines are listed clockwise as seen
 * on screen. Points are [x, y] arrays, the same shape as in the JSON.
 */

/**
 * The walls of an outline. Wall i runs from outline[i] to
 * outline[(i + 1) % n], so the last wall closes the shape.
 * @param {number[][]} outline corners as [x, y]
 * @returns {{start: number[], end: number[]}[]}
 */
export function walls(outline) {
  const n = outline.length;
  return outline.map((corner, i) => ({ start: corner, end: outline[(i + 1) % n] }));
}

/**
 * Length of wall i in inches.
 * @param {number[][]} outline
 * @param {number} i wall index
 * @returns {number}
 */
export function wallLength(outline, i) {
  const { start, end } = walls(outline)[i];
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

/**
 * The letter people see for wall i: 0 -> "A", 1 -> "B", ...
 * @param {number} i
 * @returns {string}
 */
export function wallLetter(i) {
  return String.fromCharCode("A".charCodeAt(0) + i);
}

/**
 * Signed area by the shoelace formula. With y pointing down, an outline
 * listed clockwise on screen has a POSITIVE area; counter-clockwise is
 * negative.
 * @param {number[][]} outline
 * @returns {number}
 */
export function signedArea(outline) {
  let total = 0;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % n];
    total += x1 * y2 - x2 * y1;
  }
  return total / 2;
}

/**
 * Unit vector pointing from wall i into the room.
 *
 * The interior side comes from the sign of the signed area, never from
 * assuming the order. For a positive area (clockwise on screen), turning the
 * wall direction (dx, dy) into (-dy, dx) points inside; otherwise the
 * opposite vector does. Example: the top wall of a rectangle runs along
 * (1, 0), so its inward normal is (0, 1), down the screen into the room.
 * @param {number[][]} outline
 * @param {number} i wall index
 * @returns {number[]} [nx, ny]
 */
export function inwardNormal(outline, i) {
  const { start, end } = walls(outline)[i];
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const dx = (end[0] - start[0]) / length;
  const dy = (end[1] - start[1]) / length;
  const sign = signedArea(outline) > 0 ? 1 : -1;
  // "+ 0" turns -0 into 0 so results compare cleanly in tests.
  return [-dy * sign + 0, dx * sign + 0];
}

/**
 * The point `distance` inches along wall i from its start corner.
 * @param {number[][]} outline
 * @param {number} i wall index
 * @param {number} distance inches from the start corner
 * @returns {number[]} [x, y]
 */
export function pointAlongWall(outline, i, distance) {
  const { start, end } = walls(outline)[i];
  const t = distance / wallLength(outline, i);
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

/**
 * Where a wall feature begins and ends on its wall. `start` is `offset`
 * inches from the wall's start corner (the corner on your left when you
 * stand inside the room facing the wall); `end` is `width` inches further.
 * An outlet has no width, so start and end are the same point.
 * @param {number[][]} outline
 * @param {{kind: string, wall: number, offset: number, width?: number}} feature
 * @returns {{start: number[], end: number[]}}
 */
export function featureSpan(outline, feature) {
  const width = feature.kind === "outlet" ? 0 : (feature.width ?? 0);
  return {
    start: pointAlongWall(outline, feature.wall, feature.offset),
    end: pointAlongWall(outline, feature.wall, feature.offset + width),
  };
}
