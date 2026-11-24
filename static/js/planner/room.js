/**
 * Suite geometry (SPEC.md 4) -> three.js objects: each room's floor, walls,
 * the dollhouse stubs (SPEC.md 8.3) and the wall features (features.js).
 *
 * Plan [x, y] maps to three.js (x, 0, y): plan y (south) becomes three.js z,
 * and three.js y points up. 1 unit = 1 inch.
 */

import * as THREE from "three";
import { inwardNormal, wallLength, walls } from "../shared/geometry.js";
import { buildFeatures } from "./features.js";
import { cameraOutsideWall, insideWalls, isConvexCorner } from "./roomMath.js";

const WALL_THICKNESS = 5;   // inches, standing outside the outline (SPEC.md 8.3)
const STUB_HEIGHT = 4;      // inches, for walls that would hide the room
const INSIDE_HEIGHT = 8;    // inches: walls between rooms of a suite stay low so every room shows
const THRESHOLD_COLOR = 0xb98b5e; // the wooden strip across a doorway between rooms
const GRID_SPACING = 12;    // inches between floor grid lines
const FLOOR_COLOR = "#e9e2d4";
const GRID_COLOR = "#cfc5b2";
const WALL_COLOR = 0xf5f2ec;
const WALL_EDGE_COLOR = 0x9aa1ad;

/**
 * Build a suite's three.js objects: every room's floor, walls and features.
 * All rooms share one plan, so they appear side by side as they really are.
 *
 * @param {{ceiling: number, rooms: {outline: number[][], features: object[]}[]}} geometry
 *   - the suite format (version 2)
 * @returns {{group: THREE.Group, bounds: THREE.Box3, walls: object[],
 *   update: (camera: THREE.Camera) => void}}
 *   `walls` lists every room's walls; each has `mesh`, `length`, `top` (the
 *   3D point at the top centre of its inner face) and `isStub`. Call
 *   `update(camera)` before each frame.
 */
export function buildRoom(geometry) {
  const { ceiling } = geometry;
  const group = new THREE.Group();
  const between = insideWalls(geometry); // which walls stand between rooms
  const rooms = geometry.rooms.map((room, r) => buildOneRoom(room, ceiling, group, between[r]));

  const corners = geometry.rooms.flatMap((room) => room.outline);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const bounds = new THREE.Box3(
    new THREE.Vector3(Math.min(...xs), 0, Math.min(...ys)),
    new THREE.Vector3(Math.max(...xs), ceiling, Math.max(...ys)),
  );

  /**
   * Dollhouse view: drop every outside wall that stands between the camera
   * and its room to a stub, hiding the doors, windows and so on mounted on
   * it; raise the others to full height. Walls between rooms stay low
   * whatever the camera does. Radiators and door zones are on the floor, so
   * they always show.
   * @param {THREE.Camera} camera
   */
  function update(camera) {
    const cameraPlan = [camera.position.x, camera.position.z];
    for (const { outline, wallParts, features } of rooms) {
      wallParts.forEach((part, i) => {
        if (part.inside) return;
        part.isStub = cameraOutsideWall(outline, i, cameraPlan);
        setWallHeight(part.mesh, part.isStub ? STUB_HEIGHT : ceiling);
        features.onWall[i].visible = !part.isStub;
      });
    }
  }

  return { group, bounds, walls: rooms.flatMap((room) => room.wallParts), update };
}

/**
 * Add one room's floor, walls and features to `group`.
 *
 * @param {{outline: number[][], features: object[]}} room
 * @param {number} ceiling
 * @param {THREE.Group} group
 * @param {object[]} between - insideWalls() for this room, wall by wall
 * @returns {{outline: number[][], wallParts: object[], features: object}}
 */
function buildOneRoom(room, ceiling, group, between) {
  const { outline } = room;
  group.add(makeFloor(outline));
  const wallParts = walls(outline).map((_, i) => (between[i].inside
    ? makeInsideWall(outline, i, ceiling, between[i])
    : makeWall(outline, i, ceiling)));
  wallParts.forEach((part) => group.add(part.mesh));
  const features = buildFeatures(room);
  features.onWall.forEach((wallFeatures, i) => {
    // Panels on a low wall between rooms would float in mid-air, so they're
    // hidden; a doorway shows as a gap in the wall with a threshold instead.
    wallFeatures.visible = !between[i].inside;
    group.add(wallFeatures);
  });
  group.add(features.onFloor);
  for (const feature of room.features) {
    if (feature.kind === "door" && between[feature.wall].inside && between[feature.wall].gap > 0) {
      group.add(makeThreshold(outline, feature, between[feature.wall].gap));
    }
  }
  return { outline, wallParts, features };
}

/**
 * A low wall between two rooms, built from pieces with the doorways left out.
 * Both rooms draw their side of the gap, each half as thick as the gap, so
 * together they fill it without overlapping (overlapping faces flicker).
 *
 * @param {number[][]} outline
 * @param {number} i - wall index
 * @param {number} ceiling - inches
 * @param {{gap: number, pieces: number[][]}} info - from insideWalls()
 * @returns {{mesh: THREE.Group, length: number, top: THREE.Vector3, isStub: boolean, inside: boolean}}
 */
function makeInsideWall(outline, i, ceiling, info) {
  const { start, end } = walls(outline)[i];
  const length = wallLength(outline, i);
  const [nx, ny] = inwardNormal(outline, i);
  const direction = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
  const thickness = Math.max(info.gap / 2, 0.75);
  const material = new THREE.MeshStandardMaterial({ color: WALL_COLOR });
  const pieces = new THREE.Group();
  for (const [from, to] of info.pieces) {
    const box = new THREE.BoxGeometry(to - from, 1, thickness);
    box.translate(0, 0.5, 0);
    const piece = new THREE.Mesh(box, material);
    piece.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: WALL_EDGE_COLOR })));
    const along = (from + to) / 2;
    piece.position.set(
      start[0] + direction[0] * along - nx * (thickness / 2), 0,
      start[1] + direction[1] * along - ny * (thickness / 2),
    );
    piece.rotation.y = -Math.atan2(direction[1], direction[0]);
    pieces.add(piece);
  }
  // Built 1 unit tall like the outside walls, so one scale sets the height.
  setWallHeight(pieces, INSIDE_HEIGHT);
  const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  // isStub is always true, so wall-length labels skip these low walls.
  return { mesh: pieces, length, top: new THREE.Vector3(mid[0], ceiling, mid[1]), isStub: true, inside: true };
}

/**
 * A wooden strip across the gap at a doorway between rooms.
 *
 * @param {number[][]} outline
 * @param {{wall: number, offset: number, width: number}} door
 * @param {number} gap - inches between the two rooms
 * @returns {THREE.Mesh}
 */
function makeThreshold(outline, door, gap) {
  const { start, end } = walls(outline)[door.wall];
  const length = wallLength(outline, door.wall);
  const [nx, ny] = inwardNormal(outline, door.wall);
  const direction = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
  const along = door.offset + door.width / 2;
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(door.width, 0.4, gap),
    new THREE.MeshStandardMaterial({ color: THRESHOLD_COLOR, roughness: 0.7 }),
  );
  strip.position.set(start[0] + direction[0] * along - nx * (gap / 2), 0.2, start[1] + direction[1] * along - ny * (gap / 2));
  strip.rotation.y = -Math.atan2(direction[1], direction[0]);
  return strip;
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
 * @param {THREE.Object3D} mesh - a wall from makeWall() or makeInsideWall()
 * @param {number} height - inches
 */
function setWallHeight(mesh, height) {
  mesh.scale.y = height;
}
