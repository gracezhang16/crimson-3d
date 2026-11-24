/**
 * Wall features in 3D (SPEC.md 4.3): doors, windows, closets, radiators and
 * outlets, plus the faint door zones on the floor. Claire.
 *
 * Features are panels standing just in front of the wall's inner face; no
 * holes are cut in walls (SPEC.md 8.3). Each one is positioned with
 * featureSpan() from shared/geometry.js, the same function the admin
 * builder's preview uses, so both agree on where a feature is.
 */

import * as THREE from "three";
import { featureSpan, inwardNormal } from "../shared/geometry.js";
import { zones } from "./rules.js";

const OUTLET_HEIGHT = 12;          // inches above the floor (SPEC.md 4.3)
const DEFAULT_RADIATOR_HEIGHT = 24;
const DEFAULT_RADIATOR_DEPTH = 6;
const FRAME = 2;                   // inches of frame around doors and windows

const COLORS = {
  doorFrame: 0x5e3b1a,
  door: 0x8b5a2b,
  windowFrame: 0xf2f4f7,
  glass: 0x9cc3e6,
  closetFrame: 0xd6d0c4,
  closetDoor: 0xc9b99c,
  radiator: 0x9aa1ad,
  outlet: 0xfafafa,
  doorZone: 0xa51c30,
};

/**
 * Build every feature of one room of a suite.
 *
 * @param {{outline: number[][], features: object[]}} room
 * @returns {{onWall: THREE.Group[], onFloor: THREE.Group}}
 *   onWall[i] holds the panels mounted on wall i (hidden with the wall when
 *   it drops to a stub); onFloor holds radiators and door zones, which stay.
 */
export function buildFeatures(room) {
  const { outline, features } = room;
  const onWall = outline.map(() => new THREE.Group());
  const onFloor = new THREE.Group();

  for (const feature of features) {
    const object = makeFeature(feature);
    placeOnWall(object, outline, feature);
    (feature.kind === "radiator" ? onFloor : onWall[feature.wall]).add(object);
  }
  // zones() takes a whole suite, so wrap this room as a one-room suite.
  for (const zone of zones({ rooms: [room] }).filter((z) => z.kind === "door")) {
    onFloor.add(makeZoneTint(zone.corners));
  }
  return { onWall, onFloor };
}

/**
 * A box with its bottom-centre at (x, y, z) in the feature's own space:
 * x along the wall, y up, z into the room.
 *
 * @returns {THREE.Mesh}
 */
function box(width, height, depth, color, { x = 0, y = 0, z = 0, opacity = 1 } = {}) {
  const material = new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y + height / 2, z + depth / 2);
  return mesh;
}

/**
 * Build one feature in its own space: x runs along the wall from the
 * feature's centre, y is up from the floor, z points into the room from the
 * wall's inner face.
 *
 * @param {object} feature
 * @returns {THREE.Group}
 */
function makeFeature(feature) {
  const group = new THREE.Group();
  const { width = 0, height = 0 } = feature;
  switch (feature.kind) {
    case "door":
      // A dark frame with the door panel just in front of it.
      group.add(box(width, height, 0.8, COLORS.doorFrame));
      group.add(box(width - 2 * FRAME, height - FRAME, 1.4, COLORS.door));
      break;
    case "window": {
      const { sill } = feature;
      group.add(box(width, height, 0.8, COLORS.windowFrame, { y: sill }));
      group.add(box(width - 2 * FRAME, height - 2 * FRAME, 1, COLORS.glass, { y: sill + FRAME, opacity: 0.65 }));
      group.add(box(width + 4, 1.5, 4, COLORS.windowFrame, { y: sill - 1.5 })); // the sill ledge
      break;
    }
    case "closet": {
      // A frame with two doors side by side, a small gap between them.
      const doorWidth = width / 2 - FRAME - 0.5;
      group.add(box(width, height, 0.8, COLORS.closetFrame));
      for (const side of [-1, 1]) {
        group.add(box(doorWidth, height - FRAME, 1.4, COLORS.closetDoor, { x: side * (doorWidth / 2 + 0.5) }));
      }
      break;
    }
    case "radiator":
      group.add(box(width, feature.height ?? DEFAULT_RADIATOR_HEIGHT,
        feature.depth ?? DEFAULT_RADIATOR_DEPTH, COLORS.radiator));
      break;
    case "outlet":
      group.add(box(3, 4.5, 0.5, COLORS.outlet, { y: OUTLET_HEIGHT - 2.25 }));
      break;
  }
  return group;
}

/**
 * Move a feature from its own space onto its wall: its centre goes to the
 * middle of its span, and it is turned so x runs along the wall and z points
 * into the room.
 *
 * @param {THREE.Object3D} object
 * @param {number[][]} outline
 * @param {object} feature
 */
function placeOnWall(object, outline, feature) {
  const { start, end } = featureSpan(outline, feature);
  const [nx, ny] = inwardNormal(outline, feature.wall);
  const center = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  object.position.set(center[0] + nx * 0.1, 0, center[1] + ny * 0.1); // a hair in front of the wall
  // The local z axis must point along the inward normal (nx, 0, ny). A turn
  // of angle a about y sends local z to (sin a, 0, cos a), so a = atan2(nx, ny).
  object.rotation.y = Math.atan2(nx, ny);
}

/**
 * A faint tint on the floor showing where a door swings (SPEC.md 4.3).
 *
 * @param {number[][]} corners - plan coordinates, in order
 * @returns {THREE.Mesh}
 */
function makeZoneTint(corners) {
  // Same trick as the floor in room.js: trace with y flipped, then lie flat.
  const shape = new THREE.Shape(corners.map(([x, y]) => new THREE.Vector2(x, -y)));
  const tint = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: COLORS.doorZone, transparent: true, opacity: 0.12, depthWrite: false }),
  );
  tint.rotation.x = -Math.PI / 2;
  tint.position.y = 0.2; // just above the floor so the two don't flicker
  return tint;
}
