/**
 * Placement rules (SPEC.md 4.5). Claire.
 *
 * PURE: imports nothing from three.js or the DOM, so `node --test` can run it
 * (tests/rules.test.mjs). P3 adds the zones that wall features create on the
 * floor; P7 adds footprints, overlap, inside-the-room, snapping and issues.
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
