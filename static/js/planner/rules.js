/**
 * Placement rules (SPEC.md 4.5). Claire.
 *
 * PURE: imports nothing from three.js or the DOM, so `node --test` can run it
 * (tests/rules.test.mjs). P3 added the zones that wall features create on the
 * floor; P4 adds item sizes and footprints; P7 adds overlap, inside-the-room,
 * snapping and issues.
 *
 * Coordinates are plan inches, [x, y] with y pointing south (SPEC.md 4.1).
 */

import { featureSpan, inwardNormal } from "../shared/geometry.js";

const CLOSET_ZONE_DEPTH = 24;      // inches in front of a closet (SPEC.md 4.3)
const DEFAULT_RADIATOR_DEPTH = 6;  // SPEC.md 4.2

// The issue an item gets when it overlaps each kind of zone (SPEC.md 4.5 rule 8).
const ZONE_ISSUES = {
  door: "Blocks the door",
  closet: "Blocks the closet",
  radiator: "Hits the radiator",
};

/**
 * How far a feature's floor zone reaches into the room, or 0 for features
 * that make no zone (windows, outlets).
 *
 * @param {{kind: string, width?: number, depth?: number}} feature
 * @returns {number} inches
 */
function zoneDepth(feature) {
  switch (feature.kind) {
    case "door":
      return feature.width;                         // a width × width square
    case "closet":
      return CLOSET_ZONE_DEPTH;
    case "radiator":
      return feature.depth ?? DEFAULT_RADIATOR_DEPTH;
    default:
      return 0;
  }
}

/**
 * The floor zones a room's features create (SPEC.md 4.3): a rectangle against
 * the wall, as wide as the feature, reaching `zoneDepth` inches into the room.
 *
 * Each zone has its four corners (in order, so it can be drawn) and its
 * axis-aligned bounding box, which the P7 overlap rules use.
 *
 * @param {{outline: number[][], features: object[]}} geometry
 * @returns {{kind: string, issue: string, corners: number[][],
 *   box: {minX: number, minY: number, maxX: number, maxY: number}}[]}
 */
export function zones(geometry) {
  const { outline, features } = geometry;
  return features
    .filter((feature) => zoneDepth(feature) > 0)
    .map((feature) => {
      const { start, end } = featureSpan(outline, feature);
      const [nx, ny] = inwardNormal(outline, feature.wall);
      const depth = zoneDepth(feature);
      // Along the wall from start to end, then step into the room and back.
      const corners = [
        start,
        end,
        [end[0] + nx * depth, end[1] + ny * depth],
        [start[0] + nx * depth, start[1] + ny * depth],
      ].map(([x, y]) => [x + 0, y + 0]); // "+ 0" turns -0 into 0 for clean comparisons
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      return {
        kind: feature.kind,
        issue: ZONE_ISSUES[feature.kind],
        corners,
        box: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
      };
    });
}


// Colour for custom "will it fit" items, which have no catalog colour.
const CUSTOM_ITEM_COLOR = "#9aa1ad";

/**
 * The name, size and colour of a placed item (SPEC.md 4.4): from the catalog
 * for a catalog item, or from the placement itself for a custom item.
 *
 * @param {{furniture_id: number | null, label?: string, width?: number,
 *   depth?: number, height?: number}} placement
 * @param {Map<number, object>} catalogById - /api/furniture rows by id
 * @returns {{name: string, width: number, depth: number, height: number,
 *   clearance: number, color: string, category: string} | null} null if the
 *   catalog item no longer exists
 */
export function itemDimensions(placement, catalogById) {
  if (placement.furniture_id === null) {
    const { label, width, depth, height } = placement;
    return { name: label, width, depth, height, clearance: 0, color: CUSTOM_ITEM_COLOR, category: "custom" };
  }
  const item = catalogById.get(placement.furniture_id);
  if (!item) {
    return null;
  }
  const { name, width, depth, height, clearance, color, category } = item;
  return { name, width, depth, height, clearance, color, category };
}

/**
 * Rule 1 (SPEC.md 4.5): half the footprint's size along plan x and plan y.
 * At rotation 0 or 180 the width runs along x and the depth along y; at 90
 * or 270 they swap. Rotation is always a multiple of 90, so footprints stay
 * axis-aligned rectangles.
 *
 * @param {{width: number, depth: number}} size
 * @param {number} rotation - 0, 90, 180 or 270
 * @returns {{halfX: number, halfY: number}}
 */
export function footprint(size, rotation) {
  const turned = rotation === 90 || rotation === 270;
  return {
    halfX: (turned ? size.depth : size.width) / 2,
    halfY: (turned ? size.width : size.depth) / 2,
  };
}

/**
 * The footprint of a placed item as a box in plan coordinates.
 *
 * @param {{x: number, y: number, rotation: number}} placement - x, y is the centre
 * @param {{width: number, depth: number}} size
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
export function footprintBox(placement, size) {
  const { halfX, halfY } = footprint(size, placement.rotation);
  return {
    minX: placement.x - halfX,
    minY: placement.y - halfY,
    maxX: placement.x + halfX,
    maxY: placement.y + halfY,
  };
}
