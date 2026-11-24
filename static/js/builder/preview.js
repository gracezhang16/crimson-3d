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
 * The exported helpers (wallSegments, previewBox, labelPoint, labelAnchor)
 * are pure and tested in tests/builder.test.mjs; drawPreview() needs a browser.
 */

import { wallLetter } from "../shared/geometry.js";
import { formatFeetInches } from "../shared/units.js";

const SVG_NS = "http://www.w3.org/2000/svg"; // SVG elements need this namespace
const GRID_SPACING = 12; // inches

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
 */
export function drawPreview(svg, geometry, openEnd = null) {
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
  }
  drawWallLabels(svg, wallSegments(outline, openEnd), box.margin);
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
