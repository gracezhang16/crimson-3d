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
const MAX_COORDINATE = 1200;   // SPEC.md 4.2: suite coordinates run 0 to 1200 in
const MIN_CEILING = 72;
const MAX_CEILING = 240;
const MIN_WALLS = 4; // at right angles, a closed room needs at least four walls
const MAX_WALLS = 12;
const MAX_FEATURES = 40;
const SINGLE_ROOM_NAME = "Main room"; // buildGeometry()'s one room
const MAX_ROOMS = 8;
const MAX_ROOM_NAME = 40;
export const ROOM_KINDS = ["bedroom", "common"];
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

// ---------------------------------------------------------------------------
// Suites (U3): each room's form values -> the suite format (version 2)
// ---------------------------------------------------------------------------

/**
 * A new room's form values. Everything is kept as the text typed in the
 * form (so switching rooms never loses what was typed); parseRoom() turns
 * it into numbers.
 *
 * @param {string} name
 * @param {string} [kind]
 * @param {{x: number, y: number}} [position] - its north-west corner in the suite
 * @returns {object}
 */
export function newRoom(name, kind = "bedroom", position = { x: 0, y: 0 }) {
  return {
    name, kind, shape: "rectangle", width: "120", length: "144",
    x: String(position.x), y: String(position.y), walls: [], features: [],
  };
}

/**
 * Turn one room's typed values into numbers (NaN where something isn't a
 * whole number) and feature objects.
 *
 * @param {object} raw - from newRoom() or the form
 * @returns {object}
 */
export function parseRoom(raw) {
  return {
    name: raw.name,
    kind: raw.kind,
    shape: raw.shape,
    width: parseInches(raw.width),
    length: parseInches(raw.length),
    x: parseInches(raw.x),
    y: parseInches(raw.y),
    walls: raw.walls.map((wall) => ({ direction: wall.direction, length: parseInches(wall.length) })),
    features: raw.features.map((feature) => featureFromValues({
      kind: feature.kind,
      wall: feature.wall === "" ? NaN : Number(feature.wall),
      offset: parseInches(feature.offset),
      width: parseInches(feature.width),
      height: parseInches(feature.height),
      sill: parseInches(feature.sill),
      depth: parseInches(feature.depth),
    })),
  };
}

/**
 * A room's outline from its shape, with its north-west corner at (0, 0).
 *
 * @param {{shape: string, width: number, length: number, walls: object[]}} room - parsed
 * @returns {{outline: number[][] | null, errors: string[], openEnd: number[] | null}}
 */
function roomOutline({ shape, width, length, walls }) {
  if (shape === "walls") {
    return outlineFromWalls(walls);
  }
  const errors = [];
  const widthOk = isWholeBetween(width, 1, MAX_COORDINATE);
  const lengthOk = isWholeBetween(length, 1, MAX_COORDINATE);
  if (!widthOk) errors.push(`Width must be a whole number from 1 to ${MAX_COORDINATE} in.`);
  if (!lengthOk) errors.push(`Length must be a whole number from 1 to ${MAX_COORDINATE} in.`);
  return { outline: widthOk && lengthOk ? rectangleOutline(width, length) : null, errors, openEnd: null };
}

/**
 * Build the suite format (version 2) from every room's parsed values.
 *
 * Each room's outline is built from its shape, then moved so its north-west
 * corner is at the room's position (x, y). Problems are checked the same way
 * as on the server (geometry.validate_suite), except overlap between rooms,
 * which only the server checks (the preview shows it plainly). When the
 * suite has several rooms, problems start with the room's name.
 *
 * @param {{ceiling: number, rooms: object[]}} suite - rooms from parseRoom()
 * @returns {{geometry: object | null, errors: string[], rooms: {name: string,
 *   outline: number[][] | null, openEnd: number[] | null, features: object[],
 *   featureErrors: string[][]}[]}}
 *   geometry is null until every room has an outline to draw. Only save it
 *   when errors is empty. rooms[i] is what the preview draws for room i.
 */
