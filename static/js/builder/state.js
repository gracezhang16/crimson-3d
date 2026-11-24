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

import { signedArea, wallLength, wallLetter } from "../shared/geometry.js";

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
const MAX_FEATURES = 40;
const SINGLE_ROOM_NAME = "Main room"; // the one room, until the builder handles several (U3)
const EPSILON = 1e-9; // as in geometry.py: diagonal wall lengths aren't whole numbers

export const FEATURE_KINDS = ["door", "window", "closet", "radiator", "outlet"];

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

// ---------------------------------------------------------------------------
// Features (A3). featureProblems() mirrors geometry.py's _validate_features,
// message for message, so the builder shows exactly what the server would
// say on save. tests/fixtures/feature_cases.json holds cases both test
// suites check, so the two can't drift apart unnoticed.
// ---------------------------------------------------------------------------

/**
 * Build one feature object from a table row, with only the keys its kind
 * uses (SPEC.md 4.2). Required numbers that are missing stay as NaN so
 * validation reports them; a radiator's optional height and depth are left
 * out when empty.
 *
 * @param {{kind: string, wall: number, offset: number, width: number,
 *   height: number, sill: number, depth: number}} values - numbers or NaN
 * @returns {object}
 */
export function featureFromValues({ kind, wall, offset, width, height, sill, depth }) {
  const feature = { kind, wall, offset };
  if (kind === "outlet") {
    return feature;
  }
  feature.width = width;
  if (kind === "radiator") {
    if (!Number.isNaN(height)) feature.height = height;
    if (!Number.isNaN(depth)) feature.depth = depth;
    return feature;
  }
  feature.height = height;
  if (kind === "window") {
    feature.sill = sill;
  }
  return feature;
}

/**
 * A wall length for a message: "114 in", or "141.4 in" for a diagonal wall.
 * @param {number} length
 * @returns {string}
 */
function inchesText(length) {
  return Number.isInteger(length) ? `${length} in` : `${length.toFixed(1)} in`;
}

/**
 * What's wrong with each feature, given a valid outline.
 *
 * @param {number[][]} outline
 * @param {object[]} features
 * @param {number} ceiling - a valid ceiling, or 240 when the ceiling is invalid
 * @returns {{general: string[], perFeature: string[][]}} perFeature[i] lists
 *   feature i's problems (so its table row can show them)
 */
export function featureProblems(outline, features, ceiling) {
  if (features.length > MAX_FEATURES) {
    return { general: [`A room can have at most ${MAX_FEATURES} features.`], perFeature: features.map(() => []) };
  }
  const counts = {}; // numbers features per kind, so messages say "Window 2"
  const perFeature = features.map((feature) => {
    if (!FEATURE_KINDS.includes(feature.kind)) {
      return [`Unknown feature kind '${feature.kind}'; use one of ${FEATURE_KINDS.join(", ")}.`];
    }
    counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
    const name = `${feature.kind[0].toUpperCase()}${feature.kind.slice(1)} ${counts[feature.kind]}`;
    return validateFeature(outline, feature, name, ceiling);
  });
  return { general: [], perFeature };
}

/**
 * Problems with one feature (geometry.py: _validate_feature).
 * @returns {string[]}
 */
function validateFeature(outline, feature, name, ceiling) {
  const n = outline.length;
  const { kind, wall, offset } = feature;
  if (!Number.isInteger(wall) || wall < 0 || wall >= n) {
    return [`${name} must be on a wall from A to ${wallLetter(n - 1)}.`];
  }
  const letter = wallLetter(wall);
  const length = wallLength(outline, wall);
  if (!Number.isInteger(offset) || offset < 0) {
    return [`${name} needs a distance from the corner of 0 in or more.`];
  }

  const errors = [];
  if (kind === "outlet") {
    if (offset > length + EPSILON) {
      errors.push(`${name} is past the end of wall ${letter} (${offset} in on a ${inchesText(length)} wall).`);
    }
  } else {
    const { width } = feature;
    if (!Number.isInteger(width) || width < 1) {
      errors.push(`${name} needs a width of 1 in or more.`);
    } else if (offset + width > length + EPSILON) {
      errors.push(width > length + EPSILON
        ? `${name} is wider than wall ${letter} (${width} in on a ${inchesText(length)} wall).`
        : `${name} runs past the end of wall ${letter} (${offset} + ${width} in on a ${inchesText(length)} wall).`);
    }
  }

  errors.push(...validateHeights(feature, name, ceiling));

  if (kind === "radiator" && "depth" in feature) {
    if (!Number.isInteger(feature.depth) || feature.depth < 1) {
      errors.push(`${name} needs a depth of 1 in or more.`);
    }
  }
  return errors;
}

