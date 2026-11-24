/**
 * Builder form values -> room-format object (SPEC.md 4.2). Hannah.
 *
 * Pure: no DOM, no three.js, so tests/builder.test.mjs runs it under node.
 * builder/main.js reads the form and calls buildGeometry() on every keystroke.
 *
 * Two ways to describe the outline:
 *   - "rectangle": width (east-west) and length (north-south).
 *   - "walls": walk the walls. Start at any corner and go clockwise, keeping
 *     the room on your right. For each wall give its direction (east, south,
 *     west, north) and its tape-measured length. Covers L-shapes, alcoves and
 *     notches; walls are always at right angles.
 *
 * Validation here is for the live preview. The server checks again with
 * geometry.validate_room() when the form is saved (A4).
 */

import { signedArea, wallLetter } from "../shared/geometry.js";

// One step of 1 inch in each direction, in plan coordinates (y points south).
export const DIRECTIONS = {
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
  north: [0, -1],
};

// Limits from SPEC.md 4.2.
const MAX_COORDINATE = 600;
const MIN_CEILING = 72;
const MAX_CEILING = 240;
const MIN_WALLS = 4; // at right angles, a closed room needs at least four walls
const MAX_WALLS = 12;

/**
 * Turn what was typed in a length box into whole inches, or NaN if it isn't
 * a whole number ("All lengths are whole inches", SPEC.md 1).
 *
 * @param {string} text
 * @returns {number}
 */
