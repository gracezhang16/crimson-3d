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