/**
 * Problems with a feature's height and, for windows, sill
 * (geometry.py: _validate_heights).
 * @returns {string[]}
 */
function validateHeights(feature, name, ceiling) {
  const { kind, height, sill } = feature;
  if (kind === "outlet") {
    return []; // outlets are always drawn at 12 in
  }
  const heightRequired = ["door", "window", "closet"].includes(kind);
  if (!("height" in feature) && !heightRequired) {
    return []; // a radiator may leave out its height
  }
  if (!Number.isInteger(height) || height < 1) {
    return [`${name} needs a height of 1 in or more.`];
  }
  if (kind !== "window") {
    return height > ceiling
      ? [`${name} is taller than the ceiling (${height} in under a ${ceiling} in ceiling).`]
      : [];
  }
  if (!Number.isInteger(sill) || sill < 0) {
    return [`${name} needs a sill height of 0 in or more.`];
  }
  if (sill + height > ceiling) {
    return [`${name} reaches above the ceiling (sill ${sill} in + height ${height} in under a ${ceiling} in ceiling).`];
  }
  return [];
}

/**
 * Build the room-format object from the form's values.
 *
 * @param {{shape: "rectangle" | "walls", width: number, length: number,
 *   walls: {direction: string, length: number}[], ceiling: number,
 *   features?: object[]}} values - features as made by featureFromValues()
 * @returns {{geometry: object | null, errors: string[], openEnd: number[] | null,
 *   featureErrors: string[][]}}
 *   geometry is null when there is no outline to draw. Only save it when
 *   errors is empty. openEnd: see outlineFromWalls(). featureErrors[i] lists
 *   feature i's problems (empty until the outline itself is valid).
 */
export function buildGeometry({ shape, width, length, walls, ceiling, features = [] }) {
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

  const outlineOk = outline !== null && errors.length === 0;
  const ceilingOk = isWholeBetween(ceiling, MIN_CEILING, MAX_CEILING);
  if (!ceilingOk) {
    errors.push(`Ceiling must be a whole number from ${MIN_CEILING} to ${MAX_CEILING} in.`);
  }

  // As on the server, features are only checked against a good outline, and
  // against the highest allowed ceiling while the ceiling itself is invalid.
  let featureErrors = features.map(() => []);
  if (outlineOk) {
    const result = featureProblems(outline, features, ceilingOk ? ceiling : MAX_CEILING);
    featureErrors = result.perFeature;
    errors.push(...result.general, ...result.perFeature.flat());
  }

  // A suite (format version 2) with one room. U3 adds more rooms.
  const geometry = outline && {
    version: 2, units: "in", ceiling,
    rooms: [{ name: SINGLE_ROOM_NAME, kind: "bedroom", outline, features }],
  };
  return { geometry, errors, openEnd, featureErrors };
}

// ---------------------------------------------------------------------------
// Saved room -> form (A4): used when editing, and when the server sends the
// form back with errors.
// ---------------------------------------------------------------------------

/**
 * Turn a room-format object back into the values the form shows.
 *
 * A plain rectangle starting at (0, 0) opens in Rectangle mode. Any other
 * outline whose walls all run north, south, east or west opens as walked
 * walls, starting from its first corner. Angled walls can't be shown in
 * either mode, and nor (until U3) can a suite with several rooms, so those
 * return null.
 *
 * @param {{ceiling: number, rooms: {outline: number[][], features: object[]}[]}} geometry
 * @returns {{shape: "rectangle" | "walls", width?: number, length?: number,
 *   walls: {direction: string, length: number}[], ceiling: number,
 *   features: object[]} | null}
 */
export function geometryToForm(geometry) {
  if (geometry.rooms.length !== 1) {
    return null;
  }
  const { ceiling } = geometry;
  const { outline, features } = geometry.rooms[0];
  const [width, length] = [outline[1]?.[0], outline[2]?.[1]];
  const isRectangle = outline.length === 4 &&
    JSON.stringify(outline) === JSON.stringify(rectangleOutline(width, length));
  if (isRectangle) {
    return { shape: "rectangle", width, length, walls: rectangleWalls(width, length), ceiling, features };
  }

  const walls = [];
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    const [dx, dy] = [x2 - x1, y2 - y1];
    if (dx !== 0 && dy !== 0) {
      return null; // an angled wall
    }
    const direction = dx > 0 ? "east" : dx < 0 ? "west" : dy > 0 ? "south" : "north";
    walls.push({ direction, length: Math.abs(dx + dy) });
  }
  return { shape: "walls", walls, ceiling, features };
}
