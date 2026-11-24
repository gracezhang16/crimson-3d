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
