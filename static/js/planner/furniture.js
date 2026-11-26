/**
 * Furniture in 3D (SPEC.md 8.4). Claire.
 *
 * Catalog items are drawn as what they are (shapes.js: a bed with legs,
 * mattress and headboard, a desk with drawers, ...). Items with no shape,
 * like custom "will it fit" items, are boxes at true size in their colour
 * with darker edges. Each item also has its name on a small label lying on
 * top, shown only while it's selected (layout.js); the panel lists every
 * item by name.
 *
 * Each item is a THREE.Group whose origin is the centre of its footprint at
 * floor level, so moving it (P5) only changes group.position.x and .z.
 */

import * as THREE from "three";
import { buildShape } from "./shapes.js";

const LABEL_PIXELS_PER_INCH = 8;   // label texture resolution
const ISSUE_ORANGE = new THREE.Color("#f08c2e"); // SPEC.md 4.5 rule 8: items with an issue are tinted orange
const ISSUE_TINT = 0.65;                         // how far towards orange (0 = none, 1 = fully orange)
const LABEL_FONT = "600 {size}px system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * Build one placed item.
 *
 * @param {{x: number, y: number, rotation: number}} placement - x, y is the
 *   footprint centre in plan inches; rotation is clockwise in plan view
 * @param {{name: string, width: number, depth: number, height: number,
 *   color: string}} item - from rules.itemDimensions()
 * @returns {THREE.Group}
 */
export function makeFurniture(placement, item) {
  const group = new THREE.Group();
  group.add(buildShape(item) ?? makeBody(item));
  group.add(makeLabel(item, placement.rotation));

  // Plan x, y -> three.js x, z (SPEC.md 4.1).
  group.position.set(placement.x, 0, placement.y);
  // Plan rotation is clockwise seen from above. In three.js a positive turn
  // about y is anticlockwise seen from above (it swings +x toward -z, i.e.
  // east toward north), so we turn by minus the angle.
  group.rotation.y = -THREE.MathUtils.degToRad(placement.rotation);
  group.userData = { placement, item }; // lets P5 find the item from a click
  return group;
}

/**
 * Tint an item orange when it has an issue, or restore its catalog colour.
 * The issue's text is always shown in the panel too, so colour isn't the
 * only signal (SPEC.md 11).
 *
 * @param {THREE.Group} group - from makeFurniture()
 * @param {boolean} hasIssue
 */
export function setIssueTint(group, hasIssue) {
  // traverse() visits the group and everything inside it: every part of a
  // composite shape remembers its own colour in userData.baseColor.
  group.traverse((object) => {
    const base = object.userData.baseColor;
    if (object.isMesh && base) {
      object.material.color.copy(hasIssue ? base.clone().lerp(ISSUE_ORANGE, ISSUE_TINT) : base);
    }
  });
}

/**
 * Make an item see-through (while it's dragged over other furniture), or
 * solid again. depthWrite off lets the furniture underneath show through.
 *
 * @param {THREE.Group} group - from makeFurniture()
 * @param {boolean} ghost
 */
export function setGhost(group, ghost) {
  group.traverse((object) => {
    if (object.isMesh && !object.userData.isLabel && object.material.transparent !== ghost) {
      object.material.transparent = ghost;
      object.material.opacity = ghost ? 0.45 : 1;
      object.material.depthWrite = !ghost;
      object.material.needsUpdate = true; // switching transparency needs a new shader
    }
  });
}

/**
 * Show or hide an item's name label.
 *
 * @param {THREE.Group} group - from makeFurniture()
 * @param {boolean} visible
 */
export function setLabelVisible(group, visible) {
  group.traverse((object) => {
    if (object.userData.isLabel) {
      object.visible = visible;
    }
  });
}

/**
 * The box: width along local x, depth along local z, standing on the floor.
 * At rotation 0 that puts width along plan x and depth along plan y, with
 * the front facing +y (south), as SPEC.md 4.4 says.
 *
 * @param {{width: number, depth: number, height: number, color: string}} item
 * @returns {THREE.Mesh}
 */
function makeBody(item) {
  const geometry = new THREE.BoxGeometry(item.width, item.height, item.depth);
  geometry.translate(0, item.height / 2, 0); // bottom on the floor
  const color = new THREE.Color(item.color);
  const body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  body.userData.baseColor = color.clone(); // so setIssueTint() can switch back
  // Darker outline along the edges, so the top reads clearly from above.
  body.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.55) }),
  ));
  return body;
}

/**
 * The item's name, drawn on a canvas and laid flat on top of the box.
 * The text runs along the item's longer side so it has the most room, and
 * is flipped when the item's rotation would otherwise turn it upside down.
 *
 * @param {{name: string, width: number, depth: number, height: number}} item
 * @param {number} rotation - the item's rotation, 0, 90, 180 or 270
 * @returns {THREE.Mesh}
 */
function makeLabel(item, rotation) {
  const along = Math.max(item.width, item.depth) * 0.9;   // inches the text may use
  const across = Math.min(item.width, item.depth) * 0.6;
  const texture = new THREE.CanvasTexture(drawLabel(item.name, along, across));
  texture.colorSpace = THREE.SRGBColorSpace;

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(along, across),
    // Basic material ignores lighting, so the text stays readable; no depth
    // writing, so the transparent parts never hide anything behind them.
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  label.position.y = item.height + 0.3; // just above the top, so it doesn't flicker
  label.userData.isLabel = true;
  label.visible = false;                 // layout.js shows it while the item is selected
  // A plane stands upright facing +z. The rotations apply z first: turn the
  // text a quarter if it should run along the depth, then lay it flat (x by
  // -90°). Unturned, text runs east; along the depth it runs north.
  const runsAlongDepth = item.depth > item.width;
  // Seen from above, after the item's own turn, the text would run in this
  // direction (degrees clockwise from east). East (0) and north (270) read
  // well from the usual south-east view; south (90) and west (180) would be
  // upside down, so those get an extra half turn.
  const direction = (rotation + (runsAlongDepth ? 270 : 0)) % 360;
  const flip = direction === 90 || direction === 180 ? Math.PI : 0;
  label.rotation.set(-Math.PI / 2, 0, (runsAlongDepth ? Math.PI / 2 : 0) + flip);
  return label;
}

/**
 * Draw `text` as large as fits on a transparent canvas of the given size.
 *
 * @param {string} text
 * @param {number} widthInches
 * @param {number} heightInches
 * @returns {HTMLCanvasElement}
 */
function drawLabel(text, widthInches, heightInches) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(16, Math.round(widthInches * LABEL_PIXELS_PER_INCH));
  canvas.height = Math.max(8, Math.round(heightInches * LABEL_PIXELS_PER_INCH));
  const context = canvas.getContext("2d");

  // Start with text 60% of the label's height, then shrink until it fits.
  let size = canvas.height * 0.6;
  context.font = LABEL_FONT.replace("{size}", size);
  const fits = context.measureText(text).width;
  if (fits > canvas.width * 0.95) {
    size *= (canvas.width * 0.95) / fits;
    context.font = LABEL_FONT.replace("{size}", size);
  }
  context.fillStyle = "rgba(27, 34, 48, 0.85)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}
