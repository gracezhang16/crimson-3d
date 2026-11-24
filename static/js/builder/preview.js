/**
 * Draw a room's outline as an SVG floor plan (SPEC.md 9.1). Hannah.
 *
 * SVG uses the same coordinates as our plan: x to the right, y downward. So
 * the room's corners are drawn exactly as they are, in inches, and the
 * `viewBox` attribute does the scaling: it says "show this rectangle of
 * inches", and the browser stretches it to fill the <svg> element while
 * keeping its proportions. No scaling maths here.
 *
 * Lines use vector-effect="non-scaling-stroke" so they stay 1-2 screen pixels
 * wide whatever the room's size. Text is sized in inches relative to the room.
 *
 * The exported helpers (wallSegments, previewBox, labelPoint, labelAnchor,
 * featureRect) are pure and tested in tests/builder.test.mjs; drawPreview()
 * needs a browser.
 *
 * Features are placed with featureSpan() from shared/geometry.js, the same
 * function the 3D planner uses, so the preview and the planner agree.
 */

import { featureSpan, inwardNormal, wallLength, wallLetter } from "../shared/geometry.js";
import { formatFeetInches } from "../shared/units.js";

const SVG_NS = "http://www.w3.org/2000/svg"; // SVG elements need this namespace
const GRID_SPACING = 12; // inches
const CLOSET_DEPTH = 24;            // the zone in front of a closet (SPEC.md 4.3)
const DEFAULT_RADIATOR_DEPTH = 6;
const WINDOW_LINE_GAP = 3;          // inches between a window's two lines

/**
 * The walls as drawn: wall i runs from corner i to corner i + 1. For a closed
 * room the last wall returns to corner 0; for an open walk (walls that don't
 * meet) it ends where the admin's last wall actually ends.
 *
 * @param {number[][]} outline
 * @param {number[] | null} openEnd
 * @returns {{start: number[], end: number[]}[]}
 */
export function wallSegments(outline, openEnd = null) {
  return outline.map((start, i) => ({
    start,
    end: i < outline.length - 1 ? outline[i + 1] : (openEnd ?? outline[0]),
  }));
}

/**
 * The area to show: the drawing's bounding box plus a margin for the labels.
 *
 * @param {number[][]} points
 * @returns {{x: number, y: number, width: number, height: number, margin: number}}
 */
export function previewBox(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const margin = Math.max(width, height) * 0.2;
  return {
    x: Math.min(...xs) - margin,
    y: Math.min(...ys) - margin,
    width: width + 2 * margin,
    height: height + 2 * margin,
    margin,
  };
}

/**
 * The unit vector pointing out of the room from a wall. Outlines are
 * clockwise on screen (SPEC.md 4.1), so for a wall heading (dx, dy) the
 * outside is (dy, -dx): heading east along the top wall, outside is north.
 *
 * @param {{start: number[], end: number[]}} segment
 * @returns {number[]} [x, y]
 */
function outwardNormal({ start, end }) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  return [(end[1] - start[1]) / length, -(end[0] - start[0]) / length];
}

/**
 * Where to put a wall's label: `distance` inches outside its middle.
 *
 * @param {{start: number[], end: number[]}} segment
 * @param {number} distance
 * @returns {number[]} [x, y]
 */
export function labelPoint(segment, distance) {
  const [ox, oy] = outwardNormal(segment);
  return [
    (segment.start[0] + segment.end[0]) / 2 + ox * distance,
    (segment.start[1] + segment.end[1]) / 2 + oy * distance,
  ];
}

/**
 * How to line up a wall's label so it never sits on the wall: labels outside
 * an east-facing wall start at their point, labels outside a west-facing wall
 * end at it, and labels above or below a wall are centred.
 *
 * @param {{start: number[], end: number[]}} segment
 * @returns {"start" | "middle" | "end"} an SVG text-anchor value
 */
export function labelAnchor(segment) {
  const [ox] = outwardNormal(segment);
  if (ox > 0.5) return "start";
  if (ox < -0.5) return "end";
  return "middle";
}

/**
 * Create an SVG element with attributes.
 *
 * @param {string} tag
 * @param {Object<string, string | number>} attributes
 * @returns {SVGElement}
 */
function svgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