export function parseInches(text) {
  const trimmed = String(text ?? "").trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
function isWholeBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * What's wrong with one wall row, or null if it's fine.
 *
 * @param {{direction: string, length: number}} wall
 * @returns {string | null}
 */
export function wallProblem(wall) {
  if (!(wall.direction in DIRECTIONS)) {
    return "Pick a direction.";
  }
  if (!isWholeBetween(wall.length, 1, MAX_COORDINATE)) {
    return `Length must be a whole number from 1 to ${MAX_COORDINATE} in.`;
  }
  return null;
}

/**
 * Describe where the walk ended, relative to where it started.
 *
 * @param {number} dx - inches east (negative = west)
 * @param {number} dy - inches south (negative = north)
 * @returns {string}
 */
function gapDescription(dx, dy) {
  const parts = [];
  if (dx !== 0) parts.push(`${Math.abs(dx)} in ${dx > 0 ? "east" : "west"}`);
  if (dy !== 0) parts.push(`${Math.abs(dy)} in ${dy > 0 ? "south" : "north"}`);
  return parts.join(" and ");
}

/**
 * Walk the walls and return the outline they trace.
 *
 * The outline is shifted so its smallest x and y are 0, because SPEC.md 4.2
 * allows coordinates from 0 to 600 only and the walk may head west or north
 * of the first corner. Wall i of the outline is row i of the table, so wall
 * letters in the table match the preview and the planner.
 *
 * @param {{direction: string, length: number}[]} walls
 * @returns {{outline: number[][] | null, errors: string[], openEnd: number[] | null}}
 *   outline is null only when a row is unusable; it is still returned (for
 *   the preview) when the walls don't close or run counter-clockwise.
 *   openEnd is where the last wall actually ends when the walls don't meet
 *   up (so the preview can draw the gap), otherwise null.
 */
export function outlineFromWalls(walls) {
  if (walls.length < MIN_WALLS || walls.length > MAX_WALLS) {
    return { outline: null, errors: [`A room needs ${MIN_WALLS} to ${MAX_WALLS} walls.`], openEnd: null };
  }
  const rowErrors = walls
    .map((wall, i) => [i, wallProblem(wall)])
    .filter(([, problem]) => problem)
    .map(([i, problem]) => `Wall ${wallLetter(i)}: ${problem}`);
  if (rowErrors.length) {
    return { outline: null, errors: rowErrors, openEnd: null };
  }

  const errors = [];
  walls.forEach((wall, i) => {
    const next = walls[(i + 1) % walls.length];
    const [dx, dy] = DIRECTIONS[wall.direction];
    const [nx, ny] = DIRECTIONS[next.direction];
    if (dx === -nx && dy === -ny) {
      errors.push(`Wall ${wallLetter((i + 1) % walls.length)} doubles back on wall ${wallLetter(i)}.`);
    }
  });

  // Walk: each corner is where a wall starts.
  let x = 0;
  let y = 0;
  const corners = walls.map((wall) => {
    const corner = [x, y];
    const [dx, dy] = DIRECTIONS[wall.direction];
    x += dx * wall.length;
    y += dy * wall.length;
    return corner;
  });
  const closed = x === 0 && y === 0;
  if (!closed) {
    errors.push(`The walls don't meet up: the last wall ends ${gapDescription(x, y)} of where you started.`);
  }

  // Shift everything (including an open walk's end) so the smallest x and y are 0.
  const points = closed ? corners : [...corners, [x, y]];
  const minX = Math.min(...points.map(([px]) => px));
  const minY = Math.min(...points.map(([, py]) => py));
  const outline = corners.map(([cx, cy]) => [cx - minX, cy - minY]);
  const openEnd = closed ? null : [x - minX, y - minY];

  if (outline.some(([cx, cy]) => cx > MAX_COORDINATE || cy > MAX_COORDINATE)) {
    errors.push(`The room must fit within ${MAX_COORDINATE} × ${MAX_COORDINATE} in.`);
  }
  // Only meaningful once the walk closes. With y pointing down, clockwise on
  // screen gives a positive signed area (see shared/geometry.js).
  if (closed && signedArea(outline) < 0) {
    errors.push("These walls go counter-clockwise. Walk the other way, keeping the room on your right.");
  }
  return { outline, errors, openEnd };
}

/**
 * The outline of a width × length rectangle, clockwise from the north-west
 * corner, so wall A is north, B east, C south, D west.
 *
 * @param {number} width - east-west, inches
 * @param {number} length - north-south, inches
 * @returns {number[][]}
 */
export function rectangleOutline(width, length) {
  return [[0, 0], [width, 0], [width, length], [0, length]];
}

/**
 * The walls of a rectangle, for starting a custom shape from it.
 *
 * @param {number} width
 * @param {number} length
 * @returns {{direction: string, length: number}[]}
 */
export function rectangleWalls(width, length) {
  return [
    { direction: "east", length: width },
    { direction: "south", length },
    { direction: "west", length: width },
    { direction: "north", length },
  ];
}

/**
 * Build the room-format object from the form's values.
 *
 * @param {{shape: "rectangle" | "walls", width: number, length: number,
 *   walls: {direction: string, length: number}[], ceiling: number}} values
 * @returns {{geometry: object | null, errors: string[], openEnd: number[] | null}}
 *   geometry is null when there is no outline to draw. Only save it when
 *   errors is empty. openEnd: see outlineFromWalls().
 */
export function buildGeometry({ shape, width, length, walls, ceiling }) {
  const errors = [];
  let outline = null;
  let openEnd = null;

  if (shape === "walls") {
    const result = outlineFromWalls(walls);
    outline = result.outline;
    openEnd = result.openEnd;
    errors.push(...result.errors);
  } else {
    const widthOk = isWholeBetween(width, 1, MAX_COORDINATE);
    const lengthOk = isWholeBetween(length, 1, MAX_COORDINATE);
    if (!widthOk) errors.push(`Width must be a whole number from 1 to ${MAX_COORDINATE} in.`);
    if (!lengthOk) errors.push(`Length must be a whole number from 1 to ${MAX_COORDINATE} in.`);
    if (widthOk && lengthOk) outline = rectangleOutline(width, length);
  }

  if (!isWholeBetween(ceiling, MIN_CEILING, MAX_CEILING)) {
    errors.push(`Ceiling must be a whole number from ${MIN_CEILING} to ${MAX_CEILING} in.`);
  }

  const geometry = outline && { version: 1, units: "in", ceiling, outline, features: [] };
  return { geometry, errors, openEnd };
}
