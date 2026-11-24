/**
 * Room geometry (SPEC.md 4) -> three.js objects: floor, walls and the
 * dollhouse stubs (SPEC.md 8.3). Features on the walls arrive in P3.
 *
 * Plan [x, y] maps to three.js (x, 0, y): plan y (south) becomes three.js z,
 * and three.js y points up. 1 unit = 1 inch.
 */

import * as THREE from "three";
import { inwardNormal, wallLength, walls } from "../shared/geometry.js";
import { cameraOutsideWall, isConvexCorner } from "./roomMath.js";

const WALL_THICKNESS = 5;   // inches, standing outside the outline (SPEC.md 8.3)
const STUB_HEIGHT = 4;      // inches, for walls that would hide the room
const GRID_SPACING = 12;    // inches between floor grid lines
const FLOOR_COLOR = "#e9e2d4";
const GRID_COLOR = "#cfc5b2";
const WALL_COLOR = 0xf5f2ec;
const WALL_EDGE_COLOR = 0x9aa1ad;

/**
 * Build the room's three.js objects.
 *
 * @param {{ceiling: number, outline: number[][]}} geometry - the room format
 * @returns {{group: THREE.Group, bounds: THREE.Box3, walls: object[],
 *   update: (camera: THREE.Camera) => void}}
 *   `walls[i]` has `mesh`, `length`, `top` (the 3D point at the top centre of
 *   its inner face) and `isStub`. Call `update(camera)` before each frame.
 */
export function buildRoom(geometry) {
  const { outline, ceiling } = geometry;
  const group = new THREE.Group();
  group.add(makeFloor(outline));

  const wallParts = walls(outline).map((_, i) => makeWall(outline, i, ceiling));
  wallParts.forEach((part) => group.add(part.mesh));

  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const bounds = new THREE.Box3(
    new THREE.Vector3(Math.min(...xs), 0, Math.min(...ys)),
    new THREE.Vector3(Math.max(...xs), ceiling, Math.max(...ys)),
  );

  /**
   * Dollhouse view: drop every wall that stands between the camera and the
   * room to a stub; raise the others to full height.
   * @param {THREE.Camera} camera
   */
  function update(camera) {
    const cameraPlan = [camera.position.x, camera.position.z];
    wallParts.forEach((part, i) => {
      part.isStub = cameraOutsideWall(outline, i, cameraPlan);
      setWallHeight(part.mesh, part.isStub ? STUB_HEIGHT : ceiling);
    });
  }

  return { group, bounds, walls: wallParts, update };
}

/**
 * The floor: the outline as a flat shape with a 1 ft grid texture.
 *
 * @param {number[][]} outline
 * @returns {THREE.Mesh}
 */
function makeFloor(outline) {
  // A Shape is drawn in its own x-y plane. We trace it with y flipped and then
  // tip it flat with rotation.x = -90°, which maps shape (x, -y) to world
  // (x, 0, y) and leaves the visible side facing up.
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, -y)));
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ map: makeGridTexture(), roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  return floor;
}

/**
 * A small canvas with one grid square drawn on it, repeated across the floor.
 * ShapeGeometry uses the shape's own coordinates (inches) as texture
 * coordinates, so repeat = 1/12 makes one copy of the square span 12 in.
 *
 * @returns {THREE.CanvasTexture}
 */
function makeGridTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = FLOOR_COLOR;
  context.fillRect(0, 0, size, size);
  context.fillStyle = GRID_COLOR;
  context.fillRect(0, 0, size, 2); // top edge of the square
  context.fillRect(0, 0, 2, size); // left edge of the square

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / GRID_SPACING, 1 / GRID_SPACING);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8; // keeps the grid sharp at shallow viewing angles
  return texture;
}

/**
 * One wall: a box WALL_THICKNESS thick, standing just outside wall i.
 *
 * The box is built 1 unit tall so setWallHeight() can stretch it with
 * scale.y. At outer corners it is lengthened by the wall thickness so
 * neighbouring walls meet without a gap; at the inner corner of an L-shape
 * that would poke into the room, so it isn't.
 *
 * @param {number[][]} outline
 * @param {number} i - wall index
 * @param {number} ceiling - inches
 * @returns {{mesh: THREE.Mesh, length: number, top: THREE.Vector3, isStub: boolean}}
 */
function makeWall(outline, i, ceiling) {
  const { start, end } = walls(outline)[i];
  const length = wallLength(outline, i);
  const [nx, ny] = inwardNormal(outline, i);
  const direction = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];

  const extendStart = isConvexCorner(outline, i) ? WALL_THICKNESS : 0;
  const extendEnd = isConvexCorner(outline, (i + 1) % outline.length) ? WALL_THICKNESS : 0;
  const boxLength = length + extendStart + extendEnd;

  // Centre of the box: along the wall (shifted toward whichever end was
  // lengthened more), then half a thickness outward (against the normal).
  const along = (length + extendEnd - extendStart) / 2;
  const centerX = start[0] + direction[0] * along - nx * (WALL_THICKNESS / 2);
  const centerZ = start[1] + direction[1] * along - ny * (WALL_THICKNESS / 2);

  const box = new THREE.BoxGeometry(boxLength, 1, WALL_THICKNESS);
  box.translate(0, 0.5, 0); // origin at the bottom, so scaling y grows it upward
  const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: WALL_COLOR }));
  // Outline the box's edges so walls read clearly against each other.
  mesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(box),
    new THREE.LineBasicMaterial({ color: WALL_EDGE_COLOR }),
  ));
  mesh.position.set(centerX, 0, centerZ);
  // The box's length runs along its local x axis. Turning about y by -angle
  // lines it up with the wall (a positive y turn swings +x toward -z).
  mesh.rotation.y = -Math.atan2(direction[1], direction[0]);
  setWallHeight(mesh, ceiling);

  const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  return { mesh, length, top: new THREE.Vector3(mid[0], ceiling, mid[1]), isStub: false };
}

/**
 * @param {THREE.Mesh} mesh - a wall from makeWall()
 * @param {number} height - inches
 */
function setWallHeight(mesh, height) {
  mesh.scale.y = height;
}