/**
 * Draw the room on `svg`, replacing whatever was there.
 *
 * @param {SVGSVGElement} svg
 * @param {{outline: number[][]} | null} geometry - null shows an empty preview
 * @param {number[] | null} [openEnd] - where an unclosed walk ends; the gap
 *   back to the first corner is drawn as a dashed red line
 * @param {string[][]} [featureErrors] - features with problems aren't drawn
 */
export function drawPreview(svg, geometry, openEnd = null, featureErrors = []) {
  svg.replaceChildren();
  if (!geometry) {
    svg.setAttribute("viewBox", "0 0 100 75");
    return;
  }
  const { outline } = geometry;
  const box = previewBox(openEnd ? [...outline, openEnd] : outline);
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  const points = outline.map(([x, y]) => `${x},${y}`).join(" ");

  if (openEnd) {
    // An open walk isn't a room yet: draw the walls as a path, plus the gap.
    const path = [...outline, openEnd].map(([x, y]) => `${x},${y}`).join(" ");
    svg.append(svgElement("polyline", { points: path, class: "preview-walls", "vector-effect": "non-scaling-stroke" }));
    svg.append(svgElement("line", {
      x1: openEnd[0], y1: openEnd[1], x2: outline[0][0], y2: outline[0][1],
      class: "preview-gap", "vector-effect": "non-scaling-stroke",
    }));
  } else {
    // A clip path: anything drawn "clipped" by it only shows inside the room.
    const clip = svgElement("clipPath", { id: "preview-room-clip" });
    clip.append(svgElement("polygon", { points }));
    svg.append(clip);
    svg.append(svgElement("polygon", { points, class: "preview-floor" }));
    svg.append(drawGrid(box));
    svg.append(svgElement("polygon", { points, class: "preview-walls", "vector-effect": "non-scaling-stroke" }));
    (geometry.features ?? []).forEach((feature, i) => {
      if (!featureErrors[i]?.length) {
        svg.append(drawFeature(outline, feature, box.margin));
      }
    });
    drawCornerArrows(svg, outline, box.margin);
  }
  drawWallLabels(svg, wallSegments(outline, openEnd), box.margin);
}

/**
 * The rectangle a feature covers on the plan: along its span, reaching
 * `depth` inches into the room. Corners are in order, for an SVG polygon.
 *
 * @param {number[][]} outline
 * @param {object} feature
 * @param {number} depth - inches into the room
 * @returns {number[][]}
 */
export function featureRect(outline, feature, depth) {
  const { start, end } = featureSpan(outline, feature);
  const [nx, ny] = inwardNormal(outline, feature.wall);
  return [
    start,
    end,
    [end[0] + nx * depth, end[1] + ny * depth],
    [start[0] + nx * depth, start[1] + ny * depth],
  ];
}

/**
 * @param {number[][]} corners
 * @returns {string} SVG points attribute, e.g. "0,0 34,0 34,34 0,34"
 */
function pointsText(corners) {
  return corners.map(([x, y]) => `${x},${y}`).join(" ");
}

/**
 * Draw one feature in the same colours as the 3D planner: a door as a brown
 * stretch of wall with its faint door zone, a window as a blue double line,
 * a closet as a dashed 24 in deep box, a radiator as a grey box, an outlet
 * as a small dot.
 *
 * @param {number[][]} outline
 * @param {object} feature
 * @param {number} margin - used to size the outlet dot
 * @returns {SVGGElement}
 */
function drawFeature(outline, feature, margin) {
  const group = svgElement("g", { class: `preview-feature preview-${feature.kind}` });
  const line = (rect, cls) => svgElement("line", {
    x1: rect[0][0], y1: rect[0][1], x2: rect[1][0], y2: rect[1][1],
    class: cls, "vector-effect": "non-scaling-stroke",
  });
  switch (feature.kind) {
    case "door": {
      const zone = featureRect(outline, feature, feature.width);
      group.append(svgElement("polygon", { points: pointsText(zone), class: "preview-door-zone" }));
      group.append(line(zone, "preview-door-leaf"));
      break;
    }
    case "window": {
      group.append(line(featureRect(outline, feature, 0), "preview-window-line"));
      const inner = featureRect(outline, feature, WINDOW_LINE_GAP).slice(2).reverse();
      group.append(line(inner, "preview-window-line"));
      break;
    }
    case "closet":
    case "radiator": {
      const depth = feature.kind === "closet" ? CLOSET_DEPTH : (feature.depth ?? DEFAULT_RADIATOR_DEPTH);
      group.append(svgElement("polygon", {
        points: pointsText(featureRect(outline, feature, depth)),
        class: `preview-${feature.kind}-box`, "vector-effect": "non-scaling-stroke",
      }));
      break;
    }
    case "outlet": {
      const { start } = featureSpan(outline, feature);
      const [nx, ny] = inwardNormal(outline, feature.wall);
      group.append(svgElement("circle", {
        cx: start[0] + nx * 3, cy: start[1] + ny * 3, r: margin * 0.04, class: "preview-outlet-dot",
      }));
      break;
    }
  }
  return group;
}