export function buildSuite({ ceiling, rooms }) {
  const errors = [];
  if (rooms.length < 1 || rooms.length > MAX_ROOMS) {
    errors.push(`A suite needs 1 to ${MAX_ROOMS} rooms.`);
  }
  const ceilingOk = isWholeBetween(ceiling, MIN_CEILING, MAX_CEILING);
  const prefix = (label) => (rooms.length > 1 ? `${label}: ` : "");

  const built = rooms.map((room, i) => {
    const label = room.name?.trim() || `Room ${i + 1}`;
    const roomErrors = [];
    if (!room.name || !room.name.trim() || room.name.trim().length > MAX_ROOM_NAME) {
      roomErrors.push(`Give the room a name of 1 to ${MAX_ROOM_NAME} characters.`);
    }
    if (!ROOM_KINDS.includes(room.kind)) {
      roomErrors.push("Room kind must be bedroom or common.");
    }
    const positionOk = isWholeBetween(room.x, 0, MAX_COORDINATE) && isWholeBetween(room.y, 0, MAX_COORDINATE);
    if (!positionOk) {
      roomErrors.push(`Position must be whole numbers from 0 to ${MAX_COORDINATE} in.`);
    }
    const shape = roomOutline(room);
    roomErrors.push(...shape.errors);

    // Move the room to its place in the suite.
    const dx = positionOk ? room.x : 0;
    const dy = positionOk ? room.y : 0;
    const outline = shape.outline && shape.outline.map(([x, y]) => [x + dx, y + dy]);
    const openEnd = shape.openEnd && [shape.openEnd[0] + dx, shape.openEnd[1] + dy];
    if (outline && outline.some(([x, y]) => x > MAX_COORDINATE || y > MAX_COORDINATE)) {
      roomErrors.push(`The room must fit within ${MAX_COORDINATE} × ${MAX_COORDINATE} in.`);
    }

    // As on the server, features are only checked against a good outline,
    // and against the highest ceiling while the ceiling itself is invalid.
    let featureErrors = room.features.map(() => []);
    let general = [];
    if (outline && roomErrors.length === 0) {
      const checked = featureProblems(outline, room.features, ceilingOk ? ceiling : MAX_CEILING);
      featureErrors = checked.perFeature;
      general = checked.general;
    }
    return {
      label, roomErrors, general, featureErrors,
      view: { name: label, outline, openEnd, features: room.features, featureErrors },
      room: outline && { name: room.name.trim(), kind: room.kind, outline, features: room.features },
    };
  });

  for (const room of built) errors.push(...room.roomErrors.map((e) => prefix(room.label) + e));
  if (!ceilingOk) {
    errors.push(`Ceiling must be a whole number from ${MIN_CEILING} to ${MAX_CEILING} in.`);
  }
  for (const room of built) {
    errors.push(...[...room.general, ...room.featureErrors.flat()].map((e) => prefix(room.label) + e));
  }

  const complete = built.length > 0 && built.every((room) => room.room);
  const geometry = complete
    ? { version: 2, units: "in", ceiling, rooms: built.map((room) => room.room) }
    : null;
  return { geometry, errors, rooms: built.map((room) => room.view) };
}

/**
 * Build a one-room suite from one room's values (no name, kind or position
 * needed): the room is a bedroom called "Main room" at (0, 0).
 *
 * @param {{shape: "rectangle" | "walls", width: number, length: number,
 *   walls: {direction: string, length: number}[], ceiling: number,
 *   features?: object[]}} values - features as made by featureFromValues()
 * @returns {{geometry: object | null, errors: string[], openEnd: number[] | null,
 *   featureErrors: string[][]}}
 */
export function buildGeometry({ ceiling, features = [], ...shape }) {
  const room = { ...shape, name: SINGLE_ROOM_NAME, kind: "bedroom", x: 0, y: 0, features };
  const { geometry, errors, rooms } = buildSuite({ ceiling, rooms: [room] });
  return { geometry, errors, openEnd: rooms[0].openEnd, featureErrors: rooms[0].featureErrors };
}

/**
 * Where to put a room "east of" or "south of" another, with a wall of
 * `gap` inches between them: lined up with the other room's north (or west)
 * side.
 *
 * @param {number[][]} otherOutline - the room to place next to
 * @param {"east" | "south"} side
 * @param {number} gap - inches of wall between the rooms
 * @returns {{x: number, y: number}} the new room's north-west corner
 */
export function positionNextTo(otherOutline, side, gap) {
  const xs = otherOutline.map(([x]) => x);
  const ys = otherOutline.map(([, y]) => y);
  return side === "south"
    ? { x: Math.min(...xs), y: Math.max(...ys) + gap }
    : { x: Math.max(...xs) + gap, y: Math.min(...ys) };
}

// ---------------------------------------------------------------------------
// Saved suite -> form (A4, U3): used when editing, and when the server sends
// the form back with errors.
// ---------------------------------------------------------------------------

/**
 * Turn a saved suite back into form values: the ceiling and each room as
 * newRoom()-style typed values.
 *
 * Each room's position is its outline's north-west corner. A plain
 * rectangle opens in Rectangle mode; any other outline whose walls all run
 * north, south, east or west opens as walked walls from its first corner.
 * Angled walls can't be shown in either mode, so then this returns null.
 *
 * @param {{ceiling: number, rooms: {name: string, kind: string,
 *   outline: number[][], features: object[]}[]}} geometry
 * @returns {{ceiling: string, rooms: object[]} | null}
 */
export function geometryToForm(geometry) {
  const rooms = geometry.rooms.map(roomToForm);
  return rooms.every(Boolean) ? { ceiling: String(geometry.ceiling), rooms } : null;
}

/**
 * One saved room -> typed form values, or null if it has an angled wall.
 * @param {{name: string, kind: string, outline: number[][], features: object[]}} room
 * @returns {object | null}
 */
function roomToForm(room) {
  const minX = Math.min(...room.outline.map(([x]) => x));
  const minY = Math.min(...room.outline.map(([, y]) => y));
  const outline = room.outline.map(([x, y]) => [x - minX, y - minY]);
  const text = (value) => (value === undefined || Number.isNaN(value) ? "" : String(value));
  const base = {
    name: room.name, kind: room.kind, x: String(minX), y: String(minY),
    features: room.features.map((f) => ({
      kind: f.kind, wall: text(f.wall), offset: text(f.offset), width: text(f.width),
      height: text(f.height), sill: text(f.sill), depth: text(f.depth),
    })),
  };

  const [width, length] = [outline[1]?.[0], outline[2]?.[1]];
  if (outline.length === 4 && JSON.stringify(outline) === JSON.stringify(rectangleOutline(width, length))) {
    return { ...base, shape: "rectangle", width: String(width), length: String(length), walls: [] };
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
    walls.push({ direction, length: String(Math.abs(dx + dy)) });
  }
  return { ...base, shape: "walls", width: "120", length: "144", walls };
}