/**
 * A small arrow at each wall's left corner (as seen from inside), pointing
 * along the wall: "distances along this wall are measured from here"
 * (SPEC.md 9.1). Because outlines are clockwise, that corner is simply the
 * wall's start corner.
 *
 * @param {SVGSVGElement} svg
 * @param {number[][]} outline
 * @param {number} margin
 */
function drawCornerArrows(svg, outline, margin) {
  // A <marker> is a shape SVG draws at the end of a line: the arrowhead.
  const marker = svgElement("marker", {
    id: "preview-arrowhead", viewBox: "0 0 10 10", refX: 9, refY: 5,
    markerUnits: "userSpaceOnUse", markerWidth: margin * 0.1, markerHeight: margin * 0.1, orient: "auto",
  });
  marker.append(svgElement("path", { d: "M0,0 L10,5 L0,10 z", class: "preview-arrowhead" }));
  svg.append(marker);

  const inset = margin * 0.12;
  outline.forEach((start, i) => {
    const end = outline[(i + 1) % outline.length];
    const length = wallLength(outline, i);
    const [dx, dy] = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    const [nx, ny] = inwardNormal(outline, i);
    const arrowLength = Math.min(length * 0.3, margin * 0.7);
    const fromX = start[0] + nx * inset + dx * inset;
    const fromY = start[1] + ny * inset + dy * inset;
    svg.append(svgElement("line", {
      x1: fromX, y1: fromY, x2: fromX + dx * arrowLength, y2: fromY + dy * arrowLength,
      class: "preview-corner-arrow", "marker-end": "url(#preview-arrowhead)",
      "vector-effect": "non-scaling-stroke",
    }));
  });
}

/**
 * Grid lines every 12 in, clipped to the room.
 *
 * @param {{x: number, y: number, width: number, height: number, margin: number}} box
 * @returns {SVGGElement}
 */
function drawGrid(box) {
  const grid = svgElement("g", { class: "preview-grid", "clip-path": "url(#preview-room-clip)" });
  const left = box.x + box.margin;
  const top = box.y + box.margin;
  const right = box.x + box.width - box.margin;
  const bottom = box.y + box.height - box.margin;
  for (let x = left + GRID_SPACING; x < right; x += GRID_SPACING) {
    grid.append(svgElement("line", { x1: x, y1: top, x2: x, y2: bottom, "vector-effect": "non-scaling-stroke" }));
  }
  for (let y = top + GRID_SPACING; y < bottom; y += GRID_SPACING) {
    grid.append(svgElement("line", { x1: left, y1: y, x2: right, y2: y, "vector-effect": "non-scaling-stroke" }));
  }
  return grid;
}

/**
 * Label each wall outside its middle with its letter and length: "A 9′ 6″".
 *
 * @param {SVGSVGElement} svg
 * @param {{start: number[], end: number[]}[]} segments
 * @param {number} margin - the space around the room, inches
 */
function drawWallLabels(svg, segments, margin) {
  const fontSize = margin * 0.28;
  segments.forEach((segment, i) => {
    const length = Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]);
    if (length === 0) {
      return;
    }
    // Side labels are anchored at their inner end, so a small gap is enough;
    // labels above or below are centred on their point, so they need about
    // half a line of text more to clear the wall.
    const anchor = labelAnchor(segment);
    const [x, y] = labelPoint(segment, anchor === "middle" ? margin * 0.3 : margin * 0.1);
    const text = svgElement("text", {
      x, y, "font-size": fontSize, class: "preview-label",
      "text-anchor": anchor, "dominant-baseline": "middle",
    });
    const letter = svgElement("tspan", { class: "preview-letter" });
    letter.textContent = wallLetter(i);
    text.append(letter, ` ${formatFeetInches(length)}`);
    svg.append(text);
  });
}
